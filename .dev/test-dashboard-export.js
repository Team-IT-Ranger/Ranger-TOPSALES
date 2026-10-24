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

/* ══════════ เทสต์ ══════════ */
const C = {};   // ชื่อคอลัมน์ -> index (อ้างด้วยชื่อ ไม่ใช่เลข จะได้ไม่พังเงียบเวลาสลับคอลัมน์)
ctx.DASH_HEADERS.forEach((h, i) => { C[h] = i; });
const col = (row, name) => row[C[name]];

console.log('\n── ชีตที่ต้องเขียน ──');
eq('★★ ตัวแทนที่ใช้งานอยู่ + สมุดบริษัท (\'\') · ตัวแทนที่ปิดแล้วไม่เอา',
  ctx._dashTargets({}), ['BDC', '']);
eq('   ระบุเองได้เมื่อต้องการส่งออกเฉพาะบางราย', ctx._dashTargets({ tenantIds: ['BDC'] }), ['BDC']);

const r = ctx._dashRowsFor('BDC', {});
const docsIn = [...new Set(r.rows.map(x => col(x, 'เลขที่ใบกำกับภาษี')))].sort();

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
  [col(l1, 'รหัสสินค้า'), col(l1, 'ชื่อสินค้า'), col(l1, 'จำนวนที่ขาย'), col(l1, 'หน่วยขาย'), col(l1, 'ราคาขายต่อหน่วย')],
  ['P-100', 'กล่องกระดาษ', 2, 'CT', 321]);
eq('ไม่มีส่วนลด → ยอดตามราคาขาย = ยอดหลังหักส่วนลด · ราคา × จำนวน ตรงกับยอดตามราคาขาย',
  [col(l1, 'ยอดเงินตามราคาขาย'), col(l1, 'ส่วนลด'), col(l1, 'ยอดขายลบส่วนลดแล้ว')], [642, 0, 642]);
eq('ยอดขายก่อนภาษีของบรรทัด = 642 ÷ 1.07', col(l1, 'ยอดขายก่อนภาษี'), 600);

console.log('\n── ส่วนลด: รายบรรทัด + ท้ายบิลที่ต้องเฉลี่ยลงบรรทัด ──');
const d1 = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002' && col(x, 'รหัสสินค้า') === 'P-100');
const d2 = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002' && col(x, 'รหัสสินค้า') === 'P-200' && !col(x, 'ของแถม'));
/* ★★★ หัวบิลบอกส่วนลด 150 แต่บรรทัดบอกรวมกันแค่ 50 — ที่ขาด 100 ต้องถูกเฉลี่ยลงบรรทัดตามสัดส่วน
   (soldNetByItem) ไม่ใช่ปล่อยหาย · ปล่อยหาย = ยอดขายในไฟล์สูงกว่าที่เก็บเงินจริง 100 บาทต่อใบ */
eq('★★★ ส่วนลดท้ายบิลที่ยังไม่ถูกเฉลี่ย ต้องถูกเฉลี่ยลงบรรทัดตามสัดส่วน',
  [col(d1, 'ส่วนลด'), col(d2, 'ส่วนลด')], [130, 20]);
eq('   ผลรวม "ยอดขายลบส่วนลดแล้ว" ของทุกบรรทัด = ยอดสุทธิบนใบกำกับ (850)',
  r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-002')
    .reduce((s, x) => s + col(x, 'ยอดขายลบส่วนลดแล้ว'), 0), 850);
const free = r.rows.find(x => col(x, 'ของแถม') === 'ใช่');
eq('★ ของแถมเป็นบรรทัดของตัวเอง มูลค่า 0 และติดธงไว้ — ไม่ปนเข้ายอดขาย แต่เห็นว่าแจกไปเท่าไร',
  [col(free, 'จำนวนที่ขาย'), col(free, 'ยอดขายลบส่วนลดแล้ว'), col(free, 'ของแถม')], [2, 0, 'ใช่']);

console.log('\n── บิลที่แยกรอบจัดส่ง ──');
const rd = r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-005-1');
/* ★★ ใบกำกับของรอบออกตาม "ของที่ส่งจริงรอบนั้น" — บรรทัดต้องเป็นจำนวนของรอบ (4 จาก 10 ลัง)
   ไม่ใช่จำนวนที่สั่งทั้งใบ · ใส่ 10 ลัง = ยอดขายเกินจริง 2.5 เท่าตั้งแต่รอบแรก */
eq('★★ จำนวนในแถว = ของที่ส่งจริงในรอบนั้น (4 ไม่ใช่ 10)',
  [rd.length, col(rd[0], 'จำนวนที่ขาย'), col(rd[0], 'ยอดขายลบส่วนลดแล้ว')], [1, 4, 400]);
eq('   และตรงกับยอดบนใบกำกับของรอบนั้น (400)',
  rd.reduce((s, x) => s + col(x, 'ยอดขายลบส่วนลดแล้ว'), 0), 400);

console.log('\n── สินค้ายกเว้นภาษีปนในใบเดียวกัน ──');
const mixV = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-006' && col(x, 'รหัสสินค้า') === 'P-100');
const mixE = r.rows.find(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-006' && col(x, 'รหัสสินค้า') === 'P-300');
eq('★★★ บรรทัดคิดภาษีถอด VAT ออก (535→500) · บรรทัดยกเว้นภาษีไม่ถอด (1,000→1,000)',
  [col(mixV, 'ยอดขายก่อนภาษี'), col(mixE, 'ยอดขายก่อนภาษี')], [500, 1000]);
eq('   รวมสองบรรทัด = ยอดขายก่อนภาษีของทั้งใบ (1,500)',
  r.rows.filter(x => col(x, 'เลขที่ใบกำกับภาษี') === 'TAX-006')
    .reduce((s, x) => s + col(x, 'ยอดขายก่อนภาษี'), 0), 1500);

console.log('\n── ช่วงวันที่ · สมุดบริษัท · หัวคอลัมน์ ──');
eq('กรองจากวันที่บนใบกำกับ ไม่ใช่วันเปิดบิล',
  [...new Set(ctx._dashRowsFor('BDC', { dateFrom: '2026-10-06', dateTo: '2026-10-08' })
    .rows.map(x => col(x, 'เลขที่ใบกำกับภาษี')))].sort(), ['TAX-002', 'TAX-005-1']);
const h = ctx._dashRowsFor('', {});
eq('★★ ยอดขายตรงในนามบริษัทต้องอยู่ในไฟล์ด้วย และไม่ปนกับของตัวแทน',
  h.rows.map(x => [col(x, 'เลขที่ใบกำกับภาษี'), col(x, 'ยอดขายก่อนภาษี')]), [['TAX-H-1', 500]]);
eq('จำนวนคอลัมน์ในหัวตรงกับจำนวนช่องในแถวข้อมูล',
  [ctx.DASH_HEADERS.length, r.rows[0].length], [21, 21]);
eq('คอลัมน์ยอดขายเขียนชัดว่า "ก่อนภาษี" (กติกา 24 ต.ค. 2026)',
  ctx.DASH_HEADERS.indexOf('ยอดขายก่อนภาษี') > -1, true);
eq('   วันที่เป็น Date จริง ไม่ใช่ข้อความ (Excel ต้องใช้ทำแกนเวลา)',
  Object.prototype.toString.call(col(l1, 'วันที่')), '[object Date]');

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
