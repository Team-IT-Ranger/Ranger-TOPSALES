// รัน: node .dev/test-roles.js
// ทดสอบระบบบทบาท/สิทธิ์ (26_roles.gs) บนชีตจำลอง — เน้นกฎความปลอดภัย:
//   ให้สิทธิ์เกินตัวเองไม่ได้ · บทบาทระบบแก้/ลบไม่ได้ · ตัวแทนยุ่งกับบทบาทของตัวแทนอื่นไม่ได้ · ตั้ง super_admin ผ่านหน้าจอไม่ได้
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'T1', name: 'ตัวแทนที่หนึ่ง', is_active: true },
    { tenant_id: 'T2', name: 'ตัวแทนที่สอง', is_active: true },
    { tenant_id: 'TZ', name: 'ตัวแทนที่ปิดไปแล้ว', is_active: false }
  ],
  roles: [
    { role_code: 'super_admin', role_label: 'ผู้ดูแลระบบสูงสุด', is_system: true, tenant_id: '', description: '' },
    { role_code: 'owner_admin', role_label: 'แอดมินบริษัท', is_system: true, tenant_id: '', description: '' },
    { role_code: 'tenant_admin', role_label: 'แอดมินตัวแทน', is_system: true, tenant_id: '', description: '' }
  ],
  role_permissions: [
    { role_code: 'owner_admin', module_code: 'products', can_view: true, can_edit: true },
    { role_code: 'owner_admin', module_code: 'pricing', can_view: true, can_edit: true },
    { role_code: 'owner_admin', module_code: 'accounting', can_view: true, can_edit: false },
    { role_code: 'owner_admin', module_code: 'users_roles', can_view: true, can_edit: true },
    { role_code: 'tenant_admin', module_code: 'sales', can_view: true, can_edit: true },
    { role_code: 'tenant_admin', module_code: 'customers', can_view: true, can_edit: true },
    { role_code: 'tenant_admin', module_code: 'users_roles', can_view: true, can_edit: true }
  ],
  admin_users: [
    { record_id: 1, username: 'admin', display_name: 'ระบบ', role_code: 'super_admin', tenant_id: '', status: 'active' },
    { record_id: 2, username: 'owner', display_name: 'แอดมินบริษัท', role_code: 'owner_admin', tenant_id: '', status: 'active' },
    { record_id: 3, username: 't1admin', display_name: 'แอดมินตัวแทน 1', role_code: 'tenant_admin', tenant_id: 'T1', status: 'active' }
  ]
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isFinite, parseInt, parseFloat, RegExp,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' }, Utilities: { formatDate: () => '2026-09-24', getUuid: () => 'uuid' },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralAppend: (n, o) => sheetOf(n).push(Object.assign({}, o)),
  centralAppendMany: (n, os) => os.forEach(o => sheetOf(n).push(Object.assign({}, o))),
  centralUpdate: (n, id, f) => { const key = n === 'roles' ? 'role_code' : 'record_id';
    const r = sheetOf(n).find(x => String(x[key]) === String(id)); if (!r) return false; Object.assign(r, f); return true; },
  centralNextId: n => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  deleteRowsWhere: (sh, col, v) => { const n = sh.__name; const before = sheetOf(n).length;
    sheets[n] = sheetOf(n).filter(r => String(r[col]) !== String(v)); return before - sheets[n].length; },
  nowStr: () => '2026-09-24 10:00:00', safeDateStr: v => String(v || '')
};
vm.createContext(ctx);
const fakes = {}; ['centralObjects','centralSheet','centralAppend','centralAppendMany','centralUpdate','centralNextId','deleteRowsWhere','nowStr','safeDateStr'].forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
['14_permissions.gs', '17_pricing.gs', '20_purchasing_master.gs', '26_roles.gs', '16_admin_users.gs', '29_admin_signup.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
ctx._hashPassword = (pw, salt) => 'hash:' + salt + ':' + pw;   // ของจริงอยู่ใน 04_auth.gs (ไม่ได้โหลดในเทสต์นี้)

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
const SUPER = { adminUserId: '1', role_code: 'super_admin', tenant_id: '' };
const OWNER = { adminUserId: '2', role_code: 'owner_admin', tenant_id: '' };
const T1 = { adminUserId: '3', role_code: 'tenant_admin', tenant_id: 'T1' };
const T2 = { adminUserId: '4', role_code: 'tenant_admin', tenant_id: 'T2' };

console.log('\n── สิทธิ์ของผู้ใช้ที่ล็อกอินอยู่ ──');
let r = ctx.getMyPermissions(OWNER);
eq('owner_admin: ดูบัญชีได้แต่แก้ไม่ได้ (ตามที่ตั้งไว้)', [r.permissions.accounting.view, r.permissions.accounting.edit], [true, false]);
eq('  โมดูลที่ไม่ได้ให้สิทธิ์ = ปิดทั้งคู่', r.permissions.tenants, { view: false, edit: false });
eq('super_admin ได้ทุกโมดูล', ctx.getMyPermissions(SUPER).permissions.tenants, { view: true, edit: true });
eq('  ส่งรายชื่อโมดูลไปให้หน้าเว็บซ่อนเมนูได้', r.modules.length > 10, true);

console.log('\n── สร้างบทบาทใหม่ ──');
r = ctx.saveRole(OWNER, { label: 'เจ้าหน้าที่ราคา', description: 'ดูแลชุดราคาอย่างเดียว',
  permissions: [{ module: 'pricing', view: true, edit: true }, { module: 'products', view: true, edit: false }] });
eq('owner สร้างบทบาทกลางได้', [r.success, !!r.savedCode], [true, true]);
const PRICE_ROLE = r.savedCode;
eq('  บันทึกสิทธิ์ครบตามที่ติ๊ก', (() => { const role = r.data.find(x => x.code === PRICE_ROLE);
  return role.permissions.filter(p => p.view || p.edit).map(p => [p.module, p.view, p.edit]); })(), [['products', true, false], ['pricing', true, true]]);
eq('  เป็นบทบาทกลาง (ไม่ผูกตัวแทน) และแก้ได้', (() => { const role = r.data.find(x => x.code === PRICE_ROLE); return [role.tenantId, role.isSystem, role.canEdit]; })(), ['', false, true]);

console.log('\n── กันยกระดับสิทธิ์ (กฎสำคัญที่สุด) ──');
fails('owner ให้สิทธิ์ "แก้บัญชี" ทั้งที่ตัวเองมีแค่สิทธิ์ดู → ปฏิเสธ',
  ctx.saveRole(OWNER, { label: 'บัญชีเต็ม', permissions: [{ module: 'accounting', view: true, edit: true }] }), /บัญชีของคุณเองมีแค่สิทธิ์ดู/);
fails('owner ให้สิทธิ์โมดูลที่ตัวเองไม่มีเลย → ปฏิเสธ',
  ctx.saveRole(OWNER, { label: 'ดูตัวแทน', permissions: [{ module: 'tenants', view: true, edit: false }] }), /ยังไม่มีสิทธิ์นั้น/);
eq('super_admin ให้สิทธิ์อะไรก็ได้', ctx.saveRole(SUPER, { label: 'ผู้ตรวจสอบบัญชี',
  permissions: [{ module: 'accounting', view: true, edit: true }, { module: 'tenants', view: true, edit: false }] }).success, true);
eq('ติ๊ก "แก้ได้" แต่ลืมติ๊ก "ดูได้" → ระบบเติมสิทธิ์ดูให้เอง', (() => {
  const res = ctx.saveRole(SUPER, { label: 'คลังอย่างเดียว', permissions: [{ module: 'inventory', view: false, edit: true }] });
  const role = res.data.find(x => x.code === res.savedCode);
  return role.permissions.find(p => p.module === 'inventory');
})(), { module: 'inventory', view: true, edit: true });

console.log('\n── บทบาทของระบบ ──');
fails('แก้บทบาทระบบไม่ได้', ctx.saveRole(SUPER, { code: 'owner_admin', label: 'เปลี่ยนชื่อ', permissions: [] }), /บทบาทของระบบแก้ไขไม่ได้/);
fails('ลบบทบาทระบบไม่ได้', ctx.deleteRole(SUPER, { code: 'tenant_admin' }), /ลบไม่ได้/);

console.log('\n── ขอบเขตของตัวแทน ──');
r = ctx.saveRole(T1, { label: 'พนักงานรับออเดอร์', permissions: [{ module: 'sales', view: true, edit: true }] });
eq('ตัวแทนสร้างบทบาทของตัวเองได้ และถูกผูกกับตัวแทนนั้น', [r.success, r.data.find(x => x.code === r.savedCode).tenantId], [true, 'T1']);
const T1_ROLE = r.savedCode;
eq('  รหัสบทบาทขึ้นต้นด้วยรหัสตัวแทน กันชนกับรายอื่น', T1_ROLE.indexOf('T1_') === 0, true);
eq('ตัวแทน T1 เห็นเฉพาะบทบาทของตัวเอง + tenant_admin', ctx.listRolesWithPermissions(T1, {}).data.map(x => x.code).sort(), [T1_ROLE, 'tenant_admin'].sort());
eq('  ไม่เห็นบทบาทกลางของบริษัท', ctx.listRolesWithPermissions(T1, {}).data.some(x => x.code === PRICE_ROLE), false);
fails('T2 แก้บทบาทของ T1 ไม่ได้', ctx.saveRole(T2, { code: T1_ROLE, label: 'แอบแก้', permissions: [] }), /ไม่มีสิทธิ์แก้บทบาทของตัวแทนอื่น/);
fails('T2 ลบบทบาทของ T1 ไม่ได้', ctx.deleteRole(T2, { code: T1_ROLE }), /ไม่มีสิทธิ์ลบบทบาทของตัวแทนอื่น/);
fails('ตัวแทนให้สิทธิ์โมดูลที่ตัวเองไม่มี → ปฏิเสธ',
  ctx.saveRole(T1, { label: 'อยากได้ราคา', permissions: [{ module: 'pricing', view: true, edit: true }] }), /ยังไม่มีสิทธิ์/);

console.log('\n── กำหนดบทบาทให้ผู้ใช้ ──');
eq('ตั้ง super_admin ผ่านหน้าจอไม่ได้', ctx.resolveAssignableRole(OWNER, 'super_admin', ''), null);
eq('owner ตั้งบทบาทกลางให้ผู้ใช้ได้', ctx.resolveAssignableRole(OWNER, PRICE_ROLE, ''), PRICE_ROLE);
eq('ตัวแทน T1 ตั้งบทบาทของตัวเองให้ลูกน้องได้', ctx.resolveAssignableRole(T1, T1_ROLE, 'T1'), T1_ROLE);
eq('  แต่ตั้งบทบาทของตัวแทนอื่นไม่ได้', ctx.resolveAssignableRole(T2, T1_ROLE, 'T2'), null);
eq('  และตั้งบทบาทกลางของบริษัทให้ลูกน้องตัวเองไม่ได้', ctx.resolveAssignableRole(T1, PRICE_ROLE, 'T1'), null);
eq('บทบาทที่ไม่มีจริง → null', ctx.resolveAssignableRole(OWNER, 'ไม่มีอยู่จริง', ''), null);

console.log('\n── ลบบทบาท ──');
sheets.admin_users.push({ record_id: 9, username: 'u9', display_name: 'ผู้ใช้', role_code: T1_ROLE, tenant_id: 'T1', status: 'active' });
fails('ยังมีผู้ใช้ถือบทบาทอยู่ → ลบไม่ได้', ctx.deleteRole(T1, { code: T1_ROLE }), /ยังมีผู้ใช้ 1 บัญชี/);
sheets.admin_users = sheets.admin_users.filter(u => u.record_id !== 9);
eq('ย้ายผู้ใช้ออกแล้วลบได้', ctx.deleteRole(T1, { code: T1_ROLE }).success, true);
eq('  สิทธิ์ของบทบาทนั้นถูกลบตามไปด้วย ไม่มีขยะค้าง', sheets.role_permissions.some(p => p.role_code === T1_ROLE), false);

console.log('\n── สิทธิ์ขั้นต่ำในการเข้าหน้าจอนี้ ──');
fails('ผู้ใช้ที่ไม่มีสิทธิ์ users_roles เปิดหน้าไม่ได้',
  ctx.listRolesWithPermissions({ adminUserId: '5', role_code: 'ไม่มีสิทธิ์', tenant_id: '' }, {}));

console.log('\n-- ผู้ใช้ใหม่: ต้องเลือกสังกัดและรออนุมัติ --');
r = ctx.registerAdminUser({ username: 'newbie', password: 'password123', displayName: 'ผู้ใช้ใหม่', tenantId: 'T1' });
eq('สมัครแล้วได้สถานะรออนุมัติ', [r.success, r.pending], [true, true]);
const pending = sheets.admin_users.find(u => u.username === 'newbie');
eq('  บัญชีที่สมัครยังไม่มีบทบาทและสถานะ pending', [pending.status, pending.role_code, pending.tenant_id], ['pending', '', 'T1']);
fails('สมัคร username ซ้ำ -> ปฏิเสธ', ctx.registerAdminUser({ username: 'NEWBIE', password: 'password123', displayName: 'ซ้ำ' }), /ลงทะเบียนไว้แล้ว|ถูกใช้แล้ว/);
fails('รหัสผ่านสั้นเกินไป -> ปฏิเสธ', ctx.registerAdminUser({ username: 'shorty', password: '123', displayName: 'x' }), /8 ตัวอักษร/);
fails('เลือกสังกัดที่ไม่มีจริง -> ปฏิเสธ', ctx.registerAdminUser({ username: 'ghost', password: 'password123', displayName: 'x', tenantId: 'NOPE' }), /ไม่พบตัวแทน/);
fails('เลือกสังกัดที่ปิดใช้งานแล้ว -> ปฏิเสธ', ctx.registerAdminUser({ username: 'ghost2', password: 'password123', displayName: 'x', tenantId: 'TZ' }), /ไม่พบตัวแทน/);
r = ctx.registerAdminUser({ username: 'ownerreq', password: 'password123', displayName: 'ขอเข้าบริษัท' });
eq('สมัครเข้าบริษัทเจ้าของสินค้า (ไม่ระบุตัวแทน) ได้', [r.success, sheets.admin_users.find(u => u.username === 'ownerreq').tenant_id], [true, '']);

console.log('\n-- คิวอนุมัติ --');
eq('แอดมินตัวแทน T1 เห็นเฉพาะคำขอที่ขอเข้าตัวแทนตัวเอง',
   ctx.listPendingAdminUsers(T1, {}).data.map(x => x.username), ['newbie']);
eq('ฝั่งบริษัทเห็นทุกคำขอ', ctx.listPendingAdminUsers(OWNER, {}).data.map(x => x.username).sort(), ['newbie', 'ownerreq']);
fails('แอดมินตัวแทนอื่น (T2) อนุมัติคำขอของ T1 ไม่ได้', ctx.approveAdminUser(T2, { id: pending.record_id, roleCode: 'tenant_admin' }), /ตัวแทนอื่น/);
fails('อนุมัติโดยไม่เลือกบทบาท -> ปฏิเสธ', ctx.approveAdminUser(OWNER, { id: pending.record_id }), /เลือกบทบาท/);
fails('อนุมัติเป็น super_admin ผ่านหน้าจอไม่ได้', ctx.approveAdminUser(SUPER, { id: pending.record_id, roleCode: 'super_admin' }), /เลือกบทบาท/);
r = ctx.approveAdminUser(T1, { id: pending.record_id, roleCode: 'tenant_admin' });
eq('แอดมินตัวแทนอนุมัติคนของตัวเองได้', [r.success, pending.status, pending.role_code], [true, 'active', 'tenant_admin']);
fails('อนุมัติซ้ำ -> ปฏิเสธ', ctx.approveAdminUser(T1, { id: pending.record_id, roleCode: 'tenant_admin' }), /ดำเนินการไปแล้ว/);
const req2 = sheets.admin_users.find(u => u.username === 'ownerreq');
r = ctx.rejectAdminUser(OWNER, { id: req2.record_id });
eq('ปฏิเสธคำขอได้ และสถานะเป็น rejected', [r.success, req2.status], [true, 'rejected']);
eq('  คิวว่างแล้ว', ctx.listPendingAdminUsers(OWNER, {}).data.length, 0);
fails('ผู้ใช้ที่ไม่มีสิทธิ์ users_roles ดูคิวไม่ได้',
  ctx.listPendingAdminUsers({ adminUserId: '9', role_code: 'ไม่มีสิทธิ์', tenant_id: '' }, {}));

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
