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
 *   draft ใหม่ ──(มือถือกดยืนยัน)──▶ confirmed ยืนยัน ──(ศูนย์กดรับงาน)──▶ accepted รับงาน
 *     ──(ศูนย์แจ้งพร้อมส่ง)──▶ ready_to_ship พร้อมจัดส่ง ──▶ delivering กำลังจัดส่ง ──▶ completed จัดส่งแล้ว
 *   ปฏิเสธการขาย = rejected · ยกเลิก = cancelled
 *
 * ★ `pending_delivery` คือชื่อเดิมก่อน 1 ต.ค. 2026 — **ห้ามลบ** บิลเก่าทั้ง UAT/prod ยังเป็นค่านี้อยู่
 *   ให้ความหมายเท่ากับ `confirmed` ทุกประการ จะได้ไม่ต้อง migrate ข้อมูลเก่า */
var SO_DRAFT = 'draft', SO_CONFIRMED = 'confirmed', SO_ACCEPTED = 'accepted', SO_REJECTED = 'rejected',
    SO_READY = 'ready_to_ship', SO_PENDING = 'pending_delivery',
    SO_DELIVERING = 'delivering', SO_COMPLETED = 'completed', SO_CANCELLED = 'cancelled';
var SO_STATUS_LABELS = {
  draft: 'ใหม่ (ร่าง)', confirmed: 'ยืนยันแล้ว → รอแอดมินกดรับงาน', pending_delivery: 'ยืนยันแล้ว → รอแอดมินกดรับงาน',
  accepted: 'บันทึกรับงานแล้ว → รอการจัดส่ง', ready_to_ship: 'พร้อมจัดส่ง', delivering: 'กำลังจัดส่ง',
  completed: 'จัดส่งแล้ว', rejected: 'ปฏิเสธการขาย', cancelled: 'ยกเลิกแล้ว'
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
/* ช่วงที่ "กันของไว้ให้แล้วแต่ยังไม่ตัดจริง" — เจ้าของระบบสั่งให้จองตอนศูนย์รับงาน
   ก่อนหน้านั้น (ร่าง/ยืนยัน) ยังไม่กันของ เพราะศูนย์ยังไม่ได้รับปากว่าจะขายให้ */
var SO_RESERVED_STATUSES = [SO_ACCEPTED];
function saleStockReserved(order) {
  if (!order || String(order.fulfillment_type) === 'immediate') return false;
  return SO_RESERVED_STATUSES.indexOf(_soStatusOf(order)) !== -1;
}
function saleStockTaken(order) {
  if (!order) return false;
  if (String(order.fulfillment_type) === 'immediate') return true;          // ตัดไปแล้วตั้งแต่บันทึกบิล
  return SO_STOCK_TAKEN_STATUSES.indexOf(_soStatusOf(order)) !== -1;
}

/** คลังที่บิลนี้ตัดของออก — ตัวแทนใช้คลังของตัวเอง - ขายตรงของบริษัท (HOUSE) ใช้คลังกลางของบริษัท (scope ว่าง) */
function _saleStockScope(tenantId) {
  return String(tenantId) === HOUSE_TENANT_ID ? '' : String(tenantId || '');
}

/** รวมจำนวนหน่วยฐานต่อสินค้าของบิลใบนี้ (รวมของแถม เพราะของแถมก็ออกจากคลังจริง) */
function _saleBaseQtyByProduct(tenantId, orderId) {
  var need = {};
  tenantObjects(tenantId, 'order_items')
    .filter(function(it) { return String(it.order_id) === String(orderId); })
    .forEach(function(it) {
      var pid = String(it.product_id);
      need[pid] = (need[pid] || 0) + (parseFloat(it.base_qty) || 0);
    });
  return need;
}

/**
 * ขยับสต็อกคลังกลางของบิล office_delivery - dir = -1 ตัดออก - dir = +1 คืนเข้า
 * ของไม่พอ = ไม่ขยับอะไรเลยสักตัว (เช็คให้ครบก่อนค่อยเขียน ไม่ตัดครึ่งๆ กลางๆ แล้วค้างไว้แบบนั้น)
 * ต้องเรียกใต้ _withDocLock เท่านั้น - ใช้ _applyStockIn ตัวเดียวกับงานรับของเข้าคลัง (22_purchase_order.gs)
 */
function applySaleWarehouseStock(tenantId, order, dir, reason, userId) {
  var scope = _saleStockScope(tenantId);
  var warehouseId = _ensureScopeWarehouse(scope);
  var need = _saleBaseQtyByProduct(tenantId, order.record_id);
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

  pids.forEach(function(pid) {
    _applyStockIn(scope, warehouseId, pid, dir * need[pid], cost[pid] || 0,
      dir < 0 ? 'sale_out' : 'sale_return', 'SALES_ORDER', order.record_id, reason, userId);
  });
  return { success: true, moved: pids.length };
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
    tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.id)) order = o; });
    if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };

    var fromStatus = _soStatusOf(order), fromPay = orderPaymentStatus(order);
    var toStatus = fromStatus, toPay = fromPay;
    var fields = {}, changes = [], justBecameReady = false;

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
        // ★ ขยับสต็อกเฉพาะตอนค่า "ของถูกตัดไปแล้ว" เปลี่ยน — ขั้นถัดไปจากจุดตัดจึงไม่ตัดซ้ำ
        var wasTaken = saleStockTaken(order);
        var willTake = saleStockTaken({ fulfillment_type: order.fulfillment_type, status: toStatus });
        if (wasTaken !== willTake) {
          var mv = applySaleWarehouseStock(tenantId, order, willTake ? -1 : 1,
            'บิล ' + order.order_code + ' -> ' + SO_STATUS_LABELS[toStatus], session.adminUserId);
          if (!mv.success) return mv;
          changes.push(willTake ? 'ตัดสต็อกออกจากคลังแล้ว' : 'คืนของเข้าคลังแล้ว');
          // ยอดจอง (guide ข้อ 1.3) เดินสวนทางกับสต็อกเสมอ: ตัดของจริงแล้ว = ปลดจอง (ไม่งั้นถูกนับซ้ำสองทาง)
          // ถอยกลับมาไม่ถึงจุดตัด = ยังเป็นคำมั่นกับลูกค้าอยู่ ต้องจองกันของไว้ใหม่เหมือนตอนเปิดบิล (มีของพอเสมอ เพิ่งคืนเข้าคลังไปหมาดๆ)
          if (willTake) releaseStockReservation(tenantId, order.record_id);
        }
        /* ยอดจองเดินแยกจากการตัดจริง (1 ต.ค. 2026): จองตอน "ศูนย์รับงาน" ปลดตอนตัดของจริงหรือตอนถอยกลับ
           เช็คหลังบล็อกตัดสต็อกเสมอ เพราะถ้าเพิ่งตัดของจริงไป reservation ถูกปลดไปแล้ว จะได้ไม่จองซ้ำ */
        var wasRes = saleStockReserved(order);
        var willRes = saleStockReserved({ fulfillment_type: order.fulfillment_type, status: toStatus });
        if (wasRes !== willRes) {
          if (willRes) {
            var need2 = _saleBaseQtyByProduct(tenantId, order.record_id);
            if (Object.keys(need2).length) {
              reserveStockForSale(tenantId, _ensureScopeWarehouse(_saleStockScope(tenantId)), need2, order.record_id);
              changes.push('กันของในคลังไว้ให้แล้ว');
            }
          } else {
            releaseStockReservation(tenantId, order.record_id);
            changes.push('ปลดของที่กันไว้');
          }
        }
        fields.status = toStatus;
        if (toStatus === SO_COMPLETED) fields.delivered_at = nowStr();
        if (toStatus === SO_PENDING || toStatus === SO_DELIVERING) fields.delivered_at = '';

        /* ★ ออกเลขใบส่งสินค้าตอนเข้าสถานะ "พร้อมจัดส่ง" (แอดมินขอ 6 ต.ค. 2026)
           ใบส่งของเป็นคนละเอกสารกับใบสั่งขาย เดิมพิมพ์โดยใช้เลขใบสั่งขายซ้ำ ทำให้อ้างอิงกันไม่ได้
           ★★ ออกครั้งเดียวต่อใบ: ถ้ามีเลขแล้วไม่ออกใหม่ — ถอยกลับไป "รับงาน" แล้วเดินหน้ามาใหม่
           ต้องได้เลขเดิม ไม่งั้นใบที่พิมพ์ส่งไปกับรถแล้วจะอ้างเลขที่ไม่มีอยู่ในระบบอีกต่อไป
           (เลขเอกสารกินตัวนับทุกครั้งที่เรียก ออกซ้ำ = เลขกระโดดโดยไม่มีเอกสารรองรับ) */
        if (toStatus === SO_READY) {
          /* ★ ส่งมอบสินค้า = จุดที่เอกสารฝั่งคลังและภาระภาษีเกิดพร้อมกัน
             ใบจัดของ (หยิบของ) · ใบส่งสินค้า (ติดไปกับของ) · ใบกำกับภาษี (tax point ของการขายสินค้าคือการส่งมอบ) */
          var iss = issueSaleDocNos(tenantId, order, ['picking', 'delivery', 'tax']);
          for (var kk in iss.fields) fields[kk] = iss.fields[kk];
          iss.issued.forEach(function(t) { changes.push('ออก' + t); });
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

    logOrderStatus(tenantId, order.record_id, fromStatus, toStatus, fromPay, toPay, payload.note,
      session.displayName || session.username, _adminRoleLabel(session));

    /* ★ ตั้งลูกหนี้ + ออกใบแจ้งหนี้/ใบกำกับภาษีอัตโนมัติตอนเข้าสถานะ "พร้อมจัดส่ง" (เจ้าของระบบสั่ง)
       จุดนี้คือจุดที่ของถูกตัดออกจากคลังแล้วและเอกสารกำลังจะออกไปกับรถ — ภาระหนี้เกิดตรงนี้
       ★ เฉพาะบิลเครดิต: ขายสดเก็บเงินหน้าร้านแล้ว ไม่มีลูกหนี้ให้ตั้ง (กติกาเดียวกับ listUninvoicedSalesOrders)
       ★★ ออกใบไม่สำเร็จ "ห้ามล้มการเปลี่ยนสถานะ" — ของแพ็คขึ้นรถไปแล้ว ย้อนสถานะกลับไม่ได้
          รายงานเป็นคำเตือนแทน แล้วให้ฝ่ายบัญชีออกเองจากหน้าลูกหนี้ (ปุ่มเดิมยังอยู่ และกันซ้ำให้อยู่แล้ว)
       ★ ลงสมุดของเจ้าของบิล — `_normBook(tenantId)` ไม่ใช่สมุดของคนกด (ฝ่ายคลังอาจเป็นคนบริษัท) */
    var arNote = '';
    if (justBecameReady && isCreditPayment(order.payment_method)) {
      var ar = _createArInvoiceCore(session, { tenantId: tenantId, salesOrderId: order.record_id },
        typeof _normBook === 'function' ? _normBook(tenantId) : '');
      if (ar && ar.success) changes.push('ตั้งลูกหนี้ ' + ar.invoiceNo);
      else arNote = 'ยังไม่ได้ตั้งลูกหนี้: ' + ((ar && ar.message) || 'ไม่ทราบสาเหตุ');
    }

    return { success: true, status: toStatus, statusLabel: SO_STATUS_LABELS[toStatus],
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
  tax:      { no: 'tax_invoice_no',    at: 'tax_invoice_at',    type: 'TAX',  label: 'ใบกำกับภาษี' }
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
    var newCode = String(order.order_code || '').indexOf('DRAFT-') === 0
      ? getNextDocNumber(user.tenantId, 'SO') : order.order_code;
    tenantUpdate(user.tenantId, 'sales_orders', order.record_id,
      { status: SO_CONFIRMED, order_code: newCode, updated_at: nowStr(), updated_by: user.lineUserId });
    logOrderStatus(user.tenantId, order.record_id, from, SO_CONFIRMED, '', '', 'พนักงานยืนยันความถูกต้องจากแอปมือถือ',
      user.displayName || user.lineUserId, _mobileRoleLabel(user.role));
    /* ★ ยอดขายรายวันเริ่มนับตรงนี้ ไม่ใช่ตอนเปิดบิล — ใบร่างยังไม่ใช่การขาย (ตกลงกับเจ้าของระบบ 1 ต.ค. 2026)
       นับเป็นวันที่ "เปิดบิล" ไม่ใช่วันที่ยืนยัน เพื่อให้ยอดของใบเดียวกันอยู่วันเดียวตลอดสายงาน
       (ยกเลิกทีหลังก็หักคืนที่วันเดียวกัน ไม่งั้นยอดสองวันเพี้ยนพร้อมกัน) */
    bumpSalesDaily(user.tenantId, String(order.created_at).substring(0, 10), 1, parseFloat(order.total) || 0);
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
    /* หักคืนยอดขาย **เฉพาะใบที่เคยถูกนับแล้ว** — ใบร่างไม่เคยนับ (ไปนับตอนกดยืนยัน)
       หักคืนใบร่างด้วยจะทำให้ยอดรายวันติดลบสะสมไปเรื่อยๆ ทุกครั้งที่มีคนทิ้งร่าง */
    if (from !== SO_DRAFT) {
      bumpSalesDaily(user.tenantId, String(order.created_at).substring(0, 10), -1, -(parseFloat(order.total) || 0));
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
  tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.id)) order = o; });
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
  var from = _soStatusOf(order);
  if (from !== SO_ACCEPTED) {
    return { success: false, message: 'แก้ไขรายการได้เฉพาะใบที่ "' + SO_STATUS_LABELS[SO_ACCEPTED] + '" — ตอนนี้ใบนี้อยู่ขั้น "' + SO_STATUS_LABELS[from] + '"' };
  }
  if ((parseFloat(order.paid_amount) || 0) > 0) {
    return { success: false, message: 'ใบนี้มีการรับชำระเงินแล้ว แก้ไขรายการไม่ได้ — ยกเลิกการรับชำระก่อนแล้วค่อยแก้' };
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
  var oldTotal = parseFloat(order.total) || 0;
  var row = {
    subtotal: calc.subtotal, discount: calc.discount, total: calc.total,
    apply_vat: vatSplit.applyVat ? 'TRUE' : 'FALSE', vat_type: vatSplit.vatType,
    vat_rate: vatSplit.rate, subtotal_ex_vat: vatSplit.exVat, vat_amount: vatSplit.vat, exempt_amount: vatSplit.exemptAmount,
    updated_at: at, updated_by: String(session.adminUserId || ''), center_edited_at: at, center_edited_by: String(by || '')
  };
  if (wantDate !== undefined && wantDate !== null) row.requested_delivery_date = String(wantDate);
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
  if (delta) bumpSalesDaily(tenantId, _dOnly(order.created_at), 0, delta);

  // ล็อกรหัสสินค้าที่เพิ่งถูกใช้ขายจริง (เหมือนตอนเปิดบิล)
  newItems.forEach(function(it) { var p = productMap[it.productId]; if (p && !isFlagOn(p.has_transactions)) centralUpdate('products', it.productId, { has_transactions: 'TRUE' }); });

  logOrderStatus(tenantId, order.record_id, from, from, orderPaymentStatus(order), orderPaymentStatus(order),
    'ศูนย์แก้ไขรายการ: [' + oldSummary + '] → [' + newSummary + '] ยอด ฿' + oldTotal + ' → ฿' + calc.total +
      (wantDate !== undefined && wantDate !== null ? ' · วันนัดส่ง ' + (String(wantDate) || '(ล้าง)') : ''),
    by, _adminRoleLabel(session));
  return { success: true, total: calc.total, discount: calc.discount, previousTotal: oldTotal, stockWarning: stockCheck.warning || '',
    message: 'แก้ไขใบ ' + order.order_code + ' แล้ว — ยอดใหม่ ฿' + calc.total + (stockCheck.warning ? ' · ⚠️ ' + stockCheck.warning : '') };
}
