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
function listCustomersAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  var rows = centralObjects('customers');
  var effTenantId = _effectiveTenantId(session, payload || {});
  if (effTenantId) rows = rows.filter(function(c) { return String(c.tenant_id) === String(effTenantId); });
  return { success: true, data: rows };
}

function addCustomerAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
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
  var effTenantId = _effectiveTenantId(session, payload || {});
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

function addProduct(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  centralAppend('products', {
    record_id: centralNextId('products'), name: payload.name, base_price: payload.basePrice || 0,
    unit: payload.unit || 'ชิ้น', group_id: payload.groupId || 0, is_active: 'TRUE',
    external_code: payload.externalCode || '',
    barcode: payload.barcode || '', group_barcode: payload.groupBarcode || '',
    cost_price: payload.costPrice || 0, vat_type: payload.vatType || 'none', image_url: ''
  });
  return { success: true };
}

function updateProduct(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  centralUpdate('products', payload.id, {
    name: payload.name, base_price: payload.basePrice, unit: payload.unit,
    group_id: payload.groupId, is_active: payload.isActive,
    barcode: payload.barcode, group_barcode: payload.groupBarcode,
    cost_price: payload.costPrice, vat_type: payload.vatType
  });
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
  centralUpdate('product_units', payload.id, {
    unit_label: payload.unitLabel, unit_factor: payload.unitFactor, price: payload.price,
    is_active: payload.isActive, barcode: payload.barcode
  });
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
