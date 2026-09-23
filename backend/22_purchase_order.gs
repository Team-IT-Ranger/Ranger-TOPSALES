/**
 * ===================== ใบสั่งซื้อ (PO) และการรับของเข้าคลัง (GR) =====================
 * เปิดใบสั่งซื้อได้ 2 ทาง:
 *   1) เปิดตรง — ซื้อด่วน/ซื้อประจำ ไม่ต้องมีใบขอซื้อ
 *   2) release มาจากใบขอซื้อที่อนุมัติแล้ว — ส่ง prItemId มาในแต่ละรายการ ระบบจะตัดยอดค้างของ PR ให้ (pr_items.po_qty)
 * วงจร PO: draft → (ส่งให้ผู้ขาย) sent → partial → received   · ยกเลิกได้ถ้ายังไม่รับของ
 * รับของ (GR) ทีละครั้ง รับไม่ครบได้ (partial) — ทุกครั้ง:
 *   - เพิ่มยอดคงเหลือคลัง (warehouse_stock) เป็น "หน่วยฐาน" พร้อมคิดต้นทุนเฉลี่ยถ่วงน้ำหนักใหม่
 *   - บันทึก stock_ledger 1 แถวต่อสินค้า (ย้อนรอยได้)
 *   - ลงบัญชีอัตโนมัติ: เดบิต สินค้าคงเหลือ / เครดิต รับของแล้วยังไม่ได้รับใบแจ้งหนี้ (GR/NI) — ดู 23_accounting.gs
 * ตั้งหนี้เจ้าหนี้จากใบรับของทำที่ createApBillFromGr (23_accounting.gs)
 *
 * ตัวแทนจำหน่าย: ใช้ PO/GR/สต็อกได้เหมือนกัน แยกข้อมูลด้วย tenant_id (ดู _purchaseScope ใน 20_purchasing_master.gs)
 * แต่ "ไม่ลงบัญชี" — สมุดบัญชี/เจ้าหนี้เป็นของบริษัทเจ้าของสินค้าเท่านั้น ใบรับของของตัวแทนจึงมี journal_id ว่าง
 * (ตัวแทนเป็นคนละนิติบุคคล จะเอาเข้างบบริษัทไม่ได้ — ถ้าจะทำบัญชีให้ตัวแทนต้องเป็นชุดสมุดแยกของเขาเอง)
 */

var PO_STATUSES = ['draft', 'sent', 'partial', 'received', 'cancelled'];

function _poAmounts(items, vatType, discountExVat) {
  var gross = _money(items.reduce(function(s, it) { return s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0); }, 0));
  var discount = _money(discountExVat || 0);
  var net = _money(gross - discount);
  var subtotal, vat;
  if (vatType === 'included') { subtotal = _money(net / (1 + PO_VAT_RATE)); vat = _money(net - subtotal); }
  else if (vatType === 'none') { subtotal = net; vat = 0; }
  else { subtotal = net; vat = _money(net * PO_VAT_RATE); }   // 'excluded' (ค่าเริ่มต้น)
  return { gross: gross, discount: discount, subtotal: subtotal, vat: vat, total: _money(subtotal + vat) };
}

function _poDto(po, items, extra) {
  extra = extra || {};
  return {
    id: po.record_id, poNo: po.po_no, vendorId: po.vendor_id, vendorName: extra.vendorName || '',
    prId: po.pr_id || '', prNo: extra.prNo || '', warehouseId: po.warehouse_id, warehouseName: extra.warehouseName || '',
    status: po.status, orderDate: _dOnly(po.order_date), expectedDate: _dOnly(po.expected_date), vatType: po.vat_type || 'excluded',
    subtotalExVat: Number(po.subtotal_ex_vat) || 0, discountExVat: Number(po.discount_ex_vat) || 0,
    vatAmount: Number(po.vat_amount) || 0, total: Number(po.total) || 0, note: po.note || '',
    createdBy: po.created_by, createdAt: safeDateStr(po.created_at), closedAt: safeDateStr(po.closed_at),
    items: (items || []).map(function(it) {
      var qty = Number(it.qty) || 0, rec = Number(it.received_qty) || 0;
      return { id: it.record_id, lineNo: _int(it.line_no), prItemId: it.pr_item_id || '', productId: it.product_id || '',
        productCode: extra.productCodes ? (extra.productCodes[String(it.product_id)] || '') : '',
        description: it.description || '', qty: qty, unitCode: it.unit_code || '', unitFactor: Number(it.unit_factor) || 1,
        unitPrice: Number(it.unit_price) || 0, amount: Number(it.amount) || 0, receivedQty: rec, remainQty: _money(qty - rec) };
    }).sort(function(a, b) { return a.lineNo - b.lineNo; })
  };
}

function _poExtra(po) {
  var v = po.vendor_id ? _findById('vendors', po.vendor_id) : null;
  var w = po.warehouse_id ? _findById('warehouses', po.warehouse_id) : null;
  var pr = po.pr_id ? _findById('purchase_requisitions', po.pr_id) : null;
  var codes = {};
  centralObjects('products').forEach(function(p) { codes[String(p.record_id)] = p.product_code; });
  return { vendorName: v ? v.name : '', warehouseName: w ? w.name : '', prNo: pr ? pr.pr_no : '', productCodes: codes };
}

function listPurchaseOrders(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  payload = payload || {};
  var vendors = {}, itemsByPo = {};
  centralObjects('vendors').forEach(function(v) { vendors[String(v.record_id)] = v.name; });
  centralObjects('po_items').forEach(function(it) { (itemsByPo[String(it.po_id)] = itemsByPo[String(it.po_id)] || []).push(it); });
  var rows = _scoped('purchase_orders', _purchaseScope(session, payload));
  if (payload.status) rows = rows.filter(function(po) { return String(po.status) === String(payload.status); });
  if (payload.vendorId) rows = rows.filter(function(po) { return String(po.vendor_id) === String(payload.vendorId); });
  if (payload.openOnly) rows = rows.filter(function(po) { return po.status === 'sent' || po.status === 'partial'; });
  var out = rows.map(function(po) {
    var items = itemsByPo[String(po.record_id)] || [];
    return { id: po.record_id, poNo: po.po_no, vendorId: po.vendor_id, vendorName: vendors[String(po.vendor_id)] || '',
      status: po.status, orderDate: _dOnly(po.order_date), expectedDate: _dOnly(po.expected_date),
      total: Number(po.total) || 0, itemCount: items.length,
      receivedPct: items.length ? Math.round(items.reduce(function(s, it) { return s + Math.min(1, (Number(it.received_qty) || 0) / (Number(it.qty) || 1)); }, 0) / items.length * 100) : 0,
      prId: po.pr_id || '' };
  });
  out.sort(function(a, b) { return String(b.orderDate).localeCompare(String(a.orderDate)) || (b.id - a.id); });
  return { success: true, data: out };
}

function getPurchaseOrder(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  var po = _findScoped('purchase_orders', payload.id, _purchaseScope(session, payload));
  if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อนี้' };
  var dto = _poDto(po, _childrenOf('po_items', 'po_id', po.record_id), _poExtra(po));
  dto.receipts = _childrenOf('goods_receipts', 'po_id', po.record_id).map(function(gr) {
    return { id: gr.record_id, grNo: gr.gr_no, receiveDate: _dOnly(gr.receive_date), status: gr.status, note: gr.note || '',
      itemCount: _childrenOf('gr_items', 'gr_id', gr.record_id).length };
  });
  dto.bills = centralObjects('ap_bills').filter(function(b) { return String(b.po_id) === String(po.record_id); })
    .map(function(b) { return { id: b.record_id, billNo: b.bill_no, total: Number(b.total) || 0, status: b.status }; });
  dto.canEdit = po.status === 'draft';
  return { success: true, po: dto };
}

/**
 * payload: { id?, vendorId, warehouseId?, orderDate, expectedDate?, vatType('excluded'|'included'|'none'), discountExVat?, note?,
 *            items:[{ prItemId?, productId?, description?, qty, unitCode?, unitFactor?, unitPrice }] }
 * สร้าง/แก้ใบสั่งซื้อ (สถานะ draft เท่านั้น) — ใส่ prItemId = release มาจากใบขอซื้อที่อนุมัติแล้ว
 */
function savePurchaseOrder(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  var vendor = payload.vendorId ? _findScoped('vendors', payload.vendorId, scope) : null;
  if (!vendor) return { success: false, message: 'กรุณาเลือกผู้ขาย' };
  if (!_isTrue(vendor.is_active)) return { success: false, message: 'ผู้ขายรายนี้ถูกปิดการใช้งานอยู่' };
  var orderDate = payload.orderDate || _todayStr();
  if (!_validDate(orderDate)) return { success: false, message: 'วันที่สั่งซื้อต้องเป็น yyyy-mm-dd' };
  if (payload.expectedDate && !_validDate(payload.expectedDate)) return { success: false, message: 'วันที่คาดว่าจะได้รับต้องเป็น yyyy-mm-dd' };
  var vatType = ['excluded', 'included', 'none'].indexOf(payload.vatType) !== -1 ? payload.vatType : 'excluded';
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  var items = (payload.items || []).map(function(it, i) {
    return { lineNo: i + 1, prItemId: it.prItemId == null ? '' : String(it.prItemId), productId: it.productId == null ? '' : String(it.productId),
      description: String(it.description || '').trim(), qty: _numOrNull(it.qty), unitCode: String(it.unitCode || '').trim(),
      unitFactor: _numOrNull(it.unitFactor) === null ? 1 : _numOrNull(it.unitFactor), unitPrice: _numOrNull(it.unitPrice) };
  });
  if (!items.length) return { success: false, message: 'ต้องมีรายการสั่งซื้ออย่างน้อย 1 รายการ' };
  for (var i = 0; i < items.length; i++) {
    var it = items[i], no = 'รายการที่ ' + (i + 1) + ': ';
    if (it.productId && !products[it.productId]) return { success: false, message: no + 'ไม่พบสินค้า id ' + it.productId };
    if (!it.productId && !it.description) return { success: false, message: no + 'ต้องเลือกสินค้า หรือกรอกรายละเอียด' };
    if (!(it.qty > 0)) return { success: false, message: no + 'จำนวนต้องมากกว่า 0' };
    if (it.unitPrice === null || !(it.unitPrice >= 0)) return { success: false, message: no + 'ราคาต่อหน่วยต้องเป็นตัวเลขไม่ติดลบ' };
    if (!(it.unitFactor > 0)) return { success: false, message: no + 'ตัวคูณหน่วย (จำนวนหน่วยฐานต่อ 1 หน่วยสั่งซื้อ) ต้องมากกว่า 0' };
    if (!it.productId && it.unitFactor !== 1) return { success: false, message: no + 'รายการที่ไม่ได้ผูกสินค้าในระบบ ใช้ตัวคูณหน่วย = 1 เท่านั้น (ไม่เข้าสต็อก)' };
    if (it.productId && !it.description) it.description = products[it.productId].name;
  }
  var amt = _poAmounts(items, vatType, payload.discountExVat);
  if (amt.discount < 0 || amt.discount > amt.gross) return { success: false, message: 'ส่วนลดต้องอยู่ระหว่าง 0 ถึงยอดรวมก่อนลด' };

  return _withDocLock(function() {
    // ตรวจยอดค้างของใบขอซื้อ (กัน release เกินที่อนุมัติไว้)
    var prIds = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (!it.prItemId) continue;
      var prItem = _findById('pr_items', it.prItemId);
      if (!prItem) return { success: false, message: 'รายการที่ ' + (i + 1) + ': ไม่พบรายการในใบขอซื้อ' };
      var pr = _findScoped('purchase_requisitions', prItem.pr_id, scope);
      if (!pr || pr.status !== 'approved') return { success: false, message: 'รายการที่ ' + (i + 1) + ': ใบขอซื้ออ้างอิงยังไม่อนุมัติ (หรือถูกปิดไปแล้ว)' };
      var alreadyThisPo = 0;
      if (payload.id) _childrenOf('po_items', 'po_id', payload.id).forEach(function(o) { if (String(o.pr_item_id) === String(it.prItemId)) alreadyThisPo += Number(o.qty) || 0; });
      var remain = (Number(prItem.qty) || 0) - (Number(prItem.po_qty) || 0) + alreadyThisPo;
      var baseQty = it.qty * it.unitFactor;
      if (baseQty > remain + 1e-9) return { success: false, message: 'รายการที่ ' + (i + 1) + ': ใบขอซื้อเหลือให้สั่งได้ ' + remain + ' (ขอสั่ง ' + baseQty + ')' };
      prIds[String(prItem.pr_id)] = true;
    }
    var prKeys = Object.keys(prIds);
    if (prKeys.length > 1) return { success: false, message: 'ใบสั่งซื้อ 1 ใบ อ้างอิงใบขอซื้อได้ใบเดียว (เลือกมา ' + prKeys.length + ' ใบ)' };

    var head = { vendor_id: vendor.record_id, pr_id: prKeys.length ? prKeys[0] : '', warehouse_id: payload.warehouseId || _ensureScopeWarehouse(scope) || '',
      order_date: orderDate, expected_date: payload.expectedDate || '', vat_type: vatType,
      subtotal_ex_vat: amt.subtotal, discount_ex_vat: amt.discount, vat_amount: amt.vat, total: amt.total, note: String(payload.note || '') };
    var poId = payload.id;
    if (poId) {
      var existing = _findScoped('purchase_orders', poId, scope);
      if (!existing) return { success: false, message: 'ไม่พบใบสั่งซื้อนี้' };
      if (existing.status !== 'draft') return { success: false, message: 'แก้ได้เฉพาะใบสั่งซื้อที่ยังเป็นร่าง — ใบที่ส่งผู้ขายแล้วให้ยกเลิกแล้วเปิดใหม่' };
      centralUpdate('purchase_orders', poId, head);
      _deleteRowsMatching(centralSheet('po_items'), function(o) { return String(o.po_id) === String(poId); });
    } else {
      poId = centralNextId('purchase_orders');
      head.record_id = poId; head.tenant_id = scope; head.po_no = _nextCentralDocNo('PO', scope); head.status = 'draft';
      head.created_by = session.adminUserId; head.created_at = nowStr(); head.closed_at = '';
      centralAppend('purchase_orders', head);
    }
    var itemId = centralNextId('po_items');
    centralAppendMany('po_items', items.map(function(it, i) {
      return { record_id: itemId + i, po_id: poId, line_no: it.lineNo, pr_item_id: it.prItemId, product_id: it.productId,
        description: it.description, qty: it.qty, unit_code: it.unitCode, unit_factor: it.unitFactor,
        unit_price: _money(it.unitPrice), amount: _money(it.qty * it.unitPrice), received_qty: 0 };
    }));
    return getPurchaseOrder(session, { id: poId, tenantId: scope });
  });
}

// payload: { id } — ส่งใบสั่งซื้อให้ผู้ขาย: ล็อกไม่ให้แก้ และตัดยอดค้างของใบขอซื้อ
function issuePurchaseOrder(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var po = _findScoped('purchase_orders', payload.id, scope);
    if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อนี้' };
    if (po.status !== 'draft') return { success: false, message: 'ใบนี้ส่งให้ผู้ขายไปแล้ว' };
    var items = _childrenOf('po_items', 'po_id', po.record_id);
    if (!items.length) return { success: false, message: 'ใบสั่งซื้อนี้ยังไม่มีรายการ' };
    items.forEach(function(it) {
      if (!it.pr_item_id) return;
      var prItem = _findById('pr_items', it.pr_item_id); if (!prItem) return;
      centralUpdate('pr_items', prItem.record_id, { po_qty: _money((Number(prItem.po_qty) || 0) + (Number(it.qty) || 0) * (Number(it.unit_factor) || 1)) });
    });
    centralUpdate('purchase_orders', po.record_id, { status: 'sent' });
    if (po.pr_id) _closePrIfFullyReleased(po.pr_id);
    return _withPoResult(session, po.record_id, 'ส่งใบสั่งซื้อให้ผู้ขายแล้ว', scope);
  });
}

function _closePrIfFullyReleased(prId) {
  var pr = _findById('purchase_requisitions', prId);
  if (!pr || pr.status !== 'approved') return;
  var remain = _childrenOf('pr_items', 'pr_id', prId).some(function(it) { return (Number(it.qty) || 0) - (Number(it.po_qty) || 0) > 1e-9; });
  if (!remain) centralUpdate('purchase_requisitions', prId, { status: 'closed', closed_at: nowStr() });
}

function _withPoResult(session, poId, message, scope) {
  var r = getPurchaseOrder(session, { id: poId, tenantId: scope || '' });
  if (r.success) r.message = message;
  return r;
}

// payload: { id, reason? } — ยกเลิกใบสั่งซื้อ (ต้องยังไม่รับของ) แล้วคืนยอดค้างให้ใบขอซื้อ
function cancelPurchaseOrder(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var po = _findScoped('purchase_orders', payload.id, scope);
    if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อนี้' };
    if (po.status === 'cancelled') return { success: false, message: 'ใบนี้ถูกยกเลิกไปแล้ว' };
    var items = _childrenOf('po_items', 'po_id', po.record_id);
    if (items.some(function(it) { return (Number(it.received_qty) || 0) > 0; }))
      return { success: false, message: 'ใบนี้รับของเข้าคลังไปแล้ว ยกเลิกไม่ได้ — ให้ยกเลิกใบรับของก่อน' };
    if (po.status !== 'draft') items.forEach(function(it) {      // คืนยอดค้าง PR เฉพาะใบที่เคยตัดไปตอนส่ง
      if (!it.pr_item_id) return;
      var prItem = _findById('pr_items', it.pr_item_id); if (!prItem) return;
      centralUpdate('pr_items', prItem.record_id, { po_qty: _money(Math.max(0, (Number(prItem.po_qty) || 0) - (Number(it.qty) || 0) * (Number(it.unit_factor) || 1))) });
    });
    centralUpdate('purchase_orders', po.record_id, { status: 'cancelled', closed_at: nowStr(),
      note: String(po.note || '') + (payload.reason ? ('\nยกเลิก: ' + payload.reason) : '') });
    if (po.pr_id) {   // ใบขอซื้อที่เคยถูกปิดเพราะออก PO ครบ กลับมาเปิดให้สั่งได้อีก
      var pr = _findById('purchase_requisitions', po.pr_id);
      if (pr && pr.status === 'closed') centralUpdate('purchase_requisitions', po.pr_id, { status: 'approved', closed_at: '' });
    }
    return _withPoResult(session, po.record_id, 'ยกเลิกใบสั่งซื้อแล้ว', scope);
  });
}

/* ═══════════════ รับของเข้าคลัง (Goods Receipt) ═══════════════ */

/**
 * payload: { poId, warehouseId?, receiveDate?, note?, items:[{ poItemId, qty (หน่วยสั่งซื้อ) }] }
 * รับได้หลายครั้งต่อ 1 PO · รับเกินจำนวนที่สั่งไม่ได้ · qty เป็นหน่วยสั่งซื้อ (แปลงเป็นหน่วยฐานด้วย unit_factor)
 */
function receiveGoods(session, payload) {
  var err = _requirePermission(session, 'inventory', 'edit'); if (err) return err;
  var receiveDate = payload.receiveDate || _todayStr();
  if (!_validDate(receiveDate)) return { success: false, message: 'วันที่รับของต้องเป็น yyyy-mm-dd' };
  var lines = (payload.items || []).map(function(it) { return { poItemId: String(it.poItemId || ''), qty: _numOrNull(it.qty) }; })
    .filter(function(it) { return it.poItemId && it.qty !== null && it.qty !== 0; });
  if (!lines.length) return { success: false, message: 'ยังไม่ได้ระบุจำนวนที่รับ' };

  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var po = _findScoped('purchase_orders', payload.poId, scope);
    if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อนี้' };
    if (po.status === 'draft') return { success: false, message: 'ใบสั่งซื้อยังเป็นร่าง — ส่งให้ผู้ขายก่อนจึงจะรับของได้' };
    if (po.status === 'cancelled') return { success: false, message: 'ใบสั่งซื้อนี้ถูกยกเลิกแล้ว' };
    var warehouseId = payload.warehouseId || po.warehouse_id || _ensureScopeWarehouse(scope);
    var wh = warehouseId ? _findScoped('warehouses', warehouseId, scope) : null;
    if (!wh) return { success: false, message: 'กรุณาเลือกคลังที่รับของ' };

    var poItems = {};
    _childrenOf('po_items', 'po_id', po.record_id).forEach(function(it) { poItems[String(it.record_id)] = it; });
    var grRows = [], stockOps = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], it = poItems[ln.poItemId];
      if (!it) return { success: false, message: 'รายการที่ ' + (i + 1) + ': ไม่พบรายการนี้ในใบสั่งซื้อ' };
      if (!(ln.qty > 0)) return { success: false, message: 'รายการที่ ' + (i + 1) + ': จำนวนรับต้องมากกว่า 0' };
      var remain = (Number(it.qty) || 0) - (Number(it.received_qty) || 0);
      if (ln.qty > remain + 1e-9) return { success: false, message: (it.description || 'รายการที่ ' + (i + 1)) + ': เหลือให้รับได้ ' + _money(remain) + ' (รับมา ' + ln.qty + ')' };
      var factor = Number(it.unit_factor) || 1;
      var baseQty = _money(ln.qty * factor);
      var unitCost = factor ? _money((Number(it.unit_price) || 0) / factor) : 0;   // ต้นทุนต่อหน่วยฐาน
      grRows.push({ poItem: it, qty: ln.qty, baseQty: baseQty, unitCost: unitCost, factor: factor });
      if (it.product_id) stockOps.push({ productId: String(it.product_id), baseQty: baseQty, unitCost: unitCost });
    }

    var grId = centralNextId('goods_receipts');
    var grNo = _nextCentralDocNo('GR', scope);
    centralAppend('goods_receipts', { record_id: grId, tenant_id: scope, gr_no: grNo, po_id: po.record_id, vendor_id: po.vendor_id, warehouse_id: wh.record_id,
      receive_date: receiveDate, note: String(payload.note || ''), status: 'posted', journal_id: '', created_by: session.adminUserId, created_at: nowStr() });
    var grItemId = centralNextId('gr_items');
    centralAppendMany('gr_items', grRows.map(function(r, i) {
      return { record_id: grItemId + i, gr_id: grId, po_item_id: r.poItem.record_id, product_id: r.poItem.product_id || '',
        qty: r.qty, unit_code: r.poItem.unit_code || '', unit_factor: r.factor, base_qty: r.baseQty, unit_cost: r.unitCost,
        amount: _money(r.qty * (Number(r.poItem.unit_price) || 0)) };
    }));
    grRows.forEach(function(r) {
      centralUpdate('po_items', r.poItem.record_id, { received_qty: _money((Number(r.poItem.received_qty) || 0) + r.qty) });
    });
    // เข้าสต็อก + ledger
    var inventoryValue = 0;
    stockOps.forEach(function(op) {
      _applyStockIn(scope, wh.record_id, op.productId, op.baseQty, op.unitCost, 'receipt', 'GR', grId, grNo, session.adminUserId);
      inventoryValue += op.baseQty * op.unitCost;
    });
    // สถานะ PO ตามยอดที่รับแล้ว
    var after = _childrenOf('po_items', 'po_id', po.record_id);
    var done = after.every(function(it) { return (Number(it.received_qty) || 0) >= (Number(it.qty) || 0) - 1e-9; });
    var some = after.some(function(it) { return (Number(it.received_qty) || 0) > 0; });
    centralUpdate('purchase_orders', po.record_id, { status: done ? 'received' : (some ? 'partial' : po.status), closed_at: done ? nowStr() : '' });

    // ลงบัญชี: เดบิตสินค้าคงเหลือ / เครดิต GR/NI (ยังไม่ได้รับใบแจ้งหนี้จากผู้ขาย)
    // เฉพาะของบริษัทเจ้าของสินค้า — ของตัวแทนเข้าสต็อกอย่างเดียว ไม่แตะสมุดบัญชีบริษัท
    var journalId = '';
    inventoryValue = _money(inventoryValue);
    if (inventoryValue > 0 && !scope) {
      var jr = _postJournal({ date: receiveDate, source: 'INV', refType: 'GR', refId: grId, memo: 'รับของเข้าคลัง ' + grNo + ' (' + (po.po_no || '') + ')',
        createdBy: session.adminUserId, lines: [
          { accountCode: GL_ACCT.INVENTORY, description: 'สินค้าคงเหลือเพิ่มจาก ' + grNo, debit: inventoryValue, credit: 0 },
          { accountCode: GL_ACCT.GRNI, description: 'รอรับใบแจ้งหนี้จากผู้ขาย', debit: 0, credit: inventoryValue, partyType: 'vendor', partyId: po.vendor_id }
        ] });
      if (!jr.success) return jr;
      journalId = jr.journalId;
      centralUpdate('goods_receipts', grId, { journal_id: journalId });
    }
    var res = _withPoResult(session, po.record_id, 'รับของเข้าคลัง ' + grNo + ' แล้ว' + (journalId ? ' (ลงบัญชีสินค้าคงเหลือ ' + inventoryValue.toLocaleString() + ' บาท)' : ''), scope);
    res.grId = grId; res.grNo = grNo; res.journalId = journalId;
    return res;
  });
}

// เพิ่มของเข้าคลัง + คิดต้นทุนเฉลี่ยถ่วงน้ำหนักใหม่ + เขียน ledger (เรียกใต้ _withDocLock เท่านั้น)
function _applyStockIn(scope, warehouseId, productId, baseQty, unitCost, moveType, refType, refId, refNo, userId) {
  var rows = _scoped('warehouse_stock', scope);
  var cur = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].warehouse_id) === String(warehouseId) && String(rows[i].product_id) === String(productId)) { cur = rows[i]; break; }
  }
  var oldQty = cur ? (Number(cur.qty) || 0) : 0;
  var oldCost = cur ? (Number(cur.avg_cost) || 0) : 0;
  var newQty = _money(oldQty + baseQty);
  // ต้นทุนเฉลี่ยใหม่ = (มูลค่าเดิม + มูลค่าที่รับเข้า) / จำนวนใหม่ (ของออกไม่เปลี่ยนต้นทุนเฉลี่ย)
  var newCost = baseQty > 0 && newQty > 0 ? _money((oldQty * oldCost + baseQty * unitCost) / newQty) : oldCost;
  if (cur) centralUpdate('warehouse_stock', cur.record_id, { qty: newQty, avg_cost: newCost, updated_at: nowStr() });
  else centralAppend('warehouse_stock', { record_id: centralNextId('warehouse_stock'), tenant_id: scope || '', warehouse_id: warehouseId, product_id: productId,
    qty: newQty, avg_cost: newCost, updated_at: nowStr() });
  centralAppend('stock_ledger', { record_id: centralNextId('stock_ledger'), tenant_id: scope || '', warehouse_id: warehouseId, product_id: productId,
    change_qty: baseQty, balance_after: newQty, unit_cost: unitCost, move_type: moveType, ref_type: refType, ref_id: refId,
    note: refNo || '', created_by: userId, created_at: nowStr() });
  return { qty: newQty, avgCost: newCost };
}

function listGoodsReceipts(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  payload = payload || {};
  var vendors = {}, pos = {};
  centralObjects('vendors').forEach(function(v) { vendors[String(v.record_id)] = v.name; });
  centralObjects('purchase_orders').forEach(function(p) { pos[String(p.record_id)] = p.po_no; });
  var billedGr = {};
  centralObjects('ap_bills').forEach(function(b) { if (b.gr_id && b.status !== 'void') billedGr[String(b.gr_id)] = b.bill_no; });
  var itemsByGr = {};
  centralObjects('gr_items').forEach(function(it) { (itemsByGr[String(it.gr_id)] = itemsByGr[String(it.gr_id)] || []).push(it); });
  var rows = _scoped('goods_receipts', _purchaseScope(session, payload));
  if (payload.poId) rows = rows.filter(function(g) { return String(g.po_id) === String(payload.poId); });
  if (payload.notBilledOnly) rows = rows.filter(function(g) { return !billedGr[String(g.record_id)] && g.status === 'posted'; });
  var out = rows.map(function(g) {
    var items = itemsByGr[String(g.record_id)] || [];
    return { id: g.record_id, grNo: g.gr_no, poId: g.po_id, poNo: pos[String(g.po_id)] || '', vendorId: g.vendor_id,
      vendorName: vendors[String(g.vendor_id)] || '', warehouseId: g.warehouse_id, receiveDate: _dOnly(g.receive_date),
      status: g.status, note: g.note || '', itemCount: items.length,
      amount: _money(items.reduce(function(s, it) { return s + (Number(it.amount) || 0); }, 0)),
      billNo: billedGr[String(g.record_id)] || '', journalId: g.journal_id || '' };
  });
  out.sort(function(a, b) { return String(b.receiveDate).localeCompare(String(a.receiveDate)) || (b.id - a.id); });
  return { success: true, data: out };
}

function getGoodsReceipt(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  var gr = _findScoped('goods_receipts', payload.id, _purchaseScope(session, payload));
  if (!gr) return { success: false, message: 'ไม่พบใบรับของนี้' };
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var po = gr.po_id ? _findById('purchase_orders', gr.po_id) : null;
  var v = gr.vendor_id ? _findById('vendors', gr.vendor_id) : null;
  var w = gr.warehouse_id ? _findById('warehouses', gr.warehouse_id) : null;
  return { success: true, gr: {
    id: gr.record_id, grNo: gr.gr_no, poId: gr.po_id, poNo: po ? po.po_no : '', vendorId: gr.vendor_id, vendorName: v ? v.name : '',
    warehouseId: gr.warehouse_id, warehouseName: w ? w.name : '', receiveDate: _dOnly(gr.receive_date), status: gr.status,
    note: gr.note || '', journalId: gr.journal_id || '', createdAt: safeDateStr(gr.created_at),
    items: _childrenOf('gr_items', 'gr_id', gr.record_id).map(function(it) {
      var p = it.product_id ? products[String(it.product_id)] : null;
      return { id: it.record_id, productId: it.product_id || '', productCode: p ? p.product_code : '', productName: p ? p.name : '(ไม่ผูกสินค้า)',
        qty: Number(it.qty) || 0, unitCode: it.unit_code || '', unitFactor: Number(it.unit_factor) || 1, baseQty: Number(it.base_qty) || 0,
        unitCost: Number(it.unit_cost) || 0, amount: Number(it.amount) || 0 };
    }) } };
}

/* ═══════════════ ยอดคงเหลือคลังกลาง ═══════════════ */

function listWarehouseStock(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  payload = payload || {};
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var warehouses = {};
  centralObjects('warehouses').forEach(function(w) { warehouses[String(w.record_id)] = w.name; });
  var rows = _scoped('warehouse_stock', _purchaseScope(session, payload));
  if (payload.warehouseId) rows = rows.filter(function(r) { return String(r.warehouse_id) === String(payload.warehouseId); });
  var out = rows.map(function(r) {
    var p = products[String(r.product_id)];
    var qty = Number(r.qty) || 0, cost = Number(r.avg_cost) || 0;
    return { warehouseId: r.warehouse_id, warehouseName: warehouses[String(r.warehouse_id)] || '', productId: r.product_id,
      productCode: p ? p.product_code : '', productName: p ? p.name : '(สินค้าถูกลบ)', unit: p ? (p.unit || 'ชิ้น') : '',
      qty: qty, avgCost: cost, value: _money(qty * cost), updatedAt: safeDateStr(r.updated_at) };
  });
  if (payload.nonZeroOnly) out = out.filter(function(r) { return r.qty !== 0; });
  out.sort(function(a, b) { return String(a.productCode).localeCompare(String(b.productCode)); });
  return { success: true, data: out, totalValue: _money(out.reduce(function(s, r) { return s + r.value; }, 0)) };
}

function listStockLedger(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  payload = payload || {};
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var rows = _scoped('stock_ledger', _purchaseScope(session, payload));
  if (payload.productId) rows = rows.filter(function(r) { return String(r.product_id) === String(payload.productId); });
  if (payload.warehouseId) rows = rows.filter(function(r) { return String(r.warehouse_id) === String(payload.warehouseId); });
  var out = rows.map(function(r) {
    var p = products[String(r.product_id)];
    return { id: r.record_id, warehouseId: r.warehouse_id, productId: r.product_id, productCode: p ? p.product_code : '',
      productName: p ? p.name : '', changeQty: Number(r.change_qty) || 0, balanceAfter: Number(r.balance_after) || 0,
      unitCost: Number(r.unit_cost) || 0, moveType: r.move_type, refType: r.ref_type, refId: r.ref_id, note: r.note || '',
      createdAt: safeDateStr(r.created_at) };
  });
  out.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)) || (b.id - a.id); });
  var limit = _int(payload.limit) || 200;
  return { success: true, data: out.slice(0, limit), total: out.length };
}

function _todayStr() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
