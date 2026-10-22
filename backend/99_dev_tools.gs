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

/* ═══════════ กู้คืนการเข้าสู่ระบบด้วย LINE ═══════════
 * อาการ: กด "เข้าสู่ระบบด้วย LINE" แล้วระบบพาไปหน้าลงทะเบียนใหม่ทุกครั้ง (หรือบอกว่ารออนุมัติ)
 * สาเหตุที่พบบ่อยที่สุด: **ยังไม่มีบัญชีแอดมินแถวไหนที่คอลัมน์ line_user_id เป็น LINE id นั้น**
 *   - createFirstSuperAdmin() / setupProductionEnvironment() สร้างบัญชีโดย "ไม่ได้" ผูก LINE ให้
 *   - ผูกผ่านหน้าเว็บ (linkAdminLineId) ต้องล็อกอินเป็น Ultra Admin ก่อน ซึ่งเข้าไม่ได้อยู่แล้ว = ไก่กับไข่
 * จึงต้องผูกจาก editor หนึ่งครั้ง (รันในนามเจ้าของโปรเจกต์ ไม่ต้องมี session)
 *
 * วิธีใช้: เลือกฟังก์ชัน diagnoseLineLogin → Run (ดูก่อนว่าเป็นอะไร) แล้วค่อย bindAdminLineId → Run
 * ดูผลที่ Execution log (Ctrl+Enter)
 */

// แก้ 2 ค่านี้ก่อน Run — ใช้ร่วมกันทั้ง diagnoseLineLogin() และ bindAdminLineId()
var FIX_LINE_USER_ID = 'U94dedbdbc8da0378b4762e2e35a73c99';   // ← LINE user id ที่จะผูก
var FIX_ADMIN_USERNAME = '';   // ← username ที่จะผูกให้ · เว้นว่าง = บัญชี super_admin แถวแรกที่เจอ

/** รายงานอย่างเดียว ไม่แก้อะไร — บอกให้ครบว่าทำไมล็อกอินด้วย LINE ไม่ผ่าน */
function diagnoseLineLogin() {
  ensureSchemaCurrent();   // กันกรณีชีตยังไม่มีคอลัมน์ line_user_id (เพิ่มเข้ามาทีหลัง)
  var headers = centralSheet('admin_users').getRange(1, 1, 1, centralSheet('admin_users').getLastColumn()).getValues()[0];
  Logger.log('สภาพแวดล้อม: ENV_NAME=' + (_envName() || '(ไม่ได้ตั้ง = prod)'));
  Logger.log('คอลัมน์ line_user_id ในชีต admin_users: ' + (headers.indexOf('line_user_id') >= 0 ? 'มี' : '❌ ไม่มี — รัน setupCentralSheet() ก่อน'));

  var rows = centralObjects('admin_users');
  Logger.log('บัญชีแอดมินทั้งหมด ' + rows.length + ' บัญชี:');
  rows.forEach(function(u) {
    Logger.log('  ' + String(u.username) + ' | role=' + (u.role_code || '(ยังไม่มีบทบาท)') +
      ' | tenant=' + (u.tenant_id || '(บริษัท)') + ' | status=' + u.status +
      ' | LINE=' + (u.line_user_id ? u.line_user_id : '(ยังไม่ผูก)') +
      ' | รหัสผ่าน=' + (String(u.password_hash || '').trim() ? 'มี' : 'ไม่มี (ล็อกอินได้ทาง LINE เท่านั้น)'));
  });

  var target = _adminByLineId(FIX_LINE_USER_ID);
  if (!target) {
    Logger.log('❌ ไม่มีบัญชีไหนผูกกับ ' + FIX_LINE_USER_ID + ' — นี่คือสาเหตุ: หน้าเว็บจึงพาไปลงทะเบียนใหม่');
    Logger.log('   แก้ด้วยการ Run ฟังก์ชัน bindAdminLineId()');
    return;
  }
  Logger.log('พบบัญชีที่ผูกไว้แล้ว: ' + target.username);
  var gate = _adminAccountGate(target);
  Logger.log(gate ? ('❌ แต่ยังเข้าไม่ได้เพราะ: ' + gate.message) : '✅ บัญชีนี้เข้าใช้งานได้ตามปกติ — ถ้ายังเข้าไม่ได้ ปัญหาอยู่ฝั่งหน้าเว็บ/เบราว์เซอร์');
}

/** ผูก LINE id เข้ากับบัญชีแอดมิน แล้วเปิดใช้งานบัญชีนั้นให้พร้อมเข้าระบบ */
function bindAdminLineId() {
  ensureSchemaCurrent();
  var lineId = String(FIX_LINE_USER_ID || '').trim();
  if (!isLineUserId(lineId)) { Logger.log('❌ รูปแบบ LINE user id ไม่ถูกต้อง (ต้องเป็น U ตามด้วย hex 32 ตัว): ' + lineId); return; }

  var rows = centralObjects('admin_users');
  if (!rows.length) { Logger.log('❌ ยังไม่มีบัญชีแอดมินเลย — รัน createFirstSuperAdmin() ก่อน'); return; }

  var target = null;
  if (FIX_ADMIN_USERNAME) {
    rows.forEach(function(u) { if (String(u.username).toLowerCase() === String(FIX_ADMIN_USERNAME).toLowerCase()) target = u; });
    if (!target) { Logger.log('❌ ไม่พบ username: ' + FIX_ADMIN_USERNAME + ' — Run diagnoseLineLogin() ดูรายชื่อที่มีอยู่'); return; }
  } else {
    rows.forEach(function(u) { if (!target && String(u.role_code) === 'super_admin') target = u; });
    if (!target) { Logger.log('❌ ไม่มีบัญชี super_admin ในระบบ — ระบุ FIX_ADMIN_USERNAME เอง หรือรัน createFirstSuperAdmin()'); return; }
  }

  var dup = _adminByLineId(lineId);
  if (dup && String(dup.record_id) !== String(target.record_id)) {
    Logger.log('❌ LINE นี้ผูกกับบัญชี "' + dup.username + '" อยู่แล้ว (1 LINE = 1 บัญชี) — ยกเลิกของเดิมก่อน');
    return;
  }

  // ผูก LINE + ทำให้บัญชีพร้อมใช้งานจริง (เครื่องมือกู้คืนสำหรับเจ้าของระบบ จึงเปิดสถานะให้ด้วยถ้ายังค้าง)
  var patch = { line_user_id: lineId };
  var notes = [];
  if (String(target.status) !== ADMIN_STATUS_ACTIVE) { patch.status = ADMIN_STATUS_ACTIVE; notes.push('เปลี่ยนสถานะจาก "' + target.status + '" เป็น active'); }
  if (!String(target.role_code || '').trim()) { patch.role_code = 'super_admin'; notes.push('ตั้งบทบาทเป็น super_admin (เดิมว่าง)'); }
  centralUpdate('admin_users', target.record_id, patch);
  centralInvalidate('admin_users');

  Logger.log('✅ ผูก ' + lineId + ' เข้ากับบัญชี "' + target.username + '" แล้ว');
  notes.forEach(function(n) { Logger.log('   · ' + n); });
  var after = _adminByLineId(lineId);
  Logger.log(after ? '   ตรวจซ้ำแล้วอ่านกลับมาได้จริง — กด "เข้าสู่ระบบด้วย LINE" ที่หน้าแอดมินได้เลย'
                   : '   ⚠️ เขียนแล้วแต่อ่านกลับไม่เจอ — ตรวจว่าชีต admin_users มีคอลัมน์ line_user_id จริงไหม');
}

// เติม tab/คอลัมน์ที่ขาดให้ไฟล์ของตัวแทนทุกราย — ตัวเดียวกับปุ่ม "ปรับสคีมาไฟล์ตัวแทน" ในแอป
// (หน้าเว็บเรียก action syncTenantSheets ซึ่งต้องเป็น super_admin · ตัวนี้ไว้รันจาก editor ตอนยังเข้าแอปไม่ได้)
function syncTenantSheetsDev() {
  var r = syncTenantSheets({ role_code: 'super_admin' });
  Logger.log(r.message || JSON.stringify(r));
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
  var ss = SpreadsheetApp.create('TOPSALES UAT — Central Sheet');
  props.setProperties({ CENTRAL_SHEET_FILEID: ss.getId(), ENV_NAME: 'uat' });
  // เก็บเข้าโฟลเดอร์ db_uat/TNKI ตั้งแต่แรก (ENV_NAME ต้องตั้งก่อน ไม่งั้นจะไปลง db_prod)
  try { _moveFileTo(ss.getId(), _dbOwnerFolder()); } catch (e) { Logger.log('ย้าย Central Sheet เข้าโฟลเดอร์ไม่สำเร็จ: ' + e.message); }
  Logger.log('สร้าง Central Sheet UAT แล้ว: ' + ss.getUrl());

  setupCentralSheet();
  createFirstSuperAdmin();
  Logger.log('✅ UAT พร้อมใช้ — Central Sheet: ' + ss.getUrl() + ' | login: admin / ChangeMe123! (เปลี่ยนรหัสหลังเข้าได้)');
  Logger.log('ขั้นต่อไป: Deploy → New deployment → Web app (Execute as: Me, Anyone) แล้วส่ง URL ที่ได้ให้ตั้งเป็น BACKEND_URL_UAT');
}

/**
 * ตั้งค่าสภาพแวดล้อม production ครั้งแรก — รันใน Apps Script editor ของโปรเจกต์ production เท่านั้น
 * (กดปุ่ม Run ครั้งแรกจะขึ้นหน้าต่างขออนุญาตสิทธิ์ Sheets/Drive/External request ให้กดยอมรับ)
 * ทำให้ครบในครั้งเดียว: สร้าง Central Sheet ของ production → ตั้ง Script Properties → สร้างชีต/ผังบัญชี → สร้างแอดมินคนแรก
 * ไม่คัดลอกข้อมูลจาก UAT มาให้ (ข้อมูลทดสอบห้ามขึ้น production) — สินค้า/ลูกค้า/ชุดราคาจริงค่อยนำเข้าทีหลัง
 */
function setupProductionEnvironment() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CENTRAL_SHEET_FILEID')) {
    Logger.log('❌ หยุด: โปรเจกต์นี้ตั้ง CENTRAL_SHEET_FILEID ไว้แล้ว (ENV_NAME=' + props.getProperty('ENV_NAME') + ') — ไม่สร้างซ้ำ');
    return;
  }
  props.setProperty('ENV_NAME', 'prod');               // ต้องตั้งก่อนสร้างไฟล์ ไม่งั้นไฟล์ไปลงโฟลเดอร์ผิด env
  var ss = SpreadsheetApp.create('TOPSALES — Central Sheet (production)');
  props.setProperty('CENTRAL_SHEET_FILEID', ss.getId());
  try { _moveFileTo(ss.getId(), _dbOwnerFolder()); } catch (e) { Logger.log('ย้าย Central Sheet เข้าโฟลเดอร์ db_prod/TNKI ไม่สำเร็จ: ' + e.message); }

  setupCentralSheet();
  createFirstSuperAdmin();

  Logger.log('✅ production พร้อมใช้งานขั้นต้น');
  Logger.log('   Central Sheet: ' + ss.getUrl());
  Logger.log('   เข้าระบบครั้งแรก: admin / ChangeMe123!  ← เปลี่ยนรหัสผ่านทันทีหลังเข้าได้');
  Logger.log('ยังต้องตั้ง Script Properties อีก (Project Settings → Script Properties):');
  Logger.log('   LINE_CHANNEL_ID / LINE_CHANNEL_SECRET — ของ LINE Login channel ที่ใช้กับ LIFF ของ production');
  Logger.log('   LIFF_ID           — LIFF app ที่ชี้มาที่ /mobile/');
  Logger.log('   ENDPOINT_URL      — Web App URL ของ deployment production (ใช้เป็น redirect_uri ของ LINE Login)');
  Logger.log('หมายเหตุ: ENV_NAME=prod แปลว่าแอปมือถือต้องยืนยัน LINE ID token เสมอ (ดู 27_line_auth.gs)');
}

// เรียกทดสอบว่าเชื่อม Central Sheet ได้ปกติหรือไม่
function testCentralConnection() {
  var sheet = centralSheet('liff_users');
  Logger.log('เชื่อมต่อ Central Sheet สำเร็จ: ' + sheet.getName());
}

/**
 * รันฟังก์ชันนี้ใน Apps Script editor "ครั้งเดียว" หลังเปลี่ยนสิทธิ์ Drive (oauthScopes ใน appsscript.json)
 * — จะขึ้นหน้าต่างขออนุญาตให้กดยอมรับ แล้วเช็คให้เลยว่าเข้าถึงโฟลเดอร์ฐานข้อมูลได้จริงไหม
 * ถ้าไม่รันอันนี้ก่อน เว็บแอปจะฟ้อง "สิทธิ์ที่ระบุไว้ไม่เพียงพอ" ตอนกดจัดระเบียบไฟล์
 * (Web App รันในฐานะเจ้าของ deployment เจ้าของจึงต้องเป็นคนกดยอมรับสิทธิ์ใหม่เอง)
 */
function authorizeDriveAccess() {
  var rootId = _dbRootFolderId();
  var root = DriveApp.getFolderById(rootId);           // จุดนี้แหละที่ต้องใช้สิทธิ์ Drive เต็ม
  Logger.log('✅ เข้าถึงโฟลเดอร์รากได้: ' + root.getName() + ' (' + rootId + ')');
  var env = _dbEnvFolder(), owner = _dbOwnerFolder();
  Logger.log('✅ โฟลเดอร์ของสภาพแวดล้อมนี้: ' + env.getName() + ' / ' + owner.getName());
  var tenants = centralObjects('tenants').length;
  Logger.log('พร้อมจัดระเบียบไฟล์แล้ว — Central Sheet + ตัวแทน ' + tenants + ' ราย');
  Logger.log('ขั้นต่อไป: กลับไปที่ /admin-uat/ → เมนูตัวแทนจำหน่าย → "จัดระเบียบไฟล์ตามโครงสร้าง"');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * คู่มือฉบับแอดมิน: "ยกเลิกบิลขาย" — ติดตั้งลงคู่มือในแอป (เจ้าของระบบสั่ง 22 ต.ค. 2026)
 *
 * ★ เนื้อหาคู่มืออยู่ในตาราง `help_articles` ของ Central Sheet ไม่ได้ hardcode ไว้ในหน้าเว็บ
 *   (กติกาของ module 8: แก้เนื้อหาได้ทันทีโดยไม่ต้อง deploy) — ฟังก์ชันนี้จึงเป็นแค่ **ตัวติดตั้งครั้งแรก**
 *   แก้คำทีหลังให้แก้ที่หน้าจอ 8.1.1 ในแอปได้เลย ไม่ต้องกลับมาที่ไฟล์นี้
 * ★ รันซ้ำได้ — มีบทความรหัส `sales-cancel` อยู่แล้วจะเขียนทับของเดิม (ระวังถ้าแก้คำในแอปไว้แล้ว
 *   รันซ้ำจะทับของที่แก้ไว้ · ตั้งใจให้เป็นแบบนี้เพื่อให้ "กู้ข้อความต้นฉบับ" ได้ด้วยการรันใหม่)
 * ★ รันจาก Apps Script editor ของ env ที่ต้องการ (editor รันโค้ดที่ HEAD — ไม่ต้อง deploy ก่อน)
 *
 * เนื้อหาเขียนตามรูปแบบ body ของคู่มือ: บรรทัดขึ้นต้นด้วยเลข = ขั้นตอน · บรรทัดว่าง = ย่อหน้าใหม่ ·
 * `[ภาพ: ...]` = ช่องใส่ภาพหน้าจอ (ยังไม่มีภาพจะขึ้นกรอบบอกว่าต้องถ่ายอะไรมาใส่)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
function seedCancelSaleHelpArticle() {
  var CODE = 'sales-cancel';
  var body = [
    'กฎข้อเดียวที่ต้องจำ: ถ้ายัง "ไม่ได้ออกใบแจ้งหนี้/ใบกำกับภาษี" ให้ยกเลิกบิลได้เลย ระบบจัดการของและยอดขายให้เอง — แต่ถ้าออกเอกสารไปแล้ว อย่ายกเลิก ให้ออกใบลดหนี้แทน',
    '',
    'ยกเลิกอย่างไร',
    '1. เมนู งานขาย → บิลขาย แล้วกดเปิดบิลที่ต้องการ',
    '2. กดปุ่ม "ยกเลิกบิลนี้" ที่แถบปุ่มด้านบนของหน้าบิล',
    '3. กดยืนยัน — ระบบบันทึกชื่อคนยกเลิก เวลา และเหตุผลไว้ในประวัติของบิลเสมอ และลบประวัตินั้นไม่ได้',
    '',
    '[ภาพ: ปุ่ม "ยกเลิกบิลนี้" บนหน้ารายละเอียดบิลขาย]',
    '',
    'ระบบทำอะไรให้เองบ้าง — ขึ้นกับสถานะตอนที่กดยกเลิก',
    '',
    'ขายจากรถ (เงินสดหน้าร้าน) — ของกลับขึ้นรถของพนักงานคนที่ขายทันที และกลับรายการต้นทุนให้ด้วย',
    '',
    'สำนักงานจัดส่ง ที่ยังไม่ถึงขั้น "พร้อมจัดส่ง" (ใหม่ · รออนุมัติ · อนุมัติ/เตรียมจัดส่ง) — ของยังไม่ถูกตัดออกจากคลัง ระบบแค่ปลดของที่จองไว้ให้บิลนี้ ของกลับไปขายให้ใบอื่นได้ทันที',
    '',
    'สำนักงานจัดส่ง ตั้งแต่ขั้น "พร้อมจัดส่ง" ขึ้นไป (พร้อมจัดส่ง · กำลังจัดส่ง · จัดส่งสำเร็จ) — ของถูกตัดออกจากคลังไปแล้ว ระบบคืนเข้าคลังเดิมให้ พร้อมบันทึกการเคลื่อนไหวสินค้าไว้ตรวจสอบได้',
    '',
    'ทุกกรณี — ยอดขายของวันที่เปิดบิลถูกหักคืนอัตโนมัติ ไม่ต้องไปแก้ที่รายงาน',
    '',
    'สามกรณีที่ระบบทำแทนไม่ได้ ต้องทำต่อด้วยมือ',
    '',
    'ออกใบแจ้งหนี้หรือใบกำกับภาษีไปแล้ว — การยกเลิกบิล "ไม่ได้" ยกเลิกใบกำกับภาษี ลูกค้ายังถือเอกสารอยู่และภาษีขายยังค้างอยู่ในสมุด ให้ไปที่เมนูบัญชี แล้วออก "ใบลดหนี้" อ้างใบกำกับภาษีเดิมแทนการยกเลิกบิล',
    '',
    'ส่งของไปแล้วบางรอบ — ของที่ส่งออกไปแล้วจะไม่ถูกคืนเข้าคลัง (เพราะของอยู่กับลูกค้าจริงๆ) แต่ยอดขายถูกหักคืนทั้งใบ ต้องตามเก็บของคืนหรือออกใบลดหนี้ให้ลูกค้า ระบบจะขึ้นคำเตือนข้อนี้ให้ตอนกดยกเลิก',
    '',
    'รับเงินมาแล้ว — การยกเลิกบิลไม่ได้คืนเงินให้ลูกค้า ต้องทำรายการคืนเงินตามระเบียบของบริษัท',
    '',
    'สิ่งที่ทำไม่ได้',
    '',
    'บิลที่ยกเลิกไปแล้ว เปลี่ยนสถานะต่อไม่ได้ และย้อนกลับไม่ได้ ถ้าลูกค้าสั่งใหม่ให้เปิดบิลใหม่',
    '',
    'พนักงานขายยกเลิกเองจากแอปมือถือได้เฉพาะบิลของตัวเอง และเฉพาะก่อนที่ศูนย์จะรับงาน (ขั้นใหม่/รออนุมัติ) ส่วนบิลขายจากรถยกเลิกเองไม่ได้เลย ต้องแจ้งศูนย์',
    '',
    'คนที่ไม่มีสิทธิ์ "งานขาย (แก้ไข)" จะไม่เห็นปุ่มยกเลิก',
    '',
    'เช็ก 3 ข้อก่อนกดยกเลิก',
    '1. บิลนี้ออกใบแจ้งหนี้หรือใบกำกับภาษีไปแล้วหรือยัง (ดูได้ที่การ์ดสถานะบนหน้าบิล)',
    '2. ของออกจากคลังหรือส่งถึงลูกค้าไปแล้วหรือยัง',
    '3. รับเงินมาแล้วหรือยัง',
    '',
    'ถ้าข้อใดข้อหนึ่งตอบว่า "แล้ว" ให้ปรึกษาฝ่ายบัญชีก่อนกดยกเลิก'
  ].join('\n');

  var fields = {
    code: CODE, category: 'sales',
    title: 'ยกเลิกบิลขาย — ทำได้เมื่อไหร่ และระบบจัดการอะไรให้บ้าง',
    summary: 'ยังไม่ออกใบกำกับภาษี = ยกเลิกได้เลย ระบบคืนของและหักยอดขายให้เอง · ออกใบไปแล้ว = ต้องใช้ใบลดหนี้แทน',
    body: body, sort_order: 30, is_active: 'TRUE',
    updated_at: nowStr(), updated_by: 'seedCancelSaleHelpArticle'
  };

  var found = null;
  centralObjects('help_articles').forEach(function(a) { if (String(a.code) === CODE) found = a; });
  if (found) {
    centralUpdate('help_articles', found.record_id, fields);
    Logger.log('✅ อัปเดตบทความเดิม (id ' + found.record_id + ') — เปิดดูได้ที่เมนู 8.1.1 คู่มือใช้งานระบบ');
  } else {
    fields.record_id = centralNextId('help_articles');
    centralAppend('help_articles', fields);
    Logger.log('✅ เพิ่มบทความใหม่ (id ' + fields.record_id + ') — เปิดดูได้ที่เมนู 8.1.1 คู่มือใช้งานระบบ');
  }
  Logger.log('ปุ่ม "คู่มือการยกเลิก" บนหน้าบิลขายจะเปิดบทความนี้ด้วยรหัส ' + CODE);
  return fields;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * คู่มือฉบับแอดมิน: "ใบลดหนี้ — ลดบางส่วนโดยไม่ยกเลิกทั้งใบ" (เจ้าของระบบสั่ง 22 ต.ค. 2026)
 * คู่กับบทความ `sales-cancel` — อันนั้นตอบว่า "ยกเลิกทั้งใบทำยังไง" อันนี้ตอบว่า "ถ้าไม่ยกเลิกทั้งใบล่ะ"
 * เงื่อนไข/ตัวเลขทั้งหมดในบทความนี้ตรงกับ `49_credit_notes.gs` และ `54_goods_returns.gs`
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
function seedCreditNoteHelpArticle() {
  var CODE = 'sales-credit-note';
  var body = [
    'ใช้ใบลดหนี้เมื่อ "ออกใบแจ้งหนี้/ใบกำกับภาษีไปแล้ว" แต่ยอดที่เรียกเก็บสูงเกินความจริง — ไม่ว่าจะลดบางรายการหรือทั้งใบ · ถ้ายังไม่ได้ออกใบกำกับภาษี ให้แก้ที่บิลขายหรือยกเลิกบิลแทน จะง่ายกว่ามาก (ดูคู่มือ "ยกเลิกบิลขาย")',
    '',
    'เหตุผลที่ระบบมีให้เลือก: ลูกค้าคืนสินค้า · ส่งของไม่ครบ/ของขาด · สินค้าชำรุดเสียหาย · คิดราคาผิด/คิดเงินเกิน · ให้ส่วนลดเพิ่มหลังออกใบกำกับภาษี · ยกเลิกการขาย',
    '',
    'เลือกเส้นทางให้ถูกก่อน — ดูที่ "ของกลับมาไหม"',
    '',
    'แบบที่ 1 ลูกค้าคืนของจริง — ต้องออกใบรับคืนสินค้าก่อน',
    '1. เมนู งานขาย → ใบรับคืนสินค้า → กด "+ รับคืนสินค้า" แล้วเลือกบิลขายใบนั้น',
    '2. ใส่จำนวนที่รับคืนของแต่ละรายการ พร้อมระบุสภาพ: สภาพดีขายต่อได้ / ชำรุดเสียหาย / หมดอายุ',
    '3. บันทึก — ของสภาพดีเข้าคลังให้อัตโนมัติ ส่วนของชำรุดและหมดอายุจะไม่เข้าคลัง (กันของเสียถูกขายออกไปอีกรอบ)',
    '4. กดปุ่ม "ออกใบลดหนี้" ต่อจากใบรับคืนใบนั้นได้เลย ระบบดึงรายการและมูลค่ามาให้',
    '',
    'แบบที่ 2 ไม่มีของคืน (คิดราคาผิด · ของเสียทิ้งไปแล้ว · ให้ส่วนลดเพิ่ม) — ออกใบลดหนี้ตรงจากใบแจ้งหนี้',
    '1. เมนู งานขาย → ใบลดหนี้ / เพิ่มหนี้ → กด "+ ออกใบลดหนี้" แล้วเลือกใบแจ้งหนี้ที่ต้องการลด',
    '2. หรือลัดจากหน้าบิลขาย: แท็บการจัดส่ง แถวรอบที่มีใบแจ้งหนี้แล้ว จะมีปุ่ม "ใบลดหนี้" อยู่',
    '3. เลือกรายการและจำนวนที่จะลด ใส่เหตุผล แล้วบันทึก',
    '',
    '[ภาพ: ฟอร์มออกใบลดหนี้ — ช่องเลือกรายการ จำนวน และเหตุผล]',
    '',
    'ของขยับด้วยไหม เป็นคนละคำถามกับเงินลดเท่าไร',
    '',
    'ในฟอร์มใบลดหนี้มีช่องให้ติ๊กว่าจะให้ของกลับเข้าคลังด้วยหรือไม่ — ระบบไม่เดาให้ เพราะลูกค้าคืนของก็มี ของเสียทิ้งไปแล้วก็มี และคิดเงินผิดโดยไม่มีของเกี่ยวข้องเลยก็มี · ถ้ามาจากใบรับคืนสินค้า ของถูกรับเข้าคลังตั้งแต่ขั้นนั้นแล้ว ไม่ต้องติ๊กซ้ำ',
    '',
    'ตัวเลขที่ระบบคุมให้',
    '',
    'ลดได้ไม่เกิน ยอดใบแจ้งหนี้ บวกใบเพิ่มหนี้ ลบที่เคยลดไปแล้ว — ลดเกินยอดใบไม่ได้ ระบบจะปฏิเสธตั้งแต่ตอนบันทึก',
    '',
    'ออกได้หลายใบต่อใบแจ้งหนี้ใบเดียว ทยอยลดทีละส่วนได้',
    '',
    'ยอดค้างชำระของใบแจ้งหนี้คิดจาก ยอดใบ + เพิ่มหนี้ − รับชำระ − ลดหนี้ ทุกที่ในระบบใช้สูตรเดียวกันนี้',
    '',
    'บัญชีลงให้อัตโนมัติ: ลดรายได้และลดภาษีขาย แล้วลดยอดลูกหนี้ลงตามกัน',
    '',
    'สองเรื่องภาษีที่ต้องรู้',
    '',
    'ใบลดหนี้เป็นเอกสารภาษีตามมาตรา 86/10 ไม่ใช่แค่รายการบัญชี — ใบที่พิมพ์ออกมาจะมีเลขที่และวันที่ของใบกำกับภาษีเดิม มูลค่าตามใบเดิม มูลค่าที่ถูกต้อง ผลต่าง และเหตุผลครบตามที่กฎหมายกำหนด',
    '',
    'ภาษีขายขยับในงวดที่ออกใบลดหนี้ ไม่ย้อนกลับไปแก้งวดเดิมที่ยื่น ภ.พ.30 ไปแล้ว จึงไม่ต้องไปรื้อแบบที่ยื่นไปแล้ว',
    '',
    'สิ่งที่ทำไม่ได้',
    '',
    'ใบแจ้งหนี้ที่ถูกยกเลิกไปแล้ว ออกใบลดหนี้ไม่ได้',
    '',
    'ใบลดหนี้ที่ออกไปแล้วลบไม่ได้ ถ้าออกผิดให้กดยกเลิกใบนั้น ระบบจะออกรายการกลับทางให้ และยังเห็นทั้งสองใบในประวัติ',
    '',
    'ถ้าคิดเงินลูกค้าขาดไป ให้ใช้ "ใบเพิ่มหนี้" ที่เมนูเดียวกัน ไม่ใช่ใบลดหนี้',
    '',
    'ต้องมีสิทธิ์โมดูลบัญชีจึงจะเห็นเมนูใบลดหนี้ / ใบเพิ่มหนี้'
  ].join('\n');

  var fields = {
    code: CODE, category: 'sales',
    title: 'ใบลดหนี้ — ลดยอดบางส่วนโดยไม่ยกเลิกทั้งใบ',
    summary: 'ออกใบกำกับภาษีไปแล้วแต่เรียกเก็บเกิน · มีของคืน = เริ่มที่ใบรับคืนสินค้า · ไม่มีของคืน = ออกใบลดหนี้จากใบแจ้งหนี้ได้เลย',
    body: body, sort_order: 31, is_active: 'TRUE',
    updated_at: nowStr(), updated_by: 'seedCreditNoteHelpArticle'
  };

  var found = null;
  centralObjects('help_articles').forEach(function(a) { if (String(a.code) === CODE) found = a; });
  if (found) {
    centralUpdate('help_articles', found.record_id, fields);
    Logger.log('✅ อัปเดตบทความเดิม (id ' + found.record_id + ')');
  } else {
    fields.record_id = centralNextId('help_articles');
    centralAppend('help_articles', fields);
    Logger.log('✅ เพิ่มบทความใหม่ (id ' + fields.record_id + ')');
  }
  Logger.log('ปุ่ม "คู่มือใบลดหนี้" บนหน้าใบลดหนี้และหน้าใบรับคืนสินค้าจะเปิดบทความนี้ (รหัส ' + CODE + ')');
  return fields;
}

/** ติดตั้งคู่มือทุกบทความที่มีตัวติดตั้งในไฟล์นี้ — รันตัวเดียวจบตอนเปิด env ใหม่ */
function seedAllHelpArticles() {
  seedCancelSaleHelpArticle();
  seedCreditNoteHelpArticle();
  Logger.log('— ติดตั้งคู่มือครบแล้ว เปิดดูที่เมนู 8.1.1 คู่มือใช้งานระบบ —');
}
