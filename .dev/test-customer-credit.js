// รัน: node .dev/test-customer-credit.js
// ทดสอบวงเงินเครดิตและหนี้ค้างของลูกค้า (56_customer_credit.gs)
//
// ★ กล่องทดสอบนี้ **ดึงฟังก์ชันจริงจากไฟล์จริง** ทุกตัวที่เกี่ยวกับการนับเงิน
//   (arInvoiceOutstanding · customerTermsDays · isCreditPayment · ค่าคงที่สถานะบิล)
//   ถ้าเขียนเลียนแบบไว้ในนี้ วันที่ของจริงเปลี่ยนนิยาม เทสต์จะยังเขียวทั้งที่ระบบคิดเงินคนละแบบ
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

/** ดึงตัวฟังก์ชัน/ตัวแปรจริงออกมาจากไฟล์ (ไม่โหลดทั้งไฟล์ซึ่งลากของอื่นมาเป็นพรวน) */
const grab = (file, re) => {
  const m = re.exec(B(file));
  if (!m) throw new Error('หาไม่เจอใน ' + file + ': ' + re);
  return m[0];
};
const fn = (file, name) => grab(file, new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));

const SHEETS = {};            // ชีตกลาง
const TENANT = {};            // ชีตของตัวแทน: TENANT[tenantId][tab]
const tsheet = (tid, n) => ((TENANT[tid] || {})[n] || []);

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math, RegExp,
  nowStr: () => '2026-10-16 12:00:00',
  safeDateStr: v => String(v || ''),
  _todayStr: () => '2026-10-16',
  centralObjects: n => (SHEETS[n] || []).map(o => Object.assign({}, o)),
  centralAppend: (n, o) => { (SHEETS[n] = SHEETS[n] || []).push(Object.assign({}, o)); },
  centralUpdate: (n, id, patch) => { const r = (SHEETS[n] || []).find(x => String(x.record_id) === String(id));
    if (r) Object.assign(r, patch); return !!r; },
  centralNextId: n => (SHEETS[n] = SHEETS[n] || []).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  tenantObjectsIfExists: (tid, n) => tsheet(tid, n).map(o => Object.assign({}, o)),
  _requirePermission: () => null,
  _effectiveTenantId: (session, payload) => {
    const s = session && session.tenant_id ? String(session.tenant_id) : '';
    if (s && s !== 'TNKI') return s;
    const p = payload && payload.tenantId ? String(payload.tenantId) : '';
    return p && p !== 'TNKI' ? p : null;
  },
  _salesTenantId: (session, payload) => (session && session.tenant_id) || (payload && payload.tenantId) || 'HOUSE'
};
vm.createContext(ctx);

// ── ฟังก์ชันจริงที่ตัวหลักต้องใช้ ──
[ fn('20_purchasing_master.gs', '_money'),
  fn('17_pricing.gs', '_dOnly'),
  fn('17_pricing.gs', '_validDate'),
  fn('23_accounting.gs', '_addDays'),
  fn('23_accounting.gs', '_daysBetween'),
  fn('18_pricing_engine.gs', 'isCreditPayment'),
  fn('49_credit_notes.gs', 'arInvoiceOutstanding'),
  fn('33_customers.gs', '_custNum'),
  fn('33_customers.gs', 'customerTermsDays'),
  fn('33_customers.gs', 'customerFullName'),
  grab('34_sales_status.gs', /var SO_DRAFT = [\s\S]*?SO_CANCELLED = 'cancelled';/),
  grab('34_sales_status.gs', /var SO_STATUS_LABELS = \{[\s\S]*?\n\};/),
  fn('34_sales_status.gs', '_soStatusOf')
].forEach((src, i) => vm.runInContext(src, ctx, { filename: 'dep' + i }));
vm.runInContext(B('56_customer_credit.gs'), ctx, { filename: '56_customer_credit.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const fails = (name, r, re) => {
  const good = r && r.success === false && (!re || re.test(r.message || ''));
  console.log((good ? 'PASS ' : 'FAIL ') + name + (good ? '' : '\n   got ' + JSON.stringify(r)));
  if (!good) failed++;
};
const section = s => console.log('\n── ' + s + ' ──');

/* ══════════════ ข้อมูลตั้งต้น ══════════════
   ลูกค้า 1 (BDC) วงเงิน 50,000 · ลูกค้า 2 (BDC) ไม่ตั้งวงเงิน · ลูกค้า 3 (ของบริษัท) วงเงิน 10,000 */
const reset = () => {
  SHEETS.customers = [
    { record_id: 1, customer_code: 'C001', name: 'ร้านทดสอบหนึ่ง', tenant_id: 'BDC', credit_limit: 50000, payment_terms_days: 30, status: 'active' },
    { record_id: 2, customer_code: 'C002', name: 'ร้านทดสอบสอง', tenant_id: 'BDC', credit_limit: 0, payment_terms_days: 7, status: 'active' },
    { record_id: 3, customer_code: 'C003', name: 'ร้านของบริษัท', tenant_id: '', credit_limit: 10000, payment_terms_days: 0, status: 'active' }
  ];
  SHEETS.ar_invoices = [];
  SHEETS.credit_settings = [];
  TENANT.BDC = { sales_orders: [] };
  TENANT.HOUSE = { sales_orders: [] };
};
const inv = o => { SHEETS.ar_invoices.push(Object.assign(
  { record_id: SHEETS.ar_invoices.length + 1, status: 'open', received_amount: 0, credited_amount: 0, debited_amount: 0 }, o)); };
const order = (tid, o) => { TENANT[tid].sales_orders.push(Object.assign(
  { record_id: TENANT[tid].sales_orders.length + 1, payment_method: 'credit_term', status: 'completed', paid_amount: 0,
    created_at: '2026-09-01 09:00:00' }, o)); };
const cust = id => SHEETS.customers.find(c => c.record_id === id);

/* ══════════════ 1. นิยามหนี้ค้าง ══════════════ */
section('หนี้ค้างประกอบจากอะไร');
reset();
inv({ customer_id: 1, sales_order_id: 11, total: 10000, due_date: '2026-10-31' });        // ยังไม่ถึงกำหนด
order('BDC', { record_id: 11, customer_id: 1, total: 10000 });                             // บิลที่ออกใบแจ้งหนี้แล้ว
order('BDC', { record_id: 12, customer_id: 1, total: 4000 });                              // ยังไม่ออกใบแจ้งหนี้
let m = ctx.customerOutstandingMap('BDC');
eq('★ รวมใบแจ้งหนี้ + บิลที่ยังไม่ออกใบ', m['1'].outstanding, 14000);
eq('★★ บิลที่มีใบแจ้งหนี้แล้วไม่ถูกนับซ้ำ (ไม่ใช่ 24,000)', m['1'].docs, 2);
eq('   แยกให้เห็นว่าส่วนไหนยังไม่ได้ออกใบแจ้งหนี้', m['1'].unbilled, 4000);

reset();
order('BDC', { record_id: 1, customer_id: 1, total: 1000, status: 'draft' });
order('BDC', { record_id: 2, customer_id: 1, total: 2000, status: 'cancelled' });
order('BDC', { record_id: 3, customer_id: 1, total: 3000, status: 'rejected' });
order('BDC', { record_id: 4, customer_id: 1, total: 4000, payment_method: 'cash' });
order('BDC', { record_id: 5, customer_id: 1, total: 5000, paid_amount: 5000 });
eq('ร่าง/ยกเลิก/ปฏิเสธ/เงินสด/จ่ายครบแล้ว ไม่นับเป็นหนี้', ctx.customerOutstandingMap('BDC')['1'], undefined);

reset();
order('BDC', { record_id: 1, customer_id: 1, total: 5000, paid_amount: 2000 });
eq('จ่ายบางส่วนแล้ว นับเฉพาะส่วนที่เหลือ', ctx.customerOutstandingMap('BDC')['1'].outstanding, 3000);

/* ★★ กับดักจริง: record_id ของบิลเป็นเลขต่อไฟล์ตัวแทน จึงซ้ำกันข้ามตัวแทนได้
   ถ้าจับคู่ใบแจ้งหนี้กับบิลด้วย sales_order_id อย่างเดียว หนี้ของร้านหนึ่งจะไปหักบิลของอีกร้านเงียบๆ */
reset();
inv({ customer_id: 3, sales_order_id: 7, total: 8000, due_date: '2026-10-31' });   // ใบของลูกค้าบริษัท อ้างบิล id 7 ของ HOUSE
order('BDC', { record_id: 7, customer_id: 1, total: 6000 });                        // บิล id 7 ของ BDC คนละใบกันสิ้นเชิง
m = ctx.customerOutstandingMap('BDC');
eq('★★ เลขบิลซ้ำข้ามตัวแทน ต้องไม่หักล้างกัน', m['1'].outstanding, 6000);

/* ══════════════ 2. ใบลดหนี้/เพิ่มหนี้/เงินที่รับ ══════════════ */
section('ยอดค้างของใบแจ้งหนี้ต้องผ่าน arInvoiceOutstanding ตัวจริง');
reset();
inv({ customer_id: 1, total: 10000, received_amount: 3000, credited_amount: 1000, debited_amount: 500, due_date: '2026-10-31' });
eq('ใบ 10,000 − รับ 3,000 − ลดหนี้ 1,000 + เพิ่มหนี้ 500', ctx.customerOutstandingMap('BDC')['1'].outstanding, 6500);
reset();
inv({ customer_id: 1, total: 10000, status: 'void', due_date: '2026-10-31' });
eq('ใบที่ยกเลิกแล้วไม่นับ', ctx.customerOutstandingMap('BDC')['1'], undefined);

/* ══════════════ 3. เลยกำหนด ══════════════ */
section('ส่วนที่เลยกำหนดชำระ');
reset();
inv({ customer_id: 1, total: 3000, due_date: '2026-08-31' });     // เลยกำหนดแล้ว
inv({ customer_id: 1, total: 2000, due_date: '2026-09-30' });     // เลยกำหนดแล้ว (ใหม่กว่า)
inv({ customer_id: 1, total: 7000, due_date: '2026-12-31' });     // ยังไม่ถึงกำหนด
m = ctx.customerOutstandingMap('BDC');
eq('ยอดค้างรวม', m['1'].outstanding, 12000);
eq('เฉพาะส่วนที่เลยกำหนด', m['1'].overdue, 5000);
eq('วันครบกำหนดที่เก่าที่สุดที่ยังค้าง', m['1'].oldestDueDate, '2026-08-31');

// บิลที่ยังไม่ออกใบแจ้งหนี้ ใช้เครดิตประจำร้านคิดวันครบกำหนดเอง (ลูกค้า 1 = 30 วัน)
reset();
order('BDC', { record_id: 1, customer_id: 1, total: 1000, created_at: '2026-09-01 09:00:00' });   // ครบ 1 ต.ค. = เลยแล้ว
order('BDC', { record_id: 2, customer_id: 1, total: 2000, created_at: '2026-10-10 09:00:00' });   // ครบ 9 พ.ย. = ยังไม่ถึง
m = ctx.customerOutstandingMap('BDC');
eq('บิลที่ยังไม่ออกใบแจ้งหนี้ คิดครบกำหนดจากเครดิตประจำร้าน', m['1'].overdue, 1000);

/* ══════════════ 4. ค่าตั้ง ══════════════ */
section('ค่าตั้งการคุมวงเงิน');
reset();
eq('★ ไม่เคยตั้ง = ไม่ตรวจ (ค่าเริ่มต้นต้องเป็น off เสมอ)', ctx._creditSettings('BDC').mode, 'off');
const sess = { adminUserId: 'A1', tenant_id: '' };
let r = ctx.saveCreditSettings(sess, { tenantId: 'BDC', mode: 'block', overdueDays: 45 });
eq('บันทึกค่าตั้งของตัวแทนได้', [r.success, ctx._creditSettings('BDC').mode, ctx._creditSettings('BDC').overdueDays], [true, 'block', 45]);
eq('★ ค่าตั้งของบริษัทเป็นคนละแถว ไม่ถูกตัวแทนทับ', ctx._creditSettings('').mode, 'off');
ctx.saveCreditSettings(sess, { tenantId: 'BDC', mode: 'warn', overdueDays: 0 });
eq('บันทึกซ้ำต้องทับแถวเดิม ไม่สร้างแถวใหม่', [SHEETS.credit_settings.length, ctx._creditSettings('BDC').mode], [1, 'warn']);
fails('โหมดที่ไม่รู้จักถูกปฏิเสธ', ctx.saveCreditSettings(sess, { tenantId: 'BDC', mode: 'kill' }), /ไม่ถูกต้อง/);
fails('จำนวนวันติดลบถูกปฏิเสธ', ctx.saveCreditSettings(sess, { tenantId: 'BDC', mode: 'block', overdueDays: -1 }), /0-3650/);

/* ══════════════ 5. ด่านกันเปิดบิล ══════════════ */
section('ด่านกันเปิดบิลเชื่อ');
const setMode = (scope, mode, days) => { SHEETS.credit_settings = [{ record_id: 1, tenant_id: scope, mode: mode, overdue_days: days || 0 }]; };

reset();
order('BDC', { record_id: 1, customer_id: 1, total: 45000 });      // ค้างอยู่ 45,000 จากวงเงิน 50,000
setMode('BDC', 'off');
eq('★ ปิดอยู่ = ไม่กั้นอะไรเลย แม้เปิดบิลเกินวงเงิน', ctx.creditSaleGate('BDC', cust(1), 'credit_term', 999999, {}), null);

setMode('BDC', 'block');
eq('ยังไม่เกินวงเงิน → ผ่าน', ctx.creditSaleGate('BDC', cust(1), 'credit_term', 4000, {}), null);
eq('★ ยอดรวมพอดีวงเงินเป๊ะ → ต้องผ่าน (ไม่ใช่ปัดขึ้นแล้วกั้น)', ctx.creditSaleGate('BDC', cust(1), 'credit_term', 5000, {}), null);
let g = ctx.creditSaleGate('BDC', cust(1), 'credit_term', 6000, {});
fails('★★ เกินวงเงิน → เปิดบิลเชื่อไม่ได้', g, /เกินวงเงิน/);
eq('   บอกด้วยว่าเกินอยู่เท่าไหร่', g.credit.over, 1000);
eq('★★ ขายเงินสดไม่ถูกกั้น แม้ค้างเกินวงเงิน', ctx.creditSaleGate('BDC', cust(1), 'cash', 999999, {}), null);

setMode('BDC', 'warn');
g = ctx.creditSaleGate('BDC', cust(1), 'credit_term', 6000, {});
eq('โหมดเตือน: ขายได้ แต่มีคำเตือนกลับไป', [!!g.warning, g.success], [true, undefined]);

// วงเงิน 0 = ไม่กำหนด
reset(); setMode('BDC', 'block');
order('BDC', { record_id: 1, customer_id: 2, total: 900000 });
eq('★ วงเงิน 0 = ไม่กำหนด ไม่มีทางเกิน', ctx.creditSaleGate('BDC', cust(2), 'credit_term', 100000, {}), null);

// เลยกำหนดกั้นได้เอง แม้ยังไม่เต็มวงเงิน
reset(); setMode('BDC', 'block', 30);
inv({ customer_id: 1, total: 1000, due_date: '2026-08-01' });      // เลยกำหนดมา 76 วัน
fails('★★ ค้างเลยกำหนดเกินที่ตั้งไว้ → กั้น แม้ยอดยังห่างวงเงินมาก',
  ctx.creditSaleGate('BDC', cust(1), 'credit_term', 100, {}), /เลยกำหนด/);
setMode('BDC', 'block', 0);
eq('ตั้ง 0 วัน = ไม่ตรวจเรื่องวันครบกำหนด', ctx.creditSaleGate('BDC', cust(1), 'credit_term', 100, {}), null);

// แก้ใบเดิมต้องหักยอดตัวเองออกได้
reset(); setMode('BDC', 'block');
order('BDC', { record_id: 1, customer_id: 1, total: 48000 });
fails('แก้ใบเดิมโดยไม่หักยอดตัวเอง = ถูกกั้นทั้งที่ไม่ได้เพิ่มของ',
  ctx.creditSaleGate('BDC', cust(1), 'credit_term', 48000, {}), /เกินวงเงิน/);
eq('★ ส่ง excludeAmount แล้วต้องผ่าน', ctx.creditSaleGate('BDC', cust(1), 'credit_term', 48000, { excludeAmount: 48000 }), null);

/* ══════════════ 6. หน้าจอ ══════════════ */
section('ตารางหนี้ค้างสำหรับหน้าแอดมิน');
reset(); setMode('BDC', 'block');
inv({ customer_id: 1, total: 60000, due_date: '2026-08-01' });     // เลยกำหนด + เกินวงเงิน
order('BDC', { record_id: 1, customer_id: 2, total: 3000, created_at: '2026-10-15 09:00:00' });
r = ctx.listCustomerCredit(sess, { tenantId: 'BDC' });
eq('ส่งเฉพาะร้านที่มีหนี้หรือมีวงเงิน (ไม่ส่งร้านของบริษัทมาด้วย)', r.rows.map(x => x.id), [1, 2]);
eq('★ เรียงร้านที่ค้างเลยกำหนดมากสุดขึ้นก่อน', r.rows[0].id, 1);
eq('นับร้านที่เกินวงเงินให้', r.overLimitCount, 1);
eq('ยอดรวมของทั้งตัวแทน', [r.totals.outstanding, r.totals.overdue], [63000, 60000]);
eq('บอกจำนวนวันที่ค้างมาแล้ว', r.rows[0].overdueDays, 76);

r = ctx.getCustomerCredit(sess, { tenantId: 'BDC', customerId: 1 });
eq('ดูเครดิตร้านเดียวได้', [r.success, r.credit.outstanding, r.credit.limit, r.credit.over], [true, 60000, 50000, 10000]);
fails('ร้านที่ไม่มีอยู่จริง', ctx.getCustomerCredit(sess, { tenantId: 'BDC', customerId: 999 }), /ไม่พบลูกค้า/);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
