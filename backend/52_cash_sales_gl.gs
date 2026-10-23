/**
 * ===================== ลงบัญชีการขายสด =====================
 * Dr เงินสด/ธนาคาร / Cr รายได้จากการขาย + Cr ภาษีขาย — ตอนออกใบกำกับภาษีของบิลขายสด
 *
 * ★★ ช่องว่างที่ปิด: รายได้ (4100) และภาษีขาย (2200) เคยเข้าบัญชีผ่าน `createArInvoice` **ทางเดียว**
 *   ซึ่ง `34_sales_status.gs` เรียกเฉพาะบิล **เครดิต** (`isCreditPayment`)
 *   ขายสด/ขายจากรถจึงออกใบกำกับภาษีให้ลูกค้าจริง แต่ไม่มีรายการในสมุดบัญชีสักบรรทัด
 *   → งบกำไรขาดทุนขาดรายได้ส่วนนั้น และยื่น ภ.พ.30 ด้วยยอดภาษีขายที่ต่ำกว่าความจริง
 *   (รายงานภาษีเมนู 5.8.1 เป็นตัวที่ทำให้เห็นช่องนี้ — ดู `51_tax_reports.gs`)
 *
 * ★ จุดลงบัญชี = **ตอนออกใบกำกับภาษี** ซึ่งเป็นจุดเกิดภาระภาษีตามกฎหมาย และเป็นจุดร่วมของ
 *   ขายสดทั้งสองทางที่เดินคนละเส้น:
 *     - ขายจากรถ (`immediate`) ออกใบเสร็จ+ใบกำกับตอนกดบันทึก แล้วปิดเป็น completed เลย
 *       **ไม่เคยเดินผ่านสถานะ "พร้อมจัดส่ง"**
 *     - ขายสดแบบสำนักงานจัดส่ง ออกใบกำกับตอนเข้า "พร้อมจัดส่ง" เหมือนบิลเครดิต
 *   เรียกได้จากทั้งสองที่ ตัวฟังก์ชันกันซ้ำเอง (คีย์ที่เลขบิล) จึงไม่ต้องจำว่าทางไหนเรียกแล้ว
 *
 * ★★★ เปิดใช้ต้องตั้งใจ (เมนู 5.9.1) และมีวันที่เริ่ม — **ไม่ใช่เพราะมันไม่ถูกต้อง แต่เพราะ
 *   ผู้ทำบัญชีอาจบันทึกการขายสดด้วยมือไว้แล้วนอกระบบ** เปิดย้อนหลังทับของเดิม = นับซ้ำ
 *   ซึ่งหาทีหลังยากกว่าขาดไปเสียอีก
 */

/** บัญชีที่เดบิตตอนรับเงิน — โอน/บัตรเข้าแบงก์ · นอกนั้นถือเป็นเงินสดในมือ */
function _cashSaleDebitAccount(order) {
  var m = String((order && order.payment_method) || '').toLowerCase();
  return (m.indexOf('transfer') !== -1 || m.indexOf('bank') !== -1 || m.indexOf('card') !== -1)
    ? GL_ACCT.BANK : GL_ACCT.CASH;
}

/** บิลใบนี้เป็นขายสดที่ควรลงบัญชีไหม */
function _isCashSaleForGl(order) {
  if (!order) return false;
  if (String(order.status) === 'cancelled') return false;
  if (isCreditPayment(order.payment_method)) return false;       // เครดิตลงผ่านใบแจ้งหนี้ลูกหนี้อยู่แล้ว
  return !!String(order.tax_invoice_no || '').trim();            // ยังไม่ออกใบกำกับ = ภาระภาษียังไม่เกิด
}

function _cashSaleRefId(order) { return String(order.record_id); }

function _findCashSaleJournal(book, refId) {
  var found = null;
  centralObjects('gl_journals').forEach(function(j) {
    if (String(j.ref_type) !== 'SALES_CASH') return;
    if (String(j.ref_id) !== String(refId)) return;
    if (!_inBook(j, book)) return;
    if (String(j.status) === 'voided') return;
    found = j;
  });
  return found;
}

/**
 * ลงบัญชีขายสดหนึ่งบิล — เรียกซ้ำได้ ไม่สร้างใบที่สอง
 * @return { posted, amount, skipped }  ★ ไม่โยน error ออกไป: ของส่งให้ลูกค้าไปแล้ว
 *   การลงบัญชีล้มต้องไม่ทำให้การบันทึกบิลหรือการเปลี่ยนสถานะล้มตาม
 */
function postCashSaleGl(tenantId, order, userId) {
  try {
    if (!_isCashSaleForGl(order)) return { posted: false, skipped: 'ไม่ใช่บิลขายสดที่ออกใบกำกับแล้ว' };

    var book = _cogsBook(_saleStockScope(tenantId));
    var st = _acctSettings(book);
    if (st.cashSales !== 'on') return { posted: false, skipped: 'ยังไม่ได้เปิดการลงบัญชีขายสด' };

    var when = _dOnly(order.tax_invoice_at || order.created_at) || _todayStr();
    if (st.cashFrom && when < st.cashFrom) return { posted: false, skipped: 'บิลลงวันที่ก่อนวันเริ่มลงบัญชีขายสด' };

    var refId = _cashSaleRefId(order);
    if (_findCashSaleJournal(book, refId)) return { posted: false, skipped: 'ลงบัญชีบิลนี้ไปแล้ว' };

    var v = _orderVat(order);
    var vat = _money(Number(order.vat_amount) || v.vat || 0);
    var total = _money(Number(order.total) || 0);
    /* ★ รายได้ = ยอดสุทธิ − ภาษี (รวมของยกเว้นภาษีด้วย เพราะมันก็คือรายได้ แค่ไม่มี VAT)
       คิดแบบ "หักภาษีออกจากยอดจริง" ไม่ใช่บวก subtotal_ex_vat + exempt_amount เพราะสองช่องนั้น
       เป็นภาพนิ่งที่บิลเก่าบางใบยังไม่มี — วิธีนี้ให้ เดบิต = เครดิต เป๊ะเสมอทุกใบ */
    var revenue = _money(total - vat);
    if (!(total > 0)) return { posted: false, skipped: 'ยอดบิลเป็น 0' };

    var cust = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(order.customer_id)) cust = c; });

    var lines = [
      { accountCode: _cashSaleDebitAccount(order), description: 'รับเงินขายสด ' + (order.order_code || ''),
        debit: total, credit: 0 },
      { accountCode: GL_ACCT.SALES, description: 'ขายสด ' + (order.order_code || ''), debit: 0, credit: revenue }
    ];
    // ไม่มีภาษี (ลูกค้า/สินค้ายกเว้น) อย่าใส่บรรทัดภาษี 0 ให้รกสมุด
    if (vat > 0) lines.push({ accountCode: GL_ACCT.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: vat });

    var jr = _postJournal({ date: when, source: 'SALES', refType: 'SALES_CASH', refId: refId, tenantId: book,
      memo: 'ขายสด ' + (order.order_code || '') + ' ' + (order.tax_invoice_no || '') +
            (cust ? ' ' + customerFullName(cust) : ''),
      createdBy: userId, lines: lines });
    if (!jr.success) return { posted: false, skipped: jr.message || 'ลงบัญชีไม่สำเร็จ' };
    return { posted: true, amount: total, vat: vat, revenue: revenue, journalNo: jr.journalNo };
  } catch (e) {
    Logger.log('postCashSaleGl ล้มเหลว: ' + (e.stack || e.message));
    return { posted: false, skipped: 'ผิดพลาด: ' + e.message };
  }
}

/**
 * กลับรายการขายสด (ยกเลิกบิล)
 * ★ ใช้ยอดเดิมจากใบที่ลงไว้ ไม่คิดใหม่จากบิล — บิลที่ถูกแก้หลังลงบัญชีจะทำให้สองขาไม่เท่ากัน
 *   (หลักเดียวกับการกลับรายการต้นทุนขายใน 50_cogs.gs)
 */
function reverseCashSaleGl(tenantId, order, userId, reason) {
  try {
    var book = _cogsBook(_saleStockScope(tenantId));
    var j = _findCashSaleJournal(book, _cashSaleRefId(order));
    if (!j) return { posted: false, skipped: 'ไม่เคยลงบัญชีบิลนี้' };

    var lines = _childrenOf('gl_journal_lines', 'journal_id', j.record_id).map(function(l) {
      return { accountCode: String(l.account_code), description: 'กลับรายการ: ' + (l.description || ''),
        debit: Number(l.credit) || 0, credit: Number(l.debit) || 0 };     // สลับข้างทีละบรรทัด
    });
    if (!lines.length) return { posted: false, skipped: 'ใบเดิมไม่มีบรรทัด' };

    var jr = _postJournal({ date: _todayStr(), source: 'SALES', refType: 'SALES_CASH_REV', refId: _cashSaleRefId(order),
      tenantId: book, memo: 'กลับรายการขายสด ' + (order.order_code || '') + (reason ? ' — ' + reason : ''),
      createdBy: userId, lines: lines });
    if (!jr.success) return { posted: false, skipped: jr.message || 'ลงบัญชีไม่สำเร็จ' };
    centralUpdate('gl_journals', j.record_id, { status: 'voided' });
    return { posted: true, amount: Number(j.total_debit) || 0, journalNo: jr.journalNo };
  } catch (e) {
    Logger.log('reverseCashSaleGl ล้มเหลว: ' + (e.stack || e.message));
    return { posted: false, skipped: 'ผิดพลาด: ' + e.message };
  }
}

/* ═══════════ ★★ ตามเก็บบิลขายสดที่ออกใบกำกับไปแล้วแต่ยังไม่ได้ลงบัญชี ═══════════
 * (เจ้าของระบบสั่ง 23 ต.ค. 2026 — "ระบบควรลงบัญชีอัตโนมัติ")
 *
 * ★ ตั้งแต่วันนี้บิลใหม่ลงให้เองตอนออกใบกำกับ (ค่าตั้งเริ่มต้นเปิดแล้ว) แต่บิลที่ออกใบไป**ก่อนหน้านั้น**
 *   ไม่มีใครย้อนไปลงให้ — บน UAT 23 ต.ค. 2026 ค้างอยู่ 46 ใบ ภาษีขาย 82,789.62 บาท
 *   งบกำไรขาดทุนจึงขาดรายได้ก้อนนั้น และบัญชีภาษีขายต่ำกว่าที่ยื่นจริง
 *
 * ★★★ **ดูอย่างเดียวเป็นค่าเริ่มต้น** (`commit !== true`) — ต้องสั่งลงจริงอีกทีเสมอ
 *   เพราะผู้ทำบัญชีอาจบันทึกการขายสดด้วยมือไว้แล้วนอกระบบ ลงทับ = นับซ้ำ
 *   ซึ่งหาทีหลังยากกว่าขาดไปเสียอีก · **ต้องถามผู้ทำบัญชีก่อนว่าลงมือไว้ถึงวันไหน** แล้วใส่ `from`
 * ★ `postCashSaleGl` กันซ้ำในตัวอยู่แล้ว (หาใบสำคัญ SALES_CASH ของบิลนั้น) รันซ้ำจึงไม่งอกใบที่สอง
 */
function backfillCashSaleGl(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  var book = _bookScope(session, payload);
  var tenantId = _bookSalesTenant(book);
  var from = String(payload.from || '').trim();
  var to = String(payload.to || '').trim();
  if (from && !_validDate(from)) return { success: false, message: 'วันที่เริ่มต้องเป็น yyyy-MM-dd' };
  if (to && !_validDate(to)) return { success: false, message: 'วันที่สิ้นสุดต้องเป็น yyyy-MM-dd' };

  var st = _acctSettings(book);
  if (st.cashSales !== 'on') return { success: false, message: 'ยังปิดการลงบัญชีขายสดอยู่ — เปิดที่ ตั้งค่าบัญชี ก่อน' };

  var pending = [], amount = 0, vatSum = 0;
  tenantObjectsIfExists(tenantId, 'sales_orders').forEach(function(o) {
    if (!_isCashSaleForGl(o)) return;
    var when = _dOnly(o.tax_invoice_at || o.created_at) || '';
    if (from && when < from) return;
    if (to && when > to) return;
    if (_findCashSaleJournal(book, _cashSaleRefId(o))) return;      // ลงไปแล้ว
    var v = _orderVat(o);
    pending.push({ orderId: o.record_id, orderCode: o.order_code || '', taxInvoiceNo: o.tax_invoice_no || '',
      date: when, total: _money(Number(o.total) || 0), vat: _money(Number(o.vat_amount) || v.vat || 0) });
    amount += Number(o.total) || 0;
    vatSum += Number(o.vat_amount) || v.vat || 0;
  });
  pending.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); });

  if (payload.commit !== true) {
    return { success: true, dryRun: true, count: pending.length, amount: _money(amount), vat: _money(vatSum),
      rows: pending.slice(0, 200),
      message: pending.length
        ? 'พบ ' + pending.length + ' ใบที่ยังไม่ได้ลงบัญชี (ยอด ' + _money(amount).toLocaleString() +
          ' · ภาษีขาย ' + _money(vatSum).toLocaleString() + ') — ยังไม่ได้ลงให้ กดยืนยันอีกครั้งเพื่อลงจริง'
        : 'ไม่มีบิลขายสดที่ค้างลงบัญชีในช่วงนี้' };
  }

  /* ★ ลงทีละใบผ่าน postCashSaleGl ตัวเดิม ไม่เขียน journal เองซ้ำอีกชุด —
     ชุดที่สองเมื่อไหร่ วันหนึ่งจะมีคนแก้คู่บัญชีข้างเดียวแล้วสองทางลงไม่ตรงกัน */
  var done = 0, failedRows = [];
  pending.forEach(function(p) {
    var o = tenantRowById(tenantId, 'sales_orders', p.orderId);
    var r = postCashSaleGl(tenantId, o, session.adminUserId);
    if (r && r.posted) done++; else failedRows.push({ orderCode: p.orderCode, reason: (r && (r.skipped || r.error)) || 'ไม่ทราบสาเหตุ' });
  });
  return { success: true, dryRun: false, count: pending.length, posted: done, failed: failedRows.slice(0, 50),
    message: 'ลงบัญชีย้อนหลัง ' + done + ' ใบ' + (failedRows.length ? ' · ข้าม ' + failedRows.length + ' ใบ' : '') };
}
