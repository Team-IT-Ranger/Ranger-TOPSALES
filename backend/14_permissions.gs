/**
 * ===================== RBAC (Admin App) =====================
 * ใช้กับ Admin App เท่านั้น (ผู้ใช้ Mobile App/Van Sales คุมด้วย role ธรรมดาใน liff_users พอ)
 *
 * โมดูลแบ่งตามสิทธิ์: canView (เห็นเมนู/รายการ), canEdit (เพิ่ม/แก้/ลบ/ยกเลิก)
 * เก็บใน 2 sheet กลาง: roles (role_code, role_label, is_system)
 *                       role_permissions (role_code, module_code, can_view, can_edit)
 *
 * scope: 'owner' = เฉพาะบริษัทเจ้าของสินค้าเห็น, 'tenant' = เฉพาะฝั่งตัวแทนเห็น, 'both' = ทั้งคู่
 * (scope ใช้ตอน seed ค่าเริ่มต้นเท่านั้น การบังคับจริงอยู่ที่การกรองข้อมูลด้วย user.tenantId ในแต่ละฟังก์ชัน)
 */
var MODULE_REGISTRY = [
  // ── ฝั่งตัวแทนจำหน่าย ──
  { code: 'staff',          label: 'พนักงานขาย',        scope: 'tenant' },
  { code: 'zones',          label: 'เขตการขาย',          scope: 'tenant' },
  { code: 'customers',      label: 'ลูกค้า',              scope: 'tenant' },
  { code: 'sales',          label: 'บันทึกการขาย',        scope: 'tenant' },
  { code: 'docnum',         label: 'เลขที่เอกสาร',        scope: 'tenant' },
  { code: 'stock_receive',  label: 'รับสินค้าเข้าคลัง',    scope: 'tenant' },
  { code: 'stock_transfer', label: 'โอนย้ายคลัง',         scope: 'tenant' },
  { code: 'van_issue',      label: 'เบิกจ่ายให้ Cash Van', scope: 'tenant' },
  { code: 'shipping',       label: 'การจัดส่ง',           scope: 'tenant' },
  { code: 'sales_report',   label: 'รายงานการขาย',        scope: 'both'   },
  // ── ฝั่งบริษัทเจ้าของสินค้า ──
  { code: 'products',       label: 'สินค้าและราคา',       scope: 'owner'  },
  { code: 'pricing',        label: 'ชุดราคาและส่วนลด',     scope: 'owner'  },
  { code: 'promotions',     label: 'โปรโมชั่น',           scope: 'owner'  },
  { code: 'tenants',        label: 'ตัวแทนจำหน่าย',       scope: 'owner'  },
  { code: 'settings',       label: 'ข้อมูลกลาง (กลุ่มลูกค้า/ช่องทางจำหน่าย/ประเภทชำระเงิน)', scope: 'owner' },
  { code: 'users_roles',    label: 'ผู้ใช้งานและสิทธิ์',   scope: 'both'   }
];

/**
 * "tenant id ที่แท้จริง" ของ request นี้:
 *  - session.tenant_id มีค่า → เป็น tenant_admin ตัวจริงของตัวแทนนั้น ใช้ค่านี้เสมอ
 *  - session.tenant_id ว่าง + เป็น super_admin (Ultra Admin) + ส่ง payload.tenantId มา
 *    → กำลัง "สวมสิทธิ์" เข้าไปทำงานในตัวแทนนั้นเหมือนเป็น super_admin ของบริษัทนั้นเอง
 *  - owner_admin ไม่ได้สิทธิ์สวมสิทธิ์นี้ (ตามที่ตกลงกันไว้ — เห็นแค่ภาพรวมข้ามตัวแทน)
 *  - ไม่มีทั้งคู่ → null (ฝั่งบริษัท ทำงานกับข้อมูลกลางไม่ผูกตัวแทนใดตัวแทนหนึ่ง)
 */
function _effectiveTenantId(session, payload) {
  if (session.tenant_id) return session.tenant_id;
  if (session.role_code === 'super_admin' && payload && payload.tenantId) return String(payload.tenantId);
  return null;
}

// role_code เริ่มต้นตอน setupCentralSheet — ดู seedRolesDefaults ใน 00_setup_sheets.gs
// super_admin ข้ามทุกการเช็คสิทธิ์เสมอ กันกรณีตั้งค่า role_permissions ผิดแล้วล็อกตัวเองออกจากระบบ

// ตารางสิทธิ์แทบไม่เปลี่ยน (แก้ผ่าน setupCentralSheet เท่านั้น) แต่ถูกอ่านทุกคำขอของแอดมินที่ไม่ใช่ super_admin
// — แต่ละครั้งต้องเปิด Spreadsheet + อ่านชีต ~1-2 วิ เลยแคชข้ามคำขอ 5 นาที (สิทธิ์เป็นของ role ไม่ใช่ของ user
// จึงแชร์แคชเดียวกันได้ปลอดภัย) แคชล้มเหลว/เกิน 100KB ก็อ่านชีตตรงๆ ตามปกติ
var ROLE_PERMS_CACHE_KEY = 'role_permissions_v1';
function _rolePermissionRows() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(ROLE_PERMS_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  var rows = centralObjects('role_permissions');
  try { cache.put(ROLE_PERMS_CACHE_KEY, JSON.stringify(rows), 300); } catch (e) {}
  return rows;
}
function clearRolePermissionsCache() { CacheService.getScriptCache().remove(ROLE_PERMS_CACHE_KEY); }

function hasPermission(adminUser, moduleCode, action) {
  if (!adminUser) return false;
  if (adminUser.role_code === 'super_admin') return true;

  var rows = _rolePermissionRows();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].role_code) === String(adminUser.role_code) && String(rows[i].module_code) === String(moduleCode)) {
      var flag = action === 'edit' ? rows[i].can_edit : rows[i].can_view;
      return String(flag) === 'TRUE' || String(flag) === '1' || flag === true;
    }
  }
  return false;
}

// เรียกเป็นบรรทัดแรกของทุกฟังก์ชัน backend ที่แก้ไข/อ่านข้อมูลผ่าน Admin App
// action: 'view' สำหรับ list/get, 'edit' สำหรับ add/update/delete/cancel
function _requirePermission(adminUser, moduleCode, action) {
  if (!hasPermission(adminUser, moduleCode, action)) {
    return { success: false, message: 'ไม่มีสิทธิ์เข้าถึงเมนูนี้ (' + moduleCode + ')' };
  }
  return null;
}

// ── จัดการผู้ใช้ Admin (super_admin เท่านั้น) ──
function listAdminUsers(adminUser, payload) {
  var err = _requirePermission(adminUser, 'users_roles', 'view'); if (err) return err;
  var rows = centralObjects('admin_users');
  // ผู้ใช้ระดับตัวแทน (หรือ Ultra Admin ที่กำลังสวมสิทธิ์ตัวแทน) เห็นเฉพาะ admin ของตัวแทนนั้น
  // owner_admin/super_admin ที่ไม่ได้สวมสิทธิ์ตัวแทนไหน เห็นทุกบัญชี (ภาพรวม)
  var effTenantId = _effectiveTenantId(adminUser, payload || {});
  if (effTenantId) rows = rows.filter(function(u) { return String(u.tenant_id) === String(effTenantId); });
  return {
    success: true,
    data: rows.map(function(u) {
      return { id: String(u.record_id), username: u.username, displayName: u.display_name, roleCode: u.role_code, tenantId: u.tenant_id || '', status: u.status, createdAt: safeDateStr(u.created_at) };
    })
  };
}

function listRoles(adminUser) {
  var err = _requirePermission(adminUser, 'users_roles', 'view'); if (err) return err;
  return { success: true, data: centralObjects('roles').map(function(r) { return { code: r.role_code, label: r.role_label, isSystem: r.is_system }; }) };
}
