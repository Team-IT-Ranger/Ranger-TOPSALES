/**
 * 44_product_categories.gs — หมวดสินค้าหลัก 2 ชั้น: Category / subCategory (3 ต.ค. 2026, เจ้าของระบบสั่ง)
 *
 * สองคอลัมน์นี้ (`products.category`, `products.sub_category`) เป็น "main grouping" ในการจัดกลุ่มสินค้า —
 * ที่มาคือชีตกลางของบริษัท (ไฟล์เดียวกับ FactSales, 43_external_sales_import.gs) แท็บ **lu_prodcate**
 * (ProductNumber / SalesUnit / Category / subCategory ~300 แถว) จับคู่กับสินค้าด้วยรหัส (product_code หรือ alias_codes)
 *
 * คนละเรื่องกับ `products.group_id` (กลุ่มสินค้าเดิมที่สร้างจากไฟล์นำเข้า) — ไม่แตะ ไม่ทับ
 */
var PRODUCT_CATEGORY_TAB = 'lu_prodcate';

/** อ่านแท็บ lookup → { 'รหัสพิมพ์เล็ก': { category, subCategory } } + รายการรหัสที่ซ้ำแต่ค่าไม่ตรงกัน (ใช้แถวแรก) */
function _readProductCategoryLookup() {
  var ss = SpreadsheetApp.openById(EXTERNAL_SALES_SHEET_ID);
  var sh = ss.getSheetByName(PRODUCT_CATEGORY_TAB);
  if (!sh) throw new Error('ไม่พบแท็บ "' + PRODUCT_CATEGORY_TAB + '" ในไฟล์ชีตกลาง');
  var values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error('แท็บ "' + PRODUCT_CATEGORY_TAB + '" ไม่มีข้อมูล');
  var head = values[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var iCode = head.indexOf('productnumber'), iCat = head.indexOf('category'), iSub = head.indexOf('subcategory');
  if (iCode < 0 || iCat < 0 || iSub < 0) throw new Error('แท็บ "' + PRODUCT_CATEGORY_TAB + '" ต้องมีหัวคอลัมน์ ProductNumber / Category / subCategory');
  var map = {}, conflicts = [];
  for (var r = 1; r < values.length; r++) {
    var code = String(values[r][iCode] == null ? '' : values[r][iCode]).trim().toLowerCase();
    if (!code) continue;
    var cat = String(values[r][iCat] == null ? '' : values[r][iCat]).trim(), sub = String(values[r][iSub] == null ? '' : values[r][iSub]).trim();
    if (map[code]) { if (map[code].category !== cat || map[code].subCategory !== sub) conflicts.push(code); continue; }
    map[code] = { category: cat, subCategory: sub };
  }
  return { map: map, rows: values.length - 1, conflicts: conflicts };
}

/** ตัดสินว่าสินค้าตัวนี้ควรได้ค่าอะไร — ฟังก์ชันล้วน ไม่เขียนอะไร (เทสต์ได้โดยไม่ต้องมีชีต) */
function _planProductCategories(products, lookup, overwrite) {
  var plan = { updates: [], matched: 0, unchanged: 0, keptManual: 0, unmatched: [] };
  products.forEach(function(p) {
    var hit = null, codes = _productAllCodes(p);
    for (var i = 0; i < codes.length && !hit; i++) hit = lookup[codes[i]] || null;
    if (!hit) { plan.unmatched.push(String(p.product_code || p.record_id)); return; }
    plan.matched++;
    var curCat = String(p.category || '').trim(), curSub = String(p.sub_category || '').trim();
    if (curCat === hit.category && curSub === hit.subCategory) { plan.unchanged++; return; }
    var fields = {};
    // ค่าเดิมที่คนกรอกเองไว้ไม่ถูกทับ เว้นแต่สั่ง overwrite — เติมเฉพาะช่องที่ยังว่าง
    if (hit.category && (overwrite || !curCat)) fields.category = hit.category;
    if (hit.subCategory && (overwrite || !curSub)) fields.sub_category = hit.subCategory;
    if (!Object.keys(fields).length) { plan.keptManual++; return; }
    plan.updates.push({ id: p.record_id, code: String(p.product_code || ''), fields: fields });
  });
  return plan;
}

/**
 * ซิงก์ Category/subCategory จากแท็บ lu_prodcate เข้าทะเบียนสินค้า (เฉพาะฝั่งบริษัท — ทะเบียนสินค้าเป็นข้อมูลกลาง)
 * payload: { dryRun?: bool (ดูอย่างเดียว), overwrite?: bool (ทับค่าที่มีอยู่แล้วด้วย — ปกติเติมเฉพาะช่องว่าง) }
 */
function syncProductCategories(session, payload) {
  var err = _requirePermission(session, 'products', 'edit'); if (err) return err;
  if (!_isCompanySide(session)) return { success: false, message: 'ทะเบียนสินค้าเป็นข้อมูลกลางของบริษัท — ซิงก์หมวดสินค้าได้เฉพาะฝั่งบริษัท' };
  payload = payload || {};
  var lookup;
  try { lookup = _readProductCategoryLookup(); } catch (e) { return { success: false, message: e.message }; }
  var plan = _planProductCategories(centralObjects('products'), lookup.map, !!payload.overwrite);
  if (!payload.dryRun) {
    var by = String(session.adminUserId || ''), at = nowStr();
    plan.updates.forEach(function(u) {
      var f = Object.assign({}, u.fields, { updated_at: at, updated_by: by });
      centralUpdate('products', u.id, f);
    });
  }
  return { success: true, dryRun: !!payload.dryRun, lookupRows: lookup.rows, conflicts: lookup.conflicts.slice(0, 20),
    matched: plan.matched, updated: plan.updates.length, unchanged: plan.unchanged, keptManual: plan.keptManual,
    unmatched: plan.unmatched.length, unmatchedSample: plan.unmatched.slice(0, 30),
    sample: plan.updates.slice(0, 20).map(function(u) { return { code: u.code, category: u.fields.category, subCategory: u.fields.sub_category }; }),
    message: (payload.dryRun ? 'ตรวจแล้ว (ยังไม่บันทึก): ' : 'ซิงก์แล้ว: ') + plan.updates.length + ' รายการ' + (payload.dryRun ? 'ที่จะเปลี่ยน' : 'ที่เปลี่ยน') +
      ' · ตรงกับชีต ' + plan.matched + ' จาก ' + (plan.matched + plan.unmatched.length) + ' สินค้า' };
}

/**
 * รันจาก Apps Script editor ได้เลยโดยไม่ต้อง Deploy → New version (editor รันโค้ดที่ HEAD) — ไม่ผ่าน session/สิทธิ์
 * ใช้ตอนเปิดคอลัมน์ใหม่ครั้งแรกในแต่ละ env: เติมคอลัมน์ category/sub_category ให้ตารางสินค้า (ensureSchemaCurrent) แล้วเติมค่าจากชีต
 * เติมเฉพาะช่องที่ยังว่าง ไม่ทับที่กรอกเองไว้ · รันซ้ำได้ · ดูผลที่ View → Logs / Execution log
 * ใส่ DRY_RUN = true เพื่อดูอย่างเดียว
 */
function runSyncProductCategories() {
  var DRY_RUN = false;
  ensureSchemaCurrent(true);   // เพิ่มคอลัมน์ใหม่ในชีต products ถ้ายังไม่มี
  var lookup = _readProductCategoryLookup();
  var plan = _planProductCategories(centralObjects('products'), lookup.map, false);
  if (!DRY_RUN) plan.updates.forEach(function(u) {
    centralUpdate('products', u.id, Object.assign({}, u.fields, { updated_at: nowStr(), updated_by: 'system:category-sync' }));
  });
  Logger.log((DRY_RUN ? '[ดูอย่างเดียว] ' : '') + 'ชีต ' + lookup.rows + ' แถว · ตรงกับสินค้า ' + plan.matched + ' · เปลี่ยน ' + plan.updates.length +
    ' · ไม่พบรหัสในชีต ' + plan.unmatched.length + (plan.unmatched.length ? ' (' + plan.unmatched.slice(0, 20).join(', ') + ')' : '') +
    (lookup.conflicts.length ? ' · รหัสซ้ำค่าไม่ตรงกัน: ' + lookup.conflicts.slice(0, 10).join(', ') : ''));
}
