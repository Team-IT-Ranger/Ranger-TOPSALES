/**
 * ===================== CONFIG =====================
 * ตั้งค่าทั้งหมดผ่าน Script Properties (Project Settings → Script Properties)
 * ต้องตั้งก่อน deploy:
 *   CENTRAL_SHEET_FILEID  — Google Sheet ID ของ Central Sheet (สินค้า/ราคา/โปรโมชั่น/ตัวแทน/ลูกค้า)
 *   LIFF_ID               — LINE LIFF App ID
 *   LINE_CHANNEL_ID       — LINE Login Channel ID
 *   LINE_CHANNEL_SECRET   — LINE Login Channel Secret
 *   ENDPOINT_URL          — URL ของ Web App ที่ deploy แล้ว (ใช้เป็น redirect_uri)
 *   ADMIN_SESSION_TTL_SEC — (optional) อายุ token แอดมิน วินาที ค่า default 28800 (8 ชม.)
 *
 * ── บอท LINE (59_line_bot.gs) — ต้องมาจาก **Messaging API channel** คนละตัวกับ Login channel ──
 *   LINE_BOT_ACCESS_TOKEN — Channel access token (long-lived) ของ Messaging API channel
 *                           ไม่ตั้ง = บอทปิดเงียบ (webhook ยังตอบ 200 ให้ LINE แต่ไม่ตอบข้อความ)
 *   LINE_BOT_WEBHOOK_KEY  — (optional) คำลับที่ต่อท้าย webhook URL เป็น `?k=<ค่า>`
 *                           ตั้งแล้วคำขอที่ไม่มี k ตรงกันจะถูกทิ้ง · **Apps Script อ่าน HTTP header ไม่ได้
 *                           จึงตรวจ `x-line-signature` ไม่ได้เลย** นี่คือตัวทดแทนเท่าที่ทำได้
 *                           (ถ้าปุ่ม Verify ในคอนโซล LINE ไม่ผ่านเพราะ query string ให้เอา property นี้ออก)
 *   ★ Messaging API channel **ต้องอยู่ provider เดียวกับ Login channel** ไม่งั้น userId ที่บอทได้
 *     จะเป็นค่าอีกชุดหนึ่งที่ไม่ตรงกับ admin_users.line_user_id ที่ผูกไว้แล้ว (หาบัญชีไม่เจอทั้งระบบ)
 */
function getConfig() {
  var scp = PropertiesService.getScriptProperties();
  return {
    CENTRAL_SHEET_FILEID  : scp.getProperty('CENTRAL_SHEET_FILEID'),
    LIFF_ID               : scp.getProperty('LIFF_ID'),
    LINE_CHANNEL_ID       : scp.getProperty('LINE_CHANNEL_ID'),
    LINE_CHANNEL_SECRET   : scp.getProperty('LINE_CHANNEL_SECRET'),
    ENDPOINT_URL          : scp.getProperty('ENDPOINT_URL'),
    ADMIN_SESSION_TTL_SEC : parseInt(scp.getProperty('ADMIN_SESSION_TTL_SEC')) || 28800,
    LINE_BOT_ACCESS_TOKEN : scp.getProperty('LINE_BOT_ACCESS_TOKEN'),
    LINE_BOT_WEBHOOK_KEY  : scp.getProperty('LINE_BOT_WEBHOOK_KEY')
  };
}
