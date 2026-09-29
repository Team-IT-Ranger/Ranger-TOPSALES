/**
 * ===================== คู่มือใช้งานระบบ (Help Center) — module 8 =====================
 * เจ้าของระบบสั่ง 2026-09-29: "Training-Free" สำหรับแอดมินตัวแทน — เนื้อหาต้องแก้ได้ทันทีไม่ต้องรอ deploy
 * จึงเก็บเป็นตาราง help_articles ใน Central Sheet (ไม่ hardcode ใน index.html) แก้ผ่านหน้าจอ 8.1.1 เองได้
 * (super_admin/owner_admin เท่านั้นที่แก้ได้ — เป็นเนื้อหากลางของทั้งระบบ ไม่ใช่ของตัวแทนรายใดรายหนึ่ง)
 * ทุกคนที่ล็อกอินแล้วอ่านได้หมด ไม่ต้องเช็คสิทธิ์รายโมดูล (เนื้อหาคู่มือไม่ใช่ข้อมูลอ่อนไหว)
 */

// whitelist หมวดหมู่ — พิมพ์ผิดแล้วปฏิเสธตั้งแต่บันทึก (เหมือนแพทเทิร์น PLR_FIELDS ใน 36_price_rules.gs)
// เพิ่มหมวดใหม่ต้องแก้ทั้งที่นี่และ HELP_CATEGORIES ฝั่ง index.html (ป้ายภาษาไทย + ลำดับแสดงผล)
var HELP_CATEGORIES = { start: 1, sales: 1, customers: 1, purchasing: 1, users: 1, settings: 1 };

function _isHelpEditor(session) {
  return session && (session.role_code === 'super_admin' || session.role_code === 'owner_admin');
}

// payload.includeInactive: ใช้เฉพาะหน้าจอแก้ไข (ต้องเห็นบทความที่ปิดไว้ด้วย) — คนอ่านทั่วไปเห็นแต่ที่เปิดใช้งาน
function listHelpArticles(session, payload) {
  payload = payload || {};
  var rows = centralObjects('help_articles');
  var wantInactive = !!payload.includeInactive && _isHelpEditor(session);
  if (!wantInactive) rows = rows.filter(function(a) { return isFlagOn(a.is_active); });
  rows.sort(function(a, b) {
    if (a.category !== b.category) return String(a.category).localeCompare(String(b.category));
    var sa = Number(a.sort_order) || 0, sb = Number(b.sort_order) || 0;
    if (sa !== sb) return sa - sb;
    return Number(a.record_id) - Number(b.record_id);
  });
  return {
    success: true,
    canEdit: _isHelpEditor(session),
    data: rows.map(function(a) {
      return { id: String(a.record_id), code: a.code, category: a.category, title: a.title,
        summary: a.summary || '', body: a.body || '', sortOrder: Number(a.sort_order) || 0,
        isActive: isFlagOn(a.is_active) };
    })
  };
}

// payload: { id?, code, category, title, summary, body, sortOrder, isActive }
// id ไม่ส่งมา/ว่าง = สร้างใหม่ · ส่งมา = แก้ของเดิม (โค้ดซ้ำกับตัวอื่นได้เฉพาะตอนแก้ตัวเอง)
function saveHelpArticle(session, payload) {
  if (!_isHelpEditor(session)) return { success: false, message: 'เฉพาะเจ้าของระบบ (Ultra Admin/บริษัท) เท่านั้นที่แก้คู่มือได้' };
  payload = payload || {};
  var code = String(payload.code || '').trim();
  var category = String(payload.category || '').trim();
  var title = String(payload.title || '').trim();
  if (!code) return { success: false, message: 'กรุณาใส่รหัสบทความ (code) — ใช้อ้างอิงภายใน เช่น sales-01' };
  if (!HELP_CATEGORIES[category]) return { success: false, message: 'หมวดหมู่ไม่ถูกต้อง: ' + category };
  if (!title) return { success: false, message: 'กรุณาใส่หัวข้อ' };

  var rows = centralObjects('help_articles');
  var id = payload.id ? String(payload.id) : '';
  var dup = rows.find(function(a) { return String(a.code) === code && String(a.record_id) !== id; });
  if (dup) return { success: false, message: 'รหัสบทความ "' + code + '" ถูกใช้แล้ว (หัวข้อ: ' + dup.title + ')' };

  var fields = {
    code: code, category: category, title: title,
    summary: String(payload.summary || '').trim(),
    body: String(payload.body || ''),
    sort_order: Number(payload.sortOrder) || 0,
    is_active: payload.isActive === false ? 'FALSE' : 'TRUE',
    updated_at: nowStr(), updated_by: session.adminUserId
  };

  if (id) {
    var existing = rows.find(function(a) { return String(a.record_id) === id; });
    if (!existing) return { success: false, message: 'ไม่พบบทความนี้' };
    centralUpdate('help_articles', id, fields);
    return { success: true, id: id, message: 'บันทึกแล้ว' };
  }
  fields.record_id = centralNextId('help_articles');
  centralAppend('help_articles', fields);
  return { success: true, id: String(fields.record_id), message: 'เพิ่มบทความแล้ว' };
}

// เปิด/ปิดการมองเห็น — ไม่ลบจริง (เนื้อหาที่เขียนไว้แล้วอาจเอากลับมาใช้ได้ ไม่ต้องพิมพ์ใหม่)
function setHelpArticleActive(session, payload) {
  if (!_isHelpEditor(session)) return { success: false, message: 'เฉพาะเจ้าของระบบ (Ultra Admin/บริษัท) เท่านั้นที่แก้คู่มือได้' };
  payload = payload || {};
  var id = String(payload.id || '');
  var rows = centralObjects('help_articles');
  var existing = rows.find(function(a) { return String(a.record_id) === id; });
  if (!existing) return { success: false, message: 'ไม่พบบทความนี้' };
  centralUpdate('help_articles', id, { is_active: payload.isActive === false ? 'FALSE' : 'TRUE', updated_at: nowStr(), updated_by: session.adminUserId });
  return { success: true };
}
