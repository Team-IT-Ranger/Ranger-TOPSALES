/**
 * ===================== SALES (Mobile App — Cash Van) =====================
 * payload: {
 *   customerId, items:[{productId,qty,unitCode}], freeGoods:[{ruleId,productId,qty,applied}],
 *   paymentType, fulfillmentType('immediate'|'office_delivery', default immediate),
 *   latitude, longitude, googleMap
 * }
 *
 * ราคา/หน่วย/ส่วนลด/ของแถม คำนวณซ้ำเสมอฝั่งเซิร์ฟเวอร์จากข้อมูล master (products/product_units) —
 * ไม่เชื่อ price จาก client เด็ดขาด (client ส่งแค่ productId/qty/unitCode) กัน request ปลอมราคา
 *
 * หน่วยขาย: unitCode ว่าง/ตรงกับหน่วยฐาน → factor=1, ไม่งั้น lookup จาก product_units (เช่น "CT"=ลัง factor 12)
 * qty ที่เก็บใน order_items คือ "หน่วยที่ขายจริง" (ตรงกับที่ขึ้นบิล) — base_qty คือแปลงเป็นหน่วยฐานแล้ว
 * ใช้ตัดสต็อก/เช็คเงื่อนไขโปรโมชั่นเท่านั้น (แนวทางเดียวกับไฟล์ export ของ SmartVan BackOffice ที่เจอ
 * มี UnitCode+UnitFactor แยกจาก Qty)
 *
 * fulfillmentType='immediate'      → ตัดสต็อกบนรถทันที (คนขายมีของบนรถ ขายจบในที่)
 * fulfillmentType='office_delivery'→ ไม่ตัดสต็อกรถ บันทึกเป็น SO รอสำนักงานจัดส่ง (status='pending_delivery')
 */
// ── คิดราคาตะกร้าล้วนๆ ไม่แตะสต็อก/ไม่บันทึกอะไร — ใช้ร่วมกันทั้ง recordSale (มือถือ) และฝั่งแอดมิน (19_sales_admin.gs)
// rawItems: [{productId, qty, unitCode}]   คืน { success, items, calc, priceListUsed } หรือ { success:false, message, code? }
function _priceSaleCart(customerId, rawItems, paymentType, isVan) {
  if (!rawItems || !rawItems.length) return { success: false, message: 'ไม่มีรายการสินค้า' };

  var productMap = {};
  centralObjects('products').forEach(function(p) { productMap[String(p.record_id)] = p; });
  var unitMap = {};
  centralObjects('product_units').forEach(function(u) { unitMap[String(u.product_id) + '_' + normUnitCode(u.unit_code)] = u; });

  var items = [];
  for (var ri = 0; ri < rawItems.length; ri++) {
    var raw = rawItems[ri];
    var p = productMap[String(raw.productId)];
    if (!p) return { success: false, message: 'ไม่พบสินค้า: ' + raw.productId };

    var qty = parseInt(raw.qty) || 0;
    if (qty <= 0) return { success: false, message: 'จำนวนสินค้าต้องมากกว่า 0' };

    var unitCode = normUnitCode(raw.unitCode, '');
    var unitFactor = 1, unitPrice = parseFloat(p.base_price) || 0;
    if (unitCode && !isBaseUnit(unitCode)) {
      var u = unitMap[String(raw.productId) + '_' + unitCode];
      if (!u) return { success: false, message: 'ไม่พบหน่วยขาย "' + unitLabelOf(unitCode) + '" ของสินค้า ' + p.name };
      unitFactor = parseFloat(u.unit_factor) || 1;
      unitPrice = parseFloat(u.price) || 0;
    } else {
      unitCode = UNIT_PC;                 // หน่วยฐานของทั้งระบบ = ชิ้น
    }

    items.push({
      productId: String(raw.productId), groupId: parseInt(p.group_id) || 0,
      unitCode: unitCode, unitFactor: unitFactor, qty: qty, price: unitPrice,
      lineTotal: unitPrice * qty, baseQty: qty * unitFactor, basePrice: unitFactor ? (unitPrice / unitFactor) : unitPrice
    });
  }

  // แปลงเป็นหน่วยฐานล้วนๆ ให้เครื่องยนต์โปรโมชั่น (ผลรวม price×qty เท่าเดิมเสมอ ไม่ว่าจะคิดหน่วยไหน)
  var itemsWithGroup = items.map(function(it) { return { productId: it.productId, qty: it.baseQty, price: it.basePrice, groupId: it.groupId }; });

  // ── ชุดราคาตามกลุ่มลูกค้า (17/18_pricing*.gs) ──
  // ร้านที่กลุ่มของร้านมีชุดราคา "ใช้งาน" ณ วันนี้ → ชุดราคาเป็นแหล่งราคาเดียว (ขั้นบันได/เงินสด-เครดิต/แพ็คเฉพาะ Cash Van/
  // โปรท้ายบิล) ห้ามซ้อนกับ discount_rules แบบเดิม (ส่วนลดจะเบิ้ล) และสินค้าที่ไม่อยู่ในชุดราคา = ขายไม่ได้ (ดีกว่าขายผิดราคา)
  // ไม่มีชุดราคาที่ใช้ได้ → ทำงานแบบเดิมทุกอย่าง
  var pricingCtx = getPricingContext(_customerGroupId(customerId));
  var priceListUsed = null;
  var calc;
  if (pricingCtx) {
    var priced = priceCart(pricingCtx,
      items.map(function(it) { return { productId: it.productId, unitCode: it.unitCode, qty: it.qty }; }),
      { isCredit: isCreditPayment(paymentType), isVan: !!isVan });
    if (!priced.success) return { success: false, message: priced.message, code: priced.code };
    items.forEach(function(it, i) { it.price = priced.lines[i].unitPrice; it.lineTotal = priced.lines[i].lineTotal; });
    priceListUsed = pricingCtx.list;
    calc = { subtotal: priced.subtotal, discount: priced.billDiscount, total: priced.total, freeGoods: [],
             appliedRules: priced.billPercent ? [{ ruleId: 'BILL', ruleName: 'ส่วนลดท้ายบิล ' + priced.billPercent + '% (ยอดรวมครบ ' + priced.billMinExVat + ' บาท ไม่รวม VAT)', type: 'percent', value: priced.billPercent }] : [] };
  } else {
    calc = applyPromotions(itemsWithGroup, customerId);
  }

  return { success: true, items: items, calc: calc, priceListUsed: priceListUsed };
}

function recordSale(user, payload) {
  var fulfillmentType = payload.fulfillmentType === 'office_delivery' ? 'office_delivery' : 'immediate';

  // สถานะลูกค้าเป็นตัวกั้น: ปิดการใช้งาน = ขายไม่ได้ · ระงับเครดิต = ขายได้เฉพาะเงินสด (ดู 33_customers.gs)
  if (payload.customerId) {
    var custRow = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(payload.customerId)) custRow = c; });
    var gate = customerSaleGate(custRow, payload.paymentType);
    if (gate) return gate;
  }

  var priced = _priceSaleCart(payload.customerId, payload.items || [], payload.paymentType, user.role === 'van_sales');
  if (!priced.success) return priced;
  var items = priced.items, calc = priced.calc, priceListUsed = priced.priceListUsed;

  var productMap = {};
  centralObjects('products').forEach(function(p) { productMap[String(p.record_id)] = p; });

  // เคารพการ "ยกเลิกรับของแถม" ที่ผู้ใช้ติ๊กออกจากฝั่ง client แต่ตัวของแถมเองต้องมาจากผลคำนวณฝั่งเซิร์ฟเวอร์เท่านั้น
  var requestedFreeOff = {};
  (payload.freeGoods || []).forEach(function(f) { if (f.applied === false) requestedFreeOff[String(f.ruleId) + '_' + String(f.productId)] = true; });
  var freeGoods = calc.freeGoods.filter(function(f) { return !requestedFreeOff[String(f.ruleId) + '_' + String(f.productId)]; });

  // เช็คสต็อกรถพอไหม (เฉพาะกรณีตัดสต็อกทันที)
  if (fulfillmentType === 'immediate') {
    var allStock = tenantObjects(user.tenantId, 'van_stock');
    var myStock = {};
    allStock.filter(function(s) { return String(s.line_user_id) === String(user.lineUserId); })
      .forEach(function(s) { myStock[String(s.product_id)] = parseInt(s.qty) || 0; });

    var need = {};
    items.forEach(function(it) { need[it.productId] = (need[it.productId] || 0) + it.baseQty; });
    freeGoods.forEach(function(f) { need[String(f.productId)] = (need[String(f.productId)] || 0) + f.qty; });

    var pids = Object.keys(need);
    for (var ci = 0; ci < pids.length; ci++) {
      var have = myStock[pids[ci]] || 0;
      if (have < need[pids[ci]]) return { success: false, message: 'สต็อกรถไม่พอ (สินค้า ' + pids[ci] + ' มี ' + have + ')' };
    }
  }

  var orderCode = getNextDocNumber(user.tenantId, 'SO');
  var orderId = tenantNextId(user.tenantId, 'sales_orders');
  var createdAt = nowStr();

  tenantAppend(user.tenantId, 'sales_orders', {
    record_id: orderId, order_code: orderCode, customer_id: payload.customerId || 0,
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    payment_method: payload.paymentType || 'cash', fulfillment_type: fulfillmentType,
    status: fulfillmentType === 'immediate' ? 'completed' : 'pending_delivery',
    sale_by: user.lineUserId, lat: payload.latitude || '', lng: payload.longitude || '',
    map: payload.googleMap || '', note: priceListUsed ? ('ชุดราคา: ' + priceListUsed.name) : '', created_at: createdAt
  });

  bumpSalesDaily(user.tenantId, createdAt.substring(0, 10), 1, calc.total);   // ยอดสรุปรายวันของแดชบอร์ด
  touchCustomerLastSale(payload.customerId, createdAt);                       // วันที่ซื้อล่าสุด (ไว้หาร้านที่หายไปนาน)

  items.forEach(function(it) {
    tenantAppend(user.tenantId, 'order_items', {
      record_id: tenantNextId(user.tenantId, 'order_items'), order_id: orderId, product_id: it.productId,
      unit_code: it.unitCode, unit_factor: it.unitFactor, qty: it.qty, base_qty: it.baseQty,
      price: it.price, line_total: it.lineTotal, is_free: 0
    });
  });
  freeGoods.forEach(function(f) {
    tenantAppend(user.tenantId, 'order_items', {
      record_id: tenantNextId(user.tenantId, 'order_items'), order_id: orderId, product_id: f.productId,
      unit_code: '', unit_factor: 1, qty: f.qty, base_qty: f.qty,
      price: 0, line_total: 0, is_free: 1
    });
  });
  calc.appliedRules.forEach(function(r) {
    tenantAppend(user.tenantId, 'order_discounts', { record_id: tenantNextId(user.tenantId, 'order_discounts'), order_id: orderId, rule_id: r.ruleId, rule_name: r.ruleName, type: r.type, value: r.value, free_product_id: '', free_qty: '' });
  });

  if (fulfillmentType === 'immediate') {
    _cutVanStock(user.tenantId, user.lineUserId, need, orderId);
  }

  // ล็อก product_code ของสินค้าที่เพิ่งขายจริง กัน admin เปลี่ยนรหัสย้อนหลังจนเอกสาร/รายงานเก่าอ้างรหัสผิดของ
  // เช็ค productMap ในหน่วยความจำก่อน (มีอยู่แล้วจากด้านบน) เขียนเฉพาะตัวที่ยังไม่เคยถูกล็อกเท่านั้น —
  // กันไม่ให้ทุกการขายต้องเขียน Central Sheet ซ้ำๆ ทั้งที่ตัวเลขเดิมเซ็ตไปแล้วตั้งแต่ครั้งแรก
  var soldProductIds = {};
  items.forEach(function(it) { soldProductIds[it.productId] = true; });
  freeGoods.forEach(function(f) { soldProductIds[String(f.productId)] = true; });
  Object.keys(soldProductIds).forEach(function(pid) {
    var p = productMap[pid];
    if (p && !isFlagOn(p.has_transactions)) centralUpdate('products', pid, { has_transactions: 'TRUE' });
  });

  cacheClearUser(user.lineUserId);

  return { success: true, orderCode: orderCode, total: calc.total, discount: calc.discount, fulfillmentType: fulfillmentType };
}

// need: { productId: จำนวนหน่วยฐานที่จะตัดออกจากสต็อกรถ } — ค่าติดลบ = คืนสต็อกกลับ (ใช้ตอนยกเลิกบิล)
function _cutVanStock(tenantId, lineUserId, need, orderId, movementType) {
  var sh = tenantSheet(tenantId, 'van_stock');
  var data = sh.getDataRange().getValues();
  var hdr = data[0];
  var uidCol = hdr.indexOf('line_user_id'), pidCol = hdr.indexOf('product_id'), qtyCol = hdr.indexOf('qty');

  Object.keys(need).forEach(function(pid) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][uidCol]) === String(lineUserId) && String(data[i][pidCol]) === pid) {
        sh.getRange(i + 1, qtyCol + 1).setValue((parseInt(data[i][qtyCol]) || 0) - need[pid]);
        found = true; break;
      }
    }
    if (!found) sh.appendRow([lineUserId, pid, -need[pid]]);
    tenantAppend(tenantId, 'stock_movements', { record_id: tenantNextId(tenantId, 'stock_movements'), line_user_id: lineUserId, product_id: pid, change_qty: -need[pid], type: movementType || 'sale', ref_id: orderId, created_at: nowStr() });
  });
}

// ── ราคาในตะกร้า (Mobile) ก่อนกดขาย — ใช้เครื่องยนต์ชุดเดียวกับ recordSale เป๊ะ ผลจึงตรงกับบิลที่จะออก ──
// payload: { customerId, paymentType, items:[{productId, unitCode, qty}] }
// ไม่มีชุดราคาที่ใช้ได้ → { success:true, priceList:null } (ให้แอปใช้ราคาจากข้อมูลตั้งต้นแบบเดิม)
function quoteSale(user, payload) {
  var ctx = getPricingContext(_customerGroupId(payload.customerId));
  if (!ctx) return { success: true, priceList: null };
  var res = priceCart(ctx, (payload.items || []).map(function(it) { return { productId: it.productId, unitCode: it.unitCode, qty: it.qty }; }),
    { isCredit: isCreditPayment(payload.paymentType), isVan: user.role === 'van_sales' });
  if (res.success) res.priceList = { id: ctx.list.record_id, name: ctx.list.name };
  return res;
}
