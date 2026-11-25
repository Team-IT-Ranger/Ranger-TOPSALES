/**
 * ===================== อนุมัติผู้ใช้งานแอปมือถือผ่าน LINE (25 พ.ย. 2026) =====================
 * เกิดจากงาน sales blitz ของศูนย์ BDC: ทีมขายชั่วคราวจำนวนมากต้องสมัครใช้แอปมือถือ แล้วต้องมีคนกดอนุมัติให้ทัน
 * เจ้าของระบบออกแบบไว้ว่า
 *   1) มีคนกดสมัครในแอป → ระบบ **ส่งการ์ดเข้ากลุ่ม LINE** ที่ตั้งไว้ (หรือ DM ผู้อนุมัติ) พร้อมปุ่ม "เปิดหน้าอนุมัติ"
 *   2) ปุ่มเปิดแอปมือถือ (LIFF) ที่หน้าอนุมัติ — ผู้ที่มีสิทธิ์กด อนุมัติ/ไม่อนุมัติ ได้
 *   3) ตัดสินไปแล้วก็แก้ได้ที่แท็บ "ประวัติ" (เปลี่ยนจากอนุมัติเป็นไม่อนุมัติ หรือกลับกัน)
 *   4) ผู้อนุมัติเลือกบทบาท (ค่าตั้งต้น van_sales) และ **วันหมดอายุ** ตอนอนุมัติ — ทีมชั่วคราวหมดสิทธิ์เองตามวัน
 *
 * ★★ ลิงก์ในกลุ่มเปิดได้ทุกคน — **ความปลอดภัยอยู่ที่ตัวตน ไม่ใช่ตัวลิงก์**: ทุก action ของกลุ่มนี้ยืนยันตัวตนด้วย
 *   LINE ID token (`resolveLineIdentity`) แล้วหา "คนนี้มีสิทธิ์อนุมัติตัวแทนรายไหนบ้าง" ใหม่ทุกครั้ง (`_saApproverCtx`)
 *   คนอื่นในกลุ่มที่แตะลิงก์ก็เห็นแค่ "คุณไม่มีสิทธิ์อนุมัติ" · ตัวแทนที่อนุมัติได้ **ตัดสินจาก "ใครเป็นคนกด" ไม่ใช่จากลิงก์**
 *
 * ★★ ใครอนุมัติได้ (เจ้าของระบบเลือก 25 พ.ย. 2026: "ใช้สิทธิเดิม + ตั้งรายชื่อเพิ่ม"):
 *   (ก) สิทธิเดิม — บัญชีแอดมินที่ผูก LINE ไว้และมีสิทธิ์แก้โมดูล "staff" · ขอบเขตตัวแทนใช้กติกาเดียวกับระบบอยู่แล้ว:
 *       สังกัดตัวแทน = รายเดียวของตัวเอง · super_admin = ทุกราย · แอดมินฝั่งบริษัทอื่น = ตามผู้รับผิดชอบตัวแทน
 *       (`managedTenantIds` ใน 57_user_tenants.gs — ตัวเดียวกัน ไม่เขียนกฎชุดที่สอง)
 *   (ข) รายชื่อเพิ่ม — ตาราง `staff_approvers` ตั้งให้ใครก็ได้ของบริษัท (รวมพนักงานขายที่ไม่มีบัญชีแอดมิน)
 *       อนุมัติได้หลายตัวแทน · **ให้สิทธิ์อนุมัติอย่างเดียว ไม่ได้ให้สิทธิ์อื่นของแอดมิน**
 *       ★ คนละตารางกับ `admin_user_tenants` โดยตั้งใจ — อันนั้น "ย่อรายการ" ไม่ใช่ "ให้สิทธิ์" (ดูหัวไฟล์ 57)
 *       เอามารวมกัน = คนที่เคยถูกแต่งตั้งไว้ดูสต็อกในบอทจะกลายเป็นผู้อนุมัติโดยไม่มีใครสั่ง
 *
 * ★ สถานะ `liff_users.status`: `No` = รออนุมัติ (ค่าเดิม ไม่เปลี่ยน) · `Yes` = อนุมัติ · **`Rejected` = ไม่อนุมัติ (ใหม่)**
 *   เหตุผลที่ไม่ใช้ `No` แทนการปฏิเสธ: แยกไม่ออกว่า "ยังไม่มีใครดู" กับ "ดูแล้วไม่ให้" ซึ่งคือสิ่งที่หน้าประวัติต้องตอบ
 * ★ `expires_at` = วันสุดท้ายที่ใช้ได้ (นับรวมวันนั้นทั้งวัน เวลาไทย) · ว่าง = ไม่หมดอายุ
 *   ตัวตัดสินอยู่ที่ `checkUser()` (04_auth.gs) คืน `expired` — **ทุกด่านที่เช็คว่า "อนุมัติแล้วไหม" ต้องดู expired ด้วย**
 *   (ด่านมือถือ `_handleMobileActionCore` · หน้าบูตแอป · บอท LINE ที่อ่านชีตเอง)
 */

var SA_LOG = 'staff_approval_log';
var SA_APPROVERS = 'staff_approvers';
var SA_ST_PENDING = 'No', SA_ST_YES = 'Yes', SA_ST_REJECTED = 'Rejected';
var SA_ROLES = { van_sales: 'พนักงานขับรถ (เงินสด)', credit_sales: 'พนักงานเครดิต' };
var SA_DEFAULT_ROLE = 'van_sales';          // เจ้าของระบบสั่ง: blitz = ขายหาร้านใหม่ ต้องเก็บเงินสด
var SA_LIST_LIMIT = 300;
/* ★ แคมเปญสมัครใช้งาน (25 พ.ย. 2026 เจ้าของระบบสั่ง: "ลิงก์เฉพาะพร้อม QR ระบุให้ชัดว่าเป็นการขออนุมัติแบบ sales blitz")
   ลิงก์/QR ของทีม blitz พก `c=BLITZ` → แอปมือถือโชว์หัวฟอร์มว่าเป็นทีม Sales Blitz + ล็อกสังกัดตามลิงก์ · registerUser เก็บป้ายไว้ที่ `liff_users.campaign`
   → การ์ดในกลุ่ม LINE/หน้าอนุมัติ/หน้าแอดมิน ติดป้าย "Sales Blitz" ให้ผู้อนุมัติแยกออกจากคนสมัครปกติได้ทันที
   ★ ค่าที่ไม่อยู่ในรายการนี้ถูกทิ้งเป็นว่าง ไม่ใช่เก็บตามที่ส่งมา — ลิงก์สมัครเป็นของสาธารณะ ใครแก้ URL ใส่อะไรมาก็ได้ */
var SA_CAMPAIGNS = { BLITZ: 'Sales Blitz' };
function _saCampaignOf(v) { var k = String(v == null ? '' : v).trim().toUpperCase(); return SA_CAMPAIGNS[k] ? k : ''; }

// ───────────────────────── ตัวช่วยเล็ก ─────────────────────────
function _saNorm(status) {
  var s = String(status == null ? '' : status).trim();
  if (s === SA_ST_YES) return SA_ST_YES;
  if (s === SA_ST_REJECTED) return SA_ST_REJECTED;
  return SA_ST_PENDING;
}
function _saToday() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'); }
/** วันที่เป็น 'yyyy-MM-dd' เสมอ — Sheets แปลงข้อความวันที่เป็น Date เองได้ จึงรับทั้งสองแบบ
 *  ★ เช็ค Date ด้วย toString ไม่ใช่ instanceof (ข้าม realm ไม่ได้ในชุดทดสอบ และกันค่าที่มาจาก cache) */
function _saDateStr(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  var m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
/** หมดอายุแล้วไหม — ใช้ได้ถึงสิ้นวันที่ระบุ (วันที่ระบุยังใช้ได้) */
function _saExpired(expiresAt) { var e = _saDateStr(expiresAt); return !!e && e < _saToday(); }
function _saValidDate(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  var y = +m[1], mo = +m[2], d = +m[3];
  var dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
function _saTime(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime() || 0;
  var t = Date.parse(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(v)) ? '' : '+07:00'));
  return isNaN(t) ? 0 : t;
}
function _saStamp(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v);
}
function _saTenantNames() {
  var out = {};
  centralObjects('tenants').forEach(function(t) {
    out[String(t.tenant_id)] = _autTenantLabel(String(t.tenant_id), String(t.name || t.tenant_id));
  });
  return out;
}

// ───────────────────────── อ่าน/เขียน liff_users ตามชื่อหัวคอลัมน์ ─────────────────────────
// ★ liff_users เดิมถูกเขียนด้วยตำแหน่งคอลัมน์ (04_auth/10_master_data) — คอลัมน์ใหม่ต่อท้ายจึงไม่กระทบของเดิม
//   แต่ **ที่นี่เขียนตามชื่อหัว** และต้อง centralEnsureColumns ก่อนเสมอ ไม่งั้นค่าถูกทิ้งเงียบๆ
//   (บทเรียน warehouses.purpose 23 ต.ค. 2026)
function _saLiffRows() {
  centralEnsureColumns('liff_users');
  var sh = centralSheet('liff_users');
  try { // วันหมดอายุเป็นข้อความล้วน — กัน Sheets แปลงเป็น Date แล้ววันเลื่อนตามเขตเวลาของไฟล์
    var h0 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var ec = h0.indexOf('expires_at');
    if (ec !== -1) sh.getRange(2, ec + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  } catch (e) {}
  var data = sh.getDataRange().getValues();
  var col = {};
  (data[0] || []).forEach(function(h, i) { if (h !== '' && col[h] === undefined) col[h] = i; });
  return { sh: sh, data: data, col: col };
}
function _saFind(rs, lineUserId) {
  var c = rs.col['line_user_id'] === undefined ? 0 : rs.col['line_user_id'];
  for (var i = 1; i < rs.data.length; i++) if (String(rs.data[i][c]) === String(lineUserId)) return i;
  return -1;
}
function _saObjAt(rs, i) {
  var o = {};
  Object.keys(rs.col).forEach(function(k) { o[k] = rs.data[i][rs.col[k]]; });
  return o;
}
/** เขียนหลายช่องของแถวเดียวในครั้งเดียว (อ่านทั้งแถว → แก้ในหน่วยความจำ → เขียนกลับ) */
function _saWrite(rs, i, fields) {
  var width = rs.data[0].length;
  var row = rs.data[i].slice();
  while (row.length < width) row.push('');
  Object.keys(fields).forEach(function(k) {
    if (rs.col[k] === undefined) throw new Error('liff_users ขาดคอลัมน์ ' + k);
    row[rs.col[k]] = fields[k];
  });
  rs.sh.getRange(i + 1, 1, 1, width).setValues([row]);
  rs.data[i] = row;
  centralInvalidate('liff_users');
}
function _saLog(entry) {
  try {
    entry.record_id = centralNextId(SA_LOG);
    entry.created_at = nowStr();
    centralAppend(SA_LOG, entry);
  } catch (e) { Logger.log('staff_approval_log: ' + e); }   // บันทึกประวัติพังต้องไม่ทำให้การอนุมัติล้ม (ตัดสินไปแล้ว)
}

// ───────────────────────── ใครอนุมัติได้ ─────────────────────────
/**
 * คืน null = ไม่มีสิทธิ์อนุมัติเลย · ไม่งั้น { lineUserId, name, all, tenants:{id:1}, adminUserId, viaRole, viaList }
 * ★ ทุก action ของกลุ่มนี้เรียกตัวนี้ใหม่ทุกครั้ง ไม่แคช — สิทธิ์ต้องสดเสมอ (หลักเดียวกับ liff_users/admin_users)
 */
function _saApproverCtx(lineUserId) {
  var lid = String(lineUserId || '').trim();
  if (!lid) return null;
  var active = _autActiveTenantMap();
  var ctx = { lineUserId: lid, name: '', all: false, tenants: {}, adminUserId: '', viaRole: false, viaList: false };

  var admin = null;
  centralObjects('admin_users').forEach(function(u) { if (String(u.line_user_id || '') === lid) admin = u; });
  var adminOk = !!admin && String(admin.status) === ADMIN_STATUS_ACTIVE && !!String(admin.role_code || '').trim();
  if (adminOk) {
    ctx.name = String(admin.display_name || admin.username || '');
    ctx.adminUserId = String(admin.record_id);
    if (hasPermission(admin, 'staff', 'edit')) {
      ctx.viaRole = true;
      var own = String(admin.tenant_id || '');
      if (own && own !== OWNER_TENANT_ID) ctx.tenants[own] = 1;                         // สังกัดตัวแทน = รายเดียวของตัวเอง
      else if (String(admin.role_code) === 'super_admin') ctx.all = true;
      else managedTenantIds(admin).forEach(function(t) { ctx.tenants[t] = 1; });        // ฝั่งบริษัท = ตามผู้รับผิดชอบ
    }
  } else {
    // ไม่มีบัญชีแอดมินที่ใช้ได้ → ต้องเป็นพนักงานขายที่ยังใช้งานได้อยู่ (อนุมัติแล้ว ยังไม่หมดอายุ)
    var staff = null;
    centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === lid) staff = u; });
    if (!staff || _saNorm(staff.status) !== SA_ST_YES || _saExpired(staff.expires_at)) return null;
    ctx.name = String(staff.display_name || '');
  }

  centralObjects(SA_APPROVERS).forEach(function(r) {
    var mine = (ctx.adminUserId && String(r.admin_user_id || '') === ctx.adminUserId) || String(r.line_user_id || '') === lid;
    if (!mine) return;
    var t = String(r.tenant_id || '');
    if (t && active[t] !== undefined) { ctx.tenants[t] = 1; ctx.viaList = true; }
  });

  if (!ctx.all && !Object.keys(ctx.tenants).length) return null;
  return ctx;
}
function _saInScope(ctx, tenantId) {
  if (ctx.all) return true;
  var t = String(tenantId || '');
  return !!t && ctx.tenants[t] === 1;
}

// ───────────────────────── action ของผู้อนุมัติ (แอปมือถือ — ยืนยันตัวตนด้วย LINE ID token) ─────────────────────────
/** เรียกจาก doPost() หลัง resolveLineIdentity แล้วเท่านั้น (แยกจาก _handleMobileActionCore เพราะผู้อนุมัติไม่จำเป็นต้องเป็นพนักงานขายที่อนุมัติแล้ว) */
function _handleApproverActionCore(lineUserId, action, payload) {
  try {
    var ctx = _saApproverCtx(lineUserId);
    if (action === 'getApproverContext') return getApproverContext(ctx);
    if (!ctx) return { success: false, notApprover: true, message: 'คุณไม่มีสิทธิ์อนุมัติผู้ใช้งาน — ติดต่อผู้ดูแลระบบถ้าควรมีสิทธิ์' };
    var fn = APPROVER_ACTION_MAP[action];
    if (!fn) return { success: false, message: 'ไม่พบ action: ' + action };
    return fn(ctx, payload || {});
  } catch (e) {
    Logger.log('ERROR [' + action + ']: ' + (e.stack || e.message));
    return { success: false, message: 'ระบบผิดพลาด: ' + e.message };
  }
}

/** ถามเฉยๆ ว่าเป็นผู้อนุมัติไหม — คนทั่วไปได้ isApprover:false ไม่ใช่ error (แอปถามทุกครั้งที่เปิด ต้องเงียบ) */
/** สรุปผู้อนุมัติ: ชื่อ · ดูแลตัวแทนไหนบ้าง · มีกี่คำขอรออยู่ — getApproverContext และ listStaffApprovals ใช้ตัวเดียวกัน */
function _saMe(ctx, names, pendingCount) {
  var tenants = ctx.all
    ? centralObjects('tenants').filter(function(t) { return isFlagOn(t.is_active); }).map(function(t) { return String(t.tenant_id); })
    : Object.keys(ctx.tenants);
  return { name: ctx.name, all: ctx.all, pendingCount: pendingCount,
    tenants: tenants.map(function(t) { return { tenantId: t, name: names[t] || t }; })
      .sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'th'); }) };
}
function getApproverContext(ctx) {
  if (!ctx) return { success: true, isApprover: false };
  var pending = 0;
  centralObjects('liff_users').forEach(function(u) {
    if (_saNorm(u.status) === SA_ST_PENDING && _saInScope(ctx, u.tenant_id)) pending++;
  });
  var me = _saMe(ctx, _saTenantNames(), pending);
  return { success: true, isApprover: true, name: me.name, all: me.all, pendingCount: pending, tenants: me.tenants };
}

function _saRowOut(u, names) {
  var status = _saNorm(u.status);
  var exp = _saDateStr(u.expires_at);
  var role = String(u.role || '');
  return {
    lineUserId: String(u.line_user_id || ''), name: String(u.display_name || ''),
    tenantId: String(u.tenant_id || ''), tenantName: names[String(u.tenant_id || '')] || String(u.tenant_id || ''),
    role: role, roleLabel: SA_ROLES[role] || role,
    status: status, requestedAt: _saStamp(u.requested_at), decidedAt: _saStamp(u.decided_at),
    decidedBy: String(u.decided_by_name || ''), note: String(u.decision_note || ''),
    expiresAt: exp, expired: !!exp && exp < _saToday(), lastLogin: _saStamp(u.last_login),
    campaign: _saCampaignOf(u.campaign), campaignLabel: SA_CAMPAIGNS[_saCampaignOf(u.campaign)] || ''
  };
}

/**
 * payload: { view:'pending'|'history', tenantId?, q?, filter?:'all'|'approved'|'rejected', uid? }
 * uid = เปิดมาจากลิงก์ในกลุ่ม → คืน `focus` ของคนนั้นมาด้วยไม่ว่าสถานะไหน (ถ้าอยู่ในขอบเขต) เพื่อให้หน้าจอพาไปหาได้ทันที
 */
function listStaffApprovals(ctx, payload) {
  payload = payload || {};
  var view = payload.view === 'history' ? 'history' : 'pending';
  var q = String(payload.q || '').trim().toLowerCase();
  var tenantFilter = String(payload.tenantId || '').trim();
  var f = String(payload.filter || 'all');
  var names = _saTenantNames();

  var mine = centralObjects('liff_users').filter(function(u) { return _saInScope(ctx, u.tenant_id); });
  var counts = { pending: 0, approved: 0, rejected: 0 };
  var focus = null;
  mine.forEach(function(u) {
    var s = _saNorm(u.status);
    if (s === SA_ST_PENDING) counts.pending++; else if (s === SA_ST_YES) counts.approved++; else counts.rejected++;
    if (payload.uid && String(u.line_user_id) === String(payload.uid)) focus = _saRowOut(u, names);
  });

  var rows = mine.filter(function(u) {
    var s = _saNorm(u.status);
    if (view === 'pending' ? s !== SA_ST_PENDING : s === SA_ST_PENDING) return false;
    if (view === 'history' && f === 'approved' && s !== SA_ST_YES) return false;
    if (view === 'history' && f === 'rejected' && s !== SA_ST_REJECTED) return false;
    if (tenantFilter && String(u.tenant_id) !== tenantFilter) return false;
    if (q && (String(u.display_name || '') + ' ' + String(u.line_user_id || '') + ' ' + (names[String(u.tenant_id)] || '')).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  rows.sort(function(a, b) {
    var ta = view === 'history' ? (_saTime(a.decided_at) || _saTime(a.last_login)) : _saTime(a.requested_at);
    var tb = view === 'history' ? (_saTime(b.decided_at) || _saTime(b.last_login)) : _saTime(b.requested_at);
    return tb - ta;                 // ใหม่สุดก่อน · ไม่มีเวลา (ของเก่าก่อนมีฟีเจอร์นี้) ไปท้ายสุด
  });
  var total = rows.length;
  /* ★ ส่ง `me` มากับรายการเลย (25 พ.ย. 2026 — ผู้ใช้แจ้งว่าหน้าอนุมัติเปิดช้า) — เดิมแอปถาม getApproverContext ก่อนแล้วค่อยถามรายการ
     สองคำขอเรียงกัน = จ่ายค่าคงที่ ~1.6 วิ ซ้ำสองรอบ · ตอนนี้คำขอเดียวตอบได้ทั้งสิทธิ์และรายการ (คนไม่มีสิทธิ์ได้ notApprover เหมือนเดิม) */
  return { success: true, view: view, counts: counts, total: total, truncated: total > SA_LIST_LIMIT, me: _saMe(ctx, names, counts.pending),
    data: rows.slice(0, SA_LIST_LIMIT).map(function(u) { return _saRowOut(u, names); }), focus: focus };
}

/**
 * payload: { lineUserId, decision:'approve'|'reject', role?, expiresAt?('yyyy-MM-dd' หรือว่าง), note?, expectStatus? }
 * ★ ทำได้ทั้งจากแท็บรออนุมัติและแท็บประวัติ — "แก้ไขคำตัดสิน" คือการเรียกอีกครั้งด้วยค่าใหม่ (ไม่มี action แยก)
 * ★★ expectStatus = สถานะที่หน้าจอเห็นตอนกด — ในกลุ่มมีผู้อนุมัติหลายคนกดลิงก์เดียวกันพร้อมกันได้
 *   ถ้าสถานะจริงไม่ตรงกับที่คนกดเห็น = ปฏิเสธพร้อมบอกว่าใครตัดสินไปแล้ว ไม่ใช่เขียนทับกันเงียบๆ
 */
function decideStaffApproval(ctx, payload) {
  payload = payload || {};
  var lid = String(payload.lineUserId || '').trim();
  var decision = String(payload.decision || '');
  if (!lid) return { success: false, message: 'ไม่ได้ระบุผู้ใช้' };
  if (decision !== 'approve' && decision !== 'reject') return { success: false, message: 'คำตัดสินไม่ถูกต้อง' };
  if (lid === ctx.lineUserId) return { success: false, message: 'อนุมัติหรือแก้สิทธิ์ของตัวเองไม่ได้' };

  var role = String(payload.role || '').trim() || SA_DEFAULT_ROLE;
  if (decision === 'approve' && !SA_ROLES[role]) return { success: false, message: 'บทบาทไม่ถูกต้อง' };
  var exp = String(payload.expiresAt || '').trim();
  if (decision === 'approve' && exp) {
    if (!_saValidDate(exp)) return { success: false, message: 'วันหมดอายุไม่ถูกต้อง' };
    if (exp < _saToday()) return { success: false, message: 'วันหมดอายุต้องไม่ใช่วันที่ผ่านมาแล้ว' };
  }
  var note = String(payload.note || '').trim().substring(0, 200);

  return _withDocLock(function() {
    var rs = _saLiffRows();
    var i = _saFind(rs, lid);
    if (i < 0) return { success: false, message: 'ไม่พบผู้ใช้นี้' };
    var u = _saObjAt(rs, i);
    if (!_saInScope(ctx, u.tenant_id)) return { success: false, message: 'ไม่มีสิทธิ์อนุมัติผู้ใช้ของสังกัดนี้' };
    var from = _saNorm(u.status);
    if (payload.expectStatus !== undefined && payload.expectStatus !== null && _saNorm(payload.expectStatus) !== from) {
      var did = from === SA_ST_YES ? 'อนุมัติ' : from === SA_ST_REJECTED ? 'ไม่อนุมัติ' : 'ย้ายกลับเป็นรออนุมัติ';
      return { success: false, conflict: true, currentStatus: from,
        message: 'ผู้ใช้นี้ถูก' + did + 'ไปแล้ว' + (u.decided_by_name ? ' โดย ' + u.decided_by_name : '') +
          (u.decided_at ? ' เมื่อ ' + _saStamp(u.decided_at) : '') + ' — ดูสถานะล่าสุดที่แท็บประวัติ' };
    }
    var to = decision === 'approve' ? SA_ST_YES : SA_ST_REJECTED;
    var fields = { status: to, decided_by: ctx.lineUserId, decided_by_name: ctx.name || '', decided_at: nowStr(), decision_note: note };
    if (decision === 'approve') { fields.role = role; fields.expires_at = exp; }
    else fields.expires_at = '';
    _saWrite(rs, i, fields);

    _saLog({ line_user_id: lid, display_name: String(u.display_name || ''), tenant_id: String(u.tenant_id || ''),
      from_status: from, to_status: to, role: decision === 'approve' ? role : String(u.role || ''), expires_at: decision === 'approve' ? exp : '',
      by_line_user_id: ctx.lineUserId, by_name: ctx.name || '', note: note, channel: 'mobile' });
    try { cacheClearUser(lid); } catch (e) {}
    try { _saNotifyRequester(lid, to, exp); } catch (e) { Logger.log('notify requester: ' + e); }

    var out = _saRowOut(_saObjAt(rs, i), _saTenantNames());
    return { success: true, row: out,
      message: decision === 'approve' ? (from === SA_ST_YES ? 'บันทึกการแก้ไขแล้ว' : 'อนุมัติแล้ว') : 'ไม่อนุมัติแล้ว' };
  });
}

// ───────────────────────── แจ้งเตือนผ่าน LINE ─────────────────────────
/**
 * ส่งผ่าน Messaging API ด้วย token ของ **บอท** (`LINE_CHANNEL_ACCESS_TOKEN`) — ต้องตั้งใน Script Properties ของ backend
 * ทั้ง UAT และ prod (บอทอยู่คนละโปรเจกต์ มี token ของตัวเอง แต่ที่นี่ต้องมีเองด้วย เพราะเรียกข้ามโปรเจกต์ไม่ได้)
 * ★ ไม่มี token / ส่งไม่สำเร็จ = **ไม่ล้มการสมัคร** (คนสมัครไปแล้ว ย้อนไม่ได้) แค่ log ไว้ — แอดมินยังเห็นในคิวเหมือนเดิม
 * ★ บอทต้อง **อยู่ในกลุ่มนั้น** ถึงจะส่งเข้ากลุ่มได้ · DM ได้เฉพาะคนที่เพิ่มเพื่อนกับบอทไว้
 */
function _saPush(to, messages) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { Logger.log('staff approval push: ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN'); return { ok: false, reason: 'no_token' }; }
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: messages }), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) Logger.log('staff approval push → ' + to + ' ตอบ ' + code + ': ' + res.getContentText());
    return { ok: code === 200, status: code };
  } catch (e) { Logger.log('staff approval push error: ' + e); return { ok: false, reason: String(e) }; }
}

/** ลิงก์เปิดหน้าอนุมัติในแอปมือถือ (LIFF) — ไม่มี LIFF_ID = ไม่มีลิงก์ (คืนว่าง) */
function _saApprovalLink(lineUserId) {
  var liffId = getConfig().LIFF_ID;
  if (!liffId) return '';
  return 'https://liff.line.me/' + liffId + '?go=approvals' + (lineUserId ? '&u=' + encodeURIComponent(lineUserId) : '');
}

/** ปลายทางแจ้งเตือน: กลุ่มที่ตั้งไว้ (Script Property STAFF_APPROVAL_LINE_GROUP_ID — คั่นหลายกลุ่มด้วยจุลภาคได้)
 *  ถ้าไม่ตั้งกลุ่ม → DM ผู้อนุมัติที่ถูกตั้งไว้ในรายชื่อเพิ่มของตัวแทนนั้น */
function _saNotifyTargets(tenantId) {
  var raw = String(PropertiesService.getScriptProperties().getProperty('STAFF_APPROVAL_LINE_GROUP_ID') || '');
  var groups = raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return !!s; });
  if (groups.length) return groups;
  var adminLine = {};
  centralObjects('admin_users').forEach(function(u) { adminLine[String(u.record_id)] = String(u.line_user_id || ''); });
  var seen = {}, out = [];
  centralObjects(SA_APPROVERS).forEach(function(r) {
    if (String(r.tenant_id || '') !== String(tenantId || '')) return;
    var lid = String(r.line_user_id || '') || adminLine[String(r.admin_user_id || '')] || '';
    if (lid && !seen[lid]) { seen[lid] = 1; out.push(lid); }
  });
  return out.slice(0, 20);
}

function _saRequestCard(name, tenantLabel, requestedAt, link, campaignLabel) {
  var rows = [
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: 'ชื่อ', size: 'xs', color: '#8A94A6', flex: 2 },
      { type: 'text', text: name || '(ไม่ระบุชื่อ)', size: 'sm', weight: 'bold', color: '#1B2433', flex: 5, wrap: true } ] },
    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
      { type: 'text', text: 'สังกัด', size: 'xs', color: '#8A94A6', flex: 2 },
      { type: 'text', text: tenantLabel || '-', size: 'sm', color: '#1B2433', flex: 5, wrap: true } ] },
    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
      { type: 'text', text: 'เวลา', size: 'xs', color: '#8A94A6', flex: 2 },
      { type: 'text', text: requestedAt || '-', size: 'sm', color: '#1B2433', flex: 5, wrap: true } ] }
  ];
  var bubble = {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: campaignLabel ? '#6D4AFF' : '#B4741A', paddingAll: '16px', spacing: 'xs', contents: [
      { type: 'text', text: (campaignLabel ? '🚀  คำขอทีม ' + campaignLabel : '🙋  คำขอใช้งานแอปใหม่'), size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true },
      { type: 'text', text: campaignLabel ? 'สมัครผ่านลิงก์/QR ของทีม ' + campaignLabel + ' · รอผู้อนุมัติตัดสิน' : 'รอผู้อนุมัติตัดสิน', size: 'xs', color: '#FCEEDA', wrap: true } ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: rows.concat([
      { type: 'text', text: 'ใครมีสิทธิ์อนุมัติ กดปุ่มด้านล่างได้เลย (คนที่ไม่มีสิทธิ์จะกดเข้าไปแล้วดำเนินการไม่ได้)', size: 'xs', color: '#8A94A6', wrap: true, margin: 'lg' } ]) }
  };
  if (link) {
    bubble.footer = { type: 'box', layout: 'vertical', paddingAll: '12px', contents: [
      { type: 'button', style: 'primary', color: '#2B63D9', height: 'sm', action: { type: 'uri', label: 'เปิดหน้าอนุมัติ', uri: link } } ] };
  }
  return { type: 'flex', altText: (campaignLabel ? 'คำขอทีม ' + campaignLabel : 'คำขอใช้งานแอปใหม่') + ': ' + (name || '') + ' (' + (tenantLabel || '') + ')', contents: bubble };
}

/** เรียกจาก registerUser() หลังบันทึกคำขอแล้ว — ห้าม throw ออกไป (ผู้เรียกครอบ try อีกชั้น) */
function _saNotifyNewRequest(lineUserId, name, tenantId, campaign) {
  var targets = _saNotifyTargets(tenantId);
  if (!targets.length) { Logger.log('staff approval: ไม่มีปลายทางแจ้งเตือน (ยังไม่ได้ตั้ง STAFF_APPROVAL_LINE_GROUP_ID และไม่มีผู้อนุมัติในรายชื่อเพิ่ม)'); return; }
  var tenantLabel = _saTenantNames()[String(tenantId)] || String(tenantId || '');
  var card = _saRequestCard(String(name || ''), tenantLabel, nowStr(), _saApprovalLink(lineUserId), SA_CAMPAIGNS[_saCampaignOf(campaign)] || '');
  targets.forEach(function(to) { _saPush(to, [card]); });
}

/** บอกคนสมัครว่าผลเป็นอย่างไร — ได้เฉพาะคนที่เพิ่มเพื่อนกับบอทไว้ ที่เหลือ LINE ปฏิเสธเงียบๆ (ไม่ใช่เรื่อง) */
function _saNotifyRequester(lineUserId, toStatus, expiresAt) {
  var text = toStatus === SA_ST_YES
    ? '✅ คุณได้รับอนุมัติให้ใช้งานแอปแล้ว เปิดแอปได้เลย' + (expiresAt ? '\nใช้งานได้ถึงวันที่ ' + expiresAt : '')
    : '❌ คำขอใช้งานแอปของคุณไม่ได้รับอนุมัติ — สอบถามผู้ดูแลระบบได้ครับ';
  _saPush(lineUserId, [{ type: 'text', text: text }]);
}

// ───────────────────────── ตั้งรายชื่อผู้อนุมัติเพิ่ม (แอปแอดมิน — ฝั่งบริษัทเท่านั้น) ─────────────────────────
/** รายชื่อที่ตั้งไว้ + คนที่เลือกเพิ่มได้ (ต้องผูก LINE แล้ว) + ตัวแทนทั้งหมดให้ติ๊ก */
function listStaffApprovers(session, payload) {
  var err = _requirePermission(session, 'staff', 'view'); if (err) return err;
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัทเจ้าของสินค้าตั้งผู้อนุมัติได้' };
  var active = _autActiveTenantMap();
  var tenants = Object.keys(active).map(function(t) {
    return { tenantId: t, name: _autTenantLabel(t, active[t]), isOwner: t === OWNER_TENANT_ID };
  }).sort(function(a, b) {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'th');
  });
  var byAdmin = {}, byStaff = {};
  centralObjects(SA_APPROVERS).forEach(function(r) {
    var t = String(r.tenant_id || '');
    if (String(r.admin_user_id || '')) (byAdmin[String(r.admin_user_id)] = byAdmin[String(r.admin_user_id)] || []).push(t);
    else if (String(r.line_user_id || '')) (byStaff[String(r.line_user_id)] = byStaff[String(r.line_user_id)] || []).push(t);
  });
  var live = function(list) { return (list || []).filter(function(t) { return active[t] !== undefined; }); };

  var people = [], adminLine = {};
  centralObjects('admin_users').forEach(function(u) {
    var lid = String(u.line_user_id || '');
    if (lid) adminLine[lid] = 1;
    if (!_isCompanySide({ tenant_id: u.tenant_id }) || String(u.status) !== ADMIN_STATUS_ACTIVE || !lid) return;
    people.push({ kind: 'admin', adminUserId: String(u.record_id), lineUserId: lid, name: String(u.display_name || u.username),
      sub: 'แอดมิน', tenantIds: live(byAdmin[String(u.record_id)]), byRole: String(u.role_code) === 'super_admin' });
  });
  centralObjects('liff_users').forEach(function(u) {
    var lid = String(u.line_user_id || '');
    if (!lid || adminLine[lid]) return;                       // คนที่มีบัญชีแอดมินตั้งผ่านบัญชีแอดมินเท่านั้น (ไม่ให้มีสองชุดขัดกัน)
    if (!_isCompanySide({ tenant_id: u.tenant_id }) || _saNorm(u.status) !== SA_ST_YES || _saExpired(u.expires_at)) return;
    people.push({ kind: 'staff', adminUserId: '', lineUserId: lid, name: String(u.display_name || lid),
      sub: 'พนักงานขายบริษัท', tenantIds: live(byStaff[lid]), byRole: false });
  });
  people.sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
  return { success: true, tenants: tenants, people: people, hasGroup: !!String(PropertiesService.getScriptProperties().getProperty('STAFF_APPROVAL_LINE_GROUP_ID') || '').trim() };
}

/** payload: { adminUserId | lineUserId, tenantIds:[…] } — เขียนทับทั้งชุดของคนนั้น · รายการว่าง = ถอนสิทธิ์ที่ตั้งเพิ่ม */
function saveStaffApprover(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  if (!_isCompanySide(session)) return { success: false, message: 'เฉพาะฝั่งบริษัทเจ้าของสินค้าตั้งผู้อนุมัติได้' };
  payload = payload || {};
  var userId = String(payload.adminUserId || '').trim(), lineId = String(payload.lineUserId || '').trim();
  if (!userId && !lineId) return { success: false, message: 'ไม่ได้ระบุบุคคล' };
  if (userId && lineId) return { success: false, message: 'ระบุได้ทีละคน (บัญชีแอดมิน หรือ พนักงานขาย)' };

  if (userId) {
    var admin = null;
    centralObjects('admin_users').forEach(function(u) { if (String(u.record_id) === userId) admin = u; });
    if (!admin) return { success: false, message: 'ไม่พบบัญชีนี้' };
    if (!_isCompanySide({ tenant_id: admin.tenant_id })) return { success: false, message: 'บัญชีนี้สังกัดตัวแทนอยู่แล้ว — อนุมัติได้เฉพาะตัวแทนของตัวเองตามสิทธิ์เดิม' };
    if (!String(admin.line_user_id || '').trim()) return { success: false, message: 'บัญชีนี้ยังไม่ได้ผูก LINE — ผูกก่อนถึงจะอนุมัติผ่านแอปมือถือได้' };
  } else {
    var staff = null;
    centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === lineId) staff = u; });
    if (!staff) return { success: false, message: 'ไม่พบพนักงานรายนี้' };
    if (_saNorm(staff.status) !== SA_ST_YES) return { success: false, message: 'พนักงานรายนี้ยังไม่ได้รับอนุมัติให้ใช้งาน' };
    if (!_isCompanySide({ tenant_id: staff.tenant_id })) return { success: false, message: 'พนักงานรายนี้สังกัดตัวแทนอยู่แล้ว — ตั้งเป็นผู้อนุมัติของตัวแทนอื่นไม่ได้' };
    var dup = null;
    centralObjects('admin_users').forEach(function(u) { if (String(u.line_user_id || '') === lineId) dup = u; });
    if (dup) return { success: false, message: 'คนนี้มีบัญชีแอดมินอยู่แล้ว (' + dup.username + ') — ตั้งที่บัญชีแอดมินแทน' };
  }

  var active = _autActiveTenantMap(), want = [], seen = {}, bad = [];
  (payload.tenantIds || []).forEach(function(t) {
    var id = String(t || '').trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    if (active[id] === undefined) bad.push(id); else want.push(id);
  });
  if (bad.length) return { success: false, message: 'ไม่พบตัวแทน (หรือปิดใช้งานแล้ว): ' + bad.join(', ') };

  return _withDocLock(function() {
    var sh = centralSheet(SA_APPROVERS);
    deleteRowsWhere(sh, userId ? 'admin_user_id' : 'line_user_id', userId || lineId);
    if (want.length) {
      var nextId = centralNextId(SA_APPROVERS);
      centralAppendMany(SA_APPROVERS, want.map(function(t, i) {
        return { record_id: nextId + i, admin_user_id: userId, line_user_id: lineId, tenant_id: t,
          created_at: nowStr(), created_by: String(session && session.adminUserId || '') };
      }));
    }
    return { success: true, tenantIds: want, message: want.length ? ('ตั้งเป็นผู้อนุมัติ ' + want.length + ' ตัวแทน') : 'ถอนสิทธิ์อนุมัติที่ตั้งเพิ่มแล้ว' };
  });
}

// ───────────────────────── ลิงก์/QR สมัครของทีม Sales Blitz ─────────────────────────
/**
 * คืนลิงก์ LIFF เฉพาะสำหรับทีม blitz ของตัวแทนรายหนึ่ง — หน้าแอดมินเอาไปทำ QR/ภาพโปสเตอร์ให้แจก
 * payload: { tenantId? } · ตัวแทน (หรือ Ultra Admin ที่สวมสิทธิ์ตัวแทน) = ตัวแทนของตัวเองเสมอ · ฝั่งบริษัท = ต้องเลือกตัวแทน
 * ★ ลิงก์สร้างจาก LIFF_ID ของ env ที่ถามอยู่ (UAT/prod คนละตัว) — หน้าแอดมินไม่รู้ LIFF_ID เอง จึงต้องถาม backend
 *   ลิงก์ UAT ที่ปริ้นท์แจกหน้างานจะพาคนไปสมัครในระบบทดสอบ (ทีมจะรออนุมัติตลอดไป) → ตอบ `env` กลับไปให้หน้าจอเตือน
 * ★ ลิงก์พกแค่ "แคมเปญ + ตัวแทน" ไม่มีอะไรที่เป็นสิทธิ์ · ใครสแกนก็แค่ได้ฟอร์มสมัคร แล้วต้องรอผู้อนุมัติกดอยู่ดี
 */
function _saRegisterLink(campaign, tenantId) {
  var liffId = getConfig().LIFF_ID;
  if (!liffId) return '';
  return 'https://liff.line.me/' + liffId + '?go=register&c=' + encodeURIComponent(campaign) + (tenantId ? '&t=' + encodeURIComponent(tenantId) : '');
}
function getBlitzRegisterLink(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  payload = payload || {};
  var tenantId = String(_effectiveTenantId(session, payload) || '').trim();
  if (!tenantId) tenantId = String(payload.tenantId || '').trim();
  if (!tenantId) return { success: false, message: 'เลือกตัวแทนที่ทีม blitz สังกัดก่อน' };
  var row = _activeTenantRow(tenantId);
  if (!row) return { success: false, message: 'ไม่พบตัวแทนจำหน่ายนี้ (หรือถูกปิดการใช้งานอยู่)' };
  var url = _saRegisterLink('BLITZ', tenantId);
  if (!url) return { success: false, message: 'ยังไม่ได้ตั้ง LIFF_ID ใน Script Properties ของ backend นี้ — สร้างลิงก์ไม่ได้' };
  return { success: true, url: url, tenantId: tenantId, tenantName: _saTenantNames()[tenantId] || String(row.name || tenantId),
    campaign: 'BLITZ', campaignLabel: SA_CAMPAIGNS.BLITZ, env: String(PropertiesService.getScriptProperties().getProperty('ENV_NAME') || 'prod') };
}

// ───────────────────────── ทางแอปแอดมินเดิม (updateStaffAdmin) ต้องบันทึกประวัติเหมือนกัน ─────────────────────────
/**
 * updateStaffAdmin (10_master_data.gs) เขียนสถานะด้วยตำแหน่งคอลัมน์ — เรียกต่อท้ายเพื่อประทับ "ใครตัดสิน/เมื่อไหร่/หมดอายุ" + ลงประวัติ
 * ไม่งั้นผู้อนุมัติฝั่งหน้าเว็บ กับฝั่งมือถือ จะเห็นประวัติคนละชุด (คนที่อนุมัติผ่านหน้าเว็บจะไม่โผล่ในแท็บประวัติเลย)
 * ★ ล้มเหลวต้องไม่ทำให้การอนุมัติล้ม — ผู้เรียกครอบ try (สถานะถูกเขียนไปแล้วก่อนถึงตรงนี้)
 */
function _saStampAdminDecision(lineUserId, before, payload, session) {
  if (payload.status === undefined && payload.expiresAt === undefined) return;
  var rs = _saLiffRows();
  var i = _saFind(rs, lineUserId);
  if (i < 0) return;
  var u = _saObjAt(rs, i);
  var by = String(session && session.displayName || session && session.username || '');
  var fields = { decided_by: 'admin:' + String(session && session.adminUserId || ''), decided_by_name: by, decided_at: nowStr() };
  if (payload.expiresAt !== undefined) fields.expires_at = String(payload.expiresAt || '').trim();
  else if (payload.status && _saNorm(payload.status) !== SA_ST_YES) fields.expires_at = '';
  _saWrite(rs, i, fields);
  _saLog({ line_user_id: String(lineUserId), display_name: String(u.display_name || ''), tenant_id: String(u.tenant_id || ''),
    from_status: _saNorm(before), to_status: _saNorm(u.status), role: String(u.role || ''), expires_at: fields.expires_at === undefined ? _saDateStr(u.expires_at) : fields.expires_at,
    by_line_user_id: 'admin:' + String(session && session.adminUserId || ''), by_name: by, note: '', channel: 'admin' });
  try { cacheClearUser(lineUserId); } catch (e) {}
  if (payload.status !== undefined && _saNorm(payload.status) !== _saNorm(before) && _saNorm(payload.status) !== SA_ST_PENDING) {
    try { _saNotifyRequester(String(lineUserId), _saNorm(payload.status), fields.expires_at || ''); } catch (e) {}
  }
}
