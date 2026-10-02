/**
 * ===================== นำเข้ารายการขายออกจากบริษัท → ใบสั่งซื้อ+ใบรับของของศูนย์ (2026-10-02) =====================
 * เจ้าของระบบสั่ง: ชีตกลาง D365 (FactSales) บันทึกทุกรายการขายของบริษัทออกไปยังศูนย์ตัวแทน อัปเดตวันละ 3 ครั้ง
 * (08:00 / 12:00 / 18:00) — เอามาสร้างใบสั่งซื้อ+ใบรับของให้ศูนย์อัตโนมัติ แอดมินศูนย์แค่ตรวจรับให้ตรงของจริง
 * ไม่ต้องคีย์ซ้ำ (double work)
 *
 * ขอบเขตที่ตกลงกับเจ้าของระบบแล้ว (2026-10-02):
 *   - กรองเฉพาะ Entity='TNKI' (บริษัทขายออกเอง ไม่ใช่ศูนย์ขายต่อ/Sell-out) + Sales_type='Sell-in'
 *   - เริ่มนับจาก InvoiceDate >= EXTERNAL_SALES_IMPORT_CUTOFF (2026-09-25) — ก่อนหน้านั้นไม่ต้องย้อนนำเข้า
 *   - Customer_id (ชีต) = tenants.customer_account  ·  ProductNumber (ชีต) = products.product_code
 *   - ตอนนี้แอดมินกดปุ่มนำเข้าเอง (ยังไม่ผูก time trigger) แต่ตรรกะอ่าน/จับคู่แยกเป็นฟังก์ชันล้วน
 *     (_computeExternalSalesCandidates) ไม่พึ่ง session เลย พร้อมต่อ time trigger ได้ทันทีในอนาคต
 *   - โปรแกรม "ต้องถาม" ก่อนสร้างใบเสมอ — ไม่มีการสร้างเอกสารแบบไม่มีคนยืนยันสักจุด (preview → เลือก → import)
 *   - ใบรับของที่สร้างให้เป็น "กึ่งสำเร็จรูป" (status='pending_review') ยังไม่เข้าสต็อกจนกว่าแอดมินศูนย์จะกด
 *     ตรวจรับ (confirmExternalGoodsReceipt) ซึ่งแก้จำนวนให้ตรงกับที่รับจริงได้ก่อนกดยืนยัน
 */
var EXTERNAL_SALES_SHEET_ID = '19MzAR7dpg4kBJsZCHhWYgMUhdpQ1Z8pFBN7JObi5YA0';
var EXTERNAL_SALES_SHEET_TAB = 'FactSales';
var EXTERNAL_SALES_IMPORT_CUTOFF = '2026-09-25';   // InvoiceDate >= วันนี้เท่านั้นที่ดึงมา (ตกลงกับเจ้าของระบบ)
var EXTERNAL_SALES_ENTITY = 'TNKI';
var EXTERNAL_SALES_TYPE = 'Sell-in';

// "2026/09/25" หรือ Date object (Sheets คืนมาเป็น Date ถ้าช่องตั้งรูปแบบวันที่) → "2026-09-25"
function _externalDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return '';
  var pad = function(n) { return (n.length < 2 ? '0' : '') + n; };
  return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
}

/**
 * อ่านชีต FactSales ดิบๆ กรองแค่ Entity/Sales_type/วันที่ตั้งแต่ cutoff — คืน array ของแถวที่ map คอลัมน์แล้ว
 * (ไม่ขึ้นกับ session/permission เพื่อให้เรียกจาก time trigger ได้ในอนาคต)
 */
function _readExternalFactSalesRows() {
  var ss = SpreadsheetApp.openById(EXTERNAL_SALES_SHEET_ID);
  var sh = ss.getSheetByName(EXTERNAL_SALES_SHEET_TAB);
  if (!sh) throw new Error('ไม่พบชีต "' + EXTERNAL_SALES_SHEET_TAB + '" ในไฟล์ภายนอก');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var col = {};
  header.forEach(function(h, i) { col[String(h).trim()] = i; });
  var need = ['InvoiceDate', 'InvoiceNumber', 'Customer_id', 'ProductNumber', 'qtyCT', 'Amt_actual', 'DiscountAmt', 'Sales_type', 'Entity'];
  need.forEach(function(k) { if (col[k] === undefined) throw new Error('ชีตภายนอกไม่มีคอลัมน์ "' + k + '" (โครงสร้างไฟล์อาจเปลี่ยน)'); });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[col.Entity] || '').trim() !== EXTERNAL_SALES_ENTITY) continue;
    if (String(row[col.Sales_type] || '').trim() !== EXTERNAL_SALES_TYPE) continue;
    var dateStr = _externalDateStr(row[col.InvoiceDate]);
    if (!dateStr || dateStr < EXTERNAL_SALES_IMPORT_CUTOFF) continue;
    out.push({
      invoiceDate: dateStr, invoiceNumber: String(row[col.InvoiceNumber] || '').trim(),
      customerId: String(row[col.Customer_id] || '').trim(), productNumber: String(row[col.ProductNumber] || '').trim(),
      qtyCT: Number(row[col.qtyCT]) || 0, amtActual: Number(row[col.Amt_actual]) || 0, discountAmt: Number(row[col.DiscountAmt]) || 0
    });
  }
  return out;
}

/**
 * อ่าน+กรอง+จับกลุ่มเป็นรายใบ (1 InvoiceNumber = 1 ใบ) + จับคู่ศูนย์/สินค้า + เช็คว่าเคยนำเข้าไปแล้วหรือยัง
 * คืน { candidates:[...พร้อมนำเข้า], alreadyImported:[...], errors:[...แถวที่จับคู่ไม่ได้] }
 * candidates[i] = { invoiceNumber, invoiceDate, tenantId, tenantName, lines:[{productId,productCode,productName,qtyCT,amtActual}], totalAmt }
 */
function _computeExternalSalesCandidates() {
  var rows = _readExternalFactSalesRows();
  var tenantByAccount = {}; centralObjects('tenants').forEach(function(t) {
    var acc = String(t.customer_account || '').trim(); if (acc) tenantByAccount[acc] = t;
  });
  var productByCode = {}; centralObjects('products').forEach(function(p) {
    var code = String(p.product_code || '').trim(); if (code) productByCode[code] = p;
  });
  var importedInvoices = {};
  centralObjects('purchase_orders').forEach(function(po) { var ref = String(po.source_ref || '').trim(); if (ref) importedInvoices[ref] = true; });

  var groups = {}, order = [];
  rows.forEach(function(r) {
    if (!r.invoiceNumber) return;
    if (!groups[r.invoiceNumber]) { groups[r.invoiceNumber] = []; order.push(r.invoiceNumber); }
    groups[r.invoiceNumber].push(r);
  });

  var candidates = [], alreadyImported = [], errors = [];
  order.forEach(function(invNo) {
    var lines = groups[invNo];
    if (importedInvoices[invNo]) { alreadyImported.push({ invoiceNumber: invNo, invoiceDate: lines[0].invoiceDate }); return; }
    var tenant = tenantByAccount[lines[0].customerId];
    if (!tenant) { errors.push({ invoiceNumber: invNo, reason: 'ไม่พบศูนย์ที่ customer_account = "' + lines[0].customerId + '"' }); return; }
    var mismatchTenant = lines.some(function(l) { return l.customerId !== lines[0].customerId; });
    if (mismatchTenant) { errors.push({ invoiceNumber: invNo, reason: 'ใบเดียวกันมี Customer_id ไม่ตรงกันหลายค่า — ข้ามทั้งใบ' }); return; }

    var outLines = [], missingProducts = [], total = 0;
    lines.forEach(function(l) {
      if (!l.qtyCT) return;   // ของแถม (Sell_FOC='FOC') หรือแถวมูลค่า 0 ไม่ต้องตั้งเป็นรายการซื้อ
      var p = productByCode[l.productNumber];
      if (!p) { missingProducts.push(l.productNumber); return; }
      outLines.push({ productId: p.record_id, productCode: p.product_code, productName: p.name, qtyCT: l.qtyCT, amtActual: l.amtActual });
      total += l.amtActual;
    });
    if (missingProducts.length) { errors.push({ invoiceNumber: invNo, reason: 'ไม่พบสินค้ารหัส ' + missingProducts.join(', ') + ' ในระบบ (ProductNumber ไม่ตรงกับ product_code ใดเลย)' }); return; }
    if (!outLines.length) { errors.push({ invoiceNumber: invNo, reason: 'ใบนี้ไม่มีรายการที่ต้องซื้อจริง (เป็นของแถมล้วน)' }); return; }
    candidates.push({ invoiceNumber: invNo, invoiceDate: lines[0].invoiceDate, tenantId: tenant.tenant_id, tenantName: tenant.name,
      lines: outLines, totalAmt: _money(total) });
  });
  return { candidates: candidates, alreadyImported: alreadyImported, errors: errors };
}

// แอดมินกดปุ่ม "ตรวจรายการใหม่" — ดูได้เฉพาะฝั่งบริษัท (ข้อมูลขายออกเป็นของบริษัท ไม่ใช่ของศูนย์ใดศูนย์หนึ่ง)
function previewExternalSalesImport(session) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัทเท่านั้นที่ดึงรายการขายออกได้' };
  try {
    var r = _computeExternalSalesCandidates();
    return { success: true, candidates: r.candidates, alreadyImported: r.alreadyImported, errors: r.errors,
      cutoffDate: EXTERNAL_SALES_IMPORT_CUTOFF };
  } catch (e) { return { success: false, message: 'อ่านชีตภายนอกไม่สำเร็จ: ' + e.message }; }
}

// หาเวนเดอร์ "บริษัท" ของสมุดตัวแทนรายนี้ (สร้างให้ครั้งแรกถ้ายังไม่มี) — ใบสั่งซื้อ/รับของที่นำเข้าอัตโนมัติ
// ทุกใบอ้างเวนเดอร์ตัวนี้ เพราะในมุมของศูนย์ "ผู้ขาย" ของของล็อตนี้คือบริษัทเจ้าของสินค้าเอง ไม่ใช่เวนเดอร์ภายนอก
function _ensureCompanyVendor(scope) {
  var vendors = _scoped('vendors', scope);
  var found = vendors.filter(function(v) { return v.vendor_code === 'COMPANY'; })[0];
  if (found) return found.record_id;
  var co = _companyDto(_companyRow());
  var id = centralNextId('vendors');
  centralAppend('vendors', { record_id: id, tenant_id: scope || '', vendor_code: 'COMPANY', name: co.legalName || co.name || 'บริษัทเจ้าของสินค้า',
    tax_id: co.taxId || '', branch_code: '', contact_name: '', phone: co.phone || '', email: co.email || '', address: co.address || '',
    payment_terms_days: 0, credit_limit: 0, bank_name: '', bank_account_no: '', is_active: 'TRUE',
    note: 'สร้างอัตโนมัติ — ใช้เป็นผู้ขายของใบสั่งซื้อที่นำเข้าจากรายการขายออกของบริษัท', created_at: nowStr() });
  return id;
}

/**
 * payload: { invoiceNumbers: [...] } — นำเข้าจริง: สร้าง PO (status='sent') + ใบรับของกึ่งสำเร็จรูป
 * (status='pending_review', ยังไม่เข้าสต็อก) ต่อ 1 ใบกำกับภาษี · คำนวณใหม่จากชีตสดเสมอ ไม่เชื่อข้อมูลที่ client
 * ส่งมา (กันกรณีข้อมูลเปลี่ยนไประหว่างแอดมินเปิดหน้าพรีวิวค้างไว้)
 */
function importExternalSalesInvoices(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัทเท่านั้นที่นำเข้ารายการนี้ได้' };
  var wanted = {}; (payload.invoiceNumbers || []).forEach(function(n) { wanted[String(n).trim()] = true; });
  if (!Object.keys(wanted).length) return { success: false, message: 'ยังไม่ได้เลือกใบที่จะนำเข้า' };

  var fresh;
  try { fresh = _computeExternalSalesCandidates(); } catch (e) { return { success: false, message: 'อ่านชีตภายนอกไม่สำเร็จ: ' + e.message }; }
  var byInvoice = {}; fresh.candidates.forEach(function(c) { byInvoice[c.invoiceNumber] = c; });

  return _withDocLock(function() {
    var created = [], skipped = [];
    Object.keys(wanted).forEach(function(invNo) {
      var c = byInvoice[invNo];
      if (!c) { skipped.push({ invoiceNumber: invNo, reason: 'ไม่พบในรายการที่พร้อมนำเข้าแล้ว (อาจถูกนำเข้าไปแล้ว หรือจับคู่ไม่ได้)' }); return; }
      var scope = String(c.tenantId);
      var vendorId = _ensureCompanyVendor(scope);
      var warehouseId = _ensureScopeWarehouse(scope);

      var poId = centralNextId('purchase_orders');
      var subtotal = _money(c.lines.reduce(function(s, l) { return s + l.amtActual; }, 0));
      centralAppend('purchase_orders', { record_id: poId, tenant_id: scope, po_no: _nextCentralDocNo('PO', scope), vendor_id: vendorId,
        pr_id: '', warehouse_id: warehouseId, status: 'sent', order_date: c.invoiceDate, expected_date: c.invoiceDate,
        vat_type: 'none', subtotal_ex_vat: subtotal, discount_ex_vat: 0, vat_amount: 0, total: subtotal,
        note: 'นำเข้าอัตโนมัติจากรายการขายออกของบริษัท (ใบกำกับภาษี ' + invNo + ')',
        created_by: session.adminUserId, created_at: nowStr(), closed_at: '', source_ref: invNo });
      var poItemId = centralNextId('po_items');
      centralAppendMany('po_items', c.lines.map(function(l, i) {
        var unitPrice = l.qtyCT ? _money(l.amtActual / l.qtyCT) : 0;
        return { record_id: poItemId + i, po_id: poId, line_no: i + 1, pr_item_id: '', product_id: l.productId, description: l.productName,
          qty: l.qtyCT, unit_code: UNIT_CT, unit_factor: _productCaseFactor(l.productId), unit_price: unitPrice, amount: _money(l.amtActual), received_qty: 0 };
      }));

      var grId = centralNextId('goods_receipts');
      var grNo = _nextCentralDocNo('GR', scope);
      centralAppend('goods_receipts', { record_id: grId, tenant_id: scope, gr_no: grNo, po_id: poId, vendor_id: vendorId, warehouse_id: warehouseId,
        receive_date: c.invoiceDate, note: 'ใบรับของกึ่งสำเร็จรูป — รอแอดมินศูนย์ตรวจรับให้ตรงกับของจริงก่อนเข้าสต็อก',
        status: 'pending_review', journal_id: '', created_by: session.adminUserId, created_at: nowStr(), source_ref: invNo });
      var grItemId = centralNextId('gr_items');
      var poItems = _childrenOf('po_items', 'po_id', poId);
      centralAppendMany('gr_items', poItems.map(function(it, i) {
        var factor = Number(it.unit_factor) || 1;
        return { record_id: grItemId + i, gr_id: grId, po_item_id: it.record_id, product_id: it.product_id,
          qty: it.qty, unit_code: it.unit_code, unit_factor: factor, base_qty: _money(it.qty * factor),
          unit_cost: factor ? _money((Number(it.unit_price) || 0) / factor) : 0, amount: it.amount };
      }));
      created.push({ invoiceNumber: invNo, tenantId: scope, tenantName: c.tenantName, poId: poId, poNo: _findById('purchase_orders', poId).po_no, grId: grId, grNo: grNo });
    });
    return { success: true, created: created, skipped: skipped };
  });
}

// unit_factor ของหน่วยลัง (CT) ของสินค้า — ไม่พบตั้ง 1 (เข้าสต็อกเป็นจำนวนลังตรงๆ แทน จะได้ไม่ตันกลางทาง)
function _productCaseFactor(productId) {
  var rows = centralObjects('product_units');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].product_id) === String(productId) && normUnitCode(rows[i].unit_code) === UNIT_CT) return Number(rows[i].unit_factor) || 1;
  }
  return 1;
}

// คิวใบรับของกึ่งสำเร็จรูปที่รอแอดมินศูนย์ตรวจรับ (ขอบเขตตามตัวแทนปกติ — ศูนย์เห็นแค่ของตัวเอง)
function listPendingExternalGoodsReceipts(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  var rows = _scoped('goods_receipts', scope).filter(function(g) { return g.status === 'pending_review'; });
  var products = {}; centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  return { success: true, data: rows.map(function(g) {
    var items = _childrenOf('gr_items', 'gr_id', g.record_id).map(function(it) {
      var p = products[String(it.product_id)];
      return { grItemId: it.record_id, productId: it.product_id, productName: p ? p.name : '(สินค้าถูกลบ)', qty: Number(it.qty) || 0, unitCode: it.unit_code };
    });
    return { id: g.record_id, grNo: g.gr_no, sourceRef: g.source_ref || '', receiveDate: g.receive_date, note: g.note, items: items };
  }) };
}

/**
 * payload: { id, items:[{grItemId, qty}]? } — แอดมินศูนย์ตรวจรับ: แก้จำนวนให้ตรงกับของจริงได้ก่อนยืนยัน
 * (ไม่ส่ง items มา = ใช้จำนวนที่นำเข้าไว้เดิมทั้งหมด) ยืนยันแล้วค่อยเข้าสต็อกจริง — เส้นทางเดียวกับ receiveGoods
 * แต่ไม่ลงบัญชี (ใบรับของของตัวแทนไม่ลง journal อยู่แล้วตามกติกาเดิม)
 */
function confirmExternalGoodsReceipt(session, payload) {
  var err = _requirePermission(session, 'inventory', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var gr = _findScoped('goods_receipts', payload.id, scope);
    if (!gr) return { success: false, message: 'ไม่พบใบรับของนี้' };
    if (gr.status !== 'pending_review') return { success: false, message: 'ใบนี้ตรวจรับไปแล้ว หรือไม่ใช่ใบนำเข้าอัตโนมัติ' };
    var po = _findScoped('purchase_orders', gr.po_id, scope);
    if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อต้นทาง' };

    var overrides = {}; (payload.items || []).forEach(function(it) { if (it.grItemId != null) overrides[String(it.grItemId)] = _numOrNull(it.qty); });
    var grItems = _childrenOf('gr_items', 'gr_id', gr.record_id);
    var poItemsById = {}; _childrenOf('po_items', 'po_id', po.record_id).forEach(function(it) { poItemsById[String(it.record_id)] = it; });

    for (var i = 0; i < grItems.length; i++) {
      var qty = overrides.hasOwnProperty(String(grItems[i].record_id)) ? overrides[String(grItems[i].record_id)] : Number(grItems[i].qty);
      if (qty === null || qty < 0) return { success: false, message: 'รายการที่ ' + (i + 1) + ': จำนวนที่รับจริงต้องเป็นตัวเลขไม่ติดลบ' };
    }

    var stockOps = [];
    grItems.forEach(function(gi) {
      var qty = overrides.hasOwnProperty(String(gi.record_id)) ? overrides[String(gi.record_id)] : Number(gi.qty);
      var factor = Number(gi.unit_factor) || 1;
      var baseQty = _money(qty * factor);
      centralUpdate('gr_items', gi.record_id, { qty: qty, base_qty: baseQty });
      var poItem = poItemsById[String(gi.po_item_id)];
      if (poItem) centralUpdate('po_items', poItem.record_id, { received_qty: _money((Number(poItem.received_qty) || 0) + qty) });
      if (gi.product_id && baseQty > 0) stockOps.push({ productId: String(gi.product_id), baseQty: baseQty, unitCost: Number(gi.unit_cost) || 0 });
    });
    stockOps.forEach(function(op) {
      _applyStockIn(scope, gr.warehouse_id, op.productId, op.baseQty, op.unitCost, 'receipt', 'GR', gr.record_id, gr.gr_no, session.adminUserId);
    });

    var after = _childrenOf('po_items', 'po_id', po.record_id);
    var done = after.every(function(it) { return (Number(it.received_qty) || 0) >= (Number(it.qty) || 0) - 1e-9; });
    var some = after.some(function(it) { return (Number(it.received_qty) || 0) > 0; });
    centralUpdate('purchase_orders', po.record_id, { status: done ? 'received' : (some ? 'partial' : po.status), closed_at: done ? nowStr() : '' });
    centralUpdate('goods_receipts', gr.record_id, { status: 'posted' });
    return { success: true, message: 'ตรวจรับใบ ' + gr.gr_no + ' แล้ว — เข้าสต็อกเรียบร้อย' };
  });
}

/**
 * จุดเกาะ time trigger ในอนาคต (ยังไม่ได้ผูก — ต้องเข้า Apps Script editor → Triggers ตั้งเอง 08:00/12:00/18:00)
 * ตอนนี้แค่ "ตรวจแล้วรายงาน" ไม่สร้างเอกสารให้อัตโนมัติ เพราะกติกาคือต้องมีคนยืนยันก่อนเสมอ (ดู docstring หัวไฟล์)
 * เขียน log ไว้ให้ดูผ่าน Apps Script executions ว่ารอบไหนเจอกี่ใบ เผื่อวันหนึ่งอยากเปลี่ยนเป็นแจ้งเตือนจริง
 */
function scheduledExternalSalesImportCheck() {
  try {
    var r = _computeExternalSalesCandidates();
    Logger.log('nameExternalSalesImportCheck: พบ ' + r.candidates.length + ' ใบใหม่ที่ยังไม่ได้นำเข้า, ' +
      r.errors.length + ' ใบจับคู่ไม่ได้, ' + r.alreadyImported.length + ' ใบนำเข้าไปแล้ว');
  } catch (e) { Logger.log('scheduledExternalSalesImportCheck ล้มเหลว: ' + e.message); }
}
