/**
 * ===================== รายชื่อร้านค้า (customer lists) =====================
 * เจ้าของระบบสั่ง 27 ก.ย. 2026: เงื่อนไขอย่าง **"ร้านค้าใหม่ที่ยังไม่เคยซื้อ"** ให้แอดมิน
 * (ฝั่งบริษัทหรือฝั่งตัวแทนก็ได้) เป็นคนทำตารางระบุเองว่าร้านรหัสใดเข้าเกณฑ์
 *
 * ★ ทำไมไม่คิดให้อัตโนมัติจาก `last_sale_at` ว่า "ยังไม่เคยซื้อ"
 *   เพราะเกณฑ์จริงไม่ได้แปลว่าไม่มีประวัติในระบบ — ร้านที่เพิ่งย้ายมาจากระบบเดิม ร้านที่เคยซื้อนานแล้ว
 *   ร้านที่เปิดใหม่แต่เจ้าของเดิม ล้วนถูกตัดสินด้วยดุลพินิจของคนขาย ไม่ใช่วันที่ในฐานข้อมูล
 *   และใบอนุมัติจริงก็แนบ "รายชื่อร้านที่อนุมัติ" มาเป็นตารางอยู่แล้ว (หน้า 2 ของใบ Jul-Sep'26)
 *
 * ★ ใช้เป็นเงื่อนไขในกฎสิทธิ์ได้ทุกที่ที่ใช้กฎได้ (ชุดราคา · โปรโมชั่น · ชุดแถม)
 *   ผ่านคุณลักษณะ `member_of_list` ตัวดำเนินการ "อยู่ในรายชื่อ / ไม่อยู่ในรายชื่อ"
 *
 * ★ ขอบเขต: รายชื่อของบริษัท (tenant_id ว่าง) ทุกตัวแทนใช้ได้ · รายชื่อของตัวแทนเห็นเฉพาะตัวเอง
 *   ตัวแทนแก้ได้เฉพาะรายชื่อของตัวเอง — จะไปแก้ของบริษัทไม่ได้
 */

function _clScope(session, payload) { return String(_effectiveTenantId(session, payload || {}) || ''); }

/**
 * รายชื่อที่ scope นี้มองเห็น
 *  - ฝั่งบริษัท (scope ว่าง) เห็นทั้งหมด รวมของตัวแทน — บริษัทดูแลตัวแทนอยู่แล้ว และต้องตอบได้ว่า
 *    ตัวแทนเอารายชื่อไหนไปผูกกับโปรบ้าง (แก้ของตัวแทนยังไม่ได้ ดู saveCustomerList)
 *  - ฝั่งตัวแทน เห็นของบริษัท + ของตัวเอง เท่านั้น
 */
function _clVisible(scope) {
  return centralObjects('customer_lists').filter(function(l) {
    if (!scope) return true;
    var owner = String(l.tenant_id || '');
    return owner === '' || owner === scope;
  });
}

/** ดัชนีสมาชิก { listId: { customerId: 1 } } — ใช้ตอนตรวจกฎสิทธิ์ */
function customerListIndex() {
  var idx = {};
  centralObjects('customer_list_members').forEach(function(m) {
    (idx[String(m.list_id)] = idx[String(m.list_id)] || {})[String(m.customer_id)] = 1;
  });
  return idx;
}

/** ลูกค้ารายนี้อยู่ในรายชื่อไหนบ้าง (คืนเป็นรายการ id) — ใช้โดย plrCustomerValue */
function customerListsOf(customerId, idx) {
  idx = idx || customerListIndex();
  var out = [];
  Object.keys(idx).forEach(function(listId) { if (idx[listId][String(customerId)]) out.push(listId); });
  return out;
}

function listCustomerLists(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  var scope = _clScope(session, payload);
  var idx = customerListIndex();
  return { success: true, tenantId: scope, data: _clVisible(scope).map(function(l) {
    return { id: l.record_id, name: l.name, tenantId: l.tenant_id || '', note: l.note || '',
      count: Object.keys(idx[String(l.record_id)] || {}).length,
      canEdit: !scope || String(l.tenant_id || '') === scope };
  }) };
}

function saveCustomerList(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var scope = _clScope(session, payload);
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'ต้องตั้งชื่อรายชื่อ' };
  if (payload.id) {
    var cur = null;
    centralObjects('customer_lists').forEach(function(l) { if (String(l.record_id) === String(payload.id)) cur = l; });
    if (!cur) return { success: false, message: 'ไม่พบรายชื่อนี้' };
    // ตัวแทนแก้ของบริษัทไม่ได้ — ไม่งั้นตัวแทนรายหนึ่งแก้แล้วกระทบทุกตัวแทน
    if (scope && String(cur.tenant_id || '') !== scope) return { success: false, message: 'รายชื่อนี้เป็นของบริษัท แก้ได้เฉพาะฝั่งบริษัท' };
    centralUpdate('customer_lists', payload.id, { name: name, note: String(payload.note || '').trim() });
    return { success: true, id: payload.id, message: 'บันทึกแล้ว' };
  }
  var id = centralNextId('customer_lists');
  centralAppend('customer_lists', { record_id: id, name: name, tenant_id: scope,
    note: String(payload.note || '').trim(), created_at: nowStr(), created_by: String(session.adminUserId || '') });
  return { success: true, id: id, message: 'สร้างรายชื่อ "' + name + '" แล้ว' };
}

function deleteCustomerList(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var scope = _clScope(session, payload);
  var cur = null;
  centralObjects('customer_lists').forEach(function(l) { if (String(l.record_id) === String(payload.id)) cur = l; });
  if (!cur) return { success: false, message: 'ไม่พบรายชื่อนี้' };
  if (scope && String(cur.tenant_id || '') !== scope) return { success: false, message: 'รายชื่อนี้เป็นของบริษัท ลบได้เฉพาะฝั่งบริษัท' };
  // เตือนถ้ามีกฎอ้างอยู่ — ลบไปแล้วกฎจะไม่เข้าเงื่อนไขอีกเลยโดยไม่มีอะไรฟ้อง
  var used = centralObjects('price_list_rule_conditions').filter(function(c) {
    return String(c.field) === 'member_of_list' && _plrList(c.value).indexOf(String(payload.id)) !== -1;
  }).length;
  if (used && !payload.force) {
    return { success: false, needConfirm: true,
      message: 'รายชื่อนี้ถูกใช้ในกฎสิทธิ์อยู่ ' + used + ' เงื่อนไข — ลบแล้วกฎเหล่านั้นจะไม่เข้าเงื่อนไขอีกเลย ยืนยันหรือไม่' };
  }
  deleteRowsWhere(centralSheet('customer_list_members'), 'list_id', payload.id);
  deleteRowsWhere(centralSheet('customer_lists'), 'record_id', payload.id);
  centralInvalidate('customer_list_members'); centralInvalidate('customer_lists');
  return { success: true, message: 'ลบรายชื่อแล้ว' };
}

function listCustomerListMembers(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  payload = payload || {};
  var idx = customerListIndex()[String(payload.id)] || {};
  var rows = centralObjects('customers').filter(function(c) { return idx[String(c.record_id)]; })
    .map(function(c) { return { id: c.record_id, code: c.customer_code || '', externalCode: c.external_code || '',
      name: customerFullName(c), tenantId: c.tenant_id || '', areaCode: c.area_code || '' }; });
  return { success: true, data: rows };
}

/**
 * เพิ่มสมาชิกจาก "รหัสร้าน" ที่วางมาเป็นข้อความ (คั่นด้วย , เว้นวรรค หรือขึ้นบรรทัดใหม่)
 * ★ รับได้ทั้ง customer_code และ external_code — ใบอนุมัติจริงใช้รหัสของระบบเดิม (เช่น RSM.310040)
 *   ถ้ารับแค่รหัสของเรา คนจะต้องมานั่งแปลงรหัสทีละร้านเอง ซึ่งจะพิมพ์ผิดแน่นอน
 * รหัสที่หาไม่เจอถูกรายงานกลับ ไม่ใช่ข้ามเงียบ
 */
function addCustomerListMembers(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var scope = _clScope(session, payload);
  var cur = null;
  centralObjects('customer_lists').forEach(function(l) { if (String(l.record_id) === String(payload.id)) cur = l; });
  if (!cur) return { success: false, message: 'ไม่พบรายชื่อนี้' };
  if (scope && String(cur.tenant_id || '') !== scope) return { success: false, message: 'รายชื่อนี้เป็นของบริษัท แก้ได้เฉพาะฝั่งบริษัท' };

  var codes = String(payload.codes || '').split(/[\s,;]+/).map(function(x) { return x.trim().toLowerCase(); }).filter(Boolean);
  if (!codes.length) return { success: false, message: 'ยังไม่ได้ใส่รหัสร้าน' };

  var byCode = {};
  centralObjects('customers').forEach(function(c) {
    if (scope && String(c.tenant_id || '') !== scope) return;   // ตัวแทนใส่ได้เฉพาะร้านของตัวเอง
    [c.customer_code, c.external_code].forEach(function(k) {
      if (k) byCode[String(k).trim().toLowerCase()] = c;
    });
  });

  var already = customerListIndex()[String(payload.id)] || {};
  var add = [], notFound = [], dup = 0, seen = {};
  codes.forEach(function(code) {
    var c = byCode[code];
    if (!c) { if (notFound.indexOf(code) === -1) notFound.push(code); return; }
    if (already[String(c.record_id)] || seen[String(c.record_id)]) { dup++; return; }
    seen[String(c.record_id)] = 1;
    add.push(c);
  });
  if (add.length) {
    var nextId = centralNextId('customer_list_members');
    centralAppendMany('customer_list_members', add.map(function(c, i) {
      return { record_id: nextId + i, list_id: payload.id, customer_id: c.record_id, added_at: nowStr() };
    }));
  }
  return { success: true, added: add.length, duplicates: dup, notFound: notFound,
    message: 'เพิ่ม ' + add.length + ' ร้าน' + (dup ? ' · ซ้ำ ' + dup : '') +
      (notFound.length ? ' · ★ หารหัสไม่เจอ ' + notFound.length + ' รหัส: ' + notFound.slice(0, 8).join(', ') : '') };
}

function removeCustomerListMember(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var n = _deleteRowsMatching(centralSheet('customer_list_members'), function(m) {
    return String(m.list_id) === String(payload.id) && String(m.customer_id) === String(payload.customerId);
  });
  centralInvalidate('customer_list_members');
  return { success: true, removed: n, message: n ? 'เอาออกจากรายชื่อแล้ว' : 'ไม่พบร้านนี้ในรายชื่อ' };
}
