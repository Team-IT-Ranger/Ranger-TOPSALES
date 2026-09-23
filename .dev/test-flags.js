// รัน: node .dev/test-flags.js
// ทดสอบตัวช่วยอ่านค่า TRUE/FALSE จาก Sheets (isFlagOn / isFlagOff / isNotOff ใน 02_helpers.gs)
// และพิสูจน์ว่าบั๊กเดิมหายจริง: Sheets คืนค่าเป็น boolean (true/false) ไม่ใช่สตริง 'TRUE'/'FALSE'
// ของเดิมเทียบ String(x) === 'TRUE' จึงเป็นเท็จเสมอ → โปรโมชั่นไม่เคยถูกใช้, ตัวแทนไม่ขึ้นในลิสต์, ล็อกรหัสสินค้าไม่ทำงาน
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

// ── ชีตจำลอง: เก็บค่าแบบเดียวกับที่ Sheets คืนมาจริง (boolean) ──
const sheets = {
  products: [
    { record_id: 1, name: 'สินค้าเปิดขาย', is_active: true,  has_transactions: true },
    { record_id: 2, name: 'สินค้าปิดขาย',  is_active: false, has_transactions: false },
    { record_id: 3, name: 'ของเก่าไม่เคยกรอก', is_active: '', has_transactions: '' }
  ],
  tenants: [ { tenant_id: 'T1', name: 'ตัวแทนหนึ่ง', is_active: true }, { tenant_id: 'T2', name: 'ปิดไปแล้ว', is_active: false } ],
  discount_rules: [
    { record_id: 1, name: 'ลด 5% ทั้งบิล', is_active: true, stackable: true, scope: 'bill', product_group_id: 0, product_id: 0,
      trigger_group_ids: '', customer_group_id: 0, min_qty: 0, min_amount: 1000, type: 'percent', value: 5, free_product_id: 0, free_qty: 0, priority: 1, date_start: '', date_end: '' },
    { record_id: 2, name: 'โปรที่ปิดอยู่', is_active: false, stackable: false, scope: 'bill', product_group_id: 0, product_id: 0,
      trigger_group_ids: '', customer_group_id: 0, min_qty: 0, min_amount: 0, type: 'percent', value: 10, free_product_id: 0, free_qty: 0, priority: 2, date_start: '', date_end: '' }
  ],
  doc_number_series: [ { record_id: 1, doc_type: 'SO', prefix: 'SO', date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-', is_active: true } ],
  role_permissions: [ { role_code: 'owner_admin', module_code: 'pricing', can_view: true, can_edit: true },
                      { role_code: 'owner_admin', module_code: 'tenants', can_view: true, can_edit: false } ],
  customers: [ { record_id: 1, name: 'ร้านเปิด', tenant_id: 'T1', is_active: true }, { record_id: 2, name: 'ร้านปิด', tenant_id: 'T1', is_active: false } ],
  product_units: [], liff_users: [], admin_users: [], roles: []
};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isFinite, parseInt, parseFloat, RegExp,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-24' },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  centralObjects: n => (sheets[n] || []).map(o => Object.assign({}, o)),
  centralSheet: () => ({ getDataRange: () => ({ getValues: () => [[]] }) }),
  tenantObjects: () => [],
  nowStr: () => '2026-09-24 10:00:00', safeDateStr: v => String(v || ''),
  cacheGet: () => null, cachePut() {}, cacheClear() {}
};
vm.createContext(ctx);
// โหลด 02_helpers.gs เต็มไฟล์ก่อน (ใส่ stub ของ service ที่มันอ้างถึง) แล้วค่อยทับ centralObjects ด้วยชีตจำลอง
ctx.SpreadsheetApp = { openById: () => { throw new Error('should not be called'); } };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '' }) };
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
ctx.centralObjects = n => (sheets[n] || []).map(o => Object.assign({}, o));
ctx.tenantObjects = () => [];
['11_promotions.gs', '14_permissions.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));

console.log('\n── ตัวช่วยอ่านค่า flag ──');
eq('boolean true → เปิด', [ctx.isFlagOn(true), ctx.isFlagOff(true), ctx.isNotOff(true)], [true, false, true]);
eq('boolean false → ปิด', [ctx.isFlagOn(false), ctx.isFlagOff(false), ctx.isNotOff(false)], [false, true, false]);
eq("สตริง 'TRUE' (ของเก่าในชีตที่ยังไม่ถูกแปลง)", [ctx.isFlagOn('TRUE'), ctx.isFlagOff('TRUE')], [true, false]);
eq("สตริง 'FALSE'", [ctx.isFlagOn('FALSE'), ctx.isFlagOff('FALSE')], [false, true]);
eq("ตัวเลข 1 / '1'", [ctx.isFlagOn(1), ctx.isFlagOn('1')], [true, true]);
eq("ตัวเลข 0 / '0'", [ctx.isFlagOff(0), ctx.isFlagOff('0')], [true, true]);
eq('ค่าว่าง = ยังไม่ถูกปิด (ของเก่าที่ไม่เคยกรอก ต้องยังใช้งานได้)', [ctx.isFlagOn(''), ctx.isFlagOff(''), ctx.isNotOff('')], [false, false, true]);
eq('undefined/null ก็ถือว่ายังไม่ปิด', [ctx.isNotOff(undefined), ctx.isNotOff(null)], [true, true]);
eq("ตรรกะเดิมพัง: String(true) ไม่ใช่ 'TRUE'", String(true) === 'TRUE', false);

console.log('\n── โปรโมชั่น (ของเดิมไม่เคยทำงานเลยเพราะบั๊กนี้) ──');
const rules = ctx._activeRules();
eq('โปรที่เปิดอยู่ (is_active = boolean true) ถูกนำมาใช้', rules.map(r => r.name), ['ลด 5% ทั้งบิล']);
eq('  และอ่าน stackable เป็น boolean ได้ถูก', rules[0].stackable, true);

console.log('\n── สิทธิ์ (can_view/can_edit เป็น boolean) ──');
const owner = { role_code: 'owner_admin', adminUserId: '2' };
eq('can_view = true → ดูได้', ctx.hasPermission(owner, 'pricing', 'view'), true);
eq('can_edit = false → แก้ไม่ได้', ctx.hasPermission(owner, 'tenants', 'edit'), false);
eq('  แต่ยังดูได้', ctx.hasPermission(owner, 'tenants', 'view'), true);
eq('super_admin ผ่านทุกอย่างเหมือนเดิม', ctx.hasPermission({ role_code: 'super_admin' }, 'accounting', 'edit'), true);

console.log('\n── ตัวกรองที่ใช้ตรรกะเดียวกันในไฟล์อื่น ──');
eq('สินค้า: ปิดขายถูกตัดออก ของเก่าที่ไม่เคยกรอกยังอยู่',
   sheets.products.filter(p => ctx.isNotOff(p.is_active)).map(p => p.record_id), [1, 3]);
eq('ตัวแทน: เอาเฉพาะที่เปิดใช้งาน', sheets.tenants.filter(t => ctx.isFlagOn(t.is_active)).map(t => t.tenant_id), ['T1']);
eq('ลูกค้า: ร้านที่ปิดถูกตัดออก', sheets.customers.filter(c => ctx.isNotOff(c.is_active)).map(c => c.record_id), [1]);
eq('เลขเอกสาร: ชุดที่เปิดใช้งานถูกเลือก', sheets.doc_number_series.filter(d => ctx.isFlagOn(d.is_active)).length, 1);
eq('ล็อกรหัสสินค้า: สินค้าที่เคยขายแล้ว (boolean true) ต้องถูกล็อก', ctx.isFlagOn(sheets.products[0].has_transactions), true);
eq('  สินค้าที่ยังไม่เคยขาย ไม่ถูกล็อก', ctx.isFlagOn(sheets.products[2].has_transactions), false);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
