/**
 * ===================== ใบรับคืนสินค้า (Goods Return Note) =====================
 * เมนู 1.1.4 · เลขชุด `GRN` · คู่กับใบลดหนี้ (49_credit_notes.gs)
 *
 * ★★ ทำไมต้องมี: ใบลดหนี้มีช่องติ๊ก "รับของคืนเข้าคลัง" อยู่แล้ว แต่**ไม่มีเอกสารให้คนขับรถถือ
 *   ไปรับของ** และไม่มีหลักฐานว่าใครรับคืน รับเมื่อไหร่ ของสภาพไหน · ของกลับเข้าคลังโดยมีแค่
 *   ตัวเลขขยับ พอมีปัญหาทีหลัง (ของหาย/ของเสียปนของดี) ไม่มีอะไรให้ไล่ย้อน
 *
 * ★ **ลำดับงานจริงคือ รับของก่อน แล้วค่อยลดหนี้** — ของกลับถึงคลังและตรวจสภาพแล้ว ถึงจะรู้ว่า
 *   จะลดหนี้เท่าไร (ของเสียหายบางส่วนอาจลดไม่เต็ม) ใบรับคืนจึงเป็นเอกสารตั้งต้น ไม่ใช่ของแถม
 *
 * ★★★ **ใบรับคืนเป็นตัวที่ขยับสต็อก ใบลดหนี้ไม่ขยับซ้ำ** — สองที่ขยับของชิ้นเดียวกันเมื่อไหร่
 *   สต็อกจะงอกเป็นสองเท่าโดยไม่มีใครเห็น · ใบลดหนี้ที่ออกจากใบรับคืน จึงถูกบังคับ
 *   `moveStock = false` เสมอ (`createCreditNoteFromReturn`) และใบลดหนี้ที่ออกเองยังติ๊กได้เหมือนเดิม
 *   สำหรับกรณีที่ไม่มีใบรับคืน (คิดราคาผิด / ของเสียทิ้งไปแล้ว)
 */

var GRN_REASONS = {
  damaged: 'สินค้าชำรุด/เสียหาย',
  expired: 'สินค้าหมดอายุ/ใกล้หมดอายุ',
  wrong_item: 'ส่งผิดรายการ',
  over_delivery: 'ส่งเกินจำนวน',
  not_ordered: 'ร้านไม่ได้สั่ง',
  other: 'อื่นๆ'
};
/* สภาพของที่รับคืน — **บันทึกคุณภาพ** ของที่คนรับหน้างานเห็น
   ★★ ตั้งแต่ 23 ต.ค. 2026 สภาพของ **ไม่ใช่** ตัวตัดสินว่าของไปอยู่คลังไหนอีกแล้ว — คนรับเลือก
     "คลังปลายทาง" เองรายบรรทัด (คลังขาย / คลังรับคืนรอตรวจ / คลังของเสีย) เพราะของสภาพดีที่ยัง
     ไม่ได้ตรวจก็มี และของที่ดูชำรุดแต่ซ่อมแล้วขายได้ก็มี · `restock` ที่นี่เหลือเป็นแค่ **ค่าตั้งต้น**
     ว่าหน้าจอควรเลือกคลังไหนให้ก่อน */
var GRN_CONDITIONS = {
  good:    { label: 'สภาพดี ขายต่อได้', restock: true },
  damaged: { label: 'ชำรุด/เสียหาย',   restock: false },
  expired: { label: 'หมดอายุ',         restock: false }
};

var GRN_STATUS = { received: 'รับของแล้ว', cancelled: 'ยกเลิก' };

/** รายการของบิลขายใบหนึ่งที่ยังรับคืนได้ (ขายไปเท่าไร − รับคืนไปแล้วเท่าไร) */
function getGoodsReturnDraft(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  return _goodsReturnDraftCore(_effectiveTenantId(session, payload), payload.orderId);
}
/* ★ แกนกลาง — ไม่ตรวจสิทธิ์ เพราะฝั่งใบลดหนี้เรียกตัวนี้ด้วย และคนทำบัญชีอาจไม่มีสิทธิ์ "งานขาย"
   สิทธิ์ถูกตรวจที่ action ปลายทางไปแล้ว (`accounting` ของใบลดหนี้ · `sales` ของใบรับคืน) */
function _goodsReturnDraftCore(tenantId, orderId) {
  var payload = { orderId: orderId };
  var order = tenantRowById(tenantId, 'sales_orders', payload.orderId);
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

  /* ★ รับคืนได้เฉพาะของที่ส่งไปแล้ว — ของที่ยังไม่ออกจากคลังไม่มีอะไรให้คืน
     บิลที่แยกรอบจัดส่งจึงดูจาก "จำนวนที่ส่งไปแล้ว" ไม่ใช่จำนวนที่สั่ง */
  var plan = saleDeliveryPlan(tenantId, order);
  var shippedByItem = {};
  plan.lines.forEach(function(l) {
    shippedByItem[String(l.itemId)] = plan.hasRounds ? l.shipped : l.ordered;
  });

  var already = {};
  centralObjects('goods_return_items').forEach(function(it) { already[String(it.order_item_id)] = (already[String(it.order_item_id)] || 0) + (parseFloat(it.qty) || 0); });
  var liveReturns = {};
  centralObjects('goods_returns').forEach(function(g) {
    if (String(g.status) !== 'cancelled') liveReturns[String(g.record_id)] = true;
  });
  // นับเฉพาะใบรับคืนที่ยังไม่ถูกยกเลิก
  already = {};
  centralObjects('goods_return_items').forEach(function(it) {
    if (!liveReturns[String(it.return_id)]) return;
    already[String(it.order_item_id)] = (already[String(it.order_item_id)] || 0) + (parseFloat(it.qty) || 0);
  });

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var lines = [];
  tenantRowsWhere(tenantId, 'order_items', 'order_id', order.record_id).forEach(function(it) {
    var shipped = shippedByItem[String(it.record_id)];
    if (shipped === undefined) shipped = parseFloat(it.qty) || 0;
    var done = already[String(it.record_id)] || 0;
    var left = shipped - done;
    if (!(left > 0)) return;
    var p = products[String(it.product_id)] || {};
    var ordered = parseFloat(it.qty) || 0;
    var unitNet = ordered > 0 ? ((parseFloat(it.line_total) || 0) - (parseFloat(it.line_discount) || 0)) / ordered : 0;
    lines.push({ itemId: it.record_id, productId: it.product_id, productCode: p.product_code || '',
      productName: p.name || '(สินค้าถูกลบ)', unitCode: it.unit_code || '', unitFactor: _drLineFactor(it),
      shipped: shipped, returned: done, returnable: left, unitPrice: _money(unitNet),
      taxStatus: String(it.tax_status || '') || TAX_VAT, isFree: String(it.is_free) === '1' });
  });

  /* ★ คลังปลายทางที่เลือกได้ — สร้างคลังรับคืน/ของเสียให้ครั้งแรกที่เปิดฟอร์ม จะได้ไม่ต้องไปตั้งค่าก่อน
     เรียงคลังขายขึ้นก่อนเสมอ เพราะเป็นตัวที่เลือกบ่อยที่สุด */
  var scope = _saleStockScope(tenantId);
  var saleWhId = _ensureScopeWarehouse(scope);
  var quarantineId = _ensureWarehouseByPurpose(scope, 'quarantine');
  var scrapId = _ensureWarehouseByPurpose(scope, 'scrap');
  var ORDER = { sale: 0, quarantine: 1, scrap: 2 };
  var dests = _scoped('warehouses', scope).filter(function(w) { return _isTrue(w.is_active); })
    .map(function(w) {
      return { id: w.record_id, name: w.name, code: w.code || '', purpose: _whPurpose(w),
        purposeLabel: WH_PURPOSES[_whPurpose(w)], sellable: _isSellableWarehouse(w) };
    });
  dests.sort(function(a, b) { return (ORDER[a.purpose] - ORDER[b.purpose]) || (a.id - b.id); });

  return { success: true, reasons: GRN_REASONS,
    conditions: Object.keys(GRN_CONDITIONS).map(function(k) {
      return { code: k, label: GRN_CONDITIONS[k].label, restock: GRN_CONDITIONS[k].restock };
    }),
    warehouses: dests,
    defaultWarehouseId: { good: saleWhId, damaged: scrapId, expired: scrapId, quarantine: quarantineId },
    order: { id: order.record_id, orderCode: order.order_code, customerId: order.customer_id,
      status: order.status, taxInvoiceNo: order.tax_invoice_no || '' },
    lines: lines };
}

/** payload: { orderId, returnDate?, reasonCode, reason?, note?, lines:[{itemId, qty, condition, warehouseId}] }
 *  ★ `warehouseId` ว่าง = ใช้ค่าตั้งต้นตามสภาพของ (ของเดิมที่ยังไม่ส่งค่ามาจึงทำงานเหมือนเดิม) */
function createGoodsReturn(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  return _withDocLock(function() {
    return _goodsReturnCore(session, _effectiveTenantId(session, payload), payload);
  });
}
/* ★★ แกนกลาง — **ไม่จับ `_withDocLock` เอง** เพราะฝั่งใบลดหนี้เรียกตัวนี้ตอนที่ถือ lock อยู่แล้ว
   จับซ้ำซ้อนกันในการรันเดียวคือทางที่จะได้ deadlock แบบหาสาเหตุยาก · ตัวเรียกต้องถือ lock มาเอง
   ★ `payload.creditNoteId` = ใบนี้ถูกสร้างอัตโนมัติจากใบลดหนี้ (ผูกกลับไปหาใบนั้น และทำให้ยกเลิกเดี่ยวๆ ไม่ได้) */
function _goodsReturnCore(session, tenantId, payload) {
  {
    var order = tenantRowById(tenantId, 'sales_orders', payload.orderId);
    if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

    var date = payload.returnDate || _todayStr();
    if (!_validDate(date)) return { success: false, message: 'วันที่รับคืนต้องเป็น yyyy-MM-dd' };
    var reasonCode = String(payload.reasonCode || '');
    var reason = String(payload.reason || GRN_REASONS[reasonCode] || '').trim();
    if (!reason) return { success: false, message: 'ต้องระบุเหตุผลที่รับคืน' };

    var draft = _goodsReturnDraftCore(tenantId, payload.orderId);
    if (!draft.success) return draft;
    var byItem = {};
    draft.lines.forEach(function(l) { byItem[String(l.itemId)] = l; });
    var scope = _saleStockScope(tenantId);
    var whById = {}, defaultDest = draft.defaultWarehouseId;
    _scoped('warehouses', scope).forEach(function(w) { if (_isTrue(w.is_active)) whById[String(w.record_id)] = w; });

    var picked = [], amount = 0;
    (payload.lines || []).forEach(function(l) {
      var src = byItem[String(l.itemId)];
      if (!src) return;
      var qty = parseFloat(l.qty) || 0;
      if (!(qty > 0)) return;
      /* ★ รับคืนเกินที่ส่งไปไม่ได้ — ปฏิเสธทั้งใบ ไม่ตัดให้พอดีเงียบๆ
         ตัดให้เองแล้วคนจะไม่รู้ว่าของที่นับได้หน้างานกับในระบบไม่ตรงกัน */
      if (qty > src.returnable + 0.0001) {
        picked = null;
        return;
      }
      var cond = GRN_CONDITIONS[String(l.condition)] ? String(l.condition) : 'good';
      /* ★ คลังปลายทางมาจากคนรับ ไม่ได้เดาจากสภาพของ · ส่งมาเป็นคลังนอก scope หรือคลังที่ปิดใช้งานแล้ว
         = ปฏิเสธทั้งใบ ไม่เงียบๆ ไปลงคลังตั้งต้นแทน (ของจะไปกองผิดที่โดยไม่มีใครรู้) */
      var destId = String(l.warehouseId || '') || String(defaultDest[cond] || defaultDest.good);
      if (!whById[destId]) { picked = null; return; }
      picked.push({ src: src, qty: qty, condition: cond, baseQty: qty * (src.unitFactor || 1),
        warehouseId: destId, sellable: _isSellableWarehouse(whById[destId]),
        amount: _money(qty * src.unitPrice) });
      amount += qty * src.unitPrice;
    });
    if (picked === null) return { success: false, message: 'รับคืนเกินจำนวนที่ส่งไปแล้ว หรือเลือกคลังปลายทางที่ใช้ไม่ได้' };
    if (!picked.length) return { success: false, message: 'ต้องมีรายการอย่างน้อย 1 รายการ' };

    var returnId = centralNextId('goods_returns');
    var returnNo = _nextCentralDocNo('GRN', _normBook(tenantId) || undefined);
    /* ★ นับจาก "คลังที่ของเข้าไปจริง" ไม่ใช่จากสภาพของ — คนรับอาจส่งของสภาพดีเข้าคลังรอตรวจ
       ตัวเลขสองตัวนี้ไปโผล่ในรายการและบนเอกสาร ต้องตรงกับของที่ขายได้จริง */
    var restockQty = 0, scrapQty = 0;
    picked.forEach(function(p) { if (p.sellable) restockQty += p.baseQty; else scrapQty += p.baseQty; });

    centralAppend('goods_returns', { record_id: returnId, tenant_id: tenantId || '', return_no: returnNo,
      sales_order_id: order.record_id, order_code: order.order_code, customer_id: order.customer_id,
      return_date: date, reason_code: reasonCode, reason: reason, item_count: picked.length,
      amount: _money(amount), restock_qty: restockQty, scrap_qty: scrapQty,
      credit_note_id: String(payload.creditNoteId || ''), status: 'received', note: String(payload.note || ''),
      received_by: session.adminUserId, created_at: nowStr() });
    var itemId = centralNextId('goods_return_items');
    centralAppendMany('goods_return_items', picked.map(function(p, i) {
      return { record_id: itemId + i, return_id: returnId, order_item_id: p.src.itemId,
        product_id: p.src.productId, unit_code: p.src.unitCode, unit_factor: p.src.unitFactor,
        qty: p.qty, base_qty: p.baseQty, condition: p.condition, warehouse_id: p.warehouseId,
        restock: p.sellable ? 'TRUE' : 'FALSE',
        unit_price: p.src.unitPrice, amount: p.amount, tax_status: p.src.taxStatus };
    }));

    /* ★★ ของเข้าคลัง **ทุกบรรทัด** ตามคลังที่คนรับเลือก (23 ต.ค. 2026)
       เดิมของเสียไม่ถูกบันทึกเข้าคลังไหนเลย เหลือแค่ตัวเลข scrap_qty ในใบ — ของจริงยังกองอยู่หลังร้าน
       แต่ไม่มีใบไหนบอกว่าอยู่ที่ไหนเท่าไร ตรวจนับทีก็อธิบายไม่ได้ว่าของส่วนเกินมาจากไหน
       ★ ของที่เข้าคลังที่ไม่ใช่คลังขาย **ไม่ถูกนับเป็นของขายได้** เพราะการขายตัดจากคลังหลักเท่านั้น
         (`_ensureScopeWarehouse`) และทุกที่ที่รวมยอดข้ามคลังกรองด้วย `_isSellableWarehouse()` */
    var moved = 0, byWh = {};
    var cost = {};
    _scoped('warehouse_stock', scope).forEach(function(r) {
      // ต้นทุนอ้างจากคลังขายเสมอ — ของที่เข้าคลังรอตรวจ/ของเสียต้องตีมูลค่าเท่าของเดิม ไม่ใช่ศูนย์
      if (String(r.warehouse_id) === String(defaultDest.good)) cost[String(r.product_id)] = Number(r.avg_cost) || 0;
    });
    picked.forEach(function(p) {
      _applyStockIn(scope, p.warehouseId, p.src.productId, p.baseQty, cost[String(p.src.productId)] || 0,
        'sale_return', 'GOODS_RETURN', returnId, returnNo + ': ' + reason, session.adminUserId);
      moved++;
      var nm = (whById[String(p.warehouseId)] || {}).name || '';
      byWh[nm] = (byWh[nm] || 0) + p.baseQty;
    });

    return { success: true, returnId: returnId, returnNo: returnNo, amount: _money(amount),
      restocked: moved, restockQty: restockQty, scrapQty: scrapQty,
      message: 'รับคืนสินค้า ' + returnNo + ' · ' + Object.keys(byWh).map(function(k) {
        return k + ' ' + byWh[k] + ' หน่วย';
      }).join(' · ') };
  }
}

function listGoodsReturns(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _effectiveTenantId(session, payload);
  var cust = {};
  centralObjects('customers').forEach(function(c) { cust[String(c.record_id)] = customerFullName(c); });
  var rows = centralObjects('goods_returns').filter(function(g) {
    if (String(g.tenant_id || '') !== String(tenantId || '')) return false;
    if (payload.orderId && String(g.sales_order_id) !== String(payload.orderId)) return false;
    return true;
  }).map(function(g) {
    return { id: g.record_id, returnNo: g.return_no, returnDate: _dOnly(g.return_date),
      salesOrderId: g.sales_order_id, orderCode: g.order_code || '',
      customerName: cust[String(g.customer_id)] || '', reason: g.reason || '', reasonCode: g.reason_code || '',
      itemCount: _int(g.item_count), amount: _money(Number(g.amount) || 0),
      restockQty: Number(g.restock_qty) || 0, scrapQty: Number(g.scrap_qty) || 0,
      creditNoteId: g.credit_note_id || '', status: g.status || 'received',
      statusLabel: GRN_STATUS[String(g.status)] || g.status, note: g.note || '' };
  });
  rows.sort(function(a, b) { return String(b.returnDate).localeCompare(String(a.returnDate)) || (b.id - a.id); });
  return { success: true, data: rows.slice(0, _int(payload.limit) || 200) };
}

function getGoodsReturn(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var g = _findById('goods_returns', payload.id);
  if (!g) return { success: false, message: 'ไม่พบใบรับคืนนี้' };
  var tenantId = _effectiveTenantId(session, payload);
  if (String(g.tenant_id || '') !== String(tenantId || '')) return { success: false, message: 'ไม่พบใบรับคืนนี้' };

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  // ★ ชื่อคลังปลายทางต้องอยู่บนเอกสาร — เป็นสิ่งที่คนไปตามของต้องรู้ว่าไปหยิบที่ไหน
  var whName = {};
  centralObjects('warehouses').forEach(function(w) { whName[String(w.record_id)] = w.name; });
  var customer = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(g.customer_id)) customer = c; });
  var items = centralObjects('goods_return_items').filter(function(it) {
    return String(it.return_id) === String(g.record_id);
  }).map(function(it) {
    var p = products[String(it.product_id)] || {};
    return { productId: it.product_id, productCode: p.product_code || '', productName: p.name || '',
      unitCode: it.unit_code || '', qty: Number(it.qty) || 0, condition: it.condition || 'good',
      conditionLabel: (GRN_CONDITIONS[String(it.condition)] || {}).label || it.condition,
      restock: isFlagOn(it.restock), warehouseId: it.warehouse_id || '',
      warehouseName: whName[String(it.warehouse_id)] || (isFlagOn(it.restock) ? 'คลังขาย' : '—'),
      unitPrice: _money(Number(it.unit_price) || 0),
      amount: _money(Number(it.amount) || 0), taxStatus: it.tax_status || TAX_VAT, itemId: it.order_item_id };
  });
  return { success: true,
    note: { id: g.record_id, returnNo: g.return_no, returnDate: _dOnly(g.return_date), orderCode: g.order_code || '',
      salesOrderId: g.sales_order_id, reason: g.reason || '', amount: _money(Number(g.amount) || 0),
      restockQty: Number(g.restock_qty) || 0, scrapQty: Number(g.scrap_qty) || 0,
      creditNoteId: g.credit_note_id || '', status: g.status || 'received',
      statusLabel: GRN_STATUS[String(g.status)] || g.status, note: g.note || '' },
    customer: customer ? { id: customer.record_id, name: customerFullName(customer), code: customer.customer_code || '',
      address: customer.address || '', taxId: customer.tax_id || '', branchCode: customer.tax_branch_code || '',
      phone: customer.phone || '' } : null,
    items: items, issuer: typeof _docIssuer === 'function' ? _docIssuer(_normBook(tenantId)) : null };
}

/**
 * ออกใบลดหนี้จากใบรับคืน — เส้นทางปกติของงานนี้
 * ★★ บังคับ `moveStock = false` เพราะ **ของเข้าคลังไปแล้วตอนรับคืน**
 *   ปล่อยให้ใบลดหนี้ขยับอีกรอบ = สต็อกงอกเป็นสองเท่าโดยไม่มีใครเห็น
 */
function createCreditNoteFromReturn(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  var g = _findById('goods_returns', payload.returnId);
  if (!g) return { success: false, message: 'ไม่พบใบรับคืนนี้' };
  if (String(g.status) === 'cancelled') return { success: false, message: 'ใบรับคืนนี้ถูกยกเลิกแล้ว' };
  if (String(g.credit_note_id || '').trim()) return { success: false, message: 'ใบรับคืนนี้ออกใบลดหนี้ไปแล้ว' };

  var iv = null;
  centralObjects('ar_invoices').forEach(function(x) {
    if (String(x.status) === 'void') return;
    if (String(x.sales_order_id) !== String(g.sales_order_id)) return;
    iv = x;
  });
  if (!iv) return { success: false, message: 'บิลขายนี้ยังไม่มีใบแจ้งหนี้ลูกหนี้ — ออกใบลดหนี้จากใบแจ้งหนี้ไม่ได้' };

  var lines = centralObjects('goods_return_items').filter(function(it) {
    return String(it.return_id) === String(g.record_id);
  }).map(function(it) {
    return { itemId: it.order_item_id, productId: it.product_id, unitCode: it.unit_code,
      unitFactor: Number(it.unit_factor) || 1, qty: Number(it.qty) || 0,
      unitPrice: Number(it.unit_price) || 0, taxStatus: it.tax_status || TAX_VAT };
  });
  var r = createArCreditNote(session, { invoiceId: iv.record_id, tenantId: payload.tenantId,
    reasonCode: 'return', reason: 'รับคืนตามใบ ' + g.return_no + ' — ' + (g.reason || ''),
    creditDate: payload.creditDate || _todayStr(),
    moveStock: false, returnStock: false,                 // ★ ของเข้าคลังไปแล้วตอนรับคืน
    lines: lines });
  if (!r.success) return r;
  centralUpdate('goods_returns', g.record_id, { credit_note_id: r.noteId });
  return { success: true, returnId: g.record_id, creditNoteId: r.noteId, creditNoteNo: r.noteNo,
    total: r.total, message: 'ออกใบลดหนี้ ' + r.noteNo + ' จากใบรับคืน ' + g.return_no };
}

/** ยกเลิกใบรับคืน — ของที่เคยรับเข้าคลังถูกหักออกคืน */
function cancelGoodsReturn(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  return _withDocLock(function() {
    var g = _findById('goods_returns', payload.id);
    if (!g) return { success: false, message: 'ไม่พบใบรับคืนนี้' };
    if (String(g.status) === 'cancelled') return { success: false, message: 'ใบนี้ถูกยกเลิกไปแล้ว' };
    /* ★ ออกใบลดหนี้ไปแล้วยกเลิกไม่ได้ — ใบลดหนี้เป็นเอกสารภาษีที่ส่งลูกค้าไปแล้ว
       ต้องไปจัดการที่ใบลดหนี้ก่อน ไม่ใช่ถอนใบรับคืนออกจากใต้มันเงียบๆ */
    if (String(g.credit_note_id || '').trim())
      return { success: false, message: 'ใบรับคืนนี้ออกใบลดหนี้ไปแล้ว ยกเลิกไม่ได้' };

    var tenantId = g.tenant_id || '';
    var scope = _saleStockScope(tenantId), warehouseId = _ensureScopeWarehouse(scope);
    var cost = {};
    _scoped('warehouse_stock', scope).forEach(function(r) {
      if (String(r.warehouse_id) === String(warehouseId)) cost[String(r.product_id)] = Number(r.avg_cost) || 0;
    });
    centralObjects('goods_return_items').forEach(function(it) {
      if (String(it.return_id) !== String(g.record_id)) return;
      /* ★★ หักออกจาก **คลังที่ของเข้าไปจริง** ไม่ใช่คลังหลักเสมอไป — หักผิดคลังคือสร้างของขึ้นมา
         จากอากาศในคลังหนึ่งและทำให้อีกคลังติดลบ สองแผลพร้อมกันโดยตัวเลขรวมยังดูถูก
         ★ แถวเก่าก่อน 23 ต.ค. 2026 ไม่มี `warehouse_id` — ตอนนั้นมีแต่ของสภาพดีที่เข้าคลังหลัก
           จึงหักจากคลังหลักตามเดิม ส่วนของเสียไม่เคยเข้าคลัง ข้ามไป */
      var wh = String(it.warehouse_id || '');
      if (!wh) { if (!isFlagOn(it.restock)) return; wh = warehouseId; }
      _applyStockIn(scope, wh, it.product_id, -(Number(it.base_qty) || 0),
        cost[String(it.product_id)] || 0, 'sale_out', 'GOODS_RETURN', g.record_id,
        'ยกเลิกใบรับคืน ' + g.return_no, session.adminUserId);
    });
    centralUpdate('goods_returns', g.record_id, { status: 'cancelled',
      note: [g.note, 'ยกเลิก: ' + String(payload.reason || '-')].filter(function(x) { return x; }).join(' · ') });
    return { success: true, message: 'ยกเลิกใบรับคืน ' + g.return_no + ' แล้ว — ของที่รับเข้าคลังถูกหักออกคืน' };
  });
}
