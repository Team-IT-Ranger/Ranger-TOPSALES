/**
 * ===================== TENANT ONBOARDING (บริษัทเจ้าของสินค้าเท่านั้น) =====================
 * สร้าง Google Sheet ใหม่ 1 ไฟล์ต่อตัวแทนจำหน่าย 1 ราย พร้อม tab ธุรกรรมทั้งหมด
 * แล้วบันทึก sheet_file_id ไว้ที่ tenants tab (Central Sheet)
 */

var TENANT_SHEET_TABS = {
  // status = สถานะการส่งของ · payment_status = สถานะการเงิน (สองแกนแยกกัน — ดู 34_sales_status.gs)
  //   ส่งของแล้วแต่ยังไม่เก็บเงิน กับ เก็บเงินแล้วแต่ยังไม่ส่ง เป็นคนละเรื่องกัน จะยัดเป็นสถานะเดียวไม่ได้
  // subtotal/discount/total เป็นยอด "รวม VAT แล้ว" (ราคาขายของเราเป็นราคารวมภาษี)
  // vat_rate/subtotal_ex_vat/vat_amount = ยอดแยกภาษี ณ เวลาที่ขาย — เก็บไว้เลยไม่คำนวณย้อนหลัง
  // เพราะอัตราภาษีเปลี่ยนได้ และใบกำกับภาษีที่พิมพ์ไปแล้วต้องตรงกับตัวเลขในระบบตลอดไป
  sales_orders:        ['record_id','order_code','customer_id','subtotal','discount','total','payment_method','fulfillment_type','status','sale_by','lat','lng','map','note','created_at',
    'payment_status','paid_amount','delivered_at','paid_at','updated_at','updated_by',
    'vat_rate','subtotal_ex_vat','vat_amount'],
  // qty/price/line_total เป็น "หน่วยที่ขายจริง" (เช่น ลัง) ตรงกับที่ลูกค้าเห็นบนบิล
  // base_qty คือจำนวนแปลงเป็นหน่วยฐานแล้ว (qty × unit_factor) ใช้ตัดสต็อกและเช็คโปรโมชั่นเท่านั้น
  order_items:         ['record_id','order_id','product_id','unit_code','unit_factor','qty','base_qty','price','line_total','is_free'],
  order_discounts:     ['record_id','order_id','rule_id','rule_name','type','value','free_product_id','free_qty'],
  van_stock:           ['line_user_id','product_id','qty'],
  stock_movements:     ['record_id','line_user_id','product_id','change_qty','type','ref_id','created_at'],
  stock_counts:        ['record_id','line_user_id','product_id','system_qty','counted_qty','diff_qty','created_at'],
  visits:              ['record_id','customer_id','line_user_id','check_in_at','lat','lng','has_order'],
  visit_notes:         ['record_id','visit_id','note','created_at'],
  competitor_logs:     ['record_id','visit_id','customer_id','brand','product','price','created_at'],
  // ประวัติการเปลี่ยนสถานะบิลขาย — ไม่ลบ ไม่ทับ (หลักเดียวกับ pr_approvals ของงานซื้อ) ใช้สอบกลับว่าใครเปลี่ยนอะไรเมื่อไหร่
  order_status_log:    ['record_id','order_id','from_status','to_status','from_payment','to_payment','note','changed_by','changed_at'],
  doc_number_series:   ['record_id','doc_type','prefix','date_format','running_digits','reset_cycle','separator','is_active'],
  doc_number_counters: ['doc_type','period_key','last_number']
};

/**
 * เติม tab/คอลัมน์ที่ขาดให้ไฟล์ของตัวแทนที่สร้างไว้ก่อนสคีมาเปลี่ยน (คู่กับ ensureSchemaCurrent ของชีตกลาง)
 * ไฟล์ตัวแทนไม่ได้อยู่ในชีตเดียวกับสคีมากลาง จึงต้องมีตัวไล่ให้เองแบบนี้
 * เปิดไฟล์ตัวแทน 1 ครั้ง ≈ 1.5 วินาที → กันด้วยลายนิ้วมือใน CacheService ตรวจจริงอย่างมาก 6 ชม./ตัวแทน
 */
function ensureTenantSheetsCurrent(tenantId) {
  if (!tenantId) return;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(TENANT_SHEET_TABS));
  var fp = digest.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('').substring(0, 12);
  var cache = CacheService.getScriptCache();
  var key = 'tenantschema_' + tenantId + '_' + fp;
  if (cache.get(key)) return;
  try {
    // ต้องใช้ handle เดียวกับ _getSheetByFileId (มี _ssCache ต่อคำขอ) ไม่งั้นคำขอเดียวกันอาจยังมองไม่เห็น tab ที่เพิ่งสร้าง
    var ss = _openSpreadsheet(tenantFileId(tenantId));
    Object.keys(TENANT_SHEET_TABS).forEach(function(tabName) {
      var headers = TENANT_SHEET_TABS[tabName];
      var sh = ss.getSheetByName(tabName);
      if (!sh) {
        sh = ss.insertSheet(tabName);
        sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0B7B52').setFontColor('#ffffff');
        sh.setFrozenRows(1);
        return;
      }
      var lastCol = sh.getLastColumn();
      var current = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      var missing = headers.filter(function(h) { return current.indexOf(h) === -1; });
      if (missing.length) {
        sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing])
          .setFontWeight('bold').setBackground('#0B7B52').setFontColor('#ffffff');
      }
    });
    SpreadsheetApp.flush();
    cache.put(key, '1', 21600);
  } catch (e) {
    Logger.log('ensureTenantSheetsCurrent(' + tenantId + '): ' + e);   // ล้มแล้วไม่ทำให้คำขอพัง จะลองใหม่ครั้งหน้า
  }
}

/** super_admin กดเองเมื่ออยากให้ไฟล์ตัวแทนทุกรายตามสคีมาล่าสุดทันที ไม่ต้องรอแคชหมดอายุ */
function syncTenantSheets(session) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  var cache = CacheService.getScriptCache();
  var done = [];
  centralObjects('tenants').forEach(function(t) {
    if (!t.sheet_file_id) return;
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(TENANT_SHEET_TABS));
    var fp = digest.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('').substring(0, 12);
    cache.remove('tenantschema_' + t.tenant_id + '_' + fp);
    ensureTenantSheetsCurrent(t.tenant_id);
    done.push(t.tenant_id);
  });
  return { success: true, tenants: done, message: 'ปรับสคีมาไฟล์ตัวแทน ' + done.length + ' ราย: ' + done.join(', ') };
}

function _buildTenantSpreadsheet(tenantId, tenantName) {
  var newSS = SpreadsheetApp.create('Ranger-TOPSALES-' + tenantId);   // ไฟล์เก่าที่สร้างก่อนเปลี่ยนชื่อแอปยังใช้ชื่อ salesranger-TOPSHOP-*
  var fileId = newSS.getId();

  Object.keys(TENANT_SHEET_TABS).forEach(function(tabName) {
    var headers = TENANT_SHEET_TABS[tabName];
    var sh = newSS.insertSheet(tabName);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#0B7B52').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, headers.length, 140);
  });

  var defaultSheet = newSS.getSheetByName('Sheet1') || newSS.getSheetByName('แผ่น1');
  if (defaultSheet) newSS.deleteSheet(defaultSheet);

  // seed เลขเอกสารเริ่มต้น (SO) — ตัวแทนแก้ปรับรูปแบบเองได้ทีหลังผ่าน Admin App
  var docSh = newSS.getSheetByName('doc_number_series');
  docSh.appendRow([1, 'SO', 'SO', 'yyyyMMdd', 4, 'daily', '-', 'TRUE']);

  SpreadsheetApp.flush();
  // เก็บไฟล์เข้าโฟลเดอร์ของตัวแทนรายนี้ทันทีตั้งแต่สร้าง (db_<env>/<รหัสตัวแทน> — ดู 24_drive_layout.gs)
  // ย้ายไม่สำเร็จก็ไม่ทำให้การสร้างตัวแทนพัง (ไฟล์ยังใช้งานได้ปกติ แค่ค้างอยู่ My Drive — สั่ง organizeDatabaseFiles ทีหลังได้)
  try { _moveFileTo(fileId, _dbTenantFolder(tenantId)); } catch (e) { Logger.log('ย้ายไฟล์ตัวแทนเข้าโฟลเดอร์ไม่สำเร็จ: ' + e.message); }
  return fileId;
}

// เรียกจาก Admin App โดย super_admin/owner_admin เท่านั้น
function createTenant(session, payload) {
  var err = _requirePermission(session, 'tenants', 'edit'); if (err) return err;
  if (!payload.tenantId || !payload.name) return { success: false, message: 'กรุณาระบุรหัสและชื่อตัวแทน' };

  var existing = centralObjects('tenants');
  if (existing.some(function(t) { return String(t.tenant_id) === String(payload.tenantId); })) {
    return { success: false, message: 'มีรหัสตัวแทนนี้อยู่แล้ว: ' + payload.tenantId };
  }

  var fileId = _buildTenantSpreadsheet(payload.tenantId, payload.name);
  centralAppend('tenants', {
    tenant_id: payload.tenantId, name: payload.name, sheet_file_id: fileId,
    region: payload.region || '', is_active: 'TRUE', created_at: nowStr()
  });

  return { success: true, tenantId: payload.tenantId, sheetFileId: fileId, sheetUrl: 'https://docs.google.com/spreadsheets/d/' + fileId };
}

// ===================== ตัวแทน "บ้าน" ของบริษัทเจ้าของสินค้าเอง =====================
// โมเดลธุรกิจ: ขายส่วนหนึ่งผ่านตัวแทนจำหน่าย อีกส่วนบริษัทมีพนักงานขายตรงเอง ยอดเข้าบริษัทเอง
// ไม่ต้องให้ owner_admin ไปเลือกตัวแทนจำหน่ายรายไหนก่อน — ใช้ tenant พิเศษนี้แทนโดยอัตโนมัติ (ดู _salesTenantId ใน 14_permissions.gs)
// สร้าง Google Sheet ของตัวเองเหมือนตัวแทนทั่วไปทุกอย่าง (sales_orders/van_stock/customers ฯลฯ) เพียงแต่ auto-create ครั้งแรกที่ใช้งาน
var HOUSE_TENANT_ID = 'HOUSE';
function _ensureHouseTenant() {
  var rows = centralObjects('tenants');
  for (var i = 0; i < rows.length; i++) {
    if (_isTrue(rows[i].is_house) || String(rows[i].tenant_id) === HOUSE_TENANT_ID) return rows[i].tenant_id;
  }
  var lock = LockService.getScriptLock();
  lock.tryLock(20000);
  try {
    rows = centralObjects('tenants'); // เช็คซ้ำหลังได้ lock กันสร้างซ้อนถ้ามีสองคำขอพร้อมกัน
    for (var j = 0; j < rows.length; j++) {
      if (_isTrue(rows[j].is_house) || String(rows[j].tenant_id) === HOUSE_TENANT_ID) return rows[j].tenant_id;
    }
    var fileId = _buildTenantSpreadsheet(HOUSE_TENANT_ID, 'บริษัทเจ้าของสินค้า (ขายตรง)');
    centralAppend('tenants', {
      tenant_id: HOUSE_TENANT_ID, name: 'บริษัทเจ้าของสินค้า (ขายตรง)', sheet_file_id: fileId,
      region: '', is_active: 'TRUE', created_at: nowStr(), is_house: 'TRUE'
    });
    return HOUSE_TENANT_ID;
  } finally { lock.releaseLock(); }
}

function listTenants(session) {
  var err = _requirePermission(session, 'tenants', 'view'); if (err) return err;
  return { success: true, data: centralObjects('tenants').map(function(t) {
    return {
      tenantId: t.tenant_id, name: t.name, region: t.region, isActive: isFlagOn(t.is_active), isHouse: isFlagOn(t.is_house),
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + t.sheet_file_id,
      address: t.address || '', taxId: t.tax_id || '', branchCode: t.branch_code || '',
      phone: t.phone || '', email: t.email || '', logoUrl: t.logo_url || ''
    };
  }) };
}

/**
 * ===================== ข้อมูลบริษัทของตัวแทน (Company Profile) =====================
 * ตัวแทนแก้ข้อมูลของตัวเองได้ (module 'tenants' scope เดียวกับที่ตัวแทนมองเห็นตัวเอง)
 * บริษัทเจ้าของสินค้า (ไม่มี session.tenant_id) ต้องระบุ payload.tenantId ว่าจะดู/แก้ของใคร
 */
function getTenantProfile(session, payload) {
  var err = _requirePermission(session, 'tenants', 'view'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var rows = centralObjects('tenants');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tenant_id) === String(tenantId)) {
      var t = rows[i];
      return { success: true, data: {
        tenantId: t.tenant_id, name: t.name, region: t.region,
        address: t.address || '', taxId: t.tax_id || '', branchCode: t.branch_code || '',
        phone: t.phone || '', email: t.email || '', logoUrl: t.logo_url || '',
        bankName: t.bank_name || '', bankAccountNo: t.bank_account_no || '', bankAccountName: t.bank_account_name || ''
      } };
    }
  }
  return { success: false, message: 'ไม่พบตัวแทนนี้' };
}

function updateTenantProfile(session, payload) {
  var err = _requirePermission(session, 'tenants', 'edit'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var rows = centralObjects('tenants');
  var sh = centralSheet('tenants');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tenant_id) === String(tenantId)) {
      var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      var rowNum = i + 2;
      var fields = {
        name: payload.name, region: payload.region, address: payload.address, tax_id: payload.taxId,
        branch_code: payload.branchCode, phone: payload.phone, email: payload.email,
        bank_name: payload.bankName, bank_account_no: payload.bankAccountNo, bank_account_name: payload.bankAccountName
      };
      Object.keys(fields).forEach(function(key) {
        if (fields[key] === undefined) return;
        var col = headers.indexOf(key);
        if (col !== -1) sh.getRange(rowNum, col + 1).setValue(fields[key]);
      });
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบตัวแทนนี้' };
}

// อัปโหลดโลโก้บริษัท — เก็บเป็นไฟล์จริงบน Drive (โฟลเดอร์เดียวกับ Tenant Sheet) แล้วบันทึก URL ไว้
// payload: { tenantId?, base64, mimeType, fileName }  base64 ไม่ต้องมี prefix "data:...;base64,"
function uploadTenantLogo(session, payload) {
  var err = _requirePermission(session, 'tenants', 'edit'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  if (!payload.base64) return { success: false, message: 'ไม่พบไฟล์รูปภาพ' };

  try {
    var bytes = Utilities.base64Decode(payload.base64);
    var blob = Utilities.newBlob(bytes, payload.mimeType || 'image/png', 'logo_' + tenantId + '_' + Date.now());
    var file = DriveApp.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();

    var rows = centralObjects('tenants');
    var sh = centralSheet('tenants');
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].tenant_id) === String(tenantId)) {
        var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        sh.getRange(i + 2, headers.indexOf('logo_url') + 1).setValue(url);
        return { success: true, logoUrl: url };
      }
    }
    return { success: false, message: 'ไม่พบตัวแทนนี้' };
  } catch (e) {
    return { success: false, message: 'อัปโหลดไม่สำเร็จ: ' + e.message };
  }
}

function updateTenantStatus(session, payload) {
  var err = _requirePermission(session, 'tenants', 'edit'); if (err) return err;
  var rows = centralObjects('tenants');
  var sh = centralSheet('tenants');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tenant_id) === String(payload.tenantId)) {
      sh.getRange(i + 2, 5).setValue(payload.isActive ? 'TRUE' : 'FALSE'); // col 5 = is_active
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบตัวแทนนี้' };
}
