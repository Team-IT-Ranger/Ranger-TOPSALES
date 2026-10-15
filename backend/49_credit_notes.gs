/**
 * ============= ใบลดหนี้ (Credit Note) · ใบเพิ่มหนี้ (Debit Note) — 15 ต.ค. 2026 =============
 *
 * เกิดจากช่องว่างที่เจอตอนเก็บกวาดบิลทดสอบ: **ยกเลิกบิลที่ออกใบกำกับภาษีไปแล้ว ระบบไม่มีอะไรให้ทำต่อ**
 * ต้องเข้าไปกลับรายการบัญชีทีละใบด้วยมือ ซึ่งไม่ใช่สิ่งที่แอดมินหน้างานทำได้ และไม่ใช่เอกสารที่ลูกค้าถือได้
 *
 * ★★ ทั้งสองใบเป็น **เอกสารภาษี** (ใบลดหนี้ ม.86/10 · ใบเพิ่มหนี้ ม.86/9) ไม่ใช่แค่รายการบัญชี — ต้องมีครบ:
 *   เลขที่และวันที่ของ **ใบกำกับภาษีเดิม** · มูลค่าตามใบเดิม · มูลค่าที่ถูกต้อง · **ผลต่าง** · เหตุผล
 *   (ตัวพิมพ์อยู่ที่หน้าเว็บ — ข้อมูลทั้งหมดที่กฎหมายต้องการถูกส่งไปจากที่นี่)
 *
 * ★ ภาษีขายขยับ "ในงวดที่ออกใบ" ไม่ใช่ย้อนไปแก้งวดเดิม — ใบเดิมที่ยื่น ภ.พ.30 ไปแล้วห้ามขยับ
 *   ใบลดหนี้ลงกลับทางกับใบแจ้งหนี้ (Dr รายได้ + Dr ภาษีขาย / Cr ลูกหนี้)
 *   ใบเพิ่มหนี้ลงทางเดียวกับใบแจ้งหนี้ (Dr ลูกหนี้ / Cr รายได้ + Cr ภาษีขาย)
 *
 * ★ "ของขยับด้วยไหม" เป็นคนละคำถามกับ "เงินขยับเท่าไร" — ลูกค้าคืนของก็มี ของเสียทิ้งไปก็มี
 *   คิดเงินผิดแล้วแก้โดยไม่มีของเกี่ยวข้องเลยก็มี · จึงเป็นช่องติ๊กของคนออกใบ ไม่ใช่ระบบเดาเอง
 *
 * ★★ **โค้ดเดินทางเดียวกันทั้งสองใบ** (`_arAdjustNote`) ต่างกันแค่ตาราง · ทิศทางบัญชี · ทิศทางสต็อก ·
 *   และ "มีเพดานไหม" (ลดหนี้เกินยอดใบไม่ได้ · เพิ่มหนี้ไม่มีเพดาน เพราะคิดเงินขาดเท่าไรก็เพิ่มได้เท่านั้น)
 *   เขียนแยกสองชุดเมื่อไหร่ วันหนึ่งจะแก้ชุดเดียวแล้วอีกชุดเงียบๆ ผิดไปคนละทาง
 */

var CN_REASONS = {
  return: 'ลูกค้าคืนสินค้า',
  shortage: 'ส่งของไม่ครบ / ของขาด',
  damaged: 'สินค้าชำรุดเสียหาย',
  overcharge: 'คิดราคาผิด / คิดเงินเกิน',
  discount: 'ให้ส่วนลดเพิ่มหลังออกใบกำกับภาษี',
  cancel: 'ยกเลิกการขาย'
};
var DN_REASONS = {
  extra: 'ส่งของเพิ่มจากที่ระบุในใบกำกับภาษี',
  undercharge: 'คิดราคาต่ำไป / คิดเงินขาด',
  priceup: 'ปรับราคาเพิ่มตามที่ตกลงกันใหม่',
  freight: 'ค่าขนส่ง/ค่าบริการที่ยังไม่ได้เรียกเก็บ',
  calc: 'คำนวณยอดผิดพลาด'
};

/* นิยามของ "ใบปรับหนี้" สองชนิด — จุดเดียวที่ความต่างของสองใบนี้อยู่ */
var AR_ADJ = {
  credit: { kind: 'credit', docType: 'CN', table: 'ar_credit_notes', itemsTable: 'ar_credit_note_items',
    noField: 'credit_note_no', label: 'ใบลดหนี้', invCol: 'credited_amount', stockDir: 1,
    capped: true, reasons: CN_REASONS, moveType: 'sale_return', refType: 'AR_CREDIT_NOTE' },
  debit:  { kind: 'debit', docType: 'DN', table: 'ar_debit_notes', itemsTable: 'ar_debit_note_items',
    noField: 'debit_note_no', label: 'ใบเพิ่มหนี้', invCol: 'debited_amount', stockDir: -1,
    capped: false, reasons: DN_REASONS, moveType: 'sale_out', refType: 'AR_DEBIT_NOTE' }
};

/** ยอดที่ปรับไปแล้วของใบแจ้งหนี้ใบหนึ่ง (ใบที่ยังไม่ถูกยกเลิก) */
function _arAdjSumOf(kindDef, invoiceId) {
  var sum = 0;
  centralObjects(kindDef.table).forEach(function(n) {
    if (String(n.ar_invoice_id) !== String(invoiceId)) return;
    if (String(n.status) === 'void') return;
    sum += Number(n.total) || 0;
  });
  return _money(sum);
}

/** ยอดค้างจริงของใบแจ้งหนี้ = ยอดใบ + เพิ่มหนี้ − รับชำระ − ลดหนี้ (ใช้ร่วมกันทุกที่ที่คิดยอดค้าง) */
function arInvoiceOutstanding(iv) {
  return _money((Number(iv.total) || 0) + (Number(iv.debited_amount) || 0)
    - (Number(iv.received_amount) || 0) - (Number(iv.credited_amount) || 0));
}

/**
 * รายการตั้งต้นสำหรับออกใบลดหนี้/ใบเพิ่มหนี้ของใบแจ้งหนี้ใบหนึ่ง
 * payload: { invoiceId, kind?('credit'|'debit') }
 */
function getArCreditNoteDraft(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var K = AR_ADJ[String(payload.kind || 'credit')] || AR_ADJ.credit;
  var iv = _findById('ar_invoices', payload.invoiceId);
  if (!iv) return { success: false, message: 'ไม่พบใบแจ้งหนี้นี้' };
  if (String(iv.status) === 'void') return { success: false, message: 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว' };

  var credited = _arAdjSumOf(AR_ADJ.credit, iv.record_id);
  var debited = _arAdjSumOf(AR_ADJ.debit, iv.record_id);
  var out = { success: true, kind: K.kind, label: K.label, reasons: K.reasons, invoice: {
    id: iv.record_id, invoiceNo: iv.invoice_no, invoiceDate: _dOnly(iv.invoice_date), customerId: iv.customer_id,
    tenantId: iv.tenant_id || '', salesOrderId: iv.sales_order_id || '', deliveryRoundId: iv.delivery_round_id || '',
    subtotalExVat: Number(iv.subtotal_ex_vat) || 0, vatAmount: Number(iv.vat_amount) || 0,
    total: Number(iv.total) || 0, received: Number(iv.received_amount) || 0,
    credited: credited, debited: debited,
    /* ลดหนี้ได้ไม่เกิน "ยอดใบ + ที่เพิ่มหนี้ไว้ − ที่ลดไปแล้ว" · เพิ่มหนี้ไม่มีเพดาน */
    creditable: _money((Number(iv.total) || 0) + debited - credited),
    outstanding: arInvoiceOutstanding(iv)
  }, lines: [] };

  var cust = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(iv.customer_id)) cust = c; });
  out.customer = cust ? { id: cust.record_id, name: customerFullName(cust), code: cust.customer_code || '',
    address: cust.address || '', taxId: cust.tax_id || '', branchCode: cust.tax_branch_code || '' } : null;

  // ใบที่ไม่ได้ผูกบิลขาย (กรอกเอง) ปรับหนี้ได้เหมือนกัน แต่ไม่มีบรรทัดสินค้าให้ตั้งต้น
  if (!iv.sales_order_id || !iv.tenant_id) return out;

  var order = tenantRowById(iv.tenant_id, 'sales_orders', iv.sales_order_id);
  if (!order) return out;
  var items = tenantRowsWhere(iv.tenant_id, 'order_items', 'order_id', order.record_id);
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  /* ใบของรอบจัดส่ง = คิดจากจำนวนของรอบนั้น · ใบของทั้งบิล = ทั้งใบ
     ราคาต่อหน่วยใช้ "สุทธิหลังส่วนลดที่เฉลี่ยลงบรรทัดแล้ว" ชุดเดียวกับที่ออกใบกำกับภาษีไป
     (คิดใหม่ = ใบปรับหนี้กับใบกำกับเดิมไม่ตรงกันทีละสตางค์ ซึ่งสรรพากรจับได้ทันที) */
  var roundQty = null;
  if (iv.delivery_round_id) {
    roundQty = {};
    tenantObjectsIfExists(iv.tenant_id, 'delivery_round_items').forEach(function(ri) {
      if (String(ri.round_id) !== String(iv.delivery_round_id)) return;
      roundQty[String(ri.item_id)] = (roundQty[String(ri.item_id)] || 0) + (parseFloat(ri.qty) || 0);
    });
  }
  var ov = _orderVat(order);
  items.forEach(function(it) {
    var ordered = parseFloat(it.qty) || 0;
    var qty = roundQty ? (roundQty[String(it.record_id)] || 0) : ordered;
    if (!(qty > 0) || !(ordered > 0)) return;
    var unitNet = ((parseFloat(it.line_total) || 0) - (parseFloat(it.line_discount) || 0)) / ordered;
    var p = products[String(it.product_id)] || {};
    out.lines.push({ itemId: it.record_id, productId: it.product_id, productCode: p.product_code || '',
      productName: p.name || '(สินค้าถูกลบ)', unitCode: it.unit_code || '', unitFactor: _drLineFactor(it),
      qty: qty, unitPrice: _money(unitNet), amount: _money(unitNet * qty),
      taxStatus: String(it.tax_status || '') || TAX_VAT, isFree: String(it.is_free) === '1' });
  });
  out.vatRate = ov.rate;
  out.orderCode = order.order_code;
  return out;
}

/**
 * ออกใบลดหนี้ / ใบเพิ่มหนี้ — ทางเดินเดียวกัน ต่างกันที่ `AR_ADJ[kind]`
 * payload: { invoiceId, reasonCode, reason?, creditDate?, moveStock?, lines:[{itemId?, productId, unitCode, unitFactor?, qty, unitPrice, taxStatus}] }
 */
function _arAdjustNote(session, payload, K) {
  payload = payload || {};
  return _withDocLock(function() {
    var iv = _findById('ar_invoices', payload.invoiceId);
    if (!iv) return { success: false, message: 'ไม่พบใบแจ้งหนี้นี้' };
    if (String(iv.status) === 'void') return { success: false, message: 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว' };
    var book = _bookScope(session, payload);
    if (!_inBook(iv, book)) return { success: false, message: 'ใบแจ้งหนี้นี้ไม่ได้อยู่ในสมุดที่เลือกอยู่' };

    var date = payload.creditDate || payload.noteDate || _todayStr();
    if (!_validDate(date)) return { success: false, message: 'วันที่' + K.label + 'ต้องเป็น yyyy-MM-dd' };
    var reasonCode = String(payload.reasonCode || '');
    var reason = String(payload.reason || K.reasons[reasonCode] || '').trim();
    if (!reason) return { success: false, message: 'ต้องระบุเหตุผล (กฎหมายบังคับให้แสดงบน' + K.label + ')' };

    var rate = Number(payload.vatRate);
    if (!(rate >= 0)) {
      var ivTotal = Number(iv.total) || 0, ivEx = Number(iv.subtotal_ex_vat) || 0;
      rate = ivEx > 0 ? _round2((ivTotal - ivEx) / ivEx * 100) / 100 : currentVatRate();
    }

    var lines = [], taxable = 0, exempt = 0;
    (payload.lines || []).forEach(function(l) {
      var qty = parseFloat(l.qty) || 0, price = parseFloat(l.unitPrice) || 0;
      if (!(qty > 0)) return;
      var amount = _money(qty * price);
      var taxStatus = String(l.taxStatus || '') || TAX_VAT;
      if (taxStatus === TAX_VAT) taxable += amount; else exempt += amount;
      lines.push({ itemId: l.itemId || '', productId: l.productId || '', unitCode: l.unitCode || '',
        unitFactor: parseFloat(l.unitFactor) || 1, qty: qty, unitPrice: _money(price), amount: amount, taxStatus: taxStatus });
    });
    if (!lines.length) return { success: false, message: 'ต้องมีรายการอย่างน้อย 1 รายการ' };

    var sv = splitVat(_money(taxable), rate);
    var total = _money(taxable + exempt);
    var exVat = _money(sv.exVat + exempt), vat = _money(sv.vat);

    var credited = _arAdjSumOf(AR_ADJ.credit, iv.record_id);
    var debited = _arAdjSumOf(AR_ADJ.debit, iv.record_id);
    /* ★ ลดหนี้มีเพดาน: ลดได้ไม่เกินยอดที่ยังไม่ถูกลด · เพิ่มหนี้ไม่มีเพดาน (คิดเงินขาดเท่าไรก็เพิ่มได้เท่านั้น) */
    if (K.capped) {
      var creditable = _money((Number(iv.total) || 0) + debited - credited);
      if (total > creditable + 0.009) {
        return { success: false, message: 'ลดหนี้ได้ไม่เกิน ' + creditable.toLocaleString() + ' บาท (ใบนี้ลดไปแล้ว ' + credited.toLocaleString() + ')' };
      }
    }

    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(iv.customer_id)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้าของใบแจ้งหนี้นี้' };

    var noteId = centralNextId(K.table);
    var noteNo = _nextCentralDocNo(K.docType, book || undefined);
    /* ใบลดหนี้ = กลับทางกับใบแจ้งหนี้ · ใบเพิ่มหนี้ = ทางเดียวกับใบแจ้งหนี้
       ★★ ลงในงวดของ "วันที่ออกใบ" ไม่ใช่ย้อนไปงวดของใบเดิม (ใบเดิมยื่น ภ.พ.30 ไปแล้ว) */
    var jrLines = K.kind === 'credit' ? [
      { accountCode: GL_ACCT.SALES, description: 'ลดรายได้: ' + reason, debit: exVat, credit: 0 },
      { accountCode: GL_ACCT.VAT_OUTPUT, description: 'ลดภาษีขาย', debit: vat, credit: 0 },
      { accountCode: GL_ACCT.AR, description: 'ลดลูกหนี้ ' + (iv.invoice_no || ''), debit: 0, credit: total,
        partyType: 'customer', partyId: customer.record_id }
    ] : [
      { accountCode: GL_ACCT.AR, description: 'เพิ่มลูกหนี้ ' + (iv.invoice_no || ''), debit: total, credit: 0,
        partyType: 'customer', partyId: customer.record_id },
      { accountCode: GL_ACCT.SALES, description: 'รายได้เพิ่ม: ' + reason, debit: 0, credit: exVat },
      { accountCode: GL_ACCT.VAT_OUTPUT, description: 'ภาษีขายเพิ่ม', debit: 0, credit: vat }
    ];
    var jr = _postJournal({ date: date, source: 'AR', refType: K.refType, refId: noteId, tenantId: book,
      memo: K.label + ' ' + noteNo + ' (' + (iv.invoice_no || '') + ') ' + customerFullName(customer),
      createdBy: session.adminUserId, lines: jrLines });
    if (!jr.success) return jr;

    var row = { record_id: noteId, ar_invoice_id: iv.record_id, invoice_no: iv.invoice_no || '',
      customer_id: customer.record_id, tenant_id: iv.tenant_id || '',
      sales_order_id: iv.sales_order_id || '', delivery_round_id: iv.delivery_round_id || '',
      credit_date: date, reason_code: reasonCode, reason: reason, vat_rate: rate,
      subtotal_ex_vat: exVat, vat_amount: vat, total: total,
      stock_returned: (payload.moveStock || payload.returnStock) ? 'TRUE' : 'FALSE',
      journal_id: jr.journalId, status: 'posted', created_by: session.adminUserId, created_at: nowStr() };
    row[K.noField] = noteNo;
    centralAppend(K.table, row);
    var itemId = centralNextId(K.itemsTable);
    centralAppendMany(K.itemsTable, lines.map(function(l, i) {
      return { record_id: itemId + i, note_id: noteId, credit_note_id: noteId, debit_note_id: noteId,
        order_item_id: l.itemId, product_id: l.productId, unit_code: l.unitCode, unit_factor: l.unitFactor,
        qty: l.qty, unit_price: l.unitPrice, amount: l.amount, tax_status: l.taxStatus };
    }));

    /* ยอดค้างของใบแจ้งหนี้ = ยอดใบ + เพิ่มหนี้ − รับชำระ − ลดหนี้
       ลดจนไม่เหลือ = ปิดใบด้วยสถานะ `credited` (ไม่ใช่ `paid` — คนละเรื่องกัน ลูกค้าไม่ได้จ่ายเงิน)
       เพิ่มหนี้ให้ใบที่ปิดไปแล้ว = ใบกลับมาค้างอีกครั้งโดยอัตโนมัติ ซึ่งถูกต้อง */
    var patch = {};
    patch[K.invCol] = _money((K.kind === 'credit' ? credited : debited) + total);
    var recv = Number(iv.received_amount) || 0;
    var newCredited = K.kind === 'credit' ? patch[K.invCol] : credited;
    var newDebited = K.kind === 'debit' ? patch[K.invCol] : debited;
    var left = _money((Number(iv.total) || 0) + newDebited - recv - newCredited);
    patch.status = left <= 0.009 ? (recv > 0.009 ? 'paid' : 'credited') : (recv > 0.009 ? 'partial' : 'open');
    centralUpdate('ar_invoices', iv.record_id, patch);

    // ของขยับตามไหม — เฉพาะเมื่อคนออกใบสั่ง และเฉพาะใบที่รู้ว่าคลังไหน
    var moved = 0;
    if ((payload.moveStock || payload.returnStock) && iv.tenant_id) {
      var scope = _saleStockScope(iv.tenant_id), warehouseId = _ensureScopeWarehouse(scope);
      var cost = {};
      _scoped('warehouse_stock', scope).forEach(function(r) {
        if (String(r.warehouse_id) === String(warehouseId)) cost[String(r.product_id)] = Number(r.avg_cost) || 0;
      });
      lines.forEach(function(l) {
        if (!l.productId || !(l.qty > 0)) return;
        _applyStockIn(scope, warehouseId, l.productId, K.stockDir * l.qty * (l.unitFactor || 1),
          cost[String(l.productId)] || 0, K.moveType, K.refType, noteId,
          K.label + ' ' + noteNo + ': ' + reason, session.adminUserId);
        moved++;
      });
    }

    var out = { success: true, noteId: noteId, noteNo: noteNo, kind: K.kind, total: total,
      journalNo: jr.journalNo, stockMoved: moved,
      message: 'ออก' + K.label + ' ' + noteNo + ' ยอด ' + total.toLocaleString() + ' บาท' +
        (moved ? ' · ' + (K.kind === 'credit' ? 'คืนของเข้าคลัง ' : 'ตัดของออกจากคลัง ') + moved + ' รายการ' : '') };
    // ชื่อเดิมของใบลดหนี้ — หน้าเว็บรุ่นที่ปล่อยไปก่อนหน้านี้อ่านคีย์นี้อยู่ ไม่ตัดทิ้ง
    if (K.kind === 'credit') { out.creditNoteId = noteId; out.creditNoteNo = noteNo; }
    return out;
  });
}

function createArCreditNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  return _arAdjustNote(session, payload, AR_ADJ.credit);
}
function createArDebitNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  return _arAdjustNote(session, payload, AR_ADJ.debit);
}

/** รายการใบลดหนี้/ใบเพิ่มหนี้ (payload: { kind?, customerId?, invoiceId?, limit? }) */
function _listArAdjustNotes(session, payload, K) {
  payload = payload || {};
  var book = _bookScope(session, payload);
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = customerFullName(c); });
  var rows = centralObjects(K.table).filter(function(n) {
    if (!_inBook(n, book)) return false;
    if (payload.invoiceId && String(n.ar_invoice_id) !== String(payload.invoiceId)) return false;
    if (payload.customerId && String(n.customer_id) !== String(payload.customerId)) return false;
    return true;
  }).map(function(n) {
    return { id: n.record_id, kind: K.kind, noteNo: n[K.noField], creditNoteNo: n[K.noField],
      creditDate: _dOnly(n.credit_date), invoiceId: n.ar_invoice_id, invoiceNo: n.invoice_no || '',
      customerId: n.customer_id, customerName: customers[String(n.customer_id)] || '',
      salesOrderId: n.sales_order_id || '', reason: n.reason || '', reasonCode: n.reason_code || '',
      subtotalExVat: Number(n.subtotal_ex_vat) || 0, vatAmount: Number(n.vat_amount) || 0,
      total: Number(n.total) || 0, stockReturned: isFlagOn(n.stock_returned),
      status: n.status || 'posted', journalId: n.journal_id || '' };
  });
  rows.sort(function(a, b) { return String(b.creditDate).localeCompare(String(a.creditDate)) || (b.id - a.id); });
  return { success: true, kind: K.kind, data: rows.slice(0, _int(payload.limit) || 200) };
}
function listArCreditNotes(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var K = AR_ADJ[String((payload || {}).kind || 'credit')] || AR_ADJ.credit;
  return _listArAdjustNotes(session, payload, K);
}
function listArDebitNotes(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  return _listArAdjustNotes(session, payload, AR_ADJ.debit);
}

/** ใบเดียวพร้อมรายการ — ใช้ตอนพิมพ์ (payload: { id, kind? }) */
function getArCreditNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var K = AR_ADJ[String(payload.kind || 'credit')] || AR_ADJ.credit;
  var n = _findById(K.table, payload.id);
  if (!n) return { success: false, message: 'ไม่พบ' + K.label + 'นี้' };
  var iv = _findById('ar_invoices', n.ar_invoice_id) || {};
  var customer = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(n.customer_id)) customer = c; });
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var items = centralObjects(K.itemsTable)
    .filter(function(it) { return String(it.note_id || it.credit_note_id || it.debit_note_id) === String(n.record_id); })
    .map(function(it) {
      var p = products[String(it.product_id)] || {};
      return { productCode: p.product_code || '', productName: p.name || '', unitCode: it.unit_code || '',
        qty: Number(it.qty) || 0, unitPrice: Number(it.unit_price) || 0, amount: Number(it.amount) || 0 };
    });
  /* เลขใบกำกับภาษีเดิม — กฎหมายบังคับให้อ้างบนใบลดหนี้/ใบเพิ่มหนี้ · ใบของรอบจัดส่งเก็บเลขไว้ที่แถวรอบ
     ส่วนใบของทั้งบิลอยู่บนแถวบิล (48_delivery_rounds.gs / 34_sales_status.gs) */
  var taxInvoiceNo = '', orderCode = '';
  if (n.tenant_id && n.sales_order_id) {
    var order = tenantRowById(n.tenant_id, 'sales_orders', n.sales_order_id);
    if (order) {
      orderCode = order.order_code || '';
      taxInvoiceNo = order.tax_invoice_no || '';
      if (n.delivery_round_id) {
        var rnd = tenantObjectsIfExists(n.tenant_id, 'delivery_rounds')
          .filter(function(r) { return String(r.record_id) === String(n.delivery_round_id); })[0];
        if (rnd && rnd.tax_invoice_no) taxInvoiceNo = rnd.tax_invoice_no;
      }
    }
  }
  var note = { id: n.record_id, kind: K.kind, label: K.label, noteNo: n[K.noField], creditNoteNo: n[K.noField],
    creditDate: _dOnly(n.credit_date), reason: n.reason || '', reasonCode: n.reason_code || '',
    vatRate: Number(n.vat_rate) || currentVatRate(), subtotalExVat: Number(n.subtotal_ex_vat) || 0,
    vatAmount: Number(n.vat_amount) || 0, total: Number(n.total) || 0,
    stockReturned: isFlagOn(n.stock_returned), status: n.status || 'posted',
    invoiceNo: n.invoice_no || '', invoiceDate: _dOnly(iv.invoice_date), invoiceTotal: Number(iv.total) || 0,
    taxInvoiceNo: taxInvoiceNo, orderCode: orderCode, tenantId: n.tenant_id || '' };
  return { success: true, kind: K.kind, creditNote: note, note: note,
    customer: customer ? { name: customerFullName(customer), code: customer.customer_code || '',
      address: customer.address || '', taxId: customer.tax_id || '', branchCode: customer.tax_branch_code || '',
      phone: customer.phone || '' } : null,
    issuer: _docIssuer(session, n.tenant_id || ''),
    items: items };
}
function getArDebitNote(session, payload) {
  return getArCreditNote(session, Object.assign({}, payload || {}, { kind: 'debit' }));
}
