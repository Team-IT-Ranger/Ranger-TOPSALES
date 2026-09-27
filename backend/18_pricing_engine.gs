/**
 * ===================== เครื่องยนต์คิดราคา (ใช้ทั้งตอนขายจริง recordSale และหน้า "ทดลองคิดราคา" ของแอดมิน) =====================
 * priceCart() เป็นฟังก์ชันล้วน (ไม่แตะชีต) เพื่อทดสอบได้ — ข้อมูลโหลดโดย getPricingContext()
 * ข้อมูลชุดราคา/โครงตาราง ดู 17_pricing.gs
 */
/* อัตราสำรองเมื่อยังไม่ได้ตั้งค่าบริษัท — **ห้ามใช้ค่านี้ตรงๆ ในการคำนวณ** ให้เรียก currentVatRate() เสมอ
   (ระบบที่มีหน้าตั้งค่าแต่ไม่เอาค่าไปใช้ อันตรายกว่าไม่มีหน้าตั้งค่าเลย เพราะคนเชื่อว่าตั้งแล้ว) */
var VAT_RATE_FALLBACK = 0.07;
var VAT_RATE = VAT_RATE_FALLBACK;   // ชื่อเดิม เก็บไว้ให้โค้ด/เทสต์เก่าที่อ้างถึงยังทำงาน

/**
 * อัตรา VAT ที่ใช้จริงในตอนนี้ (ทศนิยม เช่น 0.07) — อ่านจาก company_profile.vat_rate ซึ่งเก็บเป็นเปอร์เซ็นต์
 * ★ ที่เดียวในระบบที่แปลงเปอร์เซ็นต์ → ทศนิยม ที่อื่นห้ามแปลงซ้ำ
 * ยังไม่ได้ตั้งค่า (ว่าง) = ใช้ 7% ตามกฎหมายปัจจุบัน · ตั้ง 0 ได้จริงถ้าบริษัทไม่อยู่ในระบบ VAT
 */
function currentVatRate() {
  try {
    var pct = _vatRatePercent(typeof _companyRow === 'function' ? _companyRow() : null);
    return Math.round((pct / 100) * 1e6) / 1e6;
  } catch (e) { return VAT_RATE_FALLBACK; }
}

/** อัตราเป็นเปอร์เซ็นต์จากแถวบริษัท — ว่าง/ไม่ใช่ตัวเลข = 7 · ยอมรับ 0 (ไม่อยู่ในระบบ VAT) */
function _vatRatePercent(row) {
  var raw = row ? row.vat_rate : '';
  if (raw === '' || raw === null || raw === undefined) return VAT_RATE_FALLBACK * 100;
  var n = Number(raw);
  return (isNaN(n) || n < 0 || n > 100) ? VAT_RATE_FALLBACK * 100 : n;
}

/** ราคาที่เก็บในระบบรวม VAT แล้วหรือยัง — ค่าตั้งต้นของบริษัท (ของเราคือ inclusive) */
function currentVatType() {
  try {
    var r = typeof _companyRow === 'function' ? _companyRow() : null;
    return String((r && r.default_vat_type) || 'inclusive').toLowerCase() === 'exclusive' ? 'exclusive' : 'inclusive';
  } catch (e) { return 'inclusive'; }
}
function _round2(n) { return Math.round(n * 100) / 100; }

/**
 * ถอด VAT ออกจากยอดที่ "รวมภาษีแล้ว" — ราคาขายทุกช่องของเราเป็นราคารวม VAT
 * (ใบรายการขายของบริษัทพิมพ์ราคารวมภาษีมาแต่ไหนแต่ไร ชุดราคาจึงเก็บแบบนั้นตรงๆ)
 * ใช้ตัวเดียวกันทุกที่ที่ต้องแยกภาษี — บิลขาย / ใบกำกับภาษีที่พิมพ์ / ใบแจ้งหนี้ลูกหนี้
 * จะได้ไม่มีวันปัดเศษไม่ตรงกันระหว่างกระดาษกับบัญชี
 */
function splitVat(grossInclVat, rate) {
  var r = rate === undefined || rate === null ? currentVatRate() : Number(rate);
  var gross = _round2(Number(grossInclVat) || 0);
  var exVat = _round2(gross / (1 + r));
  return { rate: r, gross: gross, exVat: exVat, vat: _round2(gross - exVat) };
}

/* ═══════════ สถานะภาษีรายสินค้า ═══════════
 * ธุรกิจมีสินค้าที่ยกเว้น VAT จริง (ยืนยัน 2026-09-27) บิลใบเดียวจึงมีของสองแบบปนกันได้
 * ค่าว่าง = คิด VAT ตามปกติ — สินค้าที่มีอยู่แล้วทั้งหมดจึงถูกต้องโดยไม่ต้องแก้ข้อมูล
 * ต้องตั้ง 'exempt' ให้สินค้าที่ยกเว้นเองที่หน้าทะเบียนสินค้า
 */
/* ★ ตัวแปลง boolean ของ VAT โดยเฉพาะ — **ห้ามใช้ isNotOff/isFlagOn ของ is_active มาแทน**
   หน้าตาเหมือนกันแต่ความหมายของค่าว่างคนละเรื่อง และวันที่มันไม่ตรงกันจะหาไม่เจอ
   ค่าว่าง = คิด VAT (แถวเก่าที่มีก่อนฟีเจอร์นี้จะว่าง ถ้าตีความว่าไม่คิด ลูกค้าเก่าทั้งหมดจะหยุดคิด VAT พร้อมกัน) */
function vatFlagOn(v) {
  if (v === '' || v === null || v === undefined) return true;
  var s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === 'ไม่');
}

var TAX_VAT = 'vat', TAX_EXEMPT = 'exempt', TAX_ZERO = 'zero';
var TAX_STATUS_LABELS = { vat: 'คิด VAT 7%', exempt: 'ยกเว้น VAT', zero: 'อัตราศูนย์' };
function productTaxStatus(p) {
  var v = String((p && p.tax_status) || '').trim().toLowerCase();
  return (v === TAX_EXEMPT || v === TAX_ZERO) ? v : TAX_VAT;
}
/** ยกเว้นกับอัตราศูนย์ต่างกันทางภาษี แต่เหมือนกันตรงที่ "ไม่มีภาษีบวกในราคา" */
function productHasVat(p) { return productTaxStatus(p) === TAX_VAT; }

/* ค่าว่างของธงสินค้าแปลว่า "ใช่" — สินค้าเดิมทุกตัวขายได้/ซื้อได้/ตัดสต็อกได้เหมือนเดิมโดยไม่ต้องแก้ข้อมูล
   (หลักเดียวกับ vatFlagOn ด้านบน — ห้ามใช้ตัวแปลงของ is_active ที่ความหมายค่าว่างคนละเรื่อง) */
function productFlag(v) {
  if (v === '' || v === null || v === undefined) return true;
  var s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no');
}
function isSellableProduct(p) { return productFlag(p && p.is_sellable); }
function isPurchasableProduct(p) { return productFlag(p && p.is_purchasable); }
function isStockProduct(p) { return productFlag(p && p.is_stock); }      // false = ค่าบริการ/ค่าขนส่ง ไม่มีของให้ตัด
/* no_discount ตรงข้ามกับธงอื่น: ค่าว่าง = ลดราคาได้ (ปกติ) ต้องติ๊กชัดเจนถึงจะห้ามลด
   จงใจไม่ใช้ productFlag() เพราะค่าว่างของตัวนี้ต้องแปลว่า "ไม่" ไม่ใช่ "ใช่" */
function isNoDiscountProduct(p) {
  var v = String((p && p.no_discount) || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * แยกภาษีของทั้งบิลจากรายการจริง — รองรับบิลที่มีของคิด VAT และของยกเว้น VAT ปนกัน
 *   lines: [{ productId, lineTotal }] (lineTotal = ราคารวมภาษีแล้ว) · billDiscount: ส่วนลดท้ายบิล (รวมภาษี)
 *   taxOf(productId) → 'vat' | 'exempt' | 'zero'
 * ★ ส่วนลดท้ายบิลต้องเฉลี่ยตามสัดส่วนมูลค่าของสองกลุ่ม ไม่งั้นภาษีผิด
 *   (ลดทั้งก้อนจากฝั่งคิดภาษีอย่างเดียว = คิดภาษีน้อยไป · ลดจากฝั่งยกเว้น = คิดภาษีเกิน)
 * ทุกยอดคำนวณแบบ "ตัวสุดท้ายเป็นเศษที่เหลือ" เพื่อให้ exVat + vat = ยอดสุทธิ เป๊ะเสมอ
 */
function saleVatBreakdown(lines, billDiscount, taxOf, rate) {
  var r = rate === undefined || rate === null ? currentVatRate() : Number(rate);
  var grossVat = 0, grossExempt = 0;
  (lines || []).forEach(function(l) {
    var amt = Number(l.lineTotal) || 0;
    if (taxOf(l.productId) === TAX_VAT) grossVat += amt; else grossExempt += amt;
  });
  grossVat = _round2(grossVat); grossExempt = _round2(grossExempt);
  var gross = _round2(grossVat + grossExempt);
  var disc = _round2(Number(billDiscount) || 0);
  var total = _round2(gross - disc);

  var discVat = gross > 0 ? _round2(disc * grossVat / gross) : 0;
  var netVat = _round2(grossVat - discVat);
  if (netVat < 0) netVat = 0;
  if (netVat > total) netVat = total;
  var netExempt = _round2(total - netVat);          // ตัวที่เหลือ — บวกกลับได้เท่ายอดสุทธิเสมอ

  var split = splitVat(netVat, r);
  return { rate: r, total: total,
    grossVat: grossVat, grossExempt: grossExempt,
    taxableExVat: split.exVat, vat: split.vat, exemptAmount: netExempt,
    exVat: _round2(split.exVat + netExempt),        // ฐานรายได้ทั้งบิล (ไม่รวมภาษี) — ตัวที่ลงบัญชี
    mixed: grossVat > 0 && grossExempt > 0 };
}

/**
 * ยอดแยกภาษีของบิลหนึ่งใบ — ใช้ค่าที่บันทึกไว้ตอนขายก่อนเสมอ
 * บิลที่บันทึกก่อนมีคอลัมน์นี้ (หรือแถวที่ยังว่าง) ถึงจะถอดสดจากยอดรวมให้ ณ อัตราปัจจุบัน
 */
function _orderVat(order) {
  var saved = Number(order.vat_amount);
  if (order.vat_amount !== '' && order.vat_amount !== null && order.vat_amount !== undefined && !isNaN(saved)) {
    var ex = Number(order.subtotal_ex_vat) || 0, exempt = Number(order.exempt_amount) || 0;
    var savedRate = Number(order.vat_rate);
    return { rate: isNaN(savedRate) ? currentVatRate() : savedRate, exVat: ex, vat: saved,
      applyVat: vatFlagOn(order.apply_vat), vatType: String(order.vat_type || 'inclusive'),
      exemptAmount: exempt, taxableExVat: _round2(ex - exempt), mixed: exempt > 0 && ex > exempt };
  }
  var s = splitVat(Number(order.total) || 0);
  return { rate: s.rate, exVat: s.exVat, vat: s.vat, applyVat: true, vatType: 'inclusive',
    exemptAmount: 0, taxableExVat: s.exVat, mixed: false };
}

// ชำระแบบเครดิต = ใช้ราคาเครดิต, อย่างอื่น (เงินสด/โอน/เช็ค) = ราคาเงินสด — รหัสตาม payment_types
function isCreditPayment(code) { code = String(code || '').toLowerCase(); return code === 'credit_term' || code === 'credit'; }

// ชุดราคาที่ใช้งานอยู่ของกลุ่มลูกค้า ณ วันที่ (yyyy-MM-dd) — ซ้อนกันเลือกตัวที่ valid_from ใหม่สุด แล้ว id สูงสุด
function findActivePriceList(customerGroupId, dateStr) {
  if (!customerGroupId) return null;
  var best = null;
  centralObjects('price_lists').forEach(function(l) {
    if (l.status !== 'active' || String(l.customer_group_id) !== String(customerGroupId)) return;
    if (_dOnly(l.valid_from) > dateStr || _dOnly(l.valid_to) < dateStr) return;
    if (!best || _dOnly(l.valid_from) > _dOnly(best.valid_from) || (_dOnly(l.valid_from) === _dOnly(best.valid_from) && l.record_id > best.record_id)) best = l;
  });
  return best;
}

/**
 * ชุดราคาของ "ลูกค้ารายนี้" — ผ่านกฎสิทธิ์ (36_price_rules.gs) ไม่ใช่ดูแค่กลุ่มลูกค้า
 * เส้นทางขายทุกทางควรเรียกตัวนี้ ส่วน getPricingContext(groupId) เก็บไว้ให้หน้า "ทดลองคิดราคา"
 * ที่ผู้ใช้เลือกกลุ่มลูกค้าเองโดยไม่ได้อ้างอิงร้านจริง
 */
function getPricingContextForCustomer(customerId, dateStr) {
  var cust = plrCustomerRow(customerId);
  if (!cust) return null;
  var hit = resolvePriceListForCustomer(cust, dateStr);
  if (!hit) return null;
  var ctx = _pricingContextForList(hit.list);
  if (ctx) {
    ctx.matchedRule = hit.rule; ctx.matchedReason = hit.reason; ctx.matchedPriority = hit.priority;
    /* ★ โปรโมชั่นซ้อนบนชุดราคาได้ (เจ้าของระบบสั่ง 27 ก.ย. 2026) — ชุดราคาคือ "ราคาตั้ง"
       โปรโมชั่นคือ "ส่วนลดเพิ่ม" · ก่อนหน้านี้ร้านที่มีชุดราคาไม่ได้โปรเลย ซึ่งแปลว่าพอจัดกลุ่มลูกค้าครบ
       โปรโมชั่นทั้งระบบก็เงียบไปเองโดยไม่มีใครรู้ */
    ctx.promoRules = promosForCustomer(cust);
    ctx.freeGoodsSets = freeGoodsSetsForCustomer(cust, dateStr);
    ctx.unitBase = _fgUnitBaseFn();
    ctx.customerId = cust.record_id;
  }
  return ctx;
}

// { list, items:[price_list_items แถวดิบ], billPromos:[{minAmountExVat,percent}] } หรือ null (ไม่มีชุดราคาที่ใช้ได้ → ใช้ราคาแบบเดิม)
function getPricingContext(customerGroupId, dateStr) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return _pricingContextForList(findActivePriceList(customerGroupId, dateStr || today));
}
// ชุดราคาตาม id (ไม่สนสถานะ/วันที่) — ใช้กับหน้า "ทดลองคิดราคา" เพื่อลองชุดร่างก่อนเปิดใช้งาน
function _pricingContextForList(list) {
  if (!list) return null;
  return {
    list: list,
    items: centralObjects('price_list_items').filter(function(it) { return String(it.price_list_id) === String(list.record_id); }),
    // สถานะภาษีรายสินค้า — เกณฑ์โปรท้ายบิลคิดจากยอด "ไม่รวม VAT" ของยกเว้นภาษีจึงห้ามถูกหาร 1.07
    taxOf: (function() { var m = {}; centralObjects('products').forEach(function(p) { m[String(p.record_id)] = productTaxStatus(p); }); return m; })(),
    // สินค้าที่ห้ามลดราคา (no_discount ของ Smartsales) — ส่วนลดท้ายบิลต้องไม่กินรายการพวกนี้
    noDiscountOf: (function() { var m = {}; centralObjects('products').forEach(function(p) { if (isNoDiscountProduct(p)) m[String(p.record_id)] = 1; }); return m; })(),
    vatRate: currentVatRate(),
    // กลุ่มสินค้า — โปรโมชั่นจับคู่รายการด้วย product_group_id เป็นหลัก
    groupOf: (function() { var m = {}; centralObjects('products').forEach(function(p) { m[String(p.record_id)] = parseInt(p.group_id) || 0; }); return m; })(),
    billPromos: centralObjects('price_list_bill_promos').filter(function(b) { return String(b.price_list_id) === String(list.record_id); })
      .map(function(b) { return { minAmountExVat: Number(b.min_amount_ex_vat), percent: Number(b.percent) }; })
  };
}

/**
 * cart: [{ productId, unitCode('CT' ลัง | 'PK' แพ็ค), qty }]   opts: { isCredit:boolean, isVan:boolean }
 * รหัสหน่วยผ่าน normUnitCode() ทั้งสองฝั่ง (28_units.gs) — ข้อมูลเก่าที่เป็น CASE/PACK จึงยังคิดราคาได้
 * กติกา (จากใบรายการขายจริง):
 *  - ขั้นบันไดนับ "จำนวนหีบรวมของ line เดียวกัน" (สินค้าที่ใช้ตารางขั้นร่วมกัน) แล้วทุกหีบใช้ราคาของขั้นที่ถึง
 *  - ราคาที่ขายคือราคาสุทธิรวม VAT (เงินสด หรือ เครดิตตามวิธีชำระ)
 *  - PACK (แพ็ค) ขายได้เฉพาะ Cash Van + ชำระเงินสด
 *  - โปรระดับบิล: ยอดรวมทั้งบิลไม่รวม VAT ครบขั้นไหน ลดเพิ่ม % ขั้นสูงสุดที่ถึงเพียงขั้นเดียว
 * คืน { success, lines:[{productId,unitCode,unitFactor,qty,unitPrice,lineTotal,tierLabel,lineId}], subtotal, billPercent, billDiscount, total }
 */
function priceCart(ctx, cart, opts) {
  opts = opts || {};
  var byProduct = {};
  ctx.items.forEach(function(it) {
    var k = String(it.product_id) + '|' + normUnitCode(it.unit_code, UNIT_CT);
    (byProduct[k] = byProduct[k] || []).push(it);
  });
  Object.keys(byProduct).forEach(function(k) { byProduct[k].sort(function(a, b) { return Number(a.min_qty) - Number(b.min_qty); }); });

  // จำนวนลังรวมต่อ line
  var caseQtyByLine = {};
  cart.forEach(function(c) {
    if (!isCaseUnit(c.unitCode)) return;
    var rows = byProduct[String(c.productId) + '|' + UNIT_CT];
    if (!rows || !rows.length) return;
    var key = String(rows[0].line_id);
    caseQtyByLine[key] = (caseQtyByLine[key] || 0) + (Number(c.qty) || 0);
  });

  var lines = [], subtotal = 0;
  for (var i = 0; i < cart.length; i++) {
    var c = cart[i], qty = Number(c.qty) || 0;
    var unitCode = normUnitCode(c.unitCode, UNIT_CT);
    if (qty <= 0) return { success: false, message: 'จำนวนสินค้าต้องมากกว่า 0' };
    var rows = byProduct[String(c.productId) + '|' + unitCode];
    if (!rows || !rows.length) {
      return { success: false, code: 'NOT_IN_PRICE_LIST', productId: c.productId,
               message: 'สินค้า ' + c.productId + ' หน่วย ' + unitLabelOf(unitCode) + ' ไม่มีในชุดราคา "' + ctx.list.name + '"' };
    }

    var item = null;
    if (isPackUnit(unitCode)) {
      if (!opts.isVan) return { success: false, code: 'PACK_VAN_ONLY', productId: c.productId, message: 'แพ็คขายได้เฉพาะ Cash Van เท่านั้น' };
      if (opts.isCredit) return { success: false, code: 'PACK_CASH_ONLY', productId: c.productId, message: 'แพ็คขายได้เฉพาะเงินสด (ขายเครดิตต้องสั่งเป็นลัง)' };
      item = rows[0];
    } else {
      var total = caseQtyByLine[String(rows[0].line_id)] || qty;
      for (var r = 0; r < rows.length; r++) {
        var min = Number(rows[r].min_qty), max = rows[r].max_qty === '' ? Infinity : Number(rows[r].max_qty);
        if (total >= min && total <= max) { item = rows[r]; break; }
      }
      if (!item) return { success: false, code: 'NO_TIER', productId: c.productId, message: 'จำนวน ' + total + ' ลัง ไม่ตรงขั้นราคาใดในชุดราคา (สินค้า ' + c.productId + ')' };
    }

    var price = opts.isCredit ? item.credit_price_incl_vat : item.cash_price_incl_vat;
    if (price === '' || price === null || price === undefined) {
      return { success: false, code: 'NO_PRICE', productId: c.productId, message: 'สินค้า ' + c.productId + ' ไม่มีราคา' + (opts.isCredit ? 'เครดิต' : 'เงินสด') + ' ในชุดราคานี้' };
    }
    price = Number(price);
    var lineTotal = _round2(price * qty);
    subtotal += lineTotal;
    lines.push({ productId: String(c.productId), unitCode: unitCode, unitFactor: Number(item.unit_factor) || 1, qty: qty,
                 unitPrice: price, lineTotal: lineTotal, tierLabel: item.tier_label || '', lineId: item.line_id });
  }
  subtotal = _round2(subtotal);

  // ยอดไม่รวม VAT ของทั้งตะกร้า (ของยกเว้นภาษีนับเต็มจำนวน ไม่ต้องถอดอะไร) — ใช้เทียบเกณฑ์โปรท้ายบิล
  var taxOfFn = function(pid) { return (ctx.taxOf && ctx.taxOf[String(pid)]) || TAX_VAT; };
  var rateNow = ctx.vatRate === undefined || ctx.vatRate === null ? currentVatRate() : Number(ctx.vatRate);
  var exVat = 0;
  lines.forEach(function(l) {
    exVat += taxOfFn(l.productId) === TAX_VAT ? (l.lineTotal / (1 + rateNow)) : l.lineTotal;
  });
  /* ★ ฐานที่ลดได้ ไม่รวมรายการที่ห้ามลดราคา — ไม่งั้นสินค้าคุมราคาจะถูกลดทางอ้อมผ่านส่วนลด
     (เกณฑ์ยอดขั้นต่ำยังนับทั้งบิลตามปกติ ลูกค้าซื้อของคุมราคาก็ยังช่วยให้ถึงขั้นได้) */
  var noDiscOf = ctx.noDiscountOf || {};
  var discountable = 0;
  lines.forEach(function(l) { if (!noDiscOf[String(l.productId)]) discountable += l.lineTotal; });
  discountable = _round2(discountable);

  /* ★ ลำดับ: ราคาตามขั้น → หักโปรโมชั่น → หักส่วนลดท้ายบิล → ถอด VAT
     เกณฑ์ขั้นของส่วนลดท้ายบิลวัดจาก "ยอดที่ลูกค้าสั่ง" (ก่อนหักโปร) โดยตั้งใจ — ร้านคิดจากยอดที่ตัวเองสั่ง
     ถ้าวัดหลังหักโปร โปรโมชั่นจะกลายเป็นตัวทำให้หลุดขั้นแล้วได้ส่วนลดรวมน้อยลงกว่าไม่มีโปร ซึ่งอธิบายไม่ได้
     ส่วน "ฐานที่เอาไปคูณ %" หักโปรออกก่อน เพราะเป็นเงินที่ลดไปแล้วจริง จะลดซ้ำบนก้อนเดิมไม่ได้ */
  var groupOf = ctx.groupOf || {};
  var promo = { discount: 0, appliedRules: [], freeGoods: [] };
  if ((ctx.promoRules || []).length && typeof computePromoDiscount === 'function') {
    var promoItems = lines
      .filter(function(l) { return !noDiscOf[String(l.productId)]; })
      .map(function(l) { return { productId: Number(l.productId), qty: Number(l.qty) || 0,
        price: Number(l.unitPrice) || 0, groupId: groupOf[String(l.productId)] || 0 }; });
    promo = computePromoDiscount(promoItems, ctx.promoRules, true);   // true = ยังไม่คิดของแถมในเส้นทางชุดราคา
  }
  var promoDiscount = _round2(promo.discount || 0);

  var bill = null;
  (ctx.billPromos || []).forEach(function(b) { if (exVat >= b.minAmountExVat && (!bill || b.minAmountExVat > bill.minAmountExVat)) bill = b; });
  var billBase = _round2(Math.max(0, discountable - promoDiscount));
  var billDiscount = bill ? _round2(billBase * bill.percent / 100) : 0;

  /* ★ ของแถมไม่กระทบยอดเงิน — คิดหลังได้ราคาแล้ว และไม่เข้าฐานส่วนลดใดๆ
     ใบอนุมัติโปรทั้งไตรมาสเป็นของแถมล้วน ถ้าไม่คืนตรงนี้ เส้นทางชุดราคาจะเงียบไปทั้งใบ */
  var freeGoods = [];
  if ((ctx.freeGoodsSets || []).length && typeof computeFreeGoods === 'function') {
    freeGoods = computeFreeGoods(lines.map(function(l) {
      return { productId: l.productId, groupId: groupOf[String(l.productId)] || 0, qty: l.qty, unitCode: l.unitCode };
    }), ctx.freeGoodsSets, ctx.unitBase);
  }

  return { success: true, lines: lines, subtotal: subtotal, subtotalExVat: _round2(exVat),
           discountableSubtotal: discountable, freeGoods: freeGoods,
           promoDiscount: promoDiscount, promoRules: promo.appliedRules || [],
           billPercent: bill ? bill.percent : 0, billMinExVat: bill ? bill.minAmountExVat : 0,
           billBase: billBase, billDiscount: billDiscount,
           discount: _round2(promoDiscount + billDiscount),
           total: _round2(subtotal - promoDiscount - billDiscount),
           priceListId: ctx.list.record_id, priceListName: ctx.list.name };
}

/**
 * แอดมินทดลองคิดราคา — payload: { customerId | priceListId | customerGroupId+date?, paymentType, isVan,
 *                                 items:[{productId|productCode, unitCode, qty}] }
 *  - `customerId`  ★ คิดในนาม "ร้านจริง" — ผ่านการจ่ายชุดให้ตัวแทน กฎสิทธิ์ และโปรโมชั่นครบเหมือนตอนขายจริง
 *                  ใช้ตรวจว่าโปรที่เพิ่งตั้งจะลดจริงเท่าไรก่อนเปิดใช้ · ทางอื่นด้านล่างไม่ผูกร้าน จึงไม่มีโปร
 *  - `priceListId` ลองชุดนั้นตรงๆ (รวมชุดร่าง ที่ยังไม่เปิดใช้งาน)
 *  - `customerGroupId` ชุดที่ "ใช้งาน" ของกลุ่มลูกค้า ณ วันที่ระบุ
 */
function previewPricing(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  var ctx;
  if (payload.customerId) {
    var cust = plrCustomerRow(payload.customerId);
    if (!cust) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
    ctx = getPricingContextForCustomer(payload.customerId, payload.date);
    if (!ctx) return { success: false, message: 'ร้านนี้ยังไม่เข้าเงื่อนไขชุดราคาไหนเลย — ตรวจด้วย "ตรวจสิทธิ์ของร้าน" ว่าติดที่การจ่ายชุดให้ตัวแทน หรือกฎสิทธิ์' };
  } else if (payload.priceListId) {
    var picked = null;
    centralObjects('price_lists').forEach(function(l) { if (String(l.record_id) === String(payload.priceListId)) picked = l; });
    ctx = _pricingContextForList(picked);
    if (!ctx) return { success: false, message: 'ไม่พบชุดราคานี้' };
  } else {
    ctx = getPricingContext(payload.customerGroupId, payload.date);
    if (!ctx) return { success: false, message: 'ไม่มีชุดราคาที่ "ใช้งาน" ของกลุ่มลูกค้านี้ ณ วันที่ระบุ' };
  }
  var products = centralObjects('products');
  var cart = [];
  for (var i = 0; i < (payload.items || []).length; i++) {
    var it = payload.items[i], pid = it.productId;
    if (!pid && it.productCode) {
      var hit = null, want = String(it.productCode).trim().toLowerCase();
      products.forEach(function(p) { if (_productAllCodes(p).indexOf(want) !== -1) hit = p; });
      if (!hit) return { success: false, message: 'ไม่พบสินค้ารหัส ' + it.productCode };
      pid = hit.record_id;
    }
    cart.push({ productId: pid, unitCode: it.unitCode, qty: it.qty });
  }
  var res = priceCart(ctx, cart, { isCredit: isCreditPayment(payload.paymentType), isVan: !!payload.isVan });
  if (res.success) {
    res.priceListName = ctx.list.name;
    // บอกด้วยว่าคิดโปรไปกี่ตัว — ทางที่ไม่ผูกร้านจะเป็น null เพื่อไม่ให้เข้าใจผิดว่า "ไม่มีโปร"
    res.promoCount = payload.customerId ? (ctx.promoRules || []).length : null;
  }
  return res;
}
