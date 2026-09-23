/**
 * ===================== ยืนยันตัวตน LINE (ID token จาก LIFF) =====================
 * เดิม backend เชื่อ `lineUserId` ที่หน้าเว็บส่งมาดื้อๆ — ใครยิง POST เองก็สวมรอยเป็นพนักงานคนไหนก็ได้
 * ตอนนี้หน้าเว็บมือถือแนบ `idToken` (จาก `liff.getIDToken()`) มาด้วยทุกคำขอ แล้วที่นี่เอาไปให้ LINE ยืนยัน
 * (https://api.line.me/oauth2/v2.1/verify) — ตัวตนที่ใช้งานจริงคือ `sub` ที่ LINE ตอบกลับมาเท่านั้น
 *
 * Script Properties ที่เกี่ยวข้อง:
 *   LINE_LOGIN_CHANNEL_ID       — Channel ID ของ LINE Login channel ที่ LIFF app นี้อยู่ (ถ้าไม่ตั้ง จะ fallback
 *                                 ไปใช้ LINE_CHANNEL_ID เดิม ซึ่งปกติเป็นตัวเดียวกัน)
 *   ALLOW_UNVERIFIED_LINE_LOGIN — 'TRUE' = ยอมรับคำขอที่ไม่มี idToken (โหมดทดสอบ ?devLineUserId=... ในเบราว์เซอร์)
 *                                 'FALSE' = บังคับเข้มแม้บน UAT · ไม่ตั้ง = เปิดให้เฉพาะ env ที่ไม่ใช่ prod
 *                                 (ENV_NAME='uat') — **production เข้มเสมอ** เพราะ ENV_NAME ไม่ได้ตั้ง = prod
 * ยังไม่ได้ตั้ง channel id = ยืนยันไม่ได้ → ระบบยอมรับแบบเดิมแต่เขียน log เตือนไว้ (ไม่งั้นระบบล่มทั้งระบบ
 * เพียงเพราะลืมตั้งค่า) — ตั้งค่าให้ครบแล้วมันจะเข้มเองอัตโนมัติ
 *
 * ค่าใช้จ่าย: การยืนยัน 1 ครั้ง = UrlFetch ไป LINE (~200–400ms) จึงแคชผลไว้ตามอายุ token (สูงสุด 30 นาที)
 * ด้วย CacheService — คีย์เป็น MD5 ของ token ไม่ได้เก็บตัว token ไว้
 */

var LINE_IDTOKEN_CACHE_PREFIX = 'lineidt_';
var LINE_IDTOKEN_CACHE_MAX_SEC = 1800;

function _lineAuthConfig() {
  var scp = PropertiesService.getScriptProperties();
  var flag = scp.getProperty('ALLOW_UNVERIFIED_LINE_LOGIN');
  var notSet = flag === null || flag === undefined || String(flag).trim() === '';
  return {
    channelId: String(scp.getProperty('LINE_LOGIN_CHANNEL_ID') || scp.getProperty('LINE_CHANNEL_ID') || '').trim(),
    // UAT ต้องเปิดเบราว์เซอร์ทดสอบด้วย ?devLineUserId= ได้อยู่ (ไม่มี LIFF จึงไม่มี ID token) — ปล่อยผ่านเป็นค่าเริ่มต้น
    // ให้เฉพาะ env ที่ไม่ใช่ prod · production (ENV_NAME ไม่ได้ตั้ง) เข้มเสมอเว้นแต่ตั้ง flag เป็น TRUE เอง
    allowUnverified: notSet ? _envName() !== 'prod' : isFlagOn(flag)
  };
}

function _shortHash(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s))
    .map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/**
 * ถาม LINE ว่า ID token นี้จริงไหมและเป็นของใคร
 * คืน { ok: true, lineUserId, name?, picture? } หรือ { ok: false, message }
 */
function verifyLineIdToken(idToken, channelId) {
  if (!idToken) return { ok: false, message: 'ไม่พบ ID token' };
  if (!channelId) return { ok: false, message: 'ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID ที่ backend' };

  var cache = CacheService.getScriptCache();
  var key = LINE_IDTOKEN_CACHE_PREFIX + _shortHash(idToken);
  var cached = cache.get(key);
  if (cached) return { ok: true, lineUserId: cached, cached: true };

  var res, data = {};
  try {
    res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: { id_token: idToken, client_id: channelId }, muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, message: 'ติดต่อ LINE เพื่อยืนยันตัวตนไม่ได้: ' + e.message, transient: true };
  }
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) { data = {}; }
  if (res.getResponseCode() !== 200 || !data.sub) {
    return { ok: false, message: 'ยืนยันตัวตนกับ LINE ไม่ผ่าน' + (data.error_description ? ' (' + data.error_description + ')' : '') };
  }
  // ตรวจซ้ำฝั่งเราเอง: token ต้องออกให้ channel นี้ และต้องยังไม่หมดอายุ (LINE ตรวจให้อยู่แล้ว แต่ถูกกว่าการเชื่อ)
  if (String(data.aud) !== String(channelId)) return { ok: false, message: 'ID token ไม่ได้ออกให้แอปนี้' };
  var nowSec = Math.floor(Date.now() / 1000);
  var leftSec = (parseInt(data.exp, 10) || 0) - nowSec;
  if (leftSec <= 0) return { ok: false, message: 'ID token หมดอายุแล้ว กรุณาเข้าใหม่' };

  cache.put(key, String(data.sub), Math.max(60, Math.min(LINE_IDTOKEN_CACHE_MAX_SEC, leftSec)));
  return { ok: true, lineUserId: String(data.sub), name: data.name || '', picture: data.picture || '' };
}

/**
 * ตัวตนที่ใช้ได้จริงของคำขอหนึ่งๆ (body = ก้อน JSON ที่ doPost รับมา)
 * คืน { ok: true, lineUserId, verified } หรือ { ok: false, message, authError, needLogin }
 *   - มี idToken  → ยึดผลจาก LINE เสมอ (lineUserId ที่ส่งมาด้วยต้องตรงกัน ไม่งั้นปฏิเสธ)
 *   - ไม่มี idToken → ผ่านได้เฉพาะตอนที่ยังตั้งค่าไม่ครบ หรือเปิด ALLOW_UNVERIFIED_LINE_LOGIN ไว้ (โหมดทดสอบ)
 */
function resolveLineIdentity(body) {
  body = body || {};
  var cfg = _lineAuthConfig();
  var idToken = body.idToken ? String(body.idToken) : '';
  var claimed = body.lineUserId ? String(body.lineUserId) : (body.payload && body.payload.lineUid ? String(body.payload.lineUid) : '');

  if (idToken) {
    var v = verifyLineIdToken(idToken, cfg.channelId);
    if (!v.ok) return { ok: false, message: v.message, authError: true, needLogin: !v.transient };
    if (claimed && claimed !== v.lineUserId) return { ok: false, message: 'ข้อมูลตัวตนไม่ตรงกับ ID token ของ LINE', authError: true };
    return { ok: true, lineUserId: v.lineUserId, verified: true, name: v.name };
  }

  if (!claimed) return { ok: false, message: 'ไม่พบตัวตนผู้ใช้ (lineUserId)', authError: true, needLogin: true };
  if (!cfg.channelId) {
    Logger.log('เตือน: ยังไม่ได้ตั้ง LINE_LOGIN_CHANNEL_ID — ยอมรับ lineUserId โดยไม่ได้ยืนยันกับ LINE');
    return { ok: true, lineUserId: claimed, verified: false };
  }
  if (cfg.allowUnverified) {
    Logger.log('เตือน: ยอมรับ lineUserId ' + claimed + ' โดยไม่มี ID token (ALLOW_UNVERIFIED_LINE_LOGIN / env=' + _envName() + ')');
    return { ok: true, lineUserId: claimed, verified: false };
  }
  return { ok: false, message: 'ต้องเปิดใช้งานผ่านแอป LINE (ไม่พบ ID token) กรุณาเข้าสู่ระบบใหม่', authError: true, needLogin: true };
}
