/**
 * ===================== จัดการบัญชีแอดมิน (Admin App) =====================
 * บริษัทเจ้าของสินค้า (session.tenant_id ว่าง) จัดการได้ทุกบัญชี
 * ตัวแทน (session.tenant_id มีค่า) จัดการได้เฉพาะบัญชี tenant_admin ของตัวแทนตัวเอง
 * — สร้าง super_admin ใหม่ทำผ่าน Apps Script Editor เท่านั้น (99_dev_tools.gs) กันยกระดับสิทธิ์ผ่าน API
 */
var VALID_ADMIN_ROLES = ['owner_admin', 'tenant_admin'];

function _adminUserRow(recordId) {
  var rows = centralObjects('admin_users');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].record_id) === String(recordId)) return rows[i];
  }
  return null;
}

// payload: { username, password, displayName, roleCode, tenantId }
function createAdminUser(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;

  var username = String(payload.username || '').trim();
  var password = String(payload.password || '');
  var displayName = String(payload.displayName || '').trim();
  if (!username || !password || !displayName) return { success: false, message: 'กรุณากรอก username/password/ชื่อให้ครบ' };
  if (password.length < 8) return { success: false, message: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' };

  var effTenantId = _effectiveTenantId(session, payload);
  var roleCode, tenantId;
  if (effTenantId) {
    // ตัวแทน (หรือ Ultra Admin ที่สวมสิทธิ์ตัวแทนอยู่): สร้างได้แค่ tenant_admin ของตัวแทนนั้นเท่านั้น กันยกระดับสิทธิ์/ข้ามตัวแทน
    roleCode = 'tenant_admin';
    tenantId = effTenantId;
  } else {
    roleCode = VALID_ADMIN_ROLES.indexOf(payload.roleCode) !== -1 ? payload.roleCode : 'tenant_admin';
    tenantId = roleCode === 'tenant_admin' ? String(payload.tenantId || '') : '';
    if (roleCode === 'tenant_admin' && !tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่ายสำหรับบัญชีระดับตัวแทน' };
  }

  var existing = centralObjects('admin_users');
  if (existing.some(function(u) { return String(u.username).toLowerCase() === username.toLowerCase(); })) {
    return { success: false, message: 'มี username นี้อยู่แล้ว' };
  }

  var salt = Utilities.getUuid();
  centralAppend('admin_users', {
    record_id: centralNextId('admin_users'), username: username,
    password_hash: _hashPassword(password, salt), salt: salt,
    display_name: displayName, role_code: roleCode, tenant_id: tenantId,
    status: 'active', created_at: nowStr()
  });
  return { success: true };
}

// payload: { id, displayName?, status?, roleCode?, tenantId? }
function updateAdminUser(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  var target = _adminUserRow(payload.id);
  if (!target) return { success: false, message: 'ไม่พบผู้ใช้นี้' };

  var effTenantId = _effectiveTenantId(session, payload);
  if (effTenantId) {
    // ตัวแทน (หรือ Ultra Admin ที่สวมสิทธิ์ตัวแทนอยู่) แก้ได้เฉพาะบัญชีของตัวแทนนั้น แก้ role/tenant ข้ามไปที่อื่นไม่ได้
    if (String(target.tenant_id) !== String(effTenantId)) return { success: false, message: 'ไม่มีสิทธิ์แก้ไขบัญชีของตัวแทนอื่น' };
    var fields = {};
    if (payload.displayName !== undefined) fields.display_name = payload.displayName;
    if (payload.status !== undefined) fields.status = payload.status;
    centralUpdate('admin_users', payload.id, fields);
    return { success: true };
  }

  // บริษัทเจ้าของสินค้า: แก้ได้เต็มที่ ยกเว้นห้ามแก้บัญชี super_admin ผ่าน API (กันล็อกตัวเองออกจากระบบ)
  if (target.role_code === 'super_admin') return { success: false, message: 'แก้ไขบัญชี super_admin ได้เฉพาะผ่าน Apps Script Editor เท่านั้น' };
  var ownerFields = {};
  if (payload.displayName !== undefined) ownerFields.display_name = payload.displayName;
  if (payload.status !== undefined) ownerFields.status = payload.status;
  if (payload.roleCode !== undefined && VALID_ADMIN_ROLES.indexOf(payload.roleCode) !== -1) ownerFields.role_code = payload.roleCode;
  if (payload.tenantId !== undefined) ownerFields.tenant_id = payload.tenantId;
  centralUpdate('admin_users', payload.id, ownerFields);
  return { success: true };
}

// admin คนหนึ่งรีเซ็ตรหัสผ่านให้อีกคน (ลืมรหัส) — payload: { id, newPassword }
function resetAdminUserPasswordByAdmin(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  var target = _adminUserRow(payload.id);
  if (!target) return { success: false, message: 'ไม่พบผู้ใช้นี้' };
  var effTenantId = _effectiveTenantId(session, payload);
  if (effTenantId && String(target.tenant_id) !== String(effTenantId)) {
    return { success: false, message: 'ไม่มีสิทธิ์รีเซ็ตรหัสผ่านบัญชีของตัวแทนอื่น' };
  }
  if (!effTenantId && target.role_code === 'super_admin') {
    return { success: false, message: 'รีเซ็ตรหัสผ่านบัญชี super_admin ได้เฉพาะผ่าน Apps Script Editor เท่านั้น' };
  }
  var newPassword = String(payload.newPassword || '');
  if (newPassword.length < 8) return { success: false, message: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' };

  var salt = Utilities.getUuid();
  centralUpdate('admin_users', payload.id, { salt: salt, password_hash: _hashPassword(newPassword, salt) });
  return { success: true };
}

// ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง — payload: { currentPassword, newPassword }
function changeMyPassword(session, payload) {
  var target = _adminUserRow(session.adminUserId);
  if (!target) return { success: false, message: 'ไม่พบบัญชีผู้ใช้' };
  if (_hashPassword(String(payload.currentPassword || ''), target.salt) !== target.password_hash) {
    return { success: false, message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' };
  }
  var newPassword = String(payload.newPassword || '');
  if (newPassword.length < 8) return { success: false, message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร' };

  var salt = Utilities.getUuid();
  centralUpdate('admin_users', session.adminUserId, { salt: salt, password_hash: _hashPassword(newPassword, salt) });
  return { success: true };
}
