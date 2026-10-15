/**
 * ===================== รอบจัดส่ง · ของค้างส่ง (แอดมินศูนย์ขอ 14 ต.ค. 2026) =====================
 *
 * ปัญหาจริงที่แก้: ของในคลังไม่พอส่งทั้งใบในรอบเดียว
 *   วิธีเดิมที่คนทำกันคือ "ตัดรายการที่ไม่พอออกจากบิล" ซึ่ง **ทำลายยอดบิล** — ยอดตกลงมาไม่ถึงขั้น
 *   ส่วนลดท้ายบิล ลูกค้าเสียส่วนลดที่ตกลงกันไว้ แล้วต้องไปเปิดบิลใหม่ให้ของที่เหลือซึ่งก็ไม่ถึงขั้นอีก
 *   → บิลขายต้องคงสภาพเดิมทุกบรรทัดทุกบาท แล้วแยก "รอบจัดส่ง" ออกมาเป็นอีกชั้นหนึ่งใต้บิล
 *
 * ★★ หลักที่ห้ามหลุด: **รอบจัดส่งไม่แตะยอดเงินของบิลเลยสักบาท**
 *   บิล = ข้อตกลงกับลูกค้า (ยอด · ส่วนลด · ภาษี) · รอบจัดส่ง = ของออกจากคลังเมื่อไหร่กี่ชิ้น
 *   ยอดขายรายวัน ยอดลูกหนี้ ใบกำกับภาษี ใบแจ้งหนี้ ใบเสร็จ อ่านจากบิลเสมอ ไม่ได้อ่านจากรอบ
 *
 * ★ เอกสารที่ "แยกตามรอบ": ใบจัดของ (PICK) · ใบส่งสินค้า (DO) — คนคลังหยิบของตามรอบ ลูกค้าเซ็นรับตามรอบ
 *   เอกสารที่ "ใบเดียวของทั้งบิล": ใบเสร็จ · ใบกำกับภาษี · ใบแจ้งหนี้ (เจ้าของระบบกำหนด 14 ต.ค. 2026)
 *   ภาระภาษีและหนี้เกิดครั้งเดียวตามบิล ไม่ได้เกิดใหม่ทุกครั้งที่รถออก
 *
 * ★★ บิลที่ไม่เคยแยกรอบ = ไม่มีแถวในสองตารางนี้เลย และ "รอบ = ทั้งใบ" (saleDeliveryPlan คืนค่าแบบนั้นให้เอง)
 *   บิลเก่าทุกใบในระบบจึงเดินทางเดิมเป๊ะ ไม่ต้อง migrate อะไร และโค้ดมีทางเดินเดียวไม่ต้องแยก if
 *
 * สายงานที่ได้:
 *   รับงาน (accepted) ──กด "แยกของค้างส่ง"──▶ รอบ 1 = ของที่ส่งได้  ·  ที่เหลือ = ค้างส่ง
 *     ──▶ พร้อมจัดส่ง (ตัดสต็อก **เฉพาะของรอบ 1**) ──▶ กำลังจัดส่ง ──▶ กด "จัดส่งสำเร็จ"
 *            ยังมีของค้าง? ──▶ ปิดรอบ 1 เป็น "ส่งสำเร็จ" · เปิดรอบ 2 (เลข PICK/DO ใหม่) · บิลกลับไป accepted
 *            ไม่มีของค้าง? ──▶ ปิดรอบสุดท้าย · บิลเป็น completed ตามปกติ
 *   → **ไม่เพิ่มสถานะบิลใหม่เลย** กระดาน/ตัวกรอง/รายงาน/การกั้นปุ่มพิมพ์ ใช้ของเดิมทั้งหมด
 */

var DR_OPEN = 'open', DR_SHIPPED = 'shipped', DR_CANCELLED = 'cancelled';
var DR_STATUS_LABELS = { open: 'กำลังเตรียมส่ง', shipped: 'ส่งสำเร็จ', cancelled: 'ยกเลิกรอบ' };

/* ช่วงสถานะที่ "ต้องกันของไว้ให้บิลนี้" — ยอดที่กันไว้คือของที่ยังไม่ได้ตัดออกจากคลัง (ดู saleReserveBaseByProduct)
   ★ รวม pending_delivery/confirmed เพราะ recordSaleAdmin จองไว้ตั้งแต่เปิดบิลอยู่แล้ว ไม่ใช่เริ่มที่ accepted
     (ถ้าไม่รวม การเดินสถานะครั้งแรกจะปลดของที่จองไว้ทิ้ง แล้วบิลที่รอศูนย์รับงานจะไม่มีใครกันของให้) */
var DR_RESERVE_STATUSES = ['pending_delivery', 'confirmed', 'accepted', 'ready_to_ship', 'delivering'];

/** บิลใบนี้เคยแยกรอบไหม — อ่านจากคอลัมน์บนแถวบิลเลย ไม่ต้องเปิดอ่านตารางรอบ
 *  (บิล 99% ไม่เคยแยก การเปิดดูบิลจึงไม่จ่ายค่าอ่านชีตเพิ่มเลย — หลักเดียวกับ arInvoiceNo ใน getSalesOrderAdmin) */
function saleOrderHasRounds(order) {
  return !!String((order && order.ship_round_no) || '').trim();
}

/** หน่วยฐานต่อ 1 หน่วยขายของบรรทัดบิล — เชื่อ base_qty/qty ก่อน เพราะเป็นภาพนิ่งที่บันทึกตอนขายจริง
 *  (unit_factor ของบิลเก่าบางใบว่าง หรือถูกแก้ทีหลังตอน rescale หน่วย — ดู 45_unit_rescale.gs) */
function _drLineFactor(it) {
  var qty = parseFloat(it.qty) || 0, base = parseFloat(it.base_qty) || 0;
  if (qty > 0 && base > 0) return base / qty;
  return parseFloat(it.unit_factor) || 1;
}

function _drRoundsOf(tenantId, orderId) {
  return tenantObjectsIfExists(tenantId, 'delivery_rounds')
    .filter(function(r) { return String(r.order_id) === String(orderId); })
    .sort(function(a, b) { return (parseInt(a.round_no) || 0) - (parseInt(b.round_no) || 0); });
}

function _drItemsOf(tenantId, orderId) {
  return tenantObjectsIfExists(tenantId, 'delivery_round_items')
    .filter(function(r) { return String(r.order_id) === String(orderId); });
}

/**
 * แผนจัดส่งของบิล 1 ใบ — **ตัวกลางเดียว**ที่ตอบว่า "สั่งเท่าไร ส่งแล้วเท่าไร รอบนี้จะส่งเท่าไร ค้างอีกเท่าไร"
 * ทุกจุด (ตัดสต็อก · กันของ · พิมพ์เอกสาร · หน้าจอ) อ่านจากที่นี่ที่เดียว จะได้ไม่มีสองนิยาม
 *
 * @param items ส่งบรรทัดบิลที่อ่านไว้แล้วเข้ามาได้ (getSalesOrderAdmin มีอยู่ในมือแล้ว) — ไม่ส่ง = อ่านเอง
 * @return {
 *   hasRounds, rounds: [แถวรอบ+lines], currentRound,
 *   lines: [{ itemId, productId, unitCode, factor, ordered, shipped, round, outstanding, isFree }],
 *   shipBase: {pid: หน่วยฐานที่รอบปัจจุบันจะส่ง}, unshippedLines, shortLines, roundQty
 * }
 */
function saleDeliveryPlan(tenantId, order, items) {
  items = items || tenantRowsWhere(tenantId, 'order_items', 'order_id', order.record_id);

  var rounds = [], roundItems = [], current = null;
  if (saleOrderHasRounds(order)) {
    rounds = _drRoundsOf(tenantId, order.record_id);
    roundItems = _drItemsOf(tenantId, order.record_id);
    rounds.forEach(function(r) { if (String(r.status) === DR_OPEN) current = r; });
  }

  var byRound = {};
  rounds.forEach(function(r) { byRound[String(r.record_id)] = r; });
  var shipped = {}, planned = {}, linesByRound = {};
  roundItems.forEach(function(ri) {
    var r = byRound[String(ri.round_id)];
    if (!r || String(r.status) === DR_CANCELLED) return;        // รอบที่ยกเลิกไม่นับทั้งขาส่งและขาจอง
    var key = String(ri.item_id), q = parseFloat(ri.qty) || 0;
    if (String(r.status) === DR_SHIPPED) shipped[key] = (shipped[key] || 0) + q;
    else planned[key] = (planned[key] || 0) + q;
    (linesByRound[String(r.record_id)] = linesByRound[String(r.record_id)] || []).push(ri);
  });

  var lines = [], shipBase = {}, unshippedLines = 0, shortLines = 0, roundQty = 0;
  items.forEach(function(it) {
    var key = String(it.record_id), ordered = parseFloat(it.qty) || 0;
    var sh = shipped[key] || 0, pid = String(it.product_id);
    /* ★ ไม่มีรอบเลย = รอบนี้ส่งทั้งใบ (ของที่เหลือทั้งหมด) — บิลปกติทุกใบเดินเส้นนี้
       มีรอบแล้ว = ส่งเท่าที่รอบปัจจุบันระบุ (ไม่มีรอบเปิดอยู่ = ไม่ส่งอะไรในตอนนี้) */
    var rq = rounds.length ? (current ? (planned[key] || 0) : 0) : Math.max(0, ordered - sh);
    var out = Math.max(0, ordered - sh - rq);
    var factor = _drLineFactor(it), baseOrdered = parseFloat(it.base_qty) || 0;
    /* ★★ ใบที่ไม่เคยแยกรอบ ใช้ `base_qty` ที่บันทึกไว้ตอนขาย **ตรงๆ** ไม่คูณ qty × factor ใหม่
       เพื่อให้ผลเท่ากับโค้ดเดิมทุกหน่วยทุกใบ (เศษจากการคูณ/หารหน่วย และบิลเก่าที่ qty ว่างแต่ base_qty มี
       จะได้ไม่เปลี่ยนค่าไปจากที่ตัดสต็อกกันมาตลอด) · ใบที่แยกรอบแล้วค่อยคิดจากจำนวนของรอบ */
    if (!rounds.length) { if (baseOrdered) shipBase[pid] = (shipBase[pid] || 0) + baseOrdered; }
    else if (rq > 0) shipBase[pid] = (shipBase[pid] || 0) + rq * factor;
    if (ordered - sh > 0.0001) unshippedLines++;
    if (out > 0.0001) shortLines++;
    roundQty += rq;
    lines.push({ itemId: it.record_id, productId: pid, unitCode: it.unit_code || '',
      factor: factor, ordered: ordered, baseOrdered: baseOrdered, shipped: sh, round: rq, outstanding: out,
      isFree: String(it.is_free) === '1' });
  });

  return {
    hasRounds: rounds.length > 0, currentRound: current, rounds: rounds, linesByRound: linesByRound,
    lines: lines, shipBase: shipBase, roundQty: roundQty,
    unshippedLines: unshippedLines, shortLines: shortLines
  };
}

/** หน่วยฐานต่อสินค้าที่ "รอบปัจจุบันจะตัดออกจากคลัง" — ตัวที่ applySaleWarehouseStock ใช้ตัด/คืน
 *  ★ ตัดกับคืนต้องอ่านจากตัวเดียวกันเสมอ และรอบที่เลยขั้น accepted ไปแล้ว **แก้จำนวนไม่ได้** (saveDeliveryRound กันไว้)
 *    ไม่งั้นคืนของไม่เท่าที่ตัดไป แล้วสต็อกเพี้ยนแบบไม่มีอะไรฟ้อง */
function saleShipBaseByProduct(tenantId, order, items) {
  return saleDeliveryPlan(tenantId, order, items).shipBase;
}

/** หน่วยฐานที่ "ต้องกันไว้ให้บิลนี้" ณ สถานะที่กำลังจะเป็น = ของที่ยังไม่ได้ตัดออกจากคลัง
 *  ของที่ส่งไปแล้ว (รอบที่ปิดแล้ว) ไม่ต้องกัน — มันออกจากคลังไปถึงมือลูกค้าแล้ว
 *  ของที่รอบปัจจุบันเพิ่งถูกตัด ก็ไม่ต้องกัน — ถูกหักจาก on-hand ไปแล้ว กันอีกคือนับซ้ำสองทาง */
function saleReserveBaseByProduct(tenantId, order, statusAfter, items) {
  if (!order || String(order.fulfillment_type) === 'immediate') return {};
  var st = String(statusAfter || order.status || '').toLowerCase();
  if (DR_RESERVE_STATUSES.indexOf(st) === -1) return {};
  var cut = saleStockTaken({ fulfillment_type: order.fulfillment_type, status: st });
  var plan = saleDeliveryPlan(tenantId, order, items);
  var need = {};
  plan.lines.forEach(function(l) {
    // ใบที่ไม่เคยแยกรอบ: ยังไม่ตัด = กันไว้ทั้งใบตาม base_qty (เท่ากับโค้ดเดิมเป๊ะ) · ตัดแล้ว = ไม่ต้องกัน
    if (!plan.hasRounds) {
      if (!cut && l.baseOrdered) need[l.productId] = (need[l.productId] || 0) + l.baseOrdered;
      return;
    }
    var q = l.ordered - l.shipped - (cut ? l.round : 0);
    if (q > 0.0001) need[l.productId] = (need[l.productId] || 0) + q * l.factor;
  });
  return need;
}

/**
 * ทำให้ยอดจองของบิลตรงกับ "ที่ควรเป็น" ณ สถานะนั้น — เขียนเฉพาะตอนไม่ตรง
 *
 * ★★ ของเดิมคิดแบบ "เทียบก่อน/หลังแล้วค่อยจอง-ปลด" (wasRes !== willRes) ซึ่งพลาดเมื่อยอดจองมีอยู่แล้ว
 *   ก่อนเข้าสถานะที่คิดว่าเป็นจุดเริ่มจอง: บิลที่แอดมินเปิด จองไว้ตั้งแต่ recordSaleAdmin แล้ว พอกด "รับงาน"
 *   ระบบจองซ้ำอีกชุด → ของถูกกันไว้สองเท่า "ขายได้จริง" ติดลบทั้งที่ของยังอยู่ครบ
 *   → เปลี่ยนมาคิดแบบ **สถานะปลายทางควรมียอดจองเท่าไร** แล้วทำให้เท่านั้น (idempotent เรียกซ้ำกี่ครั้งก็เท่าเดิม)
 */
function syncSaleReservations(tenantId, order, statusAfter, items) {
  var want = saleReserveBaseByProduct(tenantId, order, statusAfter, items);
  var scope = _saleStockScope(tenantId);
  var have = {};
  _scoped('stock_reservations', scope).forEach(function(r) {
    if (String(r.status) !== 'active' || String(r.order_id) !== String(order.record_id)) return;
    have[String(r.product_id)] = (have[String(r.product_id)] || 0) + (Number(r.qty) || 0);
  });
  var keys = {};
  Object.keys(want).forEach(function(k) { keys[k] = 1; });
  Object.keys(have).forEach(function(k) { keys[k] = 1; });
  var same = Object.keys(keys).every(function(k) { return Math.abs((have[k] || 0) - (want[k] || 0)) < 0.0001; });
  if (same) return { changed: false };

  releaseStockReservation(tenantId, order.record_id);
  var n = Object.keys(want).length;
  if (n) reserveStockForSale(tenantId, _ensureScopeWarehouse(scope), want, order.record_id);
  return { changed: true, reserved: n ? want : null };
}

/** คอลัมน์บอกใบ้บนแถวบิล ให้ตาราง/กระดานรู้เรื่องรอบโดยไม่ต้องอ่านตารางรอบ (ดู saleOrderHasRounds) */
function _drOrderHintFields(plan) {
  return {
    ship_round_no: plan.currentRound ? (parseInt(plan.currentRound.round_no) || 1)
      : (plan.rounds.length ? plan.rounds.length : ''),
    backorder_lines: plan.shortLines || 0
  };
}

/** เขียนบรรทัดของรอบใหม่ทั้งชุด (ลบของเดิมของรอบนั้นก่อน) — บรรทัดของรอบคือ "แผนจะส่ง" ไม่ใช่ยอดเงิน */
function _drWriteRoundItems(tenantId, roundId, orderId, lines) {
  var sh = tenantSheet(tenantId, 'delivery_round_items');
  deleteRowsWhere(sh, 'round_id', roundId);
  lines.forEach(function(l) {
    if (!(l.qty > 0)) return;
    tenantAppend(tenantId, 'delivery_round_items', {
      record_id: tenantNextId(tenantId, 'delivery_round_items'), round_id: roundId, order_id: orderId,
      item_id: l.itemId, product_id: l.productId, unit_code: l.unitCode || '',
      unit_factor: l.factor, qty: l.qty, base_qty: Math.round(l.qty * l.factor * 10000) / 10000
    });
  });
}

/** เปิดรอบใหม่ 1 รอบ — รอบ 1 ใช้เลข PICK/DO ที่ออกไว้แล้วตอนรับงาน (อาจพิมพ์ไปแล้ว ห้ามเปลี่ยน)
 *  รอบ 2 ขึ้นไปออกเลขใหม่ของตัวเอง เพราะเป็นของอีกเที่ยวรถ ลูกค้าเซ็นรับอีกใบ */
function _drOpenRound(tenantId, order, roundNo, lines, by) {
  var now = nowStr();
  var pick = (roundNo === 1 && String(order.picking_no || '').trim()) ? String(order.picking_no) : getNextDocNumber(tenantId, 'PICK');
  var dlv = (roundNo === 1 && String(order.delivery_order_no || '').trim()) ? String(order.delivery_order_no) : getNextDocNumber(tenantId, 'DO');
  var id = tenantNextId(tenantId, 'delivery_rounds');
  tenantAppend(tenantId, 'delivery_rounds', {
    record_id: id, order_id: order.record_id, round_no: roundNo, status: DR_OPEN,
    picking_no: pick, picking_at: now, delivery_order_no: dlv, delivery_order_at: now,
    shipped_at: '', note: '', created_at: now, created_by: by, updated_at: now, updated_by: by
  });
  _drWriteRoundItems(tenantId, id, order.record_id, lines);
  return { id: id, roundNo: roundNo, pickingNo: pick, deliveryOrderNo: dlv, at: now };
}

/**
 * แอดมินกำหนดว่า "รอบนี้ส่งอะไรเท่าไร" ที่เหลือเป็นของค้างส่ง
 * payload: { id, tenantId?, lines: [{ itemId, qty }], note? }
 *
 * ★ ทำได้เฉพาะขั้น "รับงานเตรียมการจัดส่ง" — เลยขั้นนี้ไปแล้วของถูกตัดออกจากคลังตามจำนวนของรอบไปแล้ว
 *   แก้จำนวนตอนนั้นคือทำให้ยอดที่คืนไม่เท่ากับยอดที่ตัด (ย้อนขั้นกลับมาก่อนถ้าจะแก้)
 */
function saveDeliveryRound(session, payload) {
  var err = _requirePermission(session, 'sales', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  ensureTenantSheetsCurrent(tenantId);

  return _withDocLock(function() {
    var order = null;
    order = tenantRowById(tenantId, 'sales_orders', payload.id);
    if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
    if (String(order.fulfillment_type) === 'immediate') return { success: false, message: 'บิลขายจากรถส่งของไปแล้วตั้งแต่เปิดบิล แยกรอบจัดส่งไม่ได้' };
    var status = _soStatusOf(order);
    if (status !== SO_ACCEPTED) {
      return { success: false, message: 'แยกของค้างส่งได้เฉพาะขั้น "' + SO_STATUS_LABELS[SO_ACCEPTED] + '" (ใบนี้อยู่ขั้น "' + (SO_STATUS_LABELS[status] || status) + '") — ย้อนขั้นกลับมาก่อนถ้าจะแก้' };
    }

    var plan = saleDeliveryPlan(tenantId, order);
    var byItem = {};
    plan.lines.forEach(function(l) { byItem[String(l.itemId)] = l; });

    var want = [], total = 0, bad = '';
    (payload.lines || []).forEach(function(row) {
      var l = byItem[String(row.itemId)];
      if (!l) return;
      var q = parseFloat(String(row.qty === undefined || row.qty === null || row.qty === '' ? 0 : row.qty).replace(/,/g, ''));
      if (isNaN(q) || q < 0) { bad = bad || 'จำนวนที่จะส่งต้องเป็นตัวเลขไม่ติดลบ'; return; }
      var max = l.ordered - l.shipped;
      if (q > max + 0.0001) {
        bad = bad || ('ส่งเกินที่สั่งไว้ไม่ได้ (เหลือส่งได้ ' + max + ' ' + (l.unitCode || 'หน่วย') + ')');
        return;
      }
      if (q > 0) { want.push({ itemId: l.itemId, productId: l.productId, unitCode: l.unitCode, factor: l.factor, qty: q }); total += q; }
    });
    if (bad) return { success: false, message: bad };
    if (!total) return { success: false, message: 'ต้องมีของที่จะส่งในรอบนี้อย่างน้อย 1 รายการ (ถ้าไม่มีของส่งเลย ให้ปล่อยใบไว้ที่ขั้นรับงาน)' };

    var by = String(session.displayName || session.username || '');
    var now = nowStr(), fields = {}, roundNo, roundId, pickingNo, deliveryOrderNo;
    if (plan.currentRound) {
      roundNo = parseInt(plan.currentRound.round_no) || 1;
      roundId = plan.currentRound.record_id;
      pickingNo = plan.currentRound.picking_no; deliveryOrderNo = plan.currentRound.delivery_order_no;
      _drWriteRoundItems(tenantId, roundId, order.record_id, want);
      tenantUpdate(tenantId, 'delivery_rounds', roundId, { note: String(payload.note || ''), updated_at: now, updated_by: by });
    } else {
      /* ★ ส่งครบทุกบรรทัดในใบที่ยังไม่เคยแยกรอบ = ไม่มีของค้างส่ง → **ไม่สร้างแถวรอบเลย**
         บิลเดินทางเดิม (รอบ = ทั้งใบ) และไม่มีตารางรอบว่างๆ ค้างไว้ให้คนอ่านสับสน */
      var allOut = plan.lines.every(function(l) {
        var w = want.filter(function(x) { return String(x.itemId) === String(l.itemId); })[0];
        return Math.abs((w ? w.qty : 0) - (l.ordered - l.shipped)) < 0.0001;
      });
      if (allOut) return { success: true, noSplitNeeded: true, message: 'รอบนี้ส่งครบทั้งใบ ไม่มีของค้างส่ง' };
      var opened = _drOpenRound(tenantId, order, (plan.rounds.length || 0) + 1, want, by);
      roundNo = opened.roundNo; roundId = opened.id;
      pickingNo = opened.pickingNo; deliveryOrderNo = opened.deliveryOrderNo;
      fields.picking_no = opened.pickingNo; fields.picking_at = opened.at;
      fields.delivery_order_no = opened.deliveryOrderNo; fields.delivery_order_at = opened.at;
    }

    /* ★★ ต้องบอก `order` ที่ถืออยู่ในมือว่า "ตอนนี้มีรอบแล้ว" ก่อนคิดแผนใหม่
       ไม่งั้น saleOrderHasRounds() ยังอ่านค่าเก่า (ว่าง) จากตัวแปรเดิม แล้วแผนที่ได้จะมองไม่เห็น
       รอบที่เพิ่งสร้างไปเมื่อกี้ — ตัวบอกใบ้บนแถวบิลจะถูกเขียนเป็น "ไม่มีรอบ" ทั้งที่มีรอบแล้ว
       แล้วการตัดสต็อกขั้นถัดไปจะกลับไปตัดทั้งใบ (ของไม่พอ) ซึ่งเป็นอาการที่หาต้นตอยาก */
    order.ship_round_no = roundNo;
    var after = saleDeliveryPlan(tenantId, order);
    var hint = _drOrderHintFields(after);
    for (var hk in hint) fields[hk] = hint[hk];
    fields.updated_at = now;
    fields.updated_by = String(session.adminUserId || session.username || '');
    _updateOrderRow(tenantId, order.record_id, fields);

    // ยอดจองไม่เปลี่ยนเพราะการแยกรอบ (ขั้นรับงานยังไม่ตัดของ) — เรียกไว้ให้แน่ใจว่าตรงเสมอ ถูกก็ไม่เขียนอะไร
    syncSaleReservations(tenantId, order, status);

    /* ประวัติต้องอ่านรู้เรื่องโดยไม่ต้องเปิดทะเบียนสินค้าเทียบ — ใช้รหัสสินค้าที่คนใช้คุยกันจริง
       (ทะเบียนสินค้าอยู่ในชุดที่แคชไว้แล้ว ไม่ได้เพิ่มรอบอ่านชีต) */
    var pcode = {};
    centralObjects('products').forEach(function(p) { pcode[String(p.record_id)] = p.product_code || p.record_id; });
    var shortTxt = after.lines.filter(function(l) { return l.outstanding > 0.0001; })
      .map(function(l) { return pcode[l.productId] + '×' + l.outstanding + ' ' + (l.unitCode || ''); }).join(', ');
    logOrderStatus(tenantId, order.record_id, status, status, orderPaymentStatus(order), orderPaymentStatus(order),
      'แยกรอบจัดส่งที่ ' + roundNo + ': ส่งรอบนี้ ' + total + ' หน่วย' + (shortTxt ? ' · ค้างส่ง ' + shortTxt : ' · ไม่มีของค้างส่ง'),
      by, _adminRoleLabel(session));

    return { success: true, roundNo: roundNo, roundId: roundId, pickingNo: pickingNo, deliveryOrderNo: deliveryOrderNo,
      shortLines: after.shortLines,
      message: 'บันทึกรอบจัดส่งที่ ' + roundNo + ' แล้ว' + (after.shortLines ? ' · ค้างส่ง ' + after.shortLines + ' รายการ' : '') };
  });
}

/**
 * ปิดรอบปัจจุบันเป็น "ส่งสำเร็จ" แล้วเปิดรอบถัดไปให้ของที่ยังไม่ได้ส่ง
 * เรียกจาก updateSalesOrderStatus ตอนกด "จัดส่งสำเร็จ" ขณะที่ยังมีของค้าง — ไม่ใช่ action แยก
 * (แอดมินกดปุ่มเดิมปุ่มเดียว ระบบคิดให้เองว่าจะปิดบิลหรือจะเปิดรอบถัดไป)
 *
 * ★ ของรอบที่ปิดแล้ว **ไม่คืนเข้าคลัง** — มันถึงมือลูกค้าไปแล้ว การกลับไปสถานะ accepted จึงต้องไม่ไปเข้า
 *   ทางคืนสต็อกปกติ (ผู้เรียกกันไว้ให้แล้ว ดูคอมเมนต์ที่จุดเรียกใน 34_sales_status.gs)
 */
function rolloverDeliveryRound(tenantId, order, session, plan) {
  if (!plan.currentRound) return null;
  var by = String(session.displayName || session.username || ''), now = nowStr();
  var curNo = parseInt(plan.currentRound.round_no) || 1;
  tenantUpdate(tenantId, 'delivery_rounds', plan.currentRound.record_id,
    { status: DR_SHIPPED, shipped_at: now, updated_at: now, updated_by: by });

  var rest = plan.lines
    .filter(function(l) { return l.ordered - l.shipped - l.round > 0.0001; })
    .map(function(l) { return { itemId: l.itemId, productId: l.productId, unitCode: l.unitCode, factor: l.factor,
      qty: l.ordered - l.shipped - l.round }; });
  var opened = _drOpenRound(tenantId, order, curNo + 1, rest, by);

  return {
    fields: { status: SO_ACCEPTED, delivered_at: '',
      picking_no: opened.pickingNo, picking_at: opened.at,
      delivery_order_no: opened.deliveryOrderNo, delivery_order_at: opened.at,
      ship_round_no: opened.roundNo, backorder_lines: 0 },
    status: SO_ACCEPTED, roundNo: curNo, nextRoundNo: opened.roundNo,
    changes: ['ปิดรอบที่ ' + curNo + ' (ส่งสำเร็จ)',
      'เปิดรอบที่ ' + opened.roundNo + ' ให้ของค้างส่ง ' + rest.length + ' รายการ (ใบจัดของ ' + opened.pickingNo + ' · ใบส่งสินค้า ' + opened.deliveryOrderNo + ')']
  };
}

/** บิลส่งครบแล้ว — ปิดรอบที่เปิดค้างอยู่ให้เป็น "ส่งสำเร็จ" (รอบสุดท้ายของใบ) */
function closeLastDeliveryRound(tenantId, order, plan, session) {
  if (!plan || !plan.currentRound) return null;
  var now = nowStr();
  tenantUpdate(tenantId, 'delivery_rounds', plan.currentRound.record_id, { status: DR_SHIPPED, shipped_at: now,
    updated_at: now, updated_by: String((session && (session.displayName || session.username)) || '') });
  return parseInt(plan.currentRound.round_no) || 1;
}

/**
 * แผนจัดส่ง + ของคงเหลือในคลัง สำหรับหน้ารายละเอียดบิล
 * (แอดมินศูนย์ขอ 14 ต.ค. 2026: "ต้องการเห็นยอดสินค้าคงเหลือในบิลที่เตรียมการจัดส่ง เพื่อรู้ว่าของพอส่งไหม")
 *
 * ★★ แยกเป็น action ของตัวเอง ไม่ยัดเข้า getSalesOrderAdmin — หน้าเว็บยิงขนานกับใบรายละเอียด
 *   คำขอขนานกันราคาเท่าคำขอเดียว (CLAUDE.md ข้อ 7 วัดไว้แล้ว) การเปิดดูบิลจึงไม่ช้าลงเลยแม้แต่มิลลิวินาที
 *   ส่วนการยัดเข้าใบเดิมจะบวกการอ่าน warehouse_stock + stock_reservations (สองตารางที่ **แคชไม่ได้**)
 *   เข้าไปในเส้นทางที่ผู้ใช้บ่นว่าช้าอยู่แล้ว
 */
function getSaleDeliveryPlan(session, payload) {
  var err = _requirePermission(session, 'sales', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var order = null;
  order = tenantRowById(tenantId, 'sales_orders', payload.id);
  if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
  // ขายจากรถตัดของจากรถไปแล้วตั้งแต่กดบันทึก ไม่มีคลังกลางให้ดูและแยกรอบไม่ได้
  if (String(order.fulfillment_type) === 'immediate') return { success: true, applicable: false, lines: [], rounds: [] };

  var plan = saleDeliveryPlan(tenantId, order);
  var scope = _saleStockScope(tenantId);
  var warehouseId = _ensureScopeWarehouse(scope);

  var onHand = {}, resMine = {}, resOther = {};
  _scoped('warehouse_stock', scope).forEach(function(r) {
    if (String(r.warehouse_id) !== String(warehouseId)) return;
    onHand[String(r.product_id)] = Number(r.qty) || 0;
  });
  _scoped('stock_reservations', scope).forEach(function(r) {
    if (String(r.status) !== 'active' || String(r.warehouse_id) !== String(warehouseId)) return;
    var pid = String(r.product_id), q = Number(r.qty) || 0;
    if (String(r.order_id) === String(order.record_id)) resMine[pid] = (resMine[pid] || 0) + q;
    else resOther[pid] = (resOther[pid] || 0) + q;
  });

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var wName = '';
  centralObjects('warehouses').forEach(function(w) { if (String(w.record_id) === String(warehouseId)) wName = w.name || ''; });

  var lines = plan.lines.map(function(l) {
    var p = products[l.productId] || {};
    var oh = onHand[l.productId] || 0, ro = resOther[l.productId] || 0;
    /* ขายได้จริง = ของในคลัง − ที่กันไว้ให้ "ใบอื่น" · ไม่หักที่กันไว้ให้ใบนี้เอง
       ไม่งั้นแอดมินอ่านว่า "ขายได้ 0" ทั้งที่ของที่เห็นเป็นศูนย์คือของที่ระบบกันไว้ให้ใบที่เขากำลังเปิดอยู่ */
    var avail = oh - ro;
    var needBase = (l.ordered - l.shipped) * l.factor;
    return { itemId: l.itemId, productId: l.productId, productCode: p.product_code || '', productName: p.name || '(สินค้าถูกลบ)',
      unitCode: l.unitCode, factor: l.factor, baseUnit: p.unit || '',
      ordered: l.ordered, shipped: l.shipped, round: l.round, outstanding: l.outstanding, isFree: l.isFree,
      onHand: oh, reservedOther: ro, reservedMine: resMine[l.productId] || 0, available: avail,
      /* "ส่งได้กี่หน่วยขาย" จากของที่ขายได้จริง — ปัดลงเป็นจำนวนเต็มหน่วยขาย (ส่งครึ่งลังไม่ได้)
         ★ ไม่บวกยอดที่กันไว้ให้ใบนี้กลับเข้าไป — ของที่กันไว้ยังนอนอยู่ใน on-hand อยู่แล้ว บวกอีกคือนับซ้ำ */
      canShip: l.factor > 0 ? Math.max(0, Math.floor(avail / l.factor)) : 0,
      shortBase: Math.max(0, needBase - avail) };
  });

  var rounds = plan.rounds.map(function(r) {
    var its = (plan.linesByRound[String(r.record_id)] || []).map(function(ri) {
      var p = products[String(ri.product_id)] || {};
      return { itemId: ri.item_id, productId: ri.product_id, productCode: p.product_code || '', productName: p.name || '',
        unitCode: ri.unit_code || '', qty: parseFloat(ri.qty) || 0 };
    });
    return { id: r.record_id, roundNo: parseInt(r.round_no) || 0, status: String(r.status || ''),
      statusLabel: DR_STATUS_LABELS[String(r.status)] || String(r.status || ''),
      pickingNo: r.picking_no || '', deliveryOrderNo: r.delivery_order_no || '',
      shippedAt: safeDateStr(r.shipped_at), createdAt: safeDateStr(r.created_at), note: r.note || '', items: its };
  });

  /* ★ ประวัติสถานะมาด้วยกับคำขอนี้ (15 ต.ค. 2026) — ไฟล์ตัวแทนถูกเปิดอยู่แล้วตรงนี้
     ย้ายมาจาก getSalesOrderAdmin เพื่อให้เส้นทางวิกฤต (หัวบิล + รายการสินค้า) สั้นลงหนึ่งแท็บ
     สองคำขอนี้ยิงขนานกัน เวลารวมจึงเท่ากับตัวที่ช้ากว่า ไม่ใช่ผลบวก */
  return { success: true, applicable: true, warehouse: wName || warehouseId,
    statusLog: orderStatusLog(tenantId, order.record_id),
    status: _soStatusOf(order), canSplit: _soStatusOf(order) === SO_ACCEPTED && hasPermission(session, 'sales', 'edit'),
    hasRounds: plan.hasRounds, currentRoundNo: plan.currentRound ? (parseInt(plan.currentRound.round_no) || 1) : 0,
    shortLines: plan.shortLines, unshippedLines: plan.unshippedLines, lines: lines, rounds: rounds };
}
