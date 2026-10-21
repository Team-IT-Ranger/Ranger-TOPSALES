// รัน: node .dev/test-user-tenants.js
// ผู้รับผิดชอบตัวแทน (57_user_tenants.gs) — "บัญชีนี้ดูแลตัวแทนรายไหน"
// กติกาเจ้าของระบบ 21 ต.ค. 2026: "ฝั่งบริษัทเห็นทุกราย และต้องมีตารางผู้รับผิดชอบรายคน"
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'TNKI', name: 'ตัวแทนบ้าน', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', is_active: 'TRUE' },
    { tenant_id: 'NKN', name: 'นครนายก', is_active: 'TRUE' },
    { tenant_id: 'CBI', name: 'ชลบุรี', is_active: 'TRUE' },
    { tenant_id: 'OLD', name: 'เลิกใช้แล้ว', is_active: 'FALSE' }
  ],
  company_profile: [{ record_id: 1, name: 'บริษัท ธนัทกร จำกัด' }],
  admin_users: [
    { record_id: 1, username: 'ultra', display_name: 'อุลตร้า', role_code: 'super_admin', tenant_id: '', status: 'active' },
    { record_id: 2, username: 'somchai', display_name: 'สมชาย', role_code: 'owner_admin', tenant_id: '', status: 'active' },
    { record_id: 3, username: 'malee', display_name: 'มาลี', role_code: 'owner_admin', tenant_id: 'TNKI', status: 'active' },
    { record_id: 4, username: 'bdcadmin', display_name: 'แอดมิน BDC', role_code: 'tenant_admin', tenant_id: 'BDC', status: 'active' },
    { record_id: 5, username: 'quit', display_name: 'ลาออกแล้ว', role_code: 'owner_admin', tenant_id: '', status: 'suspended' }
  ],
  admin_user_tenants: []
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, parseInt, parseFloat, RegExp, Math,
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '2026-10-21' },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralAppend: (n, o) => sheetOf(n).push(Object.assign({}, o)),
  centralAppendMany: (n, os) => os.forEach(o => sheetOf(n).push(Object.assign({}, o))),
  centralNextId: n => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralInvalidate: () => {},
  deleteRowsWhere: (sh, col, v) => { sheets[sh.__name] = sheetOf(sh.__name).filter(r => String(r[col]) !== String(v)); },
  nowStr: () => '2026-10-21 09:00:00',
  _requirePermission: () => null
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralNextId', 'centralInvalidate', 'deleteRowsWhere', 'nowStr']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
vm.runInContext('var ADMIN_STATUS_ACTIVE = "active";', ctx, { filename: 'stub.gs' });
vm.runInContext(B('57_user_tenants.gs'), ctx, { filename: '57_user_tenants.gs' });

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
const user = id => sheets.admin_users.find(u => u.record_id === id);
const ids = u => ctx.managedTenantIds(u).slice().sort();
const ULTRA = { adminUserId: '1', role_code: 'super_admin', tenant_id: '' };
const SOMCHAI = { adminUserId: '2', role_code: 'owner_admin', tenant_id: '' };
const BDCADM = { adminUserId: '4', role_code: 'tenant_admin', tenant_id: 'BDC' };

console.log('-- ยังไม่เคยตั้งค่า: ต้องไม่ทำให้ของที่ใช้อยู่หยุดทำงาน --');
eq('★ ตารางว่าง + ฝั่งบริษัท = เห็นทุกรายที่ยังเปิดใช้งาน (ไม่ใช่ "ไม่เห็นอะไรเลย")',
  ids(SOMCHAI), ['BDC', 'CBI', 'NKN', 'TNKI']);
eq('ตัวแทนที่ปิดใช้งานไม่โผล่ในรายการ', ids(SOMCHAI).indexOf('OLD'), -1);
eq('super_admin เห็นทุกราย', ids(ULTRA), ['BDC', 'CBI', 'NKN', 'TNKI']);

console.log('\n-- บัญชีที่สังกัดตัวแทน: ตารางนี้ไม่มีผลกับเขาเลย --');
eq('แอดมินตัวแทนเห็นรายเดียว คือของตัวเอง', ctx.managedTenantIds(BDCADM), ['BDC']);
sheets.admin_user_tenants.push({ record_id: 90, admin_user_id: '4', tenant_id: 'NKN' });
eq('★ ใส่แถวให้แอดมินตัวแทนข้ามไปรายอื่น = ยังข้ามไม่ได้ (กติกาเดิมของระบบ)',
  ctx.managedTenantIds(BDCADM), ['BDC']);
sheets.admin_user_tenants.length = 0;
eq('สังกัด TNKI ถือเป็นฝั่งบริษัท จึงเห็นทุกราย', ids({ adminUserId: '3', role_code: 'owner_admin', tenant_id: 'TNKI' }),
  ['BDC', 'CBI', 'NKN', 'TNKI']);

console.log('\n-- ตั้งผู้รับผิดชอบแล้ว --');
eq('บันทึกได้', ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: ['BDC', 'NKN'] }).success, true);
eq('★ เห็นเฉพาะรายที่ระบุ', ids(SOMCHAI), ['BDC', 'NKN']);
eq('เขียนทับทั้งชุด ไม่ใช่เพิ่มต่อท้าย',
  (ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: ['CBI'] }), ids(SOMCHAI)), ['CBI']);
eq('ไม่มีแถวค้างของเดิม', sheets.admin_user_tenants.filter(r => r.admin_user_id === '2').length, 1);
eq('ส่งรหัสซ้ำมาเก็บแถวเดียว',
  (ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: ['BDC', 'BDC', 'NKN'] }),
   sheets.admin_user_tenants.filter(r => r.admin_user_id === '2').length), 2);
eq('★ super_admin ยังเห็นทุกรายแม้มีแถวระบุไว้',
  (ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '1', tenantIds: ['BDC'] }), ids(ULTRA)),
  ['BDC', 'CBI', 'NKN', 'TNKI']);
eq('ตัวแทนที่ถูกปิดใช้งานหลังตั้งค่าแล้ว หลุดออกจากรายการเอง',
  (sheets.admin_user_tenants.push({ record_id: 95, admin_user_id: '2', tenant_id: 'OLD' }), ids(SOMCHAI)), ['BDC', 'NKN']);
sheets.admin_user_tenants = sheets.admin_user_tenants.filter(r => r.record_id !== 95);

console.log('\n-- ล้างค่า = กลับไปเห็นทุกราย --');
eq('ส่งรายการว่าง', ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: [] }).success, true);
eq('★ ว่าง ≠ ไม่เห็นอะไรเลย', ids(SOMCHAI), ['BDC', 'CBI', 'NKN', 'TNKI']);

console.log('\n-- กติกาการบันทึก --');
fails('ตัวแทนตั้งให้ใครไม่ได้ แม้บทบาทมีสิทธิ์แก้ผู้ใช้',
  ctx.saveTenantResponsibilities(BDCADM, { adminUserId: '2', tenantIds: ['BDC'] }), /ฝั่งบริษัท/);
fails('★ ตั้งให้บัญชีที่สังกัดตัวแทน = ปฏิเสธพร้อมบอกเหตุ (ไม่ใช่บันทึกแล้วไม่มีผล)',
  ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '4', tenantIds: ['NKN'] }), /สังกัด/);
fails('รหัสตัวแทนที่ไม่มีจริง', ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: ['ไม่มี'] }), /ไม่พบตัวแทน/);
fails('ตัวแทนที่ปิดใช้งานแล้ว ตั้งใหม่ไม่ได้', ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: ['OLD'] }), /ไม่พบตัวแทน/);
fails('ไม่ระบุบัญชี', ctx.saveTenantResponsibilities(ULTRA, { tenantIds: ['BDC'] }), /ไม่ได้ระบุ/);
fails('บัญชีที่ไม่มีจริง', ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '999', tenantIds: ['BDC'] }), /ไม่พบบัญชี/);

console.log('\n-- managesTenant: ด่านก่อนอ่านข้อมูลของตัวแทนที่ส่งรหัสมาเอง --');
ctx.saveTenantResponsibilities(ULTRA, { adminUserId: '2', tenantIds: ['BDC'] });
eq('ดูแลอยู่', ctx.managesTenant(SOMCHAI, 'BDC'), true);
eq('★ ไม่ได้ดูแล = ปฏิเสธ (ส่งรหัสมาเองก็ไม่ได้)', ctx.managesTenant(SOMCHAI, 'NKN'), false);
eq('ส่งค่าว่างมา', ctx.managesTenant(SOMCHAI, ''), false);
eq('แอดมินตัวแทนถามถึงตัวแทนอื่น', ctx.managesTenant(BDCADM, 'NKN'), false);

console.log('\n-- รายการสำหรับแสดงบนจอ/ในแชต --');
const list = ctx.managedTenants(ULTRA);
eq('★ บริษัทเจ้าของสินค้าอยู่หัวรายการเสมอ', list[0].tenantId, 'TNKI');
eq('★ ชื่อตัวแทนบ้านใช้ชื่อบริษัทจริง ไม่ใช่คำว่า "ตัวแทนบ้าน"', list[0].name, 'บริษัท ธนัทกร จำกัด');
// ชลบุรี → นครนายก → บีดีซี (ช < น < บ) — ไม่ใช่เรียงตามรหัสหรือตามลำดับในชีต
eq('ที่เหลือเรียงตามชื่อไทย', list.slice(1).map(t => t.tenantId), ['CBI', 'NKN', 'BDC']);

console.log('\n-- หน้าจอตั้งค่า (listTenantResponsibilities) --');
const view = ctx.listTenantResponsibilities(ULTRA, {});
eq('แสดงเฉพาะบัญชีฝั่งบริษัทที่ยังใช้งาน (คนลาออก/แอดมินตัวแทนไม่อยู่ในลิสต์)',
  view.users.map(u => u.username).sort(), ['malee', 'somchai', 'ultra']);
eq('★ บอกค่าที่มีผลจริงมาด้วย ไม่ให้คนอ่านช่องว่างแล้วเดา',
  view.users.find(u => u.username === 'malee').effectiveTenantIds.length, 4);
eq('super_admin ติดธงว่าเห็นทุกรายตลอด', view.users.find(u => u.username === 'ultra').alwaysAll, true);
eq('ส่ง adminUserId มา = เฉพาะคนนั้น', ctx.listTenantResponsibilities(ULTRA, { adminUserId: '2' }).users.length, 1);

console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
