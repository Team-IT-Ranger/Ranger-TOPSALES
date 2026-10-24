/**
 * ===================== สถานะบิลขาย =====================
 * แยกสองแกนออกจากกันเด็ดขาด (ยัดรวมเป็นสถานะเดียวเมื่อไหร่ก็ตอบไม่ได้ว่า "ส่งแล้วแต่ยังไม่เก็บเงิน" คือสถานะอะไร)
 *
 *   แกนการส่งของ (sales_orders.status)
 *     pending_delivery  รอสำนักงานจัดส่ง   ── ตั้งต้นของบิลที่เปิดจากออฟฟิศ
 *          ↓ startDelivery
 *     delivering        กำลังจัดส่ง
 *          ↓ deliver
 *     completed         ส่งของแล้ว        ── ตั้งต้นของบิลขายจากรถ (ตัดสต็อกและส่งของไปพร้อมกันแล้ว)
 *     cancelled         ยกเลิก            ── ไปได้จากทุกสถานะ (คืนสต็อกรถให้เองถ้าเคยตัด — ดู cancelSalesOrderAdmin)
 *
 *   แกนการเงิน (sales_orders.payment_status)
 *     unpaid → partial → paid   (ขายสดจากรถเริ่มที่ paid เลย · ขายเชื่อเริ่มที่ unpaid)
 *
 * ทุกการเปลี่ยนสถานะเขียนลง order_status_log เสมอ — ไม่ลบ ไม่ทับ (หลักเดียวกับ pr_approvals ของงานซื้อ)
 * เปลี่ยนสถานะ **ไม่แตะสต็อกและไม่แตะยอดขายรายวัน** — ยอดขายนับตั้งแต่เปิดบิล การยกเลิกเท่านั้นที่หักคืน
 */

/* ═══ สายงานรับ-ส่งใบสั่งขาย (เจ้าของระบบกำหนด 1 ต.ค. 2026) ═══
 *   draft ใหม่ ──(มือถือกดยืนยัน)──▶ confirmed รออนุมัติ ──(ศูนย์อนุมัติ)──▶ accepted อนุมัติ/เตรียมจัดส่ง
 *     ──(ศูนย์แจ้งพร้อมส่ง)──▶ ready_to_ship พร้อมจัดส่ง ──▶ delivering กำลังจัดส่ง ──▶ completed จัดส่งแล้ว
 *   ปฏิเสธการขาย = rejected · ยกเลิก = cancelled
 *
 * ★ `pending_delivery` คือชื่อเดิมก่อน 1 ต.ค. 2026 — **ห้ามลบ** บิลเก่าทั้ง UAT/prod ยังเป็นค่านี้อยู่
 *   ให้ความหมายเท่ากับ `confirmed` ทุกประการ จะได้ไม่ต้อง migrate ข้อมูลเก่า */
var SO_DRAFT = 'draft', SO_CONFIRMED = 'confirmed', SO_ACCEPTED = 'accepted', SO_REJECTED = 'rejected',
    SO_READY = 'ready_to_ship', SO_PENDING = 'pending_delivery',
    SO_DELIVERING = 'delivering', SO_COMPLETED = 'completed', SO_CANCELLED = 'cancelled';
var SO_STATUS_LABELS = {
  /* ★ คำสั้นลงทั้งชุด (เจ้าของระบบกำหนดคำเอง 8 ต.ค. 2026) — ของเดิมเขียนเป็นประโยค
     "ยืนยันแล้ว → รอแอดมินกดรับงาน" 28 ตัวอักษร ดันคอลัมน์สถานะจนตารางบิลขายล้นจอ
     ★ แอปมือถืออ่านป้ายจากที่นี่ที่เดียว (ส่งไปเป็น statusLabel) ไม่ได้ตั้งชุดคำแปลที่สองไว้
       แก้ตรงนี้แล้วทั้งสองแอปเปลี่ยนตาม แต่หน้าเว็บแอดมินมีชุดของตัวเองที่ต้องแก้ให้ตรงกันด้วย */
  draft: 'ใหม่ (ร่าง)', confirmed: 'รออนุมัติ', pending_delivery: 'รออนุมัติ',
  accepted: 'อนุมัติ/เตรียมจัดส่ง', ready_to_ship: 'พร้อมจัดส่ง', delivering: 'กำลังจัดส่ง',
  completed: 'จัดส่งสำเร็จ', rejected: 'ปฏิเสธการขาย', cancelled: 'ยกเลิกแล้ว'
};
/* ไปไหนต่อได้บ้างจากสถานะปัจจุบัน — ย้อนกลับได้หนึ่งขั้น (กดผิดเป็นเรื่องปกติ) แต่บิลที่ยกเลิกแล้วเปิดคืนไม่ได้
 * **ห้ามข้ามขั้น** (guide ข้อ 1.1): pending_delivery ไป completed ตรงๆ ไม่ได้ เพราะ delivering คือจุดที่ตัด
 * สต็อกออกจากคลัง ข้ามได้เมื่อไหร่ของก็ออกไปโดยไม่มีใครหักยอด แล้วไม่มีอะไรฟ้องเลย
 * (เคยเปิดทางลัดนี้ไว้ตอน delivering ยังไม่มีผลข้างเคียง — ปิดทิ้ง 2026-09-27 พร้อมกับตอนใส่จุดตัดสต็อก) */
var SO_TRANSITIONS = {
  draft:            [SO_CONFIRMED, SO_CANCELLED],
  confirmed:        [SO_ACCEPTED, SO_REJECTED, SO_DRAFT, SO_CANCELLED],
  pending_delivery: [SO_ACCEPTED, SO_REJECTED, SO_DRAFT, SO_CANCELLED],   // ชื่อเดิม = confirmed
  accepted:         [SO_READY, SO_CONFIRMED, SO_CANCELLED],
  ready_to_ship:    [SO_DELIVERING, SO_ACCEPTED, SO_CANCELLED],
  delivering:       [SO_COMPLETED, SO_READY, SO_CANCELLED],
  completed:        [SO_DELIVERING, SO_CANCELLED],
  rejected:         [SO_DRAFT, SO_CANCELLED],      // ตีกลับให้แก้แล้วยืนยันใหม่ได้ ไม่ต้องเปิดใบใหม่
  cancelled:        []
};
/**
 * ★★ ใบนี้ถูกนับใน "ยอดขายวันนี้" (sales_daily) หรือเปล่า — **นิยามเดียวของทั้งระบบ**
 * ร่าง = ยังไม่ใช่การขาย · ยกเลิก = ไม่ใช่แล้ว · **ปฏิเสธการขาย = ศูนย์ตีกลับ ไม่ได้ขาย**
 *
 * ★ ของเดิมกรองแค่ `cancelled` ใบที่ถูกปฏิเสธจึงยังค้างอยู่ในยอดขายวันนี้ทั้งที่ไม่ได้ขาย
 *   (เจ้าของระบบเห็นจากการ์ดบนแดชบอร์ด 17 ต.ค. 2026)
 * ★ ทุกจุดที่ขยับ sales_daily ต้องถามผ่านฟังก์ชันนี้ ห้ามไล่เทียบสถานะเอง — ไม่งั้นวันหนึ่ง
 *   จะมีจุดที่หักออกแต่ไม่มีจุดที่บวกคืน แล้วยอดรายวันเพี้ยนสะสมโดยไม่มีใครรู้
 */
function saleCountsInDaily(status) {
  var s = String(status || '').toLowerCase();
  return s !== SO_DRAFT && s !== SO_CANCELLED && s !== SO_REJECTED;
}

/* สถานะที่ "มือถือยังเป็นเจ้าของใบอยู่" — แก้/ยกเลิกเองได้ตามกติกาข้อ 3 ของเจ้าของระบบ
   ร่าง = แก้ได้+ยกเลิกได้ · ยืนยันแล้วแต่ศูนย์ยังไม่รับงาน = ยกเลิกได้ แต่แก้ไม่ได้ · รับงานแล้ว = ทำอะไรไม่ได้ */
var SO_MOBILE_EDITABLE = [SO_DRAFT];
var SO_MOBILE_CANCELLABLE = [SO_DRAFT, SO_CONFIRMED, SO_PENDING];

/* ═══════════ จุดตัดสต็อกของเรา — เขียนกำกับไว้ตามที่คู่มือกำชับ (guide ข้อ 1.2) ═══════════
 * **ขายจากรถ (fulfillment_type = 'immediate')**: ตัดสต็อกรถของพนักงานคนนั้น **ตอนบันทึกบิล** จุดเดียว
 *   (`_cutVanStock` ใน 07_sales.gs) เพราะของออกจากรถถึงมือลูกค้าไปแล้วจริงๆ ณ วินาทีที่กดบันทึก
 *   การเปลี่ยนสถานะหลังจากนั้น **ไม่แตะสต็อกอีกเลย** — ตัดซ้ำคือบั๊กที่มองไม่เห็นจากหน้าจอ
 * **ให้สำนักงานจัดส่ง (office_delivery)**: ตัดจาก **คลังกลาง** (warehouse_stock) ตอนเข้าสถานะ
 *   **"กำลังจัดส่ง" (delivering)** — เจ้าของระบบเลือกเอง 2026-09-27 · เหตุผลเดียวกับที่ Hippo Village
 *   ตัดที่ ready_to_ship: ของถูกหยิบออกจากชั้นและแพ็คขึ้นรถแล้ว มันไม่ได้อยู่ในคลังอีกต่อไปตั้งแต่ตอนนั้น
 *   ถ้ารอตัดตอน "ส่งของแล้ว" ระบบจะบอกว่ามีของ ทั้งที่ของนอนอยู่ในกล่อง แล้วจะมีคนมาขายซ้ำ
 *   ถอยกลับเป็น "รอจัดส่ง" = คืนของเข้าคลัง · ยกเลิกหลังเลยจุดนี้ = คืนของเข้าคลังเช่นกัน
 *
 * saleStockTaken() = นิยามเดียวของ "ของถูกตัดไปแล้ว" ทำให้จุดที่ตัด กับ จุดที่ต้องคืนของตอนยกเลิก
 * อ้างนิยามเดียวกัน วันที่ย้ายจุดตัด แก้ที่นี่ที่เดียวแล้วทั้งสองฝั่งขยับตามพร้อมกัน (guide ข้อ 1.4)
 * **ห้ามตัดซ้ำในขั้นถัดไปเด็ดขาด** — updateSalesOrderStatus เทียบค่าก่อน/หลังแล้วขยับเฉพาะตอนค่าเปลี่ยน
 */
/* ★ 1 ต.ค. 2026 ย้ายจุดตัดจาก "กำลังจัดส่ง" มาที่ **"พร้อมจัดส่ง"** (เจ้าของระบบเลือกเอง)
   เพราะขั้นนั้นคือตอนที่ของถูกหยิบออกจากชั้น แพ็ค และออกใบกำกับภาษี/ใบจัดส่งแล้ว — ของไม่ได้อยู่ในคลังอีกต่อไป
   รอตัดตอนรถออกวิ่ง = ระบบบอกว่ามีของทั้งที่ของนอนอยู่ในกล่อง แล้วจะมีคนมาขายซ้ำ (เหตุผลเดียวกับที่เคยย้ายมาที่ delivering)
   ไม่ต้องแก้ที่อื่นเลย — จุดตัดและจุดคืนของอ่านจาก saleStockTaken() ตัวเดียวกันทั้งคู่ */
var SO_STOCK_TAKEN_STATUSES = [SO_READY, SO_DELIVERING, SO_COMPLETED];
/* ★ "ถึงขั้นพร้อมจัดส่งแล้วหรือยัง" — จุดที่เอกสารการเงินเริ่มมีผล (ใบกำกับภาษี/ลูกหนี้)
   นิยามอยู่ที่นี่ที่เดียวเพราะโมดูลนี้เป็นเจ้าของสถานะบิลขาย · `19_sales_admin.gs` และ
   `23_accounting.gs` เรียกตัวนี้ ห้ามก๊อบลิสต์สถานะไปเขียนซ้ำ */
var SO_REACHED_READY_STATUSES = [SO_READY, SO_DELIVERING, SO_COMPLETED, SO_CANCELLED];
function soReachedReady(status) { return SO_REACHED_READY_STATUSES.indexOf(String(status || '')) !== -1; }
/* ยอดจอง (กันของไว้แต่ยังไม่ตัดจริง) ย้ายไปอยู่ที่ `DR_RESERVE_STATUSES` + `saleReserveBaseByProduct()`
   ใน 48_delivery_rounds.gs — เพราะ "ควรกันไว้เท่าไร" ไม่ใช่คำถามแบบใช่/ไม่ใช่ตามสถานะอีกแล้ว
   แต่เป็นจำนวน: ของที่สั่ง − ของที่ส่งไปแล้วในรอบก่อนๆ − ของที่รอบนี้ถูกตัดไปแล้ว */
function saleStockTaken(order) {
  if (!order) return false;
  if (String(order.fulfillment_type) === 'immediate') return true;          // ตัดไปแล้วตั้งแต่บันทึกบิล
  return SO_STOCK_TAKEN_STATUSES.indexOf(_soStatusOf(order)) !== -1;
}

/** คลังที่บิลนี้ตัดของออก — ตัวแทนใช้คลังของตัวเอง - ขายตรงของบริษัท (HOUSE) ใช้คลังกลางของบริษัท (scope ว่าง) */
function _saleStockScope(tenantId) {
  return String(tenantId) === HOUSE_TENANT_ID ? '' : String(tenantId || '');
}

/**
 * ขยับสต็อกคลังกลางของบิล office_delivery - dir = -1 ตัดออก - dir = +1 คืนเข้า
 * ของไม่พอ = ไม่ขยับอะไรเลยสักตัว (เช็คให้ครบก่อนค่อยเขียน ไม่ตัดครึ่งๆ กลางๆ แล้วค้างไว้แบบนั้น)
 * ต้องเรียกใต้ _withDocLock เท่านั้น - ใช้ _applyStockIn ตัวเดียวกับงานรับของเข้าคลัง (22_purchase_order.gs)
 */
function applySaleWarehouseStock(tenantId, order, dir, reason, userId) {
  var scope = _saleStockScope(tenantId);
  var warehouseId = _ensureScopeWarehouse(scope);
  /* ★ 14 ต.ค. 2026 — ตัด/คืน "ตามรอบจัดส่งปัจจุบัน" ไม่ใช่ทั้งใบ (48_delivery_rounds.gs)
     บิลที่ไม่เคยแยกรอบ ตัวนี้คืนทั้งใบให้เหมือนเดิมเป๊ะ จึงไม่กระทบบิลใบไหนที่มีอยู่
     ★★ ขาคืนต้องอ่านจากตัวเดียวกับขาตัดเสมอ — รอบที่เลยขั้นรับงานไปแล้วจึงห้ามแก้จำนวน (saveDeliveryRound กันไว้) */
  var need = saleShipBaseByProduct(tenantId, order);
  var pids = Object.keys(need);
  if (!pids.length) return { success: true, moved: 0 };

  var stock = {}, cost = {};
  _scoped('warehouse_stock', scope).forEach(function(r) {
    if (String(r.warehouse_id) !== String(warehouseId)) return;
    stock[String(r.product_id)] = Number(r.qty) || 0;
    cost[String(r.product_id)] = Number(r.avg_cost) || 0;
  });

  if (dir < 0) {
    var names = {};
    centralObjects('products').forEach(function(pr) { names[String(pr.record_id)] = pr.name; });
    var short = [];
    pids.forEach(function(pid) {
      var have = stock[pid] || 0;
      if (have < need[pid]) short.push((names[pid] || ('สินค้า ' + pid)) + ' (มี ' + have + ' ต้องใช้ ' + need[pid] + ')');
    });
    if (short.length) return { success: false, message: 'ของในคลังไม่พอ: ' + short.join(' · ') };
  }

  /* ★★ คิดต้นทุน **ก่อน** ของออกจากคลัง — FIFO ไล่ล็อตจาก stock_ledger ซึ่ง _applyStockIn
     เพิ่งเขียนแถวของการขายรอบนี้ลงไป คิดทีหลังจะได้ล็อตถัดไปที่แพงกว่า (ดู prepareSaleCogs) */
  var prepared = dir < 0 ? prepareSaleCogs(scope, warehouseId, order, need, cost) : null;

  pids.forEach(function(pid) {
    _applyStockIn(scope, warehouseId, pid, dir * need[pid], cost[pid] || 0,
      dir < 0 ? 'sale_out' : 'sale_return', 'SALES_ORDER', order.record_id, reason, userId);
  });

  /* ★ ต้นทุนขายลงที่นี่ที่เดียว เพราะนี่คือ "จุดที่ของออกจากคลังเพราะการขาย" จุดเดียวในระบบ
       (50_cogs.gs) · ปิดไว้เป็นค่าเริ่มต้น เปิดที่เมนู 5.9.1 วิธีตัดต้นทุนขาย
     ★★ ต้องคิดต้นทุน **ก่อน** `_applyStockIn` ขยับยอดสำหรับวิธี FIFO ไหม? ไม่ต้อง —
       `_fifoCost` ไล่จาก `stock_ledger` ซึ่ง `_applyStockIn` เพิ่งเขียนแถวของรอบนี้ลงไปแล้ว
       ล็อตจึงถูกกินไปด้วยพอดี ถ้าเรียกก่อนจะได้ต้นทุนของล็อตที่ยังไม่ถูกตัด = นับซ้ำรอบหน้า
     ★ ลงบัญชีล้มไม่ทำให้ของที่ตัดไปแล้วย้อนกลับ — postSaleCogs จับ error เองและคืนเหตุผลมา */
  var cogs = dir < 0
    ? postSaleCogs(scope, order, prepared, userId)
    : reverseSaleCogs(scope, order, userId, reason);
  return { success: true, moved: pids.length, cogs: cogs };
}

/* ═══════════ ยอดจอง (reserved) — guide ข้อ 1.3 ═══════════
 * บิล office_delivery ยังไม่ตัดสต็อกจริงจนกว่าจะเข้า "กำลังจัดส่ง" (จุดตัดจริง ดูหัวข้อด้านบน) แต่ระหว่างที่ยังไม่ถึงจุดนั้น
 * ต้อง "กันของไว้" ไม่งั้นสองบิลยืนยันของชิ้นเดียวกันพร้อมกันได้ แล้วไปเจอตอนจะตัดว่าของไม่พอ (ตอนนั้นสัญญากับลูกค้าไปแล้วทั้งสองราย)
 *   on-hand   = warehouse_stock.qty (ของที่อยู่ในคลังจริง)
 *   reserved  = ผลรวม stock_reservations ที่ status='active' ของสินค้านั้น
 *   available = on-hand − reserved  ← ตัวที่ใช้ตัดสินว่าขายได้ไหม (ไม่ใช่ on-hand ตรงๆ)
 * เก็บเป็นแถวแยกต่อ (บิล, สินค้า) ไม่ใช่ตัวเลขรวม — รู้ว่าใครจอง จองให้ใบไหน และปลดทีละใบได้ (guide บอกไว้ชัดว่าอย่ายุบรวม)
 * ปลดจองพร้อมกับตอนตัดของจริงเสมอ (updateSalesOrderStatus) ไม่งั้นของถูกนับสองทาง (หายจาก on-hand แล้วยังกันยอดจองไว้อีก)
 */
function _reservedQty(scope, warehouseId, productId) {
  var sum = 0;
  _scoped('stock_reservations', scope).forEach(function(r) {
    if (r.status === 'active' && String(r.warehouse_id) === String(warehouseId) && String(r.product_id) === String(productId)) sum += Number(r.qty) || 0;
  });
  return sum;
}
function getAvailableQty(scope, warehouseId, productId) {
  var onHand = 0;
  _scoped('warehouse_stock', scope).forEach(function(r) { if (String(r.warehouse_id) === String(warehouseId) && String(r.product_id) === String(productId)) onHand = Number(r.qty) || 0; });
  return onHand - _reservedQty(scope, warehouseId, productId);
}

/** เช็คของพอขายไหม (อ่านอย่างเดียว) — เรียกก่อนสร้างบิล office_delivery เหมือนที่ฝั่งรถเช็ค van_stock ก่อนสร้างบิล
 *  need: { productId: จำนวนหน่วยฐานที่ต้องใช้ }  ของไม่พอสักตัวเดียว = ปฏิเสธทั้งใบ ไม่ใช่ตัดครึ่งๆ กลางๆ */
// ★ 2026-09-30 เจ้าของระบบสั่ง: office_delivery ของไม่พอ = แค่เตือน ไม่ใช่ error ที่ห้ามบันทึก — ต่างจากขายจากรถ
// (fulfillmentType='immediate', เช็คแยกใน recordSale/recordSaleAdmin) ที่ยังบล็อกเหมือนเดิม เพราะของบนรถต้องมี
// จริงถึงจะยื่นให้ลูกค้าได้ทันที ส่วน office_delivery เป็นแค่ "คำมั่นว่าจะส่งของให้" ของยังไม่ต้องอยู่ครบตอนนี้
// (อาจกำลังสั่งซื้อเพิ่มอยู่) — จองไปก่อนได้แม้เกินของที่มีจริง สะท้อนออกมาเป็น "ขายได้" ติดลบที่หน้าคลังสินค้า
// (บทความคู่มือ purchasing-03 อธิบายไว้แล้วว่าเลขติดลบตรงนั้นคือสัญญาณเตือนให้รีบสั่งของเพิ่ม)
function checkOfficeDeliveryStock(tenantId, need) {
  var scope = _saleStockScope(tenantId);
  var warehouseId = _ensureScopeWarehouse(scope);
  var pids = Object.keys(need);
  if (!pids.length) return { success: true, warehouseId: warehouseId };

  var names = {};
  centralObjects('products').forEach(function(pr) { names[String(pr.record_id)] = pr.name; });
  var short = [];
  pids.forEach(function(pid) {
    var avail = getAvailableQty(scope, warehouseId, pid);
    if (avail < need[pid]) short.push((names[pid] || ('สินค้า ' + pid)) + ' (ขายได้จริง ' + avail + ' หลังหักที่จองไว้แล้ว ต้องใช้ ' + need[pid] + ')');
  });
  var warning = short.length ? ('ของในคลังไม่พอขาย (บันทึกบิลแล้ว แต่ต้องรีบสั่งของเพิ่ม): ' + short.join(' · ')) : '';
  return { success: true, warehouseId: warehouseId, warning: warning };
}

/** จองของให้บิล office_delivery ใบหนึ่ง (เขียนแถว 'active' ทีละสินค้า) — เรียกหลังสร้างบิลแล้ว (ต้องมี orderId)
 *  เหมือน _cutVanStock ของฝั่งรถ: เช็คผ่านจาก checkOfficeDeliveryStock() มาก่อนแล้ว ตรงนี้แค่เขียน ไม่เช็คซ้ำ */
function reserveStockForSale(tenantId, warehouseId, need, orderId) {
  var scope = _saleStockScope(tenantId);
  Object.keys(need).forEach(function(pid) {
    if (!need[pid]) return;
    centralAppend('stock_reservations', { record_id: centralNextId('stock_reservations'), tenant_id: scope, warehouse_id: warehouseId,
      product_id: pid, qty: need[pid], order_id: orderId, status: 'active', created_at: nowStr(), released_at: '' });
  });
}

/** ปลดจองของบิลใบหนึ่งทั้งหมด (ไม่แตะ warehouse_stock — ของยังอยู่ในคลังเดิมเป๊ะ แค่เลิกกันไว้ให้บิลนี้)
 *  เรียกตอน: (1) บิลเข้าจุดตัดสต็อกจริงแล้ว — การจองหมดหน้าที่ กลายเป็นของที่ถูกตัดจริงแทน (2) ยกเลิกบิลก่อนถึงจุดตัด */
function releaseStockReservation(tenantId, orderId) {
  var scope = _saleStockScope(tenantId);
  var sh = centralSheet('stock_reservations');
  var data = sh.getDataRange().getValues();
  var hdr = data[0], idCol = hdr.indexOf('order_id'), tCol = hdr.indexOf('tenant_id'), statusCol = hdr.indexOf('status'), relCol = hdr.indexOf('released_at');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(orderId) && String(data[i][tCol] || '') === String(scope) && data[i][statusCol] === 'active') {
      sh.getRange(i + 1, statusCol + 1).setValue('released');
      sh.getRange(i + 1, relCol + 1).setValue(nowStr());
    }
  }
  centralInvalidate('stock_reservations');   // เขียนชีตแบบดิบ — ล้าง memo ในคำขอนี้ ไม่งั้นการตรวจของหลังปลดจองยังเห็นยอดจองเก่า
}

var PAY_UNPAID = 'unpaid', PAY_PARTIAL = 'partial', PAY_PAID = 'paid';
var SO_PAYMENT_LABELS = { unpaid: 'ยังไม่ชำระ', partial: 'ชำระบางส่วน', paid: 'ชำระแล้ว' };

/** สถานะการเงินตั้งต้นตอนเปิดบิล: ขายสดที่ตัดสต็อกไปแล้ว = รับเงินแล้ว · นอกนั้นยังไม่ชำระ */
function initialPaymentStatus(paymentMethod, fulfillmentType) {
  var cash = String(paymentMethod || 'cash').toLowerCase() !== 'credit';
  return (cash && fulfillmentType === 'immediate') ? PAY_PAID : PAY_UNPAID;
}

/** อ่านสถานะของแถวเก่าที่ยังไม่มีคอลัมน์ payment_status (บิลที่บันทึกก่อนสคีมานี้) */
function orderPaymentStatus(order) {
  var s = String((order && order.payment_status) || '').toLowerCase();
  if (s) return s;
  return initialPaymentStatus(order && order.payment_method, order && order.fulfillment_type);
}

function _soStatusOf(order) {
  var s = String((order && order.status) || '').toLowerCase();
  return SO_STATUS_LABELS[s] ? s : SO_PENDING;
}

/** เขียนประวัติหนึ่งบรรทัด — เรียกทุกครั้งที่สถานะขยับ (รวมตอนเปิดบิลและตอนยกเลิก)
 *  by/byRole = ชื่อและตำแหน่งของคนลงมือ ณ เวลานั้น (guide ข้อ 1.6) — ผู้เรียกต้องส่งมาให้ครบ
 *  ไม่ไปเปิดหาเองที่นี่ เพราะ "ตำแหน่ง" มาจากคนละที่กันระหว่างฝั่งมือถือ (liff_users.role) กับฝั่งแอดมิน (roles.role_label) */
function logOrderStatus(tenantId, orderId, from, to, fromPay, toPay, note, by, byRole) {
  try {
    tenantAppend(tenantId, 'order_status_log', {
      record_id: tenantNextId(tenantId, 'order_status_log'), order_id: orderId,
      from_status: from || '', to_status: to || '', from_payment: fromPay || '', to_payment: toPay || '',
      note: String(note || ''), changed_by: String(by || ''), changed_by_role: String(byRole || ''), changed_at: nowStr()
    });
  } catch (e) {
    Logger.log('logOrderStatus: ' + e);   // ประวัติเขียนไม่ได้ ไม่ควรทำให้การเปลี่ยนสถานะล้มทั้งรายการ
  }
}

/** ประวัติของบิลหนึ่งใบ เรียงเก่า→ใหม่ */
function orderStatusLog(tenantId, orderId) {
  // ไฟล์ตัวแทนที่ยังไม่ได้ migrate ยังไม่มี tab นี้ — ถือว่ายังไม่มีประวัติ ไม่ใช่ข้อผิดพลาด
  return tenantObjectsIfExists(tenantId, 'order_status_log')
    .filter(function(r) { return String(r.order_id) === String(orderId); })
    .sort(function(a, b) { return safeDateStr(a.changed_at).localeCompare(safeDateStr(b.changed_at)); })
    .map(function(r) { return {
      from: r.from_status || '', to: r.to_status || '', fromPayment: r.from_payment || '', toPayment: r.to_payment || '',
      fromLabel: SO_STATUS_LABELS[r.from_status] || r.from_status || '',
      toLabel: SO_STATUS_LABELS[r.to_status] || r.to_status || '',
      fromPaymentLabel: SO_PAYMENT_LABELS[r.from_payment] || '', toPaymentLabel: SO_PAYMENT_LABELS[r.to_payment] || '',
      note: r.note || '', by: r.changed_by || '', byRole: r.changed_by_role || '', at: safeDateStr(r.changed_at)
    }; });
}

/** เขียนค่าหลายคอลัมน์ลงแถวบิลขายด้วยการเปิดชีตรอบเดียว (tenantUpdate เขียนทีละคอลัมน์ไม่คุ้มที่นี่) */
function _updateOrderRow(tenantId, orderId, fields) {
  var sh = tenantSheet(tenantId, 'sales_orders');
  var data = sh.getDataRange().getValues();
  var hdr = data[0], idCol = hdr.indexOf('record_id');
  if (idCol === -1) return false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) !== String(orderId)) continue;
    Object.keys(fields).forEach(function(k) {
      var col = hdr.indexOf(k);
      if (col >= 0) sh.getRange(i + 1, col + 1).setValue(fields[k]);
    });
    return true;
  }
  return false;
}

/**
 * เปลี่ยนสถานะบิลขาย
 * payload: { id, tenantId?, status?, paymentStatus?, paidAmount?, note? }
 *   ส่งมาแกนเดียวหรือสองแกนพร้อมกันก็ได้ · ยกเลิกบิลใช้ cancelSalesOrderAdmin แทน (ต้องคืนสต็อก/หักยอดขาย)
 */
function updateSalesOrderStatus(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  ensureTenantSheetsCurrent(tenantId);   // ไฟล์ตัวแทนเก่าอาจยังไม่มีคอลัมน์ payment_status / tab ประวัติ

  return _withDocLock(function() {
    var order = null;
    order = tenantRowById(tenantId, 'sales_orders', payload.id);
    if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

    var fromStatus = _soStatusOf(order), fromPay = orderPaymentStatus(order);
    var toStatus = fromStatus, toPay = fromPay;
    var fields = {}, changes = [], justBecameReady = false, rollNote = '', roundWarn = '';

    // ── แกนการส่งของ ──
    if (payload.status !== undefined && payload.status !== null && String(payload.status) !== '') {
      toStatus = String(payload.status).toLowerCase();
      if (!SO_STATUS_LABELS[toStatus]) return { success: false, message: 'สถานะไม่ถูกต้อง' };
      if (toStatus === SO_CANCELLED) return { success: false, message: 'ยกเลิกบิลต้องใช้ปุ่มยกเลิก (ระบบต้องคืนสต็อกและหักยอดขายให้ด้วย)' };
      if (toStatus !== fromStatus) {
        if (fromStatus === SO_CANCELLED) return { success: false, message: 'บิลที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้' };
        if (SO_TRANSITIONS[fromStatus].indexOf(toStatus) === -1) {
          return { success: false, message: 'เปลี่ยนจาก "' + SO_STATUS_LABELS[fromStatus] + '" เป็น "' + SO_STATUS_LABELS[toStatus] + '" ไม่ได้' };
        }
        /* ★ ของในรอบนี้ยังไม่ได้ระบุเลย = เดินหน้าไปไม่ได้ (จะได้ใบจัดของเปล่าและไม่มีของออกจากคลัง)
           เกิดได้เฉพาะใบที่แยกรอบไว้แล้ว — เช็คจากคอลัมน์บนแถวบิลก่อน ใบปกติจึงไม่จ่ายค่าอ่านตารางรอบ */
        if (toStatus === SO_READY && saleOrderHasRounds(order)) {
          var pReady = saleDeliveryPlan(tenantId, order);
          if (!pReady.roundQty) return { success: false, message: 'รอบจัดส่งนี้ยังไม่ได้ระบุของที่จะส่ง — กด "แยกของค้างส่ง" เพื่อเลือกของที่จะส่งรอบนี้ก่อน' };
        }
        /* ★★ "จัดส่งสำเร็จ" แต่ยังมีของค้างส่ง = **ปิดรอบนี้แล้วเปิดรอบถัดไป ไม่ใช่ปิดบิล** (14 ต.ค. 2026)
           แอดมินกดปุ่มเดิมปุ่มเดียว ระบบตัดสินจากของที่ยังไม่ได้ส่งเอง — จึงไม่ต้องมีสถานะบิลใหม่
           และของรอบที่ปิดแล้ว **ห้ามคืนเข้าคลัง** (ถึงมือลูกค้าไปแล้ว) ต้องข้ามบล็อกขยับสต็อกข้างล่างทั้งก้อน
           เพราะปลายทางถูกเปลี่ยนเป็น accepted ซึ่งเป็นสถานะ "ยังไม่ตัดของ" ถ้าปล่อยให้เข้าบล็อกนั้นของจะงอกคืน */
        var roll = (toStatus === SO_COMPLETED) ? saleDeliveryPlan(tenantId, order) : null;
        if (roll && !(roll.currentRound && roll.shortLines)) roll = null;
        if (roll) toStatus = SO_ACCEPTED;

        if (!roll) {
          // ★ ขยับสต็อกเฉพาะตอนค่า "ของถูกตัดไปแล้ว" เปลี่ยน — ขั้นถัดไปจากจุดตัดจึงไม่ตัดซ้ำ
          var wasTaken = saleStockTaken(order);
          var willTake = saleStockTaken({ fulfillment_type: order.fulfillment_type, status: toStatus });
          if (wasTaken !== willTake) {
            var mv = applySaleWarehouseStock(tenantId, order, willTake ? -1 : 1,
              'บิล ' + order.order_code + ' -> ' + SO_STATUS_LABELS[toStatus], session.adminUserId);
            if (!mv.success) return mv;
            changes.push(willTake ? 'ตัดสต็อกออกจากคลังแล้ว' : 'คืนของเข้าคลังแล้ว');
          }
        }
        fields.status = toStatus;
        /* ★★ ยอดขายรายวันต้องขยับตามเมื่อใบ "เข้า/ออก" จากการเป็นยอดขาย — ที่สำคัญคือ
           **ปฏิเสธการขาย** (ตีกลับ) ต้องหักออก และถ้าตีกลับแล้วเอากลับมาเดินต่อ ต้องบวกคืน
           เทียบด้วย saleCountsInDaily() ทั้งสองฝั่ง จึงไม่มีทางหักซ้ำหรือบวกซ้ำ */
        var wasCounted = saleCountsInDaily(fromStatus), nowCounted = saleCountsInDaily(toStatus);
        if (wasCounted !== nowCounted) {
          var dAmt = parseFloat(order.total) || 0, dEx = orderExVat(order);
          bumpSalesDaily(tenantId, _dOnly(order.created_at), nowCounted ? 1 : -1,
            nowCounted ? dAmt : -dAmt, nowCounted ? dEx : -dEx);
          changes.push(nowCounted ? 'นับกลับเข้ายอดขายรายวัน' : 'หักออกจากยอดขายรายวัน');
        }
        /* ★ ออกเลขจริงตรงนี้ด้วย — ศูนย์เลื่อนสถานะเองโดยที่พนักงานไม่เคยกดยืนยันในแอปเป็นเรื่องปกติ
           (ศูนย์เปิดบิลแทน / พนักงานลืมกด) ใบพวกนั้นเคยค้างเลข DRAFT- ตลอดไป
           ★★ ต้องออกก่อนบล็อกออกเลขเอกสารอื่นข้างล่าง เพราะใบส่งของ/ใบกำกับภาษีอ้างเลขบิลใบนี้ */
        if (toStatus !== SO_DRAFT && isDraftOrderCode(order.order_code)) {
          fields.order_code = realOrderCodeFor(tenantId, order);
          order.order_code = fields.order_code;          // ให้โค้ดที่เหลือในฟังก์ชันเห็นเลขใหม่
          changes.push('ออกเลขที่เอกสาร ' + fields.order_code);
        }
        if (roll) {
          var rv = rolloverDeliveryRound(tenantId, order, session, roll);
          for (var fk in rv.fields) fields[fk] = rv.fields[fk];
          rv.changes.forEach(function(c) { changes.push(c); });
          /* ★ ประวัติต้องตอบได้เองว่า "ทำไมบิลถึงถอยจากกำลังจัดส่งกลับมาขั้นรับงาน"
             บรรทัดที่เขียนว่า delivering → accepted เฉยๆ โดยไม่มีเหตุผล คือสิ่งที่คนมาอ่านย้อนหลังแล้วงง
             (และเป็นคนละคนกับคนที่กดด้วย) */
          rollNote = rv.changes.join(' · ');
        }
        if (!roll && toStatus === SO_COMPLETED) {
          fields.delivered_at = nowStr();
          // ใบที่แยกรอบไว้และส่งครบแล้ว — ปิดรอบสุดท้ายเป็น "ส่งสำเร็จ" ด้วย ไม่ปล่อยค้างเป็น open ตลอดไป
          if (saleOrderHasRounds(order)) {
            var lastNo = closeLastDeliveryRound(tenantId, order, saleDeliveryPlan(tenantId, order), session);
            if (lastNo) changes.push('ปิดรอบที่ ' + lastNo + ' (ส่งสำเร็จ)');
          }
        }
        if (toStatus === SO_PENDING || toStatus === SO_DELIVERING) fields.delivered_at = '';
        /* ยอดจอง: ทำให้ตรงกับ "ที่ควรเป็น ณ สถานะปลายทาง" (syncSaleReservations ใน 48_delivery_rounds.gs)
           = ของที่สั่ง − ที่ส่งไปแล้ว − ที่เพิ่งถูกตัด · เรียกซ้ำไม่เกิดผลซ้ำ (ตรงอยู่แล้ว = ไม่เขียนอะไรเลย)
           ★ ต้องเรียก **หลัง** ปิด/เปิดรอบเสมอ ไม่งั้นมันยังเห็นว่ารอบที่เพิ่งส่งไปเป็นของที่ต้องกันไว้อยู่ */
        var rsync = syncSaleReservations(tenantId, order, toStatus);
        if (rsync.changed) changes.push(rsync.reserved ? 'กันของในคลังไว้ให้แล้ว' : 'ปลดของที่กันไว้');

        /* ★ ออกเลขใบส่งสินค้าตอนเข้าสถานะ "พร้อมจัดส่ง" (แอดมินขอ 6 ต.ค. 2026)
           ใบส่งของเป็นคนละเอกสารกับใบสั่งขาย เดิมพิมพ์โดยใช้เลขใบสั่งขายซ้ำ ทำให้อ้างอิงกันไม่ได้
           ★★ ออกครั้งเดียวต่อใบ: ถ้ามีเลขแล้วไม่ออกใหม่ — ถอยกลับไป "รับงาน" แล้วเดินหน้ามาใหม่
           ต้องได้เลขเดิม ไม่งั้นใบที่พิมพ์ส่งไปกับรถแล้วจะอ้างเลขที่ไม่มีอยู่ในระบบอีกต่อไป
           (เลขเอกสารกินตัวนับทุกครั้งที่เรียก ออกซ้ำ = เลขกระโดดโดยไม่มีเอกสารรองรับ) */
        /* ★ เอกสารฝั่งคลังออกตอน "อนุมัติ/เตรียมจัดส่ง" (เจ้าของระบบกำหนด 8 ต.ค. 2026)
           ใบจัดของกับใบส่งสินค้าเป็นของที่คนคลังต้องถือไปหยิบของ — ต้องมีตั้งแต่ตอนเริ่มจัด
           ไม่ใช่ตอนจัดเสร็จแล้ว (ของเดิมออกพร้อมใบกำกับภาษีที่ "พร้อมจัดส่ง" ซึ่งสายไปหนึ่งขั้น) */
        if (toStatus === SO_ACCEPTED) {
          var issA = issueSaleDocNos(tenantId, order, ['picking', 'delivery']);
          for (var ak in issA.fields) fields[ak] = issA.fields[ak];
          issA.issued.forEach(function(t) { changes.push('ออก' + t); });
        }
        if (toStatus === SO_READY) {
          /* ★ ส่งมอบสินค้า = จุดที่ภาระภาษีเกิด (tax point ของการขายสินค้าคือการส่งมอบ)
             ใบจัดของ/ใบส่งสินค้าออกไปตั้งแต่ขั้นรับงานแล้ว — ใส่ไว้ที่นี่ด้วยเป็นกันชนของบิลเก่า
             ที่ข้ามขั้นมาตั้งแต่ก่อนเปลี่ยนกติกา (issueSaleDocNos ข้ามชนิดที่มีเลขแล้วเสมอ)
             ★★ 15 ต.ค. 2026 — บิลที่แยกรอบจัดส่ง ออก **ใบกำกับภาษีและใบแจ้งหนี้ของรอบนั้น** ตามของที่ส่งจริง
               (เจ้าของระบบเปลี่ยนมติหลังดูระบบจริงของบริษัทอื่น · ถูกต้องกว่าเดิมด้วย เพราะออกใบกำกับ
               เต็มจำนวนทั้งที่ส่งไปแค่ครึ่งเดียว = ใบกำกับระบุของเกินจริง)
               ของที่เหลือได้ใบใหม่ตอนรอบถัดไปเข้าพร้อมจัดส่ง — ดู issueRoundInvoices (48_delivery_rounds.gs) */
          var issR = issueSaleDocNos(tenantId, order, ['picking', 'delivery']);
          for (var rk2 in issR.fields) fields[rk2] = issR.fields[rk2];
          issR.issued.forEach(function(t) { changes.push('ออก' + t); });

          var planReady = saleOrderHasRounds(order) ? saleDeliveryPlan(tenantId, order) : null;
          if (planReady && planReady.currentRound) {
            var inv = issueRoundInvoices(session, tenantId, order, planReady, planReady.currentRound);
            inv.changes.forEach(function(c) { changes.push(c); });
            roundWarn = inv.warning || '';
            // แถวบิลสะท้อนเลขใบกำกับของ "รอบปัจจุบัน" (หลักเดียวกับใบจัดของ/ใบส่งสินค้า) — เลขของรอบก่อนๆ ยังอยู่ที่แถวรอบ
            if (inv.taxInvoiceNo) { fields.tax_invoice_no = inv.taxInvoiceNo; fields.tax_invoice_at = nowStr(); }
          } else {
            var iss = issueSaleDocNos(tenantId, order, ['tax']);
            for (var kk in iss.fields) fields[kk] = iss.fields[kk];
            iss.issued.forEach(function(t) { changes.push('ออก' + t); });
          }
        }
        justBecameReady = (toStatus === SO_READY);
        changes.push(SO_STATUS_LABELS[fromStatus] + ' → ' + SO_STATUS_LABELS[toStatus]);
      }
    }

    // ── แกนการเงิน ──
    var total = parseFloat(order.total) || 0;
    if (payload.paidAmount !== undefined && payload.paidAmount !== null && String(payload.paidAmount) !== '') {
      var paid = parseFloat(String(payload.paidAmount).replace(/,/g, ''));
      if (isNaN(paid) || paid < 0) return { success: false, message: 'ยอดที่รับชำระต้องเป็นตัวเลขไม่ติดลบ' };
      if (paid > total + 0.009) return { success: false, message: 'ยอดที่รับชำระ (' + paid + ') มากกว่ายอดบิล (' + total + ')' };
      fields.paid_amount = Math.round(paid * 100) / 100;
      toPay = paid <= 0.009 ? PAY_UNPAID : (paid >= total - 0.009 ? PAY_PAID : PAY_PARTIAL);
    } else if (payload.paymentStatus) {
      toPay = String(payload.paymentStatus).toLowerCase();
      if (!SO_PAYMENT_LABELS[toPay]) return { success: false, message: 'สถานะการชำระเงินไม่ถูกต้อง' };
      if (toPay === PAY_PAID) fields.paid_amount = total;
      if (toPay === PAY_UNPAID) fields.paid_amount = 0;
      if (toPay === PAY_PARTIAL) return { success: false, message: 'ชำระบางส่วนต้องระบุยอดที่รับมาด้วย' };
    }
    if (toPay !== fromPay) {
      fields.payment_status = toPay;
      fields.paid_at = toPay === PAY_UNPAID ? '' : nowStr();
      changes.push(SO_PAYMENT_LABELS[fromPay] + ' → ' + SO_PAYMENT_LABELS[toPay]);
      /* ใบเสร็จรับเงินออกตอน "ได้รับเงินจริงครั้งแรก" (รวมรับบางส่วน — ผู้จ่ายต้องได้หลักฐานทันที)
         ★ ออกครั้งเดียวต่อใบ: รับเพิ่มงวดถัดไปใช้เลขเดิม ไม่ใช่ออกใบใหม่ทุกครั้งที่รับเงิน
           (ถ้าอยากได้ใบต่อครั้ง ต้องทำเป็นเอกสารรับชำระแยกใบ ซึ่งเป็นคนละเรื่องกับใบเสร็จของบิลนี้) */
      if (toPay !== PAY_UNPAID) {
        var issR = issueSaleDocNos(tenantId, order, ['receipt']);
        for (var rk in issR.fields) fields[rk] = issR.fields[rk];
        issR.issued.forEach(function(t) { changes.push('ออก' + t); });
      }
    }

    if (!Object.keys(fields).length) return { success: false, message: 'ไม่มีอะไรเปลี่ยน' };
    fields.updated_at = nowStr();
    fields.updated_by = String(session.adminUserId || session.username || '');
    if (!_updateOrderRow(tenantId, order.record_id, fields)) return { success: false, message: 'บันทึกไม่สำเร็จ (ไม่พบแถวในชีต)' };

    logOrderStatus(tenantId, order.record_id, fromStatus, toStatus, fromPay, toPay,
      [String(payload.note || ''), rollNote].filter(function(x) { return x; }).join(' · '),
      session.displayName || session.username, _adminRoleLabel(session));

    /* ★ ตั้งลูกหนี้ + ออกใบแจ้งหนี้/ใบกำกับภาษีอัตโนมัติตอนเข้าสถานะ "พร้อมจัดส่ง" (เจ้าของระบบสั่ง)
       จุดนี้คือจุดที่ของถูกตัดออกจากคลังแล้วและเอกสารกำลังจะออกไปกับรถ — ภาระหนี้เกิดตรงนี้
       ★ เฉพาะบิลเครดิต: ขายสดเก็บเงินหน้าร้านแล้ว ไม่มีลูกหนี้ให้ตั้ง (กติกาเดียวกับ listUninvoicedSalesOrders)
       ★★ ออกใบไม่สำเร็จ "ห้ามล้มการเปลี่ยนสถานะ" — ของแพ็คขึ้นรถไปแล้ว ย้อนสถานะกลับไม่ได้
          รายงานเป็นคำเตือนแทน แล้วให้ฝ่ายบัญชีออกเองจากหน้าลูกหนี้ (ปุ่มเดิมยังอยู่ และกันซ้ำให้อยู่แล้ว)
       ★ ลงสมุดของเจ้าของบิล — `_normBook(tenantId)` ไม่ใช่สมุดของคนกด (ฝ่ายคลังอาจเป็นคนบริษัท) */
    /* ★ บิลที่แยกรอบจัดส่ง ตั้งลูกหนี้ไปแล้วรายรอบ (issueRoundInvoices) — ตรงนี้เหลือเฉพาะบิลที่ส่งรอบเดียวทั้งใบ */
    var arNote = roundWarn || '';
    /* ★ ขายสดแบบสำนักงานจัดส่ง: ใบกำกับภาษีออกตรงนี้ จึงลงบัญชีตรงนี้ (52_cash_sales_gl.gs)
       ขายจากรถลงไปแล้วตอนบันทึกบิล เพราะใบกำกับออกตั้งแต่ตอนนั้นและไม่เดินผ่านสถานะนี้
       ★ ตัวฟังก์ชันกันซ้ำเองด้วยเลขบิล บิลที่แยกรอบจึงเดินผ่านจุดนี้ซ้ำได้โดยไม่ลงซ้ำ */
    if (justBecameReady && !isCreditPayment(order.payment_method)) {
      var cashGl = postCashSaleGl(tenantId, tenantRowById(tenantId, 'sales_orders', order.record_id), session.adminUserId);
      if (cashGl && cashGl.posted) changes.push('ลงบัญชีขายสด ' + cashGl.journalNo);
    }
    if (justBecameReady && isCreditPayment(order.payment_method) && !saleOrderHasRounds(order)) {
      var ar = _createArInvoiceCore(session, { tenantId: tenantId, salesOrderId: order.record_id },
        typeof _normBook === 'function' ? _normBook(tenantId) : '');
      if (ar && ar.success) changes.push('ตั้งลูกหนี้ ' + ar.invoiceNo);
      /* ★ ตั้งไว้แล้ว = ปกติ ไม่ใช่คำเตือน — บิลที่แยกรอบจัดส่งจะเดินผ่าน "พร้อมจัดส่ง" อีกครั้งทุกรอบ
         แต่ลูกหนี้/ใบแจ้งหนี้มีใบเดียวต่อบิลเสมอ (14 ต.ค. 2026 · ดู 48_delivery_rounds.gs) */
      else if (ar && ar.duplicate) changes.push('ใบแจ้งหนี้ ' + ar.invoiceNo + ' (ตั้งไว้แล้ว)');
      else arNote = 'ยังไม่ได้ตั้งลูกหนี้: ' + ((ar && ar.message) || 'ไม่ทราบสาเหตุ');
    }

    return { success: true, status: toStatus, statusLabel: SO_STATUS_LABELS[toStatus],
      // ★ เลขบิลอาจเพิ่งถูกออกให้ในรอบนี้ (ใบที่พ้นร่าง) — หน้าจอต้องได้เลขใหม่ไปแสดงทันที
      orderCode: fields.order_code || order.order_code || '',
      deliveryOrderNo: fields.delivery_order_no || order.delivery_order_no || '',
      warning: arNote || undefined,
      paymentStatus: toPay, paymentLabel: SO_PAYMENT_LABELS[toPay],
      paidAmount: fields.paid_amount !== undefined ? fields.paid_amount : (parseFloat(order.paid_amount) || 0),
      deliveredAt: fields.delivered_at !== undefined ? fields.delivered_at : safeDateStr(order.delivered_at),
      message: changes.length ? changes.join(' · ') : 'บันทึกแล้ว' };
  });
}

/* ═══════════ เลขเอกสารของบิลขาย — เอกสารแต่ละชนิดมีเลขของตัวเอง (แอดมินขอ 7 ต.ค. 2026) ═══════════
 * เดิมทุกใบใช้เลขใบสั่งขายซ้ำกันหมด อ้างอิงกันไม่ได้เลย (ใบส่งสินค้าแยกออกไปก่อนแล้วเมื่อ 6 ต.ค.)
 *
 * ★ ออกเลข "ครั้งเดียวต่อใบต่อชนิด" — ถอยสถานะกลับแล้วเดินหน้าใหม่ต้องได้เลขเดิม
 *   ใบที่พิมพ์ส่งไปกับรถ/ให้ลูกค้าแล้วต้องอ้างเลขที่ยังมีอยู่จริงในระบบเสมอ
 *   และเลขเอกสารกินตัวนับทุกครั้งที่เรียก ออกซ้ำ = เลขกระโดดโดยไม่มีเอกสารรองรับ อธิบายกับผู้ตรวจไม่ได้
 *
 * ★★ จุดที่ออกเลขมีสามจุด อย่ากระจายไปมากกว่านี้:
 *   1. เข้าสถานะ "พร้อมจัดส่ง"  → ใบจัดของ + ใบส่งสินค้า + ใบกำกับภาษี (ส่งมอบสินค้า = tax point)
 *   2. รับชำระครั้งแรก          → ใบเสร็จรับเงิน
 *   3. เปิดบิลขายสดจากรถ        → ใบเสร็จรับเงิน + ใบกำกับภาษี (จบทั้งส่งของและรับเงินตั้งแต่กดบันทึก)
 *      อยู่ที่ recordSale (07_sales.gs) และ recordSaleAdmin (19_sales_admin.gs)
 */
var SALE_DOC_FIELDS = {
  picking:  { no: 'picking_no',        at: 'picking_at',        type: 'PICK', label: 'ใบจัดของ' },
  delivery: { no: 'delivery_order_no', at: 'delivery_order_at', type: 'DO',   label: 'ใบส่งสินค้า' },
  receipt:  { no: 'receipt_no',        at: 'receipt_at',        type: 'RC',   label: 'ใบเสร็จรับเงิน' },
  tax:      { no: 'tax_invoice_no',    at: 'tax_invoice_at',    type: 'TAX-IV', label: 'ใบกำกับภาษี' }
};

/**
 * ออกเลขเอกสารให้บิลขายตามชนิดที่ขอ — ข้ามชนิดที่ "มีเลขแล้ว" เสมอ
 * @param order ของเดิม (ส่ง null ตอนเปิดบิลใหม่ที่ยังไม่มีแถว = ออกใหม่ทุกชนิดที่ขอ)
 * @return { fields: {คอลัมน์ที่ต้องเขียน}, issued: ['ใบส่งสินค้า DO-...'] }
 */
function issueSaleDocNos(tenantId, order, kinds) {
  var fields = {}, issued = [];
  (kinds || []).forEach(function(k) {
    var m = SALE_DOC_FIELDS[k];
    if (!m) return;
    if (order && String(order[m.no] || '').trim()) return;   // ออกไปแล้ว ใช้เลขเดิม
    fields[m.no] = getNextDocNumber(tenantId, m.type);
    fields[m.at] = nowStr();
    issued.push(m.label + ' ' + fields[m.no]);
  });
  return { fields: fields, issued: issued };
}

/* ขั้นต่ำที่เอกสารแต่ละชนิด "ควรมีเลขแล้ว" — ชุดเดียวกับที่หน้าเว็บใช้กั้นปุ่มพิมพ์ (SO_DOC_MIN)
   แต่ฝั่งนี้คือตัวตัดสินจริง ห้ามเชื่อค่าที่หน้าเว็บส่งมา */
var SALE_DOC_READY_AT = {
  picking:  [SO_ACCEPTED, SO_READY, SO_DELIVERING, SO_COMPLETED],
  delivery: [SO_ACCEPTED, SO_READY, SO_DELIVERING, SO_COMPLETED],
  tax:      [SO_READY, SO_DELIVERING, SO_COMPLETED]
  // receipt ไม่ได้ดูสถานะการส่ง แต่ดูว่าได้รับเงินแล้วหรือยัง (ดูในฟังก์ชัน)
};

/**
 * ออกเลขเอกสารให้บิลที่ "ถึงขั้นแล้วแต่ยังไม่มีเลข" — เรียกตอนผู้ใช้กดพิมพ์เอกสารนั้น
 * (เจ้าของระบบสั่ง 8 ต.ค. 2026: ถึงขั้นแล้วแต่ยังไม่มีเอกสาร ให้การกดพิมพ์สร้างเลขให้เลย)
 *
 * ★★ ทำไมต้องอยู่ฝั่ง backend ทั้งหมด: เลขเอกสารกินตัวนับทุกครั้งที่ออก และ "พิมพ์ซ้ำสิบครั้ง
 *   ต้องได้เลขเดิมสิบครั้ง" · ถ้าให้หน้าเว็บเป็นคนตัดสินว่าจะออกเลขไหม สองเครื่องที่เปิดใบเดียวกัน
 *   แล้วกดพิมพ์พร้อมกันจะได้คนละเลข และเลขกระโดดโดยไม่มีเอกสารรองรับ
 *   → ตัดสินจากสถานะจริงในชีต + ออกภายใต้ _withDocLock + ข้ามชนิดที่มีเลขแล้วเสมอ (issueSaleDocNos)
 * ★ ไม่เขียน order_status_log เพราะสถานะไม่ได้เปลี่ยน — แต่บันทึกว่าออกเลขอะไรไว้ใน changes ที่ตอบกลับ
 */
function ensureSaleDocNo(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var kinds = payload.kinds || (payload.kind ? [payload.kind] : []);
  if (!kinds.length) return { success: false, message: 'ไม่ได้ระบุชนิดเอกสาร' };
  ensureTenantSheetsCurrent(tenantId);

  return _withDocLock(function() {
    var order = null;
    order = tenantRowById(tenantId, 'sales_orders', payload.id);
    if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

    var status = _soStatusOf(order), paid = orderPaymentStatus(order);
    /* ★★ 15 ต.ค. 2026 — บิลที่แยกรอบจัดส่ง ใบกำกับภาษีเป็นของ "รอบ" ไม่ใช่ของทั้งบิล
       ปุ่มพิมพ์จะต้องไม่ออกใบเต็มจำนวนมาทับ (จะกลายเป็นใบที่ระบุของเกินจริง และเลขจะชนกับใบของรอบ)
       ใบของรอบออกเองตอนรอบเข้า "พร้อมจัดส่ง" (issueRoundInvoices ใน 48_delivery_rounds.gs) */
    var hasRounds = saleOrderHasRounds(order);
    var want = [];
    kinds.forEach(function(k) {
      var m = SALE_DOC_FIELDS[k];
      if (!m) return;
      if (k === 'tax' && hasRounds) return;
      if (String(order[m.no] || '').trim()) return;          // มีเลขแล้ว ไม่ต้องทำอะไร
      var okNow = (k === 'receipt') ? (paid !== PAY_UNPAID)
        : ((SALE_DOC_READY_AT[k] || []).indexOf(status) !== -1);
      if (okNow) want.push(k);
    });

    var out = { success: true, issued: [], fields: {} };
    if (!want.length) {               // ไม่มีอะไรต้องออก — ตอบเลขที่มีอยู่กลับไปเฉยๆ ไม่ถือว่าผิดพลาด
      out.docNos = _saleDocNos(order);
      return out;
    }
    var iss = issueSaleDocNos(tenantId, order, want);
    tenantUpdate(tenantId, 'sales_orders', order.record_id, iss.fields);
    for (var k2 in iss.fields) order[k2] = iss.fields[k2];
    out.issued = iss.issued;
    out.docNos = _saleDocNos(order);
    return out;
  });
}

/** เลขเอกสารทุกชนิดของบิลนี้ ในรูปที่หน้าเว็บใช้ (ชื่อฟิลด์ตรงกับ getSalesOrderAdmin) */
function _saleDocNos(order) {
  return { deliveryOrderNo: order.delivery_order_no || '', pickingNo: order.picking_no || '',
           receiptNo: order.receipt_no || '', taxInvoiceNo: order.tax_invoice_no || '' };
}

/* ═══════════ ฝั่งแอปมือถือ: ยืนยันใบสั่งขาย / ยกเลิกใบของตัวเอง (1 ต.ค. 2026) ═══════════
 * กติกาเจ้าของระบบ:
 *   ร่าง        → แก้ได้ · ยกเลิกเองได้ · กด "ยืนยัน" เพื่อส่งให้ศูนย์
 *   ยืนยันแล้ว  → แก้ไม่ได้ · ยังยกเลิกเองได้ (ศูนย์ยังไม่รับงาน จึงยังไม่มีใครเสียหาย)
 *   รับงานแล้ว  → ทำอะไรเองไม่ได้เลย ต้องแจ้งศูนย์ให้ดำเนินการ
 * ทั้งสอง action ตรวจความเป็นเจ้าของด้วย `sale_by === lineUserId` เหมือน getSaleDetail (06_bootstrap.gs)
 * — พนักงานคนอื่นแตะใบที่ไม่ใช่ของตัวเองไม่ได้ แม้จะอยู่ตัวแทนเดียวกัน
 */
function _mobileOwnOrder(user, orderCode) {
  var found = null;
  tenantObjects(user.tenantId, 'sales_orders').forEach(function(o) {
    if (String(o.order_code) === String(orderCode) && String(o.sale_by) === String(user.lineUserId)) found = o;
  });
  return found;
}

/* ═══════════ รหัสชั่วคราวของใบร่าง → เลขที่เอกสารจริง ═══════════
 * ★★ บั๊กที่เจอบน prod (16 ต.ค. 2026): บิลสถานะ "รออนุมัติ" / "พร้อมจัดส่ง" หลายใบยังถือเลข
 *   `DRAFT-nn` อยู่ · สาเหตุคือ **มีสองทางที่พาใบออกจากร่าง แต่ออกเลขจริงอยู่ทางเดียว**
 *     - พนักงานกดยืนยันในแอปมือถือ → `confirmSalesOrder` ออกเลขให้
 *     - ศูนย์เลื่อนสถานะเองจากหน้าแอดมิน → `updateSalesOrderStatus` **ไม่เคยแตะ order_code เลย**
 *   ซึ่งทางหลังคือทางที่ศูนย์ใช้จริงเป็นส่วนใหญ่ เลขจึงค้างเป็น DRAFT- ไปตลอดชีวิตของใบนั้น
 * ★ แก้ด้วยการให้ทั้งสองทางเรียกตัวเดียวกัน — ทางที่สามที่จะเพิ่มทีหลังก็ต้องเรียกตัวนี้
 * ★ ใบที่มีเลขจริงอยู่แล้วไม่ออกซ้ำ (เลขเอกสารที่ออกไปแล้วห้ามเปลี่ยน) */
function isDraftOrderCode(code) { return String(code || '').indexOf('DRAFT-') === 0; }
function realOrderCodeFor(tenantId, order) {
  return isDraftOrderCode(order && order.order_code)
    ? getNextDocNumber(tenantId, 'SO') : (order && order.order_code) || '';
}

/** มือถือกดยืนยันว่าใบนี้ถูกต้องครบถ้วน → ส่งให้ศูนย์รับงาน */
function confirmSalesOrder(user, payload) {
  ensureTenantSheetsCurrent(user.tenantId);
  return _withDocLock(function() {
    var order = _mobileOwnOrder(user, (payload || {}).orderCode);
    if (!order) return { success: false, message: 'ไม่พบบิลนี้ หรือไม่ใช่บิลของท่าน' };
    var from = _soStatusOf(order);
    if (from === SO_CONFIRMED || from === SO_PENDING) return { success: true, status: from, alreadyDone: true, message: 'ใบนี้ยืนยันไปแล้ว' };
    if (from !== SO_DRAFT) return { success: false, message: 'ใบนี้อยู่ขั้น "' + SO_STATUS_LABELS[from] + '" แล้ว ยืนยันซ้ำไม่ได้' };
    /* ★ ออกเลขที่เอกสารจริงตรงนี้ — ใบร่างถือรหัสชั่วคราว `DRAFT-<id>` มาก่อน (ดู recordSale ใน 07_sales.gs)
       ร่างที่ถูกทิ้งจึงไม่กินเลข และเลขที่ออกไปแล้วเรียงต่อเนื่องเสมอ
       ใบที่ได้เลขจริงมาแล้ว (เช่นบิลเก่าก่อนกติกานี้) ไม่ออกซ้ำ */
    var newCode = realOrderCodeFor(user.tenantId, order);
    tenantUpdate(user.tenantId, 'sales_orders', order.record_id,
      { status: SO_CONFIRMED, order_code: newCode, updated_at: nowStr(), updated_by: user.lineUserId });
    logOrderStatus(user.tenantId, order.record_id, from, SO_CONFIRMED, '', '', 'พนักงานยืนยันความถูกต้องจากแอปมือถือ',
      user.displayName || user.lineUserId, _mobileRoleLabel(user.role));
    /* ★ ยอดขายรายวันเริ่มนับตรงนี้ ไม่ใช่ตอนเปิดบิล — ใบร่างยังไม่ใช่การขาย (ตกลงกับเจ้าของระบบ 1 ต.ค. 2026)
       นับเป็นวันที่ "เปิดบิล" ไม่ใช่วันที่ยืนยัน เพื่อให้ยอดของใบเดียวกันอยู่วันเดียวตลอดสายงาน
       (ยกเลิกทีหลังก็หักคืนที่วันเดียวกัน ไม่งั้นยอดสองวันเพี้ยนพร้อมกัน) */
    bumpSalesDaily(user.tenantId, String(order.created_at).substring(0, 10), 1, parseFloat(order.total) || 0, orderExVat(order));
    // คืนเลขใหม่ไปด้วย — หน้าจอต้องใช้เลขนี้อ้างอิงต่อ (รหัสชั่วคราวใช้ไม่ได้อีกแล้ว)
    return { success: true, status: SO_CONFIRMED, statusLabel: SO_STATUS_LABELS[SO_CONFIRMED],
      orderCode: newCode, previousCode: order.order_code,
      message: 'ยืนยันแล้ว — เลขที่เอกสาร ' + newCode + ' ส่งให้ศูนย์รับงานเรียบร้อย' };
  });
}

/** มือถือยกเลิกใบของตัวเอง (ได้เฉพาะก่อนศูนย์รับงาน) — คืนยอดขายรายวันให้ด้วย
 *  ใบนัดส่งยังไม่ได้ตัดสต็อกและยังไม่ได้จอง (จองตอนรับงาน) จึงไม่มีอะไรต้องคืนเข้าคลัง */
function cancelMySalesOrder(user, payload) {
  ensureTenantSheetsCurrent(user.tenantId);
  return _withDocLock(function() {
    var order = _mobileOwnOrder(user, (payload || {}).orderCode);
    if (!order) return { success: false, message: 'ไม่พบบิลนี้ หรือไม่ใช่บิลของท่าน' };
    var from = _soStatusOf(order);
    if (from === SO_CANCELLED) return { success: true, status: from, alreadyDone: true, message: 'ใบนี้ยกเลิกไปแล้ว' };
    if (SO_MOBILE_CANCELLABLE.indexOf(from) === -1) {
      return { success: false, message: 'ใบนี้อยู่ขั้น "' + SO_STATUS_LABELS[from] + '" แล้ว ยกเลิกเองไม่ได้ — แจ้งศูนย์ให้ดำเนินการแทน' };
    }
    if (String(order.fulfillment_type) === 'immediate') {
      return { success: false, message: 'บิลขายจากรถยกเลิกเองไม่ได้ (ของออกจากรถไปแล้ว) — แจ้งศูนย์ให้ดำเนินการ' };
    }
    tenantUpdate(user.tenantId, 'sales_orders', order.record_id, { status: SO_CANCELLED, updated_at: nowStr(), updated_by: user.lineUserId });
    logOrderStatus(user.tenantId, order.record_id, from, SO_CANCELLED, '', '',
      'พนักงานยกเลิกเองจากแอปมือถือ' + ((payload || {}).reason ? ' — ' + payload.reason : ''),
      user.displayName || user.lineUserId, _mobileRoleLabel(user.role));
    /* หักคืนยอดขาย **เฉพาะใบที่เคยถูกนับแล้ว** — ใบร่าง/ใบที่ถูกตีกลับไม่เคยนับ (หรือหักไปแล้ว)
       หักซ้ำจะทำให้ยอดรายวันติดลบสะสมไปเรื่อยๆ · ใช้ saleCountsInDaily() ตัวเดียวกับจุดอื่น */
    if (saleCountsInDaily(from)) {
      bumpSalesDaily(user.tenantId, String(order.created_at).substring(0, 10), -1, -(parseFloat(order.total) || 0), -orderExVat(order));
    }
    return { success: true, status: SO_CANCELLED, statusLabel: SO_STATUS_LABELS[SO_CANCELLED], message: 'ยกเลิกใบสั่งขายแล้ว' };
  });
}

/* ═══════════ แอดมินศูนย์แก้ไขรายการในใบที่ "บันทึกรับงานแล้ว" (3 ต.ค. 2026, เจ้าของระบบสั่ง) ═══════════
 * เปลี่ยนรหัสสินค้า · แก้จำนวน · แก้วันนัดส่ง · คิดราคาใหม่ — ได้เฉพาะขั้น `accepted` เท่านั้น
 *   (ขั้นก่อนหน้า = ยังเป็นของพนักงาน/ยังไม่รับงาน · ขั้นถัดไป = ของถูกตัดออกจากคลังไปแล้ว แก้แล้วต้องคืน/ตัดสต็อกใหม่ ยังไม่รองรับ)
 * ★ เขียนทับใบเดิม ไม่ออกเลขใหม่ — คิดราคาผ่าน _priceSaleCart ตัวเดียวกับตอนเปิดบิล (ชุดราคา/ส่วนลด/ของแถม/VAT ตรงกันเป๊ะ)
 * ★ ยอดจอง (SO_RESERVED_STATUSES) ปลดของเดิมแล้วจองตามรายการใหม่ · ยอดขายรายวันขยับเฉพาะส่วนต่าง · เขียนประวัติทุกครั้ง
 * ★ ติดธง `center_edited_at/by` ให้แอปมือถือบอกพนักงานว่า "ศูนย์แก้ไขใบนี้แล้ว" (ข้อ 3 ของเจ้าของระบบ 1 ต.ค. 2026)
 * ใบที่รับชำระแล้ว (paid_amount > 0) แก้ไม่ได้ — ยอดใหม่อาจไม่ตรงกับเงินที่รับไปแล้ว ให้ยกเลิกการรับชำระก่อน
 * payload: { id, tenantId?, items:[{productId,unitCode,qty}], requestedDeliveryDate? ('' = ล้างวันนัด · ไม่ส่ง = ไม่แตะ) }
 */
function editSalesOrderAdmin(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  ensureTenantSheetsCurrent(tenantId);
  return _withDocLock(function() { return _editSalesOrderCore(session, payload, tenantId); });
}

function _editSalesOrderCore(session, payload, tenantId) {
  var order = null;
  order = tenantRowById(tenantId, 'sales_orders', payload.id);
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
  var from = _soStatusOf(order);
  if (from !== SO_ACCEPTED) {
    return { success: false, message: 'แก้ไขรายการได้เฉพาะใบที่ "' + SO_STATUS_LABELS[SO_ACCEPTED] + '" — ตอนนี้ใบนี้อยู่ขั้น "' + SO_STATUS_LABELS[from] + '"' };
  }
  if ((parseFloat(order.paid_amount) || 0) > 0) {
    return { success: false, message: 'ใบนี้มีการรับชำระเงินแล้ว แก้ไขรายการไม่ได้ — ยกเลิกการรับชำระก่อนแล้วค่อยแก้' };
  }
  /* ★★ ใบที่ส่งของไปแล้วบางส่วน แก้รายการไม่ได้เด็ดขาด (14 ต.ค. 2026)
     ฟังก์ชันนี้ **ลบบรรทัดบิลทั้งชุดแล้วสร้างใหม่** record_id จึงเปลี่ยนหมด แถวใน delivery_round_items
     ที่ชี้มาจะกลายเป็นเศษที่ไม่ชี้ไปไหน แล้ว "ส่งแล้วเท่าไร" จะหายไปเงียบๆ ทั้งที่ของออกจากคลังไปแล้วจริง
     ★ รอบที่ยังไม่ได้ส่ง (เพิ่งกดแยกไว้ ยังไม่ถึงพร้อมจัดส่ง) ล้างทิ้งให้แล้วแยกใหม่ได้ — ไม่มีของออกไปไหน
       เลข PICK/DO ยังอยู่บนแถวบิล รอบที่ 1 ที่สร้างใหม่จึงได้เลขเดิม (ใบที่พิมพ์ไปแล้วยังอ้างได้) */
  var dpEdit = saleOrderHasRounds(order) ? saleDeliveryPlan(tenantId, order) : null;
  if (dpEdit) {
    var shippedAny = dpEdit.lines.some(function(l) { return l.shipped > 0.0001; });
    if (shippedAny) return { success: false, message: 'ใบนี้ส่งของไปแล้วบางส่วน (แยกรอบจัดส่งไว้) แก้ไขรายการไม่ได้ — ถ้าของที่ค้างส่งไม่ถูกต้อง ให้ยกเลิกบิลแล้วเปิดใบใหม่สำหรับส่วนที่เหลือ' };
    deleteRowsWhere(tenantSheet(tenantId, 'delivery_round_items'), 'order_id', order.record_id);
    deleteRowsWhere(tenantSheet(tenantId, 'delivery_rounds'), 'order_id', order.record_id);
  }
  var items = (payload.items || []).map(function(it) {
    return { productId: String(it.productId || ''), unitCode: it.unitCode, qty: parseInt(it.qty) || 0 };
  }).filter(function(it) { return it.productId; });
  if (!items.length) return { success: false, message: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' };
  var wantDate = payload.requestedDeliveryDate;
  if (wantDate !== undefined && wantDate !== null && String(wantDate) !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(wantDate))) {
    return { success: false, message: 'วันนัดส่งต้องเป็นรูปแบบ yyyy-MM-dd' };
  }
  if (!_customerInTenant(order.customer_id, tenantId)) return { success: false, message: 'ไม่พบลูกค้าของใบนี้ในตัวแทนที่เลือก' };

  var priced = _priceSaleCart(order.customer_id, items, order.payment_method, false);
  if (!priced.success) return priced;
  var newItems = priced.items, calc = priced.calc, freeGoods = calc.freeGoods;

  // รายการเดิม — ไว้สรุปในประวัติ (เทียบก่อน/หลัง) ก่อนจะถูกล้างทิ้ง
  var productMap = {};
  centralObjects('products').forEach(function(p) { productMap[String(p.record_id)] = p; });
  var oldLines = tenantObjects(tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id) && String(it.is_free) !== '1'; });
  var lineText = function(code, qty, unit) { return code + '×' + qty + ' ' + (unit || ''); };
  var oldSummary = oldLines.map(function(it) { var p = productMap[String(it.product_id)]; return lineText((p && p.product_code) || it.product_id, it.qty, it.unit_code); }).join(', ');
  var newSummary = newItems.map(function(it) { var p = productMap[it.productId]; return lineText((p && p.product_code) || it.productId, it.qty, it.unitCode); }).join(', ');

  // ยอดจอง: ปลดของเดิม → ตรวจของที่ขายได้จริงตามรายการใหม่ → จองใหม่ (ของไม่พอ = เตือน ไม่บล็อก เหมือนตอนเปิดบิล)
  var need = {};
  newItems.forEach(function(it) { need[it.productId] = (need[it.productId] || 0) + it.baseQty; });
  freeGoods.forEach(function(f) { need[String(f.productId)] = (need[String(f.productId)] || 0) + (Number(f.baseQty) || Number(f.qty) || 0); });
  releaseStockReservation(tenantId, order.record_id);
  var stockCheck = checkOfficeDeliveryStock(tenantId, need);
  reserveStockForSale(tenantId, stockCheck.warehouseId, need, order.record_id);

  // เขียนทับแถวบิล (เลขที่เอกสาร/วันที่เปิดบิล/สถานะ คงเดิม)
  var vatSplit = calc.vat, by = session.displayName || session.username, at = nowStr();
  var oldTotal = parseFloat(order.total) || 0, oldExVat = orderExVat(order);   // ต้องอ่านของเดิมก่อนเขียนทับแถว
  var row = {
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    apply_vat: vatSplit.applyVat ? 'TRUE' : 'FALSE', vat_type: vatSplit.vatType,
    vat_rate: vatSplit.rate, subtotal_ex_vat: vatSplit.exVat, vat_amount: vatSplit.vat, exempt_amount: vatSplit.exemptAmount,
    updated_at: at, updated_by: String(session.adminUserId || ''), center_edited_at: at, center_edited_by: String(by || '')
  };
  if (wantDate !== undefined && wantDate !== null) row.requested_delivery_date = String(wantDate);
  if (dpEdit) { row.ship_round_no = ''; row.backorder_lines = 0; }   // รอบที่แยกไว้ถูกล้างไปแล้ว ต้องล้างตัวบอกใบ้ด้วย
  tenantUpdate(tenantId, 'sales_orders', order.record_id, row);

  // ล้างบรรทัด/ส่วนลดเดิมแล้วเขียนชุดใหม่
  deleteRowsWhere(tenantSheet(tenantId, 'order_items'), 'order_id', order.record_id);
  deleteRowsWhere(tenantSheet(tenantId, 'order_discounts'), 'order_id', order.record_id);
  newItems.forEach(function(it) {
    tenantAppend(tenantId, 'order_items', {
      record_id: tenantNextId(tenantId, 'order_items'), order_id: order.record_id, product_id: it.productId,
      unit_code: it.unitCode, unit_factor: it.unitFactor, qty: it.qty, base_qty: it.baseQty,
      price: it.price, line_total: it.lineTotal, unit_discount: it.unitDiscount || 0, line_discount: it.lineDiscount || 0,
      list_price_ex_vat: it.listPriceExVat != null ? it.listPriceExVat : '',
      is_free: 0, tax_status: calc.vat.taxOf(it.productId)
    });
  });
  freeGoods.forEach(function(f) {
    var fBase = Number(f.baseQty) || Number(f.qty) || 0, fQty = Number(f.qty) || 0;
    tenantAppend(tenantId, 'order_items', {
      record_id: tenantNextId(tenantId, 'order_items'), order_id: order.record_id, product_id: f.productId,
      unit_code: f.unitCode || UNIT_PC, unit_factor: fQty ? (fBase / fQty) : 1, qty: fQty, base_qty: fBase,
      price: 0, line_total: 0, is_free: 1
    });
  });
  calc.appliedRules.forEach(function(r) {
    tenantAppend(tenantId, 'order_discounts', { record_id: tenantNextId(tenantId, 'order_discounts'), order_id: order.record_id,
      rule_id: r.ruleId, rule_name: r.ruleName, type: r.type, value: r.value, free_product_id: '', free_qty: '' });
  });

  // ยอดขายรายวัน: จำนวนใบเท่าเดิม ขยับเฉพาะส่วนต่างของยอด (นับที่วันที่เปิดบิลเหมือนตอนยืนยัน/ยกเลิก)
  var delta = _round2((calc.total || 0) - oldTotal);
  // ★ ยอดก่อนภาษีขยับไม่เท่ากับยอดรวม ถ้าบิลมีสินค้ายกเว้นภาษีปนอยู่ — คิดแยกเสมอ ห้ามหารจาก delta
  var deltaEx = _round2((vatSplit.exVat || 0) - oldExVat);
  if (delta || deltaEx) bumpSalesDaily(tenantId, _dOnly(order.created_at), 0, delta, deltaEx);

  // ล็อกรหัสสินค้าที่เพิ่งถูกใช้ขายจริง (เหมือนตอนเปิดบิล)
  newItems.forEach(function(it) { var p = productMap[it.productId]; if (p && !isFlagOn(p.has_transactions)) centralUpdate('products', it.productId, { has_transactions: 'TRUE' }); });

  logOrderStatus(tenantId, order.record_id, from, from, orderPaymentStatus(order), orderPaymentStatus(order),
    'ศูนย์แก้ไขรายการ: [' + oldSummary + '] → [' + newSummary + '] ยอด ฿' + oldTotal + ' → ฿' + calc.total +
      (wantDate !== undefined && wantDate !== null ? ' · วันนัดส่ง ' + (String(wantDate) || '(ล้าง)') : ''),
    by, _adminRoleLabel(session));
  return { success: true, total: calc.total, discount: calc.discount, previousTotal: oldTotal, stockWarning: stockCheck.warning || '',
    message: 'แก้ไขใบ ' + order.order_code + ' แล้ว — ยอดใหม่ ฿' + calc.total + (stockCheck.warning ? ' · ⚠️ ' + stockCheck.warning : '') };
}

/**
 * ซ่อมบิลที่พ้นร่างไปแล้วแต่ยังถือรหัสชั่วคราว `DRAFT-nn` (super_admin)
 * payload: { tenantId?, dry? }  — `dry: true` = ดูอย่างเดียว ไม่แก้
 *
 * ★ เกิดจากบั๊กที่ `updateSalesOrderStatus` ไม่เคยออกเลขจริงให้ (แก้แล้ว 16 ต.ค. 2026)
 *   ใบที่ค้างอยู่ก่อนหน้านั้นจะไม่ซ่อมตัวเองจนกว่าจะมีการเปลี่ยนสถานะอีกครั้ง — ตัวนี้ซ่อมให้ทีเดียว
 * ★★ เรียงตามลำดับที่เปิดบิล (record_id) ก่อนออกเลข — ออกเลขตามลำดับที่เจอในชีตจะได้เลขสลับกับ
 *   วันที่ ซึ่งผิดหลักการออกเลขเอกสารและอธิบายกับผู้ตรวจไม่ได้
 * ★ ไม่แตะใบที่ยังเป็นร่างจริงๆ (ยังไม่ควรกินเลข) และไม่แตะใบที่มีเลขจริงอยู่แล้ว
 */
function repairDraftOrderCodes(session, payload) {
  // ใช้รูปแบบเดียวกับ syncTenantSheets (13_tenants.gs) — โปรเจกต์นี้ไม่มี helper กลางสำหรับ super_admin
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  payload = payload || {};
  // ใช้ _salesTenantId เหมือน action อื่นในไฟล์นี้ — คนละตัวกับ _effectiveTenantId (ดู blueprint แผ่น 03)
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'ไม่ทราบตัวแทนที่ต้องการซ่อม' };
  ensureTenantSheetsCurrent(tenantId);

  return _withDocLock(function() {
    var bad = tenantObjects(tenantId, 'sales_orders').filter(function(o) {
      return isDraftOrderCode(o.order_code) && _soStatusOf(o) !== SO_DRAFT;
    });
    bad.sort(function(a, b) { return (Number(a.record_id) || 0) - (Number(b.record_id) || 0); });
    if (!bad.length) return { success: true, fixed: 0, data: [], message: 'ไม่มีบิลที่ต้องซ่อม' };
    if (payload.dry) {
      return { success: true, fixed: 0, dry: true,
        data: bad.map(function(o) { return { id: o.record_id, oldCode: o.order_code, status: o.status,
          createdAt: safeDateStr(o.created_at), total: Number(o.total) || 0 }; }),
        message: 'พบ ' + bad.length + ' ใบที่ยังถือรหัสชั่วคราว (ยังไม่ได้แก้ — ส่ง dry:false เพื่อซ่อมจริง)' };
    }
    var out = [];
    bad.forEach(function(o) {
      var code = getNextDocNumber(tenantId, 'SO');
      tenantUpdate(tenantId, 'sales_orders', o.record_id,
        { order_code: code, updated_at: nowStr(), updated_by: session.adminUserId });
      logOrderStatus(tenantId, o.record_id, _soStatusOf(o), _soStatusOf(o), '', '',
        'ซ่อมเลขที่เอกสาร: ' + o.order_code + ' → ' + code,
        session.displayName || session.username, _adminRoleLabel(session));
      out.push({ id: o.record_id, oldCode: o.order_code, newCode: code });
    });
    return { success: true, fixed: out.length, data: out,
      message: 'ออกเลขที่เอกสารจริงให้ ' + out.length + ' ใบแล้ว' };
  });
}
