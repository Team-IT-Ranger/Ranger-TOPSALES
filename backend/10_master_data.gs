/**
 * ===================== MASTER DATA =====================
 * ลูกค้า (customers) เก็บที่ Central Sheet มี tenant_id กำกับว่าเป็นของตัวแทนไหน
 * สินค้า/กลุ่มสินค้า/กลุ่มร้านค้า บริษัทเจ้าของสินค้าคุมจากศูนย์กลาง ใช้ร่วมกันทุกตัวแทน
 */

// ── Mobile App: เพิ่มลูกค้าใหม่หน้างาน ──
function addCustomer(user, payload) {
  if (!payload.name) return { success: false, message: 'กรุณาระบุชื่อลูกค้า' };
  var custId = centralNextId('customers');
  centralAppend('customers', {
    record_id: custId, name: payload.name, tenant_id: user.tenantId, group_id: payload.groupId || 0,
    phone: payload.phone || '', tax_id: payload.taxId || '', address: payload.address || '',
    subdistrict_id: '', district_id: '', province_id: '',
    lat: payload.lat || '', lng: payload.lng || '', is_active: 'TRUE', created_at: nowStr()
  });
  cacheClear('bootstrap', user.lineUserId);
  return { success: true, customerId: custId };
}

// ── Admin App: ลูกค้า (ตัวแทน/Ultra Admin ที่สวมสิทธิ์ จัดการของตัวเอง, บริษัทเห็นทั้งหมด) ──
// ใช้ _salesTenantId() (ไม่ใช่ _effectiveTenantId เฉยๆ) เพราะหน้า "เปิดบิลขาย" (19_sales_admin.gs) เรียกฟังก์ชันนี้
// ตอนบริษัทเจ้าของสินค้าไม่ได้สวมสิทธิ์ตัวแทนไหนอยู่ด้วย — ต้อง fallback ไปที่ตัวแทนบ้านของบริษัทเองได้
function listCustomersAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  var rows = centralObjects('customers');
  var effTenantId = _salesTenantId(session, payload || {});
  if (effTenantId) rows = rows.filter(function(c) { return String(c.tenant_id) === String(effTenantId); });
  return { success: true, data: rows };
}

function addCustomerAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  centralAppend('customers', {
    record_id: centralNextId('customers'), name: payload.name, tenant_id: tenantId, group_id: payload.groupId || 0,
    phone: payload.phone || '', tax_id: payload.taxId || '', address: payload.address || '',
    subdistrict_id: payload.subdistrictId || '', district_id: payload.districtId || '', province_id: payload.provinceId || '',
    lat: payload.lat || '', lng: payload.lng || '', is_active: 'TRUE', created_at: nowStr()
  });
  return { success: true };
}

function updateCustomerAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  centralUpdate('customers', payload.id, {
    name: payload.name, group_id: payload.groupId, phone: payload.phone, tax_id: payload.taxId,
    address: payload.address, lat: payload.lat, lng: payload.lng, is_active: payload.isActive
  });
  return { success: true };
}

// ── Admin App: พนักงานขาย (ตัวแทน/Ultra Admin ที่สวมสิทธิ์ อนุมัติ/ปิดการใช้งานพนักงาน) ──
function listStaffAdmin(session, payload) {
  var err = _requirePermission(session, 'staff', 'view'); if (err) return err;
  var rows = centralObjects('liff_users');
  var effTenantId = _salesTenantId(session, payload || {}); // เหตุผลเดียวกับ listCustomersAdmin ด้านบน
  if (effTenantId) rows = rows.filter(function(u) { return String(u.tenant_id) === String(effTenantId); });
  return { success: true, data: rows.map(function(u) { return {
    lineUserId: u.line_user_id, displayName: u.display_name, role: u.role, tenantId: u.tenant_id,
    status: u.status, lastLogin: safeDateStr(u.last_login)
  }; }) };
}

// payload: { lineUserId, status('Yes'/'No'), role('van_sales'/'credit_sales'), tenantId? }
function updateStaffAdmin(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  var effTenantId = _effectiveTenantId(session, payload);
  var sh = centralSheet('liff_users');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(payload.lineUserId)) {
      if (effTenantId && String(data[i][3]) !== String(effTenantId)) return { success: false, message: 'ไม่มีสิทธิ์แก้ไขพนักงานของตัวแทนอื่น' };
      if (payload.status) sh.getRange(i + 1, 5).setValue(payload.status);
      if (payload.role) sh.getRange(i + 1, 3).setValue(payload.role);
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบผู้ใช้นี้' };
}

// ── Admin App: สินค้า (บริษัทเจ้าของสินค้าเท่านั้น) ──
function listProductsAdmin(session) {
  var err = _requirePermission(session, 'products', 'view'); if (err) return err;
  return { success: true, data: centralObjects('products') };
}

// product_code = รหัสประจำตัวสินค้า ต้อง unique ทั้งระบบ (ไม่สนตัวพิมพ์เล็ก-ใหญ่/ช่องว่างหัวท้าย)
// excludeId: ตอนแก้ไขสินค้าเดิม ไม่ต้องชนกับตัวเอง
function _productCodeTakenBy(code, excludeId) {
  var norm = String(code || '').trim().toLowerCase();
  if (!norm) return null;
  var rows = centralObjects('products');
  for (var i = 0; i < rows.length; i++) {
    if (excludeId !== undefined && excludeId !== null && String(rows[i].record_id) === String(excludeId)) continue;
    if (_productAllCodes(rows[i]).indexOf(norm) !== -1) return rows[i];
  }
  return null;
}

// รหัสทั้งหมดของสินค้า (product_code + alias_codes) เป็นตัวพิมพ์เล็ก — ใช้เช็คซ้ำและจับคู่ตอนนำเข้าใบราคา
function _productAllCodes(p) {
  var codes = [String(p.product_code || '').trim().toLowerCase()];
  String(p.alias_codes || '').split(',').forEach(function(c) { c = c.trim().toLowerCase(); if (c) codes.push(c); });
  return codes.filter(function(c) { return c; });
}

function _productById(id) {
  var rows = centralObjects('products');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].record_id) === String(id)) return rows[i];
  }
  return null;
}

function addProduct(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  var productCode = String(payload.productCode || '').trim();
  if (!productCode) return { success: false, message: 'กรุณากรอกรหัสสินค้า (product_code) — เป็นเลขประจำตัวสินค้า จำเป็นต้องมี' };
  var clash = _productCodeTakenBy(productCode);
  if (clash) return { success: false, message: 'รหัสสินค้า "' + productCode + '" ถูกใช้แล้วโดย "' + clash.name + '"' };

  var recordId = centralNextId('products');
  centralAppend('products', {
    record_id: recordId, product_code: productCode, name: payload.name, base_price: payload.basePrice || 0,
    unit: payload.unit || 'ชิ้น', unit_code: payload.unitCode || 'pcs', group_id: payload.groupId || 0, is_active: 'TRUE',
    external_code: payload.externalCode || '',
    barcode: payload.barcode || '', group_barcode: payload.groupBarcode || '',
    cost_price: payload.costPrice || 0, vat_type: payload.vatType || 'none', image_url: ''
  });
  // ส่ง record_id ที่เพิ่งสร้างกลับไปด้วย — ฝั่ง frontend จะได้แพตช์ cache ในเครื่องได้เลย ไม่ต้องโหลดซ้ำ
  return { success: true, id: recordId };
}

// เซตเฉพาะ key ที่ payload ส่งมาจริง (!== undefined) กัน field อื่นถูกเขียนทับเป็นค่าว่าง
// เวลาเรียกแบบ partial update เช่น toggleProductStatusUI ที่ส่งมาแค่ {id, isActive}
function updateProduct(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  var fields = {};
  if (payload.productCode !== undefined) {
    var productCode = String(payload.productCode || '').trim();
    if (!productCode) return { success: false, message: 'กรุณากรอกรหัสสินค้า (product_code) — เป็นเลขประจำตัวสินค้า จำเป็นต้องมี' };
    var existing = _productById(payload.id);
    var isRealChange = existing && String(existing.product_code || '').trim().toLowerCase() !== productCode.toLowerCase();
    if (isRealChange && existing && String(existing.has_transactions) === 'TRUE') {
      return { success: false, message: 'เปลี่ยนรหัสสินค้าไม่ได้ — มีรายการขายเกิดขึ้นกับรหัส "' + existing.product_code + '" แล้ว (เอกสาร/รายงานเก่าจะอ้างรหัสผิดถ้าเปลี่ยน)' };
    }
    if (isRealChange) {
      var clash = _productCodeTakenBy(productCode, payload.id);
      if (clash) return { success: false, message: 'รหัสสินค้า "' + productCode + '" ถูกใช้แล้วโดย "' + clash.name + '"' };
    }
    fields.product_code = productCode;
  }
  if (payload.name !== undefined) fields.name = payload.name;
  if (payload.basePrice !== undefined) fields.base_price = payload.basePrice;
  // หน่วยฐานว่างไม่ได้ — เว้นว่างแล้วบันทึกต้องกลับไปใช้ default (ไทย=ชิ้น, อังกฤษ=pcs) ไม่ใช่เก็บเป็นค่าว่าง
  if (payload.unit !== undefined) fields.unit = String(payload.unit || '').trim() || 'ชิ้น';
  if (payload.unitCode !== undefined) fields.unit_code = String(payload.unitCode || '').trim() || 'pcs';
  if (payload.groupId !== undefined) fields.group_id = payload.groupId;
  if (payload.isActive !== undefined) fields.is_active = payload.isActive;
  if (payload.barcode !== undefined) fields.barcode = payload.barcode;
  if (payload.groupBarcode !== undefined) fields.group_barcode = payload.groupBarcode;
  if (payload.costPrice !== undefined) fields.cost_price = payload.costPrice;
  if (payload.vatType !== undefined) fields.vat_type = payload.vatType;
  if (payload.externalCode !== undefined) fields.external_code = payload.externalCode;
  if (payload.aliasCodes !== undefined) {
    var aliases = String(payload.aliasCodes || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
    for (var ai = 0; ai < aliases.length; ai++) {
      var aClash = _productCodeTakenBy(aliases[ai], payload.id);
      if (aClash) return { success: false, message: 'รหัส "' + aliases[ai] + '" ถูกใช้แล้วโดย "' + aClash.name + '"' };
    }
    fields.alias_codes = aliases.join(',');
  }
  var found = centralUpdate('products', payload.id, fields);
  if (!found) return { success: false, message: 'ไม่พบสินค้านี้ (id: ' + payload.id + ')' };
  return { success: true };
}

// payload: { productId, base64, mimeType }
function uploadProductImage(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  if (!payload.productId) return { success: false, message: 'กรุณาระบุสินค้า' };
  if (!payload.base64) return { success: false, message: 'ไม่พบไฟล์รูปภาพ' };
  try {
    var bytes = Utilities.base64Decode(payload.base64);
    var blob = Utilities.newBlob(bytes, payload.mimeType || 'image/png', 'product_' + payload.productId + '_' + Date.now());
    var file = DriveApp.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
    centralUpdate('products', payload.productId, { image_url: url });
    return { success: true, imageUrl: url };
  } catch (e) {
    return { success: false, message: 'อัปโหลดไม่สำเร็จ: ' + e.message };
  }
}

// ── Admin App: หน่วยขายเพิ่มเติมของสินค้า (เช่น แพ็ค/ลัง คนละราคา คนละ factor) ──
function listProductUnits(session, payload) {
  var err = _requirePermission(session, 'products', 'view'); if (err) return err;
  var rows = centralObjects('product_units');
  if (payload && payload.productId) rows = rows.filter(function(u) { return String(u.product_id) === String(payload.productId); });
  return { success: true, data: rows };
}

function addProductUnit(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  if (!payload.productId || !payload.unitCode || !payload.unitFactor) return { success: false, message: 'กรุณาระบุสินค้า/รหัสหน่วย/factor ให้ครบ' };
  centralAppend('product_units', {
    record_id: centralNextId('product_units'), product_id: payload.productId, unit_code: payload.unitCode,
    unit_label: payload.unitLabel || payload.unitCode, unit_factor: payload.unitFactor, price: payload.price || 0,
    is_active: 'TRUE', barcode: payload.barcode || ''
  });
  return { success: true };
}

function updateProductUnit(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  var fields = {};
  if (payload.unitLabel !== undefined) fields.unit_label = payload.unitLabel;
  if (payload.unitFactor !== undefined) fields.unit_factor = payload.unitFactor;
  if (payload.price !== undefined) fields.price = payload.price;
  if (payload.isActive !== undefined) fields.is_active = payload.isActive;
  if (payload.barcode !== undefined) fields.barcode = payload.barcode;
  var found = centralUpdate('product_units', payload.id, fields);
  if (!found) return { success: false, message: 'ไม่พบหน่วยขายนี้ (id: ' + payload.id + ')' };
  return { success: true };
}

// ── Admin App: กลุ่มสินค้า / กลุ่มร้านค้า (ข้อมูลอ้างอิงกลาง ใช้กับโปรโมชั่น) ──
function listProductGroups(session) {
  var err = _requirePermission(session, 'products', 'view'); if (err) return err;
  return { success: true, data: centralObjects('product_groups') };
}
function addProductGroup(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  centralAppend('product_groups', { record_id: centralNextId('product_groups'), name: payload.name, description: payload.description || '' });
  return { success: true };
}

// ── Admin App: ข้อมูลกลาง (Ultra Admin ขณะอยู่ในโหมด "บริษัทเจ้าของสินค้า") ──
// กลุ่มลูกค้า / ช่องทางการจัดจำหน่าย / ประเภทการชำระเงิน — ทั้งหมดใช้ร่วมกันทุกตัวแทน
function listCustomerGroups(session) {
  var err = _requirePermission(session, 'settings', 'view'); if (err) return err;
  return { success: true, data: centralObjects('customer_groups') };
}
function addCustomerGroup(session, payload) {
  var err = _requirePermission(session, 'settings', 'edit'); if (err) return err;
  centralAppend('customer_groups', { record_id: centralNextId('customer_groups'), name: payload.name, description: payload.description || '' });
  return { success: true };
}

function listDistributionChannels(session) {
  var err = _requirePermission(session, 'settings', 'view'); if (err) return err;
  return { success: true, data: centralObjects('distribution_channels') };
}
function addDistributionChannel(session, payload) {
  var err = _requirePermission(session, 'settings', 'edit'); if (err) return err;
  if (!payload.name) return { success: false, message: 'กรุณาระบุชื่อช่องทางการจัดจำหน่าย' };
  centralAppend('distribution_channels', { record_id: centralNextId('distribution_channels'), name: payload.name, description: payload.description || '', is_active: 'TRUE' });
  return { success: true };
}

function listPaymentTypes(session) {
  var err = _requirePermission(session, 'settings', 'view'); if (err) return err;
  return { success: true, data: centralObjects('payment_types') };
}
function addPaymentType(session, payload) {
  var err = _requirePermission(session, 'settings', 'edit'); if (err) return err;
  if (!payload.code || !payload.name) return { success: false, message: 'กรุณาระบุรหัสและชื่อประเภทการชำระเงิน' };
  centralAppend('payment_types', { record_id: centralNextId('payment_types'), code: payload.code, name: payload.name, is_active: 'TRUE' });
  return { success: true };
}
