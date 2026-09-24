// รัน: node .dev/test-pricing-engine.js — ทดสอบ priceCart() (18_pricing_engine.gs) ด้วยตัวเลขจริงจากใบราคา ก.ค.–ก.ย. 2569
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { Utilities: {}, Session: {}, console };
vm.createContext(ctx);
for (const f of ['28_units.gs', '17_pricing.gs', '18_pricing_engine.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8'), ctx, { filename: f });

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

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
