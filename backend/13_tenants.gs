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
    /* วันนัดส่งโดยประมาณ (1 ต.ค. 2026) — พนักงานกรอกตอนเปิดใบนัดส่ง แล้วพิมพ์ลงใบที่ลูกค้าถือไว้เป็นหลักฐาน
       เป็น "ประมาณการที่ตกลงกับลูกค้า" คนละช่องกับ `delivered_at` ซึ่งคือวันที่ส่งจริง */
    'requested_delivery_date',
    /* เลขที่ใบส่งสินค้า — ออกตอนเข้าสถานะ "พร้อมจัดส่ง" (6 ต.ค. 2026)
       แยกจาก order_code เพราะใบส่งของเป็นคนละเอกสารกับใบสั่งขาย และแอดมินต้องอ้างเลขนี้กับคนขับ/ลูกค้า
       ★ ออกครั้งเดียวต่อใบ — ถอยสถานะกลับแล้วเดินหน้าใหม่ต้องได้เลขเดิม ไม่ใช่เลขใหม่ */
    'delivery_order_no', 'delivery_order_at',
    'picking_no', 'picking_at', 'receipt_no', 'receipt_at', 'tax_invoice_no', 'tax_invoice_at',
    // ธง "ศูนย์แก้ไขรายการในใบนี้แล้ว" (3 ต.ค. 2026 — editSalesOrderAdmin, 34_sales_status.gs) ให้มือถือบอกพนักงาน
    'center_edited_at', 'center_edited_by',
    // ภาพนิ่งภาษี ณ วันที่ออกบิล — ห้ามคำนวณใหม่ตอนเปิดดู ไม่งั้นวันที่อัตราภาษีเปลี่ยน ใบเก่าทั้งหมดขยับตาม
    // และงบที่ปิดไปแล้วจะเคลื่อน · apply_vat: ใบนี้คิด VAT ไหม · vat_type: inclusive/exclusive ณ ตอนออก
    'apply_vat','vat_type','vat_rate','subtotal_ex_vat','vat_amount','exempt_amount'],
  // qty/price/line_total เป็น "หน่วยที่ขายจริง" (เช่น ลัง) ตรงกับที่ลูกค้าเห็นบนบิล
  // base_qty คือจำนวนแปลงเป็นหน่วยฐานแล้ว (qty × unit_factor) ใช้ตัดสต็อกและเช็คโปรโมชั่นเท่านั้น
  // tax_status = สถานะภาษีของสินค้า "ณ ตอนขาย" — ถ่ายภาพเก็บไว้ ไม่อ่านจากทะเบียนสินค้าตอนแสดงผล
  //   วันที่สินค้าเปลี่ยนสถานะภาษี ใบเก่าต้องไม่เปลี่ยนตาม (หลักเดียวกับราคาที่เก็บลงบรรทัด)
  // unit_discount/line_discount เพิ่ม 2026-09-30 — ส่วนลดต่อบรรทัด (เจ้าของระบบสั่ง) มาจาก _allocateLineDiscount
  // (18_pricing_engine.gs) บันทึกเป็นภาพนิ่งตอนขายเหมือนภาษี ไม่คำนวณใหม่ตอนเปิดดูย้อนหลัง — บิลเก่าก่อนมีคอลัมน์นี้
  // อ่านได้ว่าง (''), หน้าจอต้องอ่านเป็น 0 เอง (ดู getSaleDetail/getSalesOrderAdmin)
  // list_price_ex_vat เพิ่ม 2026-09-30 (2) — ราคาตั้งต้น (ก่อนภาษี) ของ "ขั้นราคา" ที่ขายจริง ก๊อบมาจาก
  // price_list_items.list_price_ex_vat ตอนขาย (ภาพนิ่งเช่นกัน) ใช้คำนวณส่วนลดขั้นบันไดต่อบรรทัดตอนเปิดดูย้อนหลัง
  // (ดู _lineListBreakdown, 18_pricing_engine.gs) ว่าง = ไม่มีราคาตั้งอ้างอิง (บิลจากเส้นทางโปรโมชั่นเดิม ไม่มีชุดราคา)
  order_items:         ['record_id','order_id','product_id','unit_code','unit_factor','qty','base_qty','price','line_total','unit_discount','line_discount','list_price_ex_vat','is_free','tax_status'],
  order_discounts:     ['record_id','order_id','rule_id','rule_name','type','value','free_product_id','free_qty'],
  van_stock:           ['line_user_id','product_id','qty'],
  stock_movements:     ['record_id','line_user_id','product_id','change_qty','type','ref_id','created_at'],
  stock_counts:        ['record_id','line_user_id','product_id','system_qty','counted_qty','diff_qty','created_at'],
  visits:              ['record_id','customer_id','line_user_id','check_in_at','lat','lng','has_order'],
  visit_notes:         ['record_id','visit_id','note','created_at'],
  competitor_logs:     ['record_id','visit_id','customer_id','brand','product','price','created_at'],
  // ประวัติการเปลี่ยนสถานะบิลขาย — ไม่ลบ ไม่ทับ (หลักเดียวกับ pr_approvals ของงานซื้อ) ใช้สอบกลับว่าใครเปลี่ยนอะไรเมื่อไหร่
  // changed_by/changed_by_role เก็บ "ชื่อและตำแหน่ง ณ เวลานั้น" ตรงๆ ในแถว (guide ข้อ 1.6) ไม่ใช่แค่รหัสอ้างอิง
  // เพราะคนเปลี่ยนชื่อได้ ย้ายแผนกได้ ลาออกได้ — หลักฐานประวัติต้องคงสภาพเดิมแม้ข้อมูลปัจจุบันของคนนั้นเปลี่ยนไปแล้ว
  order_status_log:    ['record_id','order_id','from_status','to_status','from_payment','to_payment','note','changed_by','changed_by_role','changed_at'],
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
/* ★ รหัสบริษัทเจ้าของสินค้า = 'TNKI' (เจ้าของระบบสั่ง 30 ก.ย. 2026 — เดิมเป็น 'HOUSE')
   รหัสเดียวทำสองหน้าที่โดยตั้งใจ:
     1) **สังกัด** ของพนักงาน/แอดมินฝั่งบริษัท — คู่ขนานกับ 'BDC' ของตัวแทน (เดิมฝั่งบริษัทเก็บเป็นค่าว่าง
        ซึ่งบนหน้าจอดูเหมือน "ไม่มีสังกัด" ทั้งที่จริงคือสังกัดบริษัท)
     2) **สมุดขายตรง** ของบริษัท (บทบาทเดิมของ HOUSE) — ยอดขายที่ไม่ผ่านตัวแทนลงเล่มนี้
   ★ ห้ามลืม: คนที่สังกัด TNKI ต้องยัง "มองข้ามตัวแทนได้" เหมือนเดิม — _effectiveTenantId() ใน
     14_permissions.gs จึงแปลง TNKI กลับเป็น null ไม่งั้นแอดมินบริษัทจะถูกหุบให้เหลือแค่ข้อมูลของ TNKI
   ★ TNKI เป็นชื่อเดียวกับโฟลเดอร์ข้อมูลบริษัทบนไดรฟ์อยู่แล้ว (OWNER_FOLDER_NAME ใน 24_drive_layout.gs) */
var HOUSE_TENANT_ID = OWNER_TENANT_ID;   // ค่าจริงอยู่ที่ 02_helpers.gs — ชื่อเดิมยังมีที่อื่นเรียกอยู่
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

/* ย้ายรหัสตัวแทนบ้านจาก 'HOUSE' เป็น 'TNKI' ทั้งระบบ — รันซ้ำได้ ไม่มีผลถ้าไม่มีอะไรเหลือให้ย้าย
   ★ ลำดับสำคัญ: **deploy โค้ดใหม่ก่อน แล้วค่อยรัน** (บทเรียนเดียวกับ migrateUnitCodes ใน CLAUDE.md)
     ถ้าแปลงข้อมูลก่อนที่โค้ดจะรู้จัก TNKI ระบบจะหาสมุดขายตรงไม่เจอและเปิดบิลขายตรงไม่ได้ทันที */
function migrateOwnerTenantCode(session) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  var OLD = 'HOUSE', NEW = OWNER_TENANT_ID;
  if (OLD === NEW) return { success: false, message: 'รหัสเดิมกับรหัสใหม่เป็นค่าเดียวกัน ไม่ต้องย้าย' };
  var report = [], total = 0;

  Object.keys(CENTRAL_SHEETS).forEach(function(name) {
    if (CENTRAL_SHEETS[name].indexOf('tenant_id') === -1) return;
    var sh;
    try { sh = centralSheet(name); } catch (e) { return; }   // ชีตยังไม่ถูกสร้าง = ไม่มีอะไรให้ย้าย
    // updateColumnsWhere คืน {matched, changed, columns} ไม่ใช่ตัวเลข — และล้างแคชให้เองอยู่แล้ว
    // .matched = จำนวนแถวที่เข้าเงื่อนไข (.changed นับ "คอลัมน์" ไม่ใช่แถว — รายงานเป็นจำนวนคนจะต่ำกว่าจริง)
    var n = updateColumnsWhere(sh, function(row) { return String(row.tenant_id) === OLD; }, { tenant_id: NEW });
    if (n.matched) { report.push(name + ': ' + n.matched); total += n.matched; }
  });

  // ตัวนับเลขที่เอกสารคีย์เป็น 'PO@HOUSE' ฯลฯ — ไม่ย้ายด้วยแล้วเล่มใหม่จะเริ่มนับหนึ่งใหม่ทับเลขเดิม
  try {
    var cs = centralSheet('central_doc_counters');
    // ค่าใน setObj เป็นฟังก์ชันได้ (รับ row) — ใช้คิดค่าใหม่รายแถวโดยไม่ต้องวนเขียนเอง
    var m = updateColumnsWhere(cs,
      function(row) { return String(row.doc_type).indexOf('@' + OLD) !== -1; },
      { doc_type: function(row) { return String(row.doc_type).replace('@' + OLD, '@' + NEW); } });
    if (m.matched) { report.push('central_doc_counters: ' + m.matched); total += m.matched; }
  } catch (e) { /* ยังไม่มีตัวนับ = ยังไม่เคยออกเลขเอกสาร */ }

  return { success: true, moved: total,
    message: total ? ('ย้าย ' + OLD + ' → ' + NEW + ' แล้ว ' + total + ' แถว (' + report.join(' · ') + ')')
                   : ('ไม่มีแถวไหนใช้รหัส ' + OLD + ' อยู่แล้ว — ระบบใช้ ' + NEW + ' อยู่แล้วทั้งหมด') };
}

/* ═══════════ ลบตัวแทนทดสอบที่สคริปต์ e2e ทิ้งไว้ (เจ้าของระบบสั่ง 30 ก.ย. 2026) ═══════════
   `.dev/uat-*-e2e.js` สร้างตัวแทนชื่อ "ตัวแทนทดสอบราคา" รหัส UATP… ทิ้งไว้ทุกครั้งที่รัน
   สะสมจนรกหน้าจอจ่ายชุดราคาและกล่องเลือกตัวแทน · ลบเองไม่ได้เพราะไฟล์ถูกสร้างโดยบัญชีที่รันสคริปต์

   ★ ลบแล้วเอาคืนไม่ได้ จึงกันสามชั้นแบบเดียวกับ applyCustomerBulkAssign:
     1) super_admin เท่านั้น
     2) เข้าเกณฑ์ "ของทดสอบ" จริงเท่านั้น — และต้อง **ปิดใช้งานอยู่แล้ว** ด้วย
        (ตัวแทนที่ยังเปิดใช้งาน = มีคนใช้อยู่ ไม่ว่าชื่อจะเป็นอะไร) · ตัวแทนบ้านห้ามแตะเด็ดขาด
     3) ต้องส่ง confirmCount ที่หน้าจอแสดงไว้ ไม่ตรงกับที่นับได้จริง = ปฏิเสธ
   ★ **ไม่ลบไฟล์ Google Sheet ของตัวแทนทิ้ง** — ลบไฟล์เอาคืนยากกว่าลบแถวมาก และไม่ใช่สิ่งที่จำเป็น
     ต้องทำเพื่อให้หน้าจอสะอาด · คืน URL กลับไปให้เจ้าของระบบไปลบเองใน Drive ถ้าต้องการ */
var TEST_TENANT_PREFIX = 'UATP';

function _testTenantRows() {
  return centralObjects('tenants').filter(function(t) {
    if (isFlagOn(t.is_house)) return false;                 // ตัวแทนบ้านของบริษัท ห้ามแตะ
    if (isNotOff(t.is_active)) return false;                // ยังเปิดใช้งานอยู่ = มีคนใช้ ไม่ใช่ของทดสอบทิ้ง
    var id = String(t.tenant_id || ''), nm = String(t.name || '');
    return id.indexOf(TEST_TENANT_PREFIX) === 0 || nm.indexOf('ทดสอบ') !== -1;
  });
}

/** ดูก่อนลบ — บอกว่าจะลบตัวแทนไหนบ้าง และมีข้อมูลพ่วงกี่แถว */
function previewTestTenantCleanup(session) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  var rows = _testTenantRows();
  var ids = {}; rows.forEach(function(t) { ids[String(t.tenant_id)] = true; });
  var related = {};
  Object.keys(CENTRAL_SHEETS).forEach(function(name) {
    if (name === 'tenants' || CENTRAL_SHEETS[name].indexOf('tenant_id') === -1) return;
    var n = 0;
    try { centralObjects(name).forEach(function(r) { if (ids[String(r.tenant_id)]) n++; }); } catch (e) { return; }
    if (n) related[name] = n;
  });
  return { success: true, count: rows.length,
    tenants: rows.map(function(t) {
      return { tenantId: t.tenant_id, name: t.name,
        sheetUrl: t.sheet_file_id ? ('https://docs.google.com/spreadsheets/d/' + t.sheet_file_id) : '' };
    }),
    related: related };
}

/** ลบจริง — ต้องส่ง confirmCount ให้ตรงกับที่ previewTestTenantCleanup นับได้ */
function deleteTestTenants(session, payload) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  payload = payload || {};
  var rows = _testTenantRows();
  if (!rows.length) return { success: false, message: 'ไม่มีตัวแทนทดสอบที่เข้าเกณฑ์ให้ลบ' };
  if (Number(payload.confirmCount) !== rows.length) {
    return { success: false, message: 'จำนวนไม่ตรงกับที่แสดงไว้ (' + payload.confirmCount + ' vs ' + rows.length +
      ') — กดดูรายการใหม่อีกครั้งก่อนยืนยัน' };
  }
  var ids = rows.map(function(t) { return String(t.tenant_id); });
  var deleted = {}, files = [];
  rows.forEach(function(t) { if (t.sheet_file_id) files.push('https://docs.google.com/spreadsheets/d/' + t.sheet_file_id); });

  Object.keys(CENTRAL_SHEETS).forEach(function(name) {
    if (CENTRAL_SHEETS[name].indexOf('tenant_id') === -1) return;
    var sh;
    try { sh = centralSheet(name); } catch (e) { return; }
    var n = 0;
    ids.forEach(function(id) { n += deleteRowsWhere(sh, 'tenant_id', id); });
    if (n) deleted[name] = n;
    centralInvalidate(name);
  });

  return { success: true, removedTenants: ids.length, deleted: deleted, sheetFiles: files,
    message: 'ลบตัวแทนทดสอบ ' + ids.length + ' ราย (' + ids.join(', ') + ') พร้อมข้อมูลพ่วง ' +
      Object.keys(deleted).map(function(k) { return k + ' ' + deleted[k]; }).join(' · ') +
      ' — ไฟล์ Google Sheet ของตัวแทนเหล่านี้ยังอยู่บน Drive ลบเองได้ถ้าต้องการ' };
}

/* ═══ เติมสังกัดให้ครบทุกคน (กติกาเจ้าของระบบ 30 ก.ย. 2026) ═══
   "พนักงานทุกคนต้องมีสังกัดของตนเอง — พนักงานบริษัทสังกัด TNKI พนักงานตัวแทนสังกัดตัวแทนของตน"
   ของเดิมฝั่งบริษัทเก็บเป็น **ค่าว่าง** ซึ่งอ่านบนหน้าจอเหมือน "ยังไม่มีสังกัด" แยกไม่ออกจากคนที่ยังไม่ถูกจัด

   กติกาที่ใช้เติม:
   1. `admin_users` สังกัดว่าง → `TNKI` — แอดมินที่ไม่มีตัวแทน **คือ** แอดมินบริษัทตามนิยามเดิมของระบบ
      (รวม super_admin ด้วย ซึ่ง updateAdminUser แก้ผ่าน API ไม่ได้ จึงต้องมาทางนี้)
   2. `liff_users` ที่ **เป็นแอดมินอยู่แล้ว** (จับคู่ด้วย line_user_id) → ใช้สังกัดเดียวกับแถวแอดมินของเขา
      แถวสองใบของคนเดียวกันต้องตรงกัน ไม่งั้นสิทธิ์จะขึ้นกับว่าโค้ดตรงนั้นอ่านตารางไหน
   ★ **ไม่แตะคนที่ยังรออนุมัติและยังไม่ได้เป็นอะไรเลย** — คนพวกนั้น "ยังไม่มีสังกัด" เป็นความจริง
     ไม่ใช่ข้อมูลขาด · ยัดบริษัทให้ = กลายเป็นพนักงานบริษัทโดยไม่มีใครตัดสินใจ */
function backfillUserAffiliations(session, payload) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  var dry = !(payload && payload.commit);
  var admins = centralObjects('admin_users');
  var plan = { adminsToOwner: [], staffFromAdmin: [] };

  admins.forEach(function(a) {
    if (!String(a.tenant_id || '').trim()) plan.adminsToOwner.push({ id: a.record_id, username: a.username });
  });

  // สังกัดที่ "ควรจะเป็น" ของแต่ละ LINE id หลังเติมข้อ 1 แล้ว
  var byLine = {};
  admins.forEach(function(a) {
    var lid = String(a.line_user_id || '').trim();
    if (lid) byLine[lid] = String(a.tenant_id || '').trim() || OWNER_TENANT_ID;
  });
  centralObjects('liff_users').forEach(function(u) {
    var lid = String(u.line_user_id || '').trim();
    var want = byLine[lid];
    if (!lid || !want) return;                                  // ไม่ได้เป็นแอดมิน = ไม่ยุ่ง
    if (String(u.tenant_id || '').trim() === want) return;      // ตรงอยู่แล้ว
    plan.staffFromAdmin.push({ lineUserId: lid, name: u.display_name, from: u.tenant_id || '(ว่าง)', to: want });
  });

  if (dry) {
    return { success: true, dryRun: true, plan: plan,
      message: 'จะเติมสังกัดบริษัทให้แอดมิน ' + plan.adminsToOwner.length + ' คน และปรับแถวพนักงานให้ตรงกับแอดมิน ' +
        plan.staffFromAdmin.length + ' คน (ยังไม่ได้เขียน — ส่ง commit:true เพื่อทำจริง)' };
  }

  /* ★ updateColumnsWhere คืน .changed = จำนวน "คอลัมน์" ที่เขียน ไม่ใช่จำนวนแถว
     เขียนคอลัมน์เดียวให้ 3 แถวจะได้ค่า 1 — เอามารายงานตรงๆ ว่า "3 คน" ไม่ได้
     รายงานต่ำกว่าความจริงคือเหตุให้คนไปรันซ้ำหรือไม่เชื่อว่ามันทำงาน จึงนับจากแผนที่คำนวณไว้แล้วแทน */
  var n1 = 0, n2 = 0;
  if (plan.adminsToOwner.length) {
    updateColumnsWhere(centralSheet('admin_users'),
      function(row) { return !String(row.tenant_id || '').trim(); }, { tenant_id: OWNER_TENANT_ID });
    n1 = plan.adminsToOwner.length;
  }
  plan.staffFromAdmin.forEach(function(p) {
    updateColumnsWhere(centralSheet('liff_users'),
      function(row) { return String(row.line_user_id) === p.lineUserId; }, { tenant_id: p.to });
    n2++;
  });
  centralInvalidate('admin_users'); centralInvalidate('liff_users');
  return { success: true, adminsFixed: n1, staffFixed: n2, plan: plan,
    message: 'เติมสังกัดบริษัทให้แอดมิน ' + n1 + ' คน · ปรับแถวพนักงานให้ตรงกับแอดมิน ' + n2 + ' คน' };
}

function listTenants(session) {
  var err = _requirePermission(session, 'tenants', 'view'); if (err) return err;
  return { success: true, data: centralObjects('tenants').map(function(t) {
    return {
      tenantId: t.tenant_id, name: t.name, region: t.region, isActive: isFlagOn(t.is_active), isHouse: isFlagOn(t.is_house),
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + t.sheet_file_id,
      address: t.address || '', taxId: t.tax_id || '', branchCode: t.branch_code || '',
      phone: t.phone || '', email: t.email || '', logoUrl: t.logo_url || '', customerAccount: t.customer_account || ''
    };
  }) };
}

/**
 * ===================== ข้อมูลบริษัทของตัวแทน (Company Profile) =====================
 * ตัวแทนแก้ข้อมูลของตัวเองได้ (module 'tenants' scope เดียวกับที่ตัวแทนมองเห็นตัวเอง)
 * บริษัทเจ้าของสินค้า (ไม่มี session.tenant_id) ต้องระบุ payload.tenantId ว่าจะดู/แก้ของใคร
 */
/* ★ "จะแตะแถวไหน" เป็นคนละคำถามกับ "สิทธิ์ของใคร"
   _effectiveTenantId() แปลง TNKI เป็น null เพราะเชิงสิทธิ์ TNKI คือ "บริษัท" ไม่ใช่ตัวแทนรายหนึ่ง —
   ถูกต้องสำหรับการกั้นสิทธิ์ แต่สามฟังก์ชันด้านล่างต้องการ "รหัสแถว" จริงไปหาใน tenants
   ไม่งั้นแถวของบริษัทเองจะแก้ไม่ได้เลย (ตอบ "กรุณาระบุตัวแทนจำหน่าย" ทั้งที่ระบุมาแล้ว
   — เจอตอนจะแก้ชื่อแถว TNKI ให้เป็นชื่อบริษัทจริง)
   ฝั่งบริษัทจึงใช้ payload.tenantId ดิบ · ตัวแทนยังถูกล็อกที่ตัวเองเหมือนเดิม อ่านจาก session เท่านั้น */
function _tenantRowIdFor(session, payload) {
  if (_isCompanySide(session)) {
    var raw = (payload && payload.tenantId) ? String(payload.tenantId).trim() : '';
    return raw || null;
  }
  return _effectiveTenantId(session, payload);
}

function getTenantProfile(session, payload) {
  var err = _requirePermission(session, 'tenants', 'view'); if (err) return err;
  var tenantId = _tenantRowIdFor(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };

  var rows = centralObjects('tenants');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tenant_id) === String(tenantId)) {
      var t = rows[i];
      return { success: true, data: {
        tenantId: t.tenant_id, name: t.name, region: t.region,
        address: t.address || '', taxId: t.tax_id || '', branchCode: t.branch_code || '',
        phone: t.phone || '', email: t.email || '', logoUrl: t.logo_url || '',
        bankName: t.bank_name || '', bankAccountNo: t.bank_account_no || '', bankAccountName: t.bank_account_name || '',
        customerAccount: t.customer_account || ''
      } };
    }
  }
  return { success: false, message: 'ไม่พบตัวแทนนี้' };
}

function updateTenantProfile(session, payload) {
  var err = _requirePermission(session, 'tenants', 'edit'); if (err) return err;
  var tenantId = _tenantRowIdFor(session, payload);
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
        bank_name: payload.bankName, bank_account_no: payload.bankAccountNo, bank_account_name: payload.bankAccountName,
        customer_account: payload.customerAccount
      };
      Object.keys(fields).forEach(function(key) {
        if (fields[key] === undefined) return;
        var col = headers.indexOf(key);
        if (col !== -1) sh.getRange(rowNum, col + 1).setValue(fields[key]);
      });
      /* ★ เขียนชีตแบบดิบ (getRange().setValue) ต้องล้างแคชเอง — `tenants` อยู่ใน SHEET_CACHE_TABLES
         อายุ 5 นาที · ไม่ล้าง = ข้อมูลลงชีตจริงแต่ listTenants ยังคืนของเก่า ผู้ใช้เห็นว่า "กดบันทึกแล้วไม่เปลี่ยน"
         แล้วกดซ้ำ (เจอจริงตอนเปลี่ยนชื่อแถว TNKI 30 ก.ย. 2026) — บั๊กพันธุ์เดียวกับที่เคยแก้ใน updateTenantStatus */
      centralInvalidate('tenants');
      return { success: true };
    }
  }
  return { success: false, message: 'ไม่พบตัวแทนนี้' };
}

// อัปโหลดโลโก้บริษัท — เก็บเป็นไฟล์จริงบน Drive (โฟลเดอร์เดียวกับ Tenant Sheet) แล้วบันทึก URL ไว้
// payload: { tenantId?, base64, mimeType, fileName }  base64 ไม่ต้องมี prefix "data:...;base64,"
function uploadTenantLogo(session, payload) {
  var err = _requirePermission(session, 'tenants', 'edit'); if (err) return err;
  var tenantId = _tenantRowIdFor(session, payload);
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
        centralInvalidate('tenants');   // เหตุผลเดียวกับ updateTenantProfile — เขียนดิบต้องล้างแคชเอง
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
  var sh = centralSheet('tenants');
  var data = sh.getDataRange().getValues();
  // หาคอลัมน์จากหัวตาราง — ของเดิมเขียนลงคอลัมน์ที่ 5 ตรงๆ ซึ่งจะเขียนผิดช่องทันทีที่มีใครแทรกคอลัมน์
  var cId = data[0].indexOf('tenant_id'), cActive = data[0].indexOf('is_active');
  if (cId === -1 || cActive === -1) return { success: false, message: 'ตาราง tenants ไม่มีคอลัมน์ที่ต้องใช้' };
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cId]) !== String(payload.tenantId)) continue;
    sh.getRange(i + 1, cActive + 1).setValue(payload.isActive ? 'TRUE' : 'FALSE');
    // ★ tenants อยู่ในลิสต์แคชข้ามคำขอ (SHEET_CACHE_TABLES) — เขียนชีตแบบดิบต้องล้างแคชเอง
    //   ไม่งั้นปิดตัวแทนแล้วรายชื่อยังโชว์ว่าเปิดอยู่อีกห้านาที เหมือนกดไม่ติด
    centralInvalidate('tenants');
    return { success: true, message: (payload.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + 'ตัวแทน ' + payload.tenantId + ' แล้ว' };
  }
  return { success: false, message: 'ไม่พบตัวแทนนี้' };
}
