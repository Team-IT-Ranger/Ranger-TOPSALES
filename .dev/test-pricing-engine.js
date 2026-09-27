// รัน: node .dev/test-pricing-engine.js — ทดสอบ priceCart() (18_pricing_engine.gs) ด้วยตัวเลขจริงจากใบราคา ก.ค.–ก.ย. 2569
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { Utilities: {}, Session: {}, console };
vm.createContext(ctx);
for (const f of ['28_units.gs', '17_pricing.gs', '18_pricing_engine.gs', '10_master_data.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8'), ctx, { filename: f });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

// ── ชุดราคาร้านค้า กทม./กลาง/ตะวันตก (ตัดมาเฉพาะที่ใช้ทดสอบ) ──
let itemId = 1;
const row = (line, pid, unit, factor, min, max, cash, credit, label) => ({ record_id: itemId++, price_list_id: 1, line_id: line, product_id: pid, unit_code: unit, unit_factor: factor,
  min_qty: min, max_qty: max === null ? '' : max, cash_price_incl_vat: cash, credit_price_incl_vat: credit, van_only: unit === 'PK' ? 'TRUE' : 'FALSE', tier_label: label || '' });
const items = [];
// line 1: เอ็กซ์ตรีม แซนดัลวูด(101) + ลาเวนเดอร์(102) ใช้ตารางขั้นร่วมกัน
[101, 102].forEach(pid => {
  [[1, 1, 1210, 1225], [2, 9, 1200, 1215], [10, 29, 1190, 1205], [30, 49, 1180, 1195], [50, null, 1170, 1185]].forEach(t => items.push(row(1, pid, 'CT', 60, t[0], t[1], t[2], t[3])));
  items.push(row(1, pid, 'PK', 5, 1, null, 101, '', 'ขายเฉพาะหน่วยรถ'));
});
// line 2: กาวแถมกาวสองหน้า (201) 1x20x5x5
[[1, 1, 1240, 1255], [2, 4, 1220, 1235], [5, null, 1200, 1215]].forEach(t => items.push(row(2, 201, 'CT', 500, t[0], t[1], t[2], t[3])));
const pctx = { list: { record_id: 1, name: 'ทดสอบ' }, items, billPromos: [{ minAmountExVat: 50000, percent: 0.5 }, { minAmountExVat: 100000, percent: 1 }] };
const cash = { isCredit: false, isVan: false }, credit = { isCredit: true, isVan: false };
const price = (cart, o) => ctx.priceCart(pctx, cart, o);

let r = price([{ productId: 101, unitCode: 'CT', qty: 1 }], cash);
eq('1 หีบ เงินสด = 1,210', [r.success, r.lines[0].unitPrice, r.total], [true, 1210, 1210]);

r = price([{ productId: 101, unitCode: 'CT', qty: 1 }], credit);
eq('1 หีบ เครดิต = 1,225 (เงินสด +15)', r.lines[0].unitPrice, 1225);

r = price([{ productId: 101, unitCode: 'CT', qty: 1 }, { productId: 102, unitCode: 'CT', qty: 1 }], cash);
eq('แซนดัลวูด 1 + ลาเวนเดอร์ 1 นับรวมเป็น 2 หีบ → ขั้น 2-9 = 1,200 ทั้งสองบรรทัด', r.lines.map(l => l.unitPrice), [1200, 1200]);
eq('  รวม 2,400', r.total, 2400);

r = price([{ productId: 101, unitCode: 'CT', qty: 30 }], cash);
eq('30 หีบ (ภาค กทม.) = ขั้น 30-49 = 1,180', r.lines[0].unitPrice, 1180);

r = price([{ productId: 101, unitCode: 'CT', qty: 50 }], credit);
eq('50 หีบ เครดิต = ขั้น 50+ = 1,185', r.lines[0].unitPrice, 1185);

r = price([{ productId: 101, unitCode: 'PK', qty: 3 }], { isCredit: false, isVan: true });
eq('แพ็ค Cash Van เงินสด 3 แพ็ค = 303', [r.success, r.lines[0].unitPrice, r.total], [true, 101, 303]);

r = price([{ productId: 101, unitCode: 'PK', qty: 1 }], { isCredit: false, isVan: false });
eq('แพ็คนอก Cash Van → ปฏิเสธ', [r.success, r.code], [false, 'PACK_VAN_ONLY']);

r = price([{ productId: 101, unitCode: 'PK', qty: 1 }], { isCredit: true, isVan: true });
eq('แพ็คแบบเครดิต → ปฏิเสธ', [r.success, r.code], [false, 'PACK_CASH_ONLY']);

r = price([{ productId: 999, unitCode: 'CT', qty: 1 }], cash);
eq('สินค้าที่ไม่อยู่ในชุดราคา → ปฏิเสธ (ไม่ขายผิดราคา)', [r.success, r.code], [false, 'NOT_IN_PRICE_LIST']);

r = price([{ productId: 201, unitCode: 'CT', qty: 40 }], cash);           // 40 × 1200 = 48,000 รวม VAT → ไม่รวม VAT 44,859 < 50,000
eq('กาว 40 หีบ = 48,000 → ยังไม่ถึงโปรบิล', [r.subtotal, r.billPercent, r.total], [48000, 0, 48000]);

r = price([{ productId: 201, unitCode: 'CT', qty: 45 }], cash);           // 54,000 รวม VAT → 50,467.29 ไม่รวม VAT ≥ 50,000
eq('กาว 45 หีบ = 54,000 (ไม่รวม VAT 50,467) → ลดเพิ่ม 0.5% = 270', [r.subtotal, r.billPercent, r.billDiscount, r.total], [54000, 0.5, 270, 53730]);

r = price([{ productId: 201, unitCode: 'CT', qty: 47 }], cash);           // 56,400 → ex 52,710
eq('กาว 47 หีบ ลด 0.5% (ไม่ใช่ 1%)', [r.billPercent, r.billDiscount], [0.5, 282]);

r = price([{ productId: 201, unitCode: 'CT', qty: 90 }], cash);           // 108,000 → ex 100,934 ≥ 100,000
eq('กาว 90 หีบ = 108,000 (ไม่รวม VAT 100,934) → ลดเพิ่ม 1% ขั้นเดียว = 1,080', [r.billPercent, r.billDiscount, r.total], [1, 1080, 106920]);

r = price([{ productId: 201, unitCode: 'CT', qty: 0 }], cash);
eq('จำนวน 0 → ปฏิเสธ', r.success, false);

// ขอบเขตขั้น: 1 หีบเท่านั้นสำหรับขั้นแรก, 2 หีบขึ้นขั้นสอง (ไม่มีช่องว่างที่ตกหล่น)
r = price([{ productId: 201, unitCode: 'CT', qty: 2 }], cash);
eq('กาว 2 หีบ = 1,220', r.lines[0].unitPrice, 1220);

// ── isCreditPayment ──
eq('credit_term = เครดิต', [ctx.isCreditPayment('credit_term'), ctx.isCreditPayment('cash'), ctx.isCreditPayment('transfer'), ctx.isCreditPayment(undefined)], [true, false, false, false]);

// -- รหัสหน่วยเก่า (CASE/PACK) ต้องยังคิดราคาได้ ทั้งฝั่งตะกร้าและฝั่งข้อมูลในชีต --
console.log('\n── ความเข้ากันได้กับรหัสหน่วยเก่า ──');
r = price([{ productId: 101, unitCode: 'CASE', qty: 12 }], cash);
eq('ตะกร้าส่งรหัสเก่า CASE -> ได้ขั้น 10-29 (1,190)', [r.success, r.lines[0].unitPrice, r.lines[0].unitCode], [true, 1190, 'CT']);
r = price([{ productId: 101, unitCode: 'PACK', qty: 1 }], { isCredit: false, isVan: true });
eq('ตะกร้าส่งรหัสเก่า PACK บนรถ -> 101', [r.success, r.lines[0].unitPrice, r.lines[0].unitCode], [true, 101, 'PK']);
const legacyCtx = { list: pctx.list, billPromos: pctx.billPromos,
  items: pctx.items.map(it => Object.assign({}, it, { unit_code: it.unit_code === 'CT' ? 'CASE' : 'PACK' })) };
r = ctx.priceCart(legacyCtx, [{ productId: 101, unitCode: 'CT', qty: 12 }], cash);
eq('ข้อมูลในชีตยังเป็นรหัสเก่า แต่ตะกร้าใช้รหัสใหม่ -> ยังคิดได้', [r.success, r.lines[0].unitPrice], [true, 1190]);
eq('normUnitCode: คำไทย/รหัสเก่า -> มาตรฐาน',
   ['หีบ', 'CASE', 'ลัง', 'แพ็ค', 'PACK', 'ชิ้น', 'แผ่น', 'pcs', 'SHEET', ''].map(x => ctx.normUnitCode(x, 'PC')),
   ['CT', 'CT', 'CT', 'PK', 'PK', 'PC', 'PC', 'PC', 'PC', 'PC']);
eq('unitLabelOf: รหัส -> ชื่อไทยที่ใช้ทั้งระบบ', ['CT','PK','PC'].map(c => ctx.unitLabelOf(c)), ['ลัง','แพ็ค','ชิ้น']);

console.log('\n-- แยกภาษีมูลค่าเพิ่มออกจากราคาขาย (ราคาของเราเป็นราคารวมภาษี) --');
eq('ถอด VAT 7% ออกจาก 107 บาท', (() => { const v = ctx.splitVat(107); return [v.exVat, v.vat, v.gross]; })(), [100, 7, 107]);
eq('ยอดที่หารไม่ลงตัว ต้องบวกกลับได้เท่าเดิมเป๊ะ (กันงบไม่ลงตัวเพราะปัดเศษ)', (() => {
  const bad = [];
  for (let cents = 1; cents <= 2000; cents++) {
    const gross = Math.round(cents * 13.37) / 100;          // ยอดสารพัดแบบที่หารด้วย 1.07 ไม่ลงตัว
    const v = ctx.splitVat(gross);
    if (Math.round((v.exVat + v.vat) * 100) !== Math.round(gross * 100)) bad.push(gross);
  }
  return bad.length;
})(), 0);
eq('ยอดศูนย์ไม่พัง', (() => { const v = ctx.splitVat(0); return [v.exVat, v.vat]; })(), [0, 0]);
eq('อัตราอื่นก็สั่งได้ (เผื่อกฎหมายเปลี่ยน / สินค้าอัตราศูนย์)', (() => {
  const v = ctx.splitVat(100, 0); return [v.exVat, v.vat]; })(), [100, 0]);
eq('ยอดที่ปัดเศษแล้วภาษีตรงกับที่บัญชีคิด', (() => {
  const v = ctx.splitVat(31456);
  return [v.exVat, v.vat, Math.round((v.exVat + v.vat) * 100) / 100];
})(), [29398.13, 2057.87, 31456]);

console.log('\n-- สินค้ายกเว้น VAT ปนอยู่ในบิลเดียวกัน --');
const TAXMAP = { P1: 'vat', P2: 'vat', E1: 'exempt', Z1: 'zero' };
const taxOf = pid => TAXMAP[pid] || 'vat';

eq('สถานะภาษี: ว่าง/ไม่รู้จัก = คิด VAT · เก็บเฉพาะค่าที่รู้จัก', [
  ctx.productTaxStatus({}), ctx.productTaxStatus({ tax_status: '' }), ctx.productTaxStatus({ tax_status: 'none' }),
  ctx.productTaxStatus({ tax_status: 'exempt' }), ctx.productTaxStatus({ tax_status: 'ZERO' })
], ['vat', 'vat', 'vat', 'exempt', 'zero']);
eq('  vat_type เดิมไม่มีผลกับภาษีเลย (คนละคอลัมน์โดยตั้งใจ)', ctx.productTaxStatus({ vat_type: 'none' }), 'vat');

eq('บิลที่มีแต่ของคิดภาษี', (() => {
  const b = ctx.saleVatBreakdown([{ productId:'P1', lineTotal: 107 }], 0, taxOf);
  return [b.taxableExVat, b.vat, b.exemptAmount, b.mixed];
})(), [100, 7, 0, false]);

eq('บิลที่มีแต่ของยกเว้นภาษี → ภาษีเป็นศูนย์ ไม่ถูกถอด 7% ออก', (() => {
  const b = ctx.saleVatBreakdown([{ productId:'E1', lineTotal: 500 }], 0, taxOf);
  return [b.exVat, b.vat, b.exemptAmount, b.mixed];
})(), [500, 0, 500, false]);

eq('อัตราศูนย์ก็ไม่มีภาษีบวกในราคาเหมือนกัน', (() => {
  const b = ctx.saleVatBreakdown([{ productId:'Z1', lineTotal: 300 }], 0, taxOf);
  return [b.vat, b.exemptAmount];
})(), [0, 300]);

eq('บิลผสม ไม่มีส่วนลด', (() => {
  const b = ctx.saleVatBreakdown([{ productId:'P1', lineTotal: 107 }, { productId:'E1', lineTotal: 500 }], 0, taxOf);
  return [b.taxableExVat, b.vat, b.exemptAmount, b.total, b.mixed];
})(), [100, 7, 500, 607, true]);

eq('★ ส่วนลดท้ายบิลเฉลี่ยตามสัดส่วน ไม่ใช่หักจากฝั่งใดฝั่งหนึ่ง', (() => {
  // ของคิดภาษี 600 + ยกเว้น 400 = 1000 ลด 100 → ลดฝั่งภาษี 60 ฝั่งยกเว้น 40
  const b = ctx.saleVatBreakdown([{ productId:'P1', lineTotal: 600 }, { productId:'E1', lineTotal: 400 }], 100, taxOf);
  const netVat = 540, ex = Math.round((netVat/1.07)*100)/100;
  return [b.exemptAmount, b.taxableExVat, b.vat, b.total, Math.round((b.taxableExVat + b.vat + b.exemptAmount)*100)/100];
})(), [360, 504.67, 35.33, 900, 900]);

eq('  ถ้าหักส่วนลดทั้งก้อนจากฝั่งภาษี ภาษีจะผิดไปเท่านี้ (เทียบให้เห็น)', (() => {
  const wrong = Math.round(((600-100)/1.07)*7/100*100)/100;   // วิธีผิด
  const b = ctx.saleVatBreakdown([{ productId:'P1', lineTotal: 600 }, { productId:'E1', lineTotal: 400 }], 100, taxOf);
  return b.vat !== wrong;
})(), true);

eq('ทุกกรณี มูลค่าไม่รวมภาษี + ภาษี ต้องเท่ายอดสุทธิเป๊ะ', (() => {
  const bad = [];
  for (let i = 1; i <= 800; i++) {
    const a = Math.round(i * 13.37) / 100, e = Math.round(i * 7.91) / 100, d = Math.round(i * 1.13) / 100;
    const b = ctx.saleVatBreakdown([{ productId:'P1', lineTotal: a }, { productId:'E1', lineTotal: e }], d, taxOf);
    if (Math.round((b.exVat + b.vat) * 100) !== Math.round(b.total * 100)) bad.push([a, e, d]);
    if (Math.round((b.taxableExVat + b.exemptAmount) * 100) !== Math.round(b.exVat * 100)) bad.push(['ex', a, e, d]);
  }
  return bad.length;
})(), 0);

eq('บิลเปล่า/ยอดศูนย์ไม่พัง', (() => { const b = ctx.saleVatBreakdown([], 0, taxOf); return [b.total, b.vat, b.exVat]; })(), [0, 0, 0]);

console.log('\n-- อัตรา VAT เป็นค่าตั้ง ไม่ใช่ค่าคงที่ในโค้ด --');
// จำลองแถวบริษัท: currentVatRate() อ่านผ่าน _companyRow()
let COMPANY_ROW = {};
ctx._companyRow = () => COMPANY_ROW;
eq('ยังไม่ได้ตั้งค่า → 7% ตามกฎหมายปัจจุบัน', ctx.currentVatRate(), 0.07);
COMPANY_ROW = { vat_rate: 10 };
eq('ตั้ง 10 (เปอร์เซ็นต์) → คำนวณด้วย 0.10 (ทศนิยม) แปลงที่จุดเดียว', ctx.currentVatRate(), 0.1);
eq('  ถอดภาษีตามอัตราที่ตั้งจริง ไม่ใช่ 7% เงียบๆ', (() => { const v = ctx.splitVat(110); return [v.exVat, v.vat]; })(), [100, 10]);
COMPANY_ROW = { vat_rate: 0 };
eq('ตั้ง 0 ได้จริง (บริษัทไม่อยู่ในระบบ VAT)', [ctx.currentVatRate(), ctx.splitVat(100).vat], [0, 0]);
COMPANY_ROW = { vat_rate: 'เจ็ด' };
eq('ค่าขยะ/นอกช่วง → ตกกลับไปที่ 7% ไม่ใช่ NaN', ctx.currentVatRate(), 0.07);
COMPANY_ROW = { vat_rate: 7 };

eq('ชนิดราคาอ่านจากค่าตั้ง (ของเราเป็น inclusive)', [ctx.currentVatType(),
  (() => { COMPANY_ROW = { default_vat_type: 'exclusive' }; const t = ctx.currentVatType(); COMPANY_ROW = { vat_rate: 7 }; return t; })()],
  ['inclusive', 'exclusive']);

console.log('\n-- ★ เปลี่ยนอัตราแล้ว บิลเก่าต้องไม่ขยับ --');
const OLD_BILL = { total: 1070, vat_rate: 0.07, subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0, apply_vat: 'TRUE', vat_type: 'inclusive' };
const before = ctx._orderVat(OLD_BILL);
COMPANY_ROW = { vat_rate: 10 };                       // รัฐขึ้นภาษีเป็น 10%
const after = ctx._orderVat(OLD_BILL);
eq('ใบที่ออกไปแล้วยังเป็นตัวเลขเดิมทุกค่า', [after.rate, after.exVat, after.vat], [before.rate, before.exVat, before.vat]);
eq('  และยังเป็น 7% ของวันที่ออก ไม่ใช่ 10% ของวันนี้', [after.rate, after.vat], [0.07, 70]);
eq('บิลใหม่หลังเปลี่ยนอัตรา ใช้อัตราใหม่', ctx.splitVat(110).vat, 10);
COMPANY_ROW = { vat_rate: 7 };

eq('บิลเก่าที่ยังไม่มีคอลัมน์ภาษีเลย → ถอดสดให้ ณ อัตราปัจจุบัน', (() => {
  const v = ctx._orderVat({ total: 107 }); return [v.vat, v.applyVat];
})(), [7, true]);

console.log('\n-- ค่าว่างของ "คิด VAT ไหม" ต้องแปลว่าคิด --');
eq('ว่าง/null/undefined = คิด VAT', [ctx.vatFlagOn(''), ctx.vatFlagOn(null), ctx.vatFlagOn(undefined)], [true, true, true]);
eq('ปิดชัดเจนเท่านั้นถึงไม่คิด', [ctx.vatFlagOn('FALSE'), ctx.vatFlagOn(false), ctx.vatFlagOn(0), ctx.vatFlagOn('no')], [false, false, false, false]);
eq('เปิดชัดเจน', [ctx.vatFlagOn('TRUE'), ctx.vatFlagOn(true), ctx.vatFlagOn(1)], [true, true, true]);

console.log('\n-- ธงคุณสมบัติสินค้า (Express STMAS / Smartsales item) --');
eq('no_discount: ค่าว่าง = ลดราคาได้ (ตรงข้ามกับธงอื่นโดยตั้งใจ)', [
  ctx.isNoDiscountProduct({}), ctx.isNoDiscountProduct({ no_discount: '' }),
  ctx.isNoDiscountProduct({ no_discount: 'FALSE' }), ctx.isNoDiscountProduct({ no_discount: 'TRUE' })
], [false, false, false, true]);
eq('ธงอื่น: ค่าว่าง = ใช่ (สินค้าเดิมขายได้/ซื้อได้/ตัดสต็อกเหมือนเดิม ไม่ต้อง migrate)', [
  ctx.isSellableProduct({}), ctx.isPurchasableProduct({}), ctx.isStockProduct({}),
  ctx.isStockProduct({ is_stock: 'FALSE' }), ctx.isSellableProduct({ is_sellable: 'FALSE' })
], [true, true, true, false, false]);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
