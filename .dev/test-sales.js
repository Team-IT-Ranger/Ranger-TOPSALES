// รัน: node .dev/test-sales.js — ทดสอบ _priceSaleCart() (07_sales.gs) โดยเฉพาะกติกา "แพ็คขายเฉพาะ Cash Van เงินสด"
// ในเส้นทาง fallback (ลูกค้าที่ยังไม่มีชุดราคาที่ใช้งานอยู่ → applyPromotions แบบเดิม) ซึ่งเดิมไม่เช็คกติกานี้เลย
// (บั๊กที่เจอจริงบน UAT 2026-09-28 ตอนสร้างตัวแทนทดสอบใหม่แล้วขายแพ็คด้วยเครดิตผ่านฉลุย — ดู CLAUDE.md/who-is-doing-what.md)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Utilities: { formatDate: () => '2026-09-28', computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' } },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
};
vm.createContext(ctx);
for (const f of ['02_helpers.gs', '28_units.gs', '17_pricing.gs', '18_pricing_engine.gs', '11_promotions.gs', '07_sales.gs']) {
  vm.runInContext(B(f), ctx, { filename: f });
}

// ── ข้อมูลจำลอง ──
const PRODUCTS = [{ record_id: 1, name: 'เรนเจอร์เอ็กซ์ตรีม แซนดัลวูด', group_id: 0, base_price: 20, tax_status: 'vat' }];
const PRODUCT_UNITS = [
  { product_id: 1, unit_code: 'PK', unit_factor: 5, price: 101, is_active: 'TRUE' },
  { product_id: 1, unit_code: 'CT', unit_factor: 60, price: 1200, is_active: 'TRUE' }
];
const CUSTOMERS = [{ record_id: 1, name: 'ร้านทดสอบ', tax_type: '' }];
ctx.centralObjects = name => {
  if (name === 'products') return PRODUCTS;
  if (name === 'product_units') return PRODUCT_UNITS;
  if (name === 'customers') return CUSTOMERS;
  if (name === 'discount_rules') return [];
  return [];
};
// บังคับให้ไม่มีชุดราคาที่ใช้ได้เสมอ (จำลองลูกค้า/ตัวแทนที่ยังไม่ได้จ่ายชุดราคาให้ — เส้นทาง fallback)
ctx.getPricingContextForCustomer = () => null;

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

console.log('── _priceSaleCart(): แพ็คขายเฉพาะ Cash Van + เงินสด แม้ไม่มีชุดราคา (fallback ก็ต้องเช็ค) ──');

let r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'PK', qty: 2 }], 'cash', false);
eq('แพ็คนอก Cash Van (isVan=false) ถูกปฏิเสธแม้ลูกค้าไม่มีชุดราคา', [r.success, r.code], [false, 'PACK_VAN_ONLY']);

r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'PK', qty: 2 }], 'credit_term', true);
eq('แพ็คแบบเครดิตถูกปฏิเสธแม้ลูกค้าไม่มีชุดราคา (บั๊กเดิม: ผ่านฉลุย)', [r.success, r.code], [false, 'PACK_CASH_ONLY']);

r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'PK', qty: 2 }], 'cash', true);
// ★ 101 ในข้อมูลจำลองคือราคา "ก่อน VAT" (product_units.price เปลี่ยนความหมาย 3 ต.ค. 2026)
// ราคาที่คิดเงินต้องรวม VAT แล้ว: 101 × 1.07 = 108.07 ต่อแพ็ค × 2 = 216.14
// **อย่าแก้กลับเป็น 202** — นั่นคือค่าที่เทสต์นี้เคยคาดไว้ตอนราคาในทะเบียนยังรวม VAT อยู่ ปล่อยไว้ = เก็บเงินขาด VAT ทั้งก้อน
eq('แพ็ค Cash Van เงินสด ผ่านปกติ (ราคาต่อแพ็ค รวม VAT × 2)', [r.success, r.items[0].lineTotal], [true, 216.14]);

r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'CT', qty: 1 }], 'credit_term', false);
eq('ขายเป็นลัง (ไม่ใช่แพ็ค) ด้วยเครดิตนอก Cash Van ยังขายได้ปกติ (กติกานี้จำเพาะแพ็คเท่านั้น)', r.success, true);

console.log('\n── quoteSale(): ของแถมต้องผ่านการแปลงร่างเหมือน recordSale เป๊ะ (ruleId/ruleName) ──');
// บั๊กที่เจอจริง 2026-09-29: quoteSale ไม่เคยผ่าน _shapeFreeGoods() เลย ต่างจาก _priceSaleCart (ที่ recordSale
// เรียกใช้) ซึ่งแปลงร่างเป็น {ruleId,ruleName,applied} เสมอ — มือถือเลยเห็นของแถมเป็นรูปดิบจาก computeFreeGoods()
// (setId/tierGroup/reason) และถ้าจะส่ง opt-out (payload.freeGoods[].applied=false) กลับไปตอนบันทึกจริง
// ruleId ที่ไม่มีอยู่จะไม่ตรงกับที่ recordSale คาดหวังเลย
const realGetCtx = ctx.getPricingContextForCustomer, realPriceCart = ctx.priceCart;
ctx.getPricingContextForCustomer = () => ({ list: { record_id: 99, name: 'ชุดทดสอบ' } });
ctx.priceCart = () => ({ success: true, lines: [{ unitPrice: 20, lineTotal: 20, tierLabel: '' }], subtotal: 20, total: 20,
  freeGoods: [{ setId: 5, setName: 'ชุดแถมทดสอบ', tierGroup: '5', itemId: 7, productId: 2, unitCode: 'PC', qty: 3, baseQty: 3, reason: 'ซื้อครบ 12 ลัง' }] });
r = ctx.quoteSale({ role: 'van_sales' }, { customerId: 1, paymentType: 'cash', items: [{ productId: 1, unitCode: '', qty: 1 }] });
eq('quoteSale คืนของแถมที่มี ruleId/ruleName (แปลงร่างแล้ว) ไม่ใช่ setId/reason ดิบ',
  [r.success, r.freeGoods[0].ruleId, r.freeGoods[0].ruleName, r.freeGoods[0].applied],
  [true, 'FG5-5', 'ชุดแถมทดสอบ — ซื้อครบ 12 ลัง', true]);
eq('  โชว์ VAT ด้วย (บั๊กเดิม: quoteSale ไม่คำนวณ VAT เลย)', typeof r.vatAmount, 'number');
ctx.getPricingContextForCustomer = realGetCtx; ctx.priceCart = realPriceCart;

console.log('\n── quoteSale(): ร้านที่ยังไม่มีชุดราคาที่ใช้งานอยู่ ต้องได้ราคาจริง ไม่ใช่ค่าว่าง ──');
// บั๊กเดิมอีกจุด: quoteSale เจอ getPricingContextForCustomer คืน null (ร้านนี้ยังไม่มีชุดราคา) แล้วตอบ
// {success:true, priceList:null} เปล่าๆ ทันที — ไม่ไปต่อที่เส้นทางโปรโมชั่นเดิม (applyPromotions) เหมือนตอน
// recordSale จริง แอปเลยตกไปใช้ราคาประมาณการจากเครื่อง (estimate()) ซึ่งไม่มีส่วนลด/ของแถมของ discount_rules เลย
// (harness นี้ตั้ง getPricingContextForCustomer ให้คืน null เป็นค่าเริ่มต้นอยู่แล้ว — ไม่ต้อง stub เพิ่ม)
r = ctx.quoteSale({ role: 'van_sales' }, { customerId: 1, paymentType: 'cash', items: [{ productId: 1, unitCode: '', qty: 1 }] });
// base_price 20 = ราคาก่อน VAT → คิดเงินจริง 20 × 1.07 = 21.40 (เหตุผลเดียวกับหมายเหตุแพ็คด้านบน)
eq('ได้ราคาจริงจากเส้นทางโปรโมชั่นเดิม ไม่ใช่ {priceList:null} เปล่าๆ',
  [r.success, r.priceList, r.lines.length, r.lines[0].lineTotal], [true, null, 1, 21.4]);

console.log('\n── _priceSaleCart(): "ราคาก่อนภาษีเป็นตัวตั้งต้น" (2026-09-30 (2)) — listBreakdown ต่อบรรทัด + ยอดสรุปไม่รวมภาษี ──');
{
  // ชุดราคาจริงมี list_price_ex_vat (G ในใบราคา) — ราคา 1 หีบ เงินสด ฿1,210 (รวม VAT) จากราคาตั้ง ฿1,166.34
  const priceListItems = [{ record_id: 1, price_list_id: 9, line_id: 1, product_id: 1, unit_code: 'CT', unit_factor: 60,
    min_qty: 1, max_qty: '', list_price_ex_vat: 1166.34, cash_price_incl_vat: 1210, credit_price_incl_vat: 1225, van_only: 'FALSE', tier_label: 'ซื้อ 1 หีบ' }];
  const realGetCtx2 = ctx.getPricingContextForCustomer;
  ctx.getPricingContextForCustomer = () => ({ list: { record_id: 9, name: 'ชุดราคาทดสอบ (2)' }, items: priceListItems, billPromos: [] });
  r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'CT', qty: 1 }], 'cash', false);
  eq('ขายผ่านชุดราคาที่มี list_price_ex_vat → items[0].listBreakdown คำนวณถูก (ก่อนลด/ส่วนลด/หลังลด ไม่รวม VAT)',
    [r.success, r.items[0].listBreakdown && r.items[0].listBreakdown.unitPriceExVat,
     r.items[0].listBreakdown && r.items[0].listBreakdown.discountExVat, r.items[0].listBreakdown && r.items[0].listBreakdown.netExVat],
    [true, 1166.34, 35.5, 1130.84]);
  eq('ยอดสรุปบิล: ราคารวมหลังหักส่วนลดสินค้า (ไม่รวมภาษี) = subtotalExVat เพราะไม่มีโปร/ส่วนลดท้ายบิล',
    [r.calc.vat.subtotalAfterProductDiscountExVat, r.calc.vat.billDiscountExVat, r.calc.vat.exVat],
    [1130.84, 0, 1130.84]);
  ctx.getPricingContextForCustomer = realGetCtx2;

  // เส้นทาง fallback (ไม่มีชุดราคา) ไม่มี list_price_ex_vat ให้อ้างอิง → listBreakdown ต้องเป็น null (ไม่ใช่โยน error)
  r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'CT', qty: 1 }], 'cash', false);
  eq('เส้นทางโปรโมชั่นเดิม (ไม่มีชุดราคา) → listBreakdown เป็น null ทุกบรรทัด (ไม่มีราคาตั้งให้ถอด)',
    r.items[0].listBreakdown, null);
}

console.log('\n── _priceSaleCart(): ราคาในทะเบียนเป็น "ก่อน VAT" → ทางสำรองต้องบวก VAT กลับเข้าไป (5 ต.ค. 2026) ──');
// บั๊กจริง: 3 ต.ค. 2026 products.base_price / product_units.price เปลี่ยนจาก "รวม VAT" เป็น "ก่อน VAT"
// แต่ทางสำรอง (ร้านที่ยังไม่มีชุดราคาที่ใช้งานอยู่) ยังเอาค่านั้นไปใช้เป็นราคารวม VAT ตรงๆ แล้วถูกหาร 1.07
// ซ้ำตอนถอดภาษี → เก็บเงินลูกค้าขาดไปเท่ากับ VAT ทั้งก้อน โดยไม่มีอะไรฟ้อง
// (prod ยังไม่เกิดเพราะทุกกลุ่มมีชุดราคา active — จะเกิดวันที่เปิดกลุ่มลูกค้า/ตัวแทนใหม่)
{
  PRODUCTS.push({ record_id: 2, name: 'สินค้ายกเว้นภาษี', group_id: 0, base_price: 500, tax_status: 'exempt' });
  CUSTOMERS.push({ record_id: 2, name: 'ร้านนอกระบบ VAT', tax_type: 'exempt' });

  // ★ หัวใจของเรื่องนี้: ราคาก่อน VAT ที่เก็บไว้ ต้องโผล่บนบิลเป็น "มูลค่าก่อนภาษี" เป๊ะ
  // (CT ของสินค้า 1 เก็บไว้ 1,200 ก่อน VAT → คิดเงิน 1,284 → ถอดภาษีได้ 1,200 กลับมาพอดี)
  r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'CT', qty: 1 }], 'cash', false);
  eq('ราคาที่คิดเงินรวม VAT แล้ว (1,200 ก่อน VAT → 1,284)', [r.success, r.items[0].lineTotal], [true, 1284]);
  eq('★ ถอดภาษีกลับแล้วได้ราคาก่อน VAT ที่เก็บไว้เป๊ะ — ไม่ใช่ 1,121.50 (อาการของบั๊ก)',
    [r.calc.vat.exVat, r.calc.vat.vat, r.calc.vat.rate], [1200, 84, 0.07]);
  eq('  ยอดสรุปก่อนภาษีก็ต้องตรงกัน (ตัวเลขบนบิลกับในบัญชีมาจากชุดเดียวกัน)',
    r.calc.vat.subtotalAfterProductDiscountExVat, 1200);

  // สินค้ายกเว้นภาษี: ไม่มี VAT ให้บวก ราคาที่เก็บคือราคาที่คิดเงิน
  r = ctx._priceSaleCart(1, [{ productId: 2, unitCode: '', qty: 1 }], 'cash', false);
  eq('สินค้ายกเว้นภาษี ไม่ถูกบวก VAT เข้าไป (500 → 500)',
    [r.success, r.items[0].lineTotal, r.calc.vat.exVat, r.calc.vat.vat], [true, 500, 500, 0]);

  // ลูกค้านอกระบบ VAT: ทั้งใบไม่มีภาษี → ไม่บวกแม้สินค้าจะเป็นสินค้าคิด VAT
  r = ctx._priceSaleCart(2, [{ productId: 1, unitCode: 'CT', qty: 1 }], 'cash', false);
  eq('ลูกค้านอกระบบ VAT: สินค้าคิด VAT ก็ไม่ถูกบวก (ทั้งใบไม่มีภาษี)',
    [r.success, r.items[0].lineTotal, r.calc.vat.exVat, r.calc.vat.vat], [true, 1200, 1200, 0]);

  // บิลผสม: ของคิดภาษี + ของยกเว้น ในใบเดียวกัน ต้องบวกเฉพาะตัวที่เสียภาษี
  r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'CT', qty: 1 }, { productId: 2, unitCode: '', qty: 1 }], 'cash', false);
  eq('บิลผสม: บวก VAT เฉพาะบรรทัดที่เสียภาษี (1,284 + 500)',
    [r.items[0].lineTotal, r.items[1].lineTotal], [1284, 500]);
  eq('  แยกภาษีถูก: ฐานรายได้ 1,700 · ภาษี 84 · ยกเว้น 500 · ส่วนที่เสียภาษี 1,200',
    [r.calc.vat.exVat, r.calc.vat.vat, r.calc.vat.exemptAmount, r.calc.vat.taxableExVat], [1700, 84, 500, 1200]);

  PRODUCTS.pop(); CUSTOMERS.pop();
}

/* ══ ราคาต่อ "ชิ้น" ต้องคิดจากหน่วยขาย ไม่ใช่เอา base_price มาใช้ดิบๆ ══
   บั๊กจริง 8 ต.ค. 2026: เจ้าของระบบขาย 1 ชิ้น แล้วได้ ฿1,247.98 ซึ่งเท่าราคาทั้งลัง
   ข้อมูลจริงบน UAT/prod เก็บ "ราคาต่อลัง" ไว้ในช่อง base_price (90 จาก 94 รายการมีราคาลัง
   เท่ากับ base_price เป๊ะ ขณะที่ขนาดบรรจุเป็น 12/18/60) — ดู baseUnitPrice() ใน 28_units.gs
   เส้นทางชุดราคาไม่โดน โดนเฉพาะเส้นทางสำรอง (ลูกค้าทั่วไป/ร้านที่ยังไม่มีชุดราคา) */
{
  console.log('\n── ราคาต่อชิ้นมาจากหน่วยขาย ไม่ใช่ base_price ที่จริงๆ เป็นราคาต่อลัง ──');
  // สินค้า 3 = ของจริงที่ทำให้เจอบั๊ก (10185): base_price เท่ากับราคาลัง ขนาดบรรจุ 60
  const P3 = { record_id: 3, name: 'เรนเจอร์เอ๊กตรีม 8ชม 8+2 แซนดัลวูด', group_id: 0,
    base_price: 1166.34, tax_status: 'vat', sales_unit_code: 'CT' };
  const U3 = { product_id: 3, unit_code: 'CT', unit_factor: 60, price: 1166.34, is_active: 'TRUE' };
  PRODUCTS.push(P3); PRODUCT_UNITS.push(U3);

  eq('baseUnitPrice(): 1,166.34 ต่อลัง 60 ชิ้น → 19.44 ต่อชิ้น (ไม่ใช่ 1,166.34)',
    ctx.baseUnitPrice(P3, [U3]), 19.44);

  let r = ctx._priceSaleCart(1, [{ productId: 3, unitCode: '', qty: 1 }], 'cash', false);
  eq('★ ขาย 1 ชิ้น ต้องไม่เท่าราคา 1 ลัง (19.44 +VAT = 20.80 — เดิมได้ 1,247.98)',
    [r.success, r.items[0].lineTotal], [true, 20.8]);
  const whole = ctx._priceSaleCart(1, [{ productId: 3, unitCode: 'CT', qty: 1 }], 'cash', false);
  eq('  ขาย 1 ลัง ยังเท่าเดิมทุกบาท (1,166.34 +VAT = 1,247.98)',
    [whole.success, whole.items[0].lineTotal], [true, 1247.98]);
  eq('  ซื้อเป็นชิ้นต้องถูกกว่าซื้อเป็นลังเสมอ ไม่ใช่เท่ากัน',
    r.items[0].lineTotal < whole.items[0].lineTotal, true);

  // ขนาดบรรจุยังไม่ยืนยัน (factor 1) = ไม่มีข้อมูลพอให้หาร → ต้องไม่เพี้ยนไปทางอื่น
  const P4 = { record_id: 4, name: 'สินค้ายังไม่ยืนยันขนาดบรรจุ', group_id: 0, base_price: 300, tax_status: 'vat' };
  const U4 = { product_id: 4, unit_code: 'CT', unit_factor: 1, price: 300, is_active: 'TRUE' };
  eq('factor = 1 (ยังไม่ยืนยันขนาดบรรจุ) → คืน base_price ตามเดิม ไม่ใช่ 0',
    ctx.baseUnitPrice(P4, [U4]), 300);
  eq('ไม่มีหน่วยขายเลย → คืน base_price ตามเดิม',
    ctx.baseUnitPrice(P4, []), 300);

  // หน่วยขายตั้งต้นของสินค้าเป็นตัวตัดสินว่าหารด้วยอะไร เมื่อมีหลายหน่วย
  const P5 = { record_id: 5, name: 'สินค้าหลายหน่วย', group_id: 0, base_price: 999,
    tax_status: 'vat', sales_unit_code: 'PK' };
  const manyUnits = [{ product_id: 5, unit_code: 'CT', unit_factor: 60, price: 1200, is_active: 'TRUE' },
                     { product_id: 5, unit_code: 'PK', unit_factor: 5, price: 101, is_active: 'TRUE' }];
  eq('เลือกหารด้วยหน่วยขายตั้งต้นของสินค้า (PK 101/5 = 20.20 ไม่ใช่ CT 1200/60 = 20)',
    ctx.baseUnitPrice(P5, manyUnits), 20.2);
  eq('หน่วยที่ปิดใช้งานไม่ถูกเอามาคิด',
    ctx.baseUnitPrice(P5, [{ product_id: 5, unit_code: 'PK', unit_factor: 5, price: 101, is_active: 'FALSE' },
                                    { product_id: 5, unit_code: 'CT', unit_factor: 60, price: 1200, is_active: 'TRUE' }]), 20);

  PRODUCTS.pop(); PRODUCT_UNITS.pop();
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
