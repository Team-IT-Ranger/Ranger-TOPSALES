/**
 * ===================== กันบันทึกซ้ำ (idempotency) =====================
 * ปัญหาจริงที่เจอ: ผู้ใช้ไม่รู้ว่ากดไปแล้วหรือยัง/โปรแกรมทำงานหรือยัง เลยกดซ้ำ → ออร์เดอร์เข้าระบบสองใบ
 *
 * ฝั่งหน้าเว็บกันการกดซ้ำได้ระดับหนึ่ง (ปิดปุ่ม + บล็อก action ชื่อเดียวกันที่ยังค้างอยู่) แต่กันไม่ได้ทุกกรณี:
 *   - เน็ตหลุดหลังเซิร์ฟเวอร์บันทึกไปแล้ว แต่คำตอบเดินทางกลับไม่ถึง → ผู้ใช้กดใหม่
 *   - แอปมือถือส่งบิลจากคิวออฟไลน์ซ้ำด้วยเหตุผลเดียวกัน
 *   - โหลดหน้าใหม่แล้วกดส่งซ้ำ / เปิดสองแท็บ
 * ทางเดียวที่กันได้จริงคือ **ฝั่งเซิร์ฟเวอร์** — หน้าเว็บแนบ requestId (สุ่มครั้งเดียวต่อ "ความตั้งใจจะบันทึกหนึ่งครั้ง")
 * มาด้วย ถ้า id เดิมเข้ามาอีก เราคืนผลลัพธ์ของครั้งแรกกลับไป ไม่สร้างเอกสารใบที่สอง
 *
 * requestId ต้องถูกสร้าง "ตอนประกอบข้อมูลที่จะส่ง" ไม่ใช่ตอนยิงแต่ละครั้ง — ไม่งั้นการลองใหม่จะได้ id ใหม่
 * และกันอะไรไม่ได้เลย (แอปมือถือเก็บ id นี้ไปกับบิลในคิวออฟไลน์ด้วย)
 */

var IDEMPOTENCY_TTL_SEC = 21600;   // 6 ชั่วโมง = เพดานของ CacheService · ครอบคลุมทุกกรณีกดซ้ำที่เกิดจริง
var IDEMPOTENCY_PREFIX = 'idem_';

/**
 * action ที่ "สร้างของใหม่" และซ้ำแล้วเสียหาย — ลงทะเบียนที่นี่คู่กับตอนใส่ใน ACTION_MAP/ADMIN_ACTION_MAP
 * ลืมใส่ไม่พัง แต่จะเสียการกันซ้ำไปเงียบๆ เฉพาะตัวนั้น
 * (action ที่เขียนทับค่าเดิม เช่น updateCustomerAdmin ไม่ต้องใส่ — ส่งซ้ำได้ผลเท่าเดิมอยู่แล้ว)
 */
var IDEMPOTENT_ACTIONS = {
  recordSale: 1, recordSaleAdmin: 1,          // บิลขาย — ใบที่ซ้ำคือความเสียหายที่ลบไม่ได้ (ตัดสต็อกไปแล้ว)
  restockVan: 1, submitCount: 1,              // สต็อกรถ
  savePurchaseRequisition: 1, savePurchaseOrder: 1, receiveGoods: 1,
  createApBillFromGr: 1, createApBillManual: 1, payApBills: 1,
  createArInvoice: 1, receiveArPayment: 1,
  createTenant: 1, addCustomerAdmin: 1, addCustomer: 1
};

/**
 * ทำงาน fn() ครั้งเดียวต่อ requestId หนึ่งค่า
 *   - ไม่ส่ง requestId มา (แอปรุ่นเก่า) → ทำงานปกติ ไม่กันอะไร
 *   - เคยทำสำเร็จแล้ว → คืนผลเดิม + duplicate:true (หน้าเว็บเอาไปบอกผู้ใช้ว่า "บันทึกไปแล้ว" ไม่ใช่บันทึกใหม่)
 *   - ล้มเหลว → ไม่จำ เพื่อให้กดใหม่แล้วทำงานจริง (ของที่ไม่สำเร็จ ไม่มีอะไรให้ซ้ำ)
 * ใช้ lock กันสองคำขอที่มาพร้อมกันเป๊ะ (กดรัวสองครั้งภายในเสี้ยววินาที) — เช็คแคชซ้ำอีกรอบหลังได้ lock
 */
function withIdempotency(requestId, fn) {
  var key = String(requestId || '').trim();
  if (!key) return fn();
  if (key.length > 100) key = key.substring(0, 100);
  var cache = CacheService.getScriptCache();
  var cacheKey = IDEMPOTENCY_PREFIX + key;

  var replay = _idemRead(cache, cacheKey);
  if (replay) return replay;

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(30000); } catch (e) { locked = false; }
  if (!locked) {
    // รอ lock ไม่ได้ = มีคำขออื่นกำลังทำอยู่นานผิดปกติ — ปฏิเสธดีกว่าเสี่ยงบันทึกซ้อน
    return { success: false, busy: true, message: 'ระบบกำลังบันทึกรายการก่อนหน้าอยู่ กรุณารอสักครู่แล้วลองใหม่' };
  }
  try {
    replay = _idemRead(cache, cacheKey);   // เช็คซ้ำหลังได้ lock (อีกคำขออาจเพิ่งทำเสร็จ)
    if (replay) return replay;
    var out = fn();
    if (out && out.success) {
      try { cache.put(cacheKey, JSON.stringify(out), IDEMPOTENCY_TTL_SEC); }
      catch (e) { Logger.log('withIdempotency: เก็บผลไม่ได้ (' + e + ')'); }   // ผลใหญ่เกินแคช — ยอมเสียการกันซ้ำดีกว่าล้มทั้งรายการ
    }
    return out;
  } finally {
    lock.releaseLock();
  }
}

function _idemRead(cache, cacheKey) {
  var hit = cache.get(cacheKey);
  if (!hit) return null;
  try {
    var prev = JSON.parse(hit);
    prev.duplicate = true;
    prev.message = 'รายการนี้บันทึกไปแล้ว' + (prev.orderCode ? ' (' + prev.orderCode + ')' : '') + ' — ระบบไม่ได้บันทึกซ้ำให้';
    return prev;
  } catch (e) { return null; }
}
