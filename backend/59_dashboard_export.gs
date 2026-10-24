/**
 * ============ ส่งยอดขายออกเป็นไฟล์กลางของ Dashboard บริษัท (rangertopsales.xlsx) ============
 * เจ้าของระบบสั่ง 24 ต.ค. 2026 · ให้ GAS trigger เป็นตัวรัน
 *
 * ★★★ นิยาม "ยอดขาย" ของไฟล์นี้ = **ใบที่ออกใบกำกับภาษีไปแล้วเท่านั้น** (เจ้าของระบบสั่ง)
 *   ใช้ `taxInvoiceRows()` ของ `58_tax_invoices.gs` **ตัวเดียวกับหน้าจอ 5.3.1** ไม่เขียนเกณฑ์ชุดที่สอง
 *   — ถ้ามีสองชุด วันหนึ่งเลขในไฟล์ที่ส่งให้ผู้บริหารกับเลขบนหน้าจอจะไม่ตรงกัน
 *     แล้วไม่มีใครบอกได้ว่าอันไหนถูก (บทเรียนเดียวกับ computePromoDiscount / splitVat)
 *
 * ★★ ตัวเลขยอดขายในไฟล์เป็น **ยอดก่อนภาษี** ตามกติกา 24 ต.ค. 2026 (ดู orderExVat ใน 18_pricing_engine.gs)
 *   และมียอดรวมภาษีอยู่คนละคอลัมน์ให้ฝั่งเก็บเงิน/ภาษีใช้ — อย่าเอาสองตัวนี้ไปรวมกัน
 *
 * โครงไฟล์: 1 ชีต = 1 ตัวแทน ตั้งชื่อชีตด้วย **รหัสย่อของตัวแทน** (เช่น `BDC`)
 *   · **1 แถว = 1 บรรทัดบิล (transaction line)** — เจ้าของระบบใช้ถึงระดับสินค้า
 *   · คอลัมน์เอกสารซ้ำทุกบรรทัดของใบเดียวกัน Dashboard จึง group เอายอดระดับใบได้เอง
 *
 * ★ ทำไมต้องมีชีต Google คั่นกลาง: Apps Script เขียนไฟล์ .xlsx ตรงๆ ไม่ได้ จึงเขียนลงชีต Google ก่อน
 *   แล้ว "ส่งออกเป็น .xlsx" ทับไฟล์เดิม **โดยคง file id เดิมไว้** ลิงก์ที่ Dashboard ใช้จึงไม่เปลี่ยน
 *   (สร้างไฟล์ใหม่ทุกครั้ง = ลิงก์ตายทุกครั้ง)
 */

var DASH_WORKBOOK_NAME = 'rangertopsales';          // ชื่อไฟล์ (ไม่มีนามสกุล — .xlsx ต่อท้ายตอนส่งออก)
var DASH_PROP_SHEET    = 'DASHBOARD_SHEET_FILEID';  // ชีต Google ที่ใช้ทำงาน
var DASH_PROP_XLSX     = 'DASHBOARD_XLSX_FILEID';   // ไฟล์ .xlsx ที่ Dashboard อ่าน
var DASH_PROP_FOLDER   = 'DASHBOARD_FOLDER_ID';     // โฟลเดอร์ปลายทาง (ไม่ตั้ง = โฟลเดอร์ db ของ env)

/* กันไฟล์บวมจนรันไม่จบใน 6 นาที — เกินเท่านี้ให้ไปตั้งช่วงวันที่แทนการดึงทั้งหมด */
var DASH_MAX_ROWS = 20000;

/* ★★ ระดับ **บรรทัดบิล** (transaction line) ตามที่เจ้าของระบบสั่ง 24 ต.ค. 2026
   คอลัมน์เอกสาร (วันที่/เลขที่ใบกำกับ/ลูกค้า/…) ซ้ำอยู่ทุกบรรทัดของใบเดียวกัน เพื่อให้ Dashboard
   **group เอายอดระดับใบได้เอง** — จึงมีชีตเดียวต่อตัวแทน ไม่ต้องมีชีตระดับใบให้รวมผิดชีต */
var DASH_HEADERS = [
  'วันที่', 'เลขที่ใบกำกับภาษี', 'เลขที่บิล', 'รอบจัดส่ง', 'รหัสตัวแทน',
  'รหัสลูกค้า', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี', 'สาขา', 'พนักงานขาย', 'วิธีชำระ',
  'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนที่ขาย', 'หน่วยขาย', 'ราคาขายต่อหน่วย',
  'ยอดเงินตามราคาขาย', 'ส่วนลด', 'ยอดขายลบส่วนลดแล้ว', 'ยอดขายก่อนภาษี', 'ของแถม'
];

/** แถวของตัวแทนรายหนึ่ง — คืน array of array พร้อมเขียนลงชีต (1 แถว = 1 บรรทัดบิล) */
function _dashRowsFor(tenantId, opts) {
  opts = opts || {};
  var book = _normBook(tenantId);
  var docs = taxInvoiceRows(book, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, limit: DASH_MAX_ROWS + 1 });
  if (!docs.success) return { success: false, message: docs.message || 'อ่านใบกำกับภาษีไม่สำเร็จ' };

  var salesTenant = _bookSalesTenant(book);
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  // บรรทัดบิลทั้งหมดของตัวแทนนี้ จัดกลุ่มตามใบ — อ่านทีเดียว ไม่เปิดชีตซ้ำต่อใบ
  var itemsByOrder = {};
  tenantObjectsIfExists(salesTenant, 'order_items').forEach(function(it) {
    (itemsByOrder[String(it.order_id)] = itemsByOrder[String(it.order_id)] || []).push(it);
  });
  // ของที่ส่งจริงในแต่ละรอบ (บิลที่แยกรอบ ใบกำกับออกตามของที่ส่งรอบนั้น)
  var roundItems = {};
  tenantObjectsIfExists(salesTenant, 'delivery_round_items').forEach(function(ri) {
    (roundItems[String(ri.round_id)] = roundItems[String(ri.round_id)] || []).push(ri);
  });
  var orderById = {};
  tenantObjectsIfExists(salesTenant, 'sales_orders').forEach(function(o) { orderById[String(o.record_id)] = o; });

  var out = [];
  (docs.data || []).forEach(function(r) {
    /* ★ บิลที่ยกเลิกไม่เข้าไฟล์ — Dashboard บวกคอลัมน์ยอดขายตรงๆ ใส่ไปแล้วยอดจะเกิน
       (ของจริงที่ขายแล้วคืนของ ต้องเป็น "ใบลดหนี้" ไม่ใช่การยกเลิกบิล — ดูหมายเหตุท้ายไฟล์) */
    if (r.cancelled) return;
    var order = orderById[String(r.orderId)];
    if (!order) return;
    var items = itemsByOrder[String(r.orderId)] || [];
    /* ★★ "ขายได้เท่าไรจริง" ต่อบรรทัด ใช้ `soldNetByItem` ตัวเดียวกับใบลดหนี้ (18_pricing_engine.gs)
       ซึ่งเฉลี่ยส่วนลดท้ายบิลลงบรรทัดให้แล้ว — คิดเองที่นี่อีกชุดเมื่อไหร่ ยอดในไฟล์กับยอดที่ลดหนี้
       จะคนละตัวทันที */
    var netOf = soldNetByItem(order, items);

    /* รอบจัดส่ง: คิดตามสัดส่วนของที่ส่งจริงในรอบ (share = จำนวนในรอบ ÷ จำนวนที่สั่ง)
       ★ สูตรเดียวกับ `deliveryRoundAmounts` ใน 48_delivery_rounds.gs ที่ใช้ออกใบกำกับของรอบ
         ผลรวมรายบรรทัดจึงตรงกับยอดบนใบกำกับใบนั้น */
    var qtyInRound = null;
    if (r.roundId) {
      qtyInRound = {};
      (roundItems[String(r.roundId)] || []).forEach(function(ri) {
        qtyInRound[String(ri.item_id)] = (qtyInRound[String(ri.item_id)] || 0) + (parseFloat(ri.qty) || 0);
      });
    }

    items.forEach(function(it) {
      var ordered = parseFloat(it.qty) || 0;
      var qty = ordered, share = 1;
      if (qtyInRound) {
        qty = qtyInRound[String(it.record_id)] || 0;
        if (!qty || !ordered) return;                       // บรรทัดนี้ไม่ได้ส่งในรอบนี้
        share = qty / ordered;
      }
      var gross = _round2((parseFloat(it.line_total) || 0) * share);
      var net   = _round2((netOf[String(it.record_id)] || 0) * share);
      var p = products[String(it.product_id)] || {};
      var free = isFlagOn(it.is_free) || String(it.is_free) === '1';

      out.push([
        _dashDate(r.docDate), r.docNo, r.orderCode || '', r.roundNo || '', tenantId,
        r.customerCode || '', r.customerName || '', r.taxId || '', r.branchCode || '',
        r.saleByName || '', r.paymentLabel || '',
        p.product_code || String(it.product_id || ''), p.name || '(สินค้าถูกลบ)',
        qty, it.unit_code || '', _round2(parseFloat(it.price) || 0),
        gross, _round2(gross - net), net,
        // ยอดขายก่อนภาษีของบรรทัด — ใช้ภาพนิ่งภาษีรายบรรทัด (กติกา 24 ต.ค. 2026)
        lineExVat(order, { line_total: net, tax_status: it.tax_status }),
        free ? 'ใช่' : ''
      ]);
    });
  });
  return { success: true, rows: out, truncated: !!docs.truncated };
}

/** 'yyyy-mm-dd' → Date จริง เพื่อให้ Excel ได้คอลัมน์วันที่ ไม่ใช่ข้อความ (กราฟแกนเวลาถึงจะทำงาน) */
function _dashDate(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** ชีต Google ที่ใช้ทำงาน — สร้างครั้งแรกแล้วจำ id ไว้ใน Script Property */
function _dashWorkbook() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(DASH_PROP_SHEET);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* ไฟล์ถูกลบ/ย้ายสิทธิ์ — สร้างใหม่ข้างล่าง */ }
  }
  var ss = SpreadsheetApp.create(DASH_WORKBOOK_NAME);
  var file = DriveApp.getFileById(ss.getId());
  _dashFolder().addFile(file);
  // ไฟล์ที่ Apps Script สร้างจะไปอยู่ My Drive ของเจ้าของสคริปต์ด้วย — เอาออกให้เหลือที่เดียว
  try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
  props.setProperty(DASH_PROP_SHEET, ss.getId());
  return ss;
}

function _dashFolder() {
  var fid = PropertiesService.getScriptProperties().getProperty(DASH_PROP_FOLDER);
  if (fid) return DriveApp.getFolderById(fid);
  return _dbEnvFolder();
}

/**
 * ส่งออกชีตทั้งเล่มเป็น .xlsx ทับไฟล์เดิม (คง file id เดิมไว้)
 * ★ ต้องใส่ `supportsAllDrives=true` ทุกคำขอ — ไฟล์อยู่บน Shared Drive ไม่งั้น Drive API ตอบ 404
 */
function _dashWriteXlsx(ss) {
  var token = ScriptApp.getOAuthToken();
  var exportUrl = 'https://www.googleapis.com/drive/v3/files/' + ss.getId() +
    '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var res = UrlFetchApp.fetch(exportUrl, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('ส่งออก .xlsx ไม่สำเร็จ (' + res.getResponseCode() + '): ' + res.getContentText().substring(0, 200));
  }
  var blob = res.getBlob().setName(DASH_WORKBOOK_NAME + '.xlsx');

  var props = PropertiesService.getScriptProperties();
  var xlsxId = props.getProperty(DASH_PROP_XLSX);
  if (xlsxId) {
    try {
      var up = UrlFetchApp.fetch(
        'https://www.googleapis.com/upload/drive/v3/files/' + xlsxId + '?uploadType=media&supportsAllDrives=true',
        { method: 'patch', contentType: blob.getContentType(), payload: blob.getBytes(),
          headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      if (up.getResponseCode() === 200) return xlsxId;
      // ไฟล์หาย/ถูกลบ → ตกลงไปสร้างใหม่ข้างล่าง
    } catch (e) { /* เหมือนกัน */ }
  }
  var created = _dashFolder().createFile(blob);
  props.setProperty(DASH_PROP_XLSX, created.getId());
  return created.getId();
}

/**
 * ชีตที่ต้องเขียนในรอบนี้ — คืนรหัสตัวแทน · `''` = สมุดของบริษัท
 * ★★ แยกออกมาเพื่อให้เทสต์จับได้ว่า **ยอดขายตรงในนามบริษัทไม่ตกหล่น** — ตัวแทน HOUSE ไม่ใช่
 *   ตัวแทนจริง ถ้าวนแค่ตาราง tenants แล้วข้าม is_house ยอดขายตรงของบริษัทจะหายทั้งก้อน
 *   โดย Dashboard ไม่มีทางรู้ว่าขาด (ตัวเลขดูปกติ แค่น้อยกว่าความจริง)
 */
function _dashTargets(opts) {
  opts = opts || {};
  if (opts.tenantIds && opts.tenantIds.length) return opts.tenantIds.slice();
  var out = [];
  centralObjects('tenants').forEach(function(t) {
    if (!isFlagOn(t.is_active)) return;
    if (isFlagOn(t.is_house)) return;          // บริษัทเอง เขียนเป็นชีต HOUSE ข้างล่าง
    out.push(String(t.tenant_id));
  });
  out.push('');                                 // '' = สมุดของบริษัท (ขายตรงในนามบริษัท)
  return out;
}

/**
 * ตัวจริง — ไล่ทุกตัวแทนที่ใช้งานอยู่ + บริษัท แล้วเขียนทีละชีต
 * opts: { dateFrom?, dateTo?, tenantIds? }  (ไม่ส่ง = ทั้งหมดเท่าที่มี)
 */
function exportSalesDashboardWorkbook(opts) {
  opts = opts || {};
  var ss = _dashWorkbook();

  var targets = _dashTargets(opts);

  var report = [], total = 0;
  targets.forEach(function(tid) {
    var name = tid || 'HOUSE';                  // ชีตของบริษัทใช้ชื่อ HOUSE (ชื่อชีตว่างไม่ได้)
    var r = _dashRowsFor(tid, opts);
    if (!r.success) { report.push({ tenantId: name, error: r.message }); return; }

    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, DASH_HEADERS.length).setValues([DASH_HEADERS]).setFontWeight('bold');
    if (r.rows.length) {
      sh.getRange(2, 1, r.rows.length, DASH_HEADERS.length).setValues(r.rows);
      sh.getRange(2, 1, r.rows.length, 1).setNumberFormat('yyyy-mm-dd');
      // คอลัมน์เงินสี่ช่องสุดท้าย (16-20) + จำนวน (14) — ตำแหน่งผูกกับ DASH_HEADERS แก้หัวแล้วต้องตามมาแก้ที่นี่
      sh.getRange(2, 14, r.rows.length, 1).setNumberFormat('#,##0.###');
      sh.getRange(2, 16, r.rows.length, 5).setNumberFormat('#,##0.00');
    }
    sh.setFrozenRows(1);
    report.push({ tenantId: name, rows: r.rows.length, truncated: r.truncated });
    total += r.rows.length;
  });

  /* ชีตเปล่าที่ Google แถมมาตอนสร้างไฟล์ใหม่ — ลบทิ้งเมื่อมีชีตจริงแล้ว */
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && ss.getSheets().length > 1) { ss.deleteSheet(blank); }

  SpreadsheetApp.flush();
  var xlsxId = _dashWriteXlsx(ss);

  return { success: true, rows: total, tenants: report,
    xlsxFileId: xlsxId, xlsxUrl: 'https://drive.google.com/file/d/' + xlsxId + '/view',
    sheetUrl: ss.getUrl(), at: nowStr() };
}

/* ═══════════════ ตัวที่ trigger เรียก ═══════════════
   ★ ฟังก์ชันที่ trigger เรียกต้อง **ไม่รับอาร์กิวเมนต์** และห้าม throw ออกไป
     ไม่งั้น Apps Script ส่งอีเมลแจ้ง error ทุกชั่วโมงจนคนเลิกอ่าน แล้วของพังจริงก็ไม่มีใครเห็น */
function runDashboardExport() {
  try {
    var r = exportSalesDashboardWorkbook({});
    Logger.log('ส่งออก Dashboard สำเร็จ: ' + r.rows + ' แถว · ' + r.xlsxUrl);
    return r;
  } catch (e) {
    Logger.log('ส่งออก Dashboard ล้มเหลว: ' + e.message);
    return { success: false, message: e.message };
  }
}

/** ตั้ง trigger รายวัน (เรียกจาก editor ครั้งเดียว) — ลบตัวเดิมก่อนเสมอ กันตั้งซ้อนจนรันวันละหลายรอบ */
function installDashboardExportTrigger(hour) {
  removeDashboardExportTrigger();
  ScriptApp.newTrigger('runDashboardExport').timeBased().atHour(hour === undefined ? 1 : hour).everyDays(1).create();
  Logger.log('ตั้ง trigger ส่งออก Dashboard ทุกวันตอน ' + (hour === undefined ? 1 : hour) + ' นาฬิกาแล้ว');
}

function removeDashboardExportTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'runDashboardExport') { ScriptApp.deleteTrigger(t); n++; }
  });
  if (n) Logger.log('ลบ trigger เดิม ' + n + ' ตัว');
}

/** สั่งส่งออกเดี๋ยวนี้จากหน้าแอดมิน (super_admin เท่านั้น — เขียนไฟล์ที่คนทั้งบริษัทใช้) */
function exportSalesDashboard(session, payload) {
  if (!session || !session.isSuperAdmin) return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  payload = payload || {};
  try {
    return exportSalesDashboardWorkbook({ dateFrom: payload.dateFrom, dateTo: payload.dateTo });
  } catch (e) {
    return { success: false, message: 'ส่งออกไม่สำเร็จ: ' + e.message };
  }
}

/* ═══════════════ ยังไม่ได้ทำ (ตั้งใจ) ═══════════════
 * - **ใบลดหนี้ยังไม่ถูกหักออกจากไฟล์นี้** — ลูกค้าคืนของหลังออกใบกำกับแล้ว ยอดขายในไฟล์จะสูงกว่าจริง
 *   เท่ามูลค่าที่ลดหนี้ไป · ต้องตกลงกับเจ้าของระบบก่อนว่าจะหักในไฟล์นี้เลย (คอลัมน์ติดลบอีกแถว)
 *   หรือให้ Dashboard ไปอ่านใบลดหนี้เองอีกชีต
 */
