/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  จังหวัด / อำเภอ ของลูกค้า (2026-10-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ทะเบียนลูกค้ามีช่อง `province_id` / `district_id` มาตั้งแต่ต้น แต่**ว่างทั้ง 2,039 ราย**
 * เพราะตอนนำเข้าจาก BDC เก็บที่อยู่เป็นก้อนเดียว (ดู CLAUDE.md หัวข้อทะเบียนลูกค้า)
 * ทำให้ตั้งกฎราคาตามภูมิภาคไม่ได้ และเวลาส่งออกไฟล์ Express ต้องไปพึ่งไฟล์ xlsx ภายนอกทุกครั้ง
 *
 * ★ รหัสอำเภอมาจากชีต `amphur` ของ Smartsales — ตรวจแล้วว่า **ไม่ซ้ำกันทั้งประเทศ** (982 รหัส/982 แถว)
 *   จึงใช้เป็น `districts.id` ตรงๆ ได้ ไม่ต้องสร้างรหัสใหม่ให้ต้องมาแปลงกลับทีหลัง
 * ★ `customers.district_id` เก็บรหัสเดียวกันนี้ · `province_id` เก็บรหัสจังหวัดมาตรฐาน (20 = ชลบุรี)
 *   ซึ่งตรงกับ `_seedProvinces()` ที่ลงไว้ตั้งแต่ตั้งระบบ
 */

/** จังหวัด+อำเภอทั้งหมด — หน้าเว็บเอาไปทำ dropdown และแปลงรหัสเป็นชื่อในตาราง */
function listAddressRefs(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  var provinces = centralObjects('provinces').map(function(p) {
    return { id: String(p.id), name: p.name || '', region: p.region || '' };
  });
  var districts = centralObjects('districts').map(function(d) {
    return { id: String(d.id), name: d.name || '', provinceId: String(d.province_id || '') };
  });
  return { success: true, provinces: provinces, districts: districts };
}

/**
 * เติมตารางอ้างอิงจังหวัด/อำเภอ (ครั้งเดียว — ข้อมูลอ้างอิง ไม่ใช่ข้อมูลธุรกรรม)
 * payload: { provinces?: [{id,name}], districts?: [{id,name,provinceId}] }
 * ★ เขียนทับทั้งตาราง ไม่ใช่เติมต่อท้าย — รันซ้ำแล้วไม่เกิดแถวซ้ำ และแก้ชื่อที่พิมพ์ผิดได้ด้วยการรันใหม่
 */
function importAddressRefs(session, payload) {
  var err = _requirePermission(session, 'settings', 'edit'); if (err) return err;
  payload = payload || {};
  var out = {};

  if (payload.provinces && payload.provinces.length) {
    var ps = payload.provinces.filter(function(p) { return p && String(p.id || '').trim(); });
    var sh = centralSheet('provinces');
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    centralInvalidate('provinces');
    centralAppendMany('provinces', ps.map(function(p) {
      return { id: String(p.id).trim(), name: String(p.name || '').trim(),
               name_en: String(p.nameEn || '').trim(), region: String(p.region || '').trim() };
    }));
    out.provinces = ps.length;
  }

  if (payload.districts && payload.districts.length) {
    var ds = payload.districts.filter(function(d) { return d && String(d.id || '').trim(); });
    var sh2 = centralSheet('districts');
    if (sh2.getLastRow() > 1) sh2.getRange(2, 1, sh2.getLastRow() - 1, sh2.getLastColumn()).clearContent();
    centralInvalidate('districts');
    centralAppendMany('districts', ds.map(function(d) {
      return { id: String(d.id).trim(), name: String(d.name || '').trim(),
               name_en: String(d.nameEn || '').trim(), province_id: String(d.provinceId || '').trim() };
    }));
    out.districts = ds.length;
  }

  if (!out.provinces && !out.districts) return { success: false, message: 'ไม่มีข้อมูลให้เติม' };
  return { success: true, message: 'เติมข้อมูลอ้างอิงแล้ว', counts: out };
}

/**
 * เติมจังหวัด/อำเภอให้ลูกค้าที่ยังว่าง — จับคู่ด้วย `external_code` (รหัสจากระบบเดิมของตัวแทน)
 * payload: { items: [{ externalCode, provinceId, districtId }], overwrite?: bool, tenantId? }
 *
 * ★ เขียนด้วย `updateColumnsWhere` ซึ่งเขียนครั้งเดียวต่อ "คอลัมน์" ไม่ใช่ต่อแถว —
 *   `centralUpdate` ทีละแถว 2,000 ครั้งชนเพดาน 6 นาทีของ Apps Script แน่นอน (บทเรียนจาก 37_customer_bulk.gs)
 * ★ ค่าตั้งต้นคือ **ไม่ทับของเดิม** — เติมเฉพาะแถวที่ยังว่าง · ส่ง overwrite:true ถึงจะทับ
 *   (ถ้าใครแก้จังหวัดด้วยมือไว้ การรันสคริปต์ซ้ำไม่ควรลบงานเขานิ่งๆ)
 */
function backfillCustomerAreas(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var items = payload.items || [];
  if (!items.length) return { success: false, message: 'ไม่มีรายการให้เติม' };

  var scope = _effectiveTenantId(session, payload);
  var overwrite = !!payload.overwrite;

  var map = {};
  items.forEach(function(it) {
    var k = String(it.externalCode || '').trim();
    if (k) map[k] = { p: String(it.provinceId || '').trim(), d: String(it.districtId || '').trim() };
  });

  // ตรวจว่ารหัสที่ส่งมามีอยู่จริงในตารางอ้างอิง — รหัสผิดแล้วเงียบคือสิ่งที่เจ็บที่สุดของงานแบบนี้
  var okProv = {}, okDist = {};
  centralObjects('provinces').forEach(function(p) { okProv[String(p.id)] = 1; });
  centralObjects('districts').forEach(function(d) { okDist[String(d.id)] = 1; });
  var badProv = {}, badDist = {};
  Object.keys(map).forEach(function(k) {
    if (map[k].p && !okProv[map[k].p]) badProv[map[k].p] = 1;
    if (map[k].d && !okDist[map[k].d]) badDist[map[k].d] = 1;
  });
  var bp = Object.keys(badProv), bd = Object.keys(badDist);
  if (bp.length || bd.length) {
    return { success: false, message: 'มีรหัสที่ไม่มีในตารางอ้างอิง — เติมตารางก่อน (importAddressRefs) · ' +
      (bp.length ? 'จังหวัด: ' + bp.slice(0, 5).join(',') + ' ' : '') +
      (bd.length ? 'อำเภอ: ' + bd.slice(0, 5).join(',') : '') };
  }

  var matched = 0, filled = 0;
  var res = updateColumnsWhere(centralSheet('customers'), function(row) {
    if (scope && String(row.tenant_id) !== String(scope)) return false;
    var m = map[String(row.external_code || '').trim()];
    if (!m) return false;
    matched++;
    return true;
  }, {
    province_id: function(row) {
      var m = map[String(row.external_code || '').trim()];
      if (!m || !m.p) return undefined;
      if (!overwrite && String(row.province_id || '').trim()) return undefined;
      return m.p;
    },
    district_id: function(row) {
      var m = map[String(row.external_code || '').trim()];
      if (!m || !m.d) return undefined;
      if (!overwrite && String(row.district_id || '').trim()) return undefined;
      filled++;
      return m.d;
    }
  });

  centralInvalidate('customers');
  return { success: true, matched: matched, columnsWritten: res.columns,
    message: 'เติมจังหวัด/อำเภอให้ลูกค้า ' + matched + ' ราย' };
}
