/**
 * ===================== MASTER DATA =====================
 * ลูกค้า (customers) เก็บที่ Central Sheet มี tenant_id กำกับว่าเป็นของตัวแทนไหน
 * สินค้า/กลุ่มสินค้า/กลุ่มร้านค้า บริษัทเจ้าของสินค้าคุมจากศูนย์กลาง ใช้ร่วมกันทุกตัวแทน
 */

// ── Mobile App: เพิ่มลูกค้าใหม่หน้างาน ──
function addCustomer(user, payload) {
  var built = buildCustomerFields(payload, { tenantId: user.tenantId, actor: user.lineUserId });
  if (!built.ok) return { success: false, message: built.message };
  var custId = centralNextId('customers');
  built.fields.record_id = custId;
  centralAppend('customers', built.fields);
  cacheClear('bootstrap', user.lineUserId);
  return { success: true, customerId: custId, customerCode: built.fields.customer_code };
}

// ── Admin App: ลูกค้า (ตัวแทน/Ultra Admin ที่สวมสิทธิ์ จัดการของตัวเอง, บริษัทเห็นทั้งหมด) ──
// ใช้ _salesTenantId() (ไม่ใช่ _effectiveTenantId เฉยๆ) เพราะหน้า "เปิดบิลขาย" (19_sales_admin.gs) เรียกฟังก์ชันนี้
// ตอนบริษัทเจ้าของสินค้าไม่ได้สวมสิทธิ์ตัวแทนไหนอยู่ด้วย — ต้อง fallback ไปที่ตัวแทนบ้านของบริษัทเองได้
function listCustomersAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  var rows = centralObjects('customers');
  var effTenantId = _salesTenantId(session, payload || {});
  if (effTenantId) rows = rows.filter(function(c) { return String(c.tenant_id) === String(effTenantId); });
  // ★ ส่งรูป camelCase ชุดเดียว (28 ก.ย. 2026) — เดิมส่ง `data` (แถวดิบ) ควบมาด้วยอีกชุด
  // เป็นข้อมูลชุดเดียวกันเป๊ะ payload จึงโตเป็นสองเท่าฟรีๆ (2,039 ร้าน = เกือบ 1 MB ที่ไม่มีใครอ่าน)
  // และเป็นสองรูปให้หน้าเว็บสับสนว่าจะอ่านอันไหน — ตัดออกแล้ว ทุกหน้าอ่าน `customers` ทางเดียว
  return { success: true, customers: rows.map(customerToApi) };
}

function addCustomerAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var built = buildCustomerFields(payload, { tenantId: tenantId, actor: session.adminUserId });
  if (!built.ok) return { success: false, message: built.message };
  built.fields.record_id = centralNextId('customers');
  centralAppend('customers', built.fields);
  return { success: true, customerId: built.fields.record_id, customerCode: built.fields.customer_code,
    message: 'เพิ่มลูกค้า ' + built.fields.customer_code + ' แล้ว' };
}

function updateCustomerAdmin(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  var existing = null;
  var tenantId = _salesTenantId(session, payload || {});
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(payload.id)) existing = c; });
  if (!existing) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
  // ตัวแทนแก้ได้เฉพาะลูกค้าของตัวเอง (บริษัทที่ไม่ได้สวมสิทธิ์ตัวแทนไหนอยู่ = ไม่จำกัด)
  if (tenantId && String(existing.tenant_id) !== String(tenantId)) return { success: false, message: 'ลูกค้ารายนี้ไม่ได้อยู่ในตัวแทนจำหน่ายที่เลือก' };
  var built = buildCustomerFields(payload, { existing: existing, tenantId: existing.tenant_id, actor: session.adminUserId });
  if (!built.ok) return { success: false, message: built.message };
  centralUpdate('customers', payload.id, built.fields);
  return { success: true, message: 'บันทึกข้อมูลลูกค้าแล้ว' };
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

// payload: { lineUserId, status('Yes'/'No'), role('van_sales'/'credit_sales'), newTenantId? }
// ★ ใช้ชื่อ "newTenantId" ไม่ใช่ "tenantId" โดยตั้งใจ — payload.tenantId ทั้งระบบมีความหมายอื่นอยู่แล้ว
// ("ตัวแทนที่ Ultra Admin กำลังสวมสิทธิ์ทำงานแทนอยู่" อ่านโดย _effectiveTenantId ด้านล่าง และ callApi
// ฝั่งหน้าเว็บแนบให้อัตโนมัติทุกคำขอเมื่อเลือกตัวแทนไว้บนแถบบน) ถ้าใช้ชื่อเดียวกัน คำขอนี้จะเปลี่ยนพฤติกรรม
// ไม่ได้เมื่อ Ultra Admin กำลังสวมสิทธิ์ตัวแทนอื่นอยู่พอดี (effTenantId จะกลายเป็นค่านั้นโดยไม่ได้ตั้งใจ)
// newTenantId แก้ได้เฉพาะฝั่งบริษัท/Ultra Admin (effTenantId ว่าง) — ใช้แก้กรณีผู้ใช้เลือกสังกัดผิดตอนสมัคร
// (2026-09-29 เจ้าของระบบสั่ง: liff_users เป็นคิวรวมของทุกช่องทางแล้ว สังกัดตั้งต้นมาจากที่ผู้ใช้เลือกเอง
// แก้ให้ถูกได้ทีหลัง) ฝั่งตัวแทนแก้ไม่ได้เหมือนเดิม กันสวมสิทธิ์ย้ายพนักงานข้ามตัวแทนอื่น
function updateStaffAdmin(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  var effTenantId = _effectiveTenantId(session, payload);
  var newTenantId = null;
  if (payload.newTenantId !== undefined) {
    if (effTenantId) return { success: false, message: 'ไม่มีสิทธิ์เปลี่ยนสังกัดของพนักงาน (แก้ได้เฉพาะฝั่งบริษัท)' };
    newTenantId = String(payload.newTenantId || '').trim();
    if (newTenantId && !_activeTenantRow(newTenantId)) return { success: false, message: 'ไม่พบตัวแทนจำหน่ายที่เลือก (หรือถูกปิดการใช้งานอยู่)' };
  }
  var sh = centralSheet('liff_users');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(payload.lineUserId)) {
      if (effTenantId && String(data[i][3]) !== String(effTenantId)) return { success: false, message: 'ไม่มีสิทธิ์แก้ไขพนักงานของตัวแทนอื่น' };
      if (payload.status) sh.getRange(i + 1, 5).setValue(payload.status);
      if (payload.role) sh.getRange(i + 1, 3).setValue(payload.role);
      if (newTenantId !== null) sh.getRange(i + 1, 4).setValue(newTenantId);
      centralInvalidate('liff_users');   // เขียนแบบดิบ ไม่ผ่าน centralUpdate
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

/** ฟิลด์ชุดใหม่ที่รับได้ทั้งตอนเพิ่มและตอนแก้ — คีย์ payload (camelCase) → คอลัมน์ในชีต */
var PRODUCT_EXTRA_FIELDS = {
  nameEn: 'name_en', salesUnitCode: 'sales_unit_code', salesUnitFactor: 'sales_unit_factor',
  purchaseUnitCode: 'purchase_unit_code', purchaseUnitFactor: 'purchase_unit_factor',
  cartonBarcode: 'carton_barcode', packingText: 'packing_text', weightKg: 'weight_kg',
  isStock: 'is_stock', isSellable: 'is_sellable', isPurchasable: 'is_purchasable',
  noDiscount: 'no_discount', reorderPoint: 'reorder_point', note: 'note'
};
var PRODUCT_UNIT_FIELDS = { salesUnitCode: 1, purchaseUnitCode: 1 };
var PRODUCT_BOOL_FIELDS = { isStock: 1, isSellable: 1, isPurchasable: 1, noDiscount: 1 };

function _productExtraFields(payload, forCreate) {
  var out = {};
  Object.keys(PRODUCT_EXTRA_FIELDS).forEach(function(k) {
    if (payload[k] === undefined) { if (forCreate) out[PRODUCT_EXTRA_FIELDS[k]] = ''; return; }
    var v = payload[k];
    if (PRODUCT_UNIT_FIELDS[k]) v = v === '' ? '' : normUnitCode(v, UNIT_PC);       // ทั้งระบบใช้ CT/PK/PC (28_units.gs)
    else if (PRODUCT_BOOL_FIELDS[k]) v = productFlag(v) ? 'TRUE' : 'FALSE';
    out[PRODUCT_EXTRA_FIELDS[k]] = v;
  });
  return out;
}

function addProduct(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  var productCode = String(payload.productCode || '').trim();
  if (!productCode) return { success: false, message: 'กรุณากรอกรหัสสินค้า (product_code) — เป็นเลขประจำตัวสินค้า จำเป็นต้องมี' };
  var clash = _productCodeTakenBy(productCode);
  if (clash) return { success: false, message: 'รหัสสินค้า "' + productCode + '" ถูกใช้แล้วโดย "' + clash.name + '"' };

  var recordId = centralNextId('products');
  centralAppend('products', Object.assign({
    record_id: recordId, product_code: productCode, name: payload.name, base_price: payload.basePrice || 0,
    unit: payload.unit || UNIT_LABELS.PC, unit_code: normUnitCode(payload.unitCode, UNIT_PC), group_id: payload.groupId || 0, is_active: 'TRUE',
    external_code: payload.externalCode || '',
    barcode: payload.barcode || '', group_barcode: payload.groupBarcode || '',
    cost_price: payload.costPrice || 0, vat_type: payload.vatType || 'none', image_url: '',
    tax_status: payload.taxStatus === 'exempt' || payload.taxStatus === 'zero' ? payload.taxStatus : '',
    last_purchase_price: '', last_purchase_date: '',
    created_at: nowStr(), created_by: String(session.adminUserId || ''), updated_at: '', updated_by: ''
  }, _productExtraFields(payload, true)));
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
    if (isRealChange && existing && isFlagOn(existing.has_transactions)) {
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
  if (payload.unit !== undefined) fields.unit = String(payload.unit || '').trim() || UNIT_LABELS.PC;
  if (payload.unitCode !== undefined) fields.unit_code = normUnitCode(payload.unitCode, UNIT_PC);
  if (payload.groupId !== undefined) fields.group_id = payload.groupId;
  if (payload.isActive !== undefined) fields.is_active = payload.isActive;
  if (payload.barcode !== undefined) fields.barcode = payload.barcode;
  if (payload.groupBarcode !== undefined) fields.group_barcode = payload.groupBarcode;
  if (payload.costPrice !== undefined) fields.cost_price = payload.costPrice;
  if (payload.vatType !== undefined) fields.vat_type = payload.vatType;
  // '' = คิด VAT ตามปกติ (ค่าตั้งต้น) — เก็บเฉพาะค่าที่รู้จัก กันพิมพ์อะไรแปลกๆ เข้ามาแล้วภาษีเพี้ยนทั้งระบบ
  if (payload.taxStatus !== undefined) fields.tax_status = (payload.taxStatus === 'exempt' || payload.taxStatus === 'zero') ? payload.taxStatus : '';
  if (payload.externalCode !== undefined) fields.external_code = payload.externalCode;
  Object.assign(fields, _productExtraFields(payload, false));
  fields.updated_at = nowStr();
  fields.updated_by = String(session.adminUserId || '');
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
  var code = normUnitCode(payload.unitCode);   // ทั้งระบบใช้ CT/PK/PC เท่านั้น (28_units.gs)
  centralAppend('product_units', {
    record_id: centralNextId('product_units'), product_id: payload.productId, unit_code: code,
    unit_label: payload.unitLabel || unitLabelOf(code), unit_factor: payload.unitFactor, price: payload.price || 0,
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

/**
 * สินค้าที่ยังไม่มีหน่วยขายเลย → ตั้ง "ลัง" (CT) ให้เป็นค่าเริ่มต้น (เจ้าของระบบสั่ง 27 ก.ย. 2026)
 * สินค้าที่ไม่มีหน่วยขาย สั่งเป็นลังไม่ได้ จึงเข้าเงื่อนไขโปร/ชุดแถมที่นับเป็นลังไม่ได้เลย
 *
 * ★ ขนาดบรรจุไม่มีในข้อมูลไหนเลย — Express ใช้คนละระบบรหัส (800001…) และ packing_text ว่างทั้ง 94 รายการ
 *   จึงตั้ง unit_factor = 1 เป็น "ตัวยึดที่" ไว้ก่อน แล้ว **เขียนคำเตือนลงในชื่อหน่วยเอง**
 *   เพราะถ้าปล่อยเป็น "ลัง" เฉยๆ 1 ลังจะเท่ากับ 1 ชิ้นตลอดไป โดยไม่มีใครรู้จนกว่าสต็อกจะเพี้ยน
 *   ชื่อหน่วยโผล่ทุกที่ที่เลือกหน่วย (หน้าเปิดบิล/ชุดราคา/ชุดแถม) คนจึงเห็นและแก้ได้ทันที
 * รันซ้ำได้: สินค้าที่มีหน่วยขายอยู่แล้วข้าม ไม่ทับของที่ตั้งไว้
 */
var UNIT_FACTOR_UNCONFIRMED = 'ลัง (ยังไม่ยืนยันขนาดบรรจุ)';

function ensureDefaultSalesUnit(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  payload = payload || {};
  var has = {};
  centralObjects('product_units').forEach(function(u) { has[String(u.product_id)] = true; });
  var missing = centralObjects('products').filter(function(p) { return !has[String(p.record_id)]; });
  if (!missing.length) return { success: true, added: 0, message: 'สินค้าทุกตัวมีหน่วยขายแล้ว' };
  if (payload.dryRun) {
    return { success: true, added: 0, wouldAdd: missing.length,
      sample: missing.slice(0, 10).map(function(p) { return { id: p.record_id, code: p.product_code, name: p.name }; }),
      message: 'จะตั้งหน่วย "ลัง" ให้สินค้า ' + missing.length + ' รายการ (ขนาดบรรจุตั้งเป็น 1 ไว้ก่อน ต้องแก้ทีหลัง)' };
  }
  var nextId = centralNextId('product_units');
  centralAppendMany('product_units', missing.map(function(p, i) {
    return { record_id: nextId + i, product_id: p.record_id, unit_code: UNIT_CT,
      unit_label: UNIT_FACTOR_UNCONFIRMED, unit_factor: 1,
      price: Number(p.base_price) || 0, is_active: 'TRUE', barcode: '' };
  }));
  return { success: true, added: missing.length,
    products: missing.map(function(p) { return { id: p.record_id, code: p.product_code, name: p.name }; }),
    message: 'ตั้งหน่วย "ลัง" ให้สินค้า ' + missing.length + ' รายการแล้ว — ' +
      '★ ขนาดบรรจุยังเป็น 1 ลัง = 1 ชิ้น ต้องเข้าไปแก้ให้ตรงของจริง (ชื่อหน่วยเขียนเตือนไว้แล้ว)' };
}

/** สินค้าที่ขนาดบรรจุยังไม่ได้ยืนยัน — ใช้ทำรายการงานที่ต้องตามแก้ */
function listUnconfirmedUnits(session) {
  var err = _requirePermission(session, 'products', 'view'); if (err) return err;
  var pname = {};
  centralObjects('products').forEach(function(p) { pname[String(p.record_id)] = (p.product_code ? p.product_code + ' ' : '') + p.name; });
  var rows = centralObjects('product_units').filter(function(u) {
    return String(u.unit_label || '').indexOf('ยังไม่ยืนยัน') !== -1 || (normUnitCode(u.unit_code, '') === UNIT_CT && Number(u.unit_factor) === 1);
  }).map(function(u) {
    return { id: u.record_id, productId: u.product_id, product: pname[String(u.product_id)] || ('#' + u.product_id),
      unitCode: u.unit_code, unitFactor: Number(u.unit_factor) || 0, unitLabel: u.unit_label || '' };
  });
  return { success: true, data: rows, message: rows.length ? 'มีสินค้า ' + rows.length + ' รายการที่ขนาดบรรจุยังไม่ยืนยัน' : 'ยืนยันขนาดบรรจุครบแล้ว' };
}
