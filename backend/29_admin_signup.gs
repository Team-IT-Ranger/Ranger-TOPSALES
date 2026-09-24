/**
 * ===================== ลงทะเบียนผู้ใช้ใหม่ + รออนุมัติ (Admin App) =====================
 * กติกาของเจ้าของระบบ (2026-09-24): **ผู้ใช้ใหม่ของทุกแอปต้องเลือกสังกัดก่อน และรอผู้ดูแลระบบอนุมัติเสมอ**
 *   - แอปมือถือ (LIFF): มีอยู่แล้วใน 04_auth.gs — registerUser() เลือกตัวแทน → status 'No' → แอดมินอนุมัติ
 *     ที่เมนู "พนักงานขาย" (updateStaffAdmin ใน 10_master_data.gs)
 *   - แอปแอดมิน: ไฟล์นี้ — สมัครเองจากหน้าล็อกอิน → บัญชีสถานะ 'pending' **ไม่มีบทบาท (role_code ว่าง)**
 *     จึงยังล็อกอินไม่ได้และไม่มีสิทธิ์ใดๆ จนกว่าผู้ดูแลจะกดอนุมัติพร้อมกำหนดบทบาท
 *
 * สถานะของ admin_users: active (ใช้งานได้) · pending (รออนุมัติ) · rejected (ถูกปฏิเสธ) · อื่นๆ = ถูกระงับ
 * การอนุมัติใช้ resolveAssignableRole() เหมือนตอนสร้างบัญชีเอง — แอดมินตัวแทนจึงอนุมัติได้เฉพาะคนที่ขอเข้า
 * ตัวแทนของตัวเอง และให้บทบาทเกินสิทธิ์ตัวเองไม่ได้ (ดู 26_roles.gs)
 */
var ADMIN_STATUS_ACTIVE = 'active', ADMIN_STATUS_PENDING = 'pending', ADMIN_STATUS_REJECTED = 'rejected';

function _activeTenantRow(tenantId) {
  var rows = centralObjects('tenants');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tenant_id) === String(tenantId)) return isFlagOn(rows[i].is_active) ? rows[i] : null;
  }
  return null;
}

/**
 * Public (ยังไม่ล็อกอิน) — payload: { username, password, displayName, tenantId ('' = บริษัทเจ้าของสินค้า) }
 * ได้บัญชีสถานะ pending เสมอ · ไม่คืนข้อมูลผู้ใช้เดิมในระบบออกไป (กันใช้เดาว่ามี username ไหนอยู่บ้างมากกว่าที่จำเป็น)
 */
function registerAdminUser(payload) {
  payload = payload || {};
  var username = String(payload.username || '').trim();
  var password = String(payload.password || '');
  var displayName = String(payload.displayName || '').trim();
  if (!username || !password || !displayName) return { success: false, message: 'กรุณากรอกชื่อ-สกุล / username / รหัสผ่านให้ครบ' };
  if (username.length < 4) return { success: false, message: 'username ต้องยาวอย่างน้อย 4 ตัวอักษร' };
  if (password.length < 8) return { success: false, message: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' };

  var tenantId = String(payload.tenantId || '').trim();
  if (tenantId && !_activeTenantRow(tenantId)) return { success: false, message: 'ไม่พบตัวแทนจำหน่ายที่เลือก (หรือถูกปิดการใช้งานอยู่)' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอยู่ ลองใหม่อีกครั้ง' };
  try {
    var existing = centralObjects('admin_users');
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].username).toLowerCase() === username.toLowerCase()) {
        var st = String(existing[i].status);
        return { success: false, message: st === ADMIN_STATUS_PENDING ? 'username นี้ลงทะเบียนไว้แล้ว กำลังรอผู้ดูแลระบบอนุมัติ' : 'username นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น' };
      }
    }
    var salt = Utilities.getUuid();
    centralAppend('admin_users', {
      record_id: centralNextId('admin_users'), username: username,
      password_hash: _hashPassword(password, salt), salt: salt,
      display_name: displayName, role_code: '', tenant_id: tenantId,
      status: ADMIN_STATUS_PENDING, created_at: nowStr()
    });
    return { success: true, pending: true,
      message: 'ลงทะเบียนแล้ว — รอผู้ดูแลระบบอนุมัติและกำหนดสิทธิ์ก่อนจึงจะเข้าใช้งานได้' };
  } finally { lock.releaseLock(); }
}

// ── ฝั่งผู้ดูแล: คิวคำขอที่รออนุมัติ ──
function _pendingScopeRows(session, payload) {
  var effTenantId = _effectiveTenantId(session, payload || {});
  return centralObjects('admin_users').filter(function(u) {
    if (String(u.status) !== ADMIN_STATUS_PENDING) return false;
    return effTenantId ? String(u.tenant_id || '') === String(effTenantId) : true;
  });
}

function listPendingAdminUsers(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'view'); if (err) return err;
  var tenantNames = {};
  centralObjects('tenants').forEach(function(t) { tenantNames[String(t.tenant_id)] = t.name; });
  return { success: true, data: _pendingScopeRows(session, payload).map(function(u) {
    return { id: u.record_id, username: u.username, displayName: u.display_name,
      tenantId: u.tenant_id || '',
      tenantName: u.tenant_id ? (tenantNames[String(u.tenant_id)] || u.tenant_id)
        : (typeof _companyName === 'function' ? _companyName() : 'บริษัทเจ้าของสินค้า'),   // ชื่อบริษัทจาก 25_company.gs
      requestedAt: safeDateStr(u.created_at) };
  }) };
}

// payload: { id, roleCode } — อนุมัติพร้อมกำหนดบทบาท (บังคับเลือก ไม่มีค่าเริ่มต้นให้เผลออนุมัติสิทธิ์เกิน)
function approveAdminUser(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  payload = payload || {};
  var target = _adminUserRow(payload.id);
  if (!target) return { success: false, message: 'ไม่พบคำขอนี้' };
  if (String(target.status) !== ADMIN_STATUS_PENDING) return { success: false, message: 'คำขอนี้ถูกดำเนินการไปแล้ว (สถานะ: ' + target.status + ')' };

  var effTenantId = _effectiveTenantId(session, payload);
  if (effTenantId && String(target.tenant_id || '') !== String(effTenantId)) {
    return { success: false, message: 'ไม่มีสิทธิ์อนุมัติคำขอของตัวแทนอื่น' };
  }
  var roleCode = resolveAssignableRole(session, String(payload.roleCode || ''), String(target.tenant_id || ''));
  if (!roleCode) return { success: false, message: 'กรุณาเลือกบทบาทที่ถูกต้องให้ผู้ใช้รายนี้ (กำหนด super_admin ผ่านหน้าจอไม่ได้)' };

  centralUpdate('admin_users', target.record_id, { status: ADMIN_STATUS_ACTIVE, role_code: roleCode });
  return { success: true, message: 'อนุมัติ ' + target.display_name + ' แล้ว (บทบาท: ' + roleCode + ')' };
}

// payload: { id } — ปฏิเสธคำขอ (เก็บแถวไว้เป็นประวัติ ไม่ลบทิ้ง) · สมัครใหม่ด้วย username เดิมไม่ได้
function rejectAdminUser(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  var target = _adminUserRow((payload || {}).id);
  if (!target) return { success: false, message: 'ไม่พบคำขอนี้' };
  if (String(target.status) !== ADMIN_STATUS_PENDING) return { success: false, message: 'คำขอนี้ถูกดำเนินการไปแล้ว' };
  var effTenantId = _effectiveTenantId(session, payload || {});
  if (effTenantId && String(target.tenant_id || '') !== String(effTenantId)) {
    return { success: false, message: 'ไม่มีสิทธิ์ปฏิเสธคำขอของตัวแทนอื่น' };
  }
  centralUpdate('admin_users', target.record_id, { status: ADMIN_STATUS_REJECTED });
  return { success: true, message: 'ปฏิเสธคำขอของ ' + target.display_name + ' แล้ว' };
}
