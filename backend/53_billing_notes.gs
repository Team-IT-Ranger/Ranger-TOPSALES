/**
 * ===================== ใบวางบิล (Billing Note) =====================
 * เมนู 5.3.2 · รวมใบแจ้งหนี้หลายใบของลูกค้ารายเดียวเป็นเอกสารวางบิลใบเดียว
 *
 * ★★ ทำไมต้องมี: ลูกค้า B2B ไทยเก็บเงิน**รอบเดือน** พนักงานเก็บเงินถือใบวางบิลไปวางที่ร้าน
 *   ร้านเซ็นรับแล้วนัดวันจ่าย · ก่อนหน้านี้ระบบออกใบแจ้งหนี้ได้ทีละใบ แอดมินต้องพิมพ์หลายใบ
 *   แล้วเขียนใบปะหน้าเอง ซึ่งยอดรวมมักไม่ตรงกับที่ร้านนับได้ แล้วต้องมานั่งไล่กันทีหลัง
 *
 * ★ **ใบวางบิลไม่ใช่เอกสารภาษีและไม่ลงบัญชี** — มันคือ "ซองรวมใบแจ้งหนี้" เท่านั้น
 *   ภาระหนี้เกิดที่ใบแจ้งหนี้ไปแล้ว การวางบิลไม่ทำให้หนี้เพิ่มหรือลด จึงไม่มี journal
 *   (เผลอลงบัญชีเมื่อไหร่ = ลูกหนี้โตเป็นสองเท่าทันที)
 *
 * ★ **รับชำระยังทำที่ใบแจ้งหนี้เหมือนเดิม** ไม่ได้ย้ายมาที่ใบวางบิล — เพราะลูกค้าจ่ายไม่ครบ
 *   ตามที่วางบิลเป็นเรื่องปกติ (จ่ายบางใบ ค้างบางใบ) ยอดคงค้างต้องอยู่ที่ใบจริงเสมอ
 *   ใบวางบิลแค่โชว์สถานะว่าใบไหนเก็บได้แล้วบ้าง
 */

var BN_STATUS = { open: 'วางบิลแล้ว', cancelled: 'ยกเลิก' };

/** ใบแจ้งหนี้ที่ยัง "วางบิลได้" — ยังค้างอยู่ และยังไม่ถูกใบวางบิลใบอื่นจองไว้ */
function _bnTakenInvoiceIds(book, exceptNoteId) {
  var taken = {};
  var liveNotes = {};
  centralObjects('billing_notes').forEach(function(n) {
    if (!_inBook(n, book)) return;
    if (String(n.status) === 'cancelled') return;
    if (exceptNoteId && String(n.record_id) === String(exceptNoteId)) return;
    liveNotes[String(n.record_id)] = true;
  });
  centralObjects('billing_note_items').forEach(function(it) {
    if (liveNotes[String(it.note_id)]) taken[String(it.invoice_id)] = true;
  });
  return taken;
}

/** payload: { customerId?, tenantId? } — ไม่ระบุลูกค้า = ดูทุกราย */
function listBillableInvoices(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var book = _bookScope(session, payload);
  var taken = _bnTakenInvoiceIds(book);
  var cust = {};
  centralObjects('customers').forEach(function(c) { cust[String(c.record_id)] = customerFullName(c); });

  var rows = [];
  centralObjects('ar_invoices').forEach(function(iv) {
    if (!_inBook(iv, book)) return;
    if (String(iv.status) === 'void') return;
    if (payload.customerId && String(iv.customer_id) !== String(payload.customerId)) return;
    if (taken[String(iv.record_id)]) return;
    var out = arInvoiceOutstanding(iv);
    if (!(out > 0.009)) return;                 // เก็บครบแล้วไม่ต้องวางบิลอีก
    rows.push({ id: iv.record_id, invoiceNo: iv.invoice_no, customerId: iv.customer_id,
      customerName: cust[String(iv.customer_id)] || '', invoiceDate: _dOnly(iv.invoice_date),
      dueDate: _dOnly(iv.due_date), total: _money(Number(iv.total) || 0), outstanding: out,
      salesOrderId: iv.sales_order_id || '' });
  });
  rows.sort(function(a, b) {
    return String(a.customerName).localeCompare(String(b.customerName), 'th') ||
           String(a.invoiceDate).localeCompare(String(b.invoiceDate));
  });
  return { success: true, data: rows };
}

/** payload: { customerId, invoiceIds:[], noteDate?, dueDate?, note?, tenantId? } */
function createBillingNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  return _withDocLock(function() {
    var book = _bookScope(session, payload);
    var ids = (payload.invoiceIds || []).map(String);
    if (!ids.length) return { success: false, message: 'ยังไม่ได้เลือกใบแจ้งหนี้' };

    var date = payload.noteDate || _todayStr();
    if (!_validDate(date)) return { success: false, message: 'วันที่วางบิลต้องเป็น yyyy-MM-dd' };
    if (payload.dueDate && !_validDate(payload.dueDate)) return { success: false, message: 'วันนัดชำระต้องเป็น yyyy-MM-dd' };

    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(payload.customerId)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };

    var taken = _bnTakenInvoiceIds(book);
    var picked = [], total = 0;
    for (var i = 0; i < ids.length; i++) {
      var iv = _findById('ar_invoices', ids[i]);
      if (!iv) return { success: false, message: 'ไม่พบใบแจ้งหนี้ id ' + ids[i] };
      if (!_inBook(iv, book)) return { success: false, message: 'ใบ ' + iv.invoice_no + ' ไม่ได้อยู่ในสมุดที่เลือกอยู่' };
      if (String(iv.status) === 'void') return { success: false, message: 'ใบ ' + iv.invoice_no + ' ถูกยกเลิกแล้ว' };
      /* ★ ลูกค้าต้องเป็นรายเดียวกันทั้งใบวางบิล — วางบิลข้ามร้านแล้วพนักงานเก็บเงินถือไปผิดร้าน
         และยอดที่ร้านเซ็นรับจะไม่ใช่ยอดของเขา */
      if (String(iv.customer_id) !== String(customer.record_id))
        return { success: false, message: 'ใบ ' + iv.invoice_no + ' เป็นของลูกค้ารายอื่น' };
      if (taken[String(iv.record_id)]) return { success: false, message: 'ใบ ' + iv.invoice_no + ' ถูกวางบิลไปแล้ว' };
      var out = arInvoiceOutstanding(iv);
      if (!(out > 0.009)) return { success: false, message: 'ใบ ' + iv.invoice_no + ' เก็บเงินครบแล้ว' };
      picked.push({ iv: iv, outstanding: out });
      total += out;
    }

    var noteId = centralNextId('billing_notes');
    var noteNo = _nextCentralDocNo('BN', book || undefined);
    centralAppend('billing_notes', { record_id: noteId, tenant_id: book || '', note_no: noteNo,
      customer_id: customer.record_id, note_date: date, due_date: payload.dueDate || '',
      invoice_count: picked.length, total: _money(total), status: 'open', note: String(payload.note || ''),
      created_by: session.adminUserId, created_at: nowStr() });
    var itemId = centralNextId('billing_note_items');
    centralAppendMany('billing_note_items', picked.map(function(p, i) {
      /* ★ เก็บ "ยอดค้าง ณ วันวางบิล" ไว้เป็นภาพนิ่ง — ยอดจริงขยับได้ทีหลัง (รับชำระ/ลดหนี้)
         แต่เอกสารที่ร้านเซ็นรับไว้ต้องพิมพ์ซ้ำได้เหมือนเดิมเป๊ะเสมอ */
      return { record_id: itemId + i, note_id: noteId, invoice_id: p.iv.record_id,
        invoice_no: p.iv.invoice_no, invoice_date: _dOnly(p.iv.invoice_date),
        due_date: _dOnly(p.iv.due_date), amount: p.outstanding };
    }));
    return { success: true, noteId: noteId, noteNo: noteNo, total: _money(total), count: picked.length,
      message: 'ออกใบวางบิล ' + noteNo + ' รวม ' + picked.length + ' ใบ ยอด ' + _money(total).toLocaleString() + ' บาท' };
  });
}

function listBillingNotes(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var book = _bookScope(session, payload);
  var cust = {};
  centralObjects('customers').forEach(function(c) { cust[String(c.record_id)] = customerFullName(c); });
  /* ยอดที่ "ยังเก็บไม่ได้" ของใบวางบิลหนึ่งใบ — คิดสดจากใบแจ้งหนี้จริง ไม่ใช่จากภาพนิ่ง
     คนถามเสมอว่า "วางบิลไปแล้วเก็บได้เท่าไร" ซึ่งต้องเป็นยอดวันนี้ ไม่ใช่ยอดวันวางบิล */
  var openByNote = {};
  var itemsByNote = {};
  centralObjects('billing_note_items').forEach(function(it) {
    (itemsByNote[String(it.note_id)] = itemsByNote[String(it.note_id)] || []).push(it);
  });
  var rows = centralObjects('billing_notes').filter(function(n) {
    if (!_inBook(n, book)) return false;
    if (payload.customerId && String(n.customer_id) !== String(payload.customerId)) return false;
    return true;
  }).map(function(n) {
    var left = 0;
    (itemsByNote[String(n.record_id)] || []).forEach(function(it) {
      var iv = _findById('ar_invoices', it.invoice_id);
      if (iv && String(iv.status) !== 'void') left += arInvoiceOutstanding(iv);
    });
    openByNote[String(n.record_id)] = _money(left);
    return { id: n.record_id, noteNo: n.note_no, customerId: n.customer_id,
      customerName: cust[String(n.customer_id)] || '', noteDate: _dOnly(n.note_date), dueDate: _dOnly(n.due_date),
      invoiceCount: _int(n.invoice_count), total: _money(Number(n.total) || 0), outstanding: _money(left),
      collected: _money((Number(n.total) || 0) - left),
      status: n.status || 'open', statusLabel: BN_STATUS[String(n.status)] || n.status, note: n.note || '' };
  });
  rows.sort(function(a, b) { return String(b.noteDate).localeCompare(String(a.noteDate)) || (b.id - a.id); });
  return { success: true, data: rows.slice(0, _int(payload.limit) || 200) };
}

/** ใบเดียวพร้อมรายการ — ใช้ตอนพิมพ์ */
function getBillingNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var n = _findById('billing_notes', payload.id);
  if (!n) return { success: false, message: 'ไม่พบใบวางบิลนี้' };
  var book = _bookScope(session, payload);
  if (!_inBook(n, book)) return { success: false, message: 'ไม่พบใบวางบิลนี้' };

  var customer = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(n.customer_id)) customer = c; });
  var items = centralObjects('billing_note_items').filter(function(it) {
    return String(it.note_id) === String(n.record_id);
  }).map(function(it) {
    var iv = _findById('ar_invoices', it.invoice_id) || {};
    return { invoiceId: it.invoice_id, invoiceNo: it.invoice_no, invoiceDate: _dOnly(it.invoice_date),
      dueDate: _dOnly(it.due_date), amount: _money(Number(it.amount) || 0),
      /* ยอดค้าง "ตอนนี้" คู่กับยอด "ตอนวางบิล" — ต่างกันเมื่อไหร่แปลว่ามีการเก็บเงิน/ลดหนี้หลังวางบิล */
      outstandingNow: iv.record_id ? arInvoiceOutstanding(iv) : 0,
      salesOrderId: iv.sales_order_id || '' };
  });
  return { success: true,
    note: { id: n.record_id, noteNo: n.note_no, noteDate: _dOnly(n.note_date), dueDate: _dOnly(n.due_date),
      total: _money(Number(n.total) || 0), invoiceCount: _int(n.invoice_count),
      status: n.status || 'open', statusLabel: BN_STATUS[String(n.status)] || n.status, note: n.note || '' },
    customer: customer ? { id: customer.record_id, name: customerFullName(customer), code: customer.customer_code || '',
      address: customer.address || '', taxId: customer.tax_id || '', branchCode: customer.tax_branch_code || '',
      phone: customer.phone || '' } : null,
    items: items, issuer: typeof _docIssuer === 'function' ? _docIssuer(book) : null };
}

/** ยกเลิกใบวางบิล — ใบแจ้งหนี้ที่อยู่ในนั้นกลับมาวางบิลใบใหม่ได้ */
function cancelBillingNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  var n = _findById('billing_notes', payload.id);
  if (!n) return { success: false, message: 'ไม่พบใบวางบิลนี้' };
  if (!_inBook(n, _bookScope(session, payload))) return { success: false, message: 'ไม่พบใบวางบิลนี้' };
  if (String(n.status) === 'cancelled') return { success: false, message: 'ใบนี้ถูกยกเลิกไปแล้ว' };
  /* ★ ไม่ลบแถว — เก็บไว้เป็นประวัติว่าเคยวางบิลใบนี้ไป (ร้านอาจถือสำเนาอยู่)
     แค่ปลดใบแจ้งหนี้ออกให้ไปอยู่ใบวางบิลใหม่ได้ ซึ่ง `_bnTakenInvoiceIds` ข้ามใบที่ยกเลิกอยู่แล้ว */
  centralUpdate('billing_notes', n.record_id, { status: 'cancelled',
    note: [n.note, 'ยกเลิก: ' + String(payload.reason || '-')].filter(function(x) { return x; }).join(' · ') });
  return { success: true, message: 'ยกเลิกใบวางบิล ' + n.note_no + ' แล้ว — ใบแจ้งหนี้กลับไปวางบิลใหม่ได้' };
}
