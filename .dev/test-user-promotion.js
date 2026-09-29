// รัน: node .dev/test-user-promotion.js
// ทดสอบโมเดลผู้ใช้งานใหม่ (2026-09-29 เจ้าของระบบสั่ง): liff_users เป็นคิวรวมของทุกช่องทาง (มือถือ/แอดมิน/บอท)
// แล้ว Ultra Admin ตัดสินใจ "ตั้งเป็นแอดมิน" (promoteToAdmin, backend/29_admin_signup.gs) หรือ
// "ตั้งเป็นพนักงานขาย" พร้อมแก้สังกัดที่เลือกผิดได้ (updateStaffAdmin รับ newTenantId แล้ว, backend/10_master_data.gs)
// ใช้ FakeSheet จริง (getDataRange/getRange/appendRow) เพราะทั้งสองฟังก์ชันเขียนชีตแบบดิบ ไม่ผ่าน centralUpdate
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

// หัวคอลัมน์จริงจาก 00_setup_sheets.gs (ไม่ก๊อปมาไว้ซ้ำ จะได้ไม่หลุดกันเวลาสคีมาเปลี่ยน)
const CENTRAL_SHEETS = (() => {
  const c = { Utilities: {}, Session: {}, PropertiesService: {}, LockService: {}, SpreadsheetApp: {}, Logger: { log() {} } };
  vm.createContext(c);
  vm.runInContext(B('00_setup_sheets.gs') + '\nthis.__S = CENTRAL_SHEETS;', c);
  return c.__S;
})();

class FakeSheet {
  constructor(headers) { this.rows = [headers.slice()]; }
  getDataRange() { return { getValues: () => this.rows.map(r => r.slice()) }; }
  getRange(row, col) { const sh = this; return { setValue(v) { while (sh.rows[row - 1].length < col) sh.rows[row - 1].push(''); sh.rows[row - 1][col - 1] = v; } }; }
  getLastRow() { return this.rows.length; }
  appendRow(r) { this.rows.push(r.slice()); }
}
const sheets = {};
Object.keys(CENTRAL_SHEETS).forEach(n => { sheets[n] = new FakeSheet(CENTRAL_SHEETS[n]); });

const objs = sh => sh.rows.slice(1).filter(r => r[0] !== '' && r[0] != null).map(r => Object.fromEntries(sh.rows[0].map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
const append = (sh, o) => sh.rows.push(sh.rows[0].map(h => (o[h] !== undefined ? o[h] : '')));
let lockHeld = false;

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isFinite, parseInt, parseFloat, RegExp,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-29', getUuid: () => 'uuid-' + Math.random().toString(36).slice(2) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: { getScriptLock: () => ({ tryLock() { if (lockHeld) return false; lockHeld = true; return true; }, releaseLock() { lockHeld = false; } }) },
  centralSheet: n => { if (!sheets[n]) throw new Error('ไม่รู้จักชีต ' + n); return sheets[n]; },
  centralObjects: n => objs(ctx.centralSheet(n)),
  centralAppend: (n, o) => append(ctx.centralSheet(n), o),
  centralAppendMany: (n, os) => { os.forEach(o => append(ctx.centralSheet(n), o)); return os.length; },
  centralNextId: n => objs(ctx.centralSheet(n)).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralUpdate: (n, id, f) => { const sh = ctx.centralSheet(n), r = sh.rows.find((x, i) => i && String(x[0]) === String(id)); if (!r) return false; Object.keys(f).forEach(k => { const c = sh.rows[0].indexOf(k); if (c >= 0) { while (r.length <= c) r.push(''); r[c] = f[k]; } }); return true; },
  centralInvalidate: () => {},
  nowStr: () => '2026-09-29 10:00:00', safeDateStr: v => String(v || ''),
  _requirePermission: (s, m, a) => (s.perms === 'none' ? { success: false, message: 'ไม่มีสิทธิ์' } : null),
  // เหมือน _effectiveTenantId ใน 14_permissions.gs: ตัวแทนใช้ของตัวเอง · ฝั่งบริษัทสวมสิทธิ์ตัวแทนได้ด้วย payload.tenantId
  _effectiveTenantId: (s, p) => s.tenant_id || ((s.role_code === 'super_admin' || s.role_code === 'owner_admin') && p && p.tenantId ? String(p.tenantId) : null)
};
vm.createContext(ctx);
// โหลด 02_helpers.gs ของจริงก่อน (มี isFlagOn ที่ _activeTenantRow เรียกใช้) แล้วคืนค่าชีตจำลองทับ
const _fakes = { centralSheet: ctx.centralSheet, centralObjects: ctx.centralObjects, centralAppend: ctx.centralAppend,
  centralAppendMany: ctx.centralAppendMany, centralNextId: ctx.centralNextId, centralUpdate: ctx.centralUpdate,
  nowStr: ctx.nowStr, safeDateStr: ctx.safeDateStr };
ctx.SpreadsheetApp = { openById: () => { throw new Error('should not be called'); } };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '' }) };
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', '02_helpers.gs'), 'utf8'), ctx, { filename: '02_helpers.gs' });
Object.keys(_fakes).forEach(k => { if (_fakes[k]) ctx[k] = _fakes[k]; });
['00_setup_sheets.gs', '04_auth.gs', '26_roles.gs', '29_admin_signup.gs', '10_master_data.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));

// ── ข้อมูลตั้งต้น ──
append(sheets.tenants, { tenant_id: 'T1', name: 'ตัวแทนที่หนึ่ง', sheet_file_id: 'F1', region: '', is_active: 'TRUE', created_at: '' });
append(sheets.tenants, { tenant_id: 'T2', name: 'ตัวแทนที่สอง', sheet_file_id: 'F2', region: '', is_active: 'TRUE', created_at: '' });
append(sheets.tenants, { tenant_id: 'TZ', name: 'ตัวแทนปิด', sheet_file_id: 'FZ', region: '', is_active: 'FALSE', created_at: '' });
['super_admin', 'owner_admin', 'tenant_admin'].forEach(code =>
  append(sheets.roles, { role_code: code, role_label: code, is_system: 'TRUE', tenant_id: '', description: '' }));
append(sheets.admin_users, { record_id: 1, username: 'admin', display_name: 'ระบบ', role_code: 'super_admin', tenant_id: '', status: 'active', line_user_id: 'U00000000000000000000000000000001' });

const SUPER = { adminUserId: '1', role_code: 'super_admin', tenant_id: '' };
const OWNER = { adminUserId: '2', role_code: 'owner_admin', tenant_id: '' };
const T1SESS = { adminUserId: '3', role_code: 'tenant_admin', tenant_id: 'T1' };

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

console.log('── ตั้งเป็นแอดมินจากคิว liff_users (promoteToAdmin) ──');
const LID4 = 'U66666666666666666666666666666666';
ctx.centralAppend('liff_users', { line_user_id: LID4, display_name: 'ใหม่ รออนุมัติ', role: 'รออนุมัติ', tenant_id: 'T2', status: 'No', last_login: '' });

fails('ไม่ใช่ Ultra Admin ตั้งแอดมินไม่ได้', ctx.promoteToAdmin(OWNER, { lineUserId: LID4, roleCode: 'tenant_admin', tenantId: 'T2' }), /Ultra Admin/);
fails('ไม่พบใน liff_users ตั้งไม่ได้', ctx.promoteToAdmin(SUPER, { lineUserId: 'U00000000000000000000000000000000', roleCode: 'tenant_admin', tenantId: 'T2' }), /ไม่พบ/);
fails('เลือกบทบาทว่าง → ปฏิเสธ', ctx.promoteToAdmin(SUPER, { lineUserId: LID4, tenantId: 'T2' }), /บทบาท/);
fails('เลือกตัวแทนที่ปิดใช้งาน → ปฏิเสธ', ctx.promoteToAdmin(SUPER, { lineUserId: LID4, roleCode: 'tenant_admin', tenantId: 'TZ' }), /ไม่พบตัวแทน/);
fails('ตั้ง super_admin ผ่านหน้าจอไม่ได้', ctx.promoteToAdmin(SUPER, { lineUserId: LID4, roleCode: 'super_admin', tenantId: '' }), /บทบาท/);

let r = ctx.promoteToAdmin(SUPER, { lineUserId: LID4, roleCode: 'tenant_admin', tenantId: 'T2' });
const promoted = ctx.centralObjects('admin_users').find(u => u.line_user_id === LID4);
const liffAfterPromote = ctx.centralObjects('liff_users').find(u => u.line_user_id === LID4);
eq('ตั้งเป็นแอดมินสำเร็จ สร้างบัญชี active ทันที (ไม่มี pending คั่นกลาง) ไม่มีรหัสผ่าน',
  [r.success, promoted.status, promoted.role_code, promoted.tenant_id, promoted.password_hash, promoted.salt],
  [true, 'active', 'tenant_admin', 'T2', '', '']);
eq('  แถวเดิมใน liff_users ถูกปิดคิว (status = Yes) กันโชว์ซ้ำในคิวรออนุมัติ', liffAfterPromote.status, 'Yes');
fails('ตั้งซ้ำอีกรอบไม่ได้ (เป็นแอดมินอยู่แล้ว)', ctx.promoteToAdmin(SUPER, { lineUserId: LID4, roleCode: 'tenant_admin', tenantId: 'T2' }), /อยู่แล้ว/);

console.log('\n── แก้สังกัดพนักงานที่เลือกผิด (updateStaffAdmin newTenantId) ──');
const LID5 = 'U77777777777777777777777777777777';
ctx.centralAppend('liff_users', { line_user_id: LID5, display_name: 'เลือกสังกัดผิด', role: 'van_sales', tenant_id: 'T1', status: 'No', last_login: '' });

fails('ฝั่งตัวแทนแก้สังกัดพนักงานไม่ได้ (เฉพาะฝั่งบริษัท/Ultra Admin)', ctx.updateStaffAdmin(T1SESS, { lineUserId: LID5, newTenantId: 'T2' }), /ไม่มีสิทธิ์เปลี่ยนสังกัด/);
// ★ กันซ้ำบั๊กที่เจอจริงตอนเขียนเทสต์นี้: ต้องใช้ payload.newTenantId ไม่ใช่ payload.tenantId — ชื่อ tenantId ถูก
// _effectiveTenantId อ่านไปแปลว่า "Ultra Admin กำลังสวมสิทธิ์ตัวแทนนี้อยู่" ทำให้ effTenantId ไม่ว่างและถูกบล็อกเอง
fails('ส่ง payload.tenantId (ชื่อผิด) แทน newTenantId → ต้องไม่ทำอะไร ไม่ใช่แอบสำเร็จ',
  ctx.updateStaffAdmin(SUPER, { lineUserId: LID5, tenantId: 'T2' }), /ไม่มีสิทธิ์/);
r = ctx.updateStaffAdmin(SUPER, { lineUserId: LID5, newTenantId: 'T2', status: 'Yes', role: 'van_sales' });
let fixed = ctx.centralObjects('liff_users').find(u => u.line_user_id === LID5);
eq('ฝั่งบริษัท/Ultra Admin แก้สังกัดพร้อมอนุมัติได้ในคำขอเดียว', [r.success, fixed.tenant_id, fixed.status, fixed.role], [true, 'T2', 'Yes', 'van_sales']);
fails('แก้เป็นตัวแทนที่ปิดใช้งาน → ปฏิเสธ (ไม่เปลี่ยนของเดิม)', ctx.updateStaffAdmin(SUPER, { lineUserId: LID5, newTenantId: 'TZ' }), /ไม่พบตัวแทน/);
fixed = ctx.centralObjects('liff_users').find(u => u.line_user_id === LID5);
eq('  สังกัดเดิมไม่ถูกแตะเมื่อปฏิเสธ', fixed.tenant_id, 'T2');

console.log('\n── คิวรออนุมัติ: listStaffAdmin ต้องไม่กรอง tenant_id ว่างทิ้ง (บั๊กที่เจอจริง 2026-09-29) ──');
// เพิ่มเพื่อนกับบอท/สมัครผ่านแอดมิน ยังไม่ได้เลือกสังกัด → tenant_id ว่าง เหมือนภาพจริงที่เจ้าของระบบส่งมา
const LID6 = 'U88888888888888888888888888888888';
ctx.centralAppend('liff_users', { line_user_id: LID6, display_name: 'เพิ่มเพื่อนกับบอท', role: 'รออนุมัติ', tenant_id: '', status: 'No', last_login: '' });
// ★ เดิมใช้ _salesTenantId ซึ่ง super_admin ที่ไม่ได้สวมสิทธิ์ตัวแทนไหนอยู่จะ fallback ไปที่ HOUSE โดยอัตโนมัติ
// แล้ว filter tenant_id === 'HOUSE' ทิ้งแถวที่ยังไม่มีสังกัดเลยหมด — Ultra Admin เห็นคิวรออนุมัติว่างทั้งที่มีจริง
// (ผู้ใช้ส่งภาพหน้าชีตมายืนยัน 7 แถว แต่หน้าเว็บว่าง) แก้เป็น _effectiveTenantId ซึ่งไม่ fallback ให้ตรงกับ
// listAdminUsers (14_permissions.gs) และ updateStaffAdmin ด้านบน
let sr = ctx.listStaffAdmin(SUPER, {});
eq('Ultra Admin ไม่สวมสิทธิ์ตัวแทนไหน เห็นทุกแถวรวมที่ยังไม่มีสังกัด', sr.data.some(u => u.lineUserId === LID6), true);
sr = ctx.listStaffAdmin(T1SESS, {});
eq('ฝั่งตัวแทนยังเห็นเฉพาะของตัวเอง ไม่เห็นแถวที่ยังไม่มีสังกัด', sr.data.some(u => u.lineUserId === LID6), false);
eq('  และไม่เห็นของตัวแทนอื่น (T2)', sr.data.some(u => u.tenantId === 'T2'), false);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
