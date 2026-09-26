// รัน: node .dev/test-customers.js
// ทดสอบทะเบียนลูกค้าโครงสร้างใหม่ (33_customers.gs + 10_master_data.gs + 15_import_export_express.gs)
//   รหัสลูกค้าออกเลขเองแยกต่อตัวแทน · แยกคำนำหน้าออกจากชื่อ · เลขภาษี/สาขา · เครดิต · สถานะ 3 ค่า ·
//   ตัวแทนแก้ข้ามบริษัทไม่ได้ · นำเข้าไฟล์แล้วอัปเดตทับด้วย external_code
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'T1', name: 'ตัวแทนที่หนึ่ง', is_active: true },
    { tenant_id: 'T2', name: 'ตัวแทนที่สอง', is_active: true }
  ],
  role_permissions: [
    { role_code: 'tenant_admin', module_code: 'customers', can_view: true, can_edit: true },
    { role_code: 'owner_admin', module_code: 'customers', can_view: true, can_edit: true }
  ],
  roles: [
    { role_code: 'tenant_admin', role_label: 'แอดมินตัวแทน', is_system: true, tenant_id: '' },
    { role_code: 'owner_admin', role_label: 'แอดมินบริษัท', is_system: true, tenant_id: '' }
  ],
  customers: []
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const CACHE = {};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isFinite, isNaN, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-26', getUuid: () => 'uuid' },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({
    get: k => (CACHE[k] === undefined ? null : CACHE[k]), put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralAppend: (n, o) => sheetOf(n).push(Object.assign({}, o)),
  centralAppendMany: (n, os) => os.forEach(o => sheetOf(n).push(Object.assign({}, o))),
  centralUpdate: (n, id, f) => { const r = sheetOf(n).find(x => String(x.record_id) === String(id));
    if (!r) return false; Object.assign(r, f); return true; },
  centralNextId: n => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  cacheClear: () => {},
  nowStr: () => '2026-09-26 09:00:00', safeDateStr: v => String(v || '')
};
vm.createContext(ctx);
const fakes = {};
['centralObjects','centralSheet','centralAppend','centralAppendMany','centralUpdate','centralNextId','nowStr','safeDateStr','cacheClear']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
['14_permissions.gs', '33_customers.gs', '10_master_data.gs', '15_import_export_express.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
// ของจริงอยู่ในไฟล์ที่ไม่ได้โหลดในเทสต์นี้
ctx._salesTenantId = (session, payload) => session.tenant_id || (payload && payload.tenantId) || null;

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
const T1 = { adminUserId: '3', username: 't1admin', role_code: 'tenant_admin', tenant_id: 'T1' };
const T2 = { adminUserId: '4', username: 't2admin', role_code: 'tenant_admin', tenant_id: 'T2' };
const OWNER = { adminUserId: '2', username: 'owner', role_code: 'owner_admin', tenant_id: '' };
const rowOf = id => sheets.customers.find(c => String(c.record_id) === String(id));

console.log('\n── รหัสลูกค้า: ออกเลขให้เอง แยกเล่มต่อตัวแทน ──');
let r = ctx.addCustomerAdmin(T1, { name: 'ทวีเจริญ 2502', namePrefix: 'บริษัท' });
eq('เพิ่มลูกค้ารายแรกของตัวแทน → C0001', [r.success, r.customerCode], [true, 'C0001']);
eq('  ชื่อบนเอกสาร = คำนำหน้า + ชื่อ', ctx.customerFullName(rowOf(r.customerId)), 'บริษัท ทวีเจริญ 2502');
eq('  ชื่อในตารางยังเป็นชื่อจริง (ไว้ค้นหา/เรียง)', rowOf(r.customerId).name, 'ทวีเจริญ 2502');
const C1 = r.customerId;
eq('รายที่สอง → C0002', ctx.addCustomerAdmin(T1, { name: 'ร้านสมชาย' }).customerCode, 'C0002');
eq('ตัวแทนอีกรายเริ่มนับ C0001 ของตัวเอง', ctx.addCustomerAdmin(T2, { name: 'ร้านคนละบริษัท' }).customerCode, 'C0001');
fails('รหัสซ้ำในตัวแทนเดียวกันไม่ได้', ctx.addCustomerAdmin(T1, { name: 'ซ้ำ', customerCode: 'C0001' }), /ถูกใช้ไปแล้ว/);
eq('รหัสเดียวกันข้ามตัวแทนได้ (คนละเล่ม)', ctx.addCustomerAdmin(T2, { name: 'ไม่ซ้ำเพราะคนละบริษัท', customerCode: 'C0002' }).success, true);
fails('ไม่มีชื่อ → ปฏิเสธ', ctx.addCustomerAdmin(T1, { phone: '02-000-0000' }), /ชื่อลูกค้า/);

console.log('\n── แถวใหม่ต้องมีครบทุกคอลัมน์ ไม่มีช่องหลุด ──');
eq('คอลัมน์ในแถวใหม่ตรงกับสคีมาที่ประกาศไว้', (() => {
  const keys = Object.keys(rowOf(C1)).sort();
  const must = ['record_id','customer_code','name','tenant_id','group_id','status','is_active','payment_type',
    'payment_terms_days','credit_limit','created_at','attributes','external_code'];
  return must.filter(k => keys.indexOf(k) === -1);
})(), []);

console.log('\n── ภาษี: เลข 13 หลัก + รหัสสาขา ──');
fails('เลขผู้เสียภาษีสั้นเกิน → ปฏิเสธ', ctx.addCustomerAdmin(T1, { name: 'x', taxId: '12345' }), /13 หลัก/);
r = ctx.addCustomerAdmin(T1, { name: 'เบอร์ลี่ ยุคเกอร์', namePrefix: 'บริษัท', taxId: '0-1075-36000-22-6', taxBranchCode: 'สำนักงานใหญ่' });
eq('เลขภาษีมีขีด → เก็บเฉพาะตัวเลข', rowOf(r.customerId).tax_id, '0107536000226');
eq('  "สำนักงานใหญ่" → 00000', rowOf(r.customerId).tax_branch_code, '00000');
eq('  ป้ายที่พิมพ์บนใบกำกับ', ctx.customerTaxBranchLabel(rowOf(r.customerId)), 'สำนักงานใหญ่');
eq('สาขา "1" → 00001', ctx.normalizeTaxBranch('1'), '00001');
eq('สาขาที่ข้อมูลเก่าเขียนว่า "-" → ว่าง', ctx.normalizeTaxBranch('-'), '');

console.log('\n── เครดิตประจำร้าน ──');
r = ctx.addCustomerAdmin(T1, { name: 'ร้านเครดิต', paymentType: 'credit', paymentTermsDays: 45, creditLimit: 100000 });
const CRED = rowOf(r.customerId);
eq('เก็บเครดิตครบ', [CRED.payment_type, CRED.payment_terms_days, CRED.credit_limit], ['credit', 45, 100000]);
eq('  ใบแจ้งหนี้ใช้จำนวนวันนี้ตั้งวันครบกำหนด', ctx.customerTermsDays(CRED, 30), 45);
eq('  ร้านขายสด (ตั้งไว้ 0 วัน) = ครบกำหนดทันที ไม่ถูกแทนด้วยค่า fallback', ctx.customerTermsDays(rowOf(C1), null), 0);
eq('  ข้อมูลเก่าที่ยังไม่มีคอลัมน์นี้ → คืน fallback ให้ผู้เรียกตัดสินใจ', ctx.customerTermsDays({ name: 'เก่า' }, null), null);
fails('เครดิตติดลบ → ปฏิเสธ', ctx.addCustomerAdmin(T1, { name: 'y', paymentTermsDays: -5 }), /0–365/);
fails('ประเภทการชำระที่ไม่รู้จัก → ปฏิเสธ', ctx.addCustomerAdmin(T1, { name: 'y', paymentType: 'barter' }), /cash หรือ credit/);

console.log('\n── สถานะ 3 ค่า (active / inactive / blocked) ──');
eq('ตั้งต้นเป็น active และ is_active ตรงกัน', [rowOf(C1).status, rowOf(C1).is_active], ['active', 'TRUE']);
ctx.updateCustomerAdmin(T1, { id: C1, status: 'blocked' });
eq('ระงับเครดิต: ยังถือว่าใช้งานอยู่ (ขายสดได้)', [rowOf(C1).status, rowOf(C1).is_active], ['blocked', 'TRUE']);
eq('  เปิดบิลเงินสดให้ร้านที่ถูกระงับเครดิตได้', ctx.customerSaleGate(rowOf(C1), 'cash'), null);
fails('  แต่เปิดบิลเชื่อไม่ได้', ctx.customerSaleGate(rowOf(C1), 'credit'), /ระงับเครดิต/);
ctx.updateCustomerAdmin(T1, { id: C1, status: 'inactive' });
eq('ปิดการใช้งาน: is_active=FALSE และประทับวันที่ไว้', [rowOf(C1).is_active, rowOf(C1).inactive_at], ['FALSE', '2026-09-26 09:00:00']);
fails('  ขายไม่ได้ทั้งสดและเชื่อ', ctx.customerSaleGate(rowOf(C1), 'cash'), /ปิดการใช้งาน/);
ctx.updateCustomerAdmin(T1, { id: C1, status: 'active' });
eq('เปิดใช้งานใหม่ → ล้างวันที่ปิด', [rowOf(C1).is_active, rowOf(C1).inactive_at], ['TRUE', '']);
eq('ข้อมูลเก่าที่ยังไม่มีคอลัมน์ status → ใช้ is_active เดิมตัดสิน', ctx.customerSaleGate({ name: 'เก่า', is_active: 'TRUE' }, 'credit'), null);
fails('  ข้อมูลเก่าที่ปิดไว้ก็ยังขายไม่ได้', ctx.customerSaleGate({ name: 'เก่า', is_active: 'FALSE' }, 'cash'), /ปิดการใช้งาน/);

console.log('\n── แก้ไข: ส่งมาเฉพาะช่องที่แก้ ไม่ล้างช่องอื่น ──');
ctx.updateCustomerAdmin(T1, { id: CRED.record_id, phone: '081-111-1111' });
eq('แก้เบอร์โทรอย่างเดียว เครดิตเดิมยังอยู่', [rowOf(CRED.record_id).phone, rowOf(CRED.record_id).payment_terms_days], ['081-111-1111', 45]);
eq('  บันทึกผู้แก้ไข/เวลาแก้ไข (audit)', [rowOf(CRED.record_id).updated_by, rowOf(CRED.record_id).updated_at], ['3', '2026-09-26 09:00:00']);
eq('  รหัสลูกค้าแก้ทับด้วย payload ไม่ได้', (() => { ctx.updateCustomerAdmin(T1, { id: CRED.record_id, customerCode: 'C9999' });
  return rowOf(CRED.record_id).customer_code; })(), CRED.customer_code);
fails('ตัวแทนอื่นแก้ลูกค้าของเราไม่ได้', ctx.updateCustomerAdmin(T2, { id: C1, name: 'โดนแก้' }), /ไม่ได้อยู่ในตัวแทน/);
eq('  ชื่อไม่ถูกแก้จริง', rowOf(C1).name, 'ทวีเจริญ 2502');
fails('ไม่พบลูกค้า → ปฏิเสธ', ctx.updateCustomerAdmin(T1, { id: 99999, name: 'x' }), /ไม่พบลูกค้า/);

console.log('\n── attributes: ที่เก็บฟิลด์ที่ยังไม่ตกผลึก (แทนคอลัมน์สำรอง rs1..rs5) ──');
r = ctx.addCustomerAdmin(T1, { name: 'ร้านมีของแถมพิเศษ', attributes: { shelfShare: 40, hasFreezer: true } });
eq('อ่านกลับมาเป็น object', ctx.customerAttributes(rowOf(r.customerId)), { shelfShare: 40, hasFreezer: true });
eq('ข้อมูลเสีย → คืน {} ไม่ล้ม', ctx.customerAttributes({ attributes: '{ไม่ใช่ json' }), {});
fails('ส่ง JSON พังมา → ปฏิเสธตั้งแต่ต้นทาง', ctx.addCustomerAdmin(T1, { name: 'z', attributes: '{พัง' }), /JSON/);

console.log('\n── การมองเห็นข้ามตัวแทน ──');
eq('ตัวแทนเห็นเฉพาะลูกค้าของตัวเอง', ctx.listCustomersAdmin(T2, {}).data.every(c => c.tenant_id === 'T2'), true);
eq('บริษัทที่ไม่ได้สวมสิทธิ์ตัวแทนไหน เห็นทั้งหมด', ctx.listCustomersAdmin(OWNER, {}).data.length, sheets.customers.length);
eq('  ส่งรูป camelCase พร้อมชื่อเต็มให้หน้าเว็บด้วย', (() => {
  const one = ctx.listCustomersAdmin(T1, {}).customers.find(c => String(c.id) === String(C1));
  return [one.code, one.fullName, one.status];
})(), ['C0001', 'บริษัท ทวีเจริญ 2502', 'active']);

console.log('\n── วันที่ซื้อล่าสุด (ไว้หาร้านที่หายไปนาน) ──');
ctx.touchCustomerLastSale(C1, '2026-09-20 10:00:00');
eq('ประทับวันที่ขาย', rowOf(C1).last_sale_at, '2026-09-20');
ctx.touchCustomerLastSale(C1, '2026-09-18 10:00:00');
eq('  บิลย้อนหลังไม่ทับวันที่ใหม่กว่า', rowOf(C1).last_sale_at, '2026-09-20');
ctx.touchCustomerLastSale(C1, '2026-09-25 10:00:00');
eq('  บิลใหม่กว่าทับได้', rowOf(C1).last_sale_at, '2026-09-25');
eq('ไม่มีลูกค้า (ขายให้ลูกค้าทั่วไป) → ไม่ล้ม', ctx.touchCustomerLastSale(0, '2026-09-25'), undefined);

console.log('\n── นำเข้าไฟล์ลูกค้า ──');
const before = sheets.customers.length;
r = ctx.importExpressCustomers(OWNER, { tenantId: 'T1', externalSystem: 'express', rows: [
  { externalCode: '001', namePrefix: 'บริษัท', name: 'เบอร์ลี่ ยุคเกอร์ จำกัด (มหาชน)', taxId: '0107536000226',
    address: '99 ซอยรูเบีย ถนนสุขุมวิท 42', postcode: '10110', paymentTermsDays: 45, paymentType: 'credit', areaCode: 'TT00' },
  { externalCode: '006', name: 'สวอนอินดัสทรีส์ (ประเทศไทย) จำกัด', namePrefix: 'บริษัท' },
  { externalCode: '999', name: '' }   // ไม่มีชื่อ → ข้าม
] });
eq('นำเข้า 3 แถว → เพิ่ม 2 ข้าม 1', [r.created, r.updated, r.skipped], [2, 0, 1]);
eq('  ออกรหัสลูกค้าต่อจากเลขเดิม ไม่ชนกันเอง', (() => {
  const codes = sheets.customers.filter(c => c.tenant_id === 'T1' && c.external_system === 'express').map(c => c.customer_code);
  return [codes.length, new Set(codes).size];
})(), [2, 2]);
eq('  จำไว้ว่ามาจากระบบไหน (คู่กับ external_code)', sheets.customers.filter(c => c.external_system === 'express').length, 2);
r = ctx.importExpressCustomers(OWNER, { tenantId: 'T1', externalSystem: 'express', rows: [
  { externalCode: '001', name: 'เบอร์ลี่ ยุคเกอร์ จำกัด (มหาชน)', phone: '02-146-5555', creditLimit: 500000 }
] });
eq('นำเข้าไฟล์เดิมซ้ำ → อัปเดตทับ ไม่เพิ่มแถวใหม่', [r.created, r.updated, sheets.customers.length], [0, 1, before + 2]);
eq('  ค่าที่ไฟล์รอบนี้ไม่ได้ส่งมา ยังอยู่ครบ', (() => {
  const c = sheets.customers.find(x => x.external_code === '001');
  return [c.phone, c.credit_limit, c.payment_terms_days, c.tax_id];
})(), ['02-146-5555', 500000, 45, '0107536000226']);
eq('  ลูกค้าคนละตัวแทนใช้ external_code เดียวกันได้', (() => {
  const rr = ctx.importExpressCustomers(OWNER, { tenantId: 'T2', externalSystem: 'express', rows: [{ externalCode: '001', name: 'คนละบริษัทแต่รหัสเดิม' }] });
  return [rr.created, sheets.customers.filter(c => c.external_code === '001').length];
})(), [1, 2]);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
