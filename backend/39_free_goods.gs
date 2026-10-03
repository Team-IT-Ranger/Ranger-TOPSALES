/**
 * ===================== ชุดแถม (free goods) =====================
 * เจ้าของระบบสั่งทำ 27 ก.ย. 2026 หลังพบว่า **ใบอนุมัติโปรโมชั่น Jul-Sep'26 ทั้งใบเป็นของแถมล้วน**
 * (ซื้อ 12 ลัง FOC 1 ลัง · ซื้อ 6 ลัง FOC 6 แพ็ค ฯลฯ) — ไม่มีส่วนลดบนบิลสักรายการ
 * เรื่องนี้เคยถูกพักไว้ ("ทำส่วนลดให้เสร็จก่อน") จนกลายเป็นตัวปิดกั้นการใช้งานจริงทั้งไตรมาส
 *
 * ★ ทำเป็น "ชุด" แยกจากชุดราคา ไม่ใช่คอลัมน์ในชุดราคา — เพราะ
 *   1. ช่วงเวลาไม่ตรงกัน ใบอนุมัติจริงมี FOC 1-31 ก.ค. ขณะที่ชุดราคาเป็นงวด ก.ค.-ก.ย.
 *   2. ของแถมถูกยกเลิก/ต่ออายุระหว่างงวดเป็นปกติ ถ้าฝังในชุดราคาจะต้องคัดลอกชุดราคาใหม่ทุกครั้ง
 *   3. ชุดแถมจ่ายให้ตัวแทนคนละชุดกับชุดราคาได้ (ใช้ package_tenants + กฎสิทธิ์ตัวเดียวกัน)
 *
 * ★ "ขั้น" ของการแถม (free_goods_items) จัดกลุ่มด้วย tier_group
 *   ใบอนุมัติเขียนว่า "ซื้อ 12 ลัง FOC 1 ลัง · ซื้อ 6 ลัง FOC 6 แพ็ค · ซื้อ 1 ลัง FOC 1 แพ็ค"
 *   = กลไกเดียวสามขั้น ไม่ใช่สามโปรที่ได้พร้อมกัน — **เลือกขั้นสูงสุดที่ถึงเพียงขั้นเดียว**
 *   ถ้าปล่อยให้ทุกขั้นทำงาน ซื้อ 12 ลังจะได้ทั้ง 1 ลัง + 6 แพ็ค + 1 แพ็ค ซึ่งไม่ใช่ที่อนุมัติ
 *   และเป็นของฟรีที่บริษัทเสียไปโดยไม่มีใครสังเกต
 */

var FG_STATUS_DRAFT = 'draft', FG_STATUS_ACTIVE = 'active', FG_STATUS_ARCHIVED = 'archived';
var PKG_FREE_GOODS = 'free_goods';

/** ชุดแถมที่ใช้ได้ ณ วันที่นั้น และร้านรายนี้มีสิทธิ์ (ผ่านการจ่ายชุดให้ตัวแทน + กฎสิทธิ์) */
function freeGoodsSetsForCustomer(customer, dateStr) {
  if (!customer) return [];
  var today = dateStr || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var pkgIdx = packageTenantIndex();
  var rulesByTarget = plrRulesByTarget(PLR_TARGET_FREE_GOODS);
  var custGroupId = String(customer.group_id || '');

  return centralObjects('free_goods_sets').filter(function(s) {
    if (String(s.status) !== FG_STATUS_ACTIVE) return false;
    if (_dOnly(s.valid_from) > today || (_dOnly(s.valid_to) && _dOnly(s.valid_to) < today)) return false;
    if (!packageAllowedForTenant(pkgIdx, PKG_FREE_GOODS, s.record_id, customer.tenant_id)) return false;
    var own = rulesByTarget[String(s.record_id)] || [];
    if (own.length) {
      for (var i = 0; i < own.length; i++) {
        if (plrRuleMatches(customer, own[i].rule, own[i].conditions)) return true;
      }
      return false;    // ตั้งกฎไว้แล้วไม่เข้าสักข้อ = ไม่ได้
    }
    // ไม่ตั้งกฎ = ใช้กลุ่มลูกค้าของชุด (ว่าง = ทุกกลุ่มของตัวแทนที่ได้รับชุดนี้)
    return String(s.customer_group_id || '') === '' || String(s.customer_group_id) === custGroupId;
  });
}

/** บรรทัดของชุดแถม จัดกลุ่มตาม set */
function _fgItemsBySet() {
  var out = {};
  centralObjects('free_goods_items').forEach(function(it) {
    (out[String(it.set_id)] = out[String(it.set_id)] || []).push(it);
  });
  return out;
}

function _fgIdList(v) {
  return String(v == null ? '' : v).split(',').map(function(x) { return parseInt(String(x).trim()); })
    .filter(function(n) { return n > 0; });
}

/**
 * คิดของแถมจากตะกร้า
 * @param cartLines [{ productId, groupId, qty, unitCode }] — qty ในหน่วยที่สั่ง (ลัง/แพ็ค/ชิ้น)
 * @param sets      ผลจาก freeGoodsSetsForCustomer()
 * @param unitBase  function(productId, unitCode) -> จำนวนหน่วยฐานต่อ 1 หน่วยนั้น (สำหรับแปลงของแถมเป็นหน่วยฐาน)
 * @return [{ setId, setName, tierGroup, itemId, productId, unitCode, qty, baseQty, reason }]
 */
function computeFreeGoods(cartLines, sets, unitBase) {
  if (!sets || !sets.length) return [];
  var itemsBySet = _fgItemsBySet();
  var out = [];

  sets.forEach(function(s) {
    var rows = (itemsBySet[String(s.record_id)] || []).filter(function(r) { return isNotOff(r.is_active); });
    // จัดขั้นเข้ากลุ่ม — กลุ่มเดียวกัน = กลไกเดียวกัน เลือกได้ขั้นเดียว
    var byGroup = {};
    rows.forEach(function(r) {
      var g = String(r.tier_group || r.record_id);
      (byGroup[g] = byGroup[g] || []).push(r);
    });

    Object.keys(byGroup).forEach(function(g) {
      var tiers = byGroup[g];
      // จำนวนที่เข้าเงื่อนไขของกลไกนี้ (นับตามหน่วยที่ขั้นระบุ เช่น "ซื้อ 12 ลัง" นับเฉพาะลัง)
      var best = null;
      tiers.forEach(function(t) {
        var pids = _fgIdList(t.trigger_product_ids), gids = _fgIdList(t.trigger_group_ids);
        var wantUnit = normUnitCode(t.min_unit_code, UNIT_CT);
        var qty = 0;
        cartLines.forEach(function(l) {
          if (normUnitCode(l.unitCode, UNIT_CT) !== wantUnit) return;
          var hit = pids.length ? pids.indexOf(Number(l.productId)) !== -1
                  : gids.length ? gids.indexOf(Number(l.groupId)) !== -1
                  : false;                                  // ไม่ระบุสินค้าเลย = ไม่เข้าเงื่อนไข (กันแถมมั่ว)
          if (hit) qty += Number(l.qty) || 0;
        });
        var min = Number(t.min_qty) || 0;
        if (min <= 0 || qty < min) return;
        var times = Math.floor(qty / min);
        if (times <= 0) return;
        // ★ ขั้นสูงสุดที่ถึง ชนะ — เทียบด้วย min_qty ไม่ใช่จำนวนของแถม เพราะขั้นที่ซื้อเยอะกว่าคือขั้นที่ดีกว่าเสมอ
        if (!best || min > best.min) best = { tier: t, min: min, times: times, qty: qty };
      });
      if (!best) return;

      var t = best.tier;
      var freeUnit = normUnitCode(t.free_unit_code, UNIT_PC);
      var freeQty = (Number(t.free_qty) || 0) * best.times;
      if (freeQty <= 0) return;
      var factor = unitBase ? (Number(unitBase(t.free_product_id, freeUnit)) || 1) : 1;
      out.push({
        setId: s.record_id, setName: s.name, tierGroup: g, itemId: t.record_id,
        productId: t.free_product_id, unitCode: freeUnit, qty: freeQty, baseQty: freeQty * factor,
        reason: (t.note || s.name) + ' (ซื้อครบ ' + best.min + ' ' + unitLabelOf(normUnitCode(t.min_unit_code, UNIT_CT)) +
          (best.times > 1 ? ' × ' + best.times : '') + ')'
      });
    });
  });
  return out;
}

/* ═══════════════ หน้าจอ (ฝั่งบริษัทเจ้าของสินค้า) ═══════════════ */

function listFreeGoodsSets(session, payload) {
  var err = _requirePermission(session, 'promotions', 'view'); if (err) return err;
  var itemsBySet = _fgItemsBySet(), pkgIdx = packageTenantIndex();
  var data = centralObjects('free_goods_sets').filter(function(s) { return _pkgVisible(session, 'free_goods', s.record_id, pkgIdx); }).map(function(s) {
    return { id: s.record_id, name: s.name, status: s.status || FG_STATUS_DRAFT,
      validFrom: _dOnly(s.valid_from), validTo: _dOnly(s.valid_to),
      customerGroupId: s.customer_group_id || '', note: s.note || '',
      tierCount: (itemsBySet[String(s.record_id)] || []).length,
      tenants: _pkgTenantsFor(session, PKG_FREE_GOODS, s.record_id) };
  });
  return { success: true, data: data };
}

function getFreeGoodsSet(session, payload) {
  var err = _requirePermission(session, 'promotions', 'view'); if (err) return err;
  payload = payload || {};
  var set = null;
  centralObjects('free_goods_sets').forEach(function(s) { if (String(s.record_id) === String(payload.id)) set = s; });
  if (!set || !_pkgVisible(session, 'free_goods', set.record_id)) return { success: false, message: 'ไม่พบชุดแถมนี้' };
  var items = (_fgItemsBySet()[String(set.record_id)] || []).map(function(it) {
    return { id: it.record_id, tierGroup: it.tier_group || '', note: it.note || '',
      triggerProductIds: _fgIdList(it.trigger_product_ids), triggerGroupIds: _fgIdList(it.trigger_group_ids),
      minQty: Number(it.min_qty) || 0, minUnitCode: normUnitCode(it.min_unit_code, UNIT_CT),
      freeProductId: it.free_product_id, freeQty: Number(it.free_qty) || 0,
      freeUnitCode: normUnitCode(it.free_unit_code, UNIT_PC), isActive: isNotOff(it.is_active) };
  });
  return { success: true,
    set: { id: set.record_id, name: set.name, status: set.status || FG_STATUS_DRAFT,
      validFrom: _dOnly(set.valid_from), validTo: _dOnly(set.valid_to),
      customerGroupId: set.customer_group_id || '', note: set.note || '' },
    items: items, tenants: _pkgTenantsFor(session, PKG_FREE_GOODS, set.record_id) };
}

function saveFreeGoodsSet(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  payload = payload || {};
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'ต้องตั้งชื่อชุดแถม' };
  var fields = {
    name: name, status: payload.status || FG_STATUS_DRAFT,
    valid_from: _dOnly(payload.validFrom), valid_to: _dOnly(payload.validTo),
    customer_group_id: payload.customerGroupId === undefined || payload.customerGroupId === null ? '' : String(payload.customerGroupId),
    note: String(payload.note || '').trim()
  };
  if (payload.id) {
    var found = false;
    centralObjects('free_goods_sets').forEach(function(s) { if (String(s.record_id) === String(payload.id)) found = true; });
    if (!found) return { success: false, message: 'ไม่พบชุดแถมนี้' };
    centralUpdate('free_goods_sets', payload.id, fields);
    return { success: true, id: payload.id, message: 'บันทึกชุดแถมแล้ว' };
  }
  fields.record_id = centralNextId('free_goods_sets');
  fields.created_at = nowStr();
  fields.created_by = String(session.adminUserId || '');
  centralAppend('free_goods_sets', fields);
  return { success: true, id: fields.record_id, message: 'สร้างชุดแถม "' + name + '" แล้ว' };
}

function setFreeGoodsSetStatus(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  payload = payload || {};
  var want = String(payload.status || '');
  if ([FG_STATUS_DRAFT, FG_STATUS_ACTIVE, FG_STATUS_ARCHIVED].indexOf(want) === -1) return { success: false, message: 'สถานะไม่ถูกต้อง' };
  centralUpdate('free_goods_sets', payload.id, { status: want });
  return { success: true, message: 'เปลี่ยนสถานะเป็น ' + want + ' แล้ว' };
}

/** บันทึกขั้นการแถมทีละบรรทัด (ไม่ส่ง id = เพิ่มใหม่) */
function saveFreeGoodsItem(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  payload = payload || {};
  var setId = String(payload.setId || '');
  var set = null;
  centralObjects('free_goods_sets').forEach(function(s) { if (String(s.record_id) === setId) set = s; });
  if (!set) return { success: false, message: 'ไม่พบชุดแถมนี้' };
  if (String(set.status) === FG_STATUS_ARCHIVED) return { success: false, message: 'ชุดที่เก็บถาวรแล้วแก้ไม่ได้' };

  var pids = _fgIdList((payload.triggerProductIds || []).join(','));
  var gids = _fgIdList((payload.triggerGroupIds || []).join(','));
  if (!pids.length && !gids.length) return { success: false, message: 'ต้องระบุสินค้าที่ต้องซื้อ (รายการสินค้า หรือกลุ่มสินค้า)' };
  if (!(Number(payload.minQty) > 0)) return { success: false, message: 'จำนวนที่ต้องซื้อต้องมากกว่า 0' };
  if (!payload.freeProductId) return { success: false, message: 'ต้องระบุสินค้าที่จะแถม' };
  if (!(Number(payload.freeQty) > 0)) return { success: false, message: 'จำนวนที่แถมต้องมากกว่า 0' };

  var fields = {
    set_id: setId, tier_group: String(payload.tierGroup || '').trim(),
    trigger_product_ids: pids.join(','), trigger_group_ids: gids.join(','),
    min_qty: Number(payload.minQty), min_unit_code: normUnitCode(payload.minUnitCode, UNIT_CT),
    free_product_id: String(payload.freeProductId),
    free_qty: Number(payload.freeQty), free_unit_code: normUnitCode(payload.freeUnitCode, UNIT_PC),
    note: String(payload.note || '').trim(), is_active: payload.isActive === false ? 'FALSE' : 'TRUE'
  };
  if (payload.id) {
    centralUpdate('free_goods_items', payload.id, fields);
  } else {
    fields.record_id = centralNextId('free_goods_items');
    centralAppend('free_goods_items', fields);
  }
  return getFreeGoodsSet(session, { id: setId });
}

function deleteFreeGoodsItem(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  payload = payload || {};
  var setId = '';
  centralObjects('free_goods_items').forEach(function(it) { if (String(it.record_id) === String(payload.id)) setId = String(it.set_id); });
  if (!setId) return { success: false, message: 'ไม่พบบรรทัดนี้' };
  deleteRowsWhere(centralSheet('free_goods_items'), 'record_id', payload.id);
  centralInvalidate('free_goods_items');
  return getFreeGoodsSet(session, { id: setId });
}

/** ทดลองดูว่าร้านนี้จะได้แถมอะไร จากตะกร้าที่กรอก — ตรวจก่อนเปิดใช้ชุดแถม */
function previewFreeGoods(session, payload) {
  var err = _requirePermission(session, 'promotions', 'view'); if (err) return err;
  payload = payload || {};
  var cust = plrCustomerRow(payload.customerId);
  if (!cust) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
  var sets = freeGoodsSetsForCustomer(cust, payload.date);
  var products = centralObjects('products');
  var pname = {}; products.forEach(function(p) { pname[String(p.record_id)] = p.name; });
  var lines = (payload.items || []).map(function(it) {
    var p = null;
    products.forEach(function(x) { if (String(x.record_id) === String(it.productId)) p = x; });
    return { productId: it.productId, groupId: p ? parseInt(p.group_id) || 0 : 0, qty: it.qty, unitCode: it.unitCode };
  });
  var got = computeFreeGoods(lines, sets, _fgUnitBaseFn());
  return { success: true,
    sets: sets.map(function(s) { return { id: s.record_id, name: s.name }; }),
    freeGoods: got.map(function(f) {
      return { productId: f.productId, name: pname[String(f.productId)] || ('#' + f.productId),
        qty: f.qty, unitCode: f.unitCode, unitLabel: unitLabelOf(f.unitCode), baseQty: f.baseQty,
        setName: f.setName, reason: f.reason };
    }),
    message: got.length ? 'ได้ของแถม ' + got.length + ' รายการ'
      : (sets.length ? 'ร้านนี้มีสิทธิ์ใช้ชุดแถม ' + sets.length + ' ชุด แต่ตะกร้านี้ยังไม่ถึงขั้นไหน'
                     : 'ร้านนี้ยังไม่มีชุดแถมที่ใช้ได้ — ตรวจว่าจ่ายชุดให้ตัวแทนแล้วหรือยัง และชุดเปิดใช้งานหรือยัง') };
}

/** ตัวแปลงหน่วย → หน่วยฐาน สำหรับของแถม (อ่าน product_units ครั้งเดียว) */
function _fgUnitBaseFn() {
  var map = {};
  centralObjects('product_units').forEach(function(u) {
    map[String(u.product_id) + '_' + normUnitCode(u.unit_code, '')] = Number(u.unit_factor) || 1;
  });
  return function(productId, unitCode) {
    var code = normUnitCode(unitCode, UNIT_PC);
    if (isBaseUnit(code)) return 1;
    return map[String(productId) + '_' + code] || 1;
  };
}
