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
function recordSale(user, payload) {
  var rawItems = payload.items || [];
  if (!rawItems.length) return { success: false, message: 'ไม่มีรายการสินค้า' };

  var fulfillmentType = payload.fulfillmentType === 'office_delivery' ? 'office_delivery' : 'immediate';

  var productMap = {};
  centralObjects('products').forEach(function(p) { productMap[String(p.record_id)] = p; });
  var unitMap = {};
  centralObjects('product_units').forEach(function(u) { unitMap[String(u.product_id) + '_' + u.unit_code] = u; });

  var items = [];
  for (var ri = 0; ri < rawItems.length; ri++) {
    var raw = rawItems[ri];
    var p = productMap[String(raw.productId)];
    if (!p) return { success: false, message: 'ไม่พบสินค้า: ' + raw.productId };

    var qty = parseInt(raw.qty) || 0;
    if (qty <= 0) return { success: false, message: 'จำนวนสินค้าต้องมากกว่า 0' };

    var unitCode = raw.unitCode;
    var unitFactor = 1, unitPrice = parseFloat(p.base_price) || 0;
    if (unitCode && unitCode !== p.unit) {
      var u = unitMap[String(raw.productId) + '_' + unitCode];
      if (!u) return { success: false, message: 'ไม่พบหน่วยขาย "' + unitCode + '" ของสินค้า ' + p.name };
      unitFactor = parseFloat(u.unit_factor) || 1;
      unitPrice = parseFloat(u.price) || 0;
    } else {
      unitCode = p.unit;
    }

    items.push({
      productId: String(raw.productId), groupId: parseInt(p.group_id) || 0,
      unitCode: unitCode, unitFactor: unitFactor, qty: qty, price: unitPrice,
      lineTotal: unitPrice * qty, baseQty: qty * unitFactor, basePrice: unitFactor ? (unitPrice / unitFactor) : unitPrice
    });
  }

  // แปลงเป็นหน่วยฐานล้วนๆ ให้เครื่องยนต์โปรโมชั่น (ผลรวม price×qty เท่าเดิมเสมอ ไม่ว่าจะคิดหน่วยไหน)
  var itemsWithGroup = items.map(function(it) { return { productId: it.productId, qty: it.baseQty, price: it.basePrice, groupId: it.groupId }; });
  var calc = applyPromotions(itemsWithGroup, payload.customerId);

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
    itemsWithGroup.forEach(function(it) { need[it.productId] = (need[it.productId] || 0) + it.qty; });
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
    map: payload.googleMap || '', note: '', created_at: createdAt
  });

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
    if (p && String(p.has_transactions) !== 'TRUE') centralUpdate('products', pid, { has_transactions: 'TRUE' });
  });

  cacheClearUser(user.lineUserId);

  return { success: true, orderCode: orderCode, total: calc.total, discount: calc.discount, fulfillmentType: fulfillmentType };
}

function _cutVanStock(tenantId, lineUserId, need, orderId) {
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
    tenantAppend(tenantId, 'stock_movements', { record_id: tenantNextId(tenantId, 'stock_movements'), line_user_id: lineUserId, product_id: pid, change_qty: -need[pid], type: 'sale', ref_id: orderId, created_at: nowStr() });
  });
}
