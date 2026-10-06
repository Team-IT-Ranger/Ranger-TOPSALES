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
      paymentStatus: orderPaymentStatus(o), paidAmount: parseFloat(o.paid_amount) || 0,
      deliveredAt: safeDateStr(o.delivered_at),
      // ★ แอดมินขอมา 6 ต.ค. 2026: ต้องรู้ว่าบิลมาจากพนักงานคนไหน · sale_by เก็บเป็น LINE user id
      // ซึ่งอ่านไม่ออก จึงแปลงเป็นชื่อด้วย _saleByLabel() ตัวเดียวกับที่รายงานการขายใช้ (41_sales_reports.gs)
      saleBy: o.sale_by, saleByName: _saleByLabel(o.sale_by),
      note: o.note || '', createdAt: safeDateStr(o.created_at)
    }; });
  return { success: true, data: data };
}

// รายละเอียดบิลขาย 1 ใบ (payload: { id, tenantId? })
function getSalesOrderAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  ensureTenantSheetsCurrent(tenantId);   // ไฟล์ที่สร้างก่อนมี tab ประวัติ/คอลัมน์สถานะการเงิน ต้องเติมก่อนอ่าน
  var order = null;
  tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.id)) order = o; });
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c; });

  var orderVat = _orderVat(order);
  var items = tenantObjects(tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id); })
    .map(function(it) { var p = products[String(it.product_id)]; var taxStatus = String(it.tax_status || '') || productTaxStatus(p);
      var lineTotal = parseFloat(it.line_total) || 0; return {
      productId: it.product_id, productCode: p ? p.product_code : '', productName: p ? p.name : '(สินค้าถูกลบ)',
      unitCode: it.unit_code, unitFactor: it.unit_factor, qty: parseFloat(it.qty) || 0, baseQty: parseFloat(it.base_qty) || 0,
      price: parseFloat(it.price) || 0, lineTotal: lineTotal, isFree: String(it.is_free) === '1',
      taxStatus: taxStatus,
      // ส่วนลดต่อบรรทัด (2026-09-30) — บิลเก่าก่อนมีคอลัมน์นี้อ่านเป็น '' → parseFloat ได้ NaN → || 0 ดักไว้
      unitDiscount: parseFloat(it.unit_discount) || 0, lineDiscount: parseFloat(it.line_discount) || 0,
      netTotal: lineTotal - (parseFloat(it.line_discount) || 0),
      // ★ (2) ราคาตั้งก่อนภาษี — บิลเก่าก่อนมีคอลัมน์นี้ list_price_ex_vat ว่าง → listBreakdown เป็น null (ซ่อนคอลัมน์เอง)
      listBreakdown: _lineListBreakdown(it.list_price_ex_vat, it.qty, lineTotal, taxStatus === TAX_VAT, orderVat.rate)
    }; });
  var discounts = tenantObjects(tenantId, 'order_discounts').filter(function(d) { return String(d.order_id) === String(order.record_id); });
  // ★ (2) ราคารวมหลังหักส่วนลดสินค้า (ก่อนโปร/ส่วนลดท้ายบิล) ไม่รวมภาษี — ส่วนลดท้ายบิลเป็นเศษที่เหลือ กันปัดเศษไม่ตรงกัน
  var preDiscountExVat = 0;
  items.forEach(function(it) { preDiscountExVat += it.taxStatus === TAX_VAT ? it.lineTotal / (1 + orderVat.rate) : it.lineTotal; });
  preDiscountExVat = _round2(preDiscountExVat);
  var billDiscountExVat = _round2(preDiscountExVat - orderVat.exVat);

  var cust = customers[String(order.customer_id)];
  var status = String(order.status || '');
  return { success: true,
    order: {
      id: order.record_id, code: order.order_code, customerId: order.customer_id,
      customer: cust ? customerFullName(cust) : 'ลูกค้าทั่วไป', customerCode: cust ? (cust.customer_code || '') : '',
      customerPhone: cust ? cust.phone : '', customerAddress: cust ? cust.address : '',
      customerShipTo: cust ? (cust.ship_to_address || '') : '', customerTaxId: cust ? (cust.tax_id || '') : '',
      customerTaxBranch: cust ? (cust.tax_branch_code || '') : '',
      subtotal: parseFloat(order.subtotal) || 0, discount: parseFloat(order.discount) || 0, total: parseFloat(order.total) || 0,
      vatRate: orderVat.rate, subtotalExVat: orderVat.exVat, vatAmount: orderVat.vat,
      exemptAmount: orderVat.exemptAmount, taxableExVat: orderVat.taxableExVat, vatMixed: orderVat.mixed,
      applyVat: orderVat.applyVat && orderVat.vat > 0, vatType: orderVat.vatType,
      // ★ (2) ราคาก่อนภาษีเป็นตัวตั้งต้น — ยอดสรุปบิลฝั่งไม่รวม VAT ก่อนบวก VAT ทีเดียวตอนท้าย (ดู subtotalExVat/vatAmount ด้านบน)
      subtotalAfterProductDiscountExVat: preDiscountExVat, billDiscountExVat: billDiscountExVat,
      paymentMethod: order.payment_method, fulfillmentType: order.fulfillment_type, status: status,
      statusLabel: SO_STATUS_LABELS[status] || status,
      paymentStatus: orderPaymentStatus(order), paymentLabel: SO_PAYMENT_LABELS[orderPaymentStatus(order)] || '',
      paidAmount: parseFloat(order.paid_amount) || 0,
      deliveredAt: safeDateStr(order.delivered_at), paidAt: safeDateStr(order.paid_at),
      nextStatuses: (SO_TRANSITIONS[status] || []).filter(function(x) { return x !== 'cancelled'; })
        .map(function(x) { return { code: x, label: SO_STATUS_LABELS[x] }; }),
      saleBy: order.sale_by, saleByName: _saleByLabel(order.sale_by),
      note: order.note || '', createdAt: safeDateStr(order.created_at),
      requestedDeliveryDate: safeDateStr(order.requested_delivery_date).substring(0, 10),
      centerEditedAt: safeDateStr(order.center_edited_at), centerEditedBy: order.center_edited_by || '',
      // แก้รายการได้เฉพาะขั้น "บันทึกรับงานแล้ว" และยังไม่มีการรับชำระ (ดู editSalesOrderAdmin ใน 34_sales_status.gs)
      canEditLines: status === SO_ACCEPTED && !(parseFloat(order.paid_amount) > 0) && hasPermission(session, 'sales', 'edit')
    },
    issuer: _docIssuer(session, tenantId),
    statusLog: orderStatusLog(tenantId, order.record_id),
    items: items, discounts: discounts
  };
}

/**
 * หัวเอกสาร = "ใครเป็นคนออกบิลนี้" — ตัวแทนออกในนามตัวแทน · บริษัทขายตรง (HOUSE) ออกในนามบริษัท
 * รวมมากับ getSalesOrderAdmin เลย เพื่อไม่ให้หน้าพิมพ์ต้องยิงคำขอเพิ่ม (ค่าคงที่ต่อคำขอ ~1.6 วิ)
 */
function _docIssuer(session, tenantId) {
  var tenant = null;
  centralObjects('tenants').forEach(function(t) { if (String(t.tenant_id) === String(tenantId)) tenant = t; });
  var co = _companyDto(_companyRow());
  if (!tenant || isFlagOn(tenant.is_house)) {
    return { name: co.legalName || co.name, taxId: co.taxId, branchCode: co.branchCode, address: co.address,
      phone: co.phone, email: co.email, logoUrl: co.logoUrl,
      bankName: co.bankName, bankAccountNo: co.bankAccountNo, bankAccountName: co.bankAccountName };
  }
  return { name: tenant.name || '', taxId: tenant.tax_id || '', branchCode: tenant.branch_code || '',
    address: tenant.address || '', phone: tenant.phone || '', email: tenant.email || '', logoUrl: tenant.logo_url || '',
    bankName: tenant.bank_name || '', bankAccountNo: tenant.bank_account_no || '', bankAccountName: tenant.bank_account_name || '' };
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
    lines: priced.items.map(function(it) { return { productId: it.productId, unitCode: it.unitCode, qty: it.qty, unitPrice: it.price, lineTotal: it.lineTotal,
      tierLabel: it.tierLabel || '', unitDiscount: it.unitDiscount || 0, lineDiscount: it.lineDiscount || 0, netTotal: it.netTotal != null ? it.netTotal : it.lineTotal,
      listBreakdown: it.listBreakdown || null }; }),
    freeGoods: priced.calc.freeGoods, subtotal: priced.calc.subtotal, discount: priced.calc.discount, total: priced.calc.total,
    // ให้คนเปิดบิลเห็นภาษีก่อนกดบันทึก — ตัวเลขชุดเดียวกับที่จะถูกบันทึกลงบิลจริง
    vatRate: priced.calc.vat.rate, subtotalExVat: priced.calc.vat.exVat, vatAmount: priced.calc.vat.vat,
    exemptAmount: priced.calc.vat.exemptAmount, taxableExVat: priced.calc.vat.taxableExVat, vatMixed: priced.calc.vat.mixed,
    applyVat: priced.calc.vat.applyVat, vatType: priced.calc.vat.vatType,
    // ★ (2) ราคาก่อนภาษีเป็นตัวตั้งต้น — ยอดสรุปบิลฝั่งไม่รวม VAT ก่อนบวก VAT ทีเดียวตอนท้าย
    subtotalAfterProductDiscountExVat: priced.calc.vat.subtotalAfterProductDiscountExVat, billDiscountExVat: priced.calc.vat.billDiscountExVat,
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
  var custRow = _customerInTenant(payload.customerId, tenantId);
  if (!custRow) return { success: false, message: 'ไม่พบลูกค้านี้ในตัวแทนจำหน่ายที่เลือก' };
  var custGate = customerSaleGate(custRow, payload.paymentType);   // ปิดการใช้งาน / ระงับเครดิต (ดู 33_customers.gs)
  if (custGate) return custGate;

  ensureTenantSheetsCurrent(tenantId);   // ไฟล์ตัวแทนที่สร้างก่อนมีคอลัมน์สถานะการเงิน/ประวัติ ต้องเติมให้ก่อนเขียน
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
  items.forEach(function(it) { need[it.productId] = (need[it.productId] || 0) + it.baseQty; });
  // หน่วยฐานเสมอ (ดูเหตุผลใน 07_sales.gs) — ของแถมเป็น "ลัง" แล้วตัดเป็นชิ้นคือตัดน้อยไปเป็นร้อยเท่า
  freeGoods.forEach(function(f) { need[String(f.productId)] = (need[String(f.productId)] || 0) + (Number(f.baseQty) || Number(f.qty) || 0); });

  var stockCheck = { success: true };
  if (fulfillmentType === 'immediate') {
    var myStock = {};
    tenantObjects(tenantId, 'van_stock').filter(function(s) { return String(s.line_user_id) === soldByLineUserId; })
      .forEach(function(s) { myStock[String(s.product_id)] = parseInt(s.qty) || 0; });

    var pids = Object.keys(need);
    for (var ci = 0; ci < pids.length; ci++) {
      var have = myStock[pids[ci]] || 0;
      if (have < need[pids[ci]]) return { success: false, message: 'สต็อกรถของพนักงานคนนี้ไม่พอ (สินค้า ' + pids[ci] + ' มี ' + have + ')' };
    }
  } else {
    // office_delivery: ตัดสต็อกจริงตอนเข้า "กำลังจัดส่ง" (34_sales_status.gs) แต่ต้องกันของไว้ตั้งแต่ตอนนี้ (ยอดจอง — guide ข้อ 1.3)
    // ไม่งั้นอีกบิลหนึ่งยืนยันของชิ้นเดียวกันได้พร้อมกัน แล้วไปเจอตอนจะตัดว่าของไม่พอ (สัญญากับลูกค้าไปแล้วทั้งสองราย)
    // ★ ของไม่พอ = แค่ warning ไม่บล็อกการบันทึก (ต่างจากขายจากรถด้านบน) ดูคอมเมนต์ที่ checkOfficeDeliveryStock (34_sales_status.gs)
    stockCheck = checkOfficeDeliveryStock(tenantId, need);
  }

  var orderCode = getNextDocNumber(tenantId, 'SO');
  var orderId = tenantNextId(tenantId, 'sales_orders');
  var createdAt = nowStr();
  var saleBy = soldByLineUserId || ('admin:' + session.username);
  var noteParts = [];
  if (priceListUsed) noteParts.push('ชุดราคา: ' + priceListUsed.name);
  noteParts.push('เปิดจากแอดมินโดย ' + (session.displayName || session.username));
  if (payload.note) noteParts.push(String(payload.note));

  var vatSplit = calc.vat;   // เหตุผลเดียวกับ recordSale (07_sales.gs)
  tenantAppend(tenantId, 'sales_orders', {
    record_id: orderId, order_code: orderCode, customer_id: payload.customerId,
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    apply_vat: vatSplit.applyVat ? 'TRUE' : 'FALSE', vat_type: vatSplit.vatType,
    vat_rate: vatSplit.rate, subtotal_ex_vat: vatSplit.exVat, vat_amount: vatSplit.vat, exempt_amount: vatSplit.exemptAmount,
    payment_method: payload.paymentType || 'cash', fulfillment_type: fulfillmentType,
    status: fulfillmentType === 'immediate' ? 'completed' : 'pending_delivery',
    payment_status: initialPaymentStatus(payload.paymentType, fulfillmentType),
    paid_amount: initialPaymentStatus(payload.paymentType, fulfillmentType) === 'paid' ? calc.total : 0,
    delivered_at: fulfillmentType === 'immediate' ? createdAt : '', paid_at: '',
    sale_by: saleBy, lat: '', lng: '', map: '', note: noteParts.join(' · '), created_at: createdAt
  });
  logOrderStatus(tenantId, orderId, '', fulfillmentType === 'immediate' ? 'completed' : 'pending_delivery',
    '', initialPaymentStatus(payload.paymentType, fulfillmentType), 'เปิดบิลจากแอดมิน',
    session.displayName || session.username, _adminRoleLabel(session));

  bumpSalesDaily(tenantId, createdAt.substring(0, 10), 1, calc.total);   // ยอดสรุปรายวันของแดชบอร์ด
  touchCustomerLastSale(payload.customerId, createdAt);                  // วันที่ซื้อล่าสุด (ไว้หาร้านที่หายไปนาน)

  items.forEach(function(it) {
    tenantAppend(tenantId, 'order_items', {
      record_id: tenantNextId(tenantId, 'order_items'), order_id: orderId, product_id: it.productId,
      unit_code: it.unitCode, unit_factor: it.unitFactor, qty: it.qty, base_qty: it.baseQty,
      price: it.price, line_total: it.lineTotal, unit_discount: it.unitDiscount || 0, line_discount: it.lineDiscount || 0,
      list_price_ex_vat: it.listPriceExVat != null ? it.listPriceExVat : '',
      is_free: 0, tax_status: calc.vat.taxOf(it.productId)
    });
  });
  freeGoods.forEach(function(f) {
    var fBase = Number(f.baseQty) || Number(f.qty) || 0, fQty = Number(f.qty) || 0;
    tenantAppend(tenantId, 'order_items', {
      record_id: tenantNextId(tenantId, 'order_items'), order_id: orderId, product_id: f.productId,
      unit_code: f.unitCode || UNIT_PC, unit_factor: fQty ? (fBase / fQty) : 1, qty: fQty, base_qty: fBase,
      price: 0, line_total: 0, is_free: 1
    });
  });
  calc.appliedRules.forEach(function(r) {
    tenantAppend(tenantId, 'order_discounts', { record_id: tenantNextId(tenantId, 'order_discounts'), order_id: orderId, rule_id: r.ruleId, rule_name: r.ruleName, type: r.type, value: r.value, free_product_id: '', free_qty: '' });
  });

  if (fulfillmentType === 'immediate') {
    _cutVanStock(tenantId, soldByLineUserId, need, orderId, 'sale');
    cacheClearUser(soldByLineUserId);
  } else {
    reserveStockForSale(tenantId, stockCheck.warehouseId, need, orderId);
  }

  // ล็อก product_code ของสินค้าที่เพิ่งขายจริง (เหมือน recordSale มือถือ)
  var productMap = {};
  centralObjects('products').forEach(function(p) { productMap[String(p.record_id)] = p; });
  var soldProductIds = {};
  items.forEach(function(it) { soldProductIds[it.productId] = true; });
  freeGoods.forEach(function(f) { soldProductIds[String(f.productId)] = true; });
  Object.keys(soldProductIds).forEach(function(pid) {
    var p = productMap[pid];
    if (p && !isFlagOn(p.has_transactions)) centralUpdate('products', pid, { has_transactions: 'TRUE' });
  });

  return { success: true, orderId: orderId, orderCode: orderCode, total: calc.total, discount: calc.discount, fulfillmentType: fulfillmentType,
    stockWarning: stockCheck.warning || '' };
}

// ยกเลิกบิลขาย — คืนของเข้าที่เดิมให้อัตโนมัติถ้าบิลนี้เลยจุดตัดสต็อกไปแล้ว (สต็อกรถ หรือ คลังกลาง)
// payload: { id, tenantId?, note? }
// อยู่ใต้ _withDocLock เพราะเขียนทั้งสต็อกคลังและยอดสรุปรายวัน — ต้องไม่ชนกับคำขออื่นที่กำลังขยับสต็อกอยู่
function cancelSalesOrderAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  ensureTenantSheetsCurrent(tenantId);
  return _withDocLock(function() { return _cancelSalesOrderCore(session, payload, tenantId); });
}

function _cancelSalesOrderCore(session, payload, tenantId) {
  var order = null;
  tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.id)) order = o; });
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
  if (order.status === 'cancelled') return { success: false, message: 'บิลนี้ถูกยกเลิกไปแล้ว' };

  // คืนของเข้าที่เดิม ถ้าบิลนี้เลยจุดตัดสต็อกไปแล้ว — saleStockTaken() คือนิยามเดียวกับที่ใช้ตอนตัดของ
  // ย้ายจุดตัดเมื่อไหร่ ตรงนี้ขยับตามเองทันที (guide ข้อ 1.4 · ดู 34_sales_status.gs)
  // ไม่คืน = ของหายจากระบบถาวรทั้งที่ยังวางอยู่ และไม่มีอะไรเตือนเลย เพราะยอดขายกับยอดสต็อกลดพร้อมกันดูสมเหตุสมผล
  if (saleStockTaken(order)) {
    if (String(order.fulfillment_type) === 'immediate') {
      // ขายจากรถ: คืนเข้าสต็อกรถของคนที่ขาย (บิลที่แอดมินเปิดเองแบบไม่ผูกกับรถคันไหน ไม่มีอะไรให้คืน)
      if (order.sale_by && String(order.sale_by).indexOf('admin:') !== 0) {
        var need = {};
        tenantObjects(tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id); })
          .forEach(function(it) { need[String(it.product_id)] = (need[String(it.product_id)] || 0) - (parseFloat(it.base_qty) || 0); });
        if (Object.keys(need).length) { _cutVanStock(tenantId, order.sale_by, need, order.record_id, 'cancel'); cacheClearUser(order.sale_by); }
      }
    } else {
      // สำนักงานจัดส่ง: ของถูกตัดจากคลังกลางตอนเข้าสถานะ "กำลังจัดส่ง" — คืนกลับเข้าคลังเดิม
      var back = applySaleWarehouseStock(tenantId, order, 1, 'ยกเลิกบิล ' + order.order_code, session.adminUserId);
      if (!back.success) return back;
    }
  } else {
    // ยังไม่ถึงจุดตัด (office_delivery ที่ยัง pending_delivery) — ของยังอยู่ในคลังเดิมเป๊ะ แค่ปลดจองก็พอ (guide ข้อ 1.4)
    // saleStockTaken() คืน true เสมอสำหรับ immediate จึงมาถึง else นี้ได้เฉพาะ office_delivery เท่านั้น
    releaseStockReservation(tenantId, order.record_id);
  }

  var sh = tenantSheet(tenantId, 'sales_orders');
  var data = sh.getDataRange().getValues();
  var hdr = data[0], idCol = hdr.indexOf('record_id'), statusCol = hdr.indexOf('status');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(order.record_id)) { sh.getRange(i + 1, statusCol + 1).setValue('cancelled'); break; }
  }
  bumpSalesDaily(tenantId, _dOnly(order.created_at), -1, -(parseFloat(order.total) || 0));   // หักออกจากยอดสรุปรายวัน
  logOrderStatus(tenantId, order.record_id, String(order.status || ''), 'cancelled', orderPaymentStatus(order), orderPaymentStatus(order),
    String(payload.note || 'ยกเลิกบิล'), session.displayName || session.username, _adminRoleLabel(session));
  return { success: true };
}
