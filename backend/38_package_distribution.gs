/**
 * ===================== การจ่ายชุดราคา/โปรโมชั่นให้ตัวแทน (package distribution) =====================
 * กติกาเจ้าของระบบ 27 ก.ย. 2026: "ชุดราคาและโปรโมชั่นที่ส่วนกลางเตรียมไว้ จะไม่เอาทุกชุดไปโยนให้ตัวแทน
 * แบบเหมารวม" — ต้องกำหนดได้ว่าชุดไหนใช้กับตัวแทนใดได้ และใช้กับลูกค้าแบบไหน
 *
 * ★ สองชั้นแยกกัน ต้องผ่านทั้งคู่ — คนละคำถามกัน อย่ายุบรวม
 *     ชั้น A  การจ่ายชุด   "ตัวแทนรายไหนได้รับชุดนี้"        ← ไฟล์นี้ · บริษัทกลางเป็นคนมอบ
 *     ชั้น B  สิทธิ์ลูกค้า  "ภายในตัวแทนนั้น ร้านแบบไหนได้ใช้" ← 36_price_rules.gs · เป็นการกรอง
 *   ชั้น B ทำชั้น A แทนไม่ได้ ถึงจะเขียนเงื่อนไข tenant_id ได้ก็ตาม เพราะกฎตอบได้แค่ "ร้านนี้ได้ชุดไหน"
 *   (ต้องไล่ทีละร้าน) ส่วนหน้าจอจ่ายงานและฝั่งตัวแทนต้องการคำตอบของ "ตัวแทนนี้มีชุดอะไรบ้าง" ทันที
 *
 * ★ ไม่ระบุตัวแทน = ไม่มีใครได้ (เจ้าของระบบเลือกเอง) — ไม่ใช่ "แปลว่าทุกคน"
 *   ค่าเริ่มต้นแบบ "ทุกคน" คือสิ่งที่ทำให้เกิดการเหมารวมตั้งแต่แรก · ชุดที่มีอยู่ก่อนกติกานี้ถูกเขียนแถว
 *   ให้ครบทุกตัวแทนด้วย `migratePackageAssignments()` เพื่อไม่ให้ของที่ขายอยู่สะดุด — หลังจากนั้น
 *   ชุดใหม่ทุกชุดต้องเลือกตัวแทนเองเสมอ
 *
 * ★ ตัวแทนดูได้อย่างเดียว แก้ไม่ได้ (เจ้าของระบบเลือกเอง) — ราคาต้องคุมจากส่วนกลางทั้งหมด
 */

var PKG_PRICE_LIST = 'price_list';
var PKG_PROMO = 'promo';
var PKG_TYPES = {};
PKG_TYPES[PKG_PRICE_LIST] = { label: 'ชุดราคา', sheet: 'price_lists', nameCol: 'name' };
PKG_TYPES[PKG_PROMO] = { label: 'โปรโมชั่น', sheet: 'discount_rules', nameCol: 'name' };

function _pkgKey(type, id) { return String(type) + '|' + String(id); }

/**
 * ดัชนีการจ่ายชุด — อ่านชีตครั้งเดียวต่อคำขอ (ตารางนี้อยู่ในลิสต์แคชแล้ว)
 * @return { map: { 'ชนิด|id': { tenantId: 1 } }, any: มีการจ่ายชุดอย่างน้อยหนึ่งแถวไหม }
 *
 * ★ ชีตอาจยังไม่มี: สคีมาถูกเติมตอนล็อกอินครั้งถัดไป (ensureSchemaCurrent) ไม่ใช่ตอน deploy
 *   จึงมีช่วงหลัง deploy ที่ตารางนี้ยังไม่เกิด — อ่านไม่ได้ต้องไม่ทำให้ทั้งระบบล้ม
 */
function packageTenantIndex() {
  var rows = [];
  try {
    rows = centralObjects('package_tenants');
  } catch (e) {
    // ชีตยังไม่มี → เติมสคีมาให้แล้วลองใหม่ครั้งเดียว (deploy ใหม่แล้วยังไม่มีใครล็อกอิน)
    try { ensureSchemaCurrent(); rows = centralObjects('package_tenants'); }
    catch (e2) { Logger.log('packageTenantIndex: อ่าน package_tenants ไม่ได้ — ' + e2); rows = []; }
  }
  var map = {};
  rows.forEach(function(r) {
    var k = _pkgKey(r.package_type, r.package_id);
    (map[k] = map[k] || {})[String(r.tenant_id)] = 1;
  });
  return { map: map, any: rows.length > 0 };
}

/**
 * ชุดนี้จ่ายให้ตัวแทนรายนี้หรือยัง
 * @param idx ดัชนีจาก packageTenantIndex() — ส่งเข้ามาเพื่อไม่ให้อ่านชีตซ้ำในลูป
 * tenantId ว่าง = ขายในนามบริษัทเอง ซึ่งใช้ตัวแทนบ้าน HOUSE (ดู _salesTenantId) จึงเทียบกับ HOUSE
 */
function packageAllowedForTenant(idx, type, id, tenantId) {
  /* ★ ยังไม่มีการจ่ายชุด "สักแถวเดียวในระบบ" = ยังไม่ได้เริ่มใช้เรื่องนี้ → ยังไม่กั้น
     ต่างจาก "ชุดนี้ไม่ได้ถูกจ่ายให้ใคร" ซึ่งกั้นตามกติกา · ถ้าเหมารวมสองอย่างนี้เป็นอันเดียวกัน
     ช่วงหลัง deploy ก่อนรัน migratePackageAssignments จะกลายเป็นว่า "ทุกร้านในระบบเปิดบิลไม่ได้"
     ทันที โดยไม่มีอะไรฟ้องนอกจากพนักงานขายโทรมา — ราคาที่แพงเกินไปสำหรับค่าตั้งต้น */
  if (!idx || !idx.any) return true;
  var set = idx.map[_pkgKey(type, id)];
  if (!set) return false;                       // ไม่ระบุ = ไม่มีใครได้
  var t = String(tenantId || HOUSE_TENANT_ID);
  return set[t] === 1;
}

/** รายชื่อตัวแทนที่ได้รับชุดนี้ (เรียงตามรหัส) */
function packageTenantsOf(type, id) {
  var set = packageTenantIndex().map[_pkgKey(type, id)] || {};
  return Object.keys(set).sort();
}

/* ═══════════════ หน้าจอ: จ่ายชุดให้ตัวแทน (บริษัทกลางเท่านั้น) ═══════════════ */

/** ตัวแทนทั้งหมดที่จ่ายชุดให้ได้ (รวมตัวแทนบ้าน = ขายตรงในนามบริษัท) */
function _pkgAssignableTenants() {
  return centralObjects('tenants')
    .filter(function(t) { return isNotOff(t.is_active); })
    .map(function(t) {
      return { tenantId: String(t.tenant_id), name: String(t.name || t.tenant_id),
        isHouse: isFlagOn(t.is_house) };
    })
    .sort(function(a, b) { return (b.isHouse ? 1 : 0) - (a.isHouse ? 1 : 0) || a.tenantId.localeCompare(b.tenantId); });
}

/** ชุดนี้จ่ายให้ใครบ้าง + รายชื่อตัวแทนทั้งหมดให้หน้าเว็บทำเช็คบ็อกซ์ */
function listPackageTenants(session, payload) {
  payload = payload || {};
  var type = String(payload.packageType || PKG_PRICE_LIST);
  if (!PKG_TYPES[type]) return { success: false, message: 'ชนิดชุดไม่ถูกต้อง' };
  var err = _requirePermission(session, type === PKG_PROMO ? 'promotions' : 'pricing', 'view'); if (err) return err;
  return { success: true, packageType: type, packageId: payload.packageId,
    assigned: packageTenantsOf(type, payload.packageId),
    tenants: _pkgAssignableTenants() };
}

/**
 * ตั้งรายชื่อตัวแทนของชุดนี้ใหม่ทั้งชุด (payload.tenantIds = รายชื่อที่ต้องการให้เหลือ)
 * เขียนทับทั้งก้อนแทนการเพิ่ม/ลบทีละราย เพราะหน้าจอเป็นเช็คบ็อกซ์ทั้งหมด ส่งสถานะสุดท้ายมาตรงๆ ง่ายกว่าและไม่หลุด
 */
function savePackageTenants(session, payload) {
  payload = payload || {};
  var type = String(payload.packageType || PKG_PRICE_LIST);
  if (!PKG_TYPES[type]) return { success: false, message: 'ชนิดชุดไม่ถูกต้อง' };
  var err = _requirePermission(session, type === PKG_PROMO ? 'promotions' : 'pricing', 'edit'); if (err) return err;
  // ★ ตัวแทนแก้ไม่ได้เด็ดขาด — ราคาคุมจากส่วนกลาง (กติกาเจ้าของระบบ) แม้บทบาทจะมีสิทธิ์ edit ของตัวเอง
  if (session.tenant_id) return { success: false, message: 'เฉพาะบริษัทเจ้าของสินค้าเท่านั้นที่กำหนดได้ว่าชุดไหนใช้กับตัวแทนใด' };

  var pkgId = String(payload.packageId || '');
  if (!pkgId) return { success: false, message: 'ไม่ได้ระบุชุด' };
  var known = {};
  _pkgAssignableTenants().forEach(function(t) { known[t.tenantId] = 1; });
  var want = [];
  (payload.tenantIds || []).forEach(function(t) {
    var id = String(t || '').trim();
    if (id && known[id] && want.indexOf(id) === -1) want.push(id);   // ตัวแทนที่ไม่มีจริง/ปิดไปแล้ว = เมิน
  });

  var sh = centralSheet('package_tenants');
  _deleteRowsMatching(sh, function(o) {
    return String(o.package_type) === type && String(o.package_id) === pkgId;
  });
  if (want.length) {
    var nextId = centralNextId('package_tenants');
    centralAppendMany('package_tenants', want.map(function(t, i) {
      return { record_id: nextId + i, package_type: type, package_id: pkgId, tenant_id: t,
        assigned_at: nowStr(), assigned_by: String(session.adminUserId || '') };
    }));
  }
  centralInvalidate('package_tenants');
  return { success: true, assigned: want.slice().sort(),
    message: want.length ? 'จ่าย' + PKG_TYPES[type].label + 'นี้ให้ตัวแทน ' + want.length + ' ราย'
                         : 'ยกเลิกการจ่าย' + PKG_TYPES[type].label + 'นี้แล้ว — ตอนนี้ยังไม่มีตัวแทนรายไหนได้ใช้' };
}

/**
 * ชุดที่มีอยู่ก่อนมีระบบจ่ายชุด → เขียนแถวให้ครบทุกตัวแทน เพื่อให้ของที่ขายอยู่ไม่สะดุด
 * รันซ้ำได้: ชุดที่มีแถวอยู่แล้วข้าม (ไม่ไปทับสิ่งที่คนตั้งใจเลือกไว้)
 */
function migratePackageAssignments(session) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  var tenants = _pkgAssignableTenants().map(function(t) { return t.tenantId; });
  if (!tenants.length) return { success: false, message: 'ยังไม่มีตัวแทนในระบบ' };

  ensureSchemaCurrent();          // ชีตอาจยังไม่เกิดถ้ายังไม่มีใครล็อกอินหลัง deploy
  var idx = packageTenantIndex().map;
  var rows = [], report = [];
  var nextId = centralNextId('package_tenants');
  [PKG_PRICE_LIST, PKG_PROMO].forEach(function(type) {
    centralObjects(PKG_TYPES[type].sheet).forEach(function(p) {
      var id = String(p.record_id);
      if (idx[_pkgKey(type, id)]) { report.push({ type: type, id: id, name: p.name, action: 'ข้าม (กำหนดไว้แล้ว)' }); return; }
      tenants.forEach(function(t) {
        rows.push({ record_id: nextId++, package_type: type, package_id: id, tenant_id: t,
          assigned_at: nowStr(), assigned_by: 'migrate' });
      });
      report.push({ type: type, id: id, name: p.name, action: 'จ่ายให้ทุกตัวแทน (' + tenants.length + ')' });
    });
  });
  if (rows.length) centralAppendMany('package_tenants', rows);
  centralInvalidate('package_tenants');
  return { success: true, added: rows.length, report: report,
    message: 'เขียนการจ่ายชุดย้อนหลัง ' + rows.length + ' แถว จาก ' + report.length + ' ชุด' };
}

/** ชุดราคา/โปรโมชั่นที่ตัวแทนรายนี้ได้รับ — ฝั่งตัวแทนเปิดดูได้อย่างเดียว */
function listMyPackages(session, payload) {
  var err = _requirePermission(session, 'pricing', 'view'); if (err) return err;
  var tenantId = String(_salesTenantId(session, payload || {}) || HOUSE_TENANT_ID);
  var idx = packageTenantIndex();
  var out = {};
  [PKG_PRICE_LIST, PKG_PROMO].forEach(function(type) {
    out[type] = centralObjects(PKG_TYPES[type].sheet)
      .filter(function(p) { return packageAllowedForTenant(idx, type, p.record_id, tenantId); })
      .map(function(p) {
        return { id: p.record_id, name: p.name, status: p.status || (isFlagOn(p.is_active) ? 'active' : 'inactive'),
          validFrom: p.valid_from || p.date_start || '', validTo: p.valid_to || p.date_end || '' };
      });
  });
  return { success: true, tenantId: tenantId, priceLists: out[PKG_PRICE_LIST], promos: out[PKG_PROMO] };
}
