/**
 * ===================== DEV TOOLS (Apps Script Editor เท่านั้น) =====================
 * ห้ามลงทะเบียนใน ACTION_MAP / ADMIN_ACTION_MAP เด็ดขาด — รันจาก Editor โดยตรงเท่านั้น
 * (createFirstSuperAdmin สร้างบัญชีที่ bypass การเช็คสิทธิ์ทั้งหมด ถ้าเปิดผ่าน API จะอันตรายมาก)
 */

// รันครั้งเดียวหลัง setupCentralSheet() เพื่อสร้างแอดมินคนแรกเข้า Admin App ได้
// แก้ 3 ค่าด้านล่างก่อน Run
function createFirstSuperAdmin() {
  var username = 'admin';           // ← แก้ก่อน Run
  var password = 'ChangeMe123!';    // ← แก้ก่อน Run แล้วรีบเปลี่ยนหลัง login ครั้งแรก
  var displayName = 'System Admin'; // ← แก้ก่อน Run

  var existing = centralObjects('admin_users');
  if (existing.some(function(u) { return String(u.username).toLowerCase() === username.toLowerCase(); })) {
    Logger.log('มี username นี้อยู่แล้ว: ' + username);
    return;
  }

  var salt = Utilities.getUuid();
  centralAppend('admin_users', {
    record_id: centralNextId('admin_users'),
    username: username,
    password_hash: _hashPassword(password, salt),
    salt: salt,
    display_name: displayName,
    role_code: 'super_admin',
    tenant_id: '',
    status: 'active',
    created_at: nowStr()
  });
  Logger.log('✅ สร้าง super_admin สำเร็จ: ' + username + ' — เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านทันที');
}

// สร้างแอดมินระดับตัวแทน 1 คน — ผูกกับ tenant_id ที่ระบุ
function createTenantAdmin(tenantId, username, password, displayName) {
  var existing = centralObjects('admin_users');
  if (existing.some(function(u) { return String(u.username).toLowerCase() === String(username).toLowerCase(); })) {
    Logger.log('มี username นี้อยู่แล้ว: ' + username);
    return;
  }
  var salt = Utilities.getUuid();
  centralAppend('admin_users', {
    record_id: centralNextId('admin_users'),
    username: username,
    password_hash: _hashPassword(password, salt),
    salt: salt,
    display_name: displayName,
    role_code: 'tenant_admin',
    tenant_id: tenantId,
    status: 'active',
    created_at: nowStr()
  });
  Logger.log('✅ สร้าง tenant_admin สำเร็จ: ' + username + ' (tenant: ' + tenantId + ')');
}

// ลืม username/password แล้วนึกไม่ออก — รันตัวนี้ดูรายชื่อ username ที่มีอยู่ทั้งหมดก่อน
// (ดูผลได้ที่ View → Logs หรือ Ctrl+Enter หลังรัน) รหัสผ่านกู้คืนไม่ได้เพราะเก็บเป็น hash
// ต้องใช้ resetAdminPasswordDev() ตั้งรหัสใหม่แทน
function listAdminUsernamesForRecovery() {
  var rows = centralObjects('admin_users');
  if (!rows.length) { Logger.log('ยังไม่มี admin_users เลย — รัน createFirstSuperAdmin() ก่อน'); return; }
  rows.forEach(function(u) {
    Logger.log(u.username + '  |  role=' + u.role_code + '  |  tenant=' + (u.tenant_id || '(บริษัท)') + '  |  status=' + u.status);
  });
}

// ลืมรหัสผ่าน — ตั้งรหัสใหม่ให้ username ที่มีอยู่แล้ว (ไม่สร้างบัญชีใหม่)
// แก้ 2 ค่าด้านล่างก่อน Run แล้วรีบเปลี่ยนรหัสผ่านเองในแอปหลัง login เข้าได้แล้ว
function resetAdminPasswordDev() {
  var username = 'admin';            // ← แก้เป็น username จริงที่จะรีเซ็ต
  var newPassword = 'ChangeMe123!';  // ← ตั้งรหัสผ่านใหม่ตรงนี้

  var sh = centralSheet('admin_users');
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var userCol = headers.indexOf('username');
  var hashCol = headers.indexOf('password_hash');
  var saltCol = headers.indexOf('salt');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][userCol]).toLowerCase() === username.toLowerCase()) {
      var salt = Utilities.getUuid();
      sh.getRange(i + 1, saltCol + 1).setValue(salt);
      sh.getRange(i + 1, hashCol + 1).setValue(_hashPassword(newPassword, salt));
      Logger.log('✅ ตั้งรหัสผ่านใหม่ให้ ' + username + ' สำเร็จ — เข้าสู่ระบบแล้วรีบเปลี่ยนรหัสผ่าน');
      return;
    }
  }
  Logger.log('ไม่พบ username: ' + username + ' — ลองรัน listAdminUsernamesForRecovery() ดูชื่อที่มีอยู่ก่อน');
}

// เรียกทดสอบว่าเชื่อม Central Sheet ได้ปกติหรือไม่
function testCentralConnection() {
  var sheet = centralSheet('liff_users');
  Logger.log('เชื่อมต่อ Central Sheet สำเร็จ: ' + sheet.getName());
}
