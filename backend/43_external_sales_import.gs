/**
 * ===================== นำเข้ารายการขายออกจากบริษัท → ใบสั่งซื้อ+ใบรับของของศูนย์ (2026-10-02) =====================
 * เจ้าของระบบสั่ง: ชีตกลาง D365 (FactSales) บันทึกทุกรายการขายของบริษัทออกไปยังศูนย์ตัวแทน อัปเดตวันละ 3 ครั้ง
 * (08:00 / 12:00 / 18:00) — เอามาสร้างใบสั่งซื้อ+ใบรับของให้ศูนย์อัตโนมัติ แอดมินศูนย์แค่ตรวจรับให้ตรงของจริง
 * ไม่ต้องคีย์ซ้ำ (double work)
 *
 * ขอบเขตที่ตกลงกับเจ้าของระบบแล้ว (2026-10-02):
 *   - กรองเฉพาะ Entity='TNKI' (บริษัทขายออกเอง ไม่ใช่ศูนย์ขายต่อ/Sell-out) + Sales_type='Sell-in'
 *     + Sales_business='TD' (เพิ่ม 2 ต.ค. 2026 — ชีตมีธุรกิจอื่นปนอยู่ เอาเฉพาะสายที่ใช้จริงกับศูนย์กลุ่มนี้)
 *   - เริ่มนับจาก InvoiceDate >= EXTERNAL_SALES_IMPORT_CUTOFF (2026-09-25) — ก่อนหน้านั้นไม่ต้องย้อนนำเข้า
 *   - Customer_id (ชีต) = tenants.customer_account  ·  ProductNumber (ชีต) = products.product_code
 *   - ตอนนี้แอดมินกดปุ่มนำเข้าเอง (ยังไม่ผูก time trigger) แต่ตรรกะอ่าน/จับคู่แยกเป็นฟังก์ชันล้วน
 *     (_computeExternalSalesCandidates) ไม่พึ่ง session เลย พร้อมต่อ time trigger ได้ทันทีในอนาคต
 *   - ปุ่มแอดมิน: preview → เลือก → import · และนำเข้าอัตโนมัติตามเวลาได้ (scheduledExternalSalesImport — ดูท้ายไฟล์) ซึ่งปลอดภัยเพราะ
 *     สร้างได้แค่ PO + ใบรับของ pending_review สต็อกไม่ขยับจนกว่าแอดมินศูนย์ตรวจรับเอง (ปรับจากกติกาเดิม "ต้องมีคนยืนยันก่อน" ตามที่เจ้าของระบบสั่ง 2 ต.ค. 2026)
 *   - ใบรับของที่สร้างให้เป็น "กึ่งสำเร็จรูป" (status='pending_review') ยังไม่เข้าสต็อกจนกว่าแอดมินศูนย์จะกด
 *     ตรวจรับ (confirmExternalGoodsReceipt) ซึ่งแก้จำนวนให้ตรงกับที่รับจริงได้ก่อนกดยืนยัน
 */
var EXTERNAL_SALES_SHEET_ID = '19MzAR7dpg4kBJsZCHhWYgMUhdpQ1Z8pFBN7JObi5YA0';
var EXTERNAL_SALES_SHEET_TAB = 'FactSales';
var EXTERNAL_SALES_IMPORT_CUTOFF = '2026-09-25';   // InvoiceDate >= วันนี้เท่านั้นที่ดึงมา (ตกลงกับเจ้าของระบบ)
var EXTERNAL_SALES_ENTITY = 'TNKI';
var EXTERNAL_SALES_TYPE = 'Sell-in';
var EXTERNAL_SALES_BUSINESS = 'TD';

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
  var need = ['InvoiceDate', 'InvoiceNumber', 'Customer_id', 'ProductNumber', 'qtyCT', 'Amt_actual', 'DiscountAmt', 'Sales_type', 'Entity', 'Sales_business'];
  need.forEach(function(k) { if (col[k] === undefined) throw new Error('ชีตภายนอกไม่มีคอลัมน์ "' + k + '" (โครงสร้างไฟล์อาจเปลี่ยน)'); });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[col.Entity] || '').trim() !== EXTERNAL_SALES_ENTITY) continue;
    if (String(row[col.Sales_type] || '').trim() !== EXTERNAL_SALES_TYPE) continue;
    if (String(row[col.Sales_business] || '').trim() !== EXTERNAL_SALES_BUSINESS) continue;
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
  // ใบสั่งซื้อที่ถูกยกเลิก/ถอนกลับแล้ว (withdrawExternalGoodsReceipt) ไม่นับว่า "นำเข้าแล้ว" — ต้องนำเข้าใหม่ได้
  centralObjects('purchase_orders').forEach(function(po) {
    var ref = String(po.source_ref || '').trim();
    if (ref && String(po.status) !== 'cancelled') importedInvoices[ref] = true;
  });

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
  return _runExternalSalesImport(wanted, String(session.adminUserId || ''));
}

/**
 * แกนนำเข้า — ใช้ร่วมกันระหว่างปุ่มแอดมิน (importExternalSalesInvoices) กับ time trigger (scheduledExternalSalesImport)
 * ไม่พึ่ง session เลย · wanted = { 'IV123': true } เฉพาะใบที่เลือก · null = ทุกใบที่พร้อมนำเข้า (โหมดอัตโนมัติ)
 * actorId = ผู้สร้างเอกสาร ('system:auto' ตอนรันเวลาอัตโนมัติ)
 * ★ นำเข้าอัตโนมัติปลอดภัยเพราะสร้างได้แค่ PO + ใบรับของสถานะ pending_review — **สต็อกไม่ขยับ** จนกว่าแอดมินศูนย์จะตรวจรับเอง
 */
function _runExternalSalesImport(wanted, actorId) {
  var fresh;
  try { fresh = _computeExternalSalesCandidates(); } catch (e) { return { success: false, message: 'อ่านชีตภายนอกไม่สำเร็จ: ' + e.message }; }
  var byInvoice = {}; fresh.candidates.forEach(function(c) { byInvoice[c.invoiceNumber] = c; });
  var targets = wanted ? Object.keys(wanted) : fresh.candidates.map(function(c) { return c.invoiceNumber; });

  return _withDocLock(function() {
    var created = [], skipped = [];
    // อ่านชีตภายนอกช้า (~2 นาที) ระหว่างนั้นอีกรอบ (ปุ่มกด/trigger) อาจนำเข้าใบเดียวกันไปแล้ว — เช็คซ้ำอีกรอบหลังได้ล็อก
    var already = {};
    centralObjects('purchase_orders').forEach(function(po) {
      var ref = String(po.source_ref || '').trim();
      if (ref && String(po.status) !== 'cancelled') already[ref] = true;
    });
    targets.forEach(function(invNo) {
      var c = byInvoice[invNo];
      if (!c) { skipped.push({ invoiceNumber: invNo, reason: 'ไม่พบในรายการที่พร้อมนำเข้าแล้ว (อาจถูกนำเข้าไปแล้ว หรือจับคู่ไม่ได้)' }); return; }
      if (already[invNo]) { skipped.push({ invoiceNumber: invNo, reason: 'ถูกนำเข้าไปแล้วโดยอีกรอบหนึ่ง' }); return; }
      var scope = String(c.tenantId);
      var vendorId = _ensureCompanyVendor(scope);
      var warehouseId = _ensureScopeWarehouse(scope);

      // ★ รหัสเอกสารใหม่ต้องไม่ชนกับแถวลูกที่ค้างอยู่ — ถ้ามีคนลบใบแม่ (PO/GR) ออกจากชีตตรงๆ แถวลูกจะกลายเป็นแถวกำพร้า
      // แล้ว max(record_id)+1 ของใบแม่จะวนมาเท่าเดิม ใบใหม่เลย "รับ" แถวกำพร้าของใบเก่าไปด้วย (เจอจริง 2 ต.ค. 2026:
      // GR-BDC-202610-0001 มีสินค้าเกินที่ไม่อยู่ในใบกำกับภาษี) · ลูกของใบนี้อ้างจากแถวที่เพิ่งสร้างเองเท่านั้น ไม่อ่านกลับจากชีต
      var poId = _freshParentId('purchase_orders', 'po_items', 'po_id');
      var subtotal = _money(c.lines.reduce(function(s, l) { return s + l.amtActual; }, 0));
      centralAppend('purchase_orders', { record_id: poId, tenant_id: scope, po_no: _nextCentralDocNo('PO', scope), vendor_id: vendorId,
        pr_id: '', warehouse_id: warehouseId, status: 'sent', order_date: c.invoiceDate, expected_date: c.invoiceDate,
        vat_type: 'none', subtotal_ex_vat: subtotal, discount_ex_vat: 0, vat_amount: 0, total: subtotal,
        note: 'นำเข้าอัตโนมัติจากรายการขายออกของบริษัท (ใบกำกับภาษี ' + invNo + ')',
        created_by: actorId, created_at: nowStr(), closed_at: '', source_ref: invNo });
      var poItemId = centralNextId('po_items');
      var poItemRows = c.lines.map(function(l, i) {
        var unitPrice = l.qtyCT ? _money(l.amtActual / l.qtyCT) : 0;
        return { record_id: poItemId + i, po_id: poId, line_no: i + 1, pr_item_id: '', product_id: l.productId, description: l.productName,
          qty: l.qtyCT, unit_code: UNIT_CT, unit_factor: _productCaseFactor(l.productId), unit_price: unitPrice, amount: _money(l.amtActual), received_qty: 0 };
      });
      centralAppendMany('po_items', poItemRows);

      var grId = _freshParentId('goods_receipts', 'gr_items', 'gr_id');
      var grNo = _nextCentralDocNo('GR', scope);
      centralAppend('goods_receipts', { record_id: grId, tenant_id: scope, gr_no: grNo, po_id: poId, vendor_id: vendorId, warehouse_id: warehouseId,
        receive_date: c.invoiceDate, note: 'ใบรับของกึ่งสำเร็จรูป — รอแอดมินศูนย์ตรวจรับให้ตรงกับของจริงก่อนเข้าสต็อก',
        status: 'pending_review', journal_id: '', created_by: actorId, created_at: nowStr(), source_ref: invNo });
      var grItemId = centralNextId('gr_items');
      centralAppendMany('gr_items', poItemRows.map(function(it, i) {
        var factor = Number(it.unit_factor) || 1;
        return { record_id: grItemId + i, gr_id: grId, po_item_id: it.record_id, product_id: it.product_id,
          qty: it.qty, unit_code: it.unit_code, unit_factor: factor, base_qty: _money(it.qty * factor),
          unit_cost: factor ? _money((Number(it.unit_price) || 0) / factor) : 0, amount: it.amount };
      }));
      created.push({ invoiceNumber: invNo, tenantId: scope, tenantName: c.tenantName, poId: poId, poNo: _findById('purchase_orders', poId).po_no, grId: grId, grNo: grNo });
    });
    return { success: true, created: created, skipped: skipped, errors: fresh.errors, alreadyImportedCount: fresh.alreadyImported.length };
  });
}

// record_id ถัดไปของ "ใบแม่" ที่ไม่ชนกับ foreign key ที่แถวลูกยังอ้างอยู่ (กันแถวลูกกำพร้า — ดูหมายเหตุใน importExternalSalesInvoices)
function _freshParentId(parentSheet, childSheet, fkCol) {
  var next = centralNextId(parentSheet);
  centralObjects(childSheet).forEach(function(r) { var v = parseInt(r[fkCol]) || 0; if (v >= next) next = v + 1; });
  return next;
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
  // ชื่อหน่วยจริงของสินค้า (ไม่ใช่แค่แปลงรหัส CT→"ลัง" เฉยๆ) — ชื่อหน่วยที่ยังไม่ยืนยันขนาดบรรจุมีคำเตือนฝังอยู่ในนี้
  // (ดู UNIT_FACTOR_UNCONFIRMED, 10_master_data.gs) ถ้าไม่ดึงมาโชว์ แอดมินจะไม่รู้เลยว่า factor ที่เห็นยังไม่ยืนยัน
  var unitLabels = {}; centralObjects('product_units').forEach(function(u) {
    unitLabels[String(u.product_id) + '_' + normUnitCode(u.unit_code)] = u.unit_label;
  });
  return { success: true, data: rows.map(function(g) {
    // ★ ตารางแบบ matrix ฝั่งหน้าเว็บต้องมีครบ: ชื่อ/รหัสสินค้า, จำนวนรับ(แก้ได้), หน่วย, factor จากระบบ,
    // จำนวนหน่วยฐานที่จะเข้าสต็อกจริง (คูณ factor แล้ว — คำนวณฝั่งหน้าเว็บสดตามจำนวนที่แก้ เพื่อให้เห็นก่อนกดยืนยัน),
    // ราคาซื้อเข้าสุทธิของบรรทัด (amount — มาจาก Amt_actual สุทธิหลังหักส่วนลดจากชีตต้นทางตรงๆ ไม่ใช่ราคาต่อหน่วย)
    var items = _childrenOf('gr_items', 'gr_id', g.record_id).map(function(it) {
      var p = products[String(it.product_id)];
      return { grItemId: it.record_id, productId: it.product_id, productCode: p ? p.product_code : '',
        productName: p ? p.name : '(สินค้าถูกลบ)', qty: Number(it.qty) || 0, unitCode: it.unit_code,
        unitLabel: unitLabels[String(it.product_id) + '_' + normUnitCode(it.unit_code)] || '',
        unitFactor: Number(it.unit_factor) || 1, amount: Number(it.amount) || 0 };
    });
    return { id: g.record_id, grNo: g.gr_no, sourceRef: g.source_ref || '', receiveDate: safeDateStr(g.receive_date), note: g.note, items: items };
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

    var anyQty = grItems.some(function(gi) {
      var q = overrides.hasOwnProperty(String(gi.record_id)) ? overrides[String(gi.record_id)] : Number(gi.qty);
      return q > 0;
    });
    if (!anyQty) return { success: false, message: 'ไม่ได้เลือกรับรายการใดเลย — ถ้าไม่รับทั้งใบให้กด "ถอนใบรับของ" เพื่อนำเข้าใหม่' };

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
 * payload: { id } — ถอนใบรับของที่ยังไม่ตรวจรับ (pending_review) กลับ เมื่อแอดมินเห็นว่านำเข้ามาผิด/คำนวณผิด
 * ใบรับของ + ใบสั่งซื้อที่นำเข้าคู่กันถูกยกเลิก (cancelled — เก็บเป็นประวัติ ไม่ลบ) ยังไม่มีสต็อก/บัญชีขยับเลยจึงไม่ต้องคืนอะไร
 * แล้วเลขใบกำกับภาษีนั้นกลับไปอยู่ในรายการ "พร้อมนำเข้า" ให้ฝั่งบริษัทกดนำเข้าใหม่ได้ (ตัวกันซ้ำไม่นับ PO ที่ cancelled)
 */
function withdrawExternalGoodsReceipt(session, payload) {
  var err = _requirePermission(session, 'inventory', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var gr = _findScoped('goods_receipts', payload.id, scope);
    if (!gr) return { success: false, message: 'ไม่พบใบรับของนี้' };
    if (gr.status !== 'pending_review') return { success: false, message: 'ถอนได้เฉพาะใบที่ยังรอตรวจรับ — ใบนี้ตรวจรับไปแล้ว (ใช้ "ยกเลิกใบรับของ" แทน)' };
    var po = gr.po_id ? _findScoped('purchase_orders', gr.po_id, scope) : null;
    if (po && !String(po.source_ref || '').trim()) return { success: false, message: 'ใบนี้ไม่ได้มาจากการนำเข้าอัตโนมัติ — ถอนไม่ได้' };
    var reason = 'ถอนกลับก่อนตรวจรับ (นำเข้าใหม่) โดย ' + (session.displayName || session.username || session.adminUserId || '');
    centralUpdate('goods_receipts', gr.record_id, { status: 'cancelled', note: String(gr.note || '') + '\n' + reason });
    if (po) centralUpdate('purchase_orders', po.record_id, { status: 'cancelled', closed_at: nowStr(), note: String(po.note || '') + '\n' + reason });
    return { success: true, message: 'ถอนใบ ' + gr.gr_no + ' แล้ว — ฝั่งบริษัทกด "ตรวจรายการใหม่" เพื่อนำเข้าใบกำกับภาษี ' + (gr.source_ref || '') + ' ใหม่ได้' };
  });
}

/* ═══════════ นำเข้าอัตโนมัติตามเวลา (2 ต.ค. 2026 — เจ้าของระบบสั่ง: ไม่ต้องรอใครมากดสั่ง) ═══════════
 * ตั้ง trigger ด้วยการเปิด Apps Script editor → เลือกฟังก์ชัน installExternalSalesImportTriggers → Run (ครั้งเดียว — ครั้งแรก
 * จะขอสิทธิ์ script.scriptapp ให้กดยอมรับ) แล้วระบบรัน scheduledExternalSalesImport ทุกวันตามเวลาใน EXTERNAL_SALES_AUTO_HOURS
 * (ชีตต้นทางอัปเดต 08:00/12:00/18:00 จึงรันหลังนั้น ~30 นาที) · รันซ้ำ installExternalSalesImportTriggers ได้ปลอดภัย (ลบของเดิมก่อนสร้างใหม่)
 * เอาออก: removeExternalSalesImportTriggers · ผลรอบล่าสุดอยู่ใน Script Property EXTERNAL_SALES_AUTO_LAST_RUN (หน้าเมนู 4.3.1 แสดงให้ดู)
 */
var EXTERNAL_SALES_AUTO_HANDLER = 'scheduledExternalSalesImport';
var EXTERNAL_SALES_AUTO_HOURS = [8, 12, 18];
var EXTERNAL_SALES_AUTO_MINUTE = 30;
var EXTERNAL_SALES_AUTO_PROP = 'EXTERNAL_SALES_AUTO_LAST_RUN';

/** ตัวที่ trigger เรียก — นำเข้าทุกใบที่พร้อมนำเข้า (ไม่ต้องมีคนกด) สร้างแค่ PO + ใบรับของ pending_review สต็อกยังไม่ขยับ */
function scheduledExternalSalesImport() {
  var status = { at: nowStr(), ok: false, created: 0, skipped: 0, unmatched: 0, invoices: [], message: '' };
  try {
    var r = _runExternalSalesImport(null, 'system:auto');
    if (!r.success) { status.message = r.message; throw new Error(r.message); }
    status.ok = true;
    status.created = r.created.length; status.skipped = r.skipped.length; status.unmatched = (r.errors || []).length;
    status.invoices = r.created.slice(0, 20).map(function(c) { return c.invoiceNumber + ' → ' + c.tenantName; });
    status.message = 'นำเข้า ' + status.created + ' ใบ' + (status.skipped ? ' · ข้าม ' + status.skipped : '') + (status.unmatched ? ' · จับคู่ไม่ได้ ' + status.unmatched + ' ใบ (ต้องกรอก customer_account ของศูนย์ให้ครบ)' : '');
    Logger.log('scheduledExternalSalesImport: ' + status.message);
    return status;
  } catch (e) {
    status.ok = false; status.message = status.message || String(e.message || e);
    Logger.log('scheduledExternalSalesImport ล้มเหลว: ' + status.message);
    throw e;   // ให้ execution นับเป็นล้มเหลว — อีเมลแจ้ง failure ของ trigger (ตั้งใน Triggers) จะได้ทำงาน
  } finally {
    try { PropertiesService.getScriptProperties().setProperty(EXTERNAL_SALES_AUTO_PROP, JSON.stringify(status)); } catch (e2) {}
  }
}

function installExternalSalesImportTriggers() {
  var removed = removeExternalSalesImportTriggers().removed;
  EXTERNAL_SALES_AUTO_HOURS.forEach(function(h) {
    ScriptApp.newTrigger(EXTERNAL_SALES_AUTO_HANDLER).timeBased().everyDays(1).atHour(h).nearMinute(EXTERNAL_SALES_AUTO_MINUTE).create();
  });
  Logger.log('ตั้งเวลานำเข้าอัตโนมัติแล้ว: ' + EXTERNAL_SALES_AUTO_HOURS.join(', ') + ' นาฬิกา (ลบของเดิม ' + removed + ' ตัว)');
  return { success: true, hours: EXTERNAL_SALES_AUTO_HOURS, minute: EXTERNAL_SALES_AUTO_MINUTE, removed: removed };
}

function removeExternalSalesImportTriggers() {
  var old = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === EXTERNAL_SALES_AUTO_HANDLER; });
  old.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  return { success: true, removed: old.length };
}

/** เร็ว (ไม่อ่านชีตภายนอก) — หน้าเมนู 4.3.1 เรียกตอนเปิดหน้า เพื่อโชว์ว่าตั้งเวลาไว้หรือยัง + ผลรอบอัตโนมัติล่าสุด */
function getExternalSalesAutoImportStatus(session) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัท' };
  var last = null;
  try { var raw = PropertiesService.getScriptProperties().getProperty(EXTERNAL_SALES_AUTO_PROP); if (raw) last = JSON.parse(raw); } catch (e) {}
  var installed = null;   // null = อ่านไม่ได้ (ยังไม่ได้ให้สิทธิ์ script.scriptapp กับ deployment นี้)
  try { installed = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === EXTERNAL_SALES_AUTO_HANDLER; }).length; } catch (e2) {}
  return { success: true, triggersInstalled: installed, hours: EXTERNAL_SALES_AUTO_HOURS, minute: EXTERNAL_SALES_AUTO_MINUTE, lastRun: last };
}
