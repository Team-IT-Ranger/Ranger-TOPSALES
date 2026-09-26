// รัน: node .dev/test-sales-status.js
// ทดสอบสถานะบิลขายสองแกน (34_sales_status.gs): การส่งของ / การเงิน, การเปลี่ยนสถานะที่อนุญาต, ประวัติที่ต้องถูกบันทึก
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const t = {   // ชีตของตัวแทน T1
  sales_orders: [
    { record_id: 1, order_code: 'SO-20260926-0001', customer_id: 1, total: 1000, payment_method: 'credit',
      fulfillment_type: 'office_delivery', status: 'pending_delivery', payment_status: 'unpaid', paid_amount: 0,
      sale_by: 'admin:owner', created_at: '2026-09-26 09:00:00' },
    { record_id: 2, order_code: 'SO-20260926-0002', customer_id: 2, total: 500, payment_method: 'cash',
      fulfillment_type: 'immediate', status: 'completed', payment_status: 'paid', paid_amount: 500,
      sale_by: 'U1', created_at: '2026-09-26 09:30:00' },
    // บิลเก่าที่บันทึกก่อนมีคอลัมน์ payment_status (ต้องอ่านออกโดยไม่พัง)
    { record_id: 3, order_code: 'SO-20260901-0009', customer_id: 1, total: 200, payment_method: 'cash',
      fulfillment_type: 'immediate', status: 'completed', created_at: '2026-09-01 10:00:00' }
  ],
  order_status_log: []
};
const sheetOf = n => { if (!t[n]) t[n] = []; return t[n]; };
const CACHE = {};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-26', getUuid: () => 'uuid',
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' } },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({ get: k => (CACHE[k] === undefined ? null : CACHE[k]),
    put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); }, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  nowStr: () => '2026-09-26 12:00:00', safeDateStr: v => String(v || ''),
  tenantObjects: (tid, n) => sheetOf(n).map(o => Object.assign({}, o)),
  // tab ที่เพิ่มเข้ามาทีหลัง: ไฟล์ตัวแทนเก่ายังไม่มี → ต้องคืน [] ไม่ใช่ throw (ของจริงอยู่ใน 02_helpers.gs)
  tenantObjectsIfExists: (tid, n) => (t[n] ? t[n].map(o => Object.assign({}, o)) : []),
  tenantAppend: (tid, n, o) => sheetOf(n).push(Object.assign({}, o)),
  tenantNextId: (tid, n) => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  // ชีตจำลองแบบ getDataRange/getRange เท่าที่ _updateOrderRow ใช้จริง
  tenantSheet: (tid, n) => {
    const rows = sheetOf(n);
    const hdr = ['record_id','order_code','customer_id','total','payment_method','fulfillment_type','status',
      'payment_status','paid_amount','delivered_at','paid_at','updated_at','updated_by','sale_by','created_at'];
    const values = [hdr].concat(rows.map(r => hdr.map(h => (r[h] === undefined ? '' : r[h]))));
    return { getDataRange: () => ({ getValues: () => values }),
      getRange: (row, col) => ({ setValue: v => { rows[row - 2][hdr[col - 1]] = v; } }) };
  },
  ensureTenantSheetsCurrent: () => {},
  _requirePermission: () => null,
  _salesTenantId: (session, payload) => session.tenant_id || (payload && payload.tenantId) || null,
  centralObjects: () => []
};
vm.createContext(ctx);
['20_purchasing_master.gs', '34_sales_status.gs'].forEach(f => {
  const src = B(f);
  // 20_purchasing_master มี _withDocLock ที่เราต้องใช้ — โหลดเฉพาะฟังก์ชันนั้นพอ
  if (f === '20_purchasing_master.gs') {
    const m = /function _withDocLock\(fn\) \{[\s\S]*?\n\}/.exec(src);
    vm.runInContext(m[0], ctx, { filename: f });
  } else vm.runInContext(src, ctx, { filename: f });
});

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
const S = { adminUserId: '2', username: 'owner', displayName: 'แอดมินบริษัท', role_code: 'owner_admin', tenant_id: 'T1' };
const row = id => t.sales_orders.find(o => String(o.record_id) === String(id));
const logs = id => t.order_status_log.filter(l => String(l.order_id) === String(id));

console.log('\n── สถานะการเงินตั้งต้นตอนเปิดบิล ──');
eq('ขายสดจากรถ = รับเงินแล้วทันที', ctx.initialPaymentStatus('cash', 'immediate'), 'paid');
eq('ขายเชื่อจากรถ = ยังไม่ชำระ', ctx.initialPaymentStatus('credit', 'immediate'), 'unpaid');
eq('ขายสดแต่ให้ออฟฟิศส่ง = ยังไม่ชำระ (เก็บเงินตอนส่ง)', ctx.initialPaymentStatus('cash', 'office_delivery'), 'unpaid');
eq('บิลเก่าที่ไม่มีคอลัมน์ payment_status → เดาจากวิธีขาย', ctx.orderPaymentStatus(row(3)), 'paid');

console.log('\n── เดินสถานะการส่งของตามลำดับงานจริง ──');
let r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'delivering' });
eq('รอจัดส่ง → กำลังจัดส่ง', [r.success, row(1).status], [true, 'delivering']);
eq('  บันทึกประวัติไว้ 1 บรรทัด พร้อมชื่อคนเปลี่ยน', (() => { const l = logs(1); return [l.length, l[0].from_status, l[0].to_status, l[0].changed_by]; })(),
  [1, 'pending_delivery', 'delivering', 'แอดมินบริษัท']);
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'completed' });
eq('กำลังจัดส่ง → ส่งของแล้ว และประทับเวลาส่ง', [r.success, row(1).status, row(1).delivered_at], [true, 'completed', '2026-09-26 12:00:00']);
eq('  ข้อความที่ตอบกลับบอกสิ่งที่เปลี่ยนจริง', r.message, 'กำลังจัดส่ง → ส่งของแล้ว');
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'delivering' });
eq('ถอยกลับหนึ่งขั้นได้ (กดผิดเป็นเรื่องปกติ) และล้างเวลาส่งทิ้ง', [r.success, row(1).status, row(1).delivered_at], [true, 'delivering', '']);
fails('ข้ามขั้นจากกำลังจัดส่งกลับไปหาอะไรที่ไม่มีในสาย ไม่ได้', ctx.updateSalesOrderStatus(S, { id: 1, status: 'ส่งแล้วมั้ง' }), /สถานะไม่ถูกต้อง/);
fails('ยกเลิกผ่านทางนี้ไม่ได้ (ต้องคืนสต็อก/หักยอดขาย)', ctx.updateSalesOrderStatus(S, { id: 1, status: 'cancelled' }), /ปุ่มยกเลิก/);
fails('ไม่พบบิล', ctx.updateSalesOrderStatus(S, { id: 999, status: 'completed' }), /ไม่พบบิลขาย/);
fails('ไม่ได้เปลี่ยนอะไรเลย', ctx.updateSalesOrderStatus(S, { id: 1 }), /ไม่มีอะไรเปลี่ยน/);

console.log('\n── บิลที่ยกเลิกแล้ว ──');
t.sales_orders.push({ record_id: 4, order_code: 'SO-X', customer_id: 1, total: 100, payment_method: 'cash',
  fulfillment_type: 'immediate', status: 'cancelled', payment_status: 'unpaid', paid_amount: 0, created_at: '2026-09-26 08:00:00' });
fails('เปลี่ยนสถานะบิลที่ยกเลิกแล้วไม่ได้', ctx.updateSalesOrderStatus(S, { id: 4, status: 'completed' }), /ยกเลิกแล้ว/);

console.log('\n── แกนการเงิน ──');
r = ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 400 });
eq('รับชำระบางส่วน → partial', [r.success, row(1).payment_status, row(1).paid_amount], [true, 'partial', 400]);
r = ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 1000 });
eq('รับครบ → paid และประทับเวลารับเงิน', [row(1).payment_status, row(1).paid_at], ['paid', '2026-09-26 12:00:00']);
fails('รับเกินยอดบิลไม่ได้', ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 1500 }), /มากกว่ายอดบิล/);
fails('ยอดติดลบไม่ได้', ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: -1 }), /ไม่ติดลบ/);
r = ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 0 });
eq('ล้างการรับชำระกลับเป็น unpaid และล้างเวลารับเงิน', [row(1).payment_status, row(1).paid_amount, row(1).paid_at], ['unpaid', 0, '']);
r = ctx.updateSalesOrderStatus(S, { id: 1, paymentStatus: 'paid' });
eq('กดปุ่ม "รับเงินครบ" → เติมยอดให้เท่ายอดบิลเอง', [row(1).payment_status, row(1).paid_amount], ['paid', 1000]);
fails('สั่ง partial ลอยๆ โดยไม่บอกยอด ไม่ได้', ctx.updateSalesOrderStatus(S, { id: 2, paymentStatus: 'partial' }), /ระบุยอด/);

console.log('\n── เปลี่ยนสองแกนพร้อมกันในครั้งเดียว ──');
const before = logs(1).length;
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'completed', paidAmount: 0, note: 'ส่งของแล้วแต่ยังไม่ได้เก็บเงิน' });
eq('ส่งของแล้ว + ยังไม่ชำระ', [row(1).status, row(1).payment_status], ['completed', 'unpaid']);
eq('  ประวัติบรรทัดเดียวเก็บทั้งสองแกน พร้อมหมายเหตุ', (() => { const l = logs(1).slice(-1)[0];
  return [logs(1).length - before, l.to_status, l.to_payment, l.note]; })(),
  [1, 'completed', 'unpaid', 'ส่งของแล้วแต่ยังไม่ได้เก็บเงิน']);
eq('ประวัติที่ส่งให้หน้าเว็บมีป้ายภาษาไทยมาแล้ว', (() => { const h = ctx.orderStatusLog('T1', 1).slice(-1)[0];
  return [h.toLabel, h.toPaymentLabel, h.by]; })(), ['ส่งของแล้ว', 'ยังไม่ชำระ', 'แอดมินบริษัท']);

console.log('\n── ป้ายและเส้นทางที่ส่งให้หน้าเว็บ ──');
eq('อ่านประวัติจากไฟล์ที่ยังไม่มี tab ประวัติ (สคีมาเก่า) → ลิสต์ว่าง ไม่ใช่ error', (() => {
  const keep = t.order_status_log; delete t.order_status_log;     // จำลองไฟล์ตัวแทนที่ยังไม่ได้ migrate
  let out;
  try { out = ctx.orderStatusLog('T1', 1); } catch (e) { out = 'THREW: ' + e.message; }
  t.order_status_log = keep;
  return out;
})(), []);
eq('ป้ายสถานะครบทั้งสี่', Object.keys(ctx.SO_STATUS_LABELS).length, 4);
eq('จากรอจัดส่ง ไปได้ 3 ทาง (รวมยกเลิก)', ctx.SO_TRANSITIONS.pending_delivery, ['delivering', 'completed', 'cancelled']);
eq('บิลที่ยกเลิกแล้วไปไหนไม่ได้เลย', ctx.SO_TRANSITIONS.cancelled, []);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
