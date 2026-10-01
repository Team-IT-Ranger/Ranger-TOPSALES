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
// แปลงผลดิบจาก computeFreeGoods() (39_free_goods.gs — setId/tierGroup/reason) เป็นรูปที่ทั้ง client และ
// recordSale ใช้ตัดสินใจร่วมกัน: ruleId ผูกโปร+ขั้นที่ชนะไว้ตัวเดียว (ใช้จับคู่ตอน client ส่ง opt-out
// payload.freeGoods[].applied=false กลับมา ดู recordSale) — ★ ใช้ทั้งที่นี่และ quoteSale ต้องเรียกตัวเดียวกัน
// เสมอ ไม่งั้น ruleId ที่ quoteSale โชว์ให้ผู้ใช้เห็นจะไม่ตรงกับที่ recordSale คาดหวังตอนจะ opt-out จริง
function _shapeFreeGoods(raw) {
  return (raw || []).map(function(f) {
    return { ruleId: 'FG' + f.setId + '-' + f.tierGroup, ruleName: f.setName + ' — ' + f.reason,
      productId: f.productId, qty: f.qty, unitCode: f.unitCode, baseQty: f.baseQty, applied: true };
  });
}

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

    // ★ แพ็คขายได้เฉพาะ Cash Van + เงินสด — ต้องเช็คตรงนี้ (ไม่ใช่แค่ใน priceCart) เพราะลูกค้าที่ยังไม่มีชุดราคา
    // ที่ใช้งานอยู่ (เช่น ตัวแทนที่เพิ่งเปิดใหม่ ยังไม่ได้จ่ายชุดราคาให้) จะข้าม priceCart() ไปใช้ discount_rules
    // แบบเดิมทั้งหมด ซึ่งไม่มีการเช็คกติกานี้เลย — เจอจริงตอนสร้างตัวแทนทดสอบใหม่แล้วขายแพ็คด้วยเครดิตผ่านฉลุย 2026-09-28
    if (isPackUnit(unitCode)) {
      if (!isVan) return { success: false, code: 'PACK_VAN_ONLY', productId: raw.productId, message: 'แพ็คขายได้เฉพาะ Cash Van เท่านั้น' };
      if (isCreditPayment(paymentType)) return { success: false, code: 'PACK_CASH_ONLY', productId: raw.productId, message: 'แพ็คขายได้เฉพาะเงินสด (ขายเครดิตต้องสั่งเป็นลัง)' };
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
  var pricingCtx = getPricingContextForCustomer(customerId);   // ผ่านกฎสิทธิ์ (36_price_rules.gs)
  var priceListUsed = null;
  var calc;
  if (pricingCtx) {
    var priced = priceCart(pricingCtx,
      items.map(function(it) { return { productId: it.productId, unitCode: it.unitCode, qty: it.qty }; }),
      { isCredit: isCreditPayment(paymentType), isVan: !!isVan });
    if (!priced.success) return { success: false, message: priced.message, code: priced.code };
    items.forEach(function(it, i) {
      var pl = priced.lines[i];
      it.price = pl.unitPrice; it.lineTotal = pl.lineTotal; it.tierLabel = pl.tierLabel || '';
      // ★ ส่วนลดต่อบรรทัด (2026-09-30) — priceCart() คำนวณ/กระจายให้แล้ว แค่ก๊อบมาตรงๆ (ดู _allocateLineDiscount, 18_pricing_engine.gs)
      it.unitDiscount = pl.unitDiscount || 0; it.lineDiscount = pl.lineDiscount || 0;
      it.netTotal = pl.netTotal != null ? pl.netTotal : pl.lineTotal;
      it.listPriceExVat = pl.listPriceExVat;   // ★ (2) ราคาตั้งก่อนภาษี — ดู _lineListBreakdown ด้านล่าง
    });
    priceListUsed = pricingCtx.list;
    /* ★ discount ที่บันทึกลงบิลต้องเป็นส่วนลด "รวมทุกชั้น" ให้ subtotal - discount = total เสมอ
       priced.total หักทั้งโปรโมชั่นและส่วนลดท้ายบิลไปแล้ว ถ้าบันทึกแค่ billDiscount ตัวเลขบนบิลจะไม่ลงกัน */
    calc = { subtotal: priced.subtotal, discount: priced.discount, total: priced.total,
             // ★ ของแถมของเส้นทางชุดราคา มาจาก "ชุดแถม" (39_free_goods.gs) ไม่ใช่ discount_rules
             freeGoods: _shapeFreeGoods(priced.freeGoods),
             appliedRules: (priced.promoRules || []).concat(
               priced.billPercent ? [{ ruleId: 'BILL', ruleName: 'ส่วนลดท้ายบิล ' + priced.billPercent + '% (ยอดรวมครบ ' + priced.billMinExVat + ' บาท ไม่รวม VAT)', type: 'percent', value: priced.billDiscount }] : []) };
  } else {
    calc = applyPromotions(itemsWithGroup, customerId);
    // ★ ส่วนลดต่อบรรทัด (2026-09-30) — เส้นทางโปรโมชั่นเดิมไม่ได้แจกแจงต่อบรรทัดมาให้ ต้องกระจายเองที่นี่
    // ด้วยฟังก์ชันเดียวกับเส้นทางชุดราคา (_allocateLineDiscount) ไม่งั้นสองเส้นทางปัดเศษไม่ตรงกัน
    var noDiscOf = {};
    items.forEach(function(it) { noDiscOf[it.productId] = isNoDiscountProduct(productMap[it.productId]); });
    _allocateLineDiscount(items, calc.discount, noDiscOf);
  }

  /* แยกภาษีจากรายการจริง — ทำหลังได้ราคาสุดท้ายแล้ว ใช้ได้ทั้งสองทาง (ชุดราคา / โปรโมชั่นแบบเดิม)
     ภาษีตัดสินจากสองชั้น: ลูกค้า (customers.tax_type) แล้วจึงรายสินค้า (products.tax_status)
     ลูกค้าที่ไม่อยู่ในระบบ VAT = ทั้งใบไม่มีภาษี ไม่ต้องดูรายสินค้าอีก */
  var custRow = null;
  if (customerId) centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(customerId)) custRow = c; });
  var custTax = String((custRow && custRow.tax_type) || '').trim().toLowerCase();
  var customerApplyVat = !(custTax === 'exempt' || custTax === 'zero');
  calc.vat = saleVatBreakdown(items, calc.discount,
    function(pid) { return customerApplyVat ? productTaxStatus(productMap[String(pid)]) : TAX_EXEMPT; });
  calc.vat.applyVat = customerApplyVat && calc.vat.vat > 0;
  calc.vat.vatType = currentVatType();
  calc.vat.taxOf = function(pid) { return customerApplyVat ? productTaxStatus(productMap[String(pid)]) : TAX_EXEMPT; };

  /* ★ (2) ราคาก่อนภาษีเป็นตัวตั้งต้น (2026-09-30) — ยอดสรุปบิลแบบไม่รวม VAT ก่อน แล้วค่อยบวก VAT ทีเดียวตอนท้าย
     รวมหลังหักส่วนลดสินค้า (ก่อนโปร/ส่วนลดท้ายบิล) − ส่วนลดท้ายบิล = calc.vat.exVat (มีอยู่แล้ว) เสมอ โดยสร้าง
     "ส่วนลดท้ายบิล" เป็นเศษที่เหลือ ไม่คำนวณแยก กันปัดเศษสองทางไม่ตรงกัน */
  var preDiscountExVat = 0;
  items.forEach(function(it) {
    var taxed = customerApplyVat && productTaxStatus(productMap[String(it.productId)]) === TAX_VAT;
    var amt = Number(it.lineTotal) || 0;
    preDiscountExVat += taxed ? amt / (1 + calc.vat.rate) : amt;
    var taxedForList = taxed;
    it.listBreakdown = _lineListBreakdown(it.listPriceExVat, it.qty, it.lineTotal, taxedForList, calc.vat.rate);
  });
  calc.vat.subtotalAfterProductDiscountExVat = _round2(preDiscountExVat);
  calc.vat.billDiscountExVat = _round2(calc.vat.subtotalAfterProductDiscountExVat - calc.vat.exVat);

  return { success: true, items: items, calc: calc, priceListUsed: priceListUsed };
}

function recordSale(user, payload) {
  ensureTenantSheetsCurrent(user.tenantId);   // เหตุผลเดียวกับ recordSaleAdmin (19_sales_admin.gs)
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

  // สินค้าที่ไม่ตัดสต็อก (is_stock = FALSE เช่น ค่าบริการ/ค่าขนส่ง) ข้ามไปเลย ไม่ต้องกันของ/เช็คว่ามีพอไหม
  var need = {};
  items.forEach(function(it) { if (isStockProduct(productMap[String(it.productId)])) need[it.productId] = (need[it.productId] || 0) + it.baseQty; });
  // ของแถมตัดสต็อกด้วยหน่วยฐานเสมอ — f.qty อาจเป็น "ลัง" ถ้าใช้ f.qty ตรงๆ จะตัดสต็อกน้อยไปเป็นร้อยเท่า
  freeGoods.forEach(function(f) { if (isStockProduct(productMap[String(f.productId)])) need[String(f.productId)] = (need[String(f.productId)] || 0) + (Number(f.baseQty) || Number(f.qty) || 0); });

  var stockCheck = { success: true };
  if (fulfillmentType === 'immediate') {
    var allStock = tenantObjects(user.tenantId, 'van_stock');
    var myStock = {};
    allStock.filter(function(s) { return String(s.line_user_id) === String(user.lineUserId); })
      .forEach(function(s) { myStock[String(s.product_id)] = parseInt(s.qty) || 0; });

    var pids = Object.keys(need);
    for (var ci = 0; ci < pids.length; ci++) {
      var have = myStock[pids[ci]] || 0;
      if (have < need[pids[ci]]) return { success: false, message: 'สต็อกรถไม่พอ (สินค้า ' + pids[ci] + ' มี ' + have + ')' };
    }
  } else {
    // office_delivery: กันของไว้ตั้งแต่เปิดบิล (ยอดจอง — guide ข้อ 1.3) เหตุผลเดียวกับ recordSaleAdmin (19_sales_admin.gs)
    // ★ ของไม่พอ = แค่ warning ไม่บล็อกการบันทึก (ต่างจากขายจากรถด้านบน) ดูคอมเมนต์ที่ checkOfficeDeliveryStock (34_sales_status.gs)
    stockCheck = checkOfficeDeliveryStock(user.tenantId, need);
  }

  var orderCode = getNextDocNumber(user.tenantId, 'SO');
  var orderId = tenantNextId(user.tenantId, 'sales_orders');
  var createdAt = nowStr();

  var vatSplit = calc.vat;   // แยกภาษีจากรายการจริง รองรับของยกเว้นภาษีปนในบิล (18_pricing_engine.gs)
  tenantAppend(user.tenantId, 'sales_orders', {
    record_id: orderId, order_code: orderCode, customer_id: payload.customerId || 0,
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    apply_vat: vatSplit.applyVat ? 'TRUE' : 'FALSE', vat_type: vatSplit.vatType,
    vat_rate: vatSplit.rate, subtotal_ex_vat: vatSplit.exVat, vat_amount: vatSplit.vat, exempt_amount: vatSplit.exemptAmount,
    payment_method: payload.paymentType || 'cash', fulfillment_type: fulfillmentType,
    status: fulfillmentType === 'immediate' ? SO_COMPLETED : SO_DRAFT,
    payment_status: initialPaymentStatus(payload.paymentType, fulfillmentType),
    paid_amount: initialPaymentStatus(payload.paymentType, fulfillmentType) === 'paid' ? calc.total : 0,
    delivered_at: fulfillmentType === 'immediate' ? createdAt : '', paid_at: '',
    sale_by: user.lineUserId, lat: payload.latitude || '', lng: payload.longitude || '',
    map: payload.googleMap || '', note: priceListUsed ? ('ชุดราคา: ' + priceListUsed.name) : '', created_at: createdAt,
    // วันนัดส่งโดยประมาณ รับเฉพาะรูปแบบ yyyy-MM-dd และเฉพาะใบนัดส่ง (ขายจากรถส่งของไปแล้ว ไม่มีวันนัด)
    requested_delivery_date: (fulfillmentType === 'office_delivery' && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.requestedDeliveryDate || '')))
      ? String(payload.requestedDeliveryDate) : ''
  });
  logOrderStatus(user.tenantId, orderId, '', fulfillmentType === 'immediate' ? SO_COMPLETED : SO_DRAFT,
    '', initialPaymentStatus(payload.paymentType, fulfillmentType), 'เปิดบิลจากแอปมือถือ',
    user.displayName || user.lineUserId, _mobileRoleLabel(user.role));

  bumpSalesDaily(user.tenantId, createdAt.substring(0, 10), 1, calc.total);   // ยอดสรุปรายวันของแดชบอร์ด
  touchCustomerLastSale(payload.customerId, createdAt);                       // วันที่ซื้อล่าสุด (ไว้หาร้านที่หายไปนาน)

  items.forEach(function(it) {
    tenantAppend(user.tenantId, 'order_items', {
      record_id: tenantNextId(user.tenantId, 'order_items'), order_id: orderId, product_id: it.productId,
      unit_code: it.unitCode, unit_factor: it.unitFactor, qty: it.qty, base_qty: it.baseQty,
      price: it.price, line_total: it.lineTotal, unit_discount: it.unitDiscount || 0, line_discount: it.lineDiscount || 0,
      list_price_ex_vat: it.listPriceExVat != null ? it.listPriceExVat : '',
      is_free: 0, tax_status: calc.vat.taxOf(it.productId)
    });
  });
  freeGoods.forEach(function(f) {
    var baseQty = Number(f.baseQty) || Number(f.qty) || 0, qty = Number(f.qty) || 0;
    tenantAppend(user.tenantId, 'order_items', {
      record_id: tenantNextId(user.tenantId, 'order_items'), order_id: orderId, product_id: f.productId,
      unit_code: f.unitCode || UNIT_PC, unit_factor: qty ? (baseQty / qty) : 1, qty: qty, base_qty: baseQty,
      price: 0, line_total: 0, is_free: 1
    });
  });
  calc.appliedRules.forEach(function(r) {
    tenantAppend(user.tenantId, 'order_discounts', { record_id: tenantNextId(user.tenantId, 'order_discounts'), order_id: orderId, rule_id: r.ruleId, rule_name: r.ruleName, type: r.type, value: r.value, free_product_id: '', free_qty: '' });
  });

  if (fulfillmentType === 'immediate') {
    _cutVanStock(user.tenantId, user.lineUserId, need, orderId);
  }
  /* ★ 1 ต.ค. 2026 — ใบนัดส่งจากมือถือ **ไม่จองของตอนเปิดบิลอีกแล้ว**
     เจ้าของระบบสั่งให้จองตอน "ศูนย์รับงาน" (ดู SO_RESERVED_STATUSES ใน 34_sales_status.gs)
     เพราะใบที่เพิ่งเปิดยังเป็นร่างที่พนักงานแก้/ยกเลิกเองได้ ยังไม่มีใครรับปากลูกค้า
     จองตั้งแต่ตอนนั้น = ของถูกกันไว้ด้วยใบที่อาจไม่เกิดขึ้นจริง แล้วใบอื่นขายไม่ได้ */

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

  return { success: true, orderCode: orderCode, total: calc.total, discount: calc.discount, fulfillmentType: fulfillmentType,
    stockWarning: stockCheck.warning || '' };
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

// ── ราคาในตะกร้า (Mobile) ก่อนกดขาย — เรียก _priceSaleCart() ตัวเดียวกับ recordSale เป๊ะ (ไม่ใช่แค่ "คล้ายกัน")
// payload: { customerId, paymentType, items:[{productId, unitCode, qty}] }
// ★ 2026-09-30 เขียนใหม่ทั้งฟังก์ชัน — ของเดิมเรียก priceCart() ตรงๆ ซึ่งมีช่องโหว่สองจุดที่ทำให้ "ราคาที่เห็น
// ก่อนกด" ไม่ตรงกับ "ราคาที่บันทึกจริง": (1) ไม่คำนวณ VAT เลยสักฟิลด์ (2) ร้านที่กลุ่มยังไม่มีชุดราคาที่ใช้งานอยู่
// จะได้ {success:true, priceList:null} เปล่าๆ กลับไป ไม่ผ่านเส้นทางโปรโมชั่นเดิม (applyPromotions) เหมือนตอน
// recordSale จริง — แอปจึงตกไปใช้ราคาตั้งต้นจากเครื่อง (estimate()) ซึ่งอาจต่างจากยอดที่จะออกบิลจริง
function quoteSale(user, payload) {
  var priced = _priceSaleCart(payload.customerId, payload.items || [], payload.paymentType, user.role === 'van_sales');
  if (!priced.success) return priced;
  var calc = priced.calc, vat = calc.vat;
  return {
    success: true,
    lines: priced.items.map(function(it) { return { productId: it.productId, unitCode: it.unitCode, qty: it.qty,
      unitPrice: it.price, lineTotal: it.lineTotal, tierLabel: it.tierLabel || '',
      unitDiscount: it.unitDiscount || 0, lineDiscount: it.lineDiscount || 0, netTotal: it.netTotal != null ? it.netTotal : it.lineTotal,
      listBreakdown: it.listBreakdown || null }; }),
    freeGoods: calc.freeGoods, appliedRules: calc.appliedRules,
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    priceList: priced.priceListUsed ? { id: priced.priceListUsed.record_id, name: priced.priceListUsed.name } : null,
    applyVat: vat.applyVat, vatRate: vat.rate, vatAmount: vat.vat, subtotalExVat: vat.exVat,
    exemptAmount: vat.exemptAmount, taxableExVat: vat.taxableExVat, vatMixed: vat.mixed,
    subtotalAfterProductDiscountExVat: vat.subtotalAfterProductDiscountExVat, billDiscountExVat: vat.billDiscountExVat
  };
}
