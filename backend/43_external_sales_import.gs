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

// factor ปัจจุบันของ (สินค้า, หน่วย) จากทะเบียนหน่วยขาย (product_units) — หน่วยฐาน (PC) = 1 เสมอ
// ไม่พบแถว = ใช้ค่า fallback (ค่าที่เก็บไว้ในใบ) · ★ ใบรับของรอตรวจรับใช้ "ค่าปัจจุบัน" ตอนแสดง/ตอนยืนยันเสมอ ไม่ใช่ค่าตอนนำเข้า
// เพื่อให้แก้ factor ที่ทะเบียนสินค้าให้ถูกแล้วกลับมาตรวจรับต่อได้เลย ไม่ต้องถอนใบแล้วนำเข้าใหม่ (เจ้าของระบบสั่ง 2 ต.ค. 2026)
function _currentUnitFactor(productId, unitCode, fallback) {
  var code = normUnitCode(unitCode, UNIT_PC);
  if (code === UNIT_PC) return 1;
  var rows = centralObjects('product_units');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].product_id) === String(productId) && normUnitCode(rows[i].unit_code) === code) {
      var f = Number(rows[i].unit_factor);
      if (f > 0) return f;
    }
  }
  return Number(fallback) > 0 ? Number(fallback) : 1;
}

// หน่วยที่เลือกได้ของสินค้า = หน่วยฐาน + หน่วยขายที่ยังใช้งาน (ให้แอดมินศูนย์เปลี่ยนหน่วยรายบรรทัดตอนตรวจรับ)
function _receiveUnitOptions(product, unitRowsByProduct) {
  var opts = [{ code: UNIT_PC, label: (product && product.unit) || 'ชิ้น', factor: 1 }];
  (unitRowsByProduct[String(product ? product.record_id : '')] || []).forEach(function(u) {
    if (String(u.is_active) === 'FALSE' || u.is_active === false) return;
    var code = normUnitCode(u.unit_code);
    if (code === UNIT_PC) return;
    opts.push({ code: code, label: u.unit_label || code, factor: Number(u.unit_factor) || 1 });
  });
  return opts;
}

function _q4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

// คิวใบรับของกึ่งสำเร็จรูปที่รอแอดมินศูนย์ตรวจรับ (ขอบเขตตามตัวแทนปกติ — ศูนย์เห็นแค่ของตัวเอง)
function listPendingExternalGoodsReceipts(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  var rows = _scoped('goods_receipts', scope).filter(function(g) { return g.status === 'pending_review'; });
  var products = {}; centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var unitRowsByProduct = {};
  centralObjects('product_units').forEach(function(u) { var k = String(u.product_id); (unitRowsByProduct[k] = unitRowsByProduct[k] || []).push(u); });
  return { success: true, data: rows.map(function(g) {
    // ★ ตาราง matrix ฝั่งหน้าเว็บ: ชื่อ/รหัส, จำนวนรับ(แก้ได้), หน่วย(เลือกได้), factor(แก้ได้), หน่วยฐานที่เข้าสต็อกจริง, ราคาซื้อเข้าสุทธิ
    // factor ที่ส่งไปคือ "ค่าปัจจุบันของสินค้า" (importedFactor = ค่าตอนนำเข้า ไว้โชว์ว่าเปลี่ยนไปแล้ว) — ดู _currentUnitFactor
    var items = _childrenOf('gr_items', 'gr_id', g.record_id).map(function(it) {
      var p = products[String(it.product_id)];
      var unitCode = normUnitCode(it.unit_code, UNIT_CT);
      var units = _receiveUnitOptions(p, unitRowsByProduct);
      var cur = units.filter(function(u) { return u.code === unitCode; })[0];
      return { grItemId: it.record_id, productId: it.product_id, productCode: p ? p.product_code : '',
        productName: p ? p.name : '(สินค้าถูกลบ)', qty: Number(it.qty) || 0, unitCode: unitCode,
        unitLabel: cur ? cur.label : '', units: units,
        unitFactor: _currentUnitFactor(it.product_id, unitCode, it.unit_factor), importedFactor: Number(it.unit_factor) || 1,
        amount: Number(it.amount) || 0 };
    });
    return { id: g.record_id, grNo: g.gr_no, sourceRef: g.source_ref || '', receiveDate: safeDateStr(g.receive_date).substring(0, 10), note: g.note || '', items: items };
  }) };
}

/**
 * แอดมินศูนย์ตรวจรับ — ยืดหยุ่นได้ก่อนยืนยัน (2 ต.ค. 2026) แล้วค่อยเข้าสต็อกจริง (เส้นทางเดียวกับ receiveGoods แต่ไม่ลงบัญชี
 * เพราะใบรับของของตัวแทนไม่ลง journal ตามกติกาเดิม)
 * payload: {
 *   id, receiveDate?: 'yyyy-MM-dd', note?: string, createRemainder?: bool (ค่าตั้งต้น true),
 *   items:   [{ grItemId, qty?, unitCode?, unitFactor?, remove?: bool }]   — ไม่ส่งช่อง = ใช้ค่าเดิม/ค่าปัจจุบันของสินค้า
 *   newItems:[{ productId, qty, unitCode?, unitFactor?, amount? }]          — ของที่ได้รับจริงแต่ไม่อยู่ในใบกำกับภาษี
 * }
 * - factor: ไม่ส่ง = ใช้ factor ปัจจุบันของสินค้า/หน่วยนั้น (ไม่ใช่ค่าตอนนำเข้า) · ส่งมา = ใช้ตามที่แอดมินกรอก (แก้เฉพาะใบนี้ ไม่แตะทะเบียนสินค้า)
 * - รับบางส่วน: รายการที่รับไม่ครบ/ไม่ติ๊กรับ → ส่วนที่เหลือ (หน่วยตามใบสั่งซื้อ) สร้างเป็นใบรอตรวจรับใบใหม่ (createRemainder) ใบสั่งซื้อค้าง partial
 * - ต้นทุนต่อหน่วยฐาน = ราคาต่อหน่วยของใบสั่งซื้อ ÷ factor ของหน่วยในใบสั่งซื้อ (เปลี่ยนหน่วยที่รับจริงไม่ทำให้ต้นทุนเพี้ยน)
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

    var ov = {}; (payload.items || []).forEach(function(it) { if (it.grItemId != null) ov[String(it.grItemId)] = it; });
    var grItems = _childrenOf('gr_items', 'gr_id', gr.record_id);
    var poItems = _childrenOf('po_items', 'po_id', po.record_id);
    var poItemById = {}; poItems.forEach(function(it) { poItemById[String(it.record_id)] = it; });
    var products = {}; centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

    // ── 1) ตรวจ + วางแผนทุกบรรทัดก่อนเขียนอะไร (ผิดข้อเดียว = ปฏิเสธทั้งใบ ไม่เขียนครึ่งๆ กลางๆ) ──
    var plan = [], n = 0;
    for (var i = 0; i < grItems.length; i++) {
      var gi = grItems[i], o = ov[String(gi.record_id)] || {};
      n++;
      if (o.remove) { plan.push({ gi: gi, removed: true }); continue; }
      var qty = o.qty !== undefined ? _numOrNull(o.qty) : Number(gi.qty);
      if (qty === null || isNaN(qty) || qty < 0) return { success: false, message: 'รายการที่ ' + n + ': จำนวนที่รับจริงต้องเป็นตัวเลขไม่ติดลบ' };
      var unitCode = o.unitCode ? normUnitCode(o.unitCode, UNIT_PC) : normUnitCode(gi.unit_code, UNIT_CT);
      var hasFactor = o.unitFactor !== undefined && o.unitFactor !== null && String(o.unitFactor).trim() !== '';
      var factor = hasFactor ? Number(o.unitFactor) : _currentUnitFactor(gi.product_id, unitCode, gi.unit_factor);
      if (!(factor > 0)) return { success: false, message: 'รายการที่ ' + n + ': factor ต้องมากกว่า 0' };
      var poItem = poItemById[String(gi.po_item_id)] || null;
      var poUnit = poItem ? normUnitCode(poItem.unit_code, UNIT_CT) : unitCode;
      var poFactor = (unitCode === poUnit) ? factor : _currentUnitFactor(gi.product_id, poUnit, poItem ? poItem.unit_factor : 1);
      plan.push({ gi: gi, poItem: poItem, qty: qty, unitCode: unitCode, factor: factor, poFactor: poFactor, baseQty: _money(qty * factor) });
    }
    var newPlan = [];
    for (var k = 0; k < (payload.newItems || []).length; k++) {
      var ni = payload.newItems[k], p = products[String(ni.productId)];
      if (!p) return { success: false, message: 'รายการเพิ่มที่ ' + (k + 1) + ': ไม่พบสินค้า' };
      var nq = _numOrNull(ni.qty);
      if (nq === null || isNaN(nq) || nq <= 0) return { success: false, message: 'รายการเพิ่มที่ ' + (k + 1) + ' (' + p.name + '): จำนวนต้องมากกว่า 0' };
      var nu = normUnitCode(ni.unitCode, UNIT_CT);
      var nHas = ni.unitFactor !== undefined && ni.unitFactor !== null && String(ni.unitFactor).trim() !== '';
      var nf = nHas ? Number(ni.unitFactor) : _currentUnitFactor(p.record_id, nu, 1);
      if (!(nf > 0)) return { success: false, message: 'รายการเพิ่มที่ ' + (k + 1) + ' (' + p.name + '): factor ต้องมากกว่า 0' };
      var na = _numOrNull(ni.amount); if (na === null) na = 0;
      if (isNaN(na) || na < 0) return { success: false, message: 'รายการเพิ่มที่ ' + (k + 1) + ' (' + p.name + '): ราคาซื้อต้องไม่ติดลบ' };
      newPlan.push({ product: p, qty: nq, unitCode: nu, factor: nf, amount: _money(na), baseQty: _money(nq * nf) });
    }
    var anyQty = plan.some(function(pl) { return !pl.removed && pl.qty > 0; }) || newPlan.length > 0;
    if (!anyQty) return { success: false, message: 'ไม่ได้เลือกรับรายการใดเลย — ถ้าไม่รับทั้งใบให้กด "ถอนใบรับของ" เพื่อนำเข้าใหม่' };

    // ── 2) เขียน: บรรทัดเดิม (แก้/ลบ) · บรรทัดเพิ่ม · ยอด PO ──
    var stockOps = [], auditNotes = [];
    plan.forEach(function(pl) {
      var gi = pl.gi, name = (products[String(gi.product_id)] || {}).name || ('สินค้า ' + gi.product_id);
      if (pl.removed) {
        auditNotes.push('ลบบรรทัด: ' + name + ' (' + gi.qty + ' ' + (gi.unit_code || '') + ')');
        if (gi.po_item_id) deleteRowsWhere(centralSheet('po_items'), 'record_id', gi.po_item_id);
        deleteRowsWhere(centralSheet('gr_items'), 'record_id', gi.record_id);
        return;
      }
      var unitCost = pl.poItem && pl.poFactor > 0 ? _money((Number(pl.poItem.unit_price) || 0) / pl.poFactor) : (Number(gi.unit_cost) || 0);
      centralUpdate('gr_items', gi.record_id, { qty: pl.qty, unit_code: pl.unitCode, unit_factor: pl.factor, base_qty: pl.baseQty, unit_cost: unitCost });
      if (pl.poItem) {
        centralUpdate('po_items', pl.poItem.record_id, { unit_factor: pl.poFactor,
          received_qty: _q4((Number(pl.poItem.received_qty) || 0) + pl.baseQty / pl.poFactor) });
      }
      if (gi.product_id && pl.baseQty > 0) stockOps.push({ productId: String(gi.product_id), baseQty: pl.baseQty, unitCost: unitCost });
    });
    if (newPlan.length) {
      var poItemNext = centralNextId('po_items'), grItemNext = centralNextId('gr_items'), lineNo = poItems.length;
      var newPo = [], newGr = [];
      newPlan.forEach(function(np, i) {
        auditNotes.push('เพิ่มบรรทัด: ' + np.product.name + ' (' + np.qty + ' ' + np.unitCode + ') — ไม่อยู่ในใบกำกับภาษี');
        newPo.push({ record_id: poItemNext + i, po_id: po.record_id, line_no: lineNo + i + 1, pr_item_id: '', product_id: np.product.record_id,
          description: np.product.name + ' (เพิ่มตอนตรวจรับ — ไม่อยู่ในใบกำกับภาษี)', qty: np.qty, unit_code: np.unitCode, unit_factor: np.factor,
          unit_price: np.qty ? _money(np.amount / np.qty) : 0, amount: np.amount, received_qty: np.qty });
        var cost = np.baseQty ? _money(np.amount / np.baseQty) : 0;
        newGr.push({ record_id: grItemNext + i, gr_id: gr.record_id, po_item_id: poItemNext + i, product_id: np.product.record_id,
          qty: np.qty, unit_code: np.unitCode, unit_factor: np.factor, base_qty: np.baseQty, unit_cost: cost, amount: np.amount });
        stockOps.push({ productId: String(np.product.record_id), baseQty: np.baseQty, unitCost: cost });
      });
      centralAppendMany('po_items', newPo);
      centralAppendMany('gr_items', newGr);
    }
    var after = _childrenOf('po_items', 'po_id', po.record_id);
    var subtotal = _money(after.reduce(function(s, it) { return s + (Number(it.amount) || 0); }, 0));

    // ── 3) ส่วนที่เหลือรอรับต่อ → ใบรอตรวจรับใบใหม่ ──
    var remGr = null;
    if (payload.createRemainder !== false) {
      var remLines = after.map(function(it) { return { it: it, rem: _q4((Number(it.qty) || 0) - (Number(it.received_qty) || 0)) }; })
        .filter(function(x) { return x.rem > 1e-9; });
      if (remLines.length) {
        var remId = _freshParentId('goods_receipts', 'gr_items', 'gr_id');
        remGr = { id: remId, no: _nextCentralDocNo('GR', scope), count: remLines.length };
        centralAppend('goods_receipts', { record_id: remId, tenant_id: scope, gr_no: remGr.no, po_id: po.record_id, vendor_id: gr.vendor_id,
          warehouse_id: gr.warehouse_id, receive_date: gr.receive_date, status: 'pending_review', journal_id: '', created_by: String(session.adminUserId || ''),
          created_at: nowStr(), source_ref: gr.source_ref || '',
          note: 'ส่วนที่เหลือจาก ' + gr.gr_no + ' — รอรับต่อ (รับบางส่วนแล้ว)' });
        var remItemId = centralNextId('gr_items');
        centralAppendMany('gr_items', remLines.map(function(x, i) {
          var unit = normUnitCode(x.it.unit_code, UNIT_CT), f = _currentUnitFactor(x.it.product_id, unit, x.it.unit_factor);
          var amt = Number(x.it.qty) ? _money((Number(x.it.amount) || 0) * x.rem / Number(x.it.qty)) : 0;
          return { record_id: remItemId + i, gr_id: remId, po_item_id: x.it.record_id, product_id: x.it.product_id, qty: x.rem, unit_code: unit,
            unit_factor: f, base_qty: _money(x.rem * f), unit_cost: f ? _money((Number(x.it.unit_price) || 0) / f) : 0, amount: amt };
        }));
      }
    }

    stockOps.forEach(function(op) {
      _applyStockIn(scope, gr.warehouse_id, op.productId, op.baseQty, op.unitCost, 'receipt', 'GR', gr.record_id, gr.gr_no, session.adminUserId);
    });

    var done = after.length > 0 && after.every(function(it) { return (Number(it.received_qty) || 0) >= (Number(it.qty) || 0) - 1e-9; });
    var some = after.some(function(it) { return (Number(it.received_qty) || 0) > 0; });
    centralUpdate('purchase_orders', po.record_id, { status: done ? 'received' : (some ? 'partial' : po.status), closed_at: done ? nowStr() : '',
      subtotal_ex_vat: subtotal, total: subtotal });
    var grFields = { status: 'posted' };
    if (payload.receiveDate && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.receiveDate))) grFields.receive_date = String(payload.receiveDate);
    var noteText = payload.note !== undefined ? String(payload.note || '').trim() : String(gr.note || '');
    if (auditNotes.length) noteText += (noteText ? '\n' : '') + auditNotes.join('\n');
    grFields.note = noteText;
    centralUpdate('goods_receipts', gr.record_id, grFields);
    return { success: true, remainderGrNo: remGr ? remGr.no : '', remainderLines: remGr ? remGr.count : 0,
      message: 'ตรวจรับใบ ' + gr.gr_no + ' แล้ว — เข้าสต็อกเรียบร้อย' +
        (remGr ? ' · ส่วนที่เหลือ ' + remGr.count + ' รายการสร้างเป็นใบรอตรวจรับใหม่ ' + remGr.no : '') };
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
    // ใบสั่งซื้อที่มีของรับเข้าไปแล้วบางส่วน (นี่คือใบ "ส่วนที่เหลือรอรับต่อ") ห้ามยกเลิกทั้งใบ — ยกเลิกแค่ใบรับของนี้
    var receivedSome = po && _childrenOf('po_items', 'po_id', po.record_id).some(function(it) { return (Number(it.received_qty) || 0) > 0; });
    if (po && !receivedSome) centralUpdate('purchase_orders', po.record_id, { status: 'cancelled', closed_at: nowStr(), note: String(po.note || '') + '\n' + reason });
    if (receivedSome) return { success: true, message: 'ถอนใบ ' + gr.gr_no + ' แล้ว (ใบสั่งซื้อยังเปิดอยู่เพราะมีของรับเข้าไปแล้วบางส่วน — ส่วนที่เหลือไม่ถูกนำเข้าใหม่อัตโนมัติ)' };
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
