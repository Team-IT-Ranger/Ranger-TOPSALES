/**
 * ===================== สิทธิ์เข้าถึงชุดราคา (price list eligibility) =====================
 * ปัญหาเดิม: ชุดราคาผูกกับ "กลุ่มลูกค้า" ช่องเดียว (`price_lists.customer_group_id`)
 * ร้านหนึ่งอยู่ได้กลุ่มเดียว ชุดราคาหนึ่งเข้าถึงได้กลุ่มเดียว — พอธุรกิจอยากได้เงื่อนไขอื่น
 * (เฉพาะช่องทางค้าส่ง · เฉพาะเขตตะวันออก · เฉพาะร้านที่ขายเชื่อ · เฉพาะรายชื่อที่ระบุ)
 * ต้องไปสร้างกลุ่มลูกค้าปลอมขึ้นมาแล้วย้ายร้านเข้าออก ซึ่งพังทันทีที่เงื่อนไขซ้อนกันสองแกน
 *
 * ของใหม่: **กฎสิทธิ์** ผูกกับชุดราคา ชุดละกี่กฎก็ได้
 *   price_list_rules            1 แถว = 1 กลุ่มเป้าหมายของชุดราคานั้น (มีลำดับความสำคัญของตัวเอง)
 *   price_list_rule_conditions  1 แถว = 1 เงื่อนไข ประกอบกันด้วย match_type ('all' = และ · 'any' = หรือ)
 *
 * ★ เข้ากันได้กับของเดิม: ชุดราคาที่ยังไม่มีกฎเลย แต่มี customer_group_id อยู่ ถือว่ามีกฎซ่อน
 *   "group_id = ค่านั้น" ลำดับ 0 — ชุดราคา 4 ชุดที่เปิดใช้อยู่บน prod จึงทำงานเหมือนเดิมทุกประการ
 *   โดยไม่ต้องแตะข้อมูล และจะค่อยๆ ย้ายมาใช้กฎเมื่อไหร่ก็ได้
 *
 * ★ ทำไมเลือกได้หลายกฎต่อชุด แทนที่จะเป็นเงื่อนไขก้อนเดียว:
 *   ชุดราคาหนึ่งมักขายให้หลายกลุ่มที่นิยามคนละแบบ ("ซุปเปอร์ชีป" = ช่องทาง SC หรือ กลุ่มลูกค้า 2)
 *   ถ้าบังคับเป็นก้อนเดียวจะต้องเขียนเงื่อนไข OR ซ้อน AND ซึ่งคนตั้งค่าอ่านไม่ออกและตั้งผิดง่าย
 */

var PLR_MATCH_ALL = 'all', PLR_MATCH_ANY = 'any';

/* กฎสิทธิ์ใช้ได้กับสองอย่าง: ชุดราคา และโปรโมชั่น — แถวเดิมที่ยังไม่มี target_type ถือเป็นชุดราคา */
var PLR_TARGET_PRICE_LIST = 'price_list', PLR_TARGET_PROMO = 'promo', PLR_TARGET_FREE_GOODS = 'free_goods';
function plrTargetOf(r) { return String(r.target_type || PLR_TARGET_PRICE_LIST); }

/**
 * คุณลักษณะของลูกค้าที่เอามาตั้งเงื่อนไขได้ — whitelist ตั้งใจให้จำกัด
 * เปิดให้ใส่ชื่อคอลัมน์อะไรก็ได้ = พิมพ์ผิดแล้วกฎเงียบ ไม่มีใครรู้ว่าทำไมร้านไม่เข้าเงื่อนไข
 * `attr:<key>` เป็นทางลัดไปที่ customers.attributes (JSON) เช่น attr:sourceGroupCode = 'SV02'
 *   ใช้กับข้อมูลที่ยกมาจากระบบเดิมซึ่งยังไม่ได้ map เข้าตารางอ้างอิงของเรา
 */
var PLR_FIELDS = {
  group_id:              { label: 'กลุ่มลูกค้า', type: 'group' },
  channel_id:            { label: 'ประเภทร้าน / ช่องทาง', type: 'channel' },
  area_code:             { label: 'เขต / สายวิ่ง', type: 'text' },
  sales_mode:            { label: 'รูปแบบการขาย (van/preorder)', type: 'text' },
  payment_type:          { label: 'การชำระเงิน (cash/credit)', type: 'text' },
  province_id:           { label: 'จังหวัด', type: 'text' },
  district_id:           { label: 'อำเภอ', type: 'text' },
  postcode:              { label: 'รหัสไปรษณีย์', type: 'text' },
  tax_type:              { label: 'สถานะภาษีของลูกค้า', type: 'text' },
  customer_code:         { label: 'รหัสลูกค้า', type: 'text' },
  salesman_line_user_id: { label: 'พนักงานขายประจำร้าน', type: 'text' },
  tenant_id:             { label: 'ตัวแทนจำหน่าย', type: 'text' },
  status:                { label: 'สถานะลูกค้า', type: 'text' },
  name:                  { label: 'ชื่อร้าน', type: 'text' },
  /* ★ อยู่ในรายชื่อที่แอดมินทำไว้เองไหม (40_customer_lists.gs) — ใช้กับเกณฑ์ที่ตัดสินด้วยคน
     เช่น "ร้านค้าใหม่ที่ยังไม่เคยซื้อ" หรือรายชื่อร้านที่อนุมัติแนบท้ายใบโปร */
  member_of_list:        { label: 'อยู่ในรายชื่อร้านค้า', type: 'list' }
};

/** ตัวดำเนินการ — ครอบคลุมเท่าที่ใช้จริง ไม่เปิดกว้างจนคนตั้งค่าเองไม่ถูก */
var PLR_OPS = {
  eq:         'เท่ากับ',
  ne:         'ไม่เท่ากับ',
  'in':       'อยู่ในรายการ (คั่นด้วย ,)',
  notin:      'ไม่อยู่ในรายการ (คั่นด้วย ,)',
  contains:   'มีคำว่า',
  startswith: 'ขึ้นต้นด้วย',
  gte:        'มากกว่าหรือเท่ากับ (ตัวเลข)',
  lte:        'น้อยกว่าหรือเท่ากับ (ตัวเลข)',
  empty:      'ว่าง / ยังไม่ได้ตั้ง',
  notempty:   'มีค่า'
};

/** อ่านค่าคุณลักษณะจากแถวลูกค้า — รองรับ attr:<key> ที่ไปดึงจาก attributes (JSON) */
function plrCustomerValue(customer, field) {
  if (!customer) return '';
  var f = String(field || '').trim();
  // member_of_list คืน "รายการ" ของ list id ที่ร้านนี้เป็นสมาชิก — จึงต้องใช้ตัวดำเนินการ in/notin
  if (f === 'member_of_list') {
    return typeof customerListsOf === 'function' ? customerListsOf(customer.record_id).join(',') : '';
  }
  if (f.indexOf('attr:') === 0) {
    var attrs = customerAttributes(customer);
    var v = attrs[f.substring(5)];
    return v === undefined || v === null ? '' : v;
  }
  var v2 = customer[f];
  return v2 === undefined || v2 === null ? '' : v2;
}

function _plrNorm(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
function _plrList(v) { return String(v || '').split(',').map(function(x) { return x.trim().toLowerCase(); }).filter(Boolean); }

/** เงื่อนไขเดียวผ่านไหม — เทียบแบบไม่สนตัวพิมพ์และตัดช่องว่างหัวท้าย (ข้อมูลนำเข้ามักมีช่องว่างติดมา) */
function plrConditionMatches(customer, cond) {
  var actual = _plrNorm(plrCustomerValue(customer, cond.field));
  var want = _plrNorm(cond.value);
  /* ★ member_of_list เป็น "หลายค่า" (ร้านหนึ่งอยู่ได้หลายรายชื่อ) ตัวดำเนินการปกติจึงใช้ไม่ได้ —
     eq จะเทียบสตริง "3,7" กับ "3" แล้วไม่ตรง ทั้งที่ร้านอยู่ในรายชื่อ 3 จริง */
  if (String(cond.field) === 'member_of_list') {
    var mine = _plrList(actual), wanted = _plrList(cond.value);
    var hit = wanted.some(function(w) { return mine.indexOf(w) !== -1; });
    switch (String(cond.op || 'in')) {
      case 'notin': case 'ne': return !hit;
      case 'empty':            return mine.length === 0;
      case 'notempty':         return mine.length > 0;
      default:                 return hit;          // in / eq = อยู่ในรายชื่อใดรายชื่อหนึ่งที่เลือก
    }
  }
  switch (String(cond.op || 'eq')) {
    case 'eq':         return actual === want;
    case 'ne':         return actual !== want;
    case 'in':         return _plrList(cond.value).indexOf(actual) !== -1;
    case 'notin':      return _plrList(cond.value).indexOf(actual) === -1;
    case 'contains':   return want !== '' && actual.indexOf(want) !== -1;
    case 'startswith': return want !== '' && actual.indexOf(want) === 0;
    case 'gte':        return Number(actual) >= Number(want);
    case 'lte':        return Number(actual) <= Number(want);
    case 'empty':      return actual === '' || actual === '0';
    case 'notempty':   return actual !== '' && actual !== '0';
    default:           return false;
  }
}

/**
 * กฎหนึ่งข้อผ่านไหม — 'all' ต้องผ่านทุกเงื่อนไข · 'any' ผ่านข้อใดข้อหนึ่งพอ
 * ★ กฎที่ไม่มีเงื่อนไขเลย = ไม่ผ่าน (ไม่ใช่ผ่านทุกคน) — กฎว่างมักเกิดจากตั้งค้างไว้
 *   ถ้าตีความว่าครอบคลุมทุกร้าน ชุดราคานั้นจะไปทับของทุกคนโดยไม่มีใครตั้งใจ
 */
function plrRuleMatches(customer, rule, conditions) {
  if (!conditions || !conditions.length) return false;
  var all = String(rule.match_type || PLR_MATCH_ALL) !== PLR_MATCH_ANY;
  for (var i = 0; i < conditions.length; i++) {
    var ok = plrConditionMatches(customer, conditions[i]);
    if (all && !ok) return false;
    if (!all && ok) return true;
  }
  return all;
}

/** โหลดกฎทั้งหมดจัดกลุ่มตามชุดราคา — อ่านชีตครั้งเดียวต่อคำขอ (สองตารางนี้อยู่ในลิสต์แคชแล้ว) */
function plrRulesByTarget(targetType) {
  var want = String(targetType || PLR_TARGET_PRICE_LIST);
  var conds = {};
  centralObjects('price_list_rule_conditions').forEach(function(c) {
    (conds[String(c.rule_id)] = conds[String(c.rule_id)] || []).push(c);
  });
  var out = {};
  centralObjects('price_list_rules').forEach(function(r) {
    if (isFlagOff(r.is_active)) return;
    if (plrTargetOf(r) !== want) return;
    (out[String(r.price_list_id)] = out[String(r.price_list_id)] || []).push({ rule: r, conditions: conds[String(r.record_id)] || [] });
  });
  return out;
}
function plrRulesByList() { return plrRulesByTarget(PLR_TARGET_PRICE_LIST); }

/**
 * ชุดราคาที่ลูกค้ารายนี้ได้ ณ วันที่ — คืน { list, rule, priority, reason } หรือ null
 * ลำดับการตัดสิน: priority สูงสุด → valid_from ใหม่สุด → record_id สูงสุด
 *   (ต้องมีตัวตัดสินครบทุกชั้น ไม่งั้นวันที่มีสองชุดคะแนนเท่ากัน ผลจะสลับไปมาตามลำดับแถวในชีต
 *    ซึ่งแปลว่าลูกค้าคนเดียวกันได้คนละราคาในสองคำขอติดกัน — บั๊กที่หาสาเหตุยากที่สุดแบบหนึ่ง)
 */
function resolvePriceListForCustomer(customer, dateStr) {
  if (!customer) return null;
  var today = dateStr || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var rulesByList = plrRulesByList();
  var pkgIdx = packageTenantIndex();
  var best = null;

  centralObjects('price_lists').forEach(function(l) {
    if (String(l.status) !== 'active') return;
    if (_dOnly(l.valid_from) > today || _dOnly(l.valid_to) < today) return;
    // ★ ชั้น A: ชุดนี้ถูกจ่ายให้ตัวแทนของร้านนี้หรือยัง (38_package_distribution.gs)
    //   กฎสิทธิ์ (ชั้น B) ตอบแค่ว่า "ร้านแบบนี้ใช้ได้ไหม" ไม่ได้ตอบว่าบริษัทมอบชุดนี้ให้ตัวแทนรายนี้แล้วหรือยัง
    if (!packageAllowedForTenant(pkgIdx, PKG_PRICE_LIST, l.record_id, customer.tenant_id)) return;

    var rules = rulesByList[String(l.record_id)] || [];
    var hit = null;
    if (rules.length) {
      rules.forEach(function(r) {
        if (!plrRuleMatches(customer, r.rule, r.conditions)) return;
        var pri = Number(r.rule.priority) || 0;
        if (!hit || pri > hit.priority) hit = { priority: pri, rule: r.rule, reason: r.rule.name || ('กฎ #' + r.rule.record_id) };
      });
    } else if (l.customer_group_id !== '' && l.customer_group_id !== null && l.customer_group_id !== undefined) {
      // ชุดราคาแบบเดิมที่ยังไม่ได้ตั้งกฎ — ถือว่ามีกฎซ่อน "กลุ่มลูกค้า = ค่านี้" ลำดับ 0
      if (String(customer.group_id || '') === String(l.customer_group_id)) {
        hit = { priority: 0, rule: null, reason: 'กลุ่มลูกค้าของชุดราคา (แบบเดิม)' };
      }
    }
    if (!hit) return;

    var cand = { list: l, rule: hit.rule, priority: hit.priority, reason: hit.reason };
    if (!best) { best = cand; return; }
    if (cand.priority !== best.priority) { if (cand.priority > best.priority) best = cand; return; }
    var a = _dOnly(cand.list.valid_from), b = _dOnly(best.list.valid_from);
    if (a !== b) { if (a > b) best = cand; return; }
    if (Number(cand.list.record_id) > Number(best.list.record_id)) best = cand;
  });

  return best;
}

/** แถวลูกค้าจาก id (ใช้ในเส้นทางขายที่มีแค่ customerId) */
function plrCustomerRow(customerId) {
  if (!customerId) return null;
  var found = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(customerId)) found = c; });
  return found;
}

/**
 * ตัวเลือกสำเร็จรูปของคุณลักษณะที่เป็น "รหัสอ้างตาราง" — กลุ่มลูกค้า / ประเภทร้าน / ตัวแทน
 * ทำไมต้องมี: ช่องค่าเป็นกล่องพิมพ์เปล่าคือบ่อเกิดของกฎที่ไม่เคยเข้าเงื่อนไข — คนตั้งพิมพ์ชื่อกลุ่ม
 * ("ร้านค้าเหนือ") ลงไปทั้งที่คอลัมน์เก็บเป็น record_id (2) แล้วไม่มีอะไรฟ้องเลย
 */
function plrFieldChoices() {
  function opts(name, valueKey, labelKey) {
    return centralObjects(name).map(function(r) {
      return { value: String(r[valueKey]), label: String(r[labelKey] || r[valueKey]) };
    });
  }
  return {
    group_id:   opts('customer_groups', 'record_id', 'name'),
    channel_id: opts('distribution_channels', 'record_id', 'name'),
    tenant_id:  centralObjects('tenants').filter(function(t) { return isNotOff(t.is_active); })
                  .map(function(t) { return { value: String(t.tenant_id), label: String(t.name || t.tenant_id) }; }),
    member_of_list: centralObjects('customer_lists').map(function(l) {
      return { value: String(l.record_id), label: String(l.name) + (l.tenant_id ? ' (' + l.tenant_id + ')' : ' (ของบริษัท)') };
    }),
    sales_mode: [{ value: 'van', label: 'ขายหน้ารถ (van)' }, { value: 'preorder', label: 'พรีออเดอร์ (preorder)' }],
    payment_type: [{ value: 'cash', label: 'เงินสด' }, { value: 'credit', label: 'เครดิต' }],
    status:     [{ value: 'active', label: 'ใช้งาน' }, { value: 'inactive', label: 'ปิดใช้งาน' }]
  };
}

/**
 * คีย์ใน customers.attributes ที่ "มีอยู่จริงในข้อมูล" — เพื่อให้หน้าเว็บเสนอเป็นตัวเลือกได้
 * ข้อมูลที่ยกมาจากระบบเดิมอยู่ในนี้ทั้งหมด (sourceGroupCode, sourceShopType, sourceProvCode …)
 * ถ้าไม่เสนอให้เลือก คนตั้งค่าต้องเดาชื่อคีย์เอง พิมพ์ผิดตัวเดียวกฎก็เงียบ
 * @return [{ key, count, samples:[..] }] เรียงตามจำนวนที่พบมากไปน้อย
 */
function plrAttrKeys(rows) {
  var found = {};
  (rows || centralObjects('customers')).forEach(function(c) {
    var a = customerAttributes(c);
    Object.keys(a).forEach(function(k) {
      var v = a[k]; if (v === '' || v === null || v === undefined) return;
      var f = found[k] || (found[k] = { key: 'attr:' + k, count: 0, seen: {} });
      f.count++;
      if (Object.keys(f.seen).length < 8) f.seen[String(v)] = 1;
    });
  });
  return Object.keys(found).map(function(k) {
    return { key: found[k].key, count: found[k].count, samples: Object.keys(found[k].seen).sort() };
  }).sort(function(a, b) { return b.count - a.count; });
}

/** ชุดข้อมูลที่หน้าจอตั้งเงื่อนไขต้องใช้ (ใช้ร่วมกันทั้งหน้ากฎสิทธิ์และหน้าจัดกลุ่มลูกค้าเป็นชุด) */
function plrMeta(rows) {
  return { fields: PLR_FIELDS, ops: PLR_OPS, choices: plrFieldChoices(), attrKeys: plrAttrKeys(rows) };
}

/* ═══════════════ หน้าจอตั้งค่า (ฝั่งบริษัทเจ้าของสินค้าเท่านั้น) ═══════════════ */

/** รายการกฎของชุดราคาหนึ่งชุด + ตัวเลือกที่หน้าเว็บต้องใช้ */
function listPriceListRules(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  payload = payload || {};
  var listId = String(payload.priceListId || '');
  var target = String(payload.targetType || PLR_TARGET_PRICE_LIST);
  var conds = {};
  centralObjects('price_list_rule_conditions').forEach(function(c) {
    (conds[String(c.rule_id)] = conds[String(c.rule_id)] || []).push({
      id: c.record_id, field: c.field, op: c.op, value: c.value });
  });
  var pkgType = target === PLR_TARGET_PROMO ? PKG_PROMO : target === PLR_TARGET_FREE_GOODS ? 'free_goods' : PKG_PRICE_LIST, pkgIdx = packageTenantIndex();
  var rules = centralObjects('price_list_rules')
    .filter(function(r) { return plrTargetOf(r) === target && (!listId || String(r.price_list_id) === listId) && _pkgVisible(session, pkgType, r.price_list_id, pkgIdx); })
    .sort(function(a, b) { return (Number(b.priority) || 0) - (Number(a.priority) || 0); })
    .map(function(r) { return {
      id: r.record_id, targetType: plrTargetOf(r), priceListId: r.price_list_id, name: r.name || '', matchType: r.match_type || PLR_MATCH_ALL,
      priority: Number(r.priority) || 0, isActive: isNotOff(r.is_active), note: r.note || '',
      conditions: conds[String(r.record_id)] || [] }; });
  var meta = plrMeta();
  return { success: true, data: rules, fields: meta.fields, ops: meta.ops,
    choices: meta.choices, attrKeys: meta.attrKeys };
}

/**
 * บันทึกกฎ (สร้างใหม่ถ้าไม่ส่ง id) — payload:
 *   { id?, priceListId, name, matchType, priority, isActive, note, conditions:[{field,op,value}] }
 * เงื่อนไขเขียนทับทั้งชุดทุกครั้ง (แก้ทีละเงื่อนไขแล้วสถานะครึ่งๆ กลางๆ หาบั๊กยากกว่า)
 */
function savePriceListRule(session, payload) {
  var err = _requirePermission(session, 'pricing', 'edit'); if (err) return err;
  payload = payload || {};
  var target = String(payload.targetType || PLR_TARGET_PRICE_LIST);
  if ([PLR_TARGET_PRICE_LIST, PLR_TARGET_PROMO, PLR_TARGET_FREE_GOODS].indexOf(target) === -1) return { success: false, message: 'ชนิดเป้าหมายไม่ถูกต้อง' };
  var listId = String(payload.priceListId || '').trim();
  var what = target === PLR_TARGET_PROMO ? 'โปรโมชั่น' : target === PLR_TARGET_FREE_GOODS ? 'ชุดแถม' : 'ชุดราคา';
  if (!listId) return { success: false, message: 'ไม่ได้ระบุ' + what };
  var list = null;
  var targetSheet = target === PLR_TARGET_PROMO ? 'discount_rules'
                  : target === PLR_TARGET_FREE_GOODS ? 'free_goods_sets' : 'price_lists';
  centralObjects(targetSheet).forEach(function(l) { if (String(l.record_id) === listId) list = l; });
  if (!list) return { success: false, message: 'ไม่พบ' + what + 'นี้' };

  var conds = (payload.conditions || []).map(function(c) {
    return { field: String(c.field || '').trim(), op: String(c.op || 'eq').trim(), value: String(c.value === undefined ? '' : c.value).trim() };
  }).filter(function(c) { return c.field; });
  if (!conds.length) return { success: false, message: 'กฎต้องมีเงื่อนไขอย่างน้อยหนึ่งข้อ' };
  for (var i = 0; i < conds.length; i++) {
    var f = conds[i].field;
    if (f.indexOf('attr:') !== 0 && !PLR_FIELDS[f]) return { success: false, message: 'คุณลักษณะที่ไม่รองรับ: ' + f };
    if (!PLR_OPS[conds[i].op]) return { success: false, message: 'ตัวดำเนินการที่ไม่รองรับ: ' + conds[i].op };
    if (['empty', 'notempty'].indexOf(conds[i].op) === -1 && conds[i].value === '') {
      return { success: false, message: 'เงื่อนไข "' + f + '" ต้องระบุค่าที่จะเทียบ' };
    }
  }

  return _withDocLock(function() {
    var ruleId = payload.id ? String(payload.id) : '';
    var fields = {
      target_type: target,
      price_list_id: listId, name: String(payload.name || '').trim(),
      match_type: String(payload.matchType) === PLR_MATCH_ANY ? PLR_MATCH_ANY : PLR_MATCH_ALL,
      priority: Number(payload.priority) || 0,
      is_active: payload.isActive === false ? 'FALSE' : 'TRUE',
      note: String(payload.note || '').trim()
    };
    if (ruleId) {
      var exists = false;
      centralObjects('price_list_rules').forEach(function(r) { if (String(r.record_id) === ruleId) exists = true; });
      if (!exists) return { success: false, message: 'ไม่พบกฎนี้' };
      centralUpdate('price_list_rules', ruleId, fields);
      deleteRowsWhere(centralSheet('price_list_rule_conditions'), 'rule_id', ruleId);
      centralInvalidate('price_list_rule_conditions');
    } else {
      ruleId = centralNextId('price_list_rules');
      fields.record_id = ruleId;
      fields.created_at = nowStr();
      fields.created_by = String(session.adminUserId || '');
      centralAppend('price_list_rules', fields);
    }
    var nextId = centralNextId('price_list_rule_conditions');
    centralAppendMany('price_list_rule_conditions', conds.map(function(c) {
      return { record_id: nextId++, rule_id: ruleId, field: c.field, op: c.op, value: c.value };
    }));
    var res = listPriceListRules(session, { priceListId: listId, targetType: target });
    res.message = 'บันทึกกฎสิทธิ์แล้ว';
    res.ruleId = ruleId;
    return res;
  });
}

function deletePriceListRule(session, payload) {
  var err = _requirePermission(session, 'pricing', 'edit'); if (err) return err;
  payload = payload || {};
  var ruleId = String(payload.id || '');
  if (!ruleId) return { success: false, message: 'ไม่ได้ระบุกฎ' };
  var listId = '', target = PLR_TARGET_PRICE_LIST;
  centralObjects('price_list_rules').forEach(function(r) {
    if (String(r.record_id) !== ruleId) return;
    listId = String(r.price_list_id); target = plrTargetOf(r);
  });
  if (!listId) return { success: false, message: 'ไม่พบกฎนี้' };
  return _withDocLock(function() {
    deleteRowsWhere(centralSheet('price_list_rule_conditions'), 'rule_id', ruleId);
    deleteRowsWhere(centralSheet('price_list_rules'), 'record_id', ruleId);
    centralInvalidate('price_list_rule_conditions');
    centralInvalidate('price_list_rules');
    var res = listPriceListRules(session, { priceListId: listId, targetType: target });
    res.message = 'ลบกฎแล้ว';
    return res;
  });
}

/**
 * ★ เครื่องมือช่วยตั้งค่า: กฎชุดนี้จะครอบคลุมร้านกี่ร้าน และร้านไหนบ้าง
 * ต้องดูก่อนกดใช้งานเสมอ — กฎที่กว้างเกินไปจะไปทับราคาของร้านที่ไม่ได้ตั้งใจ
 * และกว่าจะรู้ก็ตอนออกบิลผิดราคาไปแล้ว
 * payload: { conditions:[], matchType, tenantId?, limit? }
 */
function previewPriceListAudience(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  payload = payload || {};
  var conds = (payload.conditions || []).filter(function(c) { return c && c.field; });
  if (!conds.length) return { success: false, message: 'ยังไม่มีเงื่อนไขให้ทดลอง' };
  var rule = { match_type: payload.matchType === PLR_MATCH_ANY ? PLR_MATCH_ANY : PLR_MATCH_ALL };
  var limit = parseInt(payload.limit) || 25;

  var customers = centralObjects('customers').filter(function(c) { return isNotOff(c.is_active); });
  var mine = _myTenantOnly(session);   // ฝั่งตัวแทนทดลองได้เฉพาะร้านของตัวเอง
  if (mine !== null) payload.tenantId = mine;
  if (payload.tenantId) customers = customers.filter(function(c) { return String(c.tenant_id) === String(payload.tenantId); });

  var matched = customers.filter(function(c) { return plrRuleMatches(c, rule, conds); });
  var byTenant = {};
  matched.forEach(function(c) { byTenant[String(c.tenant_id || '(บริษัท)')] = (byTenant[String(c.tenant_id || '(บริษัท)')] || 0) + 1; });

  return { success: true, total: customers.length, matched: matched.length, byTenant: byTenant,
    sample: matched.slice(0, limit).map(function(c) { return {
      id: c.record_id, code: c.customer_code || '', name: customerFullName(c),
      tenantId: c.tenant_id || '', groupId: c.group_id, channelId: c.channel_id || '', areaCode: c.area_code || '' }; }),
    message: 'เข้าเงื่อนไข ' + matched.length + ' ร้าน จากทั้งหมด ' + customers.length + ' ร้าน' };
}

/**
 * ★ เครื่องมือช่วยตรวจ: ร้านนี้ได้ชุดราคาไหน เพราะกฎข้อไหน และมีชุดไหนแข่งอยู่บ้าง
 * ตอบคำถาม "ทำไมร้านนี้ได้ราคานี้" ได้ในหน้าจอเดียว แทนที่จะต้องไปไล่เดาเอง
 */
function explainCustomerPricing(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  payload = payload || {};
  var cust = plrCustomerRow(payload.customerId);
  if (!cust || (_myTenantOnly(session) !== null && String(cust.tenant_id) !== _myTenantOnly(session))) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
  var today = payload.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var rulesByList = plrRulesByList();
  var pkgIdx = packageTenantIndex();
  var candidates = [];

  centralObjects('price_lists').forEach(function(l) {
    var active = String(l.status) === 'active';
    var inDate = !(_dOnly(l.valid_from) > today || _dOnly(l.valid_to) < today);
    var given = packageAllowedForTenant(pkgIdx, PKG_PRICE_LIST, l.record_id, cust.tenant_id);
    var rules = rulesByList[String(l.record_id)] || [];
    var hit = null, why = '';
    if (rules.length) {
      rules.forEach(function(r) {
        if (!plrRuleMatches(cust, r.rule, r.conditions)) return;
        var pri = Number(r.rule.priority) || 0;
        if (!hit || pri > hit) { hit = pri; why = r.rule.name || ('กฎ #' + r.rule.record_id); }
      });
    } else if (String(cust.group_id || '') === String(l.customer_group_id || '') && l.customer_group_id !== '') {
      hit = 0; why = 'กลุ่มลูกค้าของชุดราคา (แบบเดิม)';
    }
    if (hit === null) return;
    candidates.push({ priceListId: l.record_id, name: l.name, priority: hit, reason: why,
      status: l.status, validFrom: _dOnly(l.valid_from), validTo: _dOnly(l.valid_to),
      usable: active && inDate && given,
      blockedBy: !given ? ('ยังไม่ได้จ่ายชุดนี้ให้ตัวแทน ' + (cust.tenant_id || '(บริษัท)'))
                : !active ? ('สถานะ: ' + l.status) : (!inDate ? 'นอกช่วงวันที่' : '') });
  });

  var winner = resolvePriceListForCustomer(cust, today);
  return { success: true,
    customer: { id: cust.record_id, code: cust.customer_code || '', name: customerFullName(cust),
      groupId: cust.group_id, channelId: cust.channel_id || '', areaCode: cust.area_code || '',
      salesMode: cust.sales_mode || '', paymentType: cust.payment_type || '', tenantId: cust.tenant_id || '' },
    date: today,
    candidates: candidates.sort(function(a, b) { return b.priority - a.priority; }),
    winner: winner ? { priceListId: winner.list.record_id, name: winner.list.name, priority: winner.priority, reason: winner.reason } : null,
    message: winner ? ('ได้ชุดราคา "' + winner.list.name + '" (' + winner.reason + ')')
                    : 'ไม่เข้าเงื่อนไขชุดราคาไหนเลย — จะใช้โปรโมชั่นแบบเดิม (discount_rules)' };
}
