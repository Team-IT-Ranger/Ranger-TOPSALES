/**
 * ===================== เข้าสู่ระบบแอปแอดมินด้วย LINE =====================
 * ตัวตนกลางของทุกแอปคือ LINE user id (ดู 29_admin_signup.gs) — หน้าแอดมินจึงล็อกอินด้วย LINE ได้เลย
 * โดยไม่ต้องจำรหัสผ่าน และตัวตนถูกยืนยันโดย LINE จริงๆ (ไม่ใช่พิมพ์ LINE id เอง)
 *
 * ลำดับการทำงาน (LINE Login v2.1 — authorization code flow):
 *   1) หน้าเว็บขอลิงก์ด้วย action `lineLoginUrl` (redirectUrl = URL ของหน้าแอดมินเอง) แล้วพาไป LINE
 *   2) LINE ส่งกลับมาที่หน้าแอดมินพร้อม ?code=...&state=...
 *   3) หน้าเว็บส่ง code มาที่ action `adminLoginWithLine` → ที่นี่แลก code เป็น id_token ผ่าน LINE
 *      (ใช้ channel secret ฝั่งเซิร์ฟเวอร์เท่านั้น) แล้วหาบัญชีที่ผูกกับ LINE user id นั้น
 *
 * ผลลัพธ์ที่เป็นไปได้:
 *   - เจอบัญชี active + มีบทบาท → ออก session token เหมือน adminLogin ทุกประการ
 *   - เจอบัญชี pending/rejected/ระงับ → บอกสถานะให้ชัด (ไม่ปล่อยเข้า)
 *   - ไม่เจอบัญชี → คืน needRegister + โปรไฟล์ LINE ให้หน้าเว็บเปิดฟอร์มสมัครที่ **ล็อก LINE id ที่ยืนยันแล้ว** ไว้ให้
 *
 * **ต้องตั้งค่าใน LINE Developers Console**: Callback URL ของ LINE Login channel ต้องมี URL ของหน้าแอดมิน
 * ทั้ง production และ UAT ไม่งั้น LINE จะปฏิเสธตั้งแต่ขั้นที่ 1 (ข้อความ 400 invalid redirect_uri)
 */

/** ออก session token ให้บัญชีแอดมิน (ใช้ร่วมกันระหว่างล็อกอินด้วยรหัสผ่านและด้วย LINE) */
function _issueAdminSession(found) {
  ensureSchemaCurrent();
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
  return { success: true, token: token, displayName: found.display_name, roleCode: found.role_code,
    tenantId: found.tenant_id || '', lineUserId: found.line_user_id || '' };
}

/** ตรวจสถานะบัญชีก่อนปล่อยเข้า — ใช้ข้อความชุดเดียวกับ adminLogin */
function _adminAccountGate(found) {
  if (String(found.status) === ADMIN_STATUS_PENDING) {
    return { success: false, pendingApproval: true, message: 'บัญชีนี้รอผู้ดูแลระบบอนุมัติอยู่ — เข้าใช้งานได้หลังได้รับอนุมัติและกำหนดสิทธิ์แล้ว' };
  }
  if (String(found.status) === ADMIN_STATUS_REJECTED) return { success: false, message: 'คำขอใช้งานของบัญชีนี้ถูกปฏิเสธ — ติดต่อผู้ดูแลระบบ' };
  if (String(found.status) !== ADMIN_STATUS_ACTIVE) return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
  if (!String(found.role_code || '').trim()) return { success: false, message: 'บัญชีนี้ยังไม่ได้กำหนดบทบาท — ติดต่อผู้ดูแลระบบ' };
  return null;
}

/**
 * Public — payload: { code, redirectUrl }
 * คืน session เหมือน adminLogin หรือ { needRegister: true, lineProfile } เมื่อยังไม่มีบัญชีผูกไว้
 */
function adminLoginWithLine(payload) {
  payload = payload || {};
  var code = String(payload.code || '').trim();
  if (!code) return { success: false, message: 'ไม่พบรหัสยืนยันจาก LINE' };
  var redirectUrl = String(payload.redirectUrl || '').trim() || getConfig().ENDPOINT_URL;

  // code ใช้ได้ครั้งเดียว — กันกดรีเฟรชแล้วยิงซ้ำ (LINE จะตอบ invalid_grant ซึ่งงงกว่า)
  var cache = CacheService.getScriptCache();
  var usedKey = 'adminline_' + code.substring(0, 24);
  if (cache.get(usedKey)) return { success: false, message: 'ลิงก์เข้าสู่ระบบนี้ถูกใช้ไปแล้ว กรุณากดเข้าสู่ระบบด้วย LINE อีกครั้ง' };

  var profile;
  try { profile = getLineProfile(code, redirectUrl); }
  catch (e) { return { success: false, message: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ: ' + e.message }; }
  if (!profile || !profile.userId) return { success: false, message: 'ดึงข้อมูลผู้ใช้จาก LINE ไม่ได้ (ตรวจ Channel ID/Secret และ Callback URL)' };
  cache.put(usedKey, '1', 300);

  var found = _adminByLineId(profile.userId);
  if (!found) {
    return { success: false, needRegister: true, message: 'LINE นี้ยังไม่ได้ผูกกับบัญชีผู้ใช้ — ลงทะเบียนขอใช้งานก่อน',
      lineProfile: { userId: profile.userId, displayName: profile.displayName || '' } };
  }
  var gate = _adminAccountGate(found);
  if (gate) return gate;
  return _issueAdminSession(found);
}
