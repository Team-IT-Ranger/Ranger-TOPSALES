/**
 * ===================== รายงานภาษีขาย / ภาษีซื้อ (สำหรับยื่น ภ.พ.30) =====================
 * เมนู 5.8.1 · ดูรายเดือน · อ่านอย่างเดียว ไม่เขียนอะไรทั้งสิ้น
 *
 * ★★ ฐานของรายงานคือ **เอกสารภาษีที่ออกจริง ไม่ใช่ใบสำคัญบัญชี**
 *   ภ.พ.30 รายงาน "ใบกำกับภาษีที่ออก/ได้รับในเดือนนั้น" ซึ่งเป็นคนละสิ่งกับ "รายการที่ลงบัญชีแล้ว"
 *   ถ้าสร้างรายงานจากบัญชี 2200/1400 จะได้ยอดที่ขาดไปเงียบๆ ทุกครั้งที่มีเอกสารที่ยังไม่ได้ลงบัญชี
 *   — ซึ่งในระบบนี้มีจริง (ดูหัวข้อถัดไป) และการยื่นภาษีขาดคือเรื่องที่แก้ทีหลังแพงมาก
 *
 * ★★★ ช่องว่างที่รายงานนี้ "ตั้งใจเปิดเผย" ไม่ใช่กลบ:
 *   **การขายสดไม่เคยลงบัญชีเลย** — รายได้ (4100) และภาษีขาย (2200) เข้าบัญชีผ่าน `createArInvoice`
 *   ทางเดียว ซึ่ง `34_sales_status.gs` เรียกเฉพาะบิล **เครดิต** (`isCreditPayment`)
 *   ขายสด/ขายจากรถจึงออกใบกำกับภาษีให้ลูกค้าจริง แต่ไม่มีรายการในสมุดบัญชีเลยสักบรรทัด
 *   → งบกำไรขาดทุนขาดรายได้ส่วนนั้น และบัญชีภาษีขายต่ำกว่าความจริง
 *   รายงานจึงมีช่อง **"เทียบกับบัญชี"** บอกส่วนต่างให้เห็นทุกครั้ง พร้อมจำนวนใบที่ยังไม่ได้ลงบัญชี
 *   (แก้จริงต้องลงบัญชีขายสดตอนบันทึกบิล — เป็นงานคนละชิ้นที่ต้องให้ผู้ทำบัญชีตัดสินก่อน)
 */

/** เดือนปัจจุบันแบบ yyyy-MM */
function _thisMonth() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
function _inMonth(dateStr, month) {
  return String(_dOnly(dateStr) || '').slice(0, 7) === String(month);
}

/** ไฟล์ของตัวแทนที่เก็บบิลขายของ "สมุด" นี้ — สมุดบริษัทใช้ไฟล์ของตัวแทนบ้าน */
function _bookSalesTenant(book) {
  return book || (typeof HOUSE_TENANT_ID !== 'undefined' ? HOUSE_TENANT_ID : 'HOUSE');
}

/** ยอดเคลื่อนไหวของบัญชีหนึ่งในเดือนนั้น (ใช้เทียบกับเอกสาร) */
function _acctMoveInMonth(code, month, book) {
  var ids = {};
  centralObjects('gl_journals').forEach(function(j) {
    if (!_inBook(j, book)) return;
    if (!_inMonth(j.journal_date, month)) return;
    ids[String(j.record_id)] = true;
  });
  var dr = 0, cr = 0;
  centralObjects('gl_journal_lines').forEach(function(l) {
    if (String(l.account_code) !== String(code)) return;
    if (!ids[String(l.journal_id)]) return;
    dr += Number(l.debit) || 0; cr += Number(l.credit) || 0;
  });
  return _money(cr - dr);     // ภาษีขายเป็นหนี้สิน: เครดิตคือยอดที่เพิ่ม
}

/**
 * รายงานภาษีขาย — ใบกำกับภาษีที่ออกในเดือนนั้น
 * payload: { month: 'yyyy-MM', tenantId? }
 */
function getVatSalesReport(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var month = String(payload.month || _thisMonth());
  if (!/^\d{4}-\d{2}$/.test(month)) return { success: false, message: 'เดือนต้องเป็นรูปแบบ yyyy-MM' };
  var book = _bookScope(session, payload);
  var tenantId = _bookSalesTenant(book);

  var cust = {};
  centralObjects('customers').forEach(function(c) {
    cust[String(c.record_id)] = { name: customerFullName(c), code: c.customer_code || '',
      taxId: c.tax_id || '', branch: c.tax_branch_code || '' };
  });
  var rows = [];
  var push = function(o, docNo, when, exVat, vat, exempt, kind, note) {
    var c = cust[String(o.customer_id)] || {};
    rows.push({ docNo: docNo, date: _dOnly(when), kind: kind,
      customer: c.name || '(ไม่พบลูกค้า)', customerCode: c.code || '', taxId: c.taxId || '', branch: c.branch || '',
      orderCode: o.order_code || '', exVat: _money(exVat), vat: _money(vat), exempt: _money(exempt),
      /* ★★★ `exVat` (= `subtotal_ex_vat` ของบิล) **รวมมูลค่าสินค้ายกเว้นภาษีอยู่ในตัวแล้ว**
         (saleVatBreakdown ใน 18_pricing_engine.gs) · บวก `exempt` ซ้ำ = ยอดรวมของบิลที่มีของ
         ยกเว้นภาษีปนอยู่สูงเกินจริง · ตัวเลขที่ใช้ยื่น ภ.พ.30 (exVat/vat) ไม่เคยผิด ผิดเฉพาะคอลัมน์
         ยอดรวมที่คนเอาไปกวาดตาเทียบ (เจอ 24 ต.ค. 2026) */
      total: _money(exVat + vat), note: note || '' });
  };

  /* ── ใบกำกับภาษีของบิลขาย ──
     ★ บิลที่แยกรอบจัดส่งออกใบกำกับ "รายรอบ" ยอดจึงอยู่ที่แถวรอบ ไม่ใช่แถวบิล
       อ่านทั้งสองที่แล้วข้ามแถวบิลที่มีรอบ ไม่งั้นนับซ้ำทั้งใบ (48_delivery_rounds.gs) */
  var orders = {}, uninvoiced = 0, uninvoicedVat = 0;
  /* ★★ "ลงบัญชีแล้ว" มีสองทาง ไม่ใช่ทางเดียว — บิลเครดิตลงผ่านใบแจ้งหนี้ลูกหนี้ ·
     บิลขายสดลงผ่านใบสำคัญ SALES_CASH (52_cash_sales_gl.gs)
     ดูแค่ใบแจ้งหนี้จะนับขายสดที่ลงบัญชีแล้วว่า "ยังไม่ลง" ตลอดไป เพราะมันไม่มีวันมีใบแจ้งหนี้
     (ผมเขียนผิดแบบนี้ตอนแรก เทสต์จับได้ 16 ต.ค. 2026) */
  var invoicedOrders = {};
  centralObjects('ar_invoices').forEach(function(iv) {
    if (String(iv.status) === 'void') return;
    invoicedOrders[String(iv.sales_order_id) + '#' + String(iv.delivery_round_id || '')] = true;
  });
  centralObjects('gl_journals').forEach(function(j) {
    if (String(j.ref_type) !== 'SALES_CASH') return;
    if (String(j.status) === 'voided') return;
    if (!_inBook(j, book)) return;
    /* ★ คีย์ของใบสำคัญขายสดมีสองแบบ (_cashSaleRefId ใน 52_cash_sales_gl.gs):
         `<บิล>` = ลงทั้งใบ · `<บิล>#<รอบ>` = ลงรายรอบ — ต้องรับทั้งคู่
       เดิมเติม '#' ต่อท้ายเสมอ ของที่ลงรายรอบจึงไม่เคยจับคู่ติด แล้วรายงานบอกว่า "ยังไม่ลงบัญชี" ตลอดไป */
    var ref = String(j.ref_id);
    invoicedOrders[ref.indexOf('#') !== -1 ? ref : (ref + '#')] = true;
  });

  tenantObjectsIfExists(tenantId, 'sales_orders').forEach(function(o) {
    orders[String(o.record_id)] = o;
    if (String(o.status) === 'cancelled') return;
    if (saleOrderHasRounds(o)) return;                       // ยอดอยู่ที่แถวรอบ
    if (!String(o.tax_invoice_no || '').trim()) return;
    if (!_inMonth(o.tax_invoice_at || o.created_at, month)) return;
    var v = _orderVat(o);
    push(o, o.tax_invoice_no, o.tax_invoice_at || o.created_at,
      Number(o.subtotal_ex_vat) || 0, Number(o.vat_amount) || 0, Number(o.exempt_amount) || 0,
      'ใบกำกับภาษี', isCreditPayment(o.payment_method) ? '' : 'ขายสด');
    if (!invoicedOrders[String(o.record_id) + '#']) { uninvoiced++; uninvoicedVat += Number(o.vat_amount) || 0; }
  });

  tenantObjectsIfExists(tenantId, 'delivery_rounds').forEach(function(rd) {
    if (!String(rd.tax_invoice_no || '').trim()) return;
    if (!_inMonth(rd.tax_invoice_at, month)) return;
    var o = orders[String(rd.order_id)] || {};
    if (String(o.status) === 'cancelled') return;
    push(o, rd.tax_invoice_no, rd.tax_invoice_at,
      Number(rd.subtotal_ex_vat) || 0, Number(rd.vat_amount) || 0, Number(rd.exempt_amount) || 0,
      'ใบกำกับภาษี', 'รอบที่ ' + (rd.round_no || ''));
    if (!invoicedOrders[String(rd.order_id) + '#' + String(rd.record_id)]) {
      uninvoiced++; uninvoicedVat += Number(rd.vat_amount) || 0;
    }
  });

  /* ── ใบลดหนี้ (ติดลบ) และใบเพิ่มหนี้ (บวก) — เป็นเอกสารภาษีที่ต้องรายงานด้วย ── */
  [{ t: 'ar_credit_notes', no: 'credit_note_no', sign: -1, kind: 'ใบลดหนี้' },
   { t: 'ar_debit_notes', no: 'debit_note_no', sign: 1, kind: 'ใบเพิ่มหนี้' }].forEach(function(K) {
    centralObjects(K.t).forEach(function(n) {
      if (!_inBook(n, book)) return;
      if (String(n.status) === 'voided') return;
      if (!_inMonth(n.credit_date, month)) return;
      var c = cust[String(n.customer_id)] || {};
      rows.push({ docNo: n[K.no], date: _dOnly(n.credit_date), kind: K.kind,
        customer: c.name || '', customerCode: c.code || '', taxId: c.taxId || '', branch: c.branch || '',
        orderCode: n.invoice_no || '', exVat: _money(K.sign * (Number(n.subtotal_ex_vat) || 0)),
        vat: _money(K.sign * (Number(n.vat_amount) || 0)), exempt: 0,
        total: _money(K.sign * (Number(n.total) || 0)), note: 'อ้าง ' + (n.invoice_no || '') });
    });
  });

  rows.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.docNo).localeCompare(String(b.docNo)); });
  var sum = rows.reduce(function(s, r) {
    s.exVat += r.exVat; s.vat += r.vat; s.exempt += r.exempt; s.total += r.total; return s;
  }, { exVat: 0, vat: 0, exempt: 0, total: 0 });
  ['exVat', 'vat', 'exempt', 'total'].forEach(function(k) { sum[k] = _money(sum[k]); });

  var inBooks = _acctMoveInMonth(GL_ACCT.VAT_OUTPUT, month, book);
  return { success: true, month: month, book: book || '', kind: 'sales', rows: rows, totals: sum,
    /* ★ ช่องนี้คือหัวใจของรายงาน — เอกสารกับบัญชีต้องตรงกัน ไม่ตรงแปลว่ามีเอกสารที่ยังไม่ได้ลงบัญชี
       (ตอนนี้คือการขายสดทั้งหมด) · ซ่อนไว้แล้วคนจะยื่นภาษีด้วยยอดที่ขาดโดยไม่รู้ตัว */
    ledger: { account: GL_ACCT.VAT_OUTPUT, amount: inBooks, diff: _money(sum.vat - inBooks) },
    unposted: { bills: uninvoiced, vat: _money(uninvoicedVat) } };
}

/**
 * รายงานภาษีซื้อ — ใบแจ้งหนี้ผู้ขายที่ตั้งหนี้ในเดือนนั้น
 * payload: { month: 'yyyy-MM', tenantId? }
 */
function getVatPurchaseReport(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var month = String(payload.month || _thisMonth());
  if (!/^\d{4}-\d{2}$/.test(month)) return { success: false, message: 'เดือนต้องเป็นรูปแบบ yyyy-MM' };
  var book = _bookScope(session, payload);

  var ven = {};
  centralObjects('vendors').forEach(function(v) {
    ven[String(v.record_id)] = { name: v.name, code: v.vendor_code || '', taxId: v.tax_id || '', branch: v.branch_code || '' };
  });
  var rows = [];
  centralObjects('ap_bills').forEach(function(b) {
    if (!_inBook(b, book)) return;
    if (String(b.status) === 'void') return;
    if (!_inMonth(b.bill_date, month)) return;
    var v = ven[String(b.vendor_id)] || {};
    rows.push({ docNo: b.vendor_invoice_no || b.bill_no, billNo: b.bill_no, date: _dOnly(b.bill_date),
      vendor: v.name || '(ไม่พบผู้ขาย)', vendorCode: v.code || '', taxId: v.taxId || '', branch: v.branch || '',
      exVat: _money(Number(b.subtotal_ex_vat) || 0), vat: _money(Number(b.vat_amount) || 0),
      total: _money(Number(b.total) || 0),
      /* ★ ไม่มีเลขใบกำกับของผู้ขาย = ใช้ยื่นไม่ได้ ต้องไปกรอกเพิ่ม — บอกไว้ให้เห็นตั้งแต่ในรายงาน */
      note: String(b.vendor_invoice_no || '').trim() ? '' : 'ยังไม่ได้กรอกเลขใบกำกับของผู้ขาย' });
  });
  rows.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.docNo).localeCompare(String(b.docNo)); });
  var sum = rows.reduce(function(s, r) { s.exVat += r.exVat; s.vat += r.vat; s.total += r.total; return s; },
    { exVat: 0, vat: 0, total: 0 });
  ['exVat', 'vat', 'total'].forEach(function(k) { sum[k] = _money(sum[k]); });

  var inBooks = -_acctMoveInMonth(GL_ACCT.VAT_INPUT, month, book);   // ภาษีซื้อเป็นสินทรัพย์ เดบิตคือยอดที่เพิ่ม
  return { success: true, month: month, book: book || '', kind: 'purchase', rows: rows, totals: sum,
    ledger: { account: GL_ACCT.VAT_INPUT, amount: inBooks, diff: _money(sum.vat - inBooks) },
    missingDocNo: rows.filter(function(r) { return r.note; }).length };
}

/** สรุปสองฝั่ง + ยอดที่ต้องชำระ/ขอคืน — ตัวเลขชุดเดียวกับที่กรอกลง ภ.พ.30 */
function getVatSummary(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var sales = getVatSalesReport(session, payload);
  if (!sales.success) return sales;
  var purchase = getVatPurchaseReport(session, payload);
  if (!purchase.success) return purchase;
  var net = _money(sales.totals.vat - purchase.totals.vat);
  return { success: true, month: sales.month, book: sales.book,
    sales: { exVat: sales.totals.exVat, vat: sales.totals.vat, exempt: sales.totals.exempt, docs: sales.rows.length },
    purchase: { exVat: purchase.totals.exVat, vat: purchase.totals.vat, docs: purchase.rows.length },
    net: net, netLabel: net >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีที่ชำระไว้เกิน (ขอคืน/ยกไปเดือนหน้า)',
    warnings: [].concat(
      sales.unposted.bills ? ['มีใบกำกับภาษีขาย ' + sales.unposted.bills + ' ใบ (ภาษี ' +
        sales.unposted.vat.toLocaleString() + ' บาท) ที่ยังไม่ได้ลงบัญชี — ส่วนใหญ่คือการขายสด ซึ่งระบบยังไม่ลงบัญชีให้'] : [],
      Math.abs(sales.ledger.diff) > 0.009 ? ['ภาษีขายตามเอกสารกับตามบัญชีต่างกัน ' + sales.ledger.diff.toLocaleString() + ' บาท'] : [],
      Math.abs(purchase.ledger.diff) > 0.009 ? ['ภาษีซื้อตามเอกสารกับตามบัญชีต่างกัน ' + purchase.ledger.diff.toLocaleString() + ' บาท'] : [],
      purchase.missingDocNo ? ['ใบแจ้งหนี้ผู้ขาย ' + purchase.missingDocNo + ' ใบยังไม่ได้กรอกเลขใบกำกับภาษี'] : []
    ) };
}
