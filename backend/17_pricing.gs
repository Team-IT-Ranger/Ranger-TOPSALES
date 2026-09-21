/**
 * ===================== ชุดราคาและส่วนลด (ใบรายการขายตามกลุ่มลูกค้า × ช่วงเวลา) =====================
 * 1 ชุดราคา (price_lists) = 1 กลุ่มลูกค้า (customer_groups) × 1 ช่วงเวลา (เช่น ไตรมาส) — ลูกค้า 1 ร้านอยู่ได้ชุดเดียวตามกลุ่มของร้าน
 * รายการราคา (price_list_items) = ขั้นราคา ต่อสินค้า ต่อหน่วยขาย (CASE=หีบ / PACK=แพ็ค)
 *   - ราคาสุทธิรวม VAT เป็นตัวตั้งที่คนกรอก ส่วน % ส่วนลดเป็นค่าที่คำนวณเอา (ตรงกับไฟล์ใบรายการขายของบริษัท)
 *   - ขั้นบันไดนับ "จำนวนหีบของ line เดียวกัน" (สินค้าที่ใช้ตารางขั้นร่วมกัน เช่น แซนดัลวูด+ลาเวนเดอร์)
 *   - PACK (แพ็ค) มี van_only=TRUE = ขายได้เฉพาะ Cash Van และจ่ายเงินสด
 * โปรระดับบิล (price_list_bill_promos): ยอดรวมทั้งบิล (ไม่รวม VAT) ครบเท่าไหร่ ลดเพิ่ม % — ใช้ขั้นสูงสุดที่ถึงเงื่อนไขเพียงขั้นเดียว
 * ของแถม: ยังไม่ทำ (ทำหลังจากส่วนลดเสร็จ)
 */
var PRICE_STATUSES = ['draft', 'active', 'archived'];

function _dOnly(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '').substring(0, 10);
}
function _validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function _numOrBlank(v) { if (v === null || v === undefined || v === '') return ''; var n = Number(v); return isFinite(n) ? n : ''; }
function _isTrue(v) { return v === true || String(v) === 'TRUE' || String(v) === 'true'; }

function _priceListDto(l, groupName, itemCount, lineCount) {
  return {
    id: l.record_id, name: l.name, customerGroupId: l.customer_group_id, customerGroupName: groupName || '',
    validFrom: _dOnly(l.valid_from), validTo: _dOnly(l.valid_to), status: l.status, sourceFile: l.source_file || '',
    note: l.note || '', createdAt: safeDateStr(l.created_at), activatedAt: safeDateStr(l.activated_at),
    itemCount: itemCount || 0, lineCount: lineCount || 0
  };
}

function listPriceLists(session) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  var groups = {}; centralObjects('customer_groups').forEach(function(g) { groups[String(g.record_id)] = g.name; });
  var itemCount = {}, lineSets = {};
  centralObjects('price_list_items').forEach(function(it) {
    var k = String(it.price_list_id);
    itemCount[k] = (itemCount[k] || 0) + 1;
    (lineSets[k] = lineSets[k] || {})[String(it.line_id)] = true;
  });
  var out = centralObjects('price_lists').map(function(l) {
    var k = String(l.record_id);
    return _priceListDto(l, groups[String(l.customer_group_id)], itemCount[k], Object.keys(lineSets[k] || {}).length);
  });
  out.sort(function(a, b) { return String(b.validFrom).localeCompare(String(a.validFrom)) || (b.id - a.id); });
  return { success: true, data: out };
}

// payload: { id } → { list, lines:[{lineId, products:[{productId,productCode,name}], caseFactor, listExVat, tiers:[], packs:[], suggestedPack, retailPiece}], billPromos }
function getPriceList(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  var list = null;
  centralObjects('price_lists').forEach(function(l) { if (String(l.record_id) === String(payload.id)) list = l; });
  if (!list) return { success: false, message: 'ไม่พบชุดราคานี้' };
  var groupName = '';
  centralObjects('customer_groups').forEach(function(g) { if (String(g.record_id) === String(list.customer_group_id)) groupName = g.name; });
  var products = {}; centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  var lines = {}, order = [];
  centralObjects('price_list_items').forEach(function(it) {
    if (String(it.price_list_id) !== String(list.record_id)) return;
    var key = String(it.line_id);
    if (!lines[key]) { lines[key] = { lineId: it.line_id, products: {}, caseFactor: null, listExVat: null, tiers: [], packs: [], suggestedPack: null, retailPiece: null, _seen: {} }; order.push(key); }
    var ln = lines[key], pid = String(it.product_id), p = products[pid];
    if (!ln.products[pid]) ln.products[pid] = { productId: it.product_id, productCode: p ? p.product_code : '', name: p ? p.name : '(สินค้าถูกลบ)' };
    // ขั้นราคาเก็บซ้ำต่อสินค้าใน line เดียวกัน (เพื่อให้เครื่องยนต์หาตาม product_id ได้ทันที) — แสดงผลใช้ชุดของสินค้าตัวแรกเท่านั้น
    var firstPid = Object.keys(ln.products)[0];
    if (pid !== firstPid) return;
    var row = { unitCode: it.unit_code, unitFactor: it.unit_factor, min: it.min_qty, max: it.max_qty === '' ? null : it.max_qty,
                cashInclVat: it.cash_price_incl_vat === '' ? null : it.cash_price_incl_vat,
                creditInclVat: it.credit_price_incl_vat === '' ? null : it.credit_price_incl_vat,
                listExVat: it.list_price_ex_vat === '' ? null : it.list_price_ex_vat, vanOnly: _isTrue(it.van_only), label: it.tier_label || '' };
    if (it.unit_code === 'CASE') { ln.tiers.push(row); ln.caseFactor = it.unit_factor; ln.listExVat = row.listExVat; if (it.suggested_price !== '') ln.suggestedPack = it.suggested_price; if (it.retail_price !== '') ln.retailPiece = it.retail_price; }
    else ln.packs.push(row);
  });
  var outLines = order.map(function(k) {
    var ln = lines[k]; ln.products = Object.keys(ln.products).map(function(x) { return ln.products[x]; }); delete ln._seen;
    ln.tiers.sort(function(a, b) { return a.min - b.min; });
    return ln;
  });
  var promos = centralObjects('price_list_bill_promos').filter(function(b) { return String(b.price_list_id) === String(list.record_id); })
    .map(function(b) { return { minAmountExVat: b.min_amount_ex_vat, percent: b.percent }; })
    .sort(function(a, b) { return a.minAmountExVat - b.minAmountExVat; });
  return { success: true, list: _priceListDto(list, groupName, 0, outLines.length), lines: outLines, billPromos: promos };
}

function _resolveCustomerGroup(payload) {
  var groups = centralObjects('customer_groups');
  if (payload.customerGroupId) {
    for (var i = 0; i < groups.length; i++) if (String(groups[i].record_id) === String(payload.customerGroupId)) return { id: groups[i].record_id, created: false };
    return null;
  }
  var name = String(payload.customerGroupName || '').trim();
  if (!name) return null;
  for (var j = 0; j < groups.length; j++) if (String(groups[j].name).trim().toLowerCase() === name.toLowerCase()) return { id: groups[j].record_id, created: false };
  var id = centralNextId('customer_groups');
  centralAppend('customer_groups', { record_id: id, name: name, description: 'สร้างจากการนำเข้าใบราคา' });
  return { id: id, created: true };
}

/**
 * payload: { name, customerGroupId | customerGroupName, validFrom, validTo, sourceFile?, note?, createMissingProducts?(default true),
 *   lines:[{ variants:[{name, codes:[]}], pack, caseFactor, listExVat, tiers:[{label,min,max,cashInclVat,creditInclVat}],
 *            packs:[{pack,factor,listExVat,cashInclVat,creditInclVat}], suggestedPack, retailPiece }],
 *   billPromos:[{minAmountExVat, percent}] }
 * ผลลัพธ์เป็นชุดราคาสถานะ draft — ตรวจแล้วค่อยสั่งใช้งานด้วย setPriceListStatus
 */
function importPriceList(session, payload) {
  var err = _requirePermission(session, 'pricing', 'edit'); if (err) return err;
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'กรุณาตั้งชื่อชุดราคา' };
  if (!_validDate(payload.validFrom) || !_validDate(payload.validTo)) return { success: false, message: 'กรุณาระบุช่วงเวลาเป็น yyyy-mm-dd' };
  if (payload.validFrom > payload.validTo) return { success: false, message: 'วันเริ่มต้องไม่หลังวันสิ้นสุด' };
  var lines = payload.lines || [];
  if (!lines.length) return { success: false, message: 'ไม่มีรายการสินค้าในชุดราคา' };
  var createMissing = payload.createMissingProducts !== false;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอยู่ ลองใหม่อีกครั้ง' };
  try {
    var group = _resolveCustomerGroup(payload);
    if (!group) return { success: false, message: 'กรุณาเลือกหรือระบุกลุ่มลูกค้าของชุดราคานี้' };

    var warnings = [], stats = { linesCount: lines.length, productsMatched: 0, productsCreated: 0, unitsCreated: 0, itemsCreated: 0, groupCreated: group.created };
    var products = centralObjects('products');
    var nextProductId = centralNextId('products');
    var newProducts = [];
    var findByCode = function(code) {
      var norm = String(code).trim().toLowerCase();
      var pool = products.concat(newProducts);
      for (var i = 0; i < pool.length; i++) if (_productAllCodes(pool[i]).indexOf(norm) !== -1) return pool[i];
      return null;
    };

    // 1) จับคู่/สร้างสินค้าของทุก variant
    var lineProducts = lines.map(function(ln) {
      return (ln.variants || []).map(function(v) {
        var codes = (v.codes || []).map(function(c) { return String(c).trim(); }).filter(Boolean);
        if (!codes.length) { warnings.push('"' + v.name + '" ไม่มีรหัสสินค้า ข้าม'); return null; }
        var hits = {};
        codes.forEach(function(c) { var p = findByCode(c); if (p) hits[String(p.record_id)] = p; });
        var ids = Object.keys(hits);
        if (ids.length > 1) { warnings.push('"' + v.name + '": รหัส ' + codes.join('/') + ' ตรงกับสินค้าหลายตัว (' + ids.map(function(i) { return hits[i].product_code; }).join(', ') + ') ใช้ตัวแรก'); }
        if (ids.length) { stats.productsMatched++; return hits[ids[0]]; }
        if (!createMissing) { warnings.push('ไม่พบสินค้ารหัส ' + codes.join('/') + ' (' + v.name + ')'); return null; }
        var p = { record_id: nextProductId++, product_code: codes[0], alias_codes: codes.slice(1).join(','), name: v.name, base_price: 0,
                  unit: 'ชิ้น', unit_code: 'pcs', group_id: 0, is_active: 'TRUE', external_code: '', barcode: '', group_barcode: '',
                  cost_price: 0, vat_type: 'none', image_url: '', has_transactions: '' };
        newProducts.push(p); stats.productsCreated++;
        return p;
      }).filter(Boolean);
    });

    // 2) หน่วยขาย (หีบ/แพ็ค) — ของเดิมไม่ทับ ถ้า factor ต่างกันแจ้งเตือนให้คนตัดสินใจ
    var existingUnits = {}; centralObjects('product_units').forEach(function(u) { existingUnits[String(u.product_id) + '_' + u.unit_code] = u; });
    var unitId = centralNextId('product_units'), newUnits = [];
    var ensureUnit = function(p, code, label, factor, price) {
      if (!factor) return;
      var k = String(p.record_id) + '_' + code, ex = existingUnits[k];
      if (ex) { if (Number(ex.unit_factor) !== Number(factor)) warnings.push(p.product_code + ' หน่วย ' + label + ': ในระบบมี factor ' + ex.unit_factor + ' แต่ใบราคาระบุ ' + factor + ' (ไม่ได้แก้ให้)'); return; }
      var u = { record_id: unitId++, product_id: p.record_id, unit_code: code, unit_label: label, unit_factor: factor, price: price || 0, is_active: 'TRUE', barcode: '' };
      existingUnits[k] = u; newUnits.push(u); stats.unitsCreated++;
    };

    // 3) รายการราคา
    var itemId = centralNextId('price_list_items'), lineId = itemId, items = [];
    var listId = centralNextId('price_lists');
    lines.forEach(function(ln, li) {
      var prods = lineProducts[li];
      if (!prods.length) return;
      var thisLine = lineId + li;
      var firstCash = ln.tiers && ln.tiers.length ? (ln.tiers[0].cashInclVat != null ? ln.tiers[0].cashInclVat : ln.tiers[0].creditInclVat) : 0;
      prods.forEach(function(p) {
        ensureUnit(p, 'CASE', 'หีบ', ln.caseFactor, firstCash);
        if (ln.packs && ln.packs.length) ensureUnit(p, 'PACK', 'แพ็ค', ln.packs[0].factor, ln.packs[0].cashInclVat);
        (ln.tiers || []).forEach(function(t) {
          items.push({ record_id: itemId++, price_list_id: listId, line_id: thisLine, product_id: p.record_id, unit_code: 'CASE', unit_factor: ln.caseFactor || '',
            min_qty: t.min, max_qty: t.max == null ? '' : t.max, list_price_ex_vat: _numOrBlank(ln.listExVat), cash_price_incl_vat: _numOrBlank(t.cashInclVat),
            credit_price_incl_vat: _numOrBlank(t.creditInclVat), van_only: 'FALSE', suggested_price: _numOrBlank(ln.suggestedPack), retail_price: _numOrBlank(ln.retailPiece), tier_label: t.label || '' });
        });
        (ln.packs || []).forEach(function(pk) {
          items.push({ record_id: itemId++, price_list_id: listId, line_id: thisLine, product_id: p.record_id, unit_code: 'PACK', unit_factor: pk.factor || '',
            min_qty: 1, max_qty: '', list_price_ex_vat: _numOrBlank(pk.listExVat), cash_price_incl_vat: _numOrBlank(pk.cashInclVat),
            credit_price_incl_vat: _numOrBlank(pk.creditInclVat), van_only: 'TRUE', suggested_price: '', retail_price: _numOrBlank(ln.retailPiece), tier_label: pk.note || 'ขายเฉพาะหน่วยรถ' });
        });
      });
    });
    if (!items.length) return { success: false, message: 'ไม่มีรายการราคาที่บันทึกได้ (ตรวจรหัสสินค้า/ขั้นราคาในไฟล์)', warnings: warnings };
    stats.itemsCreated = items.length;

    // 4) เขียนรวดเดียวต่อชีต
    centralAppendMany('products', newProducts);
    centralAppendMany('product_units', newUnits);
    centralAppend('price_lists', { record_id: listId, name: name, customer_group_id: group.id, valid_from: payload.validFrom, valid_to: payload.validTo,
      status: 'draft', source_file: String(payload.sourceFile || ''), note: String(payload.note || ''), created_at: nowStr(), activated_at: '' });
    centralAppendMany('price_list_items', items);
    var promoId = centralNextId('price_list_bill_promos');
    centralAppendMany('price_list_bill_promos', (payload.billPromos || []).map(function(b, i) {
      return { record_id: promoId + i, price_list_id: listId, min_amount_ex_vat: Number(b.minAmountExVat), percent: Number(b.percent) };
    }));
    return { success: true, id: listId, stats: stats, warnings: warnings };
  } finally {
    lock.releaseLock();
  }
}

// payload: { id, name?, customerGroupId?, validFrom?, validTo?, note? }
function updatePriceList(session, payload) {
  var err = _requirePermission(session, 'pricing', 'edit'); if (err) return err;
  var fields = {};
  if (payload.name !== undefined) { var n = String(payload.name).trim(); if (!n) return { success: false, message: 'ชื่อชุดราคาว่างไม่ได้' }; fields.name = n; }
  if (payload.customerGroupId !== undefined) fields.customer_group_id = payload.customerGroupId;
  if (payload.validFrom !== undefined) { if (!_validDate(payload.validFrom)) return { success: false, message: 'วันเริ่มไม่ถูกต้อง' }; fields.valid_from = payload.validFrom; }
  if (payload.validTo !== undefined) { if (!_validDate(payload.validTo)) return { success: false, message: 'วันสิ้นสุดไม่ถูกต้อง' }; fields.valid_to = payload.validTo; }
  if (payload.note !== undefined) fields.note = String(payload.note);
  if (fields.valid_from && fields.valid_to && fields.valid_from > fields.valid_to) return { success: false, message: 'วันเริ่มต้องไม่หลังวันสิ้นสุด' };
  if (!centralUpdate('price_lists', payload.id, fields)) return { success: false, message: 'ไม่พบชุดราคานี้' };
  return { success: true };
}

// payload: { id, status:'draft'|'active'|'archived' } — active ได้เมื่อมีรายการราคา; ชุด active ที่ช่วงเวลาทับกันในกลุ่มเดียวกัน
// ไม่ถูกปิดอัตโนมัติ (เครื่องยนต์เลือกตัวที่ valid_from ใหม่สุด) แต่จะแจ้งเตือนให้เห็น
function setPriceListStatus(session, payload) {
  var err = _requirePermission(session, 'pricing', 'edit'); if (err) return err;
  if (PRICE_STATUSES.indexOf(payload.status) === -1) return { success: false, message: 'สถานะไม่ถูกต้อง' };
  var lists = centralObjects('price_lists'), list = null;
  lists.forEach(function(l) { if (String(l.record_id) === String(payload.id)) list = l; });
  if (!list) return { success: false, message: 'ไม่พบชุดราคานี้' };
  var warnings = [];
  if (payload.status === 'active') {
    var hasItems = centralObjects('price_list_items').some(function(it) { return String(it.price_list_id) === String(list.record_id); });
    if (!hasItems) return { success: false, message: 'ชุดราคานี้ยังไม่มีรายการราคา' };
    lists.forEach(function(o) {
      if (String(o.record_id) === String(list.record_id) || o.status !== 'active') return;
      if (String(o.customer_group_id) !== String(list.customer_group_id)) return;
      if (_dOnly(o.valid_from) <= _dOnly(list.valid_to) && _dOnly(list.valid_from) <= _dOnly(o.valid_to))
        warnings.push('ช่วงเวลาทับกับชุด "' + o.name + '" (' + _dOnly(o.valid_from) + ' – ' + _dOnly(o.valid_to) + ') ที่ใช้งานอยู่ — ระบบจะใช้ชุดที่เริ่มใหม่กว่า');
    });
  }
  centralUpdate('price_lists', payload.id, { status: payload.status, activated_at: payload.status === 'active' ? nowStr() : list.activated_at });
  return { success: true, warnings: warnings };
}

// ลบได้เฉพาะชุด draft (ชุดที่เคยใช้งานแล้วให้ archived แทน เพื่อให้บิลเก่าอ้างราคาย้อนหลังได้)
function deletePriceList(session, payload) {
  var err = _requirePermission(session, 'pricing', 'edit'); if (err) return err;
  var list = null; centralObjects('price_lists').forEach(function(l) { if (String(l.record_id) === String(payload.id)) list = l; });
  if (!list) return { success: false, message: 'ไม่พบชุดราคานี้' };
  if (list.status !== 'draft') return { success: false, message: 'ลบได้เฉพาะชุดราคาสถานะร่าง — ชุดที่เคยใช้งานให้เก็บถาวร (archived) แทน' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอยู่ ลองใหม่อีกครั้ง' };
  try {
    deleteRowsWhere(centralSheet('price_list_items'), 'price_list_id', list.record_id);
    deleteRowsWhere(centralSheet('price_list_bill_promos'), 'price_list_id', list.record_id);
    deleteRowsWhere(centralSheet('price_lists'), 'record_id', list.record_id);
  } finally { lock.releaseLock(); }
  return { success: true };
}
