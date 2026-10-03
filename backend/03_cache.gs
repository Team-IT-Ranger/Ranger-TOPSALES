// ===================== CACHE HELPERS =====================
// ใช้ CacheService เก็บข้อมูลชั่วคราว ลดการอ่าน Sheets ซ้ำ

var CACHE_TTL = 600; // วินาที (10 นาที) — สำหรับ getBootstrap
var CACHE_TTL_DASHBOARD = 120; // 2 นาที — dashboard เปลี่ยนบ่อยกว่า

/* ★ แคช bootstrap ของแอปมือถือ (แคตตาล็อกสินค้า/ลูกค้า/โปร) เป็นรายคน อายุ 10 นาที และเดิมไม่หมดอายุเมื่อมีการเพิ่ม/แก้สินค้า
   สินค้าที่เพิ่งเพิ่ม (เช่น 10185) จึงไม่โผล่ในรายการเลือกสินค้าขายของพนักงานจนกว่าจะครบ 10 นาที — ใส่ "เลขเวอร์ชันแคตตาล็อก" ต่อท้ายคีย์
   เปลี่ยนสินค้า/หน่วยขาย/ลูกค้า/โปร → bumpCatalogVersion() (เรียกจาก centralInvalidate) → คีย์เดิมไม่ถูกใช้อีก ทุกคนได้ของสดทันที */
var CATALOG_VER_KEY = 'topshop_catalog_ver';
function _catalogVersion() { try { return CacheService.getScriptCache().get(CATALOG_VER_KEY) || '0'; } catch (e) { return '0'; } }
function bumpCatalogVersion() { try { CacheService.getScriptCache().put(CATALOG_VER_KEY, String(new Date().getTime()), 21600); } catch (e) {} }

function getCacheKey(key, scopeId) {
  return 'topshop_' + key + '_' + (scopeId || 'all') + (key === 'bootstrap' ? '_v' + _catalogVersion() : '');
}

function cacheGet(key, scopeId) {
  try {
    var raw = CacheService.getScriptCache().get(getCacheKey(key, scopeId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function cachePut(key, scopeId, data, ttlSec) {
  try {
    var json = JSON.stringify(data);
    if (json.length < 90000) { // CacheService จำกัด ~100KB ต่อ entry
      CacheService.getScriptCache().put(getCacheKey(key, scopeId), json, ttlSec || CACHE_TTL);
    }
  } catch (e) {}
}

function cacheClear(key, scopeId) {
  try { CacheService.getScriptCache().remove(getCacheKey(key, scopeId)); } catch (e) {}
}

// ล้าง cache ที่เกี่ยวข้องกับผู้ใช้คนหนึ่งหลังมีการเปลี่ยนแปลงข้อมูล (ขาย/เบิก/นับสต็อก)
function cacheClearUser(lineUserId) {
  ['bootstrap', 'dashboard'].forEach(function(k) { cacheClear(k, lineUserId); });
}

// ล้าง cache ระดับตัวแทน (เช่น มีลูกค้าใหม่ / สินค้าเปลี่ยน กระทบทุกคนใน tenant)
// หมายเหตุ: bootstrap cache ปัจจุบัน scope ด้วย lineUserId ไม่ใช่ tenantId ทั้งก้อน
// เฟสถัดไปถ้าผู้ใช้ต่อ tenant เยอะขึ้นค่อยเปลี่ยนมา scope ด้วย tenantId แทน
