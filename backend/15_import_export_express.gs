/**
 * ===================== เชื่อมโปรแกรม EXPRESS (Export/Import ไฟล์) =====================
 * Phase 1: ไม่เชื่อม API สด — รับ/ส่งเป็นไฟล์ (CSV/Excel) เท่านั้น
 * การ parse ไฟล์ (.xlsx/.csv) ทำฝั่ง client ด้วย SheetJS แบบเดียวกับที่ Hippo Village ใช้
 * (ดู hippo-village-gas-frontend skill — 15_import.gs) แล้วส่งเฉพาะ array ของแถวที่ parse แล้วเข้ามา
 *
 * ── รูปแบบไฟล์จริงที่เจอ (จากโปรแกรมเวนเดอร์ SmartVan BackOffice ที่ export เข้า Express ใน
 *    C:\Smartsales Backoffice - UAT\Export_Express และ \Export) ใช้อ้างอิงตอนสร้าง mapping จริง:
 *   - text คั่นด้วย "|" (pipe), เข้ารหัส ANSI/Thai codepage (TIS-620/Windows-874) ไม่ใช่ UTF-8
 *   - แยกไฟล์ Header/Detail คู่กัน เชื่อมด้วย DocNo: H_invoice+D_invoice, H_order+D_order,
 *     H_receipt+D_receipt1/2, H_transfer+D_transfer, M_customer, M_salesman
 *   - ของแถม: เติม "F" ต่อท้ายรหัสสินค้า (เช่น 625650 → 625650F) + flag IsFree='Y' ราคา/ส่วนลด=0
 *     (ตรงกับ is_free ที่เราออกแบบไว้แล้ว)
 *   - หน่วยขาย: มี UnitCode+UnitFactor แยกจาก Qty เสมอ (เช่น "CT"=ลัง factor 12) — ตรงกับ
 *     product_units ที่เพิ่มใน 00_setup_sheets.gs
 *   - ยังไม่ได้รับการยืนยันจากเวนเดอร์/ทีมบัญชีว่าความหมายทุกคอลัมน์ตรงตาม SCHEMA.INI 100%
 *     (สังเกตจากแพทเทิร์นข้อมูลจริงหลายแถว ความมั่นใจสูงแต่ไม่ใช่ spec ทางการ) ก่อนใช้งานจริง
 *     ควรขอไฟล์ spec ที่เป็นทางการจากฝ่ายบัญชี/เวนเดอร์อีกครั้ง
 *
 * columnMap ตัวอย่าง (ผู้ใช้ปรับได้จาก UI ตอน import): { name:'ชื่อสินค้า', basePrice:'ราคา', unit:'หน่วย' }
 *   แปลว่า: แถวจากไฟล์ Express คอลัมน์ 'ชื่อสินค้า' → field ปลายทาง 'name' ของเรา
 */

/**
 * นำเข้าทะเบียนสินค้า — payload: { rows:[{...}], columnMap?, externalSystem?, createGroups? }
 *
 * ★ จับคู่ด้วย **product_code** เป็นหลัก แล้วค่อย external_code
 *   product_code คือเลขประจำตัวสินค้าที่ unique ทั้งระบบ ถ้าไปจับคู่ด้วย external_code อย่างเดียว
 *   (ซึ่งของเดิมทำ) ไฟล์ที่มีรหัสเดียวกับสินค้าที่มีอยู่แล้วจะกลายเป็นสินค้าใหม่ทั้งหมด
 *   ได้ product_code ซ้ำในระบบแบบเงียบๆ แล้วชุดราคา/บิลจะอ้างผิดตัว
 *
 * ค่าที่ไฟล์ไม่ได้ส่งมาจะไม่ถูกแตะ (อัปเดตเฉพาะช่องที่มีในไฟล์) — นำเข้าซ้ำจึงไม่ล้างของที่คนกรอกเพิ่มไว้
 * groupName: ถ้าส่งมาและยังไม่มีกลุ่มชื่อนี้ จะสร้างกลุ่มสินค้าให้เอง (ปิดด้วย createGroups:false)
 */
function importExpressProducts(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  payload = payload || {};
  var rows = payload.rows || [];
  if (!rows.length) return { success: false, message: 'ไม่มีข้อมูลนำเข้า' };

  var defaults = ['productCode', 'name', 'nameEn', 'basePrice', 'costPrice', 'unit', 'unitCode', 'groupName',
    'taxStatus', 'salesUnitCode', 'purchaseUnitCode', 'barcode', 'cartonBarcode', 'packingText', 'weightKg',
    'reorderPoint', 'isStock', 'isSellable', 'isPurchasable', 'noDiscount', 'isActive', 'note', 'externalCode'];
  var columnMap = payload.columnMap || {};
  defaults.forEach(function(k) { if (!columnMap[k]) columnMap[k] = k; });
  var externalSystem = String(payload.externalSystem || '').trim();
  var createGroups = payload.createGroups !== false;

  var all = centralObjects('products');
  var byCode = {}, byExt = {};
  all.forEach(function(p) {
    var c = String(p.product_code || '').trim();
    if (c) byCode[c.toLowerCase()] = p;
    if (p.external_code) byExt[String(p.external_code)] = p;
  });

  // กลุ่มสินค้า: หาโดยชื่อ (ไม่สนตัวพิมพ์) ไม่มีก็สร้างให้
  var groups = centralObjects('product_groups');
  var groupIdByName = {};
  groups.forEach(function(g) { groupIdByName[String(g.name).trim().toLowerCase()] = g.record_id; });
  var nextGroupId = centralNextId('product_groups');
  var newGroups = [];

  var nextId = centralNextId('products');
  var pending = [], created = 0, updated = 0, skipped = 0, errors = [], groupsAdded = [];

  rows.forEach(function(row, i) {
    var v = {};
    Object.keys(columnMap).forEach(function(field) {
      var src = columnMap[field];
      if (src && row[src] !== undefined && String(row[src]).trim() !== '') v[field] = row[src];
    });
    var name = String(v.name || '').trim();
    var code = String(v.productCode || '').trim();
    if (!name) { skipped++; if (errors.length < 20) errors.push('แถว ' + (i + 1) + ': ไม่มีชื่อสินค้า'); return; }

    var groupId = null;
    if (v.groupName) {
      var key = String(v.groupName).trim().toLowerCase();
      if (groupIdByName[key] === undefined) {
        if (createGroups) {
          groupIdByName[key] = nextGroupId++;
          newGroups.push({ record_id: groupIdByName[key], name: String(v.groupName).trim(), description: 'สร้างจากการนำเข้าไฟล์' });
          groupsAdded.push(String(v.groupName).trim());
        }
      }
      if (groupIdByName[key] !== undefined) groupId = groupIdByName[key];
    }

    var match = (code && byCode[code.toLowerCase()]) || (v.externalCode && byExt[String(v.externalCode)]) || null;

    var f = {};
    if (v.name !== undefined) f.name = name;
    if (v.nameEn !== undefined) f.name_en = String(v.nameEn).trim();
    if (v.basePrice !== undefined) f.base_price = parseFloat(v.basePrice) || 0;
    if (v.costPrice !== undefined) f.cost_price = parseFloat(v.costPrice) || 0;
    if (v.unit !== undefined) f.unit = String(v.unit).trim();
    if (v.unitCode !== undefined) f.unit_code = normUnitCode(v.unitCode, UNIT_PC);
    if (groupId !== null) f.group_id = groupId;
    if (v.taxStatus !== undefined) f.tax_status = (v.taxStatus === 'exempt' || v.taxStatus === 'zero') ? v.taxStatus : '';
    if (v.salesUnitCode !== undefined) f.sales_unit_code = normUnitCode(v.salesUnitCode, UNIT_PC);
    if (v.purchaseUnitCode !== undefined) f.purchase_unit_code = normUnitCode(v.purchaseUnitCode, UNIT_PC);
    if (v.barcode !== undefined) f.barcode = String(v.barcode).trim();
    if (v.cartonBarcode !== undefined) f.carton_barcode = String(v.cartonBarcode).trim();
    if (v.packingText !== undefined) f.packing_text = String(v.packingText).trim();
    if (v.weightKg !== undefined) f.weight_kg = parseFloat(v.weightKg) || 0;
    if (v.reorderPoint !== undefined) f.reorder_point = parseFloat(v.reorderPoint) || 0;
    if (v.isStock !== undefined) f.is_stock = productFlag(v.isStock) ? 'TRUE' : 'FALSE';
    if (v.isSellable !== undefined) f.is_sellable = productFlag(v.isSellable) ? 'TRUE' : 'FALSE';
    if (v.isPurchasable !== undefined) f.is_purchasable = productFlag(v.isPurchasable) ? 'TRUE' : 'FALSE';
    if (v.noDiscount !== undefined) f.no_discount = isNoDiscountProduct({ no_discount: v.noDiscount }) ? 'TRUE' : 'FALSE';
    if (v.isActive !== undefined) f.is_active = productFlag(v.isActive) ? 'TRUE' : 'FALSE';
    if (v.note !== undefined) f.note = String(v.note).trim();
    if (v.externalCode !== undefined) f.external_code = String(v.externalCode).trim();
    if (externalSystem) f.external_system = externalSystem;

    if (match) {
      // รหัสสินค้าของแถวที่มีอยู่แล้ว ไม่แตะ — เปลี่ยนรหัสสินค้าต้องทำผ่านหน้าจอที่มีกฎล็อกเมื่อเคยขายแล้ว
      f.updated_at = nowStr();
      f.updated_by = String(session.adminUserId || '');
      centralUpdate('products', match.record_id, f);
      updated++;
    } else {
      if (!code) { skipped++; if (errors.length < 20) errors.push('แถว ' + (i + 1) + ' (' + name + '): สินค้าใหม่ต้องมีรหัสสินค้า'); return; }
      f.record_id = nextId++;
      f.product_code = code;
      if (f.group_id === undefined) f.group_id = 0;
      if (f.is_active === undefined) f.is_active = 'TRUE';
      if (f.unit === undefined) f.unit = UNIT_LABELS.PC;
      if (f.unit_code === undefined) f.unit_code = UNIT_PC;
      f.created_at = nowStr();
      f.created_by = String(session.adminUserId || '');
      pending.push(f);
      byCode[code.toLowerCase()] = f;   // กันรหัสซ้ำกันเองในไฟล์เดียว
      created++;
    }
  });

  if (newGroups.length) centralAppendMany('product_groups', newGroups);
  if (pending.length) centralAppendMany('products', pending);

  return { success: true, created: created, updated: updated, skipped: skipped, errors: errors,
    groupsAdded: groupsAdded,
    message: 'นำเข้าสินค้า: เพิ่มใหม่ ' + created + ' · อัปเดต ' + updated + ' · ข้าม ' + skipped +
      (groupsAdded.length ? ' · สร้างกลุ่มสินค้าใหม่ ' + groupsAdded.length : '') };
}

function importExpressCustomers(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var rows = payload.rows || [];
  if (!rows.length) return { success: false, message: 'ไม่มีข้อมูลนำเข้า' };
  // columnMap: ชื่อฟิลด์ของเรา → ชื่อคอลัมน์ในไฟล์ต้นทาง · ฟิลด์ที่รองรับ = ทุกคีย์ที่ buildCustomerFields รู้จัก
  // (ค่าตั้งต้นเป็นชื่อเดียวกัน เพื่อให้ไฟล์ที่ส่งมาเป็น camelCase อยู่แล้วนำเข้าได้เลย — ดู .dev/import-customers.js)
  var defaults = ['name','namePrefix','name2','phone','email','contactName','taxId','taxBranchCode','address','postcode',
    'areaCode','salesMode','channelId','groupId','paymentType','paymentTermsDays','creditLimit','status','note',
    'lat','lng','shipToAddress','attributes','lastSaleAt','externalCode','externalSystem'];
  var columnMap = payload.columnMap || {};
  defaults.forEach(function(k) { if (!columnMap[k]) columnMap[k] = k; });
  var externalSystem = String(payload.externalSystem || '').trim();

  var allRows = centralObjects('customers');
  var byExternalCode = {};
  allRows.forEach(function(c) {
    if (String(c.tenant_id) !== String(tenantId)) return;
    if (c.external_code) byExternalCode[String(c.external_code)] = c;
  });
  // ดัชนีรหัสลูกค้าตัวเดียวใช้ทั้งไฟล์ + สะสมแถวใหม่ไว้เขียนทีเดียว (ไฟล์จริงมีสองพันแถว เขียนทีละแถวไม่ทันเวลาของ Apps Script)
  var codeIndex = customerCodeIndex(tenantId, allRows);
  var nextId = centralNextId('customers');
  var pending = [];

  var created = 0, updated = 0, skipped = 0, errors = [];
  rows.forEach(function(row, i) {
    var mapped = {};
    Object.keys(columnMap).forEach(function(field) {
      var src = columnMap[field];
      if (src && row[src] !== undefined && String(row[src]).trim() !== '') mapped[field] = row[src];
    });
    if (!String(mapped.name || '').trim()) { skipped++; return; }
    if (externalSystem && !mapped.externalSystem) mapped.externalSystem = externalSystem;

    var externalCode = String(mapped.externalCode || '').trim();
    var match = externalCode ? byExternalCode[externalCode] : null;
    var built = buildCustomerFields(mapped, { tenantId: tenantId, existing: match, actor: session.adminUserId, codeIndex: codeIndex });
    if (!built.ok) { if (errors.length < 20) errors.push('แถว ' + (i + 1) + ': ' + built.message); skipped++; return; }

    if (match) { centralUpdate('customers', match.record_id, built.fields); updated++; }
    else {
      built.fields.record_id = nextId++;
      pending.push(built.fields);
      if (externalCode) byExternalCode[externalCode] = built.fields;
      created++;
    }
  });
  if (pending.length) centralAppendMany('customers', pending);

  return { success: true, created: created, updated: updated, skipped: skipped, errors: errors,
    message: 'นำเข้าลูกค้า: เพิ่มใหม่ ' + created + ' · อัปเดต ' + updated + ' · ข้าม ' + skipped };
}

/**
 * Export ยอดขาย/สต็อก/รับชำระ เป็นแถวข้อมูล (frontend ค่อยแปลงเป็น CSV/Excel ให้ดาวน์โหลด)
 * TODO: field ปลายทางตอนนี้เป็นชื่อภายในระบบเราก่อน — พอมี spec คอลัมน์ที่ Express ต้องการจริง
 *       ให้ map ชื่อคอลัมน์ตรงนี้ให้ตรง แทนที่จะให้ผู้ใช้ไป map เองทุกครั้ง
 */
function exportExpressSales(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var dateFrom = payload.dateFrom || '0000-00-00';
  var dateTo = payload.dateTo || '9999-99-99';
  var orders = tenantObjects(tenantId, 'sales_orders').filter(function(o) {
    var d = safeDateStr(o.created_at).substring(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  var custName = {};
  centralObjects('customers').forEach(function(c) { custName[String(c.record_id)] = c.name; });

  return { success: true, rows: orders.map(function(o) { return {
    order_code: o.order_code, customer_name: custName[String(o.customer_id)] || '', subtotal: o.subtotal,
    discount: o.discount, total: o.total, payment_method: o.payment_method, status: o.status, created_at: safeDateStr(o.created_at)
  }; }) };
}
