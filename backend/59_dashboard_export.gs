/**
 * ============ ส่งยอดขายออกเป็นไฟล์กลางของ Dashboard บริษัท (CSV ต่อตัวแทน) ============
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
 * โครงไฟล์: **1 ตัวแทน = 1 ไฟล์ `<รหัสย่อ>.csv`** (เช่น `BDC.csv` · ขายตรงในนามบริษัท = `HOUSE.csv`)
 *   · **1 แถว = 1 บรรทัดบิล (transaction line)** — เจ้าของระบบใช้ถึงระดับสินค้า
 *   · คอลัมน์เอกสารซ้ำทุกบรรทัดของใบเดียวกัน Dashboard จึง group เอายอดระดับใบได้เอง
 *
 * ★★★ เปลี่ยนจาก .xlsx มาเป็น .csv (เจ้าของระบบสั่ง 24 ต.ค. 2026) — ที่เร็วขึ้นไม่ใช่เพราะรูปแบบไฟล์
 *   แต่เพราะ **ไม่ต้องแตะ Google Sheets เลย**: เดิมต้องเขียนลงชีต → สั่ง export → อัปโหลดทับ
 *   (ยิงเน็ต 2 รอบ + เขียนชีตทั้งก้อน) · ตอนนี้ต่อสตริงในหน่วยความจำแล้วอัปโหลดรอบเดียวจบ
 *   และไม่ชนเพดาน 10 ล้านเซลล์ของชีต Google เมื่อข้อมูลโตขึ้น
 *
 * ★★ ราคาที่จ่ายไปกับการใช้ CSV — **รู้ตัวตั้งแต่ต้น ไม่ใช่เจอทีหลัง**:
 *   1. **CSV ไม่มีชีต** จึงต้องแยกไฟล์ต่อตัวแทน (ซึ่งคือสิ่งที่สั่งมา)
 *   2. **เลขที่มีศูนย์นำหน้าไม่มีอะไรปกป้อง** — `เลขผู้เสียภาษี` 0105... และ `สาขา` 00000
 *      ถ้าเปิดด้วย Excel ด้วยการดับเบิลคลิก ศูนย์หน้าจะหาย · ฝั่งที่อ่านไฟล์ต้องกำหนดชนิดคอลัมน์
 *      เป็นข้อความเอง (ปลายทางเป็นโปรแกรมอ่าน จึงยอมรับข้อนี้ได้)
 *   3. วันที่/ตัวเลขเป็นข้อความล้วน — เขียนวันที่เป็น `yyyy-mm-dd` (ISO) ซึ่งไม่กำกวมทุกภาษา
 */

var DASH_PROP_FILE_IDS = 'DASHBOARD_CSV_FILEIDS';   // {รหัสตัวแทน: fileId} — คงไฟล์เดิมไว้ ลิงก์จะได้ไม่ตาย
var DASH_PROP_FOLDER   = 'DASHBOARD_FOLDER_ID';     // โฟลเดอร์ไฟล์ยอดขาย (ไม่ตั้ง = โฟลเดอร์ db ของ env)
/* ★★★ `customer.csv` ต้องอยู่ **คนละโฟลเดอร์กับไฟล์ยอดขาย** (เจ้าของระบบสั่ง 26 ต.ค. 2026)
   เพราะปลายทางใช้ Power Query แบบ **From Folder** ซึ่งอ่านทุกไฟล์ในโฟลเดอร์มาต่อกันเป็นตารางเดียว
   — วางปนกันเมื่อไหร่ ทะเบียนร้านค้ากับยอดขายคนละสคีมาจะถูกจับมารวมกันแล้วพังทั้งคิวรี
   ★ ไม่ตั้ง property = ใช้โฟลเดอร์ย่อย `customer/` ใต้โฟลเดอร์ยอดขาย — **ค่าตั้งต้นต้องแยกอยู่แล้ว**
     ไม่ใช่ตกไปกองรวมกัน (ค่าตั้งต้นที่พังเงียบคือสิ่งที่เรากำลังหลีกเลี่ยง) */
var DASH_PROP_CUST_FOLDER = 'DASHBOARD_CUSTOMER_FOLDER_ID';

/* กันไฟล์บวมจนรันไม่จบใน 6 นาที — เกินเท่านี้ให้ไปตั้งช่วงวันที่แทนการดึงทั้งหมด */
var DASH_MAX_ROWS = 20000;

/* ★★ ระดับ **บรรทัดบิล** (transaction line) ตามที่เจ้าของระบบสั่ง 24 ต.ค. 2026
   คอลัมน์เอกสาร (วันที่/เลขที่ใบกำกับ/ลูกค้า/…) ซ้ำอยู่ทุกบรรทัดของใบเดียวกัน เพื่อให้ Dashboard
   **group เอายอดระดับใบได้เอง** — จึงมีชีตเดียวต่อตัวแทน ไม่ต้องมีชีตระดับใบให้รวมผิดชีต */
var DASH_HEADERS = [
  /* ★ `datasource` = ระบบต้นทางของแถวนี้ — Dashboard รวมข้อมูลจากหลายระบบไว้ด้วยกัน
     ต้องแยกออกได้ว่าแถวไหนมาจากที่ไหน · `RBS` คือรหัสที่ฝั่ง Dashboard ใช้เรียกระบบนี้
     (เจ้าของระบบกำหนดเอง 24 ต.ค. 2026) — **ห้ามเดาเป็นชื่อย่ออย่างอื่น** ต้องตรงกับที่ปลายทางตั้งไว้ */
  'datasource', 'วันที่', 'เลขที่ใบกำกับภาษี', 'เลขที่บิล', 'รอบจัดส่ง', 'รหัสตัวแทน',
  'รหัสลูกค้า', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี', 'สาขา', 'พนักงานขาย', 'วิธีชำระ',
  /* ★★★ **ตัวเลขเงินทุกคอลัมน์เป็นยอดก่อนภาษีทั้งหมด** (เจ้าของระบบสั่ง 25 ต.ค. 2026:
     "รายงานการขายของเราไม่ดู VAT") — ราคาต่อหน่วย ยอดตามราคาขาย ส่วนลดทั้งสองชั้น และยอดสุทธิ
     ถอด VAT ออกหมดแล้วตั้งแต่ต้นทาง Dashboard จึงบวกได้ตรงๆ ไม่ต้องรู้เรื่องภาษีเลย
     ★ เลิกมีคอลัมน์ "ยอดขายก่อนภาษี" แยกต่างหาก เพราะกลายเป็นเลขเดียวกับ "ยอดขายลบส่วนลดแล้ว"
       — ส่งเลขเดียวกันสองคอลัมน์มีแต่ทำให้คนรวมซ้ำ (กติกาเดียวกับข้อ 8 ใน CLAUDE.md) */
  'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนที่ขาย', 'หน่วยขาย', 'ราคาขายต่อหน่วย (ก่อนภาษี)',
  'ยอดเงินตามราคาขาย (ก่อนภาษี)', 'ส่วนลดรายบรรทัด (ก่อนภาษี)', 'ส่วนลดท้ายบิล เฉลี่ย (ก่อนภาษี)',
  'ยอดขายลบส่วนลดแล้ว (ก่อนภาษี)', 'ของแถม',
  /* ★★ ใบลดหนี้/ใบเพิ่มหนี้อยู่ชีตเดียวกันเป็น **แถวติดลบ/บวก** (เจ้าของระบบสั่ง 24 ต.ค. 2026)
     Dashboard บวกคอลัมน์เดียวได้ยอดสุทธิเลย ไม่ต้องไปลบจากอีกชีต (ซึ่งมีวันลืม)
     ★ `ประเภทรายการ` ไว้ให้กรองแยกเมื่ออยากดูเฉพาะยอดขายดิบ · `เอกสารอ้างอิง` = ใบกำกับที่ถูกปรับ */
  'ประเภทรายการ', 'เอกสารอ้างอิง',
  /* ★★ คีย์เชื่อมกับ `customer.csv` — ค่าเดียวกับ `CustomerAccount`/`unicode_customer` ที่นั่น
     (เจ้าของระบบสั่ง 26 ต.ค. 2026) · ปลายทางต่อสองไฟล์ด้วยช่องนี้ได้เลย ไม่ต้องไปประกอบสูตรในคิวรี
     ★ ชื่อคอลัมน์ต้องตรงกับฝั่ง `customer.csv` เป๊ะ ไม่งั้นคนตั้งคิวรีต้องมาเดาว่าช่องไหนคู่กับช่องไหน */
  'unicode_customer'
];
var DASH_SOURCE = 'RBS';        // ระบบต้นทาง — ค่าคงที่ของทุกแถวที่ออกจากที่นี่

/**
 * แถว CSV ของตัวแทนรายหนึ่ง
 * ★★ ตรรกะ "อะไรนับเป็นยอดขาย และบรรทัดหนึ่งขายได้เท่าไร" **ไม่ได้อยู่ที่นี่** — อยู่ที่
 *   `salesFactRows()` ใน `60_sales_facts.gs` ซึ่งรายงาน 1.8.x ใช้ตัวเดียวกัน
 *   ไฟล์นี้เหลือหน้าที่เดียวคือ "เอา fact มาเรียงเป็นคอลัมน์แล้วเขียนไฟล์"
 */
function _dashRowsFor(tenantId, opts) {
  var r = salesFactRows(_normBook(tenantId), opts || {});
  if (!r.success) return r;
  /* ★★★ สมุดของบริษัทส่ง tenantId มาเป็นค่าว่าง (`''` = ไม่สังกัดตัวแทน) — ในไฟล์ต้องเขียนว่า `HOUSE`
     ให้ตรงกับ `customer.csv` และกับชื่อไฟล์ `HOUSE.csv` · ปล่อยว่างไว้ = คอลัมน์รหัสตัวแทนว่างทั้งไฟล์
     และคีย์กลายเป็น `.C-001` ซึ่งต่อกับทะเบียนร้านค้าไม่ติดสักแถว (เทสต์จับได้ 26 ต.ค. 2026) */
  var area = tenantId || (typeof HOUSE_TENANT_ID !== 'undefined' ? HOUSE_TENANT_ID : 'HOUSE');
  return { success: true, truncated: r.truncated, mismatches: r.mismatches,
    rows: r.facts.map(function(f) {
      /* ★★ `รหัสลูกค้า` ส่งเป็น `<รหัสตัวแทน>.<รหัสร้าน>` เหมือน `CustomerAccount` ใน customer.csv
         (เจ้าของระบบสั่ง 26 ต.ค. 2026) — รหัสร้านเปล่าๆ ซ้ำกันข้ามตัวแทนได้ ปลายทางที่รวมทุกตัวแทน
         ไว้ตารางเดียวจะยุบร้านคนละรายเป็นร้านเดียวกันเงียบๆ
         ★ ค่าเดียวกับคอลัมน์ `unicode_customer` ท้ายไฟล์ ซ้ำกันสองช่องตามสเปกปลายทาง */
      var custKey = f.customerCode ? (area + '.' + f.customerCode) : '';
      return [
        DASH_SOURCE, _dashDate(f.docDate), f.docNo, f.orderCode, f.roundNo, area,
        custKey, f.customerName, f.taxId, f.branchCode, f.saleByName, f.paymentLabel,
        f.productCode, f.productName, f.qty, f.unitCode, f.unitPriceEx,
        f.grossEx, f.lineDiscEx, f.billDiscEx, f.netEx,
        f.isFree ? 'ใช่' : '', f.kind, f.refDoc,
        custKey
      ];
    }) };
}

/** 'yyyy-mm-dd' → Date จริง เพื่อให้ไฟล์มีคอลัมน์วันที่ ไม่ใช่ข้อความ */
function _dashDate(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** โฟลเดอร์ไฟล์ยอดขาย — ไม่ตั้ง `DASHBOARD_FOLDER_ID` = โฟลเดอร์ฐานข้อมูลของ env นั้น */
function _dashFolder() {
  var fid = PropertiesService.getScriptProperties().getProperty(DASH_PROP_FOLDER);
  if (fid) return DriveApp.getFolderById(fid);
  return _dbEnvFolder();
}

/** โฟลเดอร์ทะเบียนร้านค้า — ต้องแยกจากไฟล์ยอดขายเสมอ (ดูหมายเหตุที่ DASH_PROP_CUST_FOLDER) */
function _dashCustomerFolder() {
  var fid = PropertiesService.getScriptProperties().getProperty(DASH_PROP_CUST_FOLDER);
  if (fid) return DriveApp.getFolderById(fid);
  return _ensureChildFolder(_dashFolder(), 'customer');
}

/**
 * แถวข้อมูล → ข้อความ CSV
 * ★ ตามมาตรฐาน RFC 4180: คั่นด้วย `,` · ขึ้นบรรทัดใหม่ด้วย CRLF · ค่าที่มี `,` `"` หรือขึ้นบรรทัด
 *   ต้องครอบด้วย `"` และ `"` ข้างในต้องเขียนซ้อนสองตัว
 * ★★ **เว้นวรรคหน้า/หลังก็ต้องครอบด้วย** ไม่งั้นตัวอ่านบางตัวตัดทิ้งเงียบๆ (ชื่อร้านที่มีเว้นวรรคท้าย
 *   เป็นเรื่องปกติในข้อมูลที่ย้ายมาจากระบบเดิม)
 */
function _dashCsvText(rows, headers) {
  headers = headers || DASH_HEADERS;
  var esc = function(v) {
    if (v === null || v === undefined) return '';
    if (Object.prototype.toString.call(v) === '[object Date]') return _dashIsoDate(v);
    if (typeof v === 'number') return String(v);
    var t = String(v);
    if (/[",\r\n]/.test(t) || t !== t.trim()) return '"' + t.replace(/"/g, '""') + '"';
    return t;
  };
  var lines = [headers.map(esc).join(',')];
  rows.forEach(function(r) { lines.push(r.map(esc).join(',')); });
  return lines.join('\r\n') + '\r\n';
}

/** Date → 'yyyy-mm-dd' (ISO) — รูปแบบเดียวที่ไม่กำกวมว่าวันหรือเดือนมาก่อน */
function _dashIsoDate(d) {
  var p = function(n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * เขียนไฟล์ CSV หนึ่งไฟล์ **ทับไฟล์เดิม โดยคง file id เดิมไว้** ลิงก์ที่ Dashboard ใช้จึงไม่ตายทุกวัน
 *
 * ★★ ใส่ BOM (\uFEFF) นำหน้า — ถ้าไม่ใส่ Excel บน Windows เปิดไฟล์แล้วภาษาไทยเพี้ยนทั้งไฟล์
 *   ตัวอ่านฝั่งโปรแกรมข้าม BOM ให้เองอยู่แล้ว (Python ใช้ `utf-8-sig`, Power BI/pandas จัดการให้)
 * ★ หา id ตามลำดับ: property → ชื่อไฟล์ในโฟลเดอร์ → สร้างใหม่ · ลำดับนี้ทำให้ย้าย/ลบไฟล์ด้วยมือแล้ว
 *   รอบถัดไปยังทำงานต่อได้เอง ไม่ต้องมาแก้ property
 */
function _dashWriteCsv(name, text, folder) {
  folder = folder || _dashFolder();
  var props = PropertiesService.getScriptProperties();
  var map = {};
  try { map = JSON.parse(props.getProperty(DASH_PROP_FILE_IDS) || '{}'); } catch (e) { map = {}; }
  var fileName = name + '.csv';
  var blob = Utilities.newBlob('\uFEFF' + text, 'text/csv', fileName);

  var id = map[name];
  if (!id) {                                   // ยังไม่เคยจำ — ดูว่ามีไฟล์ชื่อนี้อยู่ก่อนแล้วไหม
    var it = folder.getFilesByName(fileName);
    if (it.hasNext()) id = it.next().getId();
  }
  /* ★★★ ไฟล์ที่ถูกลบลงถังขยะ **ยังเขียนทับด้วย file id ได้ตามปกติ** API ตอบ 200 เหมือนไม่มีอะไรเกิดขึ้น
     → ถ้าไม่ตรวจ ตัวส่งออกจะเขียนข้อมูลลงถังขยะทุกคืนโดยไม่มีอะไรฟ้อง และปลายทางก็ไม่เห็นไฟล์เลย
     (เกิดจริง 26 ต.ค. 2026 — ผู้ใช้แจ้งว่า "ไฟล์ customer.csv ไม่มา")
     ★ เจอแล้ว **ทิ้ง id เดิมแล้วสร้างใหม่** ไม่กู้ของเก่าขึ้นมาเอง — คนลบไปอาจตั้งใจลบ
       และ Power Query อ่านแบบ From Folder อยู่แล้ว ไฟล์ใหม่คนละ id จึงไม่กระทบอะไร */
  if (id) {
    try {
      if (DriveApp.getFileById(id).isTrashed()) {
        Logger.log('ไฟล์ ' + fileName + ' เดิมอยู่ในถังขยะ — สร้างไฟล์ใหม่แทน');
        id = null;
      }
    } catch (e) { id = null; }                 // เปิดไม่ได้/ถูกลบถาวร → สร้างใหม่
  }
  if (id) {
    try {
      var up = UrlFetchApp.fetch(
        'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media&supportsAllDrives=true',
        { method: 'patch', contentType: 'text/csv', payload: blob.getBytes(),
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (up.getResponseCode() === 200) {
        _dashEnsureIn(id, folder);
        map[name] = id; props.setProperty(DASH_PROP_FILE_IDS, JSON.stringify(map)); return id;
      }
      // ไฟล์ถูกลบไปแล้ว → ตกลงไปสร้างใหม่ข้างล่าง
    } catch (e) { /* เหมือนกัน */ }
  }
  var created = folder.createFile(blob);
  map[name] = created.getId();
  props.setProperty(DASH_PROP_FILE_IDS, JSON.stringify(map));
  return created.getId();
}

/**
 * ย้ายไฟล์ไปโฟลเดอร์ที่ควรอยู่ ถ้ามันไม่ได้อยู่ที่นั่นแล้ว
 * ★★ จำเป็นเพราะเราเขียนทับ **ด้วย file id** ซึ่งไม่สนว่าไฟล์อยู่โฟลเดอร์ไหน —
 *   วันที่ย้ายโฟลเดอร์ปลายทาง (หรือเพิ่งแยก customer.csv ออกมา) ไฟล์เดิมจะยังนอนอยู่ที่เก่า
 *   แล้ว Power Query ก็ยังอ่านของเก่าต่อไปโดยไม่มีอะไรฟ้อง
 * ★ ย้ายไม่สำเร็จไม่ล้มทั้งงาน — เนื้อไฟล์ถูกเขียนไปแล้ว แค่รายงานไว้ใน log
 */
function _dashEnsureIn(fileId, folder) {
  try {
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents(), already = false;
    while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) { already = true; break; } }
    if (!already) {
      file.moveTo(folder);
      Logger.log('ย้าย ' + file.getName() + ' ไปโฟลเดอร์ ' + folder.getName());
    }
  } catch (e) { Logger.log('ย้ายไฟล์ไม่สำเร็จ (' + fileId + '): ' + e.message); }
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
 * ตัวจริง — ไล่ทุกตัวแทนที่ใช้งานอยู่ + บริษัท แล้วเขียนไฟล์ละตัวแทน
 * opts: { dateFrom?, dateTo?, tenantIds? }  (ไม่ส่ง = ทั้งหมดเท่าที่มี)
 */
function exportSalesDashboardFiles(opts) {
  opts = opts || {};
  var report = [], total = 0;

  _dashTargets(opts).forEach(function(tid) {
    var name = tid || 'HOUSE';                  // ขายตรงในนามบริษัท = HOUSE.csv (ชื่อไฟล์ว่างไม่ได้)
    var r = _dashRowsFor(tid, opts);
    if (!r.success) { report.push({ tenantId: name, error: r.message }); return; }
    /* ★ ไม่มีแถวก็ยังเขียนไฟล์ (เหลือแต่หัวคอลัมน์) — ไฟล์ค้างของเก่าไว้เฉยๆ อันตรายกว่า
       เพราะ Dashboard จะอ่านยอดเดือนที่แล้วมาแสดงเป็นเดือนนี้โดยไม่มีอะไรฟ้อง */
    var fileId = _dashWriteCsv(name, _dashCsvText(r.rows));
    report.push({ tenantId: name, rows: r.rows.length, truncated: r.truncated,
      mismatches: r.mismatches || [], fileId: fileId,
      url: 'https://drive.google.com/file/d/' + fileId + '/view' });
    total += r.rows.length;
  });

  return { success: true, rows: total, files: report, at: nowStr() };
}

/* ═══════════════ ทะเบียนร้านค้า — customer.csv ═══════════════
   เจ้าของระบบสั่ง 26 ต.ค. 2026 · ชื่อคอลัมน์กำหนดมาจากระบบปลายทาง **ห้ามเปลี่ยนชื่อหรือสลับลำดับ**
   (ปลายทางอ่านตามตำแหน่ง/ชื่อที่ตกลงไว้ — แก้ฝั่งเราฝ่ายเดียวแล้วเขาอ่านผิดทั้งไฟล์)

   ★★ ไฟล์เดียวรวมทุกตัวแทน ต่างจากไฟล์ยอดขายที่แยกไฟล์ต่อตัวแทน — เพราะสเปกมีคอลัมน์
     `dataAreaId` บอกตัวแทนอยู่ในแถวแล้ว · อยากแยกไฟล์ต่อตัวแทนเมื่อไหร่แก้ที่ `exportCustomerFile` ที่เดียว

   ★★★ ค่าคงที่สามตัว (`SalesSegmentId` · `StatisticsGroupId` · `CustomerGroupId`) ปลายทางเป็นคนกำหนด
     ไม่ได้มาจากข้อมูลของเรา — ตั้งทับได้ด้วย Script Property โดยไม่ต้อง deploy ใหม่
     (วันที่ปลายทางเปลี่ยนรหัส เราไม่ควรต้องแก้โค้ด) */
var DASH_CUST_HEADERS = [
  'dataAreaId', 'CustomerAccount', 'SalesSegmentId', 'ShopType', 'AddressCity',
  'EmployeeResponsibleNumber', 'SalesDistrict', 'AddressState', 'StatisticsGroupId',
  'OrganizationName', 'PaymentTerms', 'SalesSubsegmentId', 'CreditLimit', 'CustomerGroupId',
  'AddressStreet', 'company_Chain', 'salesp.Name', 'salesp.Region', 'SalesRegional',
  'Province', '!Region', '!Region_Neilson', 'unicode_customer'
];

function _dashCustConst(prop, fallback) {
  return PropertiesService.getScriptProperties().getProperty(prop) || fallback;
}

/**
 * เงื่อนไขการชำระเงินในรูปแบบที่ปลายทางใช้: `CASH` · `30D` · `45D` · `60D`
 * ★ ไม่ได้ตั้งจำนวนวันไว้ = ขายสด — **ห้ามเดาเป็น 30 วัน** ให้เครดิตเกินจริงกับร้านที่ไม่เคยได้เครดิต
 *   (คนละเรื่องกับตอนออกใบแจ้งหนี้ ซึ่งมี fallback 30 วันของมันเอง ดู customerTermsDays)
 */
function _dashPaymentTerms(c) {
  var d = parseInt(c.payment_terms_days, 10);
  return (d > 0) ? (d + 'D') : 'CASH';
}

/** แถวทะเบียนร้านค้าทุกตัวแทน */
function _dashCustomerRows() {
  var shopTypes = {};
  centralObjects('shop_types').forEach(function(t) { shopTypes[String(t.record_id)] = t.name || t.code || ''; });
  var provinces = {}, districts = {};
  centralObjects('provinces').forEach(function(p) { provinces[String(p.id)] = p; });
  centralObjects('districts').forEach(function(d) { districts[String(d.id)] = d; });
  var staff = {};
  centralObjects('liff_users').forEach(function(u) { staff[String(u.line_user_id)] = u.display_name || ''; });

  var seg = _dashCustConst('DASHBOARD_SALES_SEGMENT', DASH_SOURCE);
  var statGroup = _dashCustConst('DASHBOARD_STAT_GROUP', 'TH-EAST');
  var custGroup = _dashCustConst('DASHBOARD_CUSTOMER_GROUP', 'C-TT');

  /* ตัวแทนที่ยังใช้งานอยู่เท่านั้น — ตัวแทนที่ปิดไปแล้วไม่ควรโผล่ในระบบปลายทาง */
  var liveTenant = {};
  centralObjects('tenants').forEach(function(t) { if (isFlagOn(t.is_active)) liveTenant[String(t.tenant_id)] = true; });

  var out = [];
  centralObjects('customers').forEach(function(c) {
    /* ★ ร้านที่ปิดกิจการแล้วไม่ส่งออก · ร้านที่ถูกระงับเครดิต (`blocked`) ยัง**ส่ง** เพราะยังขายสดได้
       (หลักเดียวกับ customerSaleGate ใน 33_customers.gs) */
    var st = String(c.status || '').toLowerCase() ||
      (isNotOff(c.is_active) ? CUSTOMER_STATUS_ACTIVE : CUSTOMER_STATUS_INACTIVE);
    if (st === CUSTOMER_STATUS_INACTIVE) return;

    var tid = String(c.tenant_id || '') || (typeof HOUSE_TENANT_ID !== 'undefined' ? HOUSE_TENANT_ID : 'HOUSE');
    if (String(c.tenant_id || '') && !liveTenant[String(c.tenant_id)]) return;

    var prov = provinces[String(c.province_id)] || {};
    var dist = districts[String(c.district_id)] || {};
    var code = c.customer_code || '';
    /* ★★ `CustomerAccount` = **<รหัสตัวแทน>.<รหัสร้าน>** (เจ้าของระบบสั่ง 26 ต.ค. 2026) เช่น `BDC.C0001`
       ค่าเดียวกับ `unicode_customer` โดยตั้งใจ — ระบบปลายทางรวมร้านของทุกตัวแทนไว้ตารางเดียว
       รหัสร้านเปล่าๆ ซ้ำกันข้ามตัวแทนได้ (ตัวแทนคนละรายออกรหัสของตัวเอง) ถ้าส่งรหัสเปล่าไป
       ร้านคนละรายจะถูกยุบรวมเป็นร้านเดียวกันเงียบๆ */
    var acct = tid + '.' + code;

    /* ★★ `EmployeeResponsibleNumber` ส่ง **ชื่อพนักงาน** ไม่ใช่ LINE user id (เจ้าของระบบสั่ง 26 ต.ค. 2026
       — "Line id ยาวเกิน") · ค่าจึงซ้ำกับ `salesp.Name` โดยตั้งใจ สเปกปลายทางมีสองช่องนี้อยู่แล้ว
       ★ ไม่มีชื่อ = ส่งว่าง ไม่ตกกลับไปใช้ id ยาวๆ ซึ่งคือสิ่งที่เพิ่งเอาออก */
    var salesName = staff[String(c.salesman_line_user_id)] || '';
    out.push([
      tid, acct, seg, shopTypes[String(c.shop_type_id)] || '', c.province_id || '',
      salesName, dist.name || '', prov.name_en || '', statGroup,
      customerFullName(c), _dashPaymentTerms(c), tid, _round2(parseFloat(c.credit_limit) || 0), custGroup,
      c.address || '', '', salesName, c.area_code || '', c.area_code || '',
      prov.name || '', prov.region || '', '',
      // ★ คีย์ที่ปลายทางใช้เชื่อมกับไฟล์ยอดขาย — ค่าเดียวกับ CustomerAccount
      acct
    ]);
  });
  return out;
}

/** เขียน customer.csv — เรียกต่อจากไฟล์ยอดขายในรอบเดียวกัน */
function exportCustomerFile() {
  var rows = _dashCustomerRows();
  var folder = _dashCustomerFolder();
  var fileId = _dashWriteCsv('customer', _dashCsvText(rows, DASH_CUST_HEADERS), folder);
  return { rows: rows.length, fileId: fileId, folderId: folder.getId(), folderName: folder.getName(),
    url: 'https://drive.google.com/file/d/' + fileId + '/view' };
}

/* ═══════════════ ตัวที่ trigger เรียก ═══════════════
   ★ ฟังก์ชันที่ trigger เรียกต้อง **ไม่รับอาร์กิวเมนต์** และห้าม throw ออกไป
     ไม่งั้น Apps Script ส่งอีเมลแจ้ง error ทุกชั่วโมงจนคนเลิกอ่าน แล้วของพังจริงก็ไม่มีใครเห็น */
function runDashboardExport() {
  var out = { success: true, customers: null, sales: null };

  /* ★★★ สองงานนี้ต้อง **ล้มแยกกัน** — เดิมอยู่ใน try เดียวกันและทะเบียนร้านค้ามาก่อน
     ถ้ามันพัง (เช่นโฟลเดอร์ปลายทางเข้าไม่ถึง) ไฟล์ยอดขายก็ไม่ถูกเขียนตามไปด้วย
     ทั้งที่ไม่ได้เกี่ยวอะไรกันเลย · งานหนึ่งพังอีกงานต้องยังทำงาน */
  try {
    var cu = exportCustomerFile();
    /* ★★ log ต้องบอก **โฟลเดอร์ปลายทาง** ด้วยเสมอ — คำถามแรกเวลาไฟล์ "ไม่มา" คือ
       "มันไปลงที่ไหน" ซึ่งถ้า log ไม่บอก ต้องไล่เปิด Drive ทีละโฟลเดอร์เอง */
    Logger.log('ทะเบียนร้านค้า: ' + cu.rows + ' ร้าน → โฟลเดอร์ "' + cu.folderName + '" (' +
      cu.folderId + ') · ' + cu.url);
    out.customers = cu;
  } catch (e) {
    out.success = false;
    Logger.log('✖ ทะเบียนร้านค้าล้มเหลว: ' + e.message +
      ' — ตรวจ Script Property DASHBOARD_CUSTOMER_FOLDER_ID ว่าชี้โฟลเดอร์ที่บัญชีนี้เข้าถึงได้');
  }

  try {
    var r = exportSalesDashboardFiles({});
    Logger.log('ยอดขาย: ' + r.rows + ' แถว · ' +
      r.files.map(function(f) { return f.tenantId + '=' + (f.error || f.rows); }).join(' · '));
    /* ★★ ใบที่ยอดไม่ตรง ต้องโผล่ใน log ทุกครั้ง ไม่ใช่รอให้คนไปกระทบยอดเจอเองปลายเดือน */
    r.files.forEach(function(f) {
      (f.mismatches || []).forEach(function(m) {
        Logger.log('⚠ ' + f.tenantId + ' ' + m.docNo + ' (' + m.orderCode + '): ' + m.why +
          ' — ในไฟล์ ' + m.actual + ' · บนใบ ' + m.expected + ' · ต่าง ' + m.diff);
      });
    });
    out.sales = r;
  } catch (e) {
    out.success = false;
    Logger.log('✖ ส่งออกยอดขายล้มเหลว: ' + e.message);
  }
  return out;
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
    var out = exportSalesDashboardFiles({ dateFrom: payload.dateFrom, dateTo: payload.dateTo });
    out.customers = exportCustomerFile();
    return out;
  } catch (e) {
    return { success: false, message: 'ส่งออกไม่สำเร็จ: ' + e.message };
  }
}

/* ═══════════════ ยังไม่ได้ทำ (ตั้งใจ) ═══════════════
 * - ยังไม่รวม "ของที่รับคืนโดยยังไม่ออกใบลดหนี้" — ตราบใดที่ยังไม่ออกใบลดหนี้ ยอดขายยังไม่ถูกปรับ
 *   ซึ่งถูกตามหลักภาษี แต่ถ้าคลังรับของคืนไว้นานก่อนออกใบ ยอดในไฟล์จะสูงกว่าของจริงชั่วคราว
 */
