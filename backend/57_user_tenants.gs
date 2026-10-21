/**
 * ===================== ผู้รับผิดชอบตัวแทน (admin_user_tenants) =====================
 * ตอบคำถามเดียว: **"บัญชีนี้ดูแลตัวแทนรายไหนอยู่"** เพื่อให้ที่ไหนก็ตามที่ต้องถามว่า
 * "ของตัวแทนไหน" (บอท LINE /inventory · รายงานที่ต้องเลือกศูนย์) ถามจากที่เดียวกัน
 *
 * ★★ ไม่ใช่ตัวให้สิทธิ์ — สิทธิ์รายโมดูลยังตรวจที่ `role_permissions` (14_permissions.gs) ทุก action
 *   ตารางนี้แค่ "ย่อรายการให้สั้นลง" เท่านั้น เขียนชื่อตัวแทนลงที่นี่ไม่ได้ทำให้ใครได้สิทธิ์เพิ่ม
 *
 * ★★ **ผู้อ่านตารางนี้ตัวจริงคือบอท LINE** (`bot-line/Code.js` — คนละโปรเจกต์ Apps Script จึงเรียกฟังก์ชัน
 *   ที่นี่ไม่ได้ ต้องอ่านชีตเอง) · ตรรกะลำดับการตัดสินถูก **คัดลอกไว้ที่ `botManagedTenantIds_()`**
 *   — **แก้ `managedTenantIds()` ที่นี่เมื่อไหร่ ต้องไปแก้ตัวนั้นด้วยเสมอ** ไม่งั้นบอทกับหน้าจอ
 *   จะตอบไม่เหมือนกันว่าใครดูแลตัวแทนรายไหน (เทสต์ของสองฝั่งอยู่ที่ `.dev/test-user-tenants.js`
 *   และ `.dev/test-bot-line.js` — ชุดหลังมีหมวดเทียบกติกาข้อต่อข้อ)
 * สองฟังก์ชัน action ข้างล่างคือ**ทางเดียวที่ควรใช้ตั้งค่า** (ไม่ใช่พิมพ์ลงชีตเอง)
 *
 * ★★ ลำดับการตัดสิน (เจ้าของระบบสั่ง 21 ต.ค. 2026: "ฝั่งบริษัทเห็นทุกราย และต้องมีตารางผู้รับผิดชอบรายคน")
 *   1. บัญชีที่**สังกัดตัวแทน** → ตัวแทนของตัวเองรายเดียวตลอด · **ตารางนี้ไม่มีผลกับเขาเลย**
 *      (กติกาเดิมของระบบ: สังกัดตัวแทนแล้วข้ามไปรายอื่นไม่ได้เด็ดขาด — ดู `_effectiveTenantId`)
 *   2. `super_admin` → ทุกรายที่ยังเปิดใช้งาน เสมอ ไม่สนตารางนี้ (เป็นคนไปแก้ตารางนี้เอง
 *      ถ้ากันตัวเองไว้ด้วยจะมองไม่เห็นผลที่ตั้ง และคิวงานค้างจะไม่มีใครดูแทนได้)
 *   3. บัญชีฝั่งบริษัทที่**มีแถวในตารางนี้** → เห็นเฉพาะรายที่ระบุไว้ (นี่คือความหมายของ "ผู้รับผิดชอบ")
 *   4. บัญชีฝั่งบริษัทที่**ไม่มีแถวเลย** → เห็นทุกราย (ค่าตั้งต้นเดิมของระบบ — ยังไม่เคยตั้งค่า
 *      ต้องไม่ทำให้ของที่ใช้อยู่หยุดทำงาน หลักเดียวกับ `package_tenants` ตอนตารางยังว่างทั้งตาราง)
 *   ★ ต่างจาก `package_tenants` ที่ "ไม่ระบุ = ไม่มีใครได้" โดยตั้งใจ — ที่นั่นเป็นการ**มอบของ**
 *     ซึ่งต้องชัดเจน ที่นี่เป็นแค่**ตัวกรองรายการบนจอ** ปิดประตูโดยไม่มีใครสั่งไม่ได้
 */

var AUT_SHEET = 'admin_user_tenants';

/** แถวของคนหนึ่ง — คีย์เป็นบัญชีแอดมิน (`admin_user_id`) หรือพนักงานขาย (`line_user_id`) อย่างใดอย่างหนึ่ง */
function _autRowsOf(adminUserId, lineUserId) {
  var id = String(adminUserId || ''), lid = String(lineUserId || '');
  if (!id && !lid) return [];
  return centralObjects(AUT_SHEET).filter(function(r) {
    if (id && String(r.admin_user_id || '') === id) return true;
    return !!lid && String(r.line_user_id || '') === lid;
  });
}

/** คนที่ถูกแต่งตั้งได้: แอดมินฝั่งบริษัท หรือ **พนักงานขายของบริษัท** (liff_users ที่อนุมัติแล้ว ไม่สังกัดตัวแทน) */
function _autStaffRow(lineUserId) {
  var lid = String(lineUserId || '');
  if (!lid) return null;
  var found = null;
  centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === lid) found = u; });
  return found;
}

/** ตัวแทนที่ยังเปิดใช้งาน → { tenantId: name } (รวมบริษัทเจ้าของสินค้าเอง ซึ่งก็มีคลังของตัวเอง) */
function _autActiveTenantMap() {
  var out = {};
  centralObjects('tenants').forEach(function(t) {
    if (isFlagOn(t.is_active)) out[String(t.tenant_id)] = String(t.name || t.tenant_id);
  });
  return out;
}

/** ชื่อที่ควรแสดงของตัวแทนบ้าน = ชื่อบริษัท (ตรงกับที่แถบบนของแอปแสดง — 25_company.gs) */
function _autTenantLabel(tenantId, name) {
  if (String(tenantId) !== OWNER_TENANT_ID) return name;
  try {
    var rows = centralObjects('company_profile');
    if (rows.length && String(rows[0].name || '').trim()) return String(rows[0].name).trim();
  } catch (e) {}
  return name || 'บริษัทเจ้าของสินค้า';
}

/**
 * รหัสตัวแทนที่บัญชีนี้ดูแล — ลำดับการตัดสินอยู่ในหัวไฟล์
 * @param adminUser แถว admin_users หรือ session (ต้องมี record_id/adminUserId, role_code, tenant_id)
 */
function managedTenantIds(user) {
  if (!user) return [];
  var own = String(user.tenant_id || '');
  if (own && own !== OWNER_TENANT_ID) return [own];           // ข้อ 1 — สังกัดตัวแทน

  var active = _autActiveTenantMap();
  var all = Object.keys(active);
  /* ★ พนักงานขาย (liff_users) ไม่ใช่บัญชีแอดมิน — ไม่มีบทบาท ไม่มีสิทธิ์รายโมดูล
     "การแต่งตั้ง" คือสิ่งเดียวที่ให้เขาเห็นข้อมูลของตัวแทน จึงต้องระบุชัดเสมอ (ดูข้อ 5 ท้ายฟังก์ชัน) */
  var isStaff = !!user.isStaff;
  if (!isStaff && String(user.role_code || '') === 'super_admin') return all;   // ข้อ 2

  var id = String(user.record_id || user.adminUserId || '');
  var mine = _autRowsOf(isStaff ? '' : id, user.line_user_id || user.lineUserId)
    .map(function(r) { return String(r.tenant_id); })
    .filter(function(t) { return active[t] !== undefined; });            // ที่ปิดใช้งานไปแล้วไม่ต้องโผล่
  // ซ้ำกันได้ถ้ามีคนเขียนชีตเอง — ตัดซ้ำที่นี่ ไม่ใช่ไปพึ่งว่าข้อมูลสะอาด
  var seen = {}, uniq = [];
  mine.forEach(function(t) { if (!seen[t]) { seen[t] = 1; uniq.push(t); } });
  if (uniq.length) return uniq;                                          // ข้อ 3
  /* ★★ ข้อ 5 — **ว่างแปลว่าคนละอย่างกันสำหรับสองกลุ่ม**
     แอดมินฝั่งบริษัท: ว่าง = ยังไม่เคยตั้งค่า = เห็นทุกราย (ของเดิมที่ใช้อยู่ต้องไม่หยุดทำงาน)
     พนักงานขาย: ว่าง = **ยังไม่ได้รับแต่งตั้ง = ไม่ได้ดูแลใครเลย** — ถ้าให้เห็นทุกรายเท่ากับว่า
     พนักงานขายทุกคนในบริษัทเปิดดูของทุกตัวแทนได้ทันทีที่เพิ่มฟีเจอร์นี้ ซึ่งไม่มีใครสั่ง */
  return isStaff ? [] : all;                                             // ข้อ 4 / ข้อ 5
}

/** เหมือน managedTenantIds แต่ได้ชื่อมาด้วย เรียงชื่อไทย — บริษัทเจ้าของสินค้าอยู่หัวรายการเสมอ */
function managedTenants(adminUser) {
  var active = _autActiveTenantMap();
  var out = managedTenantIds(adminUser).map(function(t) {
    return { tenantId: t, name: _autTenantLabel(t, active[t] || t), isOwner: t === OWNER_TENANT_ID };
  });
  out.sort(function(a, b) {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'th');
  });
  return out;
}

/** บัญชีนี้ดูแลตัวแทนรายนี้อยู่จริงไหม — ใช้กั้นก่อนอ่านข้อมูลของตัวแทนที่ส่งรหัสมาเอง */
function managesTenant(adminUser, tenantId) {
  var want = String(tenantId || '');
  if (!want) return false;
  return managedTenantIds(adminUser).indexOf(want) !== -1;
}

/* ═══════════════ actions ของแอปแอดมิน ═══════════════ */

/**
 * ดูว่าใครดูแลใครอยู่ · ส่ง adminUserId มา = เฉพาะคนนั้น (พร้อมรายการตัวแทนทั้งหมดให้ติ๊ก)
 * อ่านได้เฉพาะคนที่ดูเมนูผู้ใช้งานได้ (ข้อมูลนี้บอกโครงการดูแลของทั้งบริษัท)
 */
function listTenantResponsibilities(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'view'); if (err) return err;
  /* ★ ฝั่งบริษัทเท่านั้น — ตารางนี้พูดถึงบัญชีฝั่งบริษัททั้งหมด (ใครดูแลตัวแทนรายไหน) ซึ่งไม่ใช่เรื่องที่
     แอดมินของตัวแทนต้องรู้ · เขาตั้งค่าไม่ได้อยู่แล้ว (saveTenantResponsibilities ปฏิเสธ) การให้อ่านได้
     จึงมีแต่เปิดรายชื่อคนของบริษัทให้เปล่าๆ */
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัทเจ้าของสินค้าดูผู้รับผิดชอบตัวแทนได้' };
  payload = payload || {};
  var active = _autActiveTenantMap();
  var tenants = Object.keys(active).map(function(t) {
    return { tenantId: t, name: _autTenantLabel(t, active[t]), isOwner: t === OWNER_TENANT_ID };
  });
  tenants.sort(function(a, b) {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'th');
  });

  var rows = centralObjects(AUT_SHEET);
  var byAdmin = {}, byStaff = {};
  rows.forEach(function(r) {
    var t = String(r.tenant_id);
    if (String(r.admin_user_id || '')) (byAdmin[String(r.admin_user_id)] = byAdmin[String(r.admin_user_id)] || []).push(t);
    else if (String(r.line_user_id || '')) (byStaff[String(r.line_user_id)] = byStaff[String(r.line_user_id)] || []).push(t);
  });
  var live = function(list) { return (list || []).filter(function(t) { return active[t] !== undefined; }); };

  var out = [];
  centralObjects('admin_users').forEach(function(u) {
    if (!_isCompanySide({ tenant_id: u.tenant_id }) || String(u.status) !== ADMIN_STATUS_ACTIVE) return;
    if (payload.adminUserId && String(u.record_id) !== String(payload.adminUserId)) return;
    if (payload.lineUserId) return;
    out.push({
      kind: 'admin',
      adminUserId: String(u.record_id), username: u.username, displayName: u.display_name || u.username,
      roleCode: u.role_code, lineUserId: String(u.line_user_id || ''),
      tenantIds: live(byAdmin[String(u.record_id)]),
      /* ★ ส่ง effective มาด้วย เพื่อให้หน้าจอบอกความจริงได้ว่า "ยังไม่ได้ตั้ง = เห็นทุกราย"
         ไม่ใช่ปล่อยให้คนอ่านช่องว่างแล้วเดาว่าเขาไม่เห็นอะไรเลย */
      effectiveTenantIds: managedTenantIds(u),
      alwaysAll: String(u.role_code) === 'super_admin'
    });
  });
  /* ★ พนักงานขายของบริษัท (liff_users ที่อนุมัติแล้ว ไม่สังกัดตัวแทน) — แต่งตั้งเป็นผู้ดูแลตัวแทนได้
     **ข้ามคนที่มีบัญชีแอดมินอยู่แล้ว** ไม่งั้นคนคนเดียวโผล่สองแถวแล้วตั้งค่าคนละคีย์ ทับกันไปมา */
  var adminLine = {};
  centralObjects('admin_users').forEach(function(u) { if (String(u.line_user_id || '')) adminLine[String(u.line_user_id)] = 1; });
  centralObjects('liff_users').forEach(function(u) {
    var lid = String(u.line_user_id || '');
    if (!lid || adminLine[lid]) return;
    if (!_isCompanySide({ tenant_id: u.tenant_id }) || String(u.status) !== 'Yes') return;
    if (payload.lineUserId && lid !== String(payload.lineUserId)) return;
    if (payload.adminUserId) return;
    var picked = live(byStaff[lid]);
    out.push({
      kind: 'staff', lineUserId: lid, username: '', displayName: u.display_name || lid,
      roleCode: String(u.role || ''), tenantIds: picked,
      effectiveTenantIds: managedTenantIds({ isStaff: true, line_user_id: lid, tenant_id: u.tenant_id }),
      alwaysAll: false
    });
  });

  return { success: true, tenants: tenants, users: out };
}

/**
 * ตั้งผู้รับผิดชอบของบัญชีหนึ่ง — เขียนทับทั้งชุด (payload.tenantIds = รายการสุดท้ายที่ต้องการ)
 * ส่งรายการว่าง = ล้างค่า แล้วกลับไปเป็น "เห็นทุกราย" ตามค่าตั้งต้น (ไม่ใช่ "ไม่เห็นอะไรเลย")
 */
function saveTenantResponsibilities(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  payload = payload || {};
  // ★ เฉพาะฝั่งบริษัท — แอดมินของตัวแทนตั้งให้ใครไม่ได้ แม้บทบาทจะมีสิทธิ์แก้ผู้ใช้
  //   (หลักเดียวกับ savePackageTenants ใน 38_package_distribution.gs)
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัทเจ้าของสินค้าตั้งผู้รับผิดชอบตัวแทนได้' };

  var userId = String(payload.adminUserId || '').trim();
  var lineId = String(payload.lineUserId || '').trim();
  if (!userId && !lineId) return { success: false, message: 'ไม่ได้ระบุบัญชีผู้ใช้' };
  if (userId && lineId) return { success: false, message: 'ระบุได้ทีละคน (บัญชีแอดมิน หรือ พนักงานขาย)' };

  var user = null, staff = null;
  if (userId) {
    centralObjects('admin_users').forEach(function(u) { if (String(u.record_id) === userId) user = u; });
    if (!user) return { success: false, message: 'ไม่พบบัญชีผู้ใช้นี้' };
    // ★ บัญชีที่สังกัดตัวแทนตั้งไม่ได้ ไม่ใช่ตั้งแล้วไม่มีผล — ต้องบอกให้รู้ตัว ไม่ใช่เงียบ
    if (!_isCompanySide({ tenant_id: user.tenant_id })) {
      return { success: false, message: 'บัญชีนี้สังกัด "' + user.tenant_id + '" อยู่แล้ว จึงดูแลได้เฉพาะตัวแทนของตัวเอง' };
    }
  } else {
    /* ★ พนักงานขายของบริษัท — ต้องอนุมัติแล้วและไม่สังกัดตัวแทน · **คนที่มีบัญชีแอดมินอยู่แล้วให้ตั้งทางบัญชี
       แอดมินเท่านั้น** ไม่งั้นคนคนเดียวมีผู้ดูแลสองชุดที่ไม่ตรงกัน แล้วผลขึ้นกับว่าโค้ดตรงนั้นอ่านคีย์ไหนก่อน */
    staff = _autStaffRow(lineId);
    if (!staff) return { success: false, message: 'ไม่พบพนักงานขายรายนี้' };
    if (String(staff.status) !== 'Yes') return { success: false, message: 'พนักงานรายนี้ยังไม่ได้รับอนุมัติให้ใช้งาน' };
    if (!_isCompanySide({ tenant_id: staff.tenant_id })) {
      return { success: false, message: 'พนักงานรายนี้สังกัด "' + staff.tenant_id + '" อยู่แล้ว จึงดูแลได้เฉพาะตัวแทนของตัวเอง' };
    }
    var dup = null;
    centralObjects('admin_users').forEach(function(u) { if (String(u.line_user_id || '') === lineId) dup = u; });
    if (dup) return { success: false, message: 'คนนี้มีบัญชีแอดมินอยู่แล้ว (' + dup.username + ') — ตั้งผู้ดูแลที่บัญชีแอดมินแทน' };
  }

  var active = _autActiveTenantMap();
  var want = [], seen = {}, bad = [];
  (payload.tenantIds || []).forEach(function(t) {
    var id = String(t || '').trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    if (active[id] === undefined) { bad.push(id); return; }
    want.push(id);
  });
  if (bad.length) return { success: false, message: 'ไม่พบตัวแทน (หรือปิดใช้งานแล้ว): ' + bad.join(', ') };

  var sh = centralSheet(AUT_SHEET);
  deleteRowsWhere(sh, userId ? 'admin_user_id' : 'line_user_id', userId || lineId);   // เขียนทับทั้งชุด = ลบของเดิมก่อนเสมอ
  if (want.length) {
    var nextId = centralNextId(AUT_SHEET);
    centralAppendMany(AUT_SHEET, want.map(function(t, i) {
      return { record_id: nextId + i, admin_user_id: userId, line_user_id: lineId, tenant_id: t,
        created_at: nowStr(), created_by: String(session && session.adminUserId || '') };
    }));
  }
  var who = userId ? user : { isStaff: true, line_user_id: lineId, tenant_id: staff.tenant_id };
  var cleared = userId ? 'ล้างค่าแล้ว — บัญชีนี้กลับไปเห็นทุกราย'
                       : 'ล้างค่าแล้ว — พนักงานรายนี้ไม่ได้ดูแลตัวแทนรายใด';
  return { success: true, message: want.length ? ('ตั้งผู้รับผิดชอบ ' + want.length + ' ราย') : cleared,
    tenantIds: want, effectiveTenantIds: managedTenantIds(who) };
}
