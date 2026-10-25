// รัน: node .dev/test-dashboard-export.js
// ทดสอบตัวส่งยอดขายออกเป็นไฟล์กลางของ Dashboard (59_dashboard_export.gs) บนชีตจำลอง ไม่ยิงเน็ตและไม่แตะ Drive
//
// ★★★ สิ่งที่ไฟล์นี้คุมคือ "อะไรนับเป็นยอดขาย และบรรทัดหนึ่งขายได้เท่าไรจริง" ซึ่งผิดแล้วไม่มีอะไรฟ้อง —
//   ไฟล์ออกมาหน้าตาปกติ ตัวเลขดูสมเหตุสมผล แต่ไม่ตรงกับหน้าจอของบริษัทและไม่ตรงกับใบกำกับที่ออกไป
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let failed = 0;
const show = v => JSON.stringify(v);
function eq(name, got, want) {
  if (show(got) === show(want)) { console.log('PASS ' + name); return; }
  failed++; console.log('FAIL ' + name + '\n   expected ' + show(want) + '\n   actual   ' + show(got));
}

/* ── ชีตจำลอง: เก็บเป็น array ของ object ตรงๆ พอสำหรับตัวอ่าน ── */
const central = { tenants: [], customers: [], products: [], ar_invoices: [], ar_credit_notes: [], gl_journals: [] };
const tenantData = {};   // tenantId -> { sales_orders, order_items, delivery_rounds, delivery_round_items }
const T = (tid, tab) => ((tenantData[tid] || {})[tab] || []);

const ctx = {
  Logger: { log() {} },
  Utilities: { formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: {}, DriveApp: {}, UrlFetchApp: {}, ScriptApp: {}, CacheService: {},

  centralObjects: n => (central[n] || []).map(o => Object.assign({}, o)),
  tenantObjectsIfExists: (tid, tab) => T(tid, tab).map(o => Object.assign({}, o)),
  tenantObjects: (tid, tab) => T(tid, tab).map(o => Object.assign({}, o)),

  // ── ตัวช่วยที่ 58/59 ใช้ ──
  _requirePermission: () => null,
  _bookSalesTenant: b => b || 'HOUSE',
  _normBook: t => (String(t || '') === 'HOUSE' ? '' : String(t || '')),
  _inBook: (row, scope) => String(row && row.tenant_id || '') === String(scope || ''),
  _dOnly: v => String(v || '').substring(0, 10),
  _inMonth: (v, m) => String(v || '').substring(0, 7) === m,
  _int: v => parseInt(v, 10) || 0,
  _money: n => Math.round((Number(n) || 0) * 100) / 100,
  nowStr: () => '2026-10-24 10:00:00',
  isFlagOn: v => String(v).toUpperCase() === 'TRUE' || v === true || v === 1,
  isCreditPayment: c => String(c || '').toLowerCase() === 'credit_term',
  customerFullName: c => String(c.name || ''),
  saleOrderHasRounds: o => T(o.__tid, 'delivery_rounds').some(r => String(r.order_id) === String(o.record_id)),
  _saleByLabel: s => (s ? 'พนักงาน ' + s : '(ไม่ระบุ)')
};
vm.createContext(ctx);
// ★ ใช้ตัวคิดเงินของจริง (soldNetByItem / lineExVat / splitVat) ไม่ใช่ตัวจำลอง — เลขต่อบรรทัดคือสิ่งที่กำลังทดสอบ
vm.runInContext(B('18_pricing_engine.gs') + '\n' + B('58_tax_invoices.gs') + '\n' + B('59_dashboard_export.gs'), ctx);
ctx._companyRow = () => ({ vat_rate: 7 });

/* ══════════ ข้อมูลตั้งต้น ══════════ */
central.tenants = [
  { tenant_id: 'BDC', name: 'บีดีซี', is_active: 'TRUE', is_house: '' },
  { tenant_id: 'OLD', name: 'ตัวแทนที่ปิดแล้ว', is_active: '', is_house: '' },
  { tenant_id: 'HOUSE', name: 'บริษัท', is_active: 'TRUE', is_house: 'TRUE' }
];
central.customers = [
  { record_id: 1, name: 'ร้านหนึ่ง', customer_code: 'C-001', tax_id: '0105500000011', tax_branch_code: '00000' },
  { record_id: 2, name: 'ร้านสอง', customer_code: 'C-002' }
];
central.products = [
  { record_id: 10, product_code: 'P-100', name: 'กล่องกระดาษ' },
  { record_id: 20, product_code: 'P-200', name: 'ฟิล์มพันสินค้า' },
  { record_id: 30, product_code: 'P-300', name: 'สินค้ายกเว้นภาษี', tax_status: 'exempt' }
];

const mk = tid => (tenantData[tid] = tenantData[tid] ||
  { sales_orders: [], order_items: [], delivery_rounds: [], delivery_round_items: [] });
const so = (tid, o) => { o.__tid = tid; mk(tid).sales_orders.push(o); };
const item = (tid, it) => { mk(tid).order_items.push(it); };

// ① ขายสด 2 บรรทัด ไม่มีส่วนลด
so('BDC', { record_id: 1, order_code: 'BD-2610-0001', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'A', tax_invoice_no: 'TAX-001', tax_invoice_at: '2026-10-05 09:00:00',
  apply_vat: 'TRUE', vat_rate: 0.07, subtotal: 1070, discount: 0,
  subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0, total: 1070 });
item('BDC', { record_id: 101, order_id: 1, product_id: 10, qty: 2, unit_code: 'CT', price: 321,
  line_total: 642, line_discount: 0, is_free: 0, tax_status: 'vat' });
item('BDC', { record_id: 102, order_id: 1, product_id: 20, qty: 1, unit_code: 'PK', price: 428,
  line_total: 428, line_discount: 0, is_free: 0, tax_status: 'vat' });

// ② มีส่วนลดรายบรรทัด + ส่วนลดท้ายบิลที่ยังไม่ถูกเฉลี่ย + ของแถม
so('BDC', { record_id: 2, order_code: 'BD-2610-0002', customer_id: 2, payment_method: 'credit_term',
  status: 'ready_to_ship', sale_by: 'B', tax_invoice_no: 'TAX-002', tax_invoice_at: '2026-10-06 09:00:00',
  apply_vat: 'TRUE', vat_rate: 0.07, subtotal: 1000, discount: 150,
  subtotal_ex_vat: 794.39, vat_amount: 55.61, exempt_amount: 0, total: 850 });
item('BDC', { record_id: 201, order_id: 2, product_id: 10, qty: 10, unit_code: 'CT', price: 80,
  line_total: 800, line_discount: 50, is_free: 0, tax_status: 'vat' });
item('BDC', { record_id: 202, order_id: 2, product_id: 20, qty: 5, unit_code: 'PK', price: 40,
  line_total: 200, line_discount: 0, is_free: 0, tax_status: 'vat' });
item('BDC', { record_id: 203, order_id: 2, product_id: 20, qty: 2, unit_code: 'PK', price: 0,
  line_total: 0, line_discount: 0, is_free: 1 });

// ③ ยังไม่ออกใบกำกับ — ยังไม่นับเป็นยอดขาย
so('BDC', { record_id: 3, order_code: 'BD-2610-0003', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'A', total: 500 });
item('BDC', { record_id: 301, order_id: 3, product_id: 10, qty: 5, unit_code: 'CT', price: 100,
  line_total: 500, line_discount: 0, is_free: 0, tax_status: 'vat' });

// ④ ออกใบกำกับแล้วแต่ยกเลิกบิล — ต้องไม่เข้าไฟล์
so('BDC', { record_id: 4, order_code: 'BD-2610-0004', customer_id: 1, payment_method: 'cash',
  status: 'cancelled', sale_by: 'A', tax_invoice_no: 'TAX-004', tax_invoice_at: '2026-10-07 09:00:00',
  apply_vat: 'TRUE', vat_rate: 0.07, total: 5350, subtotal_ex_vat: 5000, vat_amount: 350 });
item('BDC', { record_id: 401, order_id: 4, product_id: 10, qty: 50, unit_code: 'CT', price: 107,
  line_total: 5350, line_discount: 0, is_free: 0, tax_status: 'vat' });

// ⑤ แยกรอบจัดส่ง — สั่ง 10 ลัง ส่งรอบแรก 4 ลัง
so('BDC', { record_id: 5, order_code: 'BD-2610-0005', customer_id: 2, payment_method: 'credit_term',
  status: 'ready_to_ship', sale_by: 'B', apply_vat: 'TRUE', vat_rate: 0.07,
  subtotal: 1000, discount: 0, total: 1000 });
item('BDC', { record_id: 501, order_id: 5, product_id: 10, qty: 10, unit_code: 'CT', price: 100,
  line_total: 1000, line_discount: 0, is_free: 0, tax_status: 'vat' });
mk('BDC').delivery_rounds.push({ record_id: 90, order_id: 5, round_no: 1, tax_invoice_no: 'TAX-005-1',
  tax_invoice_at: '2026-10-08 09:00:00', subtotal_ex_vat: 373.83, vat_amount: 26.17, total: 400 });
mk('BDC').delivery_round_items.push({ record_id: 900, round_id: 90, order_id: 5, item_id: 501,
  product_id: 10, unit_code: 'CT', qty: 4, base_qty: 4 });

// ⑥ สินค้ายกเว้นภาษีปนกับสินค้าคิดภาษีในใบเดียวกัน
so('BDC', { record_id: 6, order_code: 'BD-2610-0006', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'A', tax_invoice_no: 'TAX-006', tax_invoice_at: '2026-10-20 09:00:00',
  apply_vat: 'TRUE', vat_rate: 0.07, subtotal: 1535, discount: 0,
  subtotal_ex_vat: 1500, vat_amount: 35, exempt_amount: 1000, total: 1535 });
item('BDC', { record_id: 601, order_id: 6, product_id: 10, qty: 1, unit_code: 'CT', price: 535,
  line_total: 535, line_discount: 0, is_free: 0, tax_status: 'vat' });
item('BDC', { record_id: 602, order_id: 6, product_id: 30, qty: 1, unit_code: 'CT', price: 1000,
  line_total: 1000, line_discount: 0, is_free: 0, tax_status: 'exempt' });

// ⑦ ขายตรงในนามบริษัท
so('HOUSE', { record_id: 7, order_code: 'BD-H-0001', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'admin:u1', tax_invoice_no: 'TAX-H-1', tax_invoice_at: '2026-10-09 09:00:00',
  apply_vat: 'TRUE', vat_rate: 0.07, subtotal: 535, discount: 0,
  subtotal_ex_vat: 500, vat_amount: 35, total: 535 });
item('HOUSE', { record_id: 701, order_id: 7, product_id: 10, qty: 1, unit_code: 'CT', price: 535,
  line_total: 535, line_discount: 0, is_free: 0, tax_status: 'vat' });

/* ⑧ ใบลดหนี้ของ TAX-001 — ลูกค้าคืนกล่องกระดาษ 1 ลัง (ราคาที่ขายจริง 321)
   ⑨ ใบลดหนี้ที่ถูกยกเลิก — ต้องไม่ปรับยอดอะไรเลย
   ⑩ ใบเพิ่มหนี้ของ TAX-002 — คิดเงินขาดไป 100 */
central.ar_credit_notes = [
  { record_id: 1, credit_note_no: 'CN-001', ar_invoice_id: 11, invoice_no: 'TAX-001', customer_id: 1,
    tenant_id: 'BDC', sales_order_id: 1, delivery_round_id: '', credit_date: '2026-10-12',
    vat_rate: 0.07, subtotal_ex_vat: 300, vat_amount: 21, total: 321, status: 'posted' },
  { record_id: 2, credit_note_no: 'CN-VOID', ar_invoice_id: 11, invoice_no: 'TAX-001', customer_id: 1,
    tenant_id: 'BDC', sales_order_id: 1, credit_date: '2026-10-13',
    vat_rate: 0.07, subtotal_ex_vat: 1000, vat_amount: 70, total: 1070, status: 'void' }
];
central.ar_credit_note_items = [
  { record_id: 1, note_id: 1, credit_note_id: 1, order_item_id: 101, product_id: 10,
    unit_code: 'CT', unit_factor: 1, qty: 1, unit_price: 321, amount: 321, tax_status: 'vat' },
  { record_id: 2, note_id: 2, credit_note_id: 2, order_item_id: 101, product_id: 10,
    unit_code: 'CT', unit_factor: 1, qty: 10, unit_price: 107, amount: 1070, tax_status: 'vat' }
];
central.ar_debit_notes = [
  { record_id: 5, debit_note_no: 'DN-001', ar_invoice_id: 12, invoice_no: 'TAX-002', customer_id: 2,
    tenant_id: 'BDC', sales_order_id: 2, credit_date: '2026-10-14',
    vat_rate: 0.07, subtotal_ex_vat: 93.46, vat_amount: 6.54, total: 100, status: 'posted' }
];
central.ar_debit_note_items = [
  { record_id: 5, note_id: 5, debit_note_id: 5, order_item_id: 201, product_id: 10,
    unit_code: 'CT', unit_factor: 1, qty: 1, unit_price: 100, amount: 100, tax_status: 'vat' }
];

/* ══════════ เทสต์ ══════════ */
const C = {};   // ชื่อคอลัมน์ -> index (อ้างด้วยชื่อ ไม่ใช่เลข จะได้ไม่พังเงียบเวลาสลับคอลัมน์)
ctx.DASH_HEADERS.forEach((h, i) => { C[h] = i; });
const col = (row, name) => row[C[name]];

console.log('\n── ชีตที่ต้องเขียน ──');
eq('★★ ตัวแทนที่ใช้งานอยู่ + สมุดบริษัท (\'\') · ตัวแทนที่ปิดแล้วไม่เอา',
  ctx._dashTargets({}), ['BDC', '']);
eq('   ระบุเองได้เมื่อต้องการส่งออกเฉพาะบางราย', ctx._dashTargets({ tenantIds: ['BDC'] }), ['BDC']);

const r = ctx._dashRowsFor('BDC', {});
// เฉพาะแถวขาย — แถวใบลดหนี้/เพิ่มหนี้ตรวจแยกในหมวดของมันเอง
const docsIn = [...new Set(r.rows.filter(x => col(x, 'ประเภทรายการ') === 'ขาย')
  .map(x => col(x, 'เลขที่ใบกำกับภาษี')))].sort();

console.log('\n── อะไรเข้าไฟล์ ──');
eq('★★★ เข้าเฉพาะใบที่ออกใบกำกับภาษีแล้ว · บิลยังไม่ออกใบและบิลที่ยกเลิกไม่เข้า',
  docsIn, ['TAX-001', 'TAX-002', 'TAX-005-1', 'TAX-006']);
eq('★★ 1 แถว = 1 บรรทัดบิล (ใบ TAX-001 มี 2 รายการ → 2 แถว)',
  r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-001').length, 2);
eq('   คอลัมน์เอกสารซ้ำอยู่ทุกแถวของใบเดียวกัน เพื่อให้ Dashboard group เองได้',
  r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-001').map(x => col(x, 'ชื่อลูกค้า')),
  ['ร้านหนึ่ง', 'ร้านหนึ่ง']);

console.log('\n── ตัวเลขต่อบรรทัด ──');
const l1 = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-001' && col(x, 'รหัสสินค้า') === 'P-100');
eq('รหัส/ชื่อสินค้า/จำนวน/หน่วย/ราคาต่อหน่วย มาครบ',
  [col(l1, 'รหัสสินค้า'), col(l1, 'ชื่อสินค้า'), col(l1, 'จำนวนที่ขาย'), col(l1, 'หน่วยขาย'), col(l1, 'ราคาขายต่อหน่วย (ก่อนภาษี)')],
  ['P-100', 'กล่องกระดาษ', 2, 'CT', 300]);
eq('ไม่มีส่วนลด → ยอดตามราคาขาย = ยอดหลังหักส่วนลด (ก่อนภาษีทั้งคู่: 642 รวมภาษี → 600)',
  [col(l1, 'ยอดเงินตามราคาขาย (ก่อนภาษี)'), col(l1, 'ส่วนลดรายบรรทัด (ก่อนภาษี)'), col(l1, 'ส่วนลดท้ายบิล เฉลี่ย (ก่อนภาษี)'),
   col(l1, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)')], [600, 0, 0, 600]);

console.log('\n── ส่วนลด: รายบรรทัด + ท้ายบิลที่ต้องเฉลี่ยลงบรรทัด ──');
const d1 = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002' && col(x, 'รหัสสินค้า') === 'P-100');
const d2 = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002' && col(x, 'รหัสสินค้า') === 'P-200' && !col(x, 'ของแถม'));
/* ★★★ หัวบิลบอกส่วนลด 150 แต่บรรทัดบอกรวมกันแค่ 50 — ที่ขาด 100 ต้องถูกเฉลี่ยลงบรรทัดตามสัดส่วน
   (soldNetByItem) ไม่ใช่ปล่อยหาย · ปล่อยหาย = ยอดขายในไฟล์สูงกว่าที่เก็บเงินจริง 100 บาทต่อใบ */
eq('★★★ ส่วนลดสองชั้นแยกคอลัมน์ และเป็นยอดก่อนภาษี (50→46.73 · 80→74.76 · 20→18.70)',
  [col(d1, 'ส่วนลดรายบรรทัด (ก่อนภาษี)'), col(d1, 'ส่วนลดท้ายบิล เฉลี่ย (ก่อนภาษี)'),
   col(d2, 'ส่วนลดรายบรรทัด (ก่อนภาษี)'), col(d2, 'ส่วนลดท้ายบิล เฉลี่ย (ก่อนภาษี)')], [46.73, 74.76, 0, 18.7]);
eq('   ★★ ผลรวมส่วนลดท้ายบิลที่เฉลี่ยลงทุกบรรทัด = ส่วนลดท้ายบิลของใบนั้น ก่อนภาษี (100 → 93.46)',
  Math.round(r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002')
    .reduce((s, x) => s + col(x, 'ส่วนลดท้ายบิล เฉลี่ย (ก่อนภาษี)'), 0) * 100) / 100, 93.46);
eq('   ★ ยอดขายลบส่วนลดแล้ว = ยอดตามราคาขาย − ส่วนลดทั้งสองชั้น (ทุกบรรทัด)',
  r.rows.every(x => Math.abs(col(x, 'ยอดเงินตามราคาขาย (ก่อนภาษี)') - col(x, 'ส่วนลดรายบรรทัด (ก่อนภาษี)')
    - col(x, 'ส่วนลดท้ายบิล เฉลี่ย (ก่อนภาษี)') - col(x, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)')) < 0.005), true);
/* ★★ ผลรวมรายบรรทัดต้องเท่ากับ `subtotal_ex_vat` ที่บิลเก็บไว้เป๊ะ — ไม่งั้นยอดในไฟล์
   กับยอดบนหน้าจอ/ใบกำกับจะต่างกันทีละสตางค์ แล้วคนกระทบยอดหาสาเหตุไม่เจอ */
eq('   ★★ ผลรวมยอดก่อนภาษีรายบรรทัด = ยอดก่อนภาษีของทั้งใบ (794.39)',
  Math.round(r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002')
    .reduce((s, x) => s + col(x, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), 0) * 100) / 100, 794.39);
const free = r.rows.find(x => col(x, 'ของแถม') === 'ใช่');
eq('★ ของแถมเป็นบรรทัดของตัวเอง มูลค่า 0 และติดธงไว้ — ไม่ปนเข้ายอดขาย แต่เห็นว่าแจกไปเท่าไร',
  [col(free, 'จำนวนที่ขาย'), col(free, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), col(free, 'ของแถม')], [2, 0, 'ใช่']);

console.log('\n── บิลที่แยกรอบจัดส่ง ──');
const rd = r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-005-1');
/* ★★ ใบกำกับของรอบออกตาม "ของที่ส่งจริงรอบนั้น" — บรรทัดต้องเป็นจำนวนของรอบ (4 จาก 10 ลัง)
   ไม่ใช่จำนวนที่สั่งทั้งใบ · ใส่ 10 ลัง = ยอดขายเกินจริง 2.5 เท่าตั้งแต่รอบแรก */
eq('★★ จำนวนในแถว = ของที่ส่งจริงในรอบนั้น (4 ไม่ใช่ 10)',
  [rd.length, col(rd[0], 'จำนวนที่ขาย'), col(rd[0], 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)')], [1, 4, 373.83]);
eq('   และตรงกับยอดก่อนภาษีบนใบกำกับของรอบนั้น (373.83)',
  rd.reduce((s, x) => s + col(x, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), 0), 373.83);

console.log('\n── สินค้ายกเว้นภาษีปนในใบเดียวกัน ──');
const mixV = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-006' && col(x, 'รหัสสินค้า') === 'P-100');
const mixE = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-006' && col(x, 'รหัสสินค้า') === 'P-300');
eq('★★★ บรรทัดคิดภาษีถอด VAT ออก (535→500) · บรรทัดยกเว้นภาษีไม่ถอด (1,000→1,000)',
  [col(mixV, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), col(mixE, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)')], [500, 1000]);
eq('   รวมสองบรรทัด = ยอดขายก่อนภาษีของทั้งใบ (1,500)',
  r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-006')
    .reduce((s, x) => s + col(x, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), 0), 1500);

console.log('\n── ใบลดหนี้ / ใบเพิ่มหนี้ เป็นแถวในชีตเดียวกัน ──');
const cn = r.rows.find(x => col(x, 'ประเภทรายการ') === 'ลดหนี้');
/* ★★★ ติดลบทุกช่องที่เป็นจำนวนและเงิน — Dashboard บวกคอลัมน์เดียวแล้วได้ยอดสุทธิเลย
   ถ้าเก็บเป็นบวกแล้วหวังให้ Dashboard ไปลบเอง วันหนึ่งจะมีคนลืมลบ แล้วยอดเกินโดยไม่มีอะไรฟ้อง */
eq('★★★ ใบลดหนี้ = แถวติดลบ และเป็นยอดก่อนภาษี (321 รวมภาษี → 300)',
  [col(cn, 'จำนวนที่ขาย'), col(cn, 'ยอดเงินตามราคาขาย (ก่อนภาษี)'), col(cn, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)')],
  [-1, -300, -300]);
eq('   ราคาต่อหน่วยยังเป็นบวก (เป็นราคา ไม่ใช่ยอดเงิน) และก่อนภาษี', col(cn, 'ราคาขายต่อหน่วย (ก่อนภาษี)'), 300);
eq('   บอกเลขใบลดหนี้ของตัวเอง และอ้างใบกำกับที่ถูกปรับ',
  [col(cn, 'เลขที่ใบกำกับภาษี'), col(cn, 'เอกสารอ้างอิง'), col(cn, 'เลขที่บิล')],
  ['CN-001', 'TAX-001', 'BD-2610-0001']);
/* ★★ ต้องผูกกับพนักงานขายของบิลต้นทาง ไม่ใช่แอดมินบัญชีที่กดออกใบลดหนี้ —
   ไม่งั้นยอดที่หักออกไม่เคยไปถึงยอดรายคนของคนขายเลย */
eq('★★ พนักงานขาย = คนขายบิลต้นทาง (ไม่ใช่คนออกใบลดหนี้)', col(cn, 'พนักงานขาย'), 'พนักงาน A');

eq('★ ใบลดหนี้ที่ถูกยกเลิก (void) ต้องไม่เข้าไฟล์',
  r.rows.some(x => col(x, 'เลขที่ใบกำกับภาษี') === 'CN-VOID'), false);

const dn = r.rows.find(x => col(x, 'ประเภทรายการ') === 'เพิ่มหนี้');
/* ★★ ใส่แต่ใบลดหนี้ = ยอดขายต่ำกว่าจริงเท่าใบเพิ่มหนี้ ซึ่งเงียบพอๆ กัน */
eq('★★ ใบเพิ่มหนี้ = แถวเป็นบวก (คิดเงินขาดไป เก็บเพิ่ม · 100 รวมภาษี → 93.46)',
  [col(dn, 'จำนวนที่ขาย'), col(dn, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), col(dn, 'เอกสารอ้างอิง')],
  [1, 93.46, 'TAX-002']);

eq('★★★ บวกคอลัมน์เดียวได้ยอดสุทธิก่อนภาษี: ขายทั้งหมด − ลดหนี้ + เพิ่มหนี้',
  Math.round(r.rows.reduce((s, x) => s + col(x, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)'), 0) * 100) / 100,
  Math.round((600 + 400 + 794.39 + 373.83 + 1500 - 300 + 93.46) * 100) / 100);

eq('ช่วงวันที่ใช้กับใบลดหนี้ด้วย (ลงวันที่ 12 ต.ค.)',
  ctx._dashRowsFor('BDC', { dateFrom: '2026-10-12', dateTo: '2026-10-12' })
    .rows.map(x => col(x, 'เลขที่ใบกำกับภาษี')), ['CN-001']);

eq('แถวเรียงตามวันที่ ไม่ใช่กองใบลดหนี้ไว้ท้ายสุด',
  r.rows.map(x => col(x, 'วันที่').getTime()).every((t, i, a) => i === 0 || a[i - 1] <= t), true);

console.log('\n── ช่วงวันที่ · สมุดบริษัท · หัวคอลัมน์ ──');
eq('กรองจากวันที่บนใบกำกับ ไม่ใช่วันเปิดบิล',
  [...new Set(ctx._dashRowsFor('BDC', { dateFrom: '2026-10-06', dateTo: '2026-10-08' })
    .rows.map(x => col(x, 'เลขที่ใบกำกับภาษี')))].sort(), ['TAX-002', 'TAX-005-1']);
const h = ctx._dashRowsFor('', {});
eq('★★ ยอดขายตรงในนามบริษัทต้องอยู่ในไฟล์ด้วย และไม่ปนกับของตัวแทน',
  h.rows.map(x => [col(x, 'เลขที่ใบกำกับภาษี'), col(x, 'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)')]), [['TAX-H-1', 500]]);
eq('จำนวนคอลัมน์ในหัวตรงกับจำนวนช่องในแถวข้อมูล',
  [ctx.DASH_HEADERS.length, r.rows[0].length], [24, 24]);
/* ★★ ทุกคอลัมน์เงินต้องเขียนกำกับว่า "ก่อนภาษี" (เจ้าของระบบสั่ง 25 ต.ค. 2026 — รายงานการขายไม่ดู VAT)
   ตัวเลขเงินที่ไม่บอกว่ารวมภาษีหรือยัง คือต้นเหตุที่คนเอาไปเทียบกับใบกำกับแล้วคิดว่าระบบผิด */
eq('★★ ทุกคอลัมน์เงินเขียนกำกับว่า "ก่อนภาษี"',
  ctx.DASH_HEADERS.filter(h => /ราคา|ยอด|ส่วนลด/.test(h)).every(h => h.indexOf('ก่อนภาษี') > -1), true);
eq('   และไม่มีคอลัมน์ยอดรวมภาษีหลงเหลืออยู่',
  ctx.DASH_HEADERS.some(h => /รวมภาษี|ยอดเก็บเงิน/.test(h)), false);
eq('   วันที่เป็น Date จริง ไม่ใช่ข้อความ (Excel ต้องใช้ทำแกนเวลา)',
  Object.prototype.toString.call(col(l1, 'วันที่')), '[object Date]');

console.log('\n── ข้อความ CSV ──');
{
  const csv = ctx._dashCsvText(r.rows);
  const lines = csv.split('\r\n');
  eq('บรรทัดแรกเป็นหัวคอลัมน์ · คั่นด้วยจุลภาค', lines[0].split(',').slice(0, 2), ['datasource', 'วันที่']);
  /* ★ คอลัมน์แรกบอกระบบต้นทาง — Dashboard รวมข้อมูลหลายระบบ ต้องแยกออกว่าแถวไหนมาจากไหน */
  eq('★ ทุกแถวมี datasource = RBS เป็นคอลัมน์แรก',
    r.rows.every(x => col(x, 'datasource') === 'RBS'), true);
  eq('จำนวนบรรทัด = หัว 1 + ข้อมูลทุกแถว (+ บรรทัดว่างท้ายไฟล์)', lines.length, r.rows.length + 2);
  eq('ขึ้นบรรทัดใหม่ด้วย CRLF ตาม RFC 4180', /\r\n/.test(csv), true);
  eq('วันที่เขียนเป็น yyyy-mm-dd (ไม่กำกวมว่าวันหรือเดือนมาก่อน)', lines[1].split(',')[1], '2026-10-05');

  /* ★★ ชื่อร้านที่มีจุลภาคหรือเครื่องหมายคำพูดอยู่ข้างใน ถ้าไม่ครอบให้ถูก คอลัมน์จะเลื่อนทั้งแถว
     แล้วยอดเงินไปตกคอลัมน์อื่น — พังเงียบสนิท ตัวเลขยังดูเป็นตัวเลขอยู่ */
  const tricky = ctx._dashCsvText([[
    'RBS', new Date(2026, 9, 5), 'TAX-X', 'BD-1', '', 'BDC', 'C-1',
    'ร้าน ก, ข "เจ๊แดง"', '', '', '', '', 'P-1', 'สินค้า\nสองบรรทัด',
    1, 'CT', 10, 10, 0, 0, 10, 9.35, '', 'ขาย', ''
  ]]).split('\r\n')[1];
  const q = String.fromCharCode(34);
  eq('★★ ชื่อที่มีจุลภาค/คำพูด ถูกครอบและเขียนคำพูดซ้อนสองตัว',
    tricky.indexOf(q + 'ร้าน ก, ข ' + q + q + 'เจ๊แดง' + q + q + q) > -1, true);
  eq('★ ค่าที่มีขึ้นบรรทัดใหม่ก็ถูกครอบ', tricky.indexOf(q + 'สินค้า\nสองบรรทัด' + q) > -1, true);

  const spaced = ctx._dashCsvText([['RBS', new Date(2026, 9, 5), 'TAX-Y', '', '', '', '', 'ร้านมีช่องว่างท้าย ',
    '', '', '', '', '', '', 0, '', 0, 0, 0, 0, 0, 0, '', 'ขาย', '']]);
  eq('★ ค่าที่มีเว้นวรรคท้าย ต้องถูกครอบไว้ ไม่งั้นตัวอ่านบางตัวตัดทิ้งเงียบๆ',
    spaced.indexOf(q + 'ร้านมีช่องว่างท้าย ' + q) > -1, true);

  /* ★ ตัวเลขห้ามมีเครื่องหมายคั่นหลักพัน — ใส่แล้ว 1,234.00 กลายเป็นสองคอลัมน์ทันที */
  const num = ctx._dashCsvText([['RBS', 0, '', '', '', '', '', '', '', '', '', '', '', '',
    1234, '', 1234.5, 1234.56, 0, 0, 1234.56, 1153.79, '', 'ขาย', '']]).split('\r\n')[1];
  eq('★★ ตัวเลขเขียนดิบ ไม่มีคั่นหลักพัน', [num.indexOf('1234.56') > -1, num.indexOf('1,234') > -1], [true, false]);
}

console.log('\n── กระทบยอดรายใบ (จับใบที่บรรทัดหาย) ──');
{
  /* ★★★ สองเคสนี้คือที่มาของ "ยอดในไฟล์ไม่ตรงกับในแอป" ที่หาสาเหตุไม่เจอ:
     ไฟล์ออกมาหน้าตาปกติทุกอย่าง แค่ขาดไปเงียบๆ ทั้งใบ */
  eq('ชุดข้อมูลปกติ ต้องไม่มีใบไหนยอดเพี้ยน', r.mismatches.length, 0);

  // ⑪ ใบกำกับที่ไม่มีแถวใน order_items เลย (บิลเก่าที่ย้ายข้อมูลมา)
  so('BDC', { record_id: 11, order_code: 'BD-NOITEM', customer_id: 1, payment_method: 'cash',
    status: 'completed', sale_by: 'A', tax_invoice_no: 'TAX-NOITEM', tax_invoice_at: '2026-10-21 09:00:00',
    apply_vat: 'TRUE', vat_rate: 0.07, subtotal: 1070, discount: 0,
    subtotal_ex_vat: 1000, vat_amount: 70, total: 1070 });

  // ⑫ บิลแยกรอบที่ไม่มีแถวใน delivery_round_items (รอบเก่าก่อนมีตารางนี้)
  so('BDC', { record_id: 12, order_code: 'BD-NOROUNDITEM', customer_id: 2, payment_method: 'credit_term',
    status: 'ready_to_ship', sale_by: 'B', apply_vat: 'TRUE', vat_rate: 0.07, subtotal: 500, discount: 0, total: 500 });
  item('BDC', { record_id: 1201, order_id: 12, product_id: 10, qty: 5, unit_code: 'CT', price: 100,
    line_total: 500, line_discount: 0, is_free: 0, tax_status: 'vat' });
  mk('BDC').delivery_rounds.push({ record_id: 95, order_id: 12, round_no: 1, tax_invoice_no: 'TAX-NORI',
    tax_invoice_at: '2026-10-22 09:00:00', subtotal_ex_vat: 467.29, vat_amount: 32.71, total: 500 });

  const r2 = ctx._dashRowsFor('BDC', {});
  const byDoc = {};
  r2.mismatches.forEach(m => { byDoc[m.docNo] = m; });

  eq('★★★ ใบที่ไม่มีบรรทัดสินค้าเลย ถูกจับได้ พร้อมบอกว่าหายทั้งใบ',
    [!!byDoc['TAX-NOITEM'], byDoc['TAX-NOITEM'].lines, byDoc['TAX-NOITEM'].expected, byDoc['TAX-NOITEM'].actual],
    [true, 0, 1000, 0]);
  eq('★★★ รอบที่ไม่มีรายการของที่ส่ง ก็หายทั้งรอบ — ต้องถูกจับเหมือนกัน',
    [!!byDoc['TAX-NORI'], byDoc['TAX-NORI'].lines, byDoc['TAX-NORI'].expected], [true, 0, 467.29]);
  eq('   บอกเลขบิลมาด้วย จะได้ตามไปเปิดดูได้เลย', byDoc['TAX-NOITEM'].orderCode, 'BD-NOITEM');
  eq('★ ใบที่ปกติไม่ถูกรายงาน (ไม่ใช่ขึ้นเตือนทุกใบจนไม่มีใครอ่าน)',
    r2.mismatches.map(m => m.docNo).sort(), ['TAX-NOITEM', 'TAX-NORI']);
  eq('   และยอดที่หายไปรวมกันคือผลต่างที่คนเห็นตอนกระทบยอด',
    r2.mismatches.reduce((s, m) => s + m.expected - m.actual, 0), 1467.29);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
