/**
 * ===================== SALES (Admin App) =====================
 * ให้แอดมิน/แอดมินตัวแทนเปิดบิลขาย (Sales Order) เองได้โดยตรง — ไม่ต้องผ่านมือถือ
 * ใช้เครื่องยนต์คิดราคาชุดเดียวกับมือถือ (_priceSaleCart ใน 07_sales.gs) ผลจึงตรงกันเป๊ะ
 *
 * fulfillmentType:
 *  'office_delivery' (ค่าเริ่มต้น) → ไม่ตัดสต็อกรถ บันทึกเป็น SO รอสำนักงานจัดส่ง — ใช้กับเครดิต/ออเดอร์ที่ไม่ผูกกับรถคันไหน
 *  'immediate'        → ต้องระบุ soldByLineUserId (พนักงานขับรถ) ด้วย เพื่อตัดสต็อกรถของคนนั้นทันที — ใช้กับ PACK (ขายได้เฉพาะ Cash Van)
 */

// รายการบิลขายของตัวแทน (payload: { tenantId?, status?, customerId?, limit? })
function listSalesOrdersAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var custName = {};
  centralObjects('customers').forEach(function(c) { custName[String(c.record_id)] = c.name; });

  var rows = tenantObjects(tenantId, 'sales_orders');
  if (payload.status) rows = rows.filter(function(o) { return String(o.status) === String(payload.status); });
  if (payload.customerId) rows = rows.filter(function(o) { return String(o.customer_id) === String(payload.customerId); });

  var limit = parseInt(payload.limit) || 300;
  var data = rows
    .sort(function(a, b) { return safeDateStr(b.created_at).localeCompare(safeDateStr(a.created_at)); })
    .slice(0, limit)
    .map(function(o) { return {
      id: o.record_id, code: o.order_code, customerId: o.customer_id,
      customer: custName[String(o.customer_id)] || 'ลูกค้าทั่วไป',
      subtotal: parseFloat(o.subtotal) || 0, discount: parseFloat(o.discount) || 0, total: parseFloat(o.total) || 0,
      paymentMethod: o.payment_method, fulfillmentType: o.fulfillment_type, status: o.status,
      saleBy: o.sale_by, note: o.note || '', createdAt: safeDateStr(o.created_at)
    }; });
  return { success: true, data: data };
}

// รายละเอียดบิลขาย 1 ใบ (payload: { id, tenantId? })
function getSalesOrderAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var order = null;
  tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.id)) order = o; });
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c; });

  var items = tenantObjects(tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id); })
    .map(function(it) { var p = products[String(it.product_id)]; return {
      productId: it.product_id, productCode: p ? p.product_code : '', productName: p ? p.name : '(สินค้าถูกลบ)',
      unitCode: it.unit_code, unitFactor: it.unit_factor, qty: parseFloat(it.qty) || 0, baseQty: parseFloat(it.base_qty) || 0,
      price: parseFloat(it.price) || 0, lineTotal: parseFloat(it.line_total) || 0, isFree: String(it.is_free) === '1'
    }; });
  var discounts = tenantObjects(tenantId, 'order_discounts').filter(function(d) { return String(d.order_id) === String(order.record_id); });

  var cust = customers[String(order.customer_id)];
  return { success: true,
    order: {
      id: order.record_id, code: order.order_code, customerId: order.customer_id,
      customer: cust ? cust.name : 'ลูกค้าทั่วไป', customerPhone: cust ? cust.phone : '', customerAddress: cust ? cust.address : '',
      subtotal: parseFloat(order.subtotal) || 0, discount: parseFloat(order.discount) || 0, total: parseFloat(order.total) || 0,
      paymentMethod: order.payment_method, fulfillmentType: order.fulfillment_type, status: order.status,
      saleBy: order.sale_by, note: order.note || '', createdAt: safeDateStr(order.created_at)
    },
    items: items, discounts: discounts
  };
}

// ทดลองคิดราคาก่อนกดบันทึกจริง — เครื่องยนต์เดียวกับ recordSaleAdmin เป๊ะ (payload เหมือน recordSaleAdmin แต่ไม่บันทึก)
function previewSaleAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  if (!payload.customerId) return { success: false, message: 'กรุณาระบุลูกค้า' };

  var cust = _customerInTenant(payload.customerId, tenantId);
  if (!cust) return { success: false, message: 'ไม่พบลูกค้านี้ในตัวแทนจำหน่ายที่เลือก' };

  var isVan = payload.fulfillmentType === 'immediate';
  var priced = _priceSaleCart(payload.customerId, payload.items || [], payload.paymentType, isVan);
  if (!priced.success) return priced;

  return { success: true,
    lines: priced.items.map(function(it) { return { productId: it.productId, unitCode: it.unitCode, qty: it.qty, unitPrice: it.price, lineTotal: it.lineTotal }; }),
    freeGoods: priced.calc.freeGoods, subtotal: priced.calc.subtotal, discount: priced.calc.discount, total: priced.calc.total,
    priceListName: priced.priceListUsed ? priced.priceListUsed.name : null
  };
}

function _customerInTenant(customerId, tenantId) {
  var found = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(customerId) && String(c.tenant_id) === String(tenantId)) found = c; });
  return found;
}

// เปิดบิลขายจากแอดมินโดยตรง
// payload: { tenantId?, customerId, items:[{productId,unitCode,qty}], paymentType, fulfillmentType('office_delivery'|'immediate'),
//            soldByLineUserId? (จำเป็นถ้า fulfillmentType='immediate' — พนักงานที่จะถูกตัดสต็อกรถ), freeGoods?, note? }
function recordSaleAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  if (!payload.customerId) return { success: false, message: 'กรุณาระบุลูกค้า' };
  if (!_customerInTenant(payload.customerId, tenantId)) return { success: false, message: 'ไม่พบลูกค้านี้ในตัวแทนจำหน่ายที่เลือก' };

  var fulfillmentType = payload.fulfillmentType === 'immediate' ? 'immediate' : 'office_delivery';
  var soldByLineUserId = String(payload.soldByLineUserId || '').trim();
  if (fulfillmentType === 'immediate') {
    if (!soldByLineUserId) return { success: false, message: 'ตัดสต็อกทันทีต้องเลือกพนักงานขับรถที่จะตัดสต็อกให้ด้วย' };
    var staffOk = false;
    centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === soldByLineUserId && String(u.tenant_id) === String(tenantId)) staffOk = true; });
    if (!staffOk) return { success: false, message: 'ไม่พบพนักงานคนนี้ในตัวแทนจำหน่ายที่เลือก' };
  }

  var priced = _priceSaleCart(payload.customerId, payload.items || [], payload.paymentType, fulfillmentType === 'immediate');
  if (!priced.success) return priced;
  var items = priced.items, calc = priced.calc, priceListUsed = priced.priceListUsed;

  var requestedFreeOff = {};
  (payload.freeGoods || []).forEach(function(f) { if (f.applied === false) requestedFreeOff[String(f.ruleId) + '_' + String(f.productId)] = true; });
  var freeGoods = calc.freeGoods.filter(function(f) { return !requestedFreeOff[String(f.ruleId) + '_' + String(f.productId)]; });

  var need = {};
  if (fulfillmentType === 'immediate') {
    var myStock = {};
    tenantObjects(tenantId, 'van_stock').filter(function(s) { return String(s.line_user_id) === soldByLineUserId; })
      .forEach(function(s) { myStock[String(s.product_id)] = parseInt(s.qty) || 0; });

    items.forEach(function(it) { need[it.productId] = (need[it.productId] || 0) + it.baseQty; });
    freeGoods.forEach(function(f) { need[String(f.productId)] = (need[String(f.productId)] || 0) + f.qty; });

    var pids = Object.keys(need);
    for (var ci = 0; ci < pids.length; ci++) {
      var have = myStock[pids[ci]] || 0;
      if (have < need[pids[ci]]) return { success: false, message: 'สต็อกรถของพนักงานคนนี้ไม่พอ (สินค้า ' + pids[ci] + ' มี ' + have + ')' };
    }
  }

  var orderCode = getNextDocNumber(tenantId, 'SO');
  var orderId = tenantNextId(tenantId, 'sales_orders');
  var createdAt = nowStr();
  var saleBy = soldByLineUserId || ('admin:' + session.username);
  var noteParts = [];
  if (priceListUsed) noteParts.push('ชุดราคา: ' + priceListUsed.name);
  noteParts.push('เปิดจากแอดมินโดย ' + (session.displayName || session.username));
  if (payload.note) noteParts.push(String(payload.note));

  tenantAppend(tenantId, 'sales_orders', {
    record_id: orderId, order_code: orderCode, customer_id: payload.customerId,
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    payment_method: payload.paymentType || 'cash', fulfillment_type: fulfillmentType,
    status: fulfillmentType === 'immediate' ? 'completed' : 'pending_delivery',
    sale_by: saleBy, lat: '', lng: '', map: '', note: noteParts.join(' · '), created_at: createdAt
  });

  items.forEach(function(it) {
    tenantAppend(tenantId, 'order_items', {
      record_id: tenantNextId(tenantId, 'order_items'), order_id: orderId, product_id: it.productId,
      unit_code: it.unitCode, unit_factor: it.unitFactor, qty: it.qty, base_qty: it.baseQty,
      price: it.price, line_total: it.lineTotal, is_free: 0
    });
  });
  freeGoods.forEach(function(f) {
    tenantAppend(tenantId, 'order_items', {
      record_id: tenantNextId(tenantId, 'order_items'), order_id: orderId, product_id: f.productId,
      unit_code: '', unit_factor: 1, qty: f.qty, base_qty: f.qty,
      price: 0, line_total: 0, is_free: 1
    });
  });
  calc.appliedRules.forEach(function(r) {
    tenantAppend(tenantId, 'order_discounts', { record_id: tenantNextId(tenantId, 'order_discounts'), order_id: orderId, rule_id: r.ruleId, rule_name: r.ruleName, type: r.type, value: r.value, free_product_id: '', free_qty: '' });
  });

  if (fulfillmentType === 'immediate') {
    _cutVanStock(tenantId, soldByLineUserId, need, orderId, 'sale');
    cacheClearUser(soldByLineUserId);
  }

  // ล็อก product_code ของสินค้าที่เพิ่งขายจริง (เหมือน recordSale มือถือ)
  var productMap = {};
  centralObjects('products').forEach(function(p) { productMap[String(p.record_id)] = p; });
  var soldProductIds = {};
  items.forEach(function(it) { soldProductIds[it.productId] = true; });
  freeGoods.forEach(function(f) { soldProductIds[String(f.productId)] = true; });
  Object.keys(soldProductIds).forEach(function(pid) {
    var p = productMap[pid];
    if (p && String(p.has_transactions) !== 'TRUE') centralUpdate('products', pid, { has_transactions: 'TRUE' });
  });

  return { success: true, orderId: orderId, orderCode: orderCode, total: calc.total, discount: calc.discount, fulfillmentType: fulfillmentType };
}

// ยกเลิกบิลขาย — เฉพาะที่ยังไม่ถูกยกเลิกซ้ำ ถ้าเคยตัดสต็อกรถไปแล้ว (fulfillmentType='immediate') จะคืนสต็อกกลับให้อัตโนมัติ
// payload: { id, tenantId? }
function cancelSalesOrderAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var order = null;
  tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.id)) order = o; });
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
  if (order.status === 'cancelled') return { success: false, message: 'บิลนี้ถูกยกเลิกไปแล้ว' };

  // คืนสต็อกรถ ถ้าเคยตัดไปแล้วและ sale_by เป็นพนักงานจริง (ไม่ใช่ 'admin:' ที่ไม่ผูกกับรถคันไหน)
  if (order.fulfillment_type === 'immediate' && order.sale_by && String(order.sale_by).indexOf('admin:') !== 0) {
    var need = {};
    tenantObjects(tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id); })
      .forEach(function(it) { need[String(it.product_id)] = (need[String(it.product_id)] || 0) - (parseFloat(it.base_qty) || 0); });
    if (Object.keys(need).length) { _cutVanStock(tenantId, order.sale_by, need, order.record_id, 'cancel'); cacheClearUser(order.sale_by); }
  }

  var sh = tenantSheet(tenantId, 'sales_orders');
  var data = sh.getDataRange().getValues();
  var hdr = data[0], idCol = hdr.indexOf('record_id'), statusCol = hdr.indexOf('status');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(order.record_id)) { sh.getRange(i + 1, statusCol + 1).setValue('cancelled'); break; }
  }
  return { success: true };
}
