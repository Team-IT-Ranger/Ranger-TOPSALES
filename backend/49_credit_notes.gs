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
/* ═══════ ★★ ใครเป็นต้นเหตุที่ของถูกคืน — ตัวตัดสินว่า "เรียกคืนส่วนลดขั้น" ได้หรือไม่ ═══════
 * (เจ้าของระบบสั่ง 23 ต.ค. 2026)
 * ปัญหา: ลูกค้าซื้อ 50 ลังจึงได้ราคาขั้นถูก คืน 40 ลัง เหลือถือ 10 ลังในราคาที่ 10 ลังไม่เคยได้
 *   → ต้องลดหนี้ **ต่ำกว่า** ราคาที่ขายไป เพื่อดึงของที่เหลือกลับไปอยู่ขั้นที่มันถึงจริง
 * ★★ แต่ **ทำแบบนี้กับทุกใบไม่ได้** — ถ้าของคืนเพราะความผิดของเรา (ส่งไม่ครบ · ส่งของเสียหาย)
 *   ลูกค้าไม่ได้เลือกลดจำนวนเอง การไปเก็บส่วนต่างคืนคือลงโทษลูกค้าสำหรับความผิดของเรา
 *   ร้านจะเถียง และเถียงถูกด้วย
 * `seller` = ความผิดของเรา → ราคาต้องเท่าที่ขายไป ห้ามเรียกคืน
 * `buyer`  = ลูกค้าเลือกเอง → ปรับราคาลงได้ตามขั้นที่เหลือจริง
 * `none`   = ไม่ใช่เรื่องของที่คืน (คิดราคาผิด/ให้ส่วนลดเพิ่ม) → ปรับได้อิสระ ไม่มีเรื่องขั้นราคามาเกี่ยว
 * ★ ปลดล็อกได้ด้วย `payload.priceOverride` แต่ **ถูกบันทึกลงในเหตุผลของใบ** เสมอ —
 *   ข้อยกเว้นมีจริง (ตกลงกับร้านไว้แล้ว) แต่ต้องมีร่องรอยว่าใครเป็นคนตัดสินใจ
 */
var CN_FAULT = {
  shortage: 'seller',    // ส่งของไม่ครบ — เราส่งขาดเอง
  damaged:  'seller',    // ของเสียหาย — เสียมาตั้งแต่ก่อนถึงมือลูกค้า
  return:   'buyer',     // ลูกค้าคืนสินค้า — เลือกเอง
  cancel:   'buyer',     // ยกเลิกการขาย — เลือกเอง
  overcharge: 'none',    // คิดราคาผิด — ไม่มีของคืน
  discount:   'none'     // ให้ส่วนลดเพิ่ม — ไม่มีของคืน
};
function cnFaultOf(reasonCode) { return CN_FAULT[String(reasonCode || '')] || 'none'; }

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
    /* ★★ รับทั้ง 'void' และ 'voided' — ไฟล์นี้เคยใช้สองคำขัดกันเองมาก่อนแล้ว
       (`_listArAdjustNotes` กรอง 'voided' ส่วนที่นี่กรอง 'void') — ไม่เคยระเบิดเพราะ
       ยังยกเลิกใบไม่ได้ · พอทำปุ่มยกเลิกขึ้นมา รายการหายแต่ยอดยังถูกหักอยู่
       ★ ค่ามาตรฐานคือ 'voided' (ตรงกับ gl_journals) — รับอีกค่าไว้เผื่อข้อมูลเก่า */
    if (String(n.status) === 'void' || String(n.status) === 'voided') return;
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
  var out = { success: true, kind: K.kind, label: K.label, reasons: K.reasons,
    // หน้าจอใช้ตัวนี้ตัดสินว่าช่องราคาแก้ได้ไหม เมื่อเลือกเหตุผลแต่ละข้อ
    reasonFault: K.kind === 'credit' ? CN_FAULT : {}, invoice: {
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
  /* ★ คลังปลายทางของ "ของที่คืนกลับมา" — ส่งไปพร้อมร่าง จะได้เลือกได้ในฟอร์มเดียวกับที่ออกใบลดหนี้
     (เจ้าของระบบสั่ง 23 ต.ค. 2026) · สร้างคลังรับคืน/ของเสียให้ครั้งแรกที่ใช้ เหมือนฝั่งใบรับคืน */
  if (K.kind === 'credit') {
    var cnScope = _saleStockScope(iv.tenant_id);
    var cnSale = _ensureScopeWarehouse(cnScope);
    var cnQuar = _ensureWarehouseByPurpose(cnScope, 'quarantine');
    var cnScrap = _ensureWarehouseByPurpose(cnScope, 'scrap');
    var ORD = { sale: 0, quarantine: 1, scrap: 2 };
    out.warehouses = _scoped('warehouses', cnScope).filter(function(w) { return _isTrue(w.is_active); })
      .map(function(w) {
        return { id: w.record_id, name: w.name, purpose: _whPurpose(w),
          purposeLabel: WH_PURPOSES[_whPurpose(w)], sellable: _isSellableWarehouse(w) };
      });
    out.warehouses.sort(function(a, b) { return (ORD[a.purpose] - ORD[b.purpose]) || (a.id - b.id); });
    out.defaultWarehouseId = { good: cnSale, quarantine: cnQuar, scrap: cnScrap, damaged: cnScrap, expired: cnScrap };
  }

  var ov = _orderVat(order);
  // ★ ราคาต่อหน่วยต้องเป็นของที่บิลใบนั้นขายไปจริง (soldNetByItem ใน 18_pricing_engine.gs)
  var netOf = soldNetByItem(order, items);
  items.forEach(function(it) {
    var ordered = parseFloat(it.qty) || 0;
    var qty = roundQty ? (roundQty[String(it.record_id)] || 0) : ordered;
    if (!(qty > 0) || !(ordered > 0)) return;
    var unitNet = soldUnitNet(netOf[String(it.record_id)], it);
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
    // ★ ปลดล็อกราคาแล้วต้องเห็นบนใบ ไม่ใช่รู้กันเองสองคน
    if (payload.priceOverride) reason += ' · ปรับราคาเอง (' + (session.displayName || session.adminUserId) + ')';
    if (!reason) return { success: false, message: 'ต้องระบุเหตุผล (กฎหมายบังคับให้แสดงบน' + K.label + ')' };

    var rate = Number(payload.vatRate);
    if (!(rate >= 0)) {
      var ivTotal = Number(iv.total) || 0, ivEx = Number(iv.subtotal_ex_vat) || 0;
      rate = ivEx > 0 ? _round2((ivTotal - ivEx) / ivEx * 100) / 100 : currentVatRate();
    }

    /* ★★ ราคาต่อหน่วยแก้ได้ (เจ้าของระบบสั่ง 23 ต.ค. 2026) — ลูกค้าที่ซื้อเยอะจนได้ราคาขั้นถูก
       แล้วคืนของบางส่วน ไม่ควรได้ถือของที่เหลือไว้ในราคาขั้นที่ตัวเองไม่ถึงแล้ว จึงต้องลดหนี้
       **ต่ำกว่า** ราคาที่ขายไป · แต่ **สูงกว่าราคาที่ขายจริงไม่ได้เด็ดขาด** = คืนเงินเกินกว่าที่เก็บมา
       ซึ่งไม่ใช่การลดหนี้แล้ว และใบลดหนี้จะขัดกับใบกำกับเดิมทันที (เพดานทั้งใบไม่จับกรณีนี้ เพราะ
       ลดบางรายการแพงไปแต่ยอดรวมยังไม่ถึงเพดาน ก็ผ่านได้สบาย) */
    var soldCap = null;
    if (K.kind === 'credit' && iv.sales_order_id && iv.tenant_id) {
      var capOrder = tenantRowById(iv.tenant_id, 'sales_orders', iv.sales_order_id);
      if (capOrder) {
        var capItems = tenantRowsWhere(iv.tenant_id, 'order_items', 'order_id', capOrder.record_id);
        var capNet = soldNetByItem(capOrder, capItems);
        soldCap = {};
        capItems.forEach(function(it) { soldCap[String(it.record_id)] = soldUnitNet(capNet[String(it.record_id)], it); });
      }
    }

    var lines = [], taxable = 0, exempt = 0, overPriced = '', underPriced = '';
    (payload.lines || []).forEach(function(l) {
      var qty = parseFloat(l.qty) || 0, price = parseFloat(l.unitPrice) || 0;
      if (!(qty > 0)) return;
      if (soldCap && l.itemId && soldCap[String(l.itemId)] !== undefined) {
        var cap = soldCap[String(l.itemId)];
        if (price > cap + 0.009) overPriced = String(cap);
        /* ★ ความผิดของเรา = ห้ามลดราคาลงเพื่อเรียกคืนส่วนลดขั้น (ดู CN_FAULT ด้านบน) */
        if (!payload.priceOverride && cnFaultOf(reasonCode) === 'seller' && price < cap - 0.009) underPriced = String(cap);
      }
      var amount = _money(qty * price);
      var taxStatus = String(l.taxStatus || '') || TAX_VAT;
      if (taxStatus === TAX_VAT) taxable += amount; else exempt += amount;
      lines.push({ itemId: l.itemId || '', productId: l.productId || '', unitCode: l.unitCode || '',
        unitFactor: parseFloat(l.unitFactor) || 1, qty: qty, unitPrice: _money(price), amount: amount, taxStatus: taxStatus });
    });
    if (!lines.length) return { success: false, message: 'ต้องมีรายการอย่างน้อย 1 รายการ' };
    if (overPriced) return { success: false, message: 'ราคาที่ลดหนี้สูงกว่าราคาที่ขายไปจริง (สูงสุด ' +
      Number(overPriced).toLocaleString() + ' ต่อหน่วย) — ลดหนี้เกินกว่าที่เก็บเงินมาไม่ได้' };
    if (underPriced) return { success: false, message: 'เหตุผลนี้เป็นความผิดฝั่งเรา — ต้องลดหนี้เต็มราคาที่ขายไป (' +
      Number(underPriced).toLocaleString() + ' ต่อหน่วย) ลูกค้าไม่ได้เลือกลดจำนวนเอง · ' +
      'ถ้าตกลงกับร้านไว้แล้วจริง ให้ติ๊ก "ปรับราคาเอง" เพื่อบันทึกไว้ในใบ' };

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

    /* ของขยับตามไหม — เฉพาะเมื่อคนออกใบสั่ง และเฉพาะใบที่รู้ว่าคลังไหน
       ★★ ใบลดหนี้ที่มีของคืนจริง **ออกใบรับคืนสินค้าให้ด้วยเสมอ** (เจ้าของระบบสั่ง 23 ต.ค. 2026)
         ลูกค้าได้ใบลดหนี้ไว้ลดหนี้ · คลังได้ใบรับคืนไว้เป็นหลักฐานว่าของเข้ามาจริงกี่ชิ้น เข้าคลังไหน
         เดิมของเข้าคลังด้วย `_applyStockIn` ดิบๆ ไม่มีเอกสารอะไรเลย ของงอกขึ้นมาในคลังโดยไม่มีใบรองรับ
       ★ ใบรับคืนเป็นตัวขยับสต็อก ใบลดหนี้จึง**ไม่ขยับซ้ำ** (หลักเดียวกับทางกลับด้าน
         `createCreditNoteFromReturn` ที่บังคับ moveStock=false) */
    var moved = 0, returnId = '', returnNo = '';
    if ((payload.moveStock || payload.returnStock) && iv.tenant_id) {
      var scope = _saleStockScope(iv.tenant_id);
      if (K.kind === 'credit' && iv.sales_order_id) {
        var destWh = String(payload.warehouseId || '') || _ensureScopeWarehouse(scope);
        var grLines = [];
        lines.forEach(function(l) {
          if (!l.itemId || !l.productId || !(l.qty > 0)) return;
          grLines.push({ itemId: l.itemId, qty: l.qty, condition: payload.condition || 'good', warehouseId: destWh });
        });
        if (grLines.length) {
          var gr = _goodsReturnCore(session, iv.tenant_id || '', { orderId: iv.sales_order_id,
            returnDate: date, reasonCode: _grReasonFor(payload.reasonCode), reason: reason,
            note: 'ออกอัตโนมัติพร้อม' + K.label + ' ' + noteNo, creditNoteId: noteId, lines: grLines });
          /* ★ ออกใบรับคืนไม่ได้ = **ล้มทั้งรายการ** ไม่ใช่ออกใบลดหนี้แล้วปล่อยของลอย
             เหตุผลที่พบจริง: ของจำนวนนั้นถูกรับคืนไปแล้วตามใบอื่น (คนจะได้รู้ว่าซ้ำ) */
          if (!gr.success) return { success: false, message: 'ออกใบลดหนี้ไม่ได้ — ' + gr.message +
            ' (ถ้าของคืนถูกบันทึกไปแล้ว ให้เอาเครื่องหมายถูก "รับของคืนเข้าคลัง" ออก)' };
          moved = gr.restocked || 0; returnId = gr.returnId; returnNo = gr.returnNo;
        }
      } else {
        // ใบเพิ่มหนี้ (ของออกไปเพิ่ม) และใบลดหนี้ที่ไม่ผูกบิลขาย — ไม่มีใบรับคืนให้ออก ขยับสต็อกตรงๆ ตามเดิม
        var warehouseId = String(payload.warehouseId || '') || _ensureScopeWarehouse(scope);
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
    }

    var out = { success: true, noteId: noteId, noteNo: noteNo, kind: K.kind, total: total,
      journalNo: jr.journalNo, stockMoved: moved, returnId: returnId, returnNo: returnNo,
      message: 'ออก' + K.label + ' ' + noteNo + ' ยอด ' + total.toLocaleString() + ' บาท' +
        (returnNo ? ' · และใบรับคืนสินค้า ' + returnNo
                  : (moved ? ' · ' + (K.kind === 'credit' ? 'คืนของเข้าคลัง ' : 'ตัดของออกจากคลัง ') + moved + ' รายการ' : '')) };
    // ชื่อเดิมของใบลดหนี้ — หน้าเว็บรุ่นที่ปล่อยไปก่อนหน้านี้อ่านคีย์นี้อยู่ ไม่ตัดทิ้ง
    if (K.kind === 'credit') { out.creditNoteId = noteId; out.creditNoteNo = noteNo; }
    return out;
  });
}

/* เหตุผลสองชุดนี้ไม่ตรงกันทุกตัว (ใบลดหนี้มี "คิดราคาผิด" ซึ่งไม่ใช่เหตุผลของการรับของคืน)
   ★ แปลงไม่ได้ = `other` ไม่ใช่ปล่อยค่าดิบไป ไม่งั้นใบรับคืนจะมี reason_code ที่ไม่มีในรายการ
     แล้วหน้าจอแสดงเป็นรหัสดิบให้คนอ่าน */
function _grReasonFor(cnReason) {
  var map = { return: 'other', damaged: 'damaged', shortage: 'over_delivery', cancel: 'not_ordered' };
  return map[String(cnReason || '')] || 'other';
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

/**
 * ยกเลิกใบลดหนี้ / ใบเพิ่มหนี้ (ออกผิดใบ · ออกผิดยอด · ลูกค้าไม่รับ)
 * payload: { id, kind?, reason, tenantId? }
 *
 * ★★ "ยกเลิก" ที่นี่ = **กลับรายการ ไม่ลบของเดิม** ตามหลักเดียวกับใบสำคัญอื่นทั้งระบบ
 *   แถวใบเดิมยังอยู่ (status = 'voided') เพราะเป็นเอกสารภาษีที่ส่งลูกค้าไปแล้ว ลูกค้าอาจถือสำเนาอยู่
 *   และเลขที่ใบต้องไม่ถูกนำกลับมาใช้ซ้ำ
 *
 * ★ สามอย่างต้องย้อนพร้อมกัน ไม่งั้นค้างครึ่งๆ กลางๆ แล้วหาไม่เจอ:
 *     1. ใบสำคัญบัญชี → ออกใบกลับรายการ (ยอดเดิม สมุดเดิม)
 *     2. ยอดสะสมบนใบแจ้งหนี้ (`credited_amount`/`debited_amount`) → หักออก แล้วคิดสถานะใหม่
 *     3. สต็อก (ถ้าใบนั้นติ๊กขยับของไว้) → ขยับกลับทางตรงข้าม
 *   ★★ ข้อ 3 ใช้ `stock_returned` ของใบเดิมเป็นตัวตัดสิน **ไม่ใช่เดาจากชนิดใบ** — ใบลดหนี้ที่ไม่ได้
 *     รับของคืน (คิดราคาผิด) ไม่เคยขยับสต็อก ย้อนให้ = ของงอกขึ้นมาจากอากาศ
 */
function voidArAdjustNote(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  return _withDocLock(function() {
    var K = AR_ADJ[String(payload.kind || 'credit')] || AR_ADJ.credit;
    var n = _findById(K.table, payload.id);
    if (!n) return { success: false, message: 'ไม่พบ' + K.label + 'นี้' };
    var book = _bookScope(session, payload);
    if (!_inBook(n, book)) return { success: false, message: 'ไม่พบ' + K.label + 'นี้' };
    if (String(n.status) === 'voided') return { success: false, message: K.label + 'นี้ถูกยกเลิกไปแล้ว' };

    var reason = String(payload.reason || '').trim();
    if (!reason) return { success: false, message: 'ต้องระบุเหตุผลที่ยกเลิก (เป็นเอกสารภาษี ต้องอธิบายได้)' };

    /* ★ ใบลดหนี้ที่ออกจากใบรับคืนสินค้า ต้องไปปลดที่ใบรับคืนก่อน ไม่งั้นใบรับคืนจะชี้ไปยังใบลดหนี้
       ที่ถูกยกเลิกแล้ว และออกใบลดหนี้ใหม่จากใบรับคืนนั้นไม่ได้ตลอดไป (54_goods_returns.gs) */
    var linkedReturn = null;
    centralObjects('goods_returns').forEach(function(g) {
      if (String(g.credit_note_id) === String(n.record_id)) linkedReturn = g;
    });

    // 1. กลับรายการใบสำคัญบัญชี
    var jr = { success: true };
    if (String(n.journal_id || '').trim()) {
      jr = _reverseJournalCore(session, n.journal_id, K.label + ' ' + n[K.noField] + ' — ' + reason, payload.voidDate);
      if (!jr.success) return jr;
    }

    // 2. คืนยอดสะสมบนใบแจ้งหนี้ แล้วคิดสถานะใหม่จากยอดจริง
    var iv = _findById('ar_invoices', n.ar_invoice_id);
    if (iv) {
      var amt = Number(n.total) || 0;
      var patch = {};
      patch[K.invCol] = _money(Math.max(0, (Number(iv[K.invCol]) || 0) - amt));
      var recv = Number(iv.received_amount) || 0;
      var credited = K.kind === 'credit' ? patch[K.invCol] : (Number(iv.credited_amount) || 0);
      var debited = K.kind === 'debit' ? patch[K.invCol] : (Number(iv.debited_amount) || 0);
      var left = _money((Number(iv.total) || 0) + debited - recv - credited);
      /* ใช้กติกาเดียวกับตอนออกใบเป๊ะ — ลอกมาเขียนใหม่เมื่อไหร่จะเพี้ยนกันวันที่มีใครแก้ข้างเดียว */
      patch.status = left <= 0.009 ? (recv > 0.009 ? 'paid' : 'credited') : (recv > 0.009 ? 'partial' : 'open');
      if (String(iv.status) === 'void') delete patch.status;      // ใบที่ยกเลิกแล้วอย่าปลุกกลับมา
      centralUpdate('ar_invoices', iv.record_id, patch);
    }

    // 3. ย้อนสต็อก เฉพาะใบที่เคยขยับของจริง
    var moved = 0;
    if (isFlagOn(n.stock_returned) && n.tenant_id) {
      var scope = _saleStockScope(n.tenant_id), warehouseId = _ensureScopeWarehouse(scope);
      var cost = {};
      _scoped('warehouse_stock', scope).forEach(function(r) {
        if (String(r.warehouse_id) === String(warehouseId)) cost[String(r.product_id)] = Number(r.avg_cost) || 0;
      });
      centralObjects(K.itemsTable).forEach(function(it) {
        if (String(it.note_id) !== String(n.record_id)) return;
        var pid = it.product_id, qty = parseFloat(it.qty) || 0;
        if (!pid || !(qty > 0)) return;
        // กลับทางของเดิม: ใบลดหนี้เคยรับเข้า (+) ตอนยกเลิกต้องตัดออก (−) และกลับกันสำหรับใบเพิ่มหนี้
        _applyStockIn(scope, warehouseId, pid, -K.stockDir * qty * (parseFloat(it.unit_factor) || 1),
          cost[String(pid)] || 0, K.stockDir > 0 ? 'sale_out' : 'sale_return', K.refType, n.record_id,
          'ยกเลิก' + K.label + ' ' + n[K.noField], session.adminUserId);
        moved++;
      });
    }

    centralUpdate(K.table, n.record_id, { status: 'voided',
      reason: [n.reason, 'ยกเลิก: ' + reason].filter(function(x) { return x; }).join(' · ') });
    if (linkedReturn) centralUpdate('goods_returns', linkedReturn.record_id, { credit_note_id: '' });

    return { success: true, noteNo: n[K.noField], journalNo: jr.journalNo || '', stockMoved: moved,
      message: 'ยกเลิก' + K.label + ' ' + n[K.noField] + ' แล้ว' +
        (jr.journalNo ? ' · กลับรายการด้วยใบสำคัญ ' + jr.journalNo : '') +
        (moved ? ' · ย้อนสต็อก ' + moved + ' รายการ' : '') +
        (linkedReturn ? ' · ใบรับคืน ' + linkedReturn.return_no + ' ออกใบลดหนี้ใหม่ได้แล้ว' : '') };
  });
}
