/**
 * ===================== AUTH =====================
 * Backend นี้เป็น JSON API ล้วนๆ — ไม่มี HtmlService/doGet เสิร์ฟหน้าเว็บอีกต่อไป
 * หน้าตาทั้งหมด (LIFF มือถือ + Admin App) อยู่คนละโปรเจกต์ (Admin App ขึ้น GitHub Pages, Mobile ขึ้น Vercel) แล้วเรียก API นี้ผ่าน fetch()
 *
 * doPost(e) เป็นทางเข้าเดียวของทุก action แยกเป็น 3 กลุ่มตามการยืนยันตัวตน:
 *  1) Public   — ยังไม่มีตัวตน (lineLoginUrl, lineExchangeCode, registerUser, checkUser, adminLogin)
 *  2) Mobile   — ต้องมีตัวตน LINE ที่ยืนยันแล้วและได้รับอนุมัติ (ดู ACTION_MAP + _handleMobileActionCore ใน 05_router.gs)
 *
 * ตัวตนของฝั่ง Mobile มาจาก `idToken` ที่ LIFF ออกให้ ไม่ใช่ `lineUserId` ที่หน้าเว็บพิมพ์มาเอง —
 * ทุกทางเข้าที่ผูกกับตัวตน LINE ต้องผ่าน resolveLineIdentity() ใน 27_line_auth.gs เสมอ
 *  3) Admin    — ต้องมี token ที่ valid (ดู ADMIN_ACTION_MAP + _handleAdminActionCore ใน 05_router.gs)
 */

// ===================== LINE LOGIN =====================
function buildLoginUrl(redirectUrl) {
  var cfg = getConfig();
  return 'https://access.line.me/oauth2/v2.1/authorize' +
    '?response_type=code' +
    '&client_id=' + cfg.LINE_CHANNEL_ID +
    '&redirect_uri=' + encodeURIComponent(redirectUrl) +
    '&state=salesranger123' +
    '&scope=profile%20openid';
}

// แลก code (จาก LINE redirect กลับมาที่หน้าเว็บ frontend) เป็นโปรไฟล์ + สถานะผู้ใช้
// CHANNEL_SECRET อยู่ที่นี่เท่านั้น ไม่เคยส่งออกไปฝั่ง frontend/browser
function _lineExchangeCode(payload) {
  if (!payload.code) return { success: false, message: 'ไม่พบ code จาก LINE' };
  var redirectUrl = payload.redirectUrl || getConfig().ENDPOINT_URL;

  // กัน double-exchange ของ code เดิม (เช่น browser prefetch/refresh ซ้ำ)
  var cache = CacheService.getScriptCache();
  var cacheKey = 'code_' + String(payload.code).substring(0, 20);
  if (cache.get(cacheKey)) return { success: false, message: 'code นี้ถูกใช้ไปแล้ว กรุณาล็อกอินใหม่' };
  cache.put(cacheKey, '1', 60);

  var lineProfile = getLineProfile(payload.code, redirectUrl);
  if (!lineProfile || !lineProfile.userId) {
    return { success: false, message: 'ดึงโปรไฟล์ไม่ได้ กรุณาตรวจสอบ Channel ID หรือ Channel Secret' };
  }

  var userStatus = checkUser(lineProfile.userId);
  return { success: true, lineProfile: lineProfile, userStatus: userStatus };
}

function getLineProfile(code, redirectUrl) {
  var cfg = getConfig();
  var options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUrl,
      client_id: cfg.LINE_CHANNEL_ID,
      client_secret: cfg.LINE_CHANNEL_SECRET
    },
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', options);
  var tokenData = JSON.parse(response.getContentText());
  if (tokenData.error) throw new Error('LINE API ตอบกลับว่า: ' + tokenData.error_description);

  if (tokenData.id_token) {
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(tokenData.id_token.split('.')[1])).getDataAsString();
    var jwt = JSON.parse(payload);
    return { userId: jwt.sub, displayName: jwt.name };
  }
  return null;
}

// liff_users: line_user_id, display_name, role, tenant_id, status, last_login
function checkUser(lineUid) {
  var sheet = centralSheet('liff_users');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === lineUid) {
      sheet.getRange(i + 1, 6).setValue(new Date()); // last_login
      return {
        exists: true,
        name: data[i][1],
        role: data[i][2],
        tenantId: data[i][3],
        status: data[i][4]
      };
    }
  }
  return { exists: false };
}

// userData: { lineUid, name, schema(=tenantId) } — lineUid ถูกแทนที่ด้วยตัวตนที่ยืนยันแล้วใน doPost
function registerUser(userData) {
  if (!userData || !userData.lineUid) return { success: false, message: 'ไม่พบตัวตนผู้ใช้' };
  if (!String(userData.name || '').trim()) return { success: false, message: 'กรุณากรอกชื่อ-สกุล' };
  // ต้องเลือกสังกัด (ตัวแทนที่ยังเปิดใช้งาน) เสมอ — กติกาเดียวกับแอปแอดมิน ดู 29_admin_signup.gs
  if (!String(userData.schema || '').trim()) return { success: false, message: 'กรุณาเลือกสังกัด (ตัวแทนจำหน่าย) ก่อนลงทะเบียน' };
  if (!_activeTenantRow(userData.schema)) return { success: false, message: 'ไม่พบตัวแทนจำหน่ายที่เลือก (หรือถูกปิดการใช้งานอยู่)' };
  var existing = checkUser(userData.lineUid);   // กดสมัครซ้ำ/เน็ตกระตุก แล้วได้แถวซ้ำกันในชีต
  if (existing.exists) return { success: true, already: true, message: 'บัญชีนี้ลงทะเบียนไว้แล้ว (สถานะ: ' + (existing.status || '-') + ')' };
  centralAppend('liff_users', {
    line_user_id: userData.lineUid,
    display_name: userData.name,
    role: 'van_sales',
    tenant_id: userData.schema,
    status: 'No',                         // 'No' = รอผู้ดูแลอนุมัติที่เมนู "พนักงานขาย" (updateStaffAdmin)
    last_login: new Date()
  });
  return { success: true, pending: true, message: 'ลงทะเบียนแล้ว — รอผู้ดูแลระบบอนุมัติก่อนเริ่มใช้งาน' };
}

// รายชื่อตัวแทนที่ active — frontend ใช้แสดง dropdown ตอนลงทะเบียนพนักงานใหม่
// เป็น action สาธารณะ (ยังไม่ล็อกอิน) → คืนเฉพาะ id/ชื่อ/ภาค ห้ามคืนทั้งแถว (มี sheet_file_id ของตัวแทน)
// is_active: เขียนเป็นข้อความ 'TRUE' แต่ Sheets แปลงเป็น boolean true เอง อ่านกลับมาได้ true → ใช้ _isTrue (17_pricing.gs)
function listActiveTenants() {
  var rows = centralObjects('tenants').filter(function(t) { return isFlagOn(t.is_active); });
  return { success: true, data: rows.map(function(t) { return { tenant_id: t.tenant_id, name: t.name, region: t.region || '' }; }) };
}

// ===================== ADMIN LOGIN =====================
function _hashPassword(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  return raw.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// payload: { username, password }
function adminLogin(payload) {
  var username = String(payload.username || '').trim();
  var password = String(payload.password || '');
  if (!username || !password) return { success: false, message: 'กรุณากรอก username และ password' };

  var users = centralObjects('admin_users');
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username).toLowerCase() === username.toLowerCase()) { found = users[i]; break; }
  }
  if (!found) return { success: false, message: 'ไม่พบผู้ใช้งานนี้' };
  if (String(found.status) === ADMIN_STATUS_PENDING) {
    return { success: false, pendingApproval: true, message: 'บัญชีนี้รอผู้ดูแลระบบอนุมัติอยู่ — เข้าใช้งานได้หลังได้รับอนุมัติและกำหนดสิทธิ์แล้ว' };
  }
  if (String(found.status) === ADMIN_STATUS_REJECTED) return { success: false, message: 'คำขอใช้งานของบัญชีนี้ถูกปฏิเสธ — ติดต่อผู้ดูแลระบบ' };
  if (String(found.status) !== ADMIN_STATUS_ACTIVE) return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
  if (!String(found.role_code || '').trim()) return { success: false, message: 'บัญชีนี้ยังไม่ได้กำหนดบทบาท — ติดต่อผู้ดูแลระบบ' };
  if (_hashPassword(password, found.salt) !== found.password_hash) return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' };

  ensureSchemaCurrent();   // สคีมา Central Sheet เปลี่ยนตามโค้ดใหม่ → ปรับให้เองครั้งเดียว (ดู 00_setup_sheets.gs)

  var cfg = getConfig();
  var token = Utilities.getUuid();
  var session = {
    adminUserId: String(found.record_id),
    username: found.username,
    displayName: found.display_name,
    role_code: found.role_code,
    tenant_id: found.tenant_id || ''
  };
  CacheService.getScriptCache().put('admin_session_' + token, JSON.stringify(session), cfg.ADMIN_SESSION_TTL_SEC);

  return { success: true, token: token, displayName: found.display_name, roleCode: found.role_code, tenantId: found.tenant_id || '' };
}

function resolveAdminSession(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('admin_session_' + token);
  if (!raw) return null;
  return JSON.parse(raw);
}

function adminLogout(token) {
  if (token) CacheService.getScriptCache().remove('admin_session_' + token);
  return { success: true };
}

// ===================== WEB APP ENTRYPOINTS =====================
// doGet เหลือไว้แค่ health-check — ไม่เสิร์ฟหน้าเว็บใดๆ ทั้งสิ้น
function doGet(e) {
  return _jsonOutput({ status: 'ok', service: 'salesranger-topshop backend API', time: nowStr() });
}

// content-type ฝั่ง client (fetch) ต้องเป็น text/plain โดยเจตนา — GAS Web App ไม่รองรับ
// preflighted CORS request (custom header/application-json) เชื่อถือได้ ส่ง text/plain
// แล้ว parse JSON เองใน e.postData.contents จะเลี่ยง preflight ได้
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) {
    return _jsonOutput({ success: false, message: 'รูปแบบคำขอไม่ถูกต้อง (invalid JSON)' });
  }

  var action = body.action;
  var payload = body.payload || {};

  // ── 1) Public: ยังไม่มีตัวตน ──
  if (action === 'lineLoginUrl')    return _jsonOutput({ success: true, url: buildLoginUrl(payload.redirectUrl || getConfig().ENDPOINT_URL) });
  if (action === 'lineExchangeCode') return _jsonOutput(_lineExchangeCode(payload));
  // checkUser/registerUser ผูกกับตัวตน LINE → ยึด lineUid ที่ยืนยันแล้วเท่านั้น (กันสมัครสวมรอยคนอื่น)
  if (action === 'checkUser' || action === 'registerUser') {
    var lineId = resolveLineIdentity(body);
    if (!lineId.ok) return _jsonOutput({ success: false, message: lineId.message, authError: !!lineId.authError, needLogin: !!lineId.needLogin });
    payload.lineUid = lineId.lineUserId;
    if (action === 'checkUser') return _jsonOutput(checkUser(payload.lineUid));
    if (lineId.verified && lineId.name && !payload.name) payload.name = lineId.name;
    return _jsonOutput(registerUser(payload));
  }
  if (action === 'listActiveTenants') return _jsonOutput(listActiveTenants());
  if (action === 'registerAdminUser') return _jsonOutput(registerAdminUser(payload));
  if (action === 'adminLogin')      return _jsonOutput(adminLogin(payload));
  if (action === 'adminLogout')     return _jsonOutput(adminLogout(body.token));

  // ── 2) Mobile: ต้องเป็นตัวตน LINE ที่ยืนยันแล้ว และได้รับอนุมัติ ──
  if (ACTION_MAP[action]) {
    var mobileId = resolveLineIdentity(body);
    if (!mobileId.ok) return _jsonOutput({ success: false, message: mobileId.message, authError: true, needLogin: !!mobileId.needLogin });
    return _jsonOutput(_handleMobileActionCore(mobileId.lineUserId, action, payload));
  }

  // ── 3) Admin: ต้องมี token ที่ valid ──
  if (ADMIN_ACTION_MAP[action]) {
    var session = resolveAdminSession(body.token);
    if (!session) return _jsonOutput({ success: false, message: 'ไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ กรุณาเข้าสู่ระบบใหม่', authError: true });
    return _jsonOutput(_handleAdminActionCore(session, action, payload));
  }

  return _jsonOutput({ success: false, message: 'ไม่พบ action: ' + action });
}

function _jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
