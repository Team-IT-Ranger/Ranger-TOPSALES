/**
 * ===================== ทะเบียนใบกำกับภาษี (ขาย) =====================
 * เมนู 5.3.1 · อ่านอย่างเดียว ไม่ออกเลขและไม่เขียนอะไรทั้งสิ้น
 *
 * ★★ ทำไมต้องมี (เจ้าของระบบสั่ง 23 ต.ค. 2026): เดิม 5.3.1 เป็น "ใบแจ้งหนี้และการรับชำระ"
 *   ซึ่งเป็น**บัญชีลูกหนี้** จึงมีแต่บิลเครดิต · **บิลขายสดออกใบกำกับภาษีให้ลูกค้าจริงทุกใบ
 *   แต่ไม่โผล่ในหน้าจอไหนเลยนอกจากรายงานภาษีรายเดือน** (วัดบน UAT: ต.ค. 2026 ของ BDC
 *   มีใบกำกับ 61 ใบ เป็นขายสด 45 ใบ ส่วนหน้าลูกหนี้เห็นแค่ 17 ใบ)
 *   คนทำงานจึงหาใบกำกับของบิลเงินสดไม่เจอ และนึกว่าระบบไม่ได้ออกให้
 *
 * ★★★ ฐานของทะเบียนนี้คือ **เลขใบกำกับที่ออกไปแล้ว** ไม่ใช่ใบแจ้งหนี้และไม่ใช่ใบสำคัญบัญชี
 *   (หลักเดียวกับ `51_tax_reports.gs` — อ่านคำอธิบายยาวๆ ที่หัวไฟล์นั้น)
 *   เลขเก็บอยู่สองที่: `sales_orders.tax_invoice_no` (ทั้งใบ) และ `delivery_rounds.tax_invoice_no`
 *   (บิลที่แยกรอบจัดส่ง ออกใบกำกับตามของที่ส่งจริงในรอบนั้น)
 *   **บิลที่มีรอบต้องข้ามแถวบิล ไม่งั้นนับซ้ำทั้งใบ**
 */

/** ทะเบียนใบกำกับภาษีขายทุกใบของสมุดนี้ — payload { month?, q?, paymentType?, limit? } */
function listTaxInvoices(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var book = _bookScope(session, payload);
  var tenantId = _bookSalesTenant(book);
  var month = String(payload.month || '').trim();          // ว่าง = ทุกเดือน

  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c; });

  /* ใบแจ้งหนี้ลูกหนี้ของบิลไหนบ้าง — ใช้ชี้ปุ่ม "ออกใบลดหนี้" ไปที่ใบที่ถูกต้อง
     ★ คีย์ต้องมีรอบจัดส่งด้วย บิลเดียวแยกหลายรอบได้หลายใบแจ้งหนี้ (48_delivery_rounds.gs) */
  var arOf = {}, creditedOf = {};
  centralObjects('ar_invoices').forEach(function(iv) {
    if (!_inBook(iv, book)) return;
    if (String(iv.status) === 'void') return;
    arOf[String(iv.sales_order_id) + '#' + String(iv.delivery_round_id || '')] = iv;
  });
  centralObjects('ar_credit_notes').forEach(function(n) {
    if (String(n.status) === 'void' || String(n.status) === 'voided') return;
    creditedOf[String(n.ar_invoice_id)] = (creditedOf[String(n.ar_invoice_id)] || 0) + (Number(n.total) || 0);
  });

  /* ★★ ใบไหน "ลงบัญชีแล้ว" — คนทำงานต้องเห็นเป็นรายใบ ไม่ใช่เห็นแค่ยอดรวมในรายงานภาษี
     (ผู้ใช้ถาม 24 ต.ค. 2026: "ใบกำกับใบไหนยังไม่ลงบัญชี จะดูรู้ได้ยังไง")
     ★ ขายสด → ใบสำคัญ SALES_CASH ที่ ref_id = `<บิล>` หรือ `<บิล>#<รอบ>` (52_cash_sales_gl.gs)
     ★ เครดิต → ลงผ่านใบแจ้งหนี้ลูกหนี้ ซึ่งลงบัญชีให้ตั้งแต่ตอนออกใบ มีใบแจ้งหนี้ = ลงแล้ว */
  var cashJournal = {};
  centralObjects('gl_journals').forEach(function(j) {
    if (String(j.ref_type) !== 'SALES_CASH') return;
    if (String(j.status) === 'voided') return;
    if (!_inBook(j, book)) return;
    cashJournal[String(j.ref_id)] = j.journal_no || '';
  });

  var out = [];
  var push = function(o, round, docNo, docAt, exVat, vat, exempt) {
    var c = customers[String(o.customer_id)] || {};
    var ar = arOf[String(o.record_id) + '#' + String(round ? round.record_id : '')];
    var cash = !isCreditPayment(o.payment_method);
    // คีย์ใบสำคัญขายสด ต้องตรงกับ _cashSaleRefId เป๊ะ (แก้ที่นั่นต้องตามมาแก้ที่นี่)
    var cashRef = round ? (String(o.record_id) + '#' + String(round.record_id)) : String(o.record_id);
    out.push({
      docNo: docNo, docDate: _dOnly(docAt), orderId: o.record_id, orderCode: o.order_code || '',
      roundId: round ? round.record_id : '', roundNo: round ? _int(round.round_no) : 0,
      customerId: o.customer_id, customerName: customerFullName(c), customerCode: c.customer_code || '',
      taxId: c.tax_id || '', branchCode: c.tax_branch_code || '',
      /* ★ "เงินสด/เครดิต" ตัดสินจากวิธีชำระของบิล ไม่ใช่จาก "มีใบแจ้งหนี้ไหม" —
         บิลเครดิตที่ยังไม่ได้ตั้งลูกหนี้ก็มี ถ้าดูจากใบแจ้งหนี้จะกลายเป็นขายสดไปเฉยๆ */
      paymentType: cash ? 'cash' : 'credit',
      paymentLabel: cash ? 'เงินสด' : 'เครดิต',
      subtotalExVat: _money(exVat), vatAmount: _money(vat), exemptAmount: _money(exempt),
      total: _money(exVat + vat + exempt),
      status: String(o.status || ''), cancelled: String(o.status) === 'cancelled',
      /* ออกใบลดหนี้ได้เฉพาะใบที่มีใบแจ้งหนี้ลูกหนี้รองรับ — ขายสดยังไม่มีทาง (ดูหมายเหตุท้ายไฟล์) */
      arInvoiceId: ar ? ar.record_id : '', arInvoiceNo: ar ? ar.invoice_no : '',
      creditedAmount: ar ? _money(creditedOf[String(ar.record_id)] || 0) : 0,
      /* posted = มีรายการในสมุดบัญชีแล้วหรือยัง · journalNo ไว้ให้คนตามไปดูใบสำคัญ
         ★ บิลที่ยกเลิกไม่ถือว่า "ค้างลงบัญชี" — ไม่มีอะไรต้องลงแล้ว */
      posted: cash ? !!cashJournal[cashRef] : !!ar,
      journalNo: cash ? (cashJournal[cashRef] || '') : '',   // ใบแจ้งหนี้เก็บแค่ journal_id ไม่ได้เก็บเลขที่
      postRoute: cash ? 'cash' : 'ar'
    });
  };

  var orders = {};
  tenantObjectsIfExists(tenantId, 'sales_orders').forEach(function(o) {
    orders[String(o.record_id)] = o;
    if (saleOrderHasRounds(o)) return;                      // ยอดอยู่ที่แถวรอบ
    if (!String(o.tax_invoice_no || '').trim()) return;
    var at = o.tax_invoice_at || o.created_at;
    if (month && !_inMonth(at, month)) return;
    var v = _orderVat(o);
    push(o, null, o.tax_invoice_no, at,
      Number(o.subtotal_ex_vat) || v.exVat || 0, Number(o.vat_amount) || v.vat || 0, Number(o.exempt_amount) || 0);
  });
  tenantObjectsIfExists(tenantId, 'delivery_rounds').forEach(function(rd) {
    if (!String(rd.tax_invoice_no || '').trim()) return;
    if (month && !_inMonth(rd.tax_invoice_at, month)) return;
    var o = orders[String(rd.order_id)];
    if (!o) return;
    push(o, rd, rd.tax_invoice_no, rd.tax_invoice_at,
      Number(rd.subtotal_ex_vat) || 0, Number(rd.vat_amount) || 0, Number(rd.exempt_amount) || 0);
  });

  if (payload.paymentType === 'cash' || payload.paymentType === 'credit') {
    out = out.filter(function(r) { return r.paymentType === payload.paymentType; });
  }
  /* ★ ตัวกรอง "เฉพาะที่ยังไม่ลงบัญชี" — คำถามแรกของคนทำบัญชีคือ "เหลืออะไรต้องทำ"
     บิลที่ยกเลิกไม่นับว่าค้าง จึงไม่โผล่ในตัวกรองนี้ */
  if (payload.postedState === 'unposted') out = out.filter(function(r) { return !r.posted && !r.cancelled; });
  else if (payload.postedState === 'posted') out = out.filter(function(r) { return r.posted; });
  var q = String(payload.q || '').trim().toLowerCase();
  if (q) out = out.filter(function(r) {
    return [r.docNo, r.orderCode, r.customerName, r.customerCode].join(' ').toLowerCase().indexOf(q) !== -1;
  });

  // ใหม่สุดขึ้นก่อน — คนเปิดหน้านี้มาหาใบที่เพิ่งออก
  out.sort(function(a, b) { return String(b.docDate).localeCompare(String(a.docDate)) || String(b.docNo).localeCompare(String(a.docNo)); });

  var sum = { docs: out.length, exVat: 0, vat: 0, total: 0, cash: 0, credit: 0, unposted: 0, unpostedVat: 0 };
  out.forEach(function(r) {
    if (r.cancelled) return;                                // บิลที่ยกเลิกไม่นับเข้ายอดรวม แต่ยังแสดงให้เห็น
    sum.exVat += r.subtotalExVat; sum.vat += r.vatAmount; sum.total += r.total;
    sum[r.paymentType]++;
    if (!r.posted) { sum.unposted++; sum.unpostedVat += r.vatAmount; }
  });
  sum.unpostedVat = _money(sum.unpostedVat);
  sum.exVat = _money(sum.exVat); sum.vat = _money(sum.vat); sum.total = _money(sum.total);

  var limit = _int(payload.limit) || 500;
  return { success: true, data: out.slice(0, limit), summary: sum, truncated: out.length > limit };
}

/* ═══ ยังไม่ได้ทำ: ใบลดหนี้ของบิลขายสด ═══
 * ใบลดหนี้ทั้งระบบผูกกับ `ar_invoices` (ดู `_arAdjustNote` ใน 49_credit_notes.gs) บิลขายสดไม่มีใบแจ้งหนี้
 * จึงออกใบลดหนี้ไม่ได้ — ซึ่งเป็นเหตุผลเดียวกับที่ `_cancelSalesOrderCore` ยอมให้ยกเลิกบิลขายสดได้
 * (กั้นแล้วจะกลายเป็นทางตัน) · ตามกฎหมายใบลดหนี้ของการขายสดออกได้ และคู่บัญชีคือ
 * Dr รายได้ + Dr ภาษีขาย / Cr เงินสด — ต่างจากของเครดิตที่ Cr ลูกหนี้
 * ทำเมื่อไหร่ต้องแยกคู่บัญชีตามวิธีชำระ ไม่ใช่เติม ar_invoice ปลอมให้บิลเงินสด
 * (ใบแจ้งหนี้ปลอมจะไปโผล่ในรายงานลูกหนี้และอายุหนี้ทันที)
 */
