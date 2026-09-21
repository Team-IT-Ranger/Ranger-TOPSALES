/**
 * ===================== เครื่องยนต์คิดราคา (ใช้ทั้งตอนขายจริง recordSale และหน้า "ทดลองคิดราคา" ของแอดมิน) =====================
 * priceCart() เป็นฟังก์ชันล้วน (ไม่แตะชีต) เพื่อทดสอบได้ — ข้อมูลโหลดโดย getPricingContext()
 * ข้อมูลชุดราคา/โครงตาราง ดู 17_pricing.gs
 */
var VAT_RATE = 0.07;
function _round2(n) { return Math.round(n * 100) / 100; }

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
    billPromos: centralObjects('price_list_bill_promos').filter(function(b) { return String(b.price_list_id) === String(list.record_id); })
      .map(function(b) { return { minAmountExVat: Number(b.min_amount_ex_vat), percent: Number(b.percent) }; })
  };
}

/**
 * cart: [{ productId, unitCode('CASE'|'PACK'), qty }]   opts: { isCredit:boolean, isVan:boolean }
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
    var k = String(it.product_id) + '|' + it.unit_code;
    (byProduct[k] = byProduct[k] || []).push(it);
  });
  Object.keys(byProduct).forEach(function(k) { byProduct[k].sort(function(a, b) { return Number(a.min_qty) - Number(b.min_qty); }); });

  // จำนวนหีบรวมต่อ line
  var caseQtyByLine = {};
  cart.forEach(function(c) {
    if (c.unitCode !== 'CASE') return;
    var rows = byProduct[String(c.productId) + '|CASE'];
    if (!rows || !rows.length) return;
    var key = String(rows[0].line_id);
    caseQtyByLine[key] = (caseQtyByLine[key] || 0) + (Number(c.qty) || 0);
  });

  var lines = [], subtotal = 0;
  for (var i = 0; i < cart.length; i++) {
    var c = cart[i], qty = Number(c.qty) || 0;
    if (qty <= 0) return { success: false, message: 'จำนวนสินค้าต้องมากกว่า 0' };
    var rows = byProduct[String(c.productId) + '|' + c.unitCode];
    if (!rows || !rows.length) {
      return { success: false, code: 'NOT_IN_PRICE_LIST', productId: c.productId,
               message: 'สินค้า ' + c.productId + ' หน่วย ' + c.unitCode + ' ไม่มีในชุดราคา "' + ctx.list.name + '"' };
    }

    var item = null;
    if (c.unitCode === 'PACK') {
      if (!opts.isVan) return { success: false, code: 'PACK_VAN_ONLY', productId: c.productId, message: 'แพ็คขายได้เฉพาะ Cash Van เท่านั้น' };
      if (opts.isCredit) return { success: false, code: 'PACK_CASH_ONLY', productId: c.productId, message: 'แพ็คขายได้เฉพาะเงินสด (ขายเครดิตต้องสั่งเป็นหีบ)' };
      item = rows[0];
    } else {
      var total = caseQtyByLine[String(rows[0].line_id)] || qty;
      for (var r = 0; r < rows.length; r++) {
        var min = Number(rows[r].min_qty), max = rows[r].max_qty === '' ? Infinity : Number(rows[r].max_qty);
        if (total >= min && total <= max) { item = rows[r]; break; }
      }
      if (!item) return { success: false, code: 'NO_TIER', productId: c.productId, message: 'จำนวน ' + total + ' หีบ ไม่ตรงขั้นราคาใดในชุดราคา (สินค้า ' + c.productId + ')' };
    }

    var price = opts.isCredit ? item.credit_price_incl_vat : item.cash_price_incl_vat;
    if (price === '' || price === null || price === undefined) {
      return { success: false, code: 'NO_PRICE', productId: c.productId, message: 'สินค้า ' + c.productId + ' ไม่มีราคา' + (opts.isCredit ? 'เครดิต' : 'เงินสด') + ' ในชุดราคานี้' };
    }
    price = Number(price);
    var lineTotal = _round2(price * qty);
    subtotal += lineTotal;
    lines.push({ productId: String(c.productId), unitCode: c.unitCode, unitFactor: Number(item.unit_factor) || 1, qty: qty,
                 unitPrice: price, lineTotal: lineTotal, tierLabel: item.tier_label || '', lineId: item.line_id });
  }
  subtotal = _round2(subtotal);

  var exVat = subtotal / (1 + VAT_RATE), bill = null;
  (ctx.billPromos || []).forEach(function(b) { if (exVat >= b.minAmountExVat && (!bill || b.minAmountExVat > bill.minAmountExVat)) bill = b; });
  var billDiscount = bill ? _round2(subtotal * bill.percent / 100) : 0;
  return { success: true, lines: lines, subtotal: subtotal, subtotalExVat: _round2(exVat),
           billPercent: bill ? bill.percent : 0, billMinExVat: bill ? bill.minAmountExVat : 0, billDiscount: billDiscount,
           total: _round2(subtotal - billDiscount), priceListId: ctx.list.record_id, priceListName: ctx.list.name };
}

// แอดมินทดลองคิดราคา — payload: { priceListId | customerGroupId+date?, paymentType, isVan, items:[{productId|productCode, unitCode, qty}] }
// ส่ง priceListId = ลองชุดนั้นตรงๆ (รวมชุดร่าง) ไม่ส่ง = ใช้ชุดที่ "ใช้งาน" ของกลุ่มลูกค้า ณ วันที่ เหมือนตอนขายจริง
function previewPricing(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  var ctx;
  if (payload.priceListId) {
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
  return priceCart(ctx, cart, { isCredit: isCreditPayment(payload.paymentType), isVan: !!payload.isVan });
}
