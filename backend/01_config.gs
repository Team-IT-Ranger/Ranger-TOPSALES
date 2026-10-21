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
 * ★ บอท LINE อยู่คนละโปรเจกต์ (`bot-line/` — RangerBot-TOPSALES) และมี Script Properties ของตัวเอง
 *   (`LINE_CHANNEL_ACCESS_TOKEN`, `CENTRAL_SHEET_FILEID_PROD/UAT`) — ไม่ต้องตั้งอะไรที่นี่
 */
function getConfig() {
  var scp = PropertiesService.getScriptProperties();
  return {
    CENTRAL_SHEET_FILEID  : scp.getProperty('CENTRAL_SHEET_FILEID'),
    LIFF_ID               : scp.getProperty('LIFF_ID'),
    LINE_CHANNEL_ID       : scp.getProperty('LINE_CHANNEL_ID'),
    LINE_CHANNEL_SECRET   : scp.getProperty('LINE_CHANNEL_SECRET'),
    ENDPOINT_URL          : scp.getProperty('ENDPOINT_URL'),
    ADMIN_SESSION_TTL_SEC : parseInt(scp.getProperty('ADMIN_SESSION_TTL_SEC')) || 28800
  };
}
