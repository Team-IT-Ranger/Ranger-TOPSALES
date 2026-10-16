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
