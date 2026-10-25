/**
 * ===================== ยอดขายรายบรรทัด — แหล่งความจริงชุดเดียวของทั้งระบบ =====================
 * เจ้าของระบบสั่ง 25 ต.ค. 2026: **"ทำให้รายงานขายในเมนูกลุ่ม 1.8 ตรงกันกับรายงานทางการเงิน"**
 *
 * ★★★ ก่อนมีไฟล์นี้ ระบบมีนิยาม "ยอดขาย" อยู่ **สามชุด** ที่ให้เลขไม่ตรงกัน:
 *   1. เมนู 1.8 — นับ**ทุกบิลที่ไม่ถูกยกเลิก** ไม่สนว่าออกเอกสารหรือยัง (`_salesReportOrders`)
 *   2. ฝั่งการเงิน 5.3.1 / 5.8.1 — นับ**ใบกำกับภาษีที่ออกไปแล้ว** และหักใบลดหนี้
 *   3. ไฟล์ Dashboard — เหมือนข้อ 2
 *   ผู้ใช้จึงเจอ 1.8.1 ได้ 1,622,380.91 แต่ไฟล์ได้ 1,388,895.56 (25 ต.ค. 2026) และไม่มีใครบอกได้ว่าอันไหนถูก
 *
 * ★★ ตอนนี้เหลือนิยามเดียว คือไฟล์นี้ และมันคือ**นิยามของฝั่งการเงิน**:
 *   - นับเมื่อ **ออกใบกำกับภาษีแล้ว** เท่านั้น (ผ่าน `taxInvoiceRows` ของ 58_tax_invoices.gs)
 *   - **ใบลดหนี้หักออก · ใบเพิ่มหนี้บวกกลับ** (ม.86/10 และ ม.86/9)
 *   - นับตาม **วันที่บนเอกสาร** ไม่ใช่วันที่เปิดบิล — บิลที่เปิด ก.ย. แต่ออกใบกำกับ ต.ค. เป็นยอดของ ต.ค.
 *     (หลักเดียวกับที่ภาษีขายใช้ ไม่งั้นยอดขายกับภาษีขายคนละเดือนกันตลอด)
 *   - ตัวเลขเงินทุกช่อง **เป็นยอดก่อนภาษี**
 *
 * ★ ใครใช้: รายงาน 1.8.1/1.8.2/1.8.3 (41_sales_reports.gs) · ไฟล์ Dashboard (59_dashboard_export.gs)
 *   **เพิ่มรายงานยอดขายใหม่ต้องมาต่อจากที่นี่** อย่าไปไล่อ่าน sales_orders เองอีกชุด
 */

var SF_SALE = 'ขาย', SF_CREDIT = 'ลดหนี้', SF_DEBIT = 'เพิ่มหนี้';

/* กันดึงทีเดียวจนรันไม่จบใน 6 นาที — เกินเท่านี้ให้กรองช่วงวันที่ก่อน */
var SF_MAX_DOCS = 20000;

/**
 * บรรทัดยอดขายทั้งหมดของสมุดหนึ่ง
 * opts: { dateFrom?, dateTo? } — เทียบกับ **วันที่บนเอกสาร**
 * คืน { success, facts:[{...}], mismatches:[...], truncated }
 */
function salesFactRows(book, opts) {
  opts = opts || {};
  var docs = taxInvoiceRows(book, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, limit: SF_MAX_DOCS + 1 });
  if (!docs.success) return { success: false, message: docs.message || 'อ่านใบกำกับภาษีไม่สำเร็จ' };

  var salesTenant = _bookSalesTenant(book);
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  // อ่านทีเดียวต่อตาราง ไม่เปิดชีตซ้ำต่อใบ
  var itemsByOrder = {};
  tenantObjectsIfExists(salesTenant, 'order_items').forEach(function(it) {
    (itemsByOrder[String(it.order_id)] = itemsByOrder[String(it.order_id)] || []).push(it);
  });
  var roundItems = {};
  tenantObjectsIfExists(salesTenant, 'delivery_round_items').forEach(function(ri) {
    (roundItems[String(ri.round_id)] = roundItems[String(ri.round_id)] || []).push(ri);
  });
  var orderById = {};
  tenantObjectsIfExists(salesTenant, 'sales_orders').forEach(function(o) { orderById[String(o.record_id)] = o; });

  var facts = [], bad = [];

  (docs.data || []).forEach(function(r) {
    /* ★ บิลที่ยกเลิกไม่นับ — ยอดขายต้องเป็นยอดที่ยังยืนอยู่จริง ณ วันนี้
       (ขายแล้วลูกค้าคืนของ ต้องเป็น "ใบลดหนี้" ไม่ใช่การยกเลิกบิล) */
    if (r.cancelled) return;
    var order = orderById[String(r.orderId)];
    if (!order) return;
    var items = itemsByOrder[String(r.orderId)] || [];
    var docSum = 0, docLines = 0;

    /* ★★ "ขายได้เท่าไรจริง" ต่อบรรทัด ใช้ `soldNetByItem` ตัวเดียวกับใบลดหนี้ (18_pricing_engine.gs)
       ซึ่งเฉลี่ยส่วนลดท้ายบิลลงบรรทัดให้แล้ว — คิดเองอีกชุดเมื่อไหร่ ยอดขายกับยอดที่ลดหนี้จะคนละตัวทันที */
    var netOf = soldNetByItem(order, items);

    /* บิลที่แยกรอบจัดส่ง: ใบกำกับออกตามของที่ส่งจริงรอบนั้น → คิดตามสัดส่วน
       ★ สูตรเดียวกับ `deliveryRoundAmounts` (48_delivery_rounds.gs) ผลรวมรายบรรทัดจึงตรงกับใบ */
    var qtyInRound = null;
    if (r.roundId) {
      qtyInRound = {};
      (roundItems[String(r.roundId)] || []).forEach(function(ri) {
        qtyInRound[String(ri.item_id)] = (qtyInRound[String(ri.item_id)] || 0) + (parseFloat(ri.qty) || 0);
      });
    }

    items.forEach(function(it) {
      var ordered = parseFloat(it.qty) || 0;
      var qty = ordered, share = 1;
      if (qtyInRound) {
        qty = qtyInRound[String(it.record_id)] || 0;
        if (!qty || !ordered) return;                       // บรรทัดนี้ไม่ได้ส่งในรอบนี้
        share = qty / ordered;
      }
      var gross = _round2((parseFloat(it.line_total) || 0) * share);
      var net   = _round2((netOf[String(it.record_id)] || 0) * share);
      var lineDisc = _round2((parseFloat(it.line_discount) || 0) * share);
      /* ★★★ ถอด VAT ออกทุกช่องเงิน (เจ้าของระบบสั่ง 25 ต.ค. 2026 — รายงานการขายไม่ดู VAT)
         บรรทัดที่ยกเว้นภาษีไม่ถูกถอด เพราะ `lineExVat` ดูภาพนิ่งภาษีรายบรรทัด
         ★ `billDiscEx` คิดเป็น **ส่วนที่เหลือ** ไม่ใช่ถอดเอง — ไม่งั้นปัดเศษคนละช่องแล้ว
           ยอดตามราคาขาย − ส่วนลด ≠ ยอดสุทธิ ทีละสตางค์ ซึ่งคนกระทบยอดหาไม่เจอ */
      var exOf = function(v) { return lineExVat(order, { line_total: v, tax_status: it.tax_status }); };
      var grossEx = exOf(gross), netEx = exOf(net), lineDiscEx = exOf(lineDisc);
      var p = products[String(it.product_id)] || {};

      docSum = _round2(docSum + netEx); docLines++;
      facts.push(_sfFact(r, order, {
        kind: SF_SALE, refDoc: '',
        productId: String(it.product_id || ''), product: p,
        qty: qty, baseQty: _round2((parseFloat(it.base_qty) || 0) * share),
        unitCode: it.unit_code || '', unitPriceEx: exOf(_round2(parseFloat(it.price) || 0)),
        grossEx: grossEx, lineDiscEx: lineDiscEx, billDiscEx: _round2(grossEx - lineDiscEx - netEx),
        netEx: netEx, isFree: isFlagOn(it.is_free) || String(it.is_free) === '1'
      }));
    });

    _sfDocCheck(bad, r, docSum, docLines);
  });

  _sfAppendNotes(facts, book, salesTenant, opts, products, orderById);

  // เรียงตามวันที่เอกสาร แล้วเลขเอกสาร — ใบลดหนี้ถูกต่อท้ายมา ถ้าไม่เรียงจะไปกองท้ายไฟล์
  facts.sort(function(a, b) {
    return String(a.docDate).localeCompare(String(b.docDate)) || String(a.docNo).localeCompare(String(b.docNo));
  });
  return { success: true, facts: facts, mismatches: bad, truncated: !!docs.truncated };
}

/** ประกอบ fact หนึ่งแถว — คอลัมน์เอกสารซ้ำทุกบรรทัด เพื่อให้ปลายทาง group เองได้ */
function _sfFact(r, order, x) {
  var p = x.product || {};
  return {
    docNo: r.docNo, docDate: _dOnly(r.docDate), kind: x.kind, refDoc: x.refDoc || '',
    orderId: r.orderId, orderCode: r.orderCode || '', roundNo: r.roundNo || '',
    customerId: String(r.customerId || ''), customerCode: r.customerCode || '',
    customerName: r.customerName || '', taxId: r.taxId || '', branchCode: r.branchCode || '',
    saleBy: r.saleBy || '', saleByName: r.saleByName || '',
    paymentType: r.paymentType || '', paymentLabel: r.paymentLabel || '',
    productId: x.productId, productCode: p.product_code || x.productId,
    productName: p.name || '(สินค้าถูกลบ)', groupId: String(p.group_id || ''),
    category: p.category || '', subCategory: p.sub_category || '',
    qty: x.qty, baseQty: x.baseQty, unitCode: x.unitCode, unitPriceEx: x.unitPriceEx,
    grossEx: x.grossEx, lineDiscEx: x.lineDiscEx, billDiscEx: x.billDiscEx, netEx: x.netEx,
    isFree: !!x.isFree
  };
}

/**
 * กระทบยอดรายใบ — ผลรวมรายบรรทัดต้องเท่ากับยอดก่อนภาษีบนใบกำกับใบนั้น
 *
 * ★★★ ทำไมต้องตรวจ: บรรทัดบิลหายได้โดยไม่มีอะไรฟ้อง และรายงานยังดูปกติทุกอย่าง —
 *   1. บิลเก่าที่ไม่มีแถวใน `order_items` เลย (ย้ายข้อมูลมา/ลบบรรทัดทิ้ง) → ทั้งใบหาย
 *   2. บิลที่แยกรอบแต่ไม่มีแถวใน `delivery_round_items` → ทั้งรอบหาย
 *   3. ปัดเศษรายบรรทัดต่างจากยอดที่บิลเก็บไว้ทีละสตางค์
 * ★ ยอมรับส่วนต่างไม่เกิน 1 สตางค์ต่อใบ · เกินกว่านั้นถือว่าข้อมูลขาด
 */
function _sfDocCheck(bad, r, docSum, docLines) {
  var want = _round2(Number(r.subtotalExVat) || 0);
  var diff = _round2(docSum - want);
  if (Math.abs(diff) <= 0.01) return;
  if (bad.length < 50) {            // พอให้เห็นว่าเป็นแบบไหน ไม่ต้องยาวเป็นพันบรรทัด
    bad.push({ docNo: r.docNo, orderCode: r.orderCode || '', lines: docLines,
      expected: want, actual: docSum, diff: diff,
      why: docLines ? 'ผลรวมรายบรรทัดไม่ตรงกับยอดบนใบ' : 'ไม่มีบรรทัดสินค้าเลย — ใบนี้หายทั้งใบ' });
  }
}

/**
 * ต่อท้ายด้วย **ใบลดหนี้ (ติดลบ)** และ **ใบเพิ่มหนี้ (เป็นบวก)**
 *
 * ★★★ ต้องมีทั้งสองใบ ไม่ใช่เฉพาะใบลดหนี้: ทั้งคู่คือการปรับยอดหลังออกใบกำกับไปแล้ว
 *   ใส่แต่ใบลดหนี้ = ยอดขาย**ต่ำกว่าความจริง**เท่าใบเพิ่มหนี้ ซึ่งเงียบพอๆ กัน
 * ★★ ผูกกับ **พนักงานขายของบิลต้นทาง** ไม่ใช่คนที่กดออกใบลดหนี้ (แอดมินบัญชี) —
 *   ไม่งั้นยอดที่หักออกไปตกอยู่กับคนทำบัญชี แล้วยอดรายคนของพนักงานขายไม่เคยถูกหักเลย
 */
function _sfAppendNotes(facts, book, salesTenant, opts, products, orderById) {
  var cust = {};
  centralObjects('customers').forEach(function(c) { cust[String(c.record_id)] = c; });
  var roundNo = {};
  tenantObjectsIfExists(salesTenant, 'delivery_rounds').forEach(function(rd) {
    roundNo[String(rd.record_id)] = _int(rd.round_no);
  });

  var dFrom = String(opts.dateFrom || '').trim(), dTo = String(opts.dateTo || '').trim();

  [{ table: 'ar_credit_notes', items: 'ar_credit_note_items', noField: 'credit_note_no', kind: SF_CREDIT, sign: -1 },
   { table: 'ar_debit_notes', items: 'ar_debit_note_items', noField: 'debit_note_no', kind: SF_DEBIT, sign: 1 }
  ].forEach(function(K) {

    var linesByNote = {};
    centralObjects(K.items).forEach(function(l) {
      (linesByNote[String(l.note_id)] = linesByNote[String(l.note_id)] || []).push(l);
    });

    centralObjects(K.table).forEach(function(n) {
      if (!_inBook(n, book)) return;
      var st = String(n.status || '');
      if (st === 'void' || st === 'voided') return;        // ใบที่ถูกยกเลิกแล้ว ไม่ปรับยอดอะไรทั้งนั้น
      var date = _dOnly(n.credit_date);
      if (dFrom && date < dFrom) return;
      if (dTo && date > dTo) return;

      var c = cust[String(n.customer_id)] || {};
      var order = orderById[String(n.sales_order_id)] || null;
      /* ภาพนิ่งภาษีของใบนี้เอง — ลดหนี้ใบเก่าหลังรัฐเปลี่ยนอัตรา ใช้อัตราปัจจุบันจะถอดภาษีผิดทันที */
      var noteVat = { apply_vat: 'TRUE', vat_rate: n.vat_rate,
        subtotal_ex_vat: n.subtotal_ex_vat, vat_amount: n.vat_amount, exempt_amount: 0 };

      (linesByNote[String(n.record_id)] || []).forEach(function(l) {
        var qty = (parseFloat(l.qty) || 0) * K.sign;
        var amt = _round2((parseFloat(l.amount) || 0) * K.sign);
        var exOf = function(v) { return lineExVat(noteVat, { line_total: v, tax_status: l.tax_status }); };
        var amtEx = exOf(amt);
        /* ★ ราคาที่ลดหนี้คือ "ราคาที่ขายไปจริง" อยู่แล้ว (49_credit_notes.gs กันไม่ให้เกิน)
           จึงไม่มีส่วนลดให้แยกอีกชั้น — ยอดตามราคาขายกับยอดหลังหักส่วนลดเท่ากัน */
        facts.push(_sfFact({
          docNo: n[K.noField] || '', docDate: date, orderId: n.sales_order_id || '',
          orderCode: order ? (order.order_code || '') : '',
          roundNo: n.delivery_round_id ? (roundNo[String(n.delivery_round_id)] || '') : '',
          customerId: n.customer_id, customerCode: c.customer_code || '',
          customerName: customerFullName(c), taxId: c.tax_id || '', branchCode: c.tax_branch_code || '',
          saleBy: order ? (order.sale_by || '') : '',
          saleByName: order ? _saleByLabel(order.sale_by) : '',
          paymentType: order ? (isCreditPayment(order.payment_method) ? 'credit' : 'cash') : '',
          paymentLabel: order ? (isCreditPayment(order.payment_method) ? 'เครดิต' : 'เงินสด') : ''
        }, order, {
          kind: K.kind, refDoc: n.invoice_no || '',
          productId: String(l.product_id || ''), product: products[String(l.product_id)] || {},
          qty: qty, baseQty: _round2(qty * (parseFloat(l.unit_factor) || 1)),
          unitCode: l.unit_code || '', unitPriceEx: exOf(_round2(parseFloat(l.unit_price) || 0)),
          grossEx: amtEx, lineDiscEx: 0, billDiscEx: 0, netEx: amtEx, isFree: false
        }));
      });
    });
  });
}
