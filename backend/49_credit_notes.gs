/**
 * ===================== ใบลดหนี้ (Credit Note) — 15 ต.ค. 2026 =====================
 *
 * เกิดจากช่องว่างที่เจอตอนเก็บกวาดบิลทดสอบ: **ยกเลิกบิลที่ออกใบกำกับภาษีไปแล้ว ระบบไม่มีอะไรให้ทำต่อ**
 * ต้องเข้าไปกลับรายการบัญชีทีละใบด้วยมือ ซึ่งไม่ใช่สิ่งที่แอดมินหน้างานทำได้ และไม่ใช่เอกสารที่ลูกค้าถือได้
 *
 * ★★ ใบลดหนี้เป็น **เอกสารภาษี** ตามมาตรา 86/10 ไม่ใช่แค่รายการบัญชี — ต้องมีครบ:
 *   เลขที่และวันที่ของ **ใบกำกับภาษีเดิม** · มูลค่าตามใบเดิม · มูลค่าที่ถูกต้อง · **ผลต่าง** · เหตุผลที่ลดหนี้
 *   (ตัวพิมพ์อยู่ที่หน้าเว็บ `printCreditNote` — ข้อมูลทั้งหมดที่กฎหมายต้องการถูกส่งไปจากที่นี่)
 *
 * ★ ภาษีขายลดลง "ในงวดที่ออกใบลดหนี้" ไม่ใช่ย้อนไปแก้งวดเดิม — ใบเดิมที่ยื่น ภ.พ.30 ไปแล้วห้ามขยับ
 *   ลงบัญชีกลับทางกับใบแจ้งหนี้พอดี: Dr รายได้ + Dr ภาษีขาย / Cr ลูกหนี้
 *
 * ★ "ของกลับเข้าคลังไหม" เป็นคนละคำถามกับ "ลดหนี้เท่าไร" — ลูกค้าคืนของก็มี ของเสียทิ้งไปก็มี
 *   คิดเงินเกินแล้วลดให้โดยไม่มีของเกี่ยวข้องเลยก็มี · จึงเป็นตัวเลือกของคนออกใบ ไม่ใช่ระบบเดาเอง
 */

var CN_REASONS = {
  return: 'ลูกค้าคืนสินค้า',
  shortage: 'ส่งของไม่ครบ / ของขาด',
  damaged: 'สินค้าชำรุดเสียหาย',
  overcharge: 'คิดราคาผิด / คิดเงินเกิน',
  discount: 'ให้ส่วนลดเพิ่มหลังออกใบกำกับภาษี',
  cancel: 'ยกเลิกการขาย'
};

/** ยอดที่ "ลดหนี้ไปแล้ว" ของใบแจ้งหนี้ใบหนึ่ง (ใบลดหนี้ที่ยังไม่ถูกยกเลิก) */
function _cnCreditedOf(invoiceId) {
  var sum = 0;
  centralObjects('ar_credit_notes').forEach(function(cn) {
    if (String(cn.ar_invoice_id) !== String(invoiceId)) return;
    if (String(cn.status) === 'void') return;
    sum += Number(cn.total) || 0;
  });
  return _money(sum);
}

/**
 * รายการที่ลดหนี้ได้ของใบแจ้งหนี้ใบหนึ่ง — หน้าเว็บเอาไปตั้งต้นฟอร์ม
 * คืนบรรทัดตาม "ของที่อยู่ในใบนั้นจริง" (ใบของรอบจัดส่ง = เฉพาะของรอบนั้น · ใบของทั้งบิล = ทั้งใบ)
 */
function getArCreditNoteDraft(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var iv = _findById('ar_invoices', payload.invoiceId);
  if (!iv) return { success: false, message: 'ไม่พบใบแจ้งหนี้นี้' };
  if (String(iv.status) === 'void') return { success: false, message: 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว' };

  var credited = _cnCreditedOf(iv.record_id);
  var out = { success: true, invoice: {
    id: iv.record_id, invoiceNo: iv.invoice_no, invoiceDate: _dOnly(iv.invoice_date), customerId: iv.customer_id,
    tenantId: iv.tenant_id || '', salesOrderId: iv.sales_order_id || '', deliveryRoundId: iv.delivery_round_id || '',
    subtotalExVat: Number(iv.subtotal_ex_vat) || 0, vatAmount: Number(iv.vat_amount) || 0,
    total: Number(iv.total) || 0, received: Number(iv.received_amount) || 0,
    credited: credited, creditable: _money((Number(iv.total) || 0) - credited)
  }, lines: [], reasons: CN_REASONS };

  var cust = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(iv.customer_id)) cust = c; });
  out.customer = cust ? { id: cust.record_id, name: customerFullName(cust), code: cust.customer_code || '',
    address: cust.address || '', taxId: cust.tax_id || '', branchCode: cust.tax_branch_code || '' } : null;

  // ใบที่ไม่ได้ผูกบิลขาย (กรอกเอง) ลดหนี้ได้เหมือนกัน แต่ไม่มีบรรทัดสินค้าให้ตั้งต้น
  if (!iv.sales_order_id || !iv.tenant_id) return out;

  var order = tenantRowById(iv.tenant_id, 'sales_orders', iv.sales_order_id);
  if (!order) return out;
  var items = tenantRowsWhere(iv.tenant_id, 'order_items', 'order_id', order.record_id);
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  /* ใบของรอบจัดส่ง = คิดจากจำนวนของรอบนั้น · ใบของทั้งบิล = ทั้งใบ
     ราคาต่อหน่วยใช้ "สุทธิหลังส่วนลดที่เฉลี่ยลงบรรทัดแล้ว" ชุดเดียวกับที่ออกใบกำกับภาษีไป
     (คิดใหม่ = ใบลดหนี้กับใบกำกับเดิมไม่ตรงกันทีละสตางค์ ซึ่งสรรพากรจับได้ทันที) */
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
 * ออกใบลดหนี้
 * payload: { invoiceId, reasonCode, reason?, creditDate?, returnStock?, lines:[{itemId?, productId, unitCode, unitFactor?, qty, unitPrice, taxStatus}] }
 *
 * ★ ลดเกินยอดที่ยังไม่ถูกลด ไม่ได้ · ★ ลงบัญชีกลับทางกับใบแจ้งหนี้ · ★ คืนของเข้าคลังเฉพาะเมื่อสั่ง
 */
function createArCreditNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  return _withDocLock(function() {
    var iv = _findById('ar_invoices', payload.invoiceId);
    if (!iv) return { success: false, message: 'ไม่พบใบแจ้งหนี้นี้' };
    if (String(iv.status) === 'void') return { success: false, message: 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว' };
    var book = _bookScope(session, payload);
    if (!_inBook(iv, book)) return { success: false, message: 'ใบแจ้งหนี้นี้ไม่ได้อยู่ในสมุดที่เลือกอยู่' };

    var date = payload.creditDate || _todayStr();
    if (!_validDate(date)) return { success: false, message: 'วันที่ใบลดหนี้ต้องเป็น yyyy-MM-dd' };
    var reasonCode = String(payload.reasonCode || '');
    var reason = String(payload.reason || CN_REASONS[reasonCode] || '').trim();
    if (!reason) return { success: false, message: 'ต้องระบุเหตุผลที่ลดหนี้ (กฎหมายบังคับให้แสดงบนใบลดหนี้)' };

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
    if (!lines.length) return { success: false, message: 'ต้องมีรายการที่จะลดหนี้อย่างน้อย 1 รายการ' };

    var sv = splitVat(_money(taxable), rate);
    var total = _money(taxable + exempt);
    var exVat = _money(sv.exVat + exempt), vat = _money(sv.vat);

    var credited = _cnCreditedOf(iv.record_id);
    var creditable = _money((Number(iv.total) || 0) - credited);
    if (total > creditable + 0.009) {
      return { success: false, message: 'ลดหนี้ได้ไม่เกิน ' + creditable.toLocaleString() + ' บาท (ใบนี้ลดไปแล้ว ' + credited.toLocaleString() + ')' };
    }

    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(iv.customer_id)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้าของใบแจ้งหนี้นี้' };

    var cnId = centralNextId('ar_credit_notes');
    var cnNo = _nextCentralDocNo('CN', book || undefined);
    /* ★ กลับทางกับใบแจ้งหนี้พอดี — Dr รายได้ + Dr ภาษีขาย / Cr ลูกหนี้
       ★★ ลงในงวดของ "วันที่ออกใบลดหนี้" ไม่ใช่ย้อนไปงวดของใบเดิม (ใบเดิมยื่น ภ.พ.30 ไปแล้ว) */
    var jr = _postJournal({ date: date, source: 'AR', refType: 'AR_CREDIT_NOTE', refId: cnId, tenantId: book,
      memo: 'ใบลดหนี้ ' + cnNo + ' (' + (iv.invoice_no || '') + ') ' + customerFullName(customer),
      createdBy: session.adminUserId, lines: [
        { accountCode: GL_ACCT.SALES, description: 'ลดรายได้: ' + reason, debit: exVat, credit: 0 },
        { accountCode: GL_ACCT.VAT_OUTPUT, description: 'ลดภาษีขาย', debit: vat, credit: 0 },
        { accountCode: GL_ACCT.AR, description: 'ลดลูกหนี้ ' + (iv.invoice_no || ''), debit: 0, credit: total,
          partyType: 'customer', partyId: customer.record_id }
      ] });
    if (!jr.success) return jr;

    centralAppend('ar_credit_notes', { record_id: cnId, credit_note_no: cnNo, ar_invoice_id: iv.record_id,
      invoice_no: iv.invoice_no || '', customer_id: customer.record_id, tenant_id: iv.tenant_id || '',
      sales_order_id: iv.sales_order_id || '', delivery_round_id: iv.delivery_round_id || '',
      credit_date: date, reason_code: reasonCode, reason: reason, vat_rate: rate,
      subtotal_ex_vat: exVat, vat_amount: vat, total: total,
      stock_returned: payload.returnStock ? 'TRUE' : 'FALSE', journal_id: jr.journalId, status: 'posted',
      created_by: session.adminUserId, created_at: nowStr() });
    var itemId = centralNextId('ar_credit_note_items');
    centralAppendMany('ar_credit_note_items', lines.map(function(l, i) {
      return { record_id: itemId + i, credit_note_id: cnId, order_item_id: l.itemId, product_id: l.productId,
        unit_code: l.unitCode, unit_factor: l.unitFactor, qty: l.qty, unit_price: l.unitPrice,
        amount: l.amount, tax_status: l.taxStatus };
    }));

    /* ยอดค้างของใบแจ้งหนี้ = ยอดใบ − ที่รับชำระแล้ว − ที่ลดหนี้แล้ว
       ลดจนไม่เหลือ = ปิดใบด้วยสถานะ `credited` (ไม่ใช่ `paid` — คนละเรื่องกัน ลูกค้าไม่ได้จ่ายเงิน) */
    var newCredited = _money(credited + total);
    var recv = Number(iv.received_amount) || 0;
    var left = _money((Number(iv.total) || 0) - recv - newCredited);
    centralUpdate('ar_invoices', iv.record_id, { credited_amount: newCredited,
      status: left <= 0.009 ? (recv > 0.009 ? 'paid' : 'credited') : (recv > 0.009 ? 'partial' : 'open') });

    // คืนของเข้าคลัง — เฉพาะเมื่อคนออกใบสั่ง และเฉพาะบิลที่รู้ว่าคลังไหน
    var returned = 0;
    if (payload.returnStock && iv.tenant_id) {
      var scope = _saleStockScope(iv.tenant_id), warehouseId = _ensureScopeWarehouse(scope);
      var cost = {};
      _scoped('warehouse_stock', scope).forEach(function(r) {
        if (String(r.warehouse_id) === String(warehouseId)) cost[String(r.product_id)] = Number(r.avg_cost) || 0;
      });
      lines.forEach(function(l) {
        if (!l.productId || !(l.qty > 0)) return;
        _applyStockIn(scope, warehouseId, l.productId, l.qty * (l.unitFactor || 1), cost[String(l.productId)] || 0,
          'sale_return', 'AR_CREDIT_NOTE', cnId, 'ใบลดหนี้ ' + cnNo + ': ' + reason, session.adminUserId);
        returned++;
      });
    }

    return { success: true, creditNoteId: cnId, creditNoteNo: cnNo, total: total, journalNo: jr.journalNo,
      stockReturned: returned,
      message: 'ออกใบลดหนี้ ' + cnNo + ' ยอด ' + total.toLocaleString() + ' บาท' +
        (returned ? ' · คืนของเข้าคลัง ' + returned + ' รายการ' : '') };
  });
}

/** รายการใบลดหนี้ (payload: { customerId?, invoiceId?, limit? }) */
function listArCreditNotes(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var book = _bookScope(session, payload);
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = customerFullName(c); });
  var rows = centralObjects('ar_credit_notes').filter(function(cn) {
    if (!_inBook(cn, book)) return false;
    if (payload.invoiceId && String(cn.ar_invoice_id) !== String(payload.invoiceId)) return false;
    if (payload.customerId && String(cn.customer_id) !== String(payload.customerId)) return false;
    return true;
  }).map(function(cn) {
    return { id: cn.record_id, creditNoteNo: cn.credit_note_no, creditDate: _dOnly(cn.credit_date),
      invoiceId: cn.ar_invoice_id, invoiceNo: cn.invoice_no || '', customerId: cn.customer_id,
      customerName: customers[String(cn.customer_id)] || '', salesOrderId: cn.sales_order_id || '',
      reason: cn.reason || '', reasonCode: cn.reason_code || '',
      subtotalExVat: Number(cn.subtotal_ex_vat) || 0, vatAmount: Number(cn.vat_amount) || 0,
      total: Number(cn.total) || 0, stockReturned: isFlagOn(cn.stock_returned),
      status: cn.status || 'posted', journalId: cn.journal_id || '' };
  });
  rows.sort(function(a, b) { return String(b.creditDate).localeCompare(String(a.creditDate)) || (b.id - a.id); });
  return { success: true, data: rows.slice(0, _int(payload.limit) || 200) };
}

/** ใบลดหนี้ใบเดียวพร้อมรายการ — ใช้ตอนพิมพ์ */
function getArCreditNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var cn = _findById('ar_credit_notes', payload.id);
  if (!cn) return { success: false, message: 'ไม่พบใบลดหนี้นี้' };
  var iv = _findById('ar_invoices', cn.ar_invoice_id) || {};
  var customer = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(cn.customer_id)) customer = c; });
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var items = centralObjects('ar_credit_note_items')
    .filter(function(it) { return String(it.credit_note_id) === String(cn.record_id); })
    .map(function(it) {
      var p = products[String(it.product_id)] || {};
      return { productCode: p.product_code || '', productName: p.name || '', unitCode: it.unit_code || '',
        qty: Number(it.qty) || 0, unitPrice: Number(it.unit_price) || 0, amount: Number(it.amount) || 0 };
    });
  /* เลขใบกำกับภาษีเดิม — กฎหมายบังคับให้อ้างบนใบลดหนี้ · ใบของรอบจัดส่งเก็บเลขไว้ที่แถวรอบ
     ส่วนใบของทั้งบิลอยู่บนแถวบิล (48_delivery_rounds.gs / 34_sales_status.gs) */
  var taxInvoiceNo = '', orderCode = '';
  if (cn.tenant_id && cn.sales_order_id) {
    var order = tenantRowById(cn.tenant_id, 'sales_orders', cn.sales_order_id);
    if (order) {
      orderCode = order.order_code || '';
      taxInvoiceNo = order.tax_invoice_no || '';
      if (cn.delivery_round_id) {
        var rnd = tenantObjectsIfExists(cn.tenant_id, 'delivery_rounds')
          .filter(function(r) { return String(r.record_id) === String(cn.delivery_round_id); })[0];
        if (rnd && rnd.tax_invoice_no) taxInvoiceNo = rnd.tax_invoice_no;
      }
    }
  }
  return { success: true,
    creditNote: { id: cn.record_id, creditNoteNo: cn.credit_note_no, creditDate: _dOnly(cn.credit_date),
      reason: cn.reason || '', reasonCode: cn.reason_code || '', vatRate: Number(cn.vat_rate) || currentVatRate(),
      subtotalExVat: Number(cn.subtotal_ex_vat) || 0, vatAmount: Number(cn.vat_amount) || 0, total: Number(cn.total) || 0,
      stockReturned: isFlagOn(cn.stock_returned), status: cn.status || 'posted',
      invoiceNo: cn.invoice_no || '', invoiceDate: _dOnly(iv.invoice_date), invoiceTotal: Number(iv.total) || 0,
      taxInvoiceNo: taxInvoiceNo, orderCode: orderCode, tenantId: cn.tenant_id || '' },
    customer: customer ? { name: customerFullName(customer), code: customer.customer_code || '',
      address: customer.address || '', taxId: customer.tax_id || '', branchCode: customer.tax_branch_code || '',
      phone: customer.phone || '' } : null,
    issuer: _docIssuer(session, cn.tenant_id || ''),
    items: items };
}
