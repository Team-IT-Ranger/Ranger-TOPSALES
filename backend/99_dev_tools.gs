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

// สินค้าที่สร้างไว้ก่อนมีฟิลด์ product_code (เพิ่มเข้ามาทีหลัง) จะไม่มีรหัส — ช่อง "รหัสสินค้า" ในตาราง
// ขึ้น "-" ว่างเปล่า รันตัวนี้ครั้งเดียวเพื่อตั้งรหัสอัตโนมัติให้ทุกแถวที่ยังไม่มี (รูปแบบ P0001, P0002, ...
// เรียงตาม record_id) กันไม่ให้ว่างเฉยๆ เท่านั้น — อยากได้รหัสที่มีความหมายกว่านี้ ไปแก้เองทีหลังได้
// ผ่านหน้า "แก้ไขสินค้า" ในแอป (ระบบเช็ค unique ให้อัตโนมัติ กันตั้งชนกัน)
function backfillMissingProductCodes() {
  var sh = centralSheet('products');
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var codeCol = headers.indexOf('product_code');
  var idCol = headers.indexOf('record_id');
  if (codeCol === -1) { Logger.log('ยังไม่มีคอลัมน์ product_code ใน Sheet — รัน setupCentralSheet() ก่อน แล้วค่อยรันตัวนี้'); return; }

  var filled = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === '' || data[i][idCol] === null) continue; // ข้ามแถวว่างสนิท
    if (String(data[i][codeCol] || '').trim() !== '') continue;     // มีรหัสอยู่แล้ว ไม่แตะ
    var code = 'P' + ('0000' + data[i][idCol]).slice(-4);
    sh.getRange(i + 1, codeCol + 1).setValue(code);
    filled++;
    Logger.log('ตั้งรหัส ' + code + ' ให้สินค้า record_id=' + data[i][idCol]);
  }
  Logger.log(filled
    ? ('✅ ตั้งรหัสอัตโนมัติให้ ' + filled + ' รายการ — เข้าไปแก้เป็นรหัสที่มีความหมายทีหลังได้ผ่านหน้าแก้ไขสินค้าในแอป')
    : 'ไม่มีสินค้ารายการไหนขาดรหัส — ไม่ต้องทำอะไรเพิ่ม');
}

// ══════ สร้างสภาพแวดล้อม UAT ครั้งแรก (รันใน Apps Script โปรเจกต์ "TOPSHOP Backend UAT" เท่านั้น) ══════
// UAT ต้องแยกจาก production เด็ดขาด: คนละโปรเจกต์ Apps Script + คนละ Central Sheet + คนละ Tenant Sheet
// ผู้ใช้จริงจึงไม่โดนกระทบเวลาเราทดสอบ/แก้แอป — ฟังก์ชันนี้สร้าง Central Sheet ใหม่ให้เอง ตั้ง Script Properties
// สร้างตารางทั้งหมด และสร้าง super_admin ตั้งต้นของ UAT (ดูผลที่ Logs)
// กันพลาด: ถ้าโปรเจกต์นี้มี CENTRAL_SHEET_FILEID อยู่แล้ว (เช่น เผลอรันใน production) จะไม่ทำอะไรเลย
function setupUatEnvironment() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CENTRAL_SHEET_FILEID')) {
    Logger.log('❌ หยุด: โปรเจกต์นี้ตั้ง CENTRAL_SHEET_FILEID ไว้แล้ว (' + props.getProperty('ENV_NAME') + ') — ไม่สร้างซ้ำ กันไปแตะข้อมูลเดิม');
    return;
  }
  var ss = SpreadsheetApp.create('TOPSHOP UAT — Central Sheet');
  props.setProperties({ CENTRAL_SHEET_FILEID: ss.getId(), ENV_NAME: 'uat' });
  Logger.log('สร้าง Central Sheet UAT แล้ว: ' + ss.getUrl());

  setupCentralSheet();
  createFirstSuperAdmin();
  Logger.log('✅ UAT พร้อมใช้ — Central Sheet: ' + ss.getUrl() + ' | login: admin / ChangeMe123! (เปลี่ยนรหัสหลังเข้าได้)');
  Logger.log('ขั้นต่อไป: Deploy → New deployment → Web app (Execute as: Me, Anyone) แล้วส่ง URL ที่ได้ให้ตั้งเป็น BACKEND_URL_UAT');
}

// เรียกทดสอบว่าเชื่อม Central Sheet ได้ปกติหรือไม่
function testCentralConnection() {
  var sheet = centralSheet('liff_users');
  Logger.log('เชื่อมต่อ Central Sheet สำเร็จ: ' + sheet.getName());
}
