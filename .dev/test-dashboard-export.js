// รัน: node .dev/test-dashboard-export.js
// ทดสอบตัวส่งยอดขายออกเป็นไฟล์กลางของ Dashboard (59_dashboard_export.gs) บนชีตจำลอง ไม่ยิงเน็ตและไม่แตะ Drive
//
// ★★★ สิ่งที่ไฟล์นี้คุมคือ "อะไรนับเป็นยอดขาย" ซึ่งเป็นคำถามที่ผิดแล้วไม่มีอะไรฟ้อง —
//   ไฟล์ออกมาหน้าตาปกติ ตัวเลขดูสมเหตุสมผล แต่ผิดจากหน้าจอของบริษัท
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let failed = 0;
const show = v => JSON.stringify(v);
function eq(name, got, want) {
  if (show(got) === show(want)) { console.log('PASS ' + name); return; }
  failed++; console.log('FAIL ' + name + '\n   expected ' + show(want) + '\n   actual   ' + show(got));
}

/* ── ชีตจำลอง: เก็บเป็น array ของ object ตรงๆ พอสำหรับตัวอ่าน ── */
const central = { tenants: [], customers: [], ar_invoices: [], ar_credit_notes: [], gl_journals: [] };
const tenantData = {};   // tenantId -> { sales_orders: [], delivery_rounds: [] }
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
  _round2: n => Math.round((Number(n) || 0) * 100) / 100,
  nowStr: () => '2026-10-24 10:00:00',
  isFlagOn: v => String(v).toUpperCase() === 'TRUE' || v === true || v === 1,
  isCreditPayment: c => String(c || '').toLowerCase() === 'credit_term',
  customerFullName: c => String(c.name || ''),
  saleOrderHasRounds: o => T(o.__tid, 'delivery_rounds').some(r => String(r.order_id) === String(o.record_id)),
  _saleByLabel: s => (s ? 'พนักงาน ' + s : '(ไม่ระบุ)'),
  _orderVat: o => ({ exVat: Number(o.subtotal_ex_vat) || 0, vat: Number(o.vat_amount) || 0 })
};
vm.createContext(ctx);
vm.runInContext(B('58_tax_invoices.gs') + '\n' + B('59_dashboard_export.gs'), ctx);

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

const so = (tid, o) => {
  tenantData[tid] = tenantData[tid] || { sales_orders: [], delivery_rounds: [] };
  o.__tid = tid; tenantData[tid].sales_orders.push(o);
};
const round = (tid, r) => { tenantData[tid].delivery_rounds.push(r); };

// ① ขายสด ออกใบกำกับแล้ว — เข้าไฟล์
so('BDC', { record_id: 1, order_code: 'BD-2610-0001', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'A', tax_invoice_no: 'TAX-001', tax_invoice_at: '2026-10-05 09:00:00',
  subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0, total: 1070 });
// ② เครดิต ออกใบกำกับแล้ว — เข้าไฟล์
so('BDC', { record_id: 2, order_code: 'BD-2610-0002', customer_id: 2, payment_method: 'credit_term',
  status: 'ready_to_ship', sale_by: 'B', tax_invoice_no: 'TAX-002', tax_invoice_at: '2026-10-06 09:00:00',
  subtotal_ex_vat: 2000, vat_amount: 140, exempt_amount: 0, total: 2140 });
// ③ ยังไม่ออกใบกำกับ — ยังไม่นับเป็นยอดขาย
so('BDC', { record_id: 3, order_code: 'BD-2610-0003', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'A', subtotal_ex_vat: 9999, vat_amount: 699.93, total: 10698.93 });
// ④ ออกใบกำกับแล้วแต่บิลถูกยกเลิก — ต้องไม่เข้าไฟล์
so('BDC', { record_id: 4, order_code: 'BD-2610-0004', customer_id: 1, payment_method: 'cash',
  status: 'cancelled', sale_by: 'A', tax_invoice_no: 'TAX-004', tax_invoice_at: '2026-10-07 09:00:00',
  subtotal_ex_vat: 5000, vat_amount: 350, total: 5350 });
// ⑤ แยกรอบจัดส่ง — ใบกำกับอยู่ที่รอบ ตัวบิลแม่ไม่มีเลขของตัวเอง
so('BDC', { record_id: 5, order_code: 'BD-2610-0005', customer_id: 2, payment_method: 'credit_term',
  status: 'ready_to_ship', sale_by: 'B', subtotal_ex_vat: 0, vat_amount: 0, total: 0 });
round('BDC', { record_id: 90, order_id: 5, round_no: 1, tax_invoice_no: 'TAX-005-1',
  tax_invoice_at: '2026-10-08 09:00:00', subtotal_ex_vat: 3000, vat_amount: 210, total: 3210 });
// ⑥ มีของยกเว้นภาษีปนอยู่ — ยอดก่อนภาษีไม่ใช่ total ÷ 1.07
so('BDC', { record_id: 6, order_code: 'BD-2610-0006', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'A', tax_invoice_no: 'TAX-006', tax_invoice_at: '2026-10-20 09:00:00',
  subtotal_ex_vat: 1500, vat_amount: 35, exempt_amount: 1000, total: 1535 });
// ⑦ ขายตรงในนามบริษัท (สมุดของบริษัท — tenant_id ว่าง)
so('HOUSE', { record_id: 7, order_code: 'BD-H-0001', customer_id: 1, payment_method: 'cash',
  status: 'completed', sale_by: 'admin:u1', tax_invoice_no: 'TAX-H-1', tax_invoice_at: '2026-10-09 09:00:00',
  subtotal_ex_vat: 500, vat_amount: 35, total: 535 });

console.log('\n── ชีตที่ต้องเขียน ──');
eq('★★ ตัวแทนที่ใช้งานอยู่ + สมุดบริษัท (\'\') · ตัวแทนที่ปิดแล้วไม่เอา',
  ctx._dashTargets({}), ['BDC', '']);
eq('   ระบุเองได้เมื่อต้องการส่งออกเฉพาะบางราย', ctx._dashTargets({ tenantIds: ['BDC'] }), ['BDC']);

console.log('\n── แถวของตัวแทน BDC ──');
const r = ctx._dashRowsFor('BDC', {});
const no = i => r.rows.map(x => x[i]);
eq('★★★ เข้าเฉพาะใบที่ออกใบกำกับภาษีแล้ว · บิลยังไม่ออกใบและบิลที่ยกเลิกไม่เข้า',
  no(1).sort(), ['TAX-001', 'TAX-002', 'TAX-005-1', 'TAX-006']);
eq('★★ บิลที่แยกรอบ นับที่แถวรอบ ไม่นับซ้ำกับแถวบิลแม่',
  r.rows.filter(x => x[2] === 'BD-2610-0005').map(x => [x[1], x[3], x[11]]), [['TAX-005-1', 1, 3000]]);

const row1 = r.rows.find(x => x[1] === 'TAX-001');
eq('ยอดขายก่อนภาษี / ภาษี / ยกเว้น / ยอดรวมภาษี อยู่คนละคอลัมน์',
  [row1[11], row1[12], row1[13], row1[14]], [1000, 70, 0, 1070]);
eq('   วันที่เป็น Date จริง ไม่ใช่ข้อความ (Excel ต้องใช้ทำแกนเวลา)',
  // instanceof ใช้ไม่ได้ข้ามกล่อง vm (Date คนละ realm) — ดูชนิดจริงแทน
  [Object.prototype.toString.call(row1[0]), row1[0].getFullYear(), row1[0].getMonth() + 1, row1[0].getDate()],
  ['[object Date]', 2026, 10, 5]);
eq('   มีรหัสตัวแทน/รหัสลูกค้า/เลขผู้เสียภาษี/สาขา/พนักงานขาย/วิธีชำระ ให้ Dashboard แยกมิติได้',
  [row1[4], row1[5], row1[7], row1[8], row1[9], row1[10]],
  ['BDC', 'C-001', '0105500000011', '00000', 'พนักงาน A', 'เงินสด']);

const row6 = r.rows.find(x => x[1] === 'TAX-006');
eq('★★★ บิลที่มีของยกเว้นภาษีปน: ยอดขายก่อนภาษี = 1,500 (ไม่ใช่ 1,535 ÷ 1.07)',
  [row6[11], row6[13], row6[14]], [1500, 1000, 1535]);

console.log('\n── ช่วงวันที่ ──');
eq('กรองจากวันที่บนใบกำกับ ไม่ใช่วันเปิดบิล',
  ctx._dashRowsFor('BDC', { dateFrom: '2026-10-06', dateTo: '2026-10-08' }).rows.map(x => x[1]).sort(),
  ['TAX-002', 'TAX-005-1']);

console.log('\n── สมุดของบริษัท ──');
const h = ctx._dashRowsFor('', {});
eq('★★ ยอดขายตรงในนามบริษัทต้องอยู่ในไฟล์ด้วย ไม่ใช่มีแต่ของตัวแทน',
  h.rows.map(x => [x[1], x[11]]), [['TAX-H-1', 500]]);
eq('   และต้องไม่ปนกับของตัวแทน (คนละชีต คนละสมุด)',
  h.rows.some(x => String(x[1]).indexOf('TAX-00') === 0), false);

console.log('\n── หัวคอลัมน์ ──');
eq('จำนวนคอลัมน์ในหัวตรงกับจำนวนช่องในแถวข้อมูล',
  [ctx.DASH_HEADERS.length, r.rows[0].length], [15, 15]);
eq('คอลัมน์ยอดขายเขียนชัดว่า "ก่อนภาษี" (กติกา 24 ต.ค. 2026)',
  [ctx.DASH_HEADERS[11], ctx.DASH_HEADERS[14]], ['ยอดขายก่อนภาษี', 'ยอดรวมภาษี']);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
