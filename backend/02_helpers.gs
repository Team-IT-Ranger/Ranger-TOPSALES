/**
 * ===================== SHEET ACCESS LAYER =====================
 * สถาปัตยกรรมข้อมูล:
 *   Central Sheet (1 ไฟล์)   — liff_users, admin_users, tenants, products, product_groups,
 *                              customers, customer_groups, discount_rules, roles, role_permissions,
 *                              doc_number_series, doc_number_counters, provinces, districts, subdistricts
 *   Tenant Sheet (1 ไฟล์/ตัวแทน) — sales_orders, order_items, order_discounts, van_stock,
 *                              stock_movements, stock_counts, visits, visit_notes, competitor_logs
 * เหตุผล: สินค้า/ราคา/โปรโมชั่น/ลูกค้า บริษัทเจ้าของสินค้าคุมจากศูนย์กลาง
 *         ส่วนข้อมูลธุรกรรมรายวันแยกไฟล์ต่อตัวแทน กันข้อมูลปนกันระหว่างตัวแทน
 */

/* ═══════════ ชั้นอ่านข้อมูล: ทำไมต้องมีแคช (วัดจริง 2026-09-24) ═══════════
 * ค่าคงที่ต่อ 1 คำขอของ Apps Script Web App ≈ 1.6 วินาที (แค่ routing ยังไม่แตะชีต)
 * เปิด Spreadsheet 1 ไฟล์ (+อ่าน 1 ชีต) ≈ +1.5 วินาที · เปิดแอปครั้งหนึ่งเคยใช้ ~32 วินาที
 * มาตรการ:
 *   1) _objMemo — ภายในคำขอเดียวกัน อ่านชีตเดิมซ้ำไม่ต้องอ่านใหม่ (หน้าชุดราคาเคยอ่านซ้ำ 3 รอบ)
 *   2) SHEET_CACHE_TABLES — ตารางแม่ที่เปลี่ยนน้อย แคชข้ามคำขอด้วย CacheService (TTL 5 นาที)
 *      ล้างอัตโนมัติทุกครั้งที่เขียนผ่าน centralAppend/centralUpdate/centralAppendMany/deleteRowsWhere
 *      ที่เขียนชีตแบบดิบ (getRange().setValue) ต้องเรียก centralInvalidate('<ชีต>') เองเสมอ
 *   3) ห้ามแคช: ตารางเอกสาร/ธุรกรรม, ตัวนับเลขที่เอกสาร, liff_users, admin_users (ความถูกต้องสำคัญกว่าความเร็ว)
 */
var SHEET_CACHE_TTL = 300;
var SHEET_CACHE_TABLES = {
  products: 1, product_units: 1, product_groups: 1, customers: 1, customer_groups: 1,
  tenants: 1, roles: 1, role_permissions: 1, company_profile: 1,
  price_lists: 1, price_list_items: 1, price_list_bill_promos: 1,
  distribution_channels: 1, payment_types: 1, discount_rules: 1,
  vendors: 1, warehouses: 1, approval_flows: 1, approval_flow_steps: 1, gl_accounts: 1
};
var _objMemo = {};

// วันที่จาก Sheets เป็น object Date — แปลงเป็นสตริงมาตรฐานของระบบก่อนเข้าแคช
// เพื่อให้แถวที่มาจากแคชกับที่อ่านสดมีหน้าตาเหมือนกันเป๊ะ (ไม่งั้นการเรียงวันที่จะเพี้ยนเมื่อปนกัน)
function _normalizeRowDates(rows) {
  return rows.map(function(r) {
    var o = {};
    for (var k in r) o[k] = (r[k] instanceof Date) ? safeDateStr(r[k]) : r[k];
    return o;
  });
}
function _sheetCacheKey(name) { return 'sheet_' + name + '_v1'; }
function centralInvalidate(name) {
  delete _objMemo[name];
  if (SHEET_CACHE_TABLES[name]) { try { CacheService.getScriptCache().remove(_sheetCacheKey(name)); } catch (e) {} }
}

// เก็บ Spreadsheet ที่เปิดแล้วไว้ในการทำงานครั้งนี้ กันเปิดซ้ำ (openById มีต้นทุน)
var _ssCache = {};
function _openSpreadsheet(fileId) {
  if (!fileId) throw new Error('ไม่ได้ระบุ Spreadsheet File ID');
  if (!_ssCache[fileId]) _ssCache[fileId] = SpreadsheetApp.openById(fileId);
  return _ssCache[fileId];
}

function _getSheetByFileId(fileId, sheetName) {
  if (!sheetName) throw new Error('ไม่ระบุชื่อ sheet');
  var ss = _openSpreadsheet(fileId);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('ไม่พบ Sheet: ' + sheetName + ' (fileId: ' + fileId + ')');
  return sh;
}

// ── CENTRAL ──
function centralFileId() {
  var id = getConfig().CENTRAL_SHEET_FILEID;
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า CENTRAL_SHEET_FILEID ใน Script Properties');
  return id;
}
function centralSheet(name) { return _getSheetByFileId(centralFileId(), name); }
function centralObjects(name) {
  if (_objMemo[name]) return _objMemo[name];
  if (SHEET_CACHE_TABLES[name]) {
    try {
      var raw = CacheService.getScriptCache().get(_sheetCacheKey(name));
      if (raw) { _objMemo[name] = JSON.parse(raw); return _objMemo[name]; }
    } catch (e) { /* แคชมีปัญหา → อ่านชีตตามปกติ */ }
  }
  var rows = sheetObjectsOf(centralSheet(name));
  if (SHEET_CACHE_TABLES[name]) {
    rows = _normalizeRowDates(rows);
    try {
      var json = JSON.stringify(rows);
      if (json.length < 90000) CacheService.getScriptCache().put(_sheetCacheKey(name), json, SHEET_CACHE_TTL);
    } catch (e) { /* ใหญ่เกินหรือแคชล่ม — ไม่เป็นไร */ }
  }
  _objMemo[name] = rows;
  return rows;
}
function centralAppend(name, obj) { centralInvalidate(name); return appendRowToSheet(centralSheet(name), obj); }
function centralUpdate(name, recordId, obj) { centralInvalidate(name); return updateRowInSheet(centralSheet(name), recordId, obj); }
function centralNextId(name) { return nextIdOf(centralSheet(name)); }

// ── TENANT ──
// tenantId → sheet_file_id: cache 6 ชม. เพราะแทบไม่เปลี่ยน (เปลี่ยนเฉพาะตอนสร้าง/ย้ายตัวแทน)
function tenantFileId(tenantId) {
  if (!tenantId) throw new Error('ไม่ระบุ tenantId');
  var cache = CacheService.getScriptCache();
  var cacheKey = 'tenant_fileid_' + tenantId;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var tenants = centralObjects('tenants');
  for (var i = 0; i < tenants.length; i++) {
    if (String(tenants[i].tenant_id) === String(tenantId)) {
      var fileId = tenants[i].sheet_file_id;
      if (!fileId) throw new Error('ตัวแทน ' + tenantId + ' ยังไม่มี sheet_file_id');
      cache.put(cacheKey, fileId, 21600);
      return fileId;
    }
  }
  throw new Error('ไม่พบตัวแทน (tenant_id): ' + tenantId);
}
function tenantSheet(tenantId, name) { return _getSheetByFileId(tenantFileId(tenantId), name); }
function tenantObjects(tenantId, name) { return sheetObjectsOf(tenantSheet(tenantId, name)); }
function tenantAppend(tenantId, name, obj) { return appendRowToSheet(tenantSheet(tenantId, name), obj); }
function tenantUpdate(tenantId, name, recordId, obj) { return updateRowInSheet(tenantSheet(tenantId, name), recordId, obj); }
function tenantNextId(tenantId, name) { return nextIdOf(tenantSheet(tenantId, name)); }

// ===================== GENERIC SHEET <-> OBJECT =====================
function sheetObjectsOf(sh) {
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    // ข้ามแถวว่างสนิท (record_id ว่าง)
    if (data[i][0] === '' || data[i][0] === null) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
    result.push(obj);
  }
  return result;
}

function appendRowToSheet(sh, obj) {
  try { centralInvalidate(sh.getName()); } catch (e) {}
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
  return sh.getLastRow();
}

// เติมหลายแถวรวดเดียว (setValues ครั้งเดียว) — นำเข้าไฟล์ทีละแถวด้วย appendRow ช้ามากจนใช้ไม่ได้
function appendRowsToSheet(sh, objs) {
  if (!objs.length) return 0;
  try { centralInvalidate(sh.getName()); } catch (e) {}
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = objs.map(function(o) { return headers.map(function(h) { return o[h] !== undefined ? o[h] : ''; }); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}
function centralAppendMany(name, objs) { centralInvalidate(name); return appendRowsToSheet(centralSheet(name), objs); }

/* ═══════════ ค่า TRUE/FALSE จาก Google Sheets ═══════════
 * กับดักที่เคยทำให้บั๊กเงียบมาก่อน: เราเขียนข้อความ 'TRUE' ลงชีต แต่ Sheets แปลงเป็น checkbox/boolean ให้เอง
 * อ่านกลับมาจึงได้ boolean true → String(true) === 'true' ไม่ใช่ 'TRUE' → เงื่อนไขแบบ String(x) === 'TRUE' เป็นเท็จเสมอ
 * (ผลที่เคยเกิด: โปรโมชั่นเดิมไม่เคยถูกใช้เลย, รายชื่อตัวแทนว่าง, ล็อกรหัสสินค้าไม่ทำงาน)
 * ใช้ 3 ตัวนี้แทนการเทียบสตริงตรงๆ ทุกที่:
 *   isFlagOn(v)  — จริงชัดเจน (true / 'TRUE' / 'true' / 1 / '1' / 'yes')
 *   isFlagOff(v) — เท็จชัดเจน (false / 'FALSE' / 'false' / 0 / '0' / 'no')
 *   isNotOff(v)  — "ยังไม่ถูกปิด" (ค่าว่าง/ไม่ได้ตั้ง = ถือว่าเปิด) ใช้กับคอลัมน์ที่ของเก่าไม่เคยกรอก
 */
function isFlagOn(v) {
  if (v === true || v === 1) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}
function isFlagOff(v) {
  if (v === false || v === 0) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  return s === 'false' || s === '0' || s === 'no' || s === 'n';
}
function isNotOff(v) { return !isFlagOff(v); }

// ลบทุกแถวที่คอลัมน์ colName = value (ลบจากล่างขึ้นบน ไม่ให้เลขแถวเลื่อน)
function deleteRowsWhere(sh, colName, value) {
  try { centralInvalidate(sh.getName()); } catch (e) {}
  var data = sh.getDataRange().getValues();
  var col = data[0].indexOf(colName); if (col === -1) return 0;
  var n = 0;
  for (var i = data.length - 1; i >= 1; i--) if (String(data[i][col]) === String(value)) { sh.deleteRow(i + 1); n++; }
  return n;
}

// อัปเดตบางฟิลด์ของแถวที่ record_id ตรงกับที่ระบุ (partial update ตาม key ที่ส่งมาใน obj)
function updateRowInSheet(sh, recordId, obj) {
  try { centralInvalidate(sh.getName()); } catch (e) {}
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('record_id');
  if (idCol === -1) throw new Error('Sheet ' + sh.getName() + ' ไม่มีคอลัมน์ record_id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(recordId)) {
      var rowNum = i + 1;
      Object.keys(obj).forEach(function(key) {
        var col = headers.indexOf(key);
        if (col !== -1) sh.getRange(rowNum, col + 1).setValue(obj[key]);
      });
      return true;
    }
  }
  return false;
}

function findRowIndexById(sh, recordId) {
  var data = sh.getDataRange().getValues();
  var idCol = data[0].indexOf('record_id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(recordId)) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

function nextIdOf(sh) {
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return 1;
  var idCol = data[0].indexOf('record_id');
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    var v = parseInt(data[i][idCol]) || 0;
    if (v > max) max = v;
  }
  return max + 1;
}

// ===================== MISC HELPERS =====================
function nowStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function genCode(prefix) {
  var d = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  return prefix + '-' + d + '-' + Math.floor(1000 + Math.random() * 9000);
}

// กัน Date object หลุดไปกับ google.script.run แล้วฝั่ง client deserialize พัง
function safeDateStr(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return String(value || '');
}
