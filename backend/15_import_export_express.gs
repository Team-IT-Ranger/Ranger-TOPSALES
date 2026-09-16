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

function importExpressProducts(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  var rows = payload.rows || [];
  var columnMap = payload.columnMap || { name: 'name', basePrice: 'basePrice', unit: 'unit', externalCode: 'externalCode' };
  if (!rows.length) return { success: false, message: 'ไม่มีข้อมูลนำเข้า' };

  var existing = centralObjects('products');
  var byExternalCode = {};
  existing.forEach(function(p) { if (p.external_code) byExternalCode[String(p.external_code)] = p; });

  var created = 0, updated = 0;
  rows.forEach(function(row) {
    var externalCode = String(row[columnMap.externalCode] || '').trim();
    var name = String(row[columnMap.name] || '').trim();
    var basePrice = parseFloat(row[columnMap.basePrice]) || 0;
    var unit = String(row[columnMap.unit] || 'ชิ้น').trim();
    if (!name) return;

    var match = externalCode ? byExternalCode[externalCode] : null;
    if (match) {
      centralUpdate('products', match.record_id, { name: name, base_price: basePrice, unit: unit });
      updated++;
    } else {
      centralAppend('products', { record_id: centralNextId('products'), name: name, base_price: basePrice, unit: unit, group_id: 0, is_active: 'TRUE', external_code: externalCode });
      created++;
    }
  });

  return { success: true, created: created, updated: updated };
}

function importExpressCustomers(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var rows = payload.rows || [];
  var columnMap = payload.columnMap || { name: 'name', phone: 'phone', taxId: 'taxId', address: 'address', externalCode: 'externalCode' };
  if (!rows.length) return { success: false, message: 'ไม่มีข้อมูลนำเข้า' };

  var existing = centralObjects('customers').filter(function(c) { return String(c.tenant_id) === String(tenantId); });
  var byExternalCode = {};
  existing.forEach(function(c) { if (c.external_code) byExternalCode[String(c.external_code)] = c; });

  var created = 0, updated = 0;
  rows.forEach(function(row) {
    var externalCode = String(row[columnMap.externalCode] || '').trim();
    var name = String(row[columnMap.name] || '').trim();
    if (!name) return;
    var fields = { name: name, phone: String(row[columnMap.phone] || ''), tax_id: String(row[columnMap.taxId] || ''), address: String(row[columnMap.address] || '') };

    var match = externalCode ? byExternalCode[externalCode] : null;
    if (match) { centralUpdate('customers', match.record_id, fields); updated++; }
    else {
      fields.record_id = centralNextId('customers'); fields.tenant_id = tenantId; fields.group_id = 0;
      fields.is_active = 'TRUE'; fields.created_at = nowStr(); fields.external_code = externalCode;
      centralAppend('customers', fields);
      created++;
    }
  });

  return { success: true, created: created, updated: updated };
}

/**
 * Export ยอดขาย/สต็อก/รับชำระ เป็นแถวข้อมูล (frontend ค่อยแปลงเป็น CSV/Excel ให้ดาวน์โหลด)
 * TODO: field ปลายทางตอนนี้เป็นชื่อภายในระบบเราก่อน — พอมี spec คอลัมน์ที่ Express ต้องการจริง
 *       ให้ map ชื่อคอลัมน์ตรงนี้ให้ตรง แทนที่จะให้ผู้ใช้ไป map เองทุกครั้ง
 */
function exportExpressSales(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
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
