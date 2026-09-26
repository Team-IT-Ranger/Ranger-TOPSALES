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

var SO_PENDING = 'pending_delivery', SO_DELIVERING = 'delivering', SO_COMPLETED = 'completed', SO_CANCELLED = 'cancelled';
var SO_STATUS_LABELS = {
  pending_delivery: 'รอสำนักงานจัดส่ง', delivering: 'กำลังจัดส่ง', completed: 'ส่งของแล้ว', cancelled: 'ยกเลิกแล้ว'
};
// ไปไหนต่อได้บ้างจากสถานะปัจจุบัน — ย้อนกลับได้หนึ่งขั้น (กดผิดเป็นเรื่องปกติ) แต่บิลที่ยกเลิกแล้วเปิดคืนไม่ได้
var SO_TRANSITIONS = {
  pending_delivery: [SO_DELIVERING, SO_COMPLETED, SO_CANCELLED],
  delivering:       [SO_COMPLETED, SO_PENDING, SO_CANCELLED],
  completed:        [SO_DELIVERING, SO_CANCELLED],
  cancelled:        []
};

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

/** เขียนประวัติหนึ่งบรรทัด — เรียกทุกครั้งที่สถานะขยับ (รวมตอนเปิดบิลและตอนยกเลิก) */
function logOrderStatus(tenantId, orderId, from, to, fromPay, toPay, note, by) {
  try {
    tenantAppend(tenantId, 'order_status_log', {
      record_id: tenantNextId(tenantId, 'order_status_log'), order_id: orderId,
      from_status: from || '', to_status: to || '', from_payment: fromPay || '', to_payment: toPay || '',
      note: String(note || ''), changed_by: String(by || ''), changed_at: nowStr()
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
      note: r.note || '', by: r.changed_by || '', at: safeDateStr(r.changed_at)
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
    var fields = {}, changes = [];

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
        fields.status = toStatus;
        if (toStatus === SO_COMPLETED) fields.delivered_at = nowStr();
        if (toStatus === SO_PENDING || toStatus === SO_DELIVERING) fields.delivered_at = '';
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
    }

    if (!Object.keys(fields).length) return { success: false, message: 'ไม่มีอะไรเปลี่ยน' };
    fields.updated_at = nowStr();
    fields.updated_by = String(session.adminUserId || session.username || '');
    if (!_updateOrderRow(tenantId, order.record_id, fields)) return { success: false, message: 'บันทึกไม่สำเร็จ (ไม่พบแถวในชีต)' };

    logOrderStatus(tenantId, order.record_id, fromStatus, toStatus, fromPay, toPay, payload.note,
      session.displayName || session.username);

    return { success: true, status: toStatus, statusLabel: SO_STATUS_LABELS[toStatus],
      paymentStatus: toPay, paymentLabel: SO_PAYMENT_LABELS[toPay],
      paidAmount: fields.paid_amount !== undefined ? fields.paid_amount : (parseFloat(order.paid_amount) || 0),
      deliveredAt: fields.delivered_at !== undefined ? fields.delivered_at : safeDateStr(order.delivered_at),
      message: changes.length ? changes.join(' · ') : 'บันทึกแล้ว' };
  });
}
