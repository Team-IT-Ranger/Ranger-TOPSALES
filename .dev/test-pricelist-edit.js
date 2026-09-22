// รัน: node .dev/test-pricelist-edit.js — ทดสอบ action กรอก/แก้ชุดราคาเอง (17_pricing.gs) กับชีตจำลองในหน่วยความจำ ไม่ยิงเน็ต
// ครอบคลุม: create / clone / savePriceListLine / deletePriceListLine / savePriceListBillPromos, กติกา "แก้ได้เฉพาะ draft",
// และแถวที่เขียนแล้วเครื่องยนต์ priceCart() (18_pricing_engine.gs) คิดราคาได้ถูกต้อง
const fs = require('fs'), path = require('path'), vm = require('vm');
const { CENTRAL_SHEETS } = (() => {   // เอาหัวคอลัมน์จริงจาก 00_setup_sheets.gs (ไม่ต้องก๊อปมาไว้ซ้ำ)
  const c = { Utilities: {}, Session: {}, PropertiesService: {}, LockService: {}, SpreadsheetApp: {}, Logger: { log() {} } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', '00_setup_sheets.gs'), 'utf8') + '\nthis.__S = CENTRAL_SHEETS;', c);
  return { CENTRAL_SHEETS: c.__S };
})();

class FakeSheet {
  constructor(headers) { this.rows = [headers.slice()]; }
  getDataRange() { return { getValues: () => this.rows.map(r => r.slice()) }; }
  deleteRow(n) { this.rows.splice(n - 1, 1); }
  deleteRows(n, count) { this.rows.splice(n - 1, count); }
}
const sheets = {};
['price_lists', 'price_list_items', 'price_list_bill_promos', 'products', 'product_units', 'customer_groups'].forEach(n => { sheets[n] = new FakeSheet(CENTRAL_SHEETS[n]); });
const objs = sh => sh.rows.slice(1).filter(r => r[0] !== '' && r[0] != null).map(r => Object.fromEntries(sh.rows[0].map((h, i) => [h, r[i]])));
const append = (sh, o) => sh.rows.push(sh.rows[0].map(h => (o[h] !== undefined ? o[h] : '')));
let lockHeld = false;
const ctx = {
  console, Utilities: {}, Session: {},
  LockService: { getScriptLock: () => ({ tryLock() { if (lockHeld) return false; lockHeld = true; return true; }, releaseLock() { lockHeld = false; } }) },
  centralSheet: n => sheets[n],
  centralObjects: n => objs(sheets[n]),
  centralAppend: (n, o) => append(sheets[n], o),
  centralAppendMany: (n, os) => { os.forEach(o => append(sheets[n], o)); return os.length; },
  centralNextId: n => objs(sheets[n]).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralUpdate: (n, id, f) => { const sh = sheets[n], r = sh.rows.find((x, i) => i && String(x[0]) === String(id)); if (!r) return false; Object.keys(f).forEach(k => { r[sh.rows[0].indexOf(k)] = f[k]; }); return true; },
  deleteRowsWhere: (sh, col, v) => { const c = sh.rows[0].indexOf(col); let n = 0; for (let i = sh.rows.length - 1; i >= 1; i--) if (String(sh.rows[i][c]) === String(v)) { sh.rows.splice(i, 1); n++; } return n; },
  nowStr: () => '2026-09-22 10:00:00', safeDateStr: v => String(v || ''),
  _requirePermission: (s, m, a) => (s.canEdit || a === 'view' ? null : { success: false, message: 'ไม่มีสิทธิ์' }),
  _productAllCodes: p => [String(p.product_code).toLowerCase()]
};
vm.createContext(ctx);
for (const f of ['17_pricing.gs', '18_pricing_engine.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8'), ctx, { filename: f });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const S = { canEdit: true }, VIEWER = { canEdit: false };
append(sheets.customer_groups, { record_id: 1, name: 'ร้านค้า' });
append(sheets.customer_groups, { record_id: 2, name: 'ศูนย์' });
[[101, 'A101', 'แซนดัลวูด'], [102, 'A102', 'ลาเวนเดอร์'], [201, 'B201', 'กาว'], [301, 'C301', 'สบู่']].forEach(p => append(sheets.products, { record_id: p[0], product_code: p[1], name: p[2] }));
const itemsOf = id => objs(sheets.price_list_items).filter(i => String(i.price_list_id) === String(id));
const ctxOf = id => ctx._pricingContextForList(objs(sheets.price_lists).find(l => String(l.record_id) === String(id)));

// ── create ──
eq('ไม่มีสิทธิ์ edit → ปฏิเสธ', ctx.createPriceList(VIEWER, { name: 'x', customerGroupId: 2, validFrom: '2026-10-01', validTo: '2026-12-31' }).success, false);
eq('วันเริ่มหลังวันสิ้นสุด → ปฏิเสธ', ctx.createPriceList(S, { name: 'x', customerGroupId: 2, validFrom: '2026-12-31', validTo: '2026-10-01' }).success, false);
eq('กลุ่มลูกค้าไม่มีจริง → ปฏิเสธ', ctx.createPriceList(S, { name: 'x', customerGroupId: 99, validFrom: '2026-10-01', validTo: '2026-12-31' }).success, false);
let r = ctx.createPriceList(S, { name: 'ศูนย์ ต.ค.–ธ.ค. 69', customerGroupId: 2, validFrom: '2026-10-01', validTo: '2026-12-31', note: 'n' });
eq('สร้างชุดเปล่า → draft', [r.success, r.list.status, r.list.customerGroupName, r.list.lineCount], [true, 'draft', 'ศูนย์', 0]);
const L1 = r.id;

// ── savePriceListLine: ขั้นเดียว (ศูนย์) ──
r = ctx.savePriceListLine(S, { priceListId: L1, productIds: [301], caseFactor: 48, listExVat: 500, tiers: [{ min: 1, max: null, cashInclVat: 520, creditInclVat: 530 }] });
eq('บันทึก line ใหม่ขั้นเดียว', [r.success, r.line.tiers.length, r.line.tiers[0].max, r.line.products[0].productCode], [true, 1, null, 'C301']);
const soapLine = r.line.lineId;
eq('  เขียน 1 แถว CASE', itemsOf(L1).map(i => [i.unit_code, i.min_qty, i.max_qty, i.cash_price_incl_vat, i.credit_price_incl_vat, i.van_only]), [['CASE', 1, '', 520, 530, 'FALSE']]);
eq('  สร้างหน่วยหีบให้สินค้า', objs(sheets.product_units).map(u => [u.product_id, u.unit_code, u.unit_factor]), [[301, 'CASE', 48]]);
let p = ctx.priceCart(ctxOf(L1), [{ productId: 301, unitCode: 'CASE', qty: 7 }], { isCredit: false, isVan: false });
eq('  เครื่องยนต์คิดราคา 7 หีบ เงินสด = 3,640', [p.success, p.total], [true, 3640]);

// ── line หลายสินค้า + หลายขั้น + แพ็ค ──
const lineIn = { priceListId: L1, productIds: [101, 102], caseFactor: 60, listExVat: 1200, suggestedPack: 110, retailPiece: 25,
  tiers: [{ min: 2, max: 9, cashInclVat: 1200, creditInclVat: 1215 }, { min: 1, max: 1, cashInclVat: 1210, creditInclVat: 1225 }, { min: 10, max: '', cashInclVat: 1190, creditInclVat: 1205 }],
  packs: [{ factor: 5, cashInclVat: 101 }] };
r = ctx.savePriceListLine(S, lineIn);
eq('บันทึก line 2 สินค้า 3 ขั้น + แพ็ค (ขั้นเรียงให้เอง)', [r.success, r.line.tiers.map(t => t.min), r.line.packs.length], [true, [1, 2, 10], 1]);
const xLine = r.line.lineId;
eq('  เขียน (3 ขั้น + 1 แพ็ค) × 2 สินค้า = 8 แถว line_id เดียวกัน', [itemsOf(L1).filter(i => i.line_id === xLine).length, xLine !== soapLine], [8, true]);
p = ctx.priceCart(ctxOf(L1), [{ productId: 101, unitCode: 'CASE', qty: 1 }, { productId: 102, unitCode: 'CASE', qty: 1 }], { isCredit: true, isVan: false });
eq('  แซนดัลวูด 1 + ลาเวนเดอร์ 1 นับรวม 2 หีบ เครดิต → 1,215', p.lines.map(l => l.unitPrice), [1215, 1215]);
p = ctx.priceCart(ctxOf(L1), [{ productId: 101, unitCode: 'PACK', qty: 2 }], { isCredit: false, isVan: true });
eq('  แพ็คขายรถ เงินสด 2 แพ็ค = 202', p.total, 202);
p = ctx.priceCart(ctxOf(L1), [{ productId: 101, unitCode: 'PACK', qty: 2 }], { isCredit: false, isVan: false });
eq('  แพ็คไม่ใช่รถ → PACK_VAN_ONLY', p.code, 'PACK_VAN_ONLY');
r = ctx.getPriceList(S, { id: L1 });
const got = r.lines.find(l => l.lineId === xLine);
eq('  getPriceList อ่านกลับได้รูปแบบเดียวกับที่ save คืน', [got.caseFactor, got.listExVat, got.tiers.map(t => [t.min, t.max, t.cashInclVat]), got.packs[0].unitFactor, got.suggestedPack, got.retailPiece],
   [60, 1200, [[1, 1, 1210], [2, 9, 1200], [10, null, 1190]], 5, 110, 25]);

// ── validation ──
const bad = (name, extra) => eq(name, ctx.savePriceListLine(S, Object.assign({ priceListId: L1, productIds: [201], caseFactor: 10, tiers: [{ min: 1, max: null, cashInclVat: 100 }] }, extra)).success, false);
bad('ไม่มีสินค้า → ปฏิเสธ', { productIds: [] });
bad('caseFactor 0 → ปฏิเสธ', { caseFactor: 0 });
bad('ขั้นทับกัน → ปฏิเสธ', { tiers: [{ min: 1, max: 5, cashInclVat: 1 }, { min: 5, max: null, cashInclVat: 1 }] });
bad('มีขั้นต่อจาก "ขึ้นไป" → ปฏิเสธ', { tiers: [{ min: 1, max: null, cashInclVat: 1 }, { min: 5, max: null, cashInclVat: 1 }] });
bad('ขั้นไม่มีราคาเลย → ปฏิเสธ', { tiers: [{ min: 1, max: null }] });
bad('ราคาไม่ใช่ตัวเลข → ปฏิเสธ', { tiers: [{ min: 1, max: null, cashInclVat: 'abc' }] });
bad('แพ็คไม่มีราคาเงินสด → ปฏิเสธ', { packs: [{ factor: 5 }] });
bad('สินค้าไม่มีจริง → ปฏิเสธ', { productIds: [999] });
r = ctx.savePriceListLine(S, { priceListId: L1, productIds: [101], caseFactor: 60, tiers: [{ min: 1, max: null, cashInclVat: 1 }] });
eq('สินค้าอยู่ใน line อื่นของชุดนี้แล้ว → ปฏิเสธ', [r.success, /มีอยู่ในรายการอื่น/.test(r.message)], [false, true]);

// ── แก้ line เดิม (ลบแล้วเขียนใหม่ line_id เดิม) ──
const before = itemsOf(L1).length;
r = ctx.savePriceListLine(S, Object.assign({}, lineIn, { lineId: xLine, productIds: [101, 102, 201], tiers: [{ min: 1, max: null, cashInclVat: 1111, creditInclVat: 1122 }], packs: [] }));
eq('แก้ line: เพิ่มสินค้า เหลือขั้นเดียว ไม่มีแพ็ค', [r.success, r.line.lineId, r.line.products.length], [true, xLine, 3]);
eq('  แถวของ line นี้เหลือ 3 (ของเก่า 8 แถวถูกลบ) line อื่นไม่โดน', [itemsOf(L1).filter(i => i.line_id === xLine).length, itemsOf(L1).length], [3, before - 8 + 3]);
eq('  line สบู่ยังอยู่ครบ', itemsOf(L1).filter(i => i.line_id === soapLine).map(i => i.cash_price_incl_vat), [520]);
r = ctx.savePriceListLine(S, Object.assign({}, lineIn, { lineId: 424242 }));
eq('แก้ line ที่ไม่มีอยู่ → ปฏิเสธ', r.success, false);

// ── โปรระดับบิล ──
eq('โปร % ≥ 100 → ปฏิเสธ', ctx.savePriceListBillPromos(S, { priceListId: L1, promos: [{ minAmountExVat: 1000, percent: 100 }] }).success, false);
eq('โปรยอดซ้ำ → ปฏิเสธ', ctx.savePriceListBillPromos(S, { priceListId: L1, promos: [{ minAmountExVat: 1000, percent: 1 }, { minAmountExVat: 1000, percent: 2 }] }).success, false);
r = ctx.savePriceListBillPromos(S, { priceListId: L1, promos: [{ minAmountExVat: 100000, percent: 1 }, { minAmountExVat: 50000, percent: 0.5 }] });
eq('บันทึกโปร 2 ขั้น (เรียงให้)', r.billPromos, [{ minAmountExVat: 50000, percent: 0.5 }, { minAmountExVat: 100000, percent: 1 }]);
r = ctx.savePriceListBillPromos(S, { priceListId: L1, promos: [{ minAmountExVat: 20000, percent: 2 }] });
eq('  บันทึกซ้ำ = แทนที่ทั้งชุด', objs(sheets.price_list_bill_promos).filter(b => String(b.price_list_id) === String(L1)).map(b => [b.min_amount_ex_vat, b.percent]), [[20000, 2]]);

// ── ลบ line ──
r = ctx.deletePriceListLine(S, { priceListId: L1, lineId: soapLine });
eq('ลบ line สบู่', [r.success, r.deleted, itemsOf(L1).some(i => i.line_id === soapLine)], [true, 1, false]);
eq('  ลบซ้ำ → ปฏิเสธ', ctx.deletePriceListLine(S, { priceListId: L1, lineId: soapLine }).success, false);

// ── เปิดใช้งานแล้วห้ามแตะ ──
ctx.setPriceListStatus(S, { id: L1, status: 'active' });
const snap = JSON.stringify([itemsOf(L1), objs(sheets.price_list_bill_promos)]);
eq('active: savePriceListLine → ปฏิเสธ', ctx.savePriceListLine(S, Object.assign({}, lineIn, { productIds: [301] })).success, false);
eq('active: แก้ line เดิม → ปฏิเสธ', ctx.savePriceListLine(S, Object.assign({}, lineIn, { lineId: xLine })).success, false);
eq('active: deletePriceListLine → ปฏิเสธ', ctx.deletePriceListLine(S, { priceListId: L1, lineId: xLine }).success, false);
eq('active: savePriceListBillPromos → ปฏิเสธ', ctx.savePriceListBillPromos(S, { priceListId: L1, promos: [] }).success, false);
eq('  ข้อมูลชุด active ไม่เปลี่ยนแม้แต่แถวเดียว', JSON.stringify([itemsOf(L1), objs(sheets.price_list_bill_promos)]), snap);
ctx.setPriceListStatus(S, { id: L1, status: 'archived' });
eq('archived: savePriceListLine → ปฏิเสธ', ctx.savePriceListLine(S, Object.assign({}, lineIn, { productIds: [301] })).success, false);
ctx.setPriceListStatus(S, { id: L1, status: 'draft' });
eq('เคย active แล้วย้อนเป็นร่าง → ยังห้ามแก้ (activated_at ไม่ว่าง)', [ctx.savePriceListLine(S, Object.assign({}, lineIn, { productIds: [301] })).success,
   ctx.deletePriceListLine(S, { priceListId: L1, lineId: xLine }).success, ctx.savePriceListBillPromos(S, { priceListId: L1, promos: [] }).success], [false, false, false]);
eq('  ข้อมูลยังไม่เปลี่ยน', JSON.stringify([itemsOf(L1), objs(sheets.price_list_bill_promos)]), snap);
ctx.setPriceListStatus(S, { id: L1, status: 'active' });

// ── clone งวดใหม่ ──
r = ctx.clonePriceList(S, { id: L1, name: 'ศูนย์ ม.ค.–มี.ค. 70', validFrom: '2027-01-01', validTo: '2027-03-31' });
const L2 = r.id;
eq('clone ชุด active → draft ใหม่ กลุ่มเดิม', [r.success, r.list.status, r.list.customerGroupId, r.list.itemCount, r.list.lineCount], [true, 'draft', 2, itemsOf(L1).length, 1]);
const srcRows = itemsOf(L1), dstRows = itemsOf(L2);
const strip = i => { const o = Object.assign({}, i); delete o.record_id; delete o.price_list_id; delete o.line_id; return JSON.stringify(o); };
eq('  ทุกคอลัมน์ของแถว (ยกเว้น id) เหมือนต้นฉบับ', dstRows.map(strip), srcRows.map(strip));
eq('  line_id ใหม่ไม่ชนกับของต้นฉบับ แต่ยังรวมกลุ่มเหมือนเดิม', [new Set(dstRows.map(i => i.line_id)).size, dstRows.some(i => srcRows.some(s => s.line_id === i.line_id))], [1, false]);
eq('  โปรระดับบิลถูกก๊อป', objs(sheets.price_list_bill_promos).filter(b => String(b.price_list_id) === String(L2)).map(b => [b.min_amount_ex_vat, b.percent]), [[20000, 2]]);
const newLine = dstRows[0].line_id;
r = ctx.savePriceListLine(S, { priceListId: L2, lineId: newLine, productIds: [101, 102, 201], caseFactor: 60, listExVat: 1200, tiers: [{ min: 1, max: null, cashInclVat: 1150, creditInclVat: 1160 }] });
eq('  แก้ราคาในชุดใหม่ได้', r.success, true);
eq('  ชุดต้นฉบับ (active) ราคาเดิมไม่เปลี่ยน', itemsOf(L1).map(i => i.cash_price_incl_vat), [1111, 1111, 1111]);
eq('  ชุดใหม่ได้ราคาใหม่', itemsOf(L2).map(i => i.cash_price_incl_vat), [1150, 1150, 1150]);
eq('clone ต้นทางไม่มีจริง → ปฏิเสธ', ctx.clonePriceList(S, { id: 999, name: 'x', validFrom: '2027-01-01', validTo: '2027-03-31' }).success, false);
eq('clone ไม่ตั้งชื่อ → ปฏิเสธ', ctx.clonePriceList(S, { id: L1, name: ' ', validFrom: '2027-01-01', validTo: '2027-03-31' }).success, false);
eq('lock ถูกปล่อยทุกครั้ง', lockHeld, false);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
