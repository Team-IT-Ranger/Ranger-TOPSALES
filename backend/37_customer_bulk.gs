/**
 * ===================== จัดกลุ่มลูกค้าเป็นชุด (bulk assign) =====================
 * ปัญหาที่ทำให้ต้องมี: นำเข้าร้านค้า BDC 2,039 ราย ได้ทุกแถวที่ `group_id = 0`
 * ซึ่งแปลว่า **ขายไม่ได้เลย** เพราะกลุ่มลูกค้าเป็นตัวชี้ว่าได้ชุดราคาไหน
 * จะไล่แก้ทีละร้านในหน้าจอก็เป็นไปไม่ได้ และเขียนสคริปต์ครั้งเดียวทิ้งก็จะต้องเขียนใหม่ทุกครั้งที่นำเข้าข้อมูลรอบหน้า
 *
 * ★ ใช้ "ตัวสร้างเงื่อนไข" ชุดเดียวกับกฎสิทธิ์ชุดราคา (36_price_rules.gs)
 *   คนตั้งค่าจึงเรียนรู้ครั้งเดียวใช้ได้สองที่ และเงื่อนไขที่ทดลองในหน้าจัดกลุ่มก็เอาไปเป็นกฎสิทธิ์ได้ตรงๆ
 *
 * ★ กันพลาดสามชั้น เพราะงานนี้แก้ข้อมูลทีละพันแถวและย้อนกลับไม่ได้:
 *   1) เงื่อนไขว่าง = ปฏิเสธ (ไม่งั้น "ไม่มีเงื่อนไข" จะแปลว่า "ทุกร้าน")
 *   2) ต้องส่ง confirmCount ที่หน้าจอแสดงให้ผู้ใช้เห็นมาด้วย ถ้าไม่ตรงกับที่นับได้จริง = ปฏิเสธ
 *      (ข้อมูลเปลี่ยนระหว่างที่ยังเปิดหน้าจอค้างไว้ แล้วกดยืนยันทีหลัง คือเคสที่อันตรายที่สุด)
 *   3) เขียนเฉพาะคอลัมน์ใน whitelist และเฉพาะแถวที่ค่าเปลี่ยนจริง
 */

/** คอลัมน์ที่ยอมให้แก้เป็นชุด — จงใจไม่ให้แตะชื่อ/ที่อยู่/เลขภาษี ซึ่งเป็นข้อมูลรายร้านที่ต้องแก้ทีละราย */
var CB_SETTABLE = {
  group_id:              { label: 'กลุ่มลูกค้า', type: 'group' },
  channel_id:            { label: 'ประเภทร้าน / ช่องทาง', type: 'channel' },
  area_code:             { label: 'เขต / สายวิ่ง', type: 'text' },
  sales_mode:            { label: 'รูปแบบการขาย', type: 'text' },
  payment_type:          { label: 'การชำระเงินตั้งต้น', type: 'text' },
  salesman_line_user_id: { label: 'พนักงานขายประจำร้าน', type: 'text' },
  status:                { label: 'สถานะลูกค้า', type: 'text' }
};

/** ลูกค้าในขอบเขตที่บัญชีนี้มองเห็น (ตัวแทนเห็นเฉพาะของตัวเอง เหมือน listCustomersAdmin) */
function _cbScopedCustomers(session, payload) {
  var rows = centralObjects('customers');
  var tenantId = _salesTenantId(session, payload || {});
  if (tenantId) rows = rows.filter(function(c) { return String(c.tenant_id) === String(tenantId); });
  return { rows: rows, tenantId: tenantId };
}

/** เงื่อนไขจาก payload → รูปที่ plrRuleMatches ใช้ได้ (ตัดแถวที่ยังไม่ได้เลือกฟิลด์ทิ้ง) */
function _cbConditions(payload) {
  return (payload.conditions || []).map(function(c) {
    return { field: String(c.field || ''), op: String(c.op || 'eq'), value: c.value === undefined ? '' : c.value };
  }).filter(function(c) { return c.field; });
}

function _cbMatcher(payload) {
  var conds = _cbConditions(payload);
  var rule = { matchType: String(payload.matchType || PLR_MATCH_ALL) };
  return { conds: conds, fn: function(c) { return plrRuleMatches(c, rule, conds); } };
}

/**
 * ดูก่อนว่าเงื่อนไขนี้โดนกี่ร้าน และตอนนี้ร้านเหล่านั้นอยู่กลุ่มอะไรกันบ้าง
 * "ตอนนี้อยู่กลุ่มอะไร" สำคัญกว่าที่คิด — มันคือสิ่งที่บอกว่ากำลังจะ**ทับ**ของเดิมหรือกำลังเติมของที่ยังว่าง
 */
function previewCustomerBulkAssign(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  payload = payload || {};
  var scoped = _cbScopedCustomers(session, payload);
  var m = _cbMatcher(payload);
  if (!m.conds.length) {
    return { success: true, matched: 0, total: scoped.rows.length, samples: [], byGroup: [],
      meta: plrMeta(scoped.rows), settable: CB_SETTABLE,
      message: 'ยังไม่ได้ตั้งเงื่อนไข — ตั้งอย่างน้อยหนึ่งข้อก่อน (เงื่อนไขว่างไม่ถือว่า "ทุกร้าน" โดยตั้งใจ)' };
  }
  var groupName = {};
  centralObjects('customer_groups').forEach(function(g) { groupName[String(g.record_id)] = g.name; });

  var hit = scoped.rows.filter(m.fn);
  var by = {};
  hit.forEach(function(c) {
    var k = String(c.group_id || '0');
    (by[k] = by[k] || { groupId: k, name: groupName[k] || (k === '0' || k === '' ? '(ยังไม่ได้จัดกลุ่ม)' : 'กลุ่ม ' + k), count: 0 }).count++;
  });
  return { success: true,
    matched: hit.length, total: scoped.rows.length,
    samples: hit.slice(0, 25).map(function(c) {
      return { code: c.customer_code || c.external_code || '', name: customerFullName(c),
        groupId: String(c.group_id || '0'), areaCode: c.area_code || '' };
    }),
    byGroup: Object.keys(by).map(function(k) { return by[k]; }).sort(function(a, b) { return b.count - a.count; }),
    meta: plrMeta(scoped.rows), settable: CB_SETTABLE };
}

/**
 * ลงมือแก้จริง — payload { conditions, matchType, set:{...}, confirmCount }
 * คืนจำนวนที่แก้ไปจริง (แถวที่ค่าเดิมตรงกับค่าใหม่อยู่แล้วไม่นับ)
 */
function applyCustomerBulkAssign(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var m = _cbMatcher(payload);
  if (!m.conds.length) return { success: false, message: 'ต้องตั้งเงื่อนไขอย่างน้อยหนึ่งข้อ' };

  var set = payload.set || {}, fields = {}, labels = [];
  Object.keys(set).forEach(function(k) {
    if (!CB_SETTABLE[k]) return;                       // นอก whitelist = เมิน ไม่ใช่ error (หน้าเว็บรุ่นเก่าอาจส่งมา)
    var v = set[k];
    if (v === undefined || v === null || String(v) === '') return;   // ช่องว่าง = "ไม่เปลี่ยนคอลัมน์นี้"
    fields[k] = String(v);
    labels.push(CB_SETTABLE[k].label + ' = ' + v);
  });
  if (!Object.keys(fields).length) return { success: false, message: 'ยังไม่ได้เลือกว่าจะตั้งค่าอะไร' };

  // status ต้องเขียนคู่กับ is_active/inactive_at เสมอ (กติกาของ customers — ดู buildCustomerFields)
  if (fields.status !== undefined) {
    var st = fields.status;
    fields.is_active = st === CUSTOMER_STATUS_INACTIVE ? 'FALSE' : 'TRUE';
    fields.inactive_at = st === CUSTOMER_STATUS_INACTIVE
      ? function(c) { return c.inactive_at ? c.inactive_at : nowStr(); }   // ปิดซ้ำไม่ทับวันที่ปิดครั้งแรก
      : '';
  }

  var scoped = _cbScopedCustomers(session, payload);
  var hit = scoped.rows.filter(m.fn);
  if (payload.confirmCount !== undefined && payload.confirmCount !== null &&
      Number(payload.confirmCount) !== hit.length) {
    return { success: false, message: 'จำนวนร้านที่เข้าเงื่อนไขเปลี่ยนไปจากตอนที่กดดูตัวอย่าง (ตอนนั้น ' +
      Number(payload.confirmCount) + ' ร้าน ตอนนี้ ' + hit.length + ' ร้าน) — กดดูตัวอย่างใหม่แล้วตรวจอีกครั้งก่อนยืนยัน' };
  }
  if (!hit.length) return { success: false, message: 'ไม่มีร้านไหนเข้าเงื่อนไขนี้' };

  var ids = {}; hit.forEach(function(c) { ids[String(c.record_id)] = 1; });
  fields.updated_at = nowStr();
  fields.updated_by = String(session.adminUserId || '');
  var res = updateColumnsWhere(centralSheet('customers'),
    function(c) { return ids[String(c.record_id)] === 1; }, fields);

  return { success: true, matched: res.matched, changed: res.matched,
    message: 'ตั้งค่า ' + labels.join(' · ') + ' ให้ลูกค้า ' + res.matched + ' ร้านแล้ว' };
}
