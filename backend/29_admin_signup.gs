/**
 * ===================== ลงทะเบียนผู้ใช้ใหม่ + รออนุมัติ (Admin App) =====================
 * กติกาของเจ้าของระบบ (2026-09-24): **ผู้ใช้ใหม่ของทุกแอปต้องเลือกสังกัดก่อน และรอผู้ดูแลระบบอนุมัติเสมอ**
 *   - แอปมือถือ (LIFF): มีอยู่แล้วใน 04_auth.gs — registerUser() เลือกตัวแทน → status 'No' → แอดมินอนุมัติ
 *     ที่เมนู "พนักงานขาย" (updateStaffAdmin ใน 10_master_data.gs)
 *   - แอปแอดมิน: ไฟล์นี้ — สมัครเองจากหน้าล็อกอิน → บัญชีสถานะ 'pending' **ไม่มีบทบาท (role_code ว่าง)**
 *     จึงยังล็อกอินไม่ได้และไม่มีสิทธิ์ใดๆ จนกว่าผู้ดูแลจะกดอนุมัติพร้อมกำหนดบทบาท
 *
 * สถานะของ admin_users: active (ใช้งานได้) · pending (รออนุมัติ) · rejected (ถูกปฏิเสธ) · อื่นๆ = ถูกระงับ
 *
 * **ทุกบัญชีผูกกับ LINE user id เสมอ** (กติกาเจ้าของระบบ 2026-09-24) — ใช้ LINE user id เป็นตัวตนกลางของทุกแอป
 * บัญชีแอดมิน 1 บัญชี = LINE user id 1 ค่า (ซ้ำกันไม่ได้) และเป็นค่าเดียวกับที่ใช้เข้าแอปมือถือ
 *
 * สายอนุมัติตามลำดับชั้น:
 *   - ขอเป็น "แอดมินของตัวแทนจำหน่าย" (สังกัดเป็นตัวแทน) → **Ultra Admin (super_admin) อนุมัติเท่านั้น**
 *   - ขอเป็นผู้ใช้ของบริษัทเจ้าของสินค้า → Ultra Admin หรือแอดมินฝั่งบริษัทที่มีสิทธิ์ users_roles แก้ไข
 *   - พนักงานของตัวแทน (ผู้ใช้แอปมือถือใน liff_users) → **แอดมินของตัวแทนนั้นอนุมัติเอง**
 *     ที่เมนู "พนักงานขาย" (updateStaffAdmin ใน 10_master_data.gs) — ไม่ผ่านไฟล์นี้
 */
var ADMIN_STATUS_ACTIVE = 'active', ADMIN_STATUS_PENDING = 'pending', ADMIN_STATUS_REJECTED = 'rejected';

/** LINE user id ของจริงเป็น 'U' + hex 32 ตัว — กันพิมพ์ชื่อเล่น/เบอร์โทรมาใส่ */
function isLineUserId(v) { return /^U[0-9a-f]{32}$/i.test(String(v || '').trim()); }

/** บัญชีแอดมินที่ผูกกับ LINE id นี้ (ถ้ามี) */
function _adminByLineId(lineUserId) {
  var rows = centralObjects('admin_users');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].line_user_id || '').toLowerCase() === String(lineUserId || '').toLowerCase()) return rows[i];
  }
  return null;
}

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

  // ตัวตนกลางของทุกแอป — ต้องมีและต้องไม่ซ้ำกับบัญชีอื่น
  var lineUserId = String(payload.lineUserId || '').trim();
  if (!lineUserId) return { success: false, message: 'กรุณากรอก LINE User ID (ดูได้จากแอปมือถือของระบบ หน้า "รออนุมัติ")' };
  if (!isLineUserId(lineUserId)) return { success: false, message: 'รูปแบบ LINE User ID ไม่ถูกต้อง (ต้องขึ้นต้นด้วย U ตามด้วยตัวอักษร/ตัวเลข 32 ตัว)' };

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
    var dupLine = _adminByLineId(lineUserId);
    if (dupLine) return { success: false, message: 'LINE นี้ผูกกับบัญชี "' + dupLine.username + '" อยู่แล้ว (1 LINE = 1 บัญชี)' };
    var salt = Utilities.getUuid();
    centralAppend('admin_users', {
      record_id: centralNextId('admin_users'), username: username,
      password_hash: _hashPassword(password, salt), salt: salt,
      display_name: displayName, role_code: '', tenant_id: tenantId,
      status: ADMIN_STATUS_PENDING, created_at: nowStr(), line_user_id: lineUserId
    });
    return { success: true, pending: true,
      message: 'ลงทะเบียนแล้ว — รอผู้ดูแลระบบอนุมัติและกำหนดสิทธิ์ก่อนจึงจะเข้าใช้งานได้' };
  } finally { lock.releaseLock(); }
}

// ── ฝั่งผู้ดูแล: คิวคำขอที่รออนุมัติ ──
/**
 * คำขอที่ผู้เรียก "อนุมัติได้จริง" เท่านั้น (ไม่โชว์สิ่งที่กดไม่ได้ให้สับสน)
 *   super_admin → ทุกคำขอ · ฝั่งบริษัท → เฉพาะคำขอเข้าบริษัท · ฝั่งตัวแทน → ไม่มี (อนุมัติพนักงานที่เมนูพนักงานขาย)
 */
function _pendingScopeRows(session, payload) {
  var isSuper = session && session.role_code === 'super_admin';
  var effTenantId = _effectiveTenantId(session, payload || {});
  if (!isSuper && effTenantId) return [];
  return centralObjects('admin_users').filter(function(u) {
    if (String(u.status) !== ADMIN_STATUS_PENDING) return false;
    return isSuper ? true : String(u.tenant_id || '') === '';
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
      lineUserId: u.line_user_id || '',
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

  // ขอเป็นแอดมินของตัวแทน = Ultra Admin เท่านั้นที่อนุมัติได้ (แอดมินตัวแทนอนุมัติได้แค่พนักงานของตัวเองในแอปมือถือ)
  if (String(target.tenant_id || '') && session.role_code !== 'super_admin') {
    return { success: false, message: 'คำขอเป็นแอดมินของตัวแทนจำหน่าย ต้องให้ Ultra Admin เป็นผู้อนุมัติ' };
  }
  var effTenantId = _effectiveTenantId(session, payload);
  if (effTenantId && session.role_code !== 'super_admin') {
    return { success: false, message: 'ไม่มีสิทธิ์อนุมัติคำขอนี้' };
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
  if (String(target.tenant_id || '') && session.role_code !== 'super_admin') {
    return { success: false, message: 'คำขอเป็นแอดมินของตัวแทนจำหน่าย ต้องให้ Ultra Admin เป็นผู้ดำเนินการ' };
  }
  centralUpdate('admin_users', target.record_id, { status: ADMIN_STATUS_REJECTED });
  return { success: true, message: 'ปฏิเสธคำขอของ ' + target.display_name + ' แล้ว' };
}

/**
 * ผูก/แก้ LINE user id ของบัญชีแอดมิน — payload: { id | username, lineUserId }
 * Ultra Admin เท่านั้น (ตัวตนกลางของทุกแอป เปลี่ยนมั่วไม่ได้) · ส่ง lineUserId ว่าง = ยกเลิกการผูก
 */
function linkAdminLineId(session, payload) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  payload = payload || {};
  var target = payload.id ? _adminUserRow(payload.id) : null;
  if (!target && payload.username) {
    centralObjects('admin_users').forEach(function(u) {
      if (String(u.username).toLowerCase() === String(payload.username).toLowerCase()) target = u;
    });
  }
  if (!target) return { success: false, message: 'ไม่พบบัญชีผู้ใช้นี้' };

  var lineUserId = String(payload.lineUserId || '').trim();
  if (lineUserId) {
    if (!isLineUserId(lineUserId)) return { success: false, message: 'รูปแบบ LINE User ID ไม่ถูกต้อง' };
    var dup = _adminByLineId(lineUserId);
    if (dup && String(dup.record_id) !== String(target.record_id)) {
      return { success: false, message: 'LINE นี้ผูกกับบัญชี "' + dup.username + '" อยู่แล้ว (1 LINE = 1 บัญชี)' };
    }
  }
  centralUpdate('admin_users', target.record_id, { line_user_id: lineUserId });
  return { success: true, message: lineUserId ? ('ผูก LINE กับบัญชี ' + target.username + ' แล้ว') : ('ยกเลิกการผูก LINE ของบัญชี ' + target.username + ' แล้ว'),
    user: { id: target.record_id, username: target.username, lineUserId: lineUserId } };
}

/* ═══════════ สมัครด้วยตัวตน LINE ที่ยืนยันแล้ว (ไม่มีรหัสผ่าน) ═══════════
 * กติกาเจ้าของระบบ 2026-09-24: "ยืนยันตัวตนกับ LINE สำเร็จแล้ว ไม่จำเป็นต้องตั้งรหัสในระบบซ้ำซ้อน"
 * ผู้ใช้กดปุ่มเข้าสู่ระบบด้วย LINE → ยังไม่มีบัญชี → ได้ signupTicket (อายุ 15 นาที ใช้ครั้งเดียว)
 * → ส่งกลับมาที่นี่พร้อม "สังกัด" ที่เลือก → ได้บัญชีสถานะ pending ที่ผูก LINE id ไว้แล้ว รอผู้ดูแลอนุมัติ
 * ชื่อผู้ใช้ตั้งต้น = ชื่อที่แสดงใน LINE (แก้ทีหลังได้) · username สร้างให้อัตโนมัติ ไม่ให้ซ้ำ
 */
var SIGNUP_TICKET_PREFIX = 'signupticket_';

function _uniqueUsername(base, lineUserId) {
  var slug = String(base || '').trim().replace(/\s+/g, '.').replace(/[^0-9A-Za-z\u0E00-\u0E7F._-]/g, '').slice(0, 24);
  if (slug.length < 3) slug = 'line.' + String(lineUserId || '').substring(1, 9);
  var taken = {};
  centralObjects('admin_users').forEach(function(u) { taken[String(u.username).toLowerCase()] = true; });
  if (!taken[slug.toLowerCase()]) return slug;
  for (var i = 2; i < 100; i++) if (!taken[(slug + '.' + i).toLowerCase()]) return slug + '.' + i;
  return slug + '.' + String(Date.now()).slice(-5);
}

/** payload: { signupTicket, tenantId ('' = บริษัทเจ้าของสินค้า), displayName? } */
function registerAdminUserWithLine(payload) {
  payload = payload || {};
  var ticket = String(payload.signupTicket || '').trim();
  if (!ticket) return { success: false, message: 'ไม่พบตั๋วลงทะเบียน กรุณากด "เข้าสู่ระบบด้วย LINE" ใหม่' };

  var cache = CacheService.getScriptCache();
  var raw = cache.get(SIGNUP_TICKET_PREFIX + ticket);
  if (!raw) return { success: false, message: 'ตั๋วลงทะเบียนหมดอายุแล้ว กรุณากด "เข้าสู่ระบบด้วย LINE" ใหม่อีกครั้ง' };
  var tk; try { tk = JSON.parse(raw); } catch (e) { tk = null; }
  if (!tk || !isLineUserId(tk.lineUserId)) return { success: false, message: 'ตั๋วลงทะเบียนไม่ถูกต้อง' };

  var tenantId = String(payload.tenantId || '').trim();
  if (tenantId && !_activeTenantRow(tenantId)) return { success: false, message: 'ไม่พบตัวแทนจำหน่ายที่เลือก (หรือถูกปิดการใช้งานอยู่)' };
  var displayName = String(payload.displayName || tk.displayName || '').trim();
  if (!displayName) return { success: false, message: 'กรุณาระบุชื่อผู้ใช้' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอยู่ ลองใหม่อีกครั้ง' };
  try {
    var dup = _adminByLineId(tk.lineUserId);
    if (dup) return { success: false, message: 'LINE นี้ผูกกับบัญชี "' + dup.username + '" อยู่แล้ว — กดเข้าสู่ระบบด้วย LINE ได้เลย' };
    var username = _uniqueUsername(displayName, tk.lineUserId);
    centralAppend('admin_users', {
      record_id: centralNextId('admin_users'), username: username,
      password_hash: '', salt: '',                    // ไม่มีรหัสผ่าน — เข้าระบบด้วย LINE เท่านั้น
      display_name: displayName, role_code: '', tenant_id: tenantId,
      status: ADMIN_STATUS_PENDING, created_at: nowStr(), line_user_id: tk.lineUserId
    });
    cache.remove(SIGNUP_TICKET_PREFIX + ticket);      // ตั๋วใช้ได้ครั้งเดียว
    return { success: true, pending: true, username: username,
      message: 'ลงทะเบียนแล้วในชื่อ "' + displayName + '" — รอผู้ดูแลระบบอนุมัติและกำหนดสิทธิ์ ครั้งต่อไปกดเข้าสู่ระบบด้วย LINE ได้เลย' };
  } finally { lock.releaseLock(); }
}
