/**
 * ===================== บทบาทและสิทธิ์ผู้ใช้งาน (กลุ่มเมนู "ผู้ใช้งานและสิทธิ์") =====================
 * เดิมมีแค่บทบาทตายตัว 3 อย่าง (super_admin / owner_admin / tenant_admin) แก้สิทธิ์ไม่ได้จากในแอป
 * ตอนนี้แอดมินของแต่ละบริษัทสร้าง "บทบาท" เองได้ แล้วติ๊กสิทธิ์ดู/แก้ ทีละโมดูล
 *
 * ขอบเขตของบทบาท (roles.tenant_id):
 *   ว่าง  = บทบาทกลาง ใช้ได้ทั้งระบบ — สร้าง/แก้ได้เฉพาะฝั่งบริษัทเจ้าของสินค้า
 *   มีค่า = บทบาทของตัวแทนรายนั้น — แอดมินตัวแทนสร้าง/แก้/ลบได้เอง และมองไม่เห็นบทบาทของตัวแทนอื่น
 *
 * กติกากันยกระดับสิทธิ์ (สำคัญที่สุดของไฟล์นี้):
 *   - ให้สิทธิ์ได้ไม่เกินสิทธิ์ที่ตัวเองมี (ยกเว้น super_admin ที่มีทุกอย่างอยู่แล้ว)
 *   - บทบาทระบบ (is_system) แก้ไม่ได้ ลบไม่ได้ — ถ้าจะปรับให้กด "คัดลอกเป็นบทบาทใหม่" แล้วแก้ตัวที่คัดลอก
 *   - ผู้ใช้จะถูกกำหนดเป็นบทบาทที่ตัวเองมองไม่เห็น/ข้ามตัวแทนไม่ได้ (ดู resolveAssignableRole)
 */

function _rolesAll() { return centralObjects('roles'); }
function _roleByCode(code) {
  var rows = _rolesAll();
  for (var i = 0; i < rows.length; i++) if (String(rows[i].role_code) === String(code)) return rows[i];
  return null;
}
function _moduleCodes() { return MODULE_REGISTRY.map(function(m) { return m.code; }); }

// สิทธิ์ของ "ผู้ที่กำลังเรียก" ในรูป { module: {view, edit} } — super_admin ได้ทุกโมดูล
function _effectivePermissions(session) {
  var out = {};
  var isSuper = session && session.role_code === 'super_admin';
  MODULE_REGISTRY.forEach(function(m) {
    out[m.code] = isSuper ? { view: true, edit: true }
      : { view: hasPermission(session, m.code, 'view'), edit: hasPermission(session, m.code, 'edit') };
  });
  return out;
}

// ให้หน้าเว็บรู้ว่าผู้ใช้คนนี้เห็นเมนูอะไรได้บ้าง (ใช้ซ่อนเมนูที่ไม่มีสิทธิ์ — ฝั่ง backend ยังตรวจซ้ำทุก action อยู่ดี)
function getMyPermissions(session) {
  if (!session) return { success: false, message: 'ไม่ได้เข้าสู่ระบบ' };
  var role = _roleByCode(session.role_code);
  return { success: true, roleCode: session.role_code, roleLabel: role ? role.role_label : session.role_code,
    isSuperAdmin: session.role_code === 'super_admin', tenantId: session.tenant_id || '',
    modules: MODULE_REGISTRY.map(function(m) { return { code: m.code, label: m.label, scope: m.scope }; }),
    permissions: _effectivePermissions(session) };
}

function _permMapOf(roleCode) {
  var map = {};
  _rolePermissionRows().forEach(function(p) {
    if (String(p.role_code) !== String(roleCode)) return;
    map[String(p.module_code)] = { view: isFlagOn(p.can_view), edit: isFlagOn(p.can_edit) };
  });
  return map;
}

// บทบาทที่ผู้เรียกมีสิทธิ์เห็น: ฝั่งบริษัทเห็นทั้งหมด · ฝั่งตัวแทนเห็นบทบาทกลางที่เป็นของตัวแทน + บทบาทที่ตัวเองสร้าง
function listRolesWithPermissions(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'view'); if (err) return err;
  var effTenantId = _effectiveTenantId(session, payload || {});
  var users = centralObjects('admin_users');
  var rows = _rolesAll().filter(function(r) {
    if (!effTenantId) return true;
    return String(r.tenant_id || '') === String(effTenantId) || String(r.role_code) === 'tenant_admin';
  });
  var mine = _effectivePermissions(session);
  return { success: true, tenantId: effTenantId || '',
    modules: MODULE_REGISTRY.map(function(m) { return { code: m.code, label: m.label, scope: m.scope }; }),
    myPermissions: mine,
    data: rows.map(function(r) {
      var perms = _permMapOf(r.role_code);
      return { code: r.role_code, label: r.role_label || r.role_code, description: r.description || '',
        isSystem: isFlagOn(r.is_system), tenantId: r.tenant_id || '',
        userCount: users.filter(function(u) { return String(u.role_code) === String(r.role_code); }).length,
        canEdit: !isFlagOn(r.is_system) && (!effTenantId || String(r.tenant_id || '') === String(effTenantId)),
        permissions: MODULE_REGISTRY.map(function(m) {
          var p = perms[m.code] || { view: false, edit: false };
          return { module: m.code, view: p.view, edit: p.edit };
        }) };
    }) };
}

function _slugRoleCode(label, tenantId) {
  var base = String(label).trim().toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'role';
  var prefix = tenantId ? String(tenantId) + '_' : '';
  var code = prefix + base, n = 2;
  while (_roleByCode(code)) { code = prefix + base + '_' + n; n++; }
  return code;
}

/**
 * payload: { code? (มี = แก้ไข), label, description?, permissions:[{module, view, edit}] }
 * ไม่ส่ง code = สร้างใหม่ · ตัวแทนสร้างได้เฉพาะบทบาทของตัวเอง (ผูก tenant_id อัตโนมัติ)
 */
function saveRole(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  payload = payload || {};
  var label = String(payload.label || '').trim();
  if (!label) return { success: false, message: 'กรุณาตั้งชื่อบทบาท' };
  var effTenantId = _effectiveTenantId(session, payload);
  var isSuper = session.role_code === 'super_admin';
  var mine = _effectivePermissions(session);
  var known = _moduleCodes();

  var perms = (payload.permissions || []).filter(function(p) { return known.indexOf(String(p.module)) !== -1; })
    .map(function(p) { return { module: String(p.module), view: !!p.view || !!p.edit, edit: !!p.edit }; });   // แก้ได้ต้องดูได้ด้วยเสมอ
  for (var i = 0; i < perms.length; i++) {
    var p = perms[i];
    if (isSuper) continue;
    if (p.view && !mine[p.module].view) return { success: false, message: 'ให้สิทธิ์ "' + p.module + '" ไม่ได้ เพราะบัญชีของคุณเองยังไม่มีสิทธิ์นั้น' };
    if (p.edit && !mine[p.module].edit) return { success: false, message: 'ให้สิทธิ์แก้ไข "' + p.module + '" ไม่ได้ เพราะบัญชีของคุณเองมีแค่สิทธิ์ดู' };
  }

  return _withDocLock(function() {
    var code = payload.code ? String(payload.code) : '';
    var row = code ? _roleByCode(code) : null;
    if (code && !row) return { success: false, message: 'ไม่พบบทบาทนี้' };
    if (row && isFlagOn(row.is_system)) return { success: false, message: 'บทบาทของระบบแก้ไขไม่ได้ — ใช้ "คัดลอกเป็นบทบาทใหม่" แล้วแก้ตัวที่คัดลอกแทน' };
    if (row && effTenantId && String(row.tenant_id || '') !== String(effTenantId)) return { success: false, message: 'ไม่มีสิทธิ์แก้บทบาทของตัวแทนอื่น' };

    if (!row) {
      code = _slugRoleCode(label, effTenantId);
      centralAppend('roles', { role_code: code, role_label: label, is_system: 'FALSE',
        tenant_id: effTenantId || '', description: String(payload.description || '') });
    } else {
      centralUpdate('roles', row.role_code, { role_label: label, description: String(payload.description || '') });
    }

    // เขียนสิทธิ์ใหม่ทั้งชุด (ลบของเดิมของบทบาทนี้ก่อน) — ง่ายกว่าไล่เทียบทีละโมดูลและไม่มีของค้าง
    deleteRowsWhere(centralSheet('role_permissions'), 'role_code', code);
    centralAppendMany('role_permissions', perms.filter(function(p) { return p.view || p.edit; }).map(function(p) {
      return { role_code: code, module_code: p.module, can_view: p.view ? 'TRUE' : 'FALSE', can_edit: p.edit ? 'TRUE' : 'FALSE' };
    }));
    clearRolePermissionsCache();
    var res = listRolesWithPermissions(session, payload);
    res.message = row ? 'บันทึกสิทธิ์ของบทบาทแล้ว' : 'สร้างบทบาท "' + label + '" แล้ว';
    res.savedCode = code;
    return res;
  });
}

// payload: { code } — ลบได้เฉพาะบทบาทที่สร้างเอง และต้องไม่มีผู้ใช้ถืออยู่
function deleteRole(session, payload) {
  var err = _requirePermission(session, 'users_roles', 'edit'); if (err) return err;
  var effTenantId = _effectiveTenantId(session, payload || {});
  return _withDocLock(function() {
    var row = _roleByCode(payload.code);
    if (!row) return { success: false, message: 'ไม่พบบทบาทนี้' };
    if (isFlagOn(row.is_system)) return { success: false, message: 'บทบาทของระบบลบไม่ได้' };
    if (effTenantId && String(row.tenant_id || '') !== String(effTenantId)) return { success: false, message: 'ไม่มีสิทธิ์ลบบทบาทของตัวแทนอื่น' };
    var inUse = centralObjects('admin_users').filter(function(u) { return String(u.role_code) === String(row.role_code); });
    if (inUse.length) return { success: false, message: 'ยังมีผู้ใช้ ' + inUse.length + ' บัญชีใช้บทบาทนี้อยู่ — ย้ายผู้ใช้ไปบทบาทอื่นก่อน' };
    deleteRowsWhere(centralSheet('role_permissions'), 'role_code', row.role_code);
    deleteRowsWhere(centralSheet('roles'), 'role_code', row.role_code);
    clearRolePermissionsCache();
    var res = listRolesWithPermissions(session, payload || {});
    res.message = 'ลบบทบาทแล้ว';
    return res;
  });
}

/**
 * ตรวจว่าผู้เรียกกำหนดบทบาทนี้ให้ผู้ใช้ได้ไหม — ใช้ใน 16_admin_users.gs
 * คืนรหัสบทบาทที่ใช้ได้ หรือ null ถ้าไม่ได้ (บทบาทไม่มีจริง / ข้ามตัวแทน / super_admin)
 */
function resolveAssignableRole(session, roleCode, effTenantId) {
  var row = _roleByCode(roleCode);
  if (!row) return null;
  if (String(row.role_code) === 'super_admin') return null;              // ตั้ง super_admin ผ่าน API ไม่ได้เด็ดขาด
  var scope = String(row.tenant_id || '');
  if (effTenantId) {
    // ฝั่งตัวแทน: ใช้ได้เฉพาะบทบาทกลาง 'tenant_admin' หรือบทบาทที่ตัวแทนนั้นสร้างเอง
    if (String(row.role_code) === 'tenant_admin') return row.role_code;
    return scope === String(effTenantId) ? row.role_code : null;
  }
  return row.role_code;
}
