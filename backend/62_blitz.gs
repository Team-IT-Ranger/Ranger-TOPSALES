/**
 * ===================== แคมเปญ BLITZ RANGER (26 พ.ย. 2026) =====================
 *
 * เกิดจากงานจริง: ออกขายแข่งกันเป็นทีม (Team A–E) ในเขตของตัวแทนหนึ่งราย ช่วงวันที่ตั้งไว้ (ครั้งแรก 28–29 พ.ย. 2026)
 *   · ทุกบิลของทีมคิดราคา "เงินสด" เสมอ ไม่ว่าจะเลือกชำระเงินสดหรือเครดิต
 *   · ทีมละ 1 คนเท่านั้นที่ป้อนบิล (บทบาท seller) · คนอื่นในทีมเป็น member (ไม่ต้องมีบัญชีแอป)
 *   · สต็อก "ผูกกับทีม" ไม่ผูกกับตัวคน — เบิกจากคลังกลางให้ทีม ขายจากสต็อกทีม คืนของที่เหลือตอนปิดวัน
 *   · ผู้อำนวยการโครงการ (director) ดูแดชบอร์ดเทียบทีมบนมือถือได้ทันที — ไม่ต้องเป็นพนักงานขายที่อนุมัติแล้ว
 *
 * ★★ การตัดสินใจที่ห้ามกลับทิศ
 *   1) สต็อกทีมใช้ตาราง `van_stock` เดิม โดยใช้ "รหัสผู้ถือ" เป็น `TEAM:<แคมเปญ>:<ทีม>` แทน LINE id
 *      — ทุกอย่างที่ผูกกับสต็อกรถ (ตัดสต็อก · ต้นทุนที่พกมา · COGS · ยกเลิกบิลแล้วคืนของ) ใช้ซ้ำได้โดยไม่มีตรรกะชุดที่สอง
 *      · บิลเก็บ `stock_holder` ไว้บนแถว → ยกเลิกแล้วของคืนเข้าทีมที่ตัดไป แม้ภายหลังเปลี่ยนคนป้อนบิลแล้ว
 *   2) บิลถูกติดแคมเปญ/ทีม **ณ วินาทีที่บันทึก** (ภาพนิ่ง) — ย้ายคนทีหลังไม่กระทบยอดเดิม
 *   3) ราคาเงินสดบังคับที่ฝั่งเซิร์ฟเวอร์ (`forceCash` ใน _priceSaleCart) ไม่ใช่ปุ่มบนมือถือ
 *   4) ยอดขายในแดชบอร์ดเป็น **ก่อนภาษี** เสมอ (กติกาของระบบ — orderExVat)
 */

var BZ_CAMPAIGNS = 'blitz_campaigns', BZ_TEAMS = 'blitz_teams', BZ_MEMBERS = 'blitz_members';
var BZ_ROLES = { seller: 'ผู้ป้อนบิล', member: 'สมาชิกทีม', director: 'ผู้อำนวยการโครงการ' };
var BZ_TEAM_CODES = ['A', 'B', 'C', 'D', 'E'];
var BZ_KEY_PREFIX = 'TEAM:';

function _bzD(v) { return String(safeDateStr(v) || '').substring(0, 10); }
function _bzActive(c, today) {
  if (String(c.status || 'active') !== 'active') return false;
  var s = _bzD(c.start_date), e = _bzD(c.end_date);
  return (!s || s <= today) && (!e || today <= e);
}
function _bzKey(campaignId, teamId) { return BZ_KEY_PREFIX + String(campaignId) + ':' + String(teamId); }
function _bzIsTeamKey(k) { return String(k || '').indexOf(BZ_KEY_PREFIX) === 0; }

/**
 * ตอนนี้ LINE id นี้เป็นผู้ป้อนบิลของทีมไหนในแคมเปญที่กำลังเดินอยู่ — null = ขายตามปกติ
 * ★ ถูกเรียกทุกครั้งที่คิดราคา/บันทึกบิล/เปิดแอป จึงอ่านเฉพาะตารางเล็กที่แคชไว้ และเลิกทันทีถ้าไม่มีแคมเปญที่เดินอยู่
 */
function blitzContextFor(lineUserId, tenantId, today) {
  var lid = String(lineUserId || '');
  if (!lid) return null;
  today = today || _todayStr();
  var camps = {}, any = false;
  centralObjects(BZ_CAMPAIGNS).forEach(function(c) {
    if (String(c.tenant_id) === String(tenantId) && _bzActive(c, today)) { camps[String(c.record_id)] = c; any = true; }
  });
  if (!any) return null;
  var mem = null;
  centralObjects(BZ_MEMBERS).forEach(function(m) {
    if (String(m.line_user_id) === lid && String(m.role) === 'seller' && camps[String(m.campaign_id)]) mem = m;
  });
  if (!mem) return null;
  var team = null;
  centralObjects(BZ_TEAMS).forEach(function(t) { if (String(t.record_id) === String(mem.team_id)) team = t; });
  if (!team) return null;
  var c = camps[String(mem.campaign_id)];
  return { campaignId: String(c.record_id), campaignName: String(c.name || ''), teamId: String(team.record_id),
    teamCode: String(team.code || ''), teamName: String(team.name || ''), stockKey: _bzKey(c.record_id, team.record_id),
    forceCash: isNotOff(c.cash_price), endDate: _bzD(c.end_date) };
}

/** รหัสผู้ถือสต็อกของคนนี้ — ผู้ป้อนบิลของทีม = สต็อกทีม · คนอื่น = สต็อกรถของตัวเอง */
function blitzStockHolder(user, ctx) {
  ctx = ctx === undefined ? blitzContextFor(user.lineUserId, user.tenantId) : ctx;
  return ctx ? ctx.stockKey : String(user.lineUserId);
}

/** ส่งให้แอปมือถือ (bootstrap) — ป้ายทีม + คนนี้ดูแดชบอร์ดได้ไหม */
function blitzMobileInfo(user) {
  var ctx = blitzContextFor(user.lineUserId, user.tenantId);
  return {
    blitz: ctx ? { campaignName: ctx.campaignName, teamCode: ctx.teamCode, teamName: ctx.teamName, forceCash: ctx.forceCash, endDate: ctx.endDate } : null,
    blitzViewer: _bzViewerCampaigns(user.lineUserId).length > 0
  };
}

// ───────────────────────── แอดมิน: ตั้งค่าแคมเปญ ทีม สมาชิก ─────────────────────────
function _bzTenant(session, payload) {
  var t = String(_effectiveTenantId(session, payload) || '').trim() || String((payload && payload.tenantId) || '').trim();
  if (!t || t === OWNER_TENANT_ID) return { err: { success: false, message: 'เลือกตัวแทนที่ทำแคมเปญก่อน (แคมเปญทำในเขตของตัวแทนรายหนึ่ง)' } };
  if (!_isCompanySide(session) && String(session.tenant_id) !== t) return { err: { success: false, message: 'ไม่มีสิทธิ์ในตัวแทนนี้' } };
  var row = _activeTenantRow(t);
  if (!row) return { err: { success: false, message: 'ไม่พบตัวแทน (หรือปิดใช้งานแล้ว)' } };
  return { tenantId: t, tenantName: String(row.name || row.display_name || t) };
}
function _bzCampaignOf(id) {
  var out = null;
  centralObjects(BZ_CAMPAIGNS).forEach(function(c) { if (String(c.record_id) === String(id)) out = c; });
  return out;
}
function _bzTeamOf(id) {
  var out = null;
  centralObjects(BZ_TEAMS).forEach(function(t) { if (String(t.record_id) === String(id)) out = t; });
  return out;
}
function _bzCampaignForSession(session, id) {
  var c = _bzCampaignOf(id);
  if (!c) return { err: { success: false, message: 'ไม่พบแคมเปญนี้' } };
  if (!_isCompanySide(session) && String(session.tenant_id) !== String(c.tenant_id)) return { err: { success: false, message: 'ไม่พบแคมเปญนี้' } };
  return { camp: c };
}
function _bzEnsureCols() { [BZ_CAMPAIGNS, BZ_TEAMS, BZ_MEMBERS].forEach(centralEnsureColumns); }
function _bzClearMember(lineUserId) { if (lineUserId) { try { cacheClear('bootstrap', lineUserId); cacheClearUser(lineUserId); } catch (e) {} } }

function _bzNameOfLine(lid) {
  var name = '';
  centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === lid && !name) name = String(u.display_name || ''); });
  if (!name) centralObjects('admin_users').forEach(function(u) { if (String(u.line_user_id || '') === lid && !name) name = String(u.display_name || u.username || ''); });
  return name;
}

/** คนที่เลือกได้ (ผูก LINE แล้ว): พนักงานแอปมือถือที่อนุมัติแล้ว + แอดมินที่ผูก LINE */
function _bzPeople() {
  var seen = {}, out = [];
  centralObjects('admin_users').forEach(function(u) {
    var lid = String(u.line_user_id || '').trim();
    if (!lid || String(u.status) !== ADMIN_STATUS_ACTIVE || seen[lid]) return;
    seen[lid] = 1;
    out.push({ lineUserId: lid, name: String(u.display_name || u.username || lid), sub: 'แอดมิน', tenantId: String(u.tenant_id || '') });
  });
  centralObjects('liff_users').forEach(function(u) {
    var lid = String(u.line_user_id || '').trim();
    if (!lid || seen[lid] || _saNorm(u.status) !== SA_ST_YES || _saExpired(u.expires_at)) return;
    seen[lid] = 1;
    out.push({ lineUserId: lid, name: String(u.display_name || lid), sub: 'พนักงานขาย', tenantId: String(u.tenant_id || '') });
  });
  return out.sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
}

/** payload: { tenantId?, campaignId? } — สถานะทั้งหมดของหน้าตั้งค่าในคำขอเดียว */
function getBlitzAdmin(session, payload) {
  var err = _requirePermission(session, 'staff', 'view'); if (err) return err;
  payload = payload || {};
  var T = _bzTenant(session, payload); if (T.err) return T.err;
  var camps = centralObjects(BZ_CAMPAIGNS).filter(function(c) { return String(c.tenant_id) === T.tenantId; })
    .sort(function(a, b) { return (Number(b.record_id) || 0) - (Number(a.record_id) || 0); });
  var today = _todayStr();
  var pick = null;
  camps.forEach(function(c) { if (String(c.record_id) === String(payload.campaignId || '')) pick = c; });
  if (!pick) camps.forEach(function(c) { if (!pick && _bzActive(c, today)) pick = c; });
  if (!pick) pick = camps[0] || null;
  var out = { success: true, tenantId: T.tenantId, tenantName: T.tenantName,
    campaigns: camps.map(function(c) { return { id: String(c.record_id), name: String(c.name || ''), startDate: _bzD(c.start_date), endDate: _bzD(c.end_date), status: String(c.status || 'active'), running: _bzActive(c, today) }; }),
    campaign: null, teams: [], members: [], people: _bzPeople(), roles: BZ_ROLES,
    viewerLink: _bzViewerLink(), env: String(PropertiesService.getScriptProperties().getProperty('ENV_NAME') || 'prod') };
  if (!pick) return out;

  out.campaign = { id: String(pick.record_id), code: String(pick.code || ''), name: String(pick.name || ''), startDate: _bzD(pick.start_date),
    endDate: _bzD(pick.end_date), status: String(pick.status || 'active'), cashPrice: isNotOff(pick.cash_price), running: _bzActive(pick, today) };
  var teams = centralObjects(BZ_TEAMS).filter(function(t) { return String(t.campaign_id) === String(pick.record_id); })
    .sort(function(a, b) { return String(a.code).localeCompare(String(b.code)); });
  var names = {};
  centralObjects('products').forEach(function(p) { names[String(p.record_id)] = { name: p.name, code: p.product_code }; });
  /* ตัวคูณหน่วยของแต่ละสินค้า (ลัง/แพ็ค = กี่หน่วยฐาน) ไว้ให้หน้ารับคืนของแตกยอดที่ทีมถืออยู่เป็น "ลัง แพ็ค ชิ้น" ให้คนอ่านออก
     · หน้าเว็บไม่คิดตัวคูณเอง (ตัวคูณอยู่ที่ product_units ที่เดียว) แค่เอาไปแตกยอดแสดงผล · ไม่มีตัวคูณ = 0 (หน้าเว็บข้ามหน่วยนั้น) */
  var factorsBy = {};
  centralObjects('product_units').forEach(function(u) {
    var f = parseFloat(u.unit_factor) || 0; if (f <= 1) return;
    var o = (factorsBy[String(u.product_id)] = factorsBy[String(u.product_id)] || { ct: 0, pk: 0 });
    if (isCaseUnit(u.unit_code) && !o.ct) o.ct = f;
    else if (isPackUnit(u.unit_code) && !o.pk) o.pk = f;
  });
  var stockBy = {};
  tenantObjectsIfExists(T.tenantId, 'van_stock').forEach(function(s) {
    var k = String(s.line_user_id || '');
    if (!_bzIsTeamKey(k)) return;
    var q = Number(s.qty) || 0;
    if (!q) return;
    var fx = factorsBy[String(s.product_id)] || { ct: 0, pk: 0 };
    (stockBy[k] = stockBy[k] || []).push({ productId: String(s.product_id), code: (names[String(s.product_id)] || {}).code || '', name: (names[String(s.product_id)] || {}).name || ('สินค้า ' + s.product_id), qty: q, cost: Number(s.avg_cost) || 0,
      ctFactor: fx.ct, pkFactor: fx.pk });
  });
  out.teams = teams.map(function(t) {
    return { id: String(t.record_id), code: String(t.code || ''), name: String(t.name || ''), targetSales: Number(t.target_sales) || 0,
      targetShops: Number(t.target_shops) || 0, stock: (stockBy[_bzKey(pick.record_id, t.record_id)] || []).sort(function(a, b) { return String(a.code).localeCompare(String(b.code)); }) };
  });
  out.members = centralObjects(BZ_MEMBERS).filter(function(m) { return String(m.campaign_id) === String(pick.record_id); })
    .map(function(m) { return { id: String(m.record_id), teamId: String(m.team_id || ''), lineUserId: String(m.line_user_id || ''), name: String(m.name || ''), role: String(m.role || 'member') }; });
  return out;
}

function _bzViewerLink() {
  var liffId = getConfig().LIFF_ID;
  return liffId ? ('https://liff.line.me/' + liffId + '?go=blitz') : '';
}

/** payload: { tenantId?, id?, name, startDate, endDate, status?, cashPrice? } — สร้างใหม่ = สร้างทีม A–E ให้เลย */
function saveBlitzCampaign(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  payload = payload || {};
  var T = _bzTenant(session, payload); if (T.err) return T.err;
  var name = String(payload.name || '').trim();
  var s = String(payload.startDate || '').trim(), e = String(payload.endDate || '').trim();
  var status = payload.status === 'closed' ? 'closed' : 'active';
  if (!name) return { success: false, message: 'ใส่ชื่อแคมเปญ' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return { success: false, message: 'ใส่วันเริ่ม–วันสิ้นสุดให้ครบ' };
  if (e < s) return { success: false, message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม' };

  return _withDocLock(function() {
    _bzEnsureCols();
    var id = payload.id ? String(payload.id) : '';
    var clash = null;
    centralObjects(BZ_CAMPAIGNS).forEach(function(c) {
      if (String(c.tenant_id) !== T.tenantId || String(c.record_id) === id || String(c.status || 'active') !== 'active') return;
      if (status === 'active' && !(e < _bzD(c.start_date) || s > _bzD(c.end_date))) clash = c;
    });
    if (clash) return { success: false, message: 'ช่วงวันที่ซ้อนกับแคมเปญ "' + clash.name + '" ที่ยังเปิดอยู่ — ระบบแยกทีมไม่ได้ถ้าสองแคมเปญเดินพร้อมกันในตัวแทนเดียว' };
    var row = { name: name, tenant_id: T.tenantId, start_date: s, end_date: e, status: status, cash_price: payload.cashPrice === false ? 'FALSE' : 'TRUE' };
    if (id) {
      var cur = _bzCampaignOf(id);
      if (!cur || String(cur.tenant_id) !== T.tenantId) return { success: false, message: 'ไม่พบแคมเปญนี้' };
      centralUpdate(BZ_CAMPAIGNS, id, row);
      // ผู้ป้อนบิลของแคมเปญนี้ต้องเห็นสถานะใหม่ทันที (เปิด/ปิดแคมเปญเปลี่ยนราคาและสต็อกที่ใช้)
      centralObjects(BZ_MEMBERS).forEach(function(m) { if (String(m.campaign_id) === id) _bzClearMember(String(m.line_user_id || '')); });
      return { success: true, id: id, message: 'บันทึกแคมเปญแล้ว' };
    }
    id = String(centralNextId(BZ_CAMPAIGNS));
    row.record_id = id; row.code = 'BLITZ-' + id; row.created_at = nowStr(); row.created_by = String(session.adminUserId || '');
    centralAppend(BZ_CAMPAIGNS, row);
    var nextTeam = centralNextId(BZ_TEAMS);
    centralAppendMany(BZ_TEAMS, BZ_TEAM_CODES.map(function(code, i) {
      return { record_id: nextTeam + i, campaign_id: id, code: code, name: 'Team ' + code, target_sales: 0, target_shops: 0 };
    }));
    return { success: true, id: id, message: 'สร้างแคมเปญแล้ว พร้อมทีม ' + BZ_TEAM_CODES.join(', ') };
  });
}

/** payload: { id, name?, targetSales?, targetShops? } */
function saveBlitzTeam(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  payload = payload || {};
  var t = _bzTeamOf(payload.id);
  if (!t) return { success: false, message: 'ไม่พบทีมนี้' };
  var G = _bzCampaignForSession(session, t.campaign_id); if (G.err) return G.err;
  var row = {};
  if (payload.name !== undefined) { row.name = String(payload.name || '').trim(); if (!row.name) return { success: false, message: 'ชื่อทีมต้องไม่ว่าง' }; }
  if (payload.targetSales !== undefined) row.target_sales = Math.max(0, Number(payload.targetSales) || 0);
  if (payload.targetShops !== undefined) row.target_shops = Math.max(0, Math.floor(Number(payload.targetShops) || 0));
  return _withDocLock(function() {
    centralUpdate(BZ_TEAMS, t.record_id, row);
    centralObjects(BZ_MEMBERS).forEach(function(m) { if (String(m.team_id) === String(t.record_id)) _bzClearMember(String(m.line_user_id || '')); });
    return { success: true, message: 'บันทึกทีมแล้ว' };
  });
}

/**
 * payload: { campaignId, teamId?, lineUserId?, name?, role: seller|member|director, replace? }
 * · seller = 1 คนต่อทีม (replace:true = ปลดคนเดิมลงเป็นสมาชิก) และต้องเป็นพนักงานที่อนุมัติแล้วของตัวแทนนี้ — เขาต้องเปิดบิลในแอปได้จริง
 * · member = ไม่ต้องมีบัญชี ใส่แค่ชื่อได้ · director = ต้องมี LINE id (กรอกเองได้ เพราะบางคนยังไม่เคยเข้าระบบ) ไม่ผูกทีม
 * · คนหนึ่งอยู่ได้ทีมเดียวต่อแคมเปญ (ที่มี LINE id) — ย้ายทีมโดยบันทึกใหม่ ไม่ต้องลบก่อน
 */
function saveBlitzMember(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  payload = payload || {};
  var G = _bzCampaignForSession(session, payload.campaignId); if (G.err) return G.err;
  var camp = G.camp;
  var role = String(payload.role || 'member');
  if (!BZ_ROLES[role]) return { success: false, message: 'บทบาทไม่ถูกต้อง' };
  var lid = String(payload.lineUserId || '').trim();
  var name = String(payload.name || '').trim();
  // ตรวจรูปแบบเฉพาะ ID ที่ "กรอกเอง" (ผู้อำนวยการที่ยังไม่เคยเข้าระบบ) — คนที่ระบบรู้จักอยู่แล้วมาจากรายชื่อจริง ไม่ต้องเดา
  if (lid && !_bzNameOfLine(lid) && !/^U[0-9a-f]{32}$/i.test(lid)) return { success: false, message: 'LINE User ID ต้องเป็น U ตามด้วยตัวอักษร 32 ตัว (พิมพ์ id ในแชทกับบอทเพื่อดู)' };
  if (role !== 'member' && !lid) return { success: false, message: role === 'seller' ? 'ผู้ป้อนบิลต้องผูก LINE (เลือกจากรายชื่อพนักงานที่อนุมัติแล้ว)' : 'ผู้อำนวยการต้องมี LINE User ID' };
  if (!name && lid) name = _bzNameOfLine(lid);
  if (!name) return { success: false, message: 'ใส่ชื่อ' };
  var team = null;
  if (role !== 'director') {
    team = _bzTeamOf(payload.teamId);
    if (!team || String(team.campaign_id) !== String(camp.record_id)) return { success: false, message: 'เลือกทีม' };
  }
  if (role === 'seller') {
    var staff = null;
    centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === lid) staff = u; });
    if (!staff || _saNorm(staff.status) !== SA_ST_YES) return { success: false, message: 'คนนี้ยังไม่ได้รับอนุมัติให้ใช้แอปมือถือ — อนุมัติที่เมนู 9.4.1 ก่อน แล้วค่อยตั้งเป็นผู้ป้อนบิล' };
    if (_saExpired(staff.expires_at)) return { success: false, message: 'สิทธิ์ใช้แอปของคนนี้หมดอายุแล้ว — ต่ออายุที่เมนู 9.4.1 ก่อน' };
    if (String(staff.tenant_id) !== String(camp.tenant_id)) return { success: false, message: 'คนนี้สังกัดตัวแทนอื่น — ผู้ป้อนบิลต้องอยู่ตัวแทนเดียวกับแคมเปญ' };
  }

  return _withDocLock(function() {
    _bzEnsureCols();
    var mine = centralObjects(BZ_MEMBERS).filter(function(m) { return String(m.campaign_id) === String(camp.record_id); });
    if (role === 'seller') {
      var old = null;
      mine.forEach(function(m) { if (String(m.team_id) === String(team.record_id) && String(m.role) === 'seller' && String(m.line_user_id) !== lid) old = m; });
      if (old && !payload.replace) return { success: false, needReplace: true, message: 'ทีม ' + team.code + ' มีผู้ป้อนบิลอยู่แล้ว (' + (old.name || old.line_user_id) + ') — ยืนยันเพื่อเปลี่ยนเป็นคนนี้ (คนเดิมจะเป็นสมาชิก · สต็อกทีมไม่ย้ายตามคน)' };
      if (old) { centralUpdate(BZ_MEMBERS, old.record_id, { role: 'member' }); _bzClearMember(String(old.line_user_id || '')); }
    }
    var row = { campaign_id: String(camp.record_id), team_id: team ? String(team.record_id) : '', line_user_id: lid, name: name, role: role };
    var existing = null;
    if (lid) mine.forEach(function(m) { if (String(m.line_user_id) === lid && String(m.role) !== 'director') existing = m; });
    if (role === 'director') { existing = null; mine.forEach(function(m) { if (String(m.line_user_id) === lid && String(m.role) === 'director') existing = m; }); }
    if (existing) centralUpdate(BZ_MEMBERS, existing.record_id, row);
    else { row.record_id = centralNextId(BZ_MEMBERS); row.created_at = nowStr(); centralAppend(BZ_MEMBERS, row); }
    _bzClearMember(lid);
    return { success: true, message: 'บันทึก ' + name + ' เป็น' + BZ_ROLES[role] + (team ? ' ทีม ' + team.code : '') + ' แล้ว' };
  });
}

function removeBlitzMember(session, payload) {
  var err = _requirePermission(session, 'staff', 'edit'); if (err) return err;
  var m = null;
  centralObjects(BZ_MEMBERS).forEach(function(x) { if (String(x.record_id) === String((payload || {}).id)) m = x; });
  if (!m) return { success: false, message: 'ไม่พบรายการนี้' };
  var G = _bzCampaignForSession(session, m.campaign_id); if (G.err) return G.err;
  return _withDocLock(function() {
    deleteRowsWhere(centralSheet(BZ_MEMBERS), 'record_id', m.record_id);
    _bzClearMember(String(m.line_user_id || ''));
    return { success: true, message: 'ถอด ' + (m.name || '') + ' ออกแล้ว' };
  });
}

// ───────────────────────── สต็อกทีม: เบิก / คืน ─────────────────────────
/** หน่วยที่ส่งมา (CT/PK/PC) → หน่วยฐาน · ไม่รู้จักหน่วย = ปฏิเสธ ไม่เดา (เบิกผิดสิบเท่าแก้ทีหลังยาก) */
function _bzBaseQty(productId, qty, unitCode, unitsByProduct) {
  var u = normUnitCode(unitCode, UNIT_PC);
  if (isBaseUnit(u)) return { ok: true, base: qty };
  var list = unitsByProduct[String(productId)] || [];
  for (var i = 0; i < list.length; i++) {
    if (normUnitCode(list[i].unit_code) === u) {
      var f = parseFloat(list[i].unit_factor) || 0;
      if (f > 0) return { ok: true, base: qty * f };
    }
  }
  return { ok: false };
}

/** payload: { teamId, items:[{productId, units:[{unitCode, qty}]}] } (หรือรูปเดิม {productId, qty, unitCode}) — เบิกจากคลังกลางเข้าสต็อกทีม
 *  (ตามหน่วยที่เลือก แปลงเป็นหน่วยฐานให้ · หลายหน่วยของสินค้าเดียวกันรวมเป็นก้อนเดียว) */
function issueBlitzTeamStock(session, payload) {
  var err = _requirePermission(session, 'inventory', 'edit'); if (err) return err;
  payload = payload || {};
  var team = _bzTeamOf(payload.teamId);
  if (!team) return { success: false, message: 'ไม่พบทีมนี้' };
  var G = _bzCampaignForSession(session, team.campaign_id); if (G.err) return G.err;
  var camp = G.camp;
  if (String(camp.status || 'active') !== 'active') return { success: false, message: 'แคมเปญนี้ปิดแล้ว เบิกของเพิ่มไม่ได้' };
  var unitsByProduct = {};
  centralObjects('product_units').forEach(function(u) { (unitsByProduct[String(u.product_id)] = unitsByProduct[String(u.product_id)] || []).push(u); });
  /* ★ หนึ่งสินค้าเบิกได้หลายหน่วยในบรรทัดเดียว (ลัง + เศษแพ็ค + เศษชิ้น) — it.units = [{unitCode, qty}, …]
     · รูปเดิม { productId, qty, unitCode } ยังใช้ได้ (เป็นรายการหน่วยเดียว) · ทุกหน่วยของสินค้าเดียวกันถูก "รวมเป็นหน่วยฐาน"
       ก่อนส่งต่อ เพราะตัวบวกสต็อกทีมอ่านตารางครั้งเดียวแล้ววนบวกทีละรายการ — ส่งสินค้าเดียวกันสองรายการแยกกันจะเขียนทับกันเอง */
  var items = [];
  var byProduct = {};
  var bad = null;
  (payload.items || []).forEach(function(it) {
    if (bad) return;
    var parts = Array.isArray(it.units) ? it.units : [{ unitCode: it.unitCode, qty: it.qty }];
    parts.forEach(function(pt) {
      var q = parseFloat(pt.qty) || 0;
      if (q <= 0 || bad) return;
      var c = _bzBaseQty(it.productId, q, pt.unitCode, unitsByProduct);
      if (!c.ok) { bad = 'ไม่พบหน่วย "' + unitLabelOf(pt.unitCode) + '" ของสินค้า ' + it.productId; return; }
      var pid = String(it.productId);
      if (!byProduct[pid]) { byProduct[pid] = { productId: pid, base: 0 }; items.push(byProduct[pid]); }
      byProduct[pid].base += c.base;
    });
  });
  if (bad) return { success: false, message: bad };
  items = items.map(function(x) { return { productId: x.productId, qty: Math.round(x.base) }; }).filter(function(x) { return x.qty > 0; });
  if (!items.length) return { success: false, message: 'ไม่มีรายการเบิก' };
  return _withDocLock(function() {
    var r = _restockHolder(String(camp.tenant_id), _bzKey(camp.record_id, team.record_id), items,
      'เบิกให้ทีม ' + team.code + ' (BLITZ) โดย ' + (session.displayName || session.username || session.adminUserId), 'blitz_issue');
    if (r.success) _bzDashDrop(camp.record_id);
    return r.success ? { success: true, message: 'เบิกของให้ทีม ' + team.code + ' แล้ว' + (r.skippedWarehouse ? ' (ยังไม่ได้ตัดคลังกลาง — ปิดการเชื่อมสต็อกรถกับคลังกลางอยู่)' : '') } : r;
  });
}

/** payload: { teamId, all?:true, items?:[{productId, units:[{unitCode, qty}]}] } — คืนของที่เหลือเข้าคลังกลาง (ตอนปิดวัน)
 *  รูปเดิม items:[{productId, qty}] (หน่วยฐาน) ยังใช้ได้ · หลายหน่วยของสินค้าเดียวกันรวมเป็นหน่วยฐานก้อนเดียว (แบบเดียวกับตอนเบิก) */
function returnBlitzTeamStock(session, payload) {
  var err = _requirePermission(session, 'inventory', 'edit'); if (err) return err;
  payload = payload || {};
  var team = _bzTeamOf(payload.teamId);
  if (!team) return { success: false, message: 'ไม่พบทีมนี้' };
  var G = _bzCampaignForSession(session, team.campaign_id); if (G.err) return G.err;
  var camp = G.camp, tenantId = String(camp.tenant_id), key = _bzKey(camp.record_id, team.record_id);
  var unitsByProduct = {};
  centralObjects('product_units').forEach(function(u) { (unitsByProduct[String(u.product_id)] = unitsByProduct[String(u.product_id)] || []).push(u); });
  return _withDocLock(function() {
    var have = vanStockCost(tenantId, key);
    var want = {}, bad = null;
    if (payload.all) Object.keys(have).forEach(function(pid) { if (have[pid].qty > 0) want[pid] = have[pid].qty; });
    else (payload.items || []).forEach(function(it) {
      if (bad) return;
      var parts = Array.isArray(it.units) ? it.units : [{ unitCode: UNIT_PC, qty: it.qty }];   // รูปเดิม = หน่วยฐานตรงๆ
      parts.forEach(function(pt) {
        var q = parseFloat(pt.qty) || 0;
        if (q <= 0 || bad) return;
        var c = _bzBaseQty(it.productId, q, pt.unitCode, unitsByProduct);
        if (!c.ok) { bad = 'ไม่พบหน่วย "' + unitLabelOf(pt.unitCode) + '" ของสินค้า ' + it.productId; return; }
        want[String(it.productId)] = (want[String(it.productId)] || 0) + c.base;
      });
    });
    if (bad) return { success: false, message: bad };
    Object.keys(want).forEach(function(pid) { want[pid] = Math.floor(want[pid] + 1e-9); if (want[pid] <= 0) delete want[pid]; });   // ปัดลง เหมือนของเดิม — คืนเกินที่ขอไม่ได้
    var pids = Object.keys(want);
    if (!pids.length) return { success: false, message: 'ไม่มีของให้คืน' };
    for (var i = 0; i < pids.length; i++) {
      var h = (have[pids[i]] || {}).qty || 0;
      if (want[pids[i]] > h) return { success: false, message: 'คืนเกินของที่ทีมถืออยู่ (สินค้า ' + pids[i] + ' มี ' + h + ' คืน ' + want[pids[i]] + ')' };
    }
    var scope = _saleStockScope(tenantId), back = vanIssueOn(scope);
    _cutVanStock(tenantId, key, want, 'RET-' + key, 'blitz_return');
    if (back) {
      var wh = _ensureScopeWarehouse(scope);
      pids.forEach(function(pid) {
        // คืนด้วยต้นทุนที่ทีมพกมา — ไม่ใช่ต้นทุนคลังตอนนี้ ไม่งั้นต้นทุนเฉลี่ยคลังเพี้ยนจากของที่ไม่เคยเปลี่ยนมือจริง
        _applyStockIn(scope, wh, pid, want[pid], (have[pid] || {}).cost || 0, 'van_return', 'VAN_RETURN', 'RET-' + key, 'คืนของจากทีม ' + team.code + ' (BLITZ)', session.adminUserId);
      });
    }
    centralObjects(BZ_MEMBERS).forEach(function(m) { if (String(m.team_id) === String(team.record_id)) _bzClearMember(String(m.line_user_id || '')); });
    _bzDashDrop(camp.record_id);
    return { success: true, message: 'รับของคืนจากทีม ' + team.code + ' แล้ว ' + pids.length + ' รายการ' + (back ? '' : ' (ยังไม่ได้บวกคลังกลาง — ปิดการเชื่อมสต็อกรถกับคลังกลางอยู่)') };
  });
}

// ───────────────────────── แดชบอร์ด ─────────────────────────
function _bzDashDrop(campId) { try { CacheService.getScriptCache().remove('bzdash_' + campId); } catch (e) {} }

function _bzBuildDashboard(camp, fresh) {
  var cache = CacheService.getScriptCache(), ck = 'bzdash_' + camp.record_id;
  if (!fresh) { try { var hit = cache.get(ck); if (hit) { var o = JSON.parse(hit); o.cached = true; return o; } } catch (e) {} }

  var tenantId = String(camp.tenant_id), cid = String(camp.record_id);
  var s = _bzD(camp.start_date), e = _bzD(camp.end_date);
  var teams = centralObjects(BZ_TEAMS).filter(function(t) { return String(t.campaign_id) === cid; })
    .sort(function(a, b) { return String(a.code).localeCompare(String(b.code)); });
  var members = centralObjects(BZ_MEMBERS).filter(function(m) { return String(m.campaign_id) === cid; });

  var T = {};
  teams.forEach(function(t) {
    var mem = members.filter(function(m) { return String(m.team_id) === String(t.record_id); });
    var seller = null; mem.forEach(function(m) { if (String(m.role) === 'seller') seller = m; });
    T[String(t.record_id)] = { id: String(t.record_id), code: String(t.code || ''), name: String(t.name || ''),
      seller: seller ? String(seller.name || '') : '', members: mem.filter(function(m) { return String(m.role) !== 'seller'; }).map(function(m) { return String(m.name || ''); }),
      lineIds: mem.map(function(m) { return String(m.line_user_id || ''); }).filter(Boolean),
      sales: 0, bills: 0, cases: 0, drafts: 0, draftSales: 0, newShops: 0, shopSet: {}, byDay: {},
      targetSales: Number(t.target_sales) || 0, targetShops: Number(t.target_shops) || 0 };
  });

  var orders = tenantObjectsIfExists(tenantId, 'sales_orders').filter(function(o) { return String(o.campaign_id || '') === cid; });
  var okIds = {};
  var hourly = {}, allShops = {};
  orders.forEach(function(o) {
    var t = T[String(o.team_id)];
    if (!t) return;
    var st = String(o.status || '');
    if (st === 'cancelled' || st === 'rejected') return;
    var ex = orderExVat(o);
    if (st === 'draft') { t.drafts++; t.draftSales += ex; return; }
    okIds[String(o.record_id)] = t;
    t.sales += ex; t.bills++;
    var cu = String(o.customer_id || '');
    if (cu && cu !== '0') { t.shopSet[cu] = 1; allShops[cu] = 1; }
    var when = safeDateStr(o.created_at);
    var day = when.substring(0, 10), hr = when.substring(0, 13);
    t.byDay[day] = (t.byDay[day] || 0) + ex;
    if (hr.length === 13) hourly[hr] = (hourly[hr] || 0) + ex;
  });

  if (Object.keys(okIds).length) {
    var ct = {};
    centralObjects('product_units').forEach(function(u) { if (isCaseUnit(u.unit_code)) ct[String(u.product_id)] = parseFloat(u.unit_factor) || 0; });
    tenantObjectsIfExists(tenantId, 'order_items').forEach(function(it) {
      var t = okIds[String(it.order_id)];
      if (!t || isFlagOn(it.is_free) || Number(it.is_free) === 1) return;
      var f = ct[String(it.product_id)];
      if (f > 0) t.cases += (parseFloat(it.base_qty) || 0) / f;
    });
  }

  // ร้านเปิดใหม่ = คำขอเปิดร้านที่ผู้ป้อนบิล/สมาชิกของทีมยื่นในช่วงแคมเปญ — นับตั้งแต่ "วันที่ยื่น" ไม่รอแอดมินอนุมัติ
  // (26 พ.ย. 2026: ร้านใหม่ขายเงินสดได้ทันทีโดยไม่ต้องรอแอดมิน จึงนับทันทีด้วย) · คำขอที่ถูกตีกลับไม่นับ
  var lineToTeam = {};
  Object.keys(T).forEach(function(k) { T[k].lineIds.forEach(function(l) { lineToTeam[l] = T[k]; }); });
  centralObjects('customer_requests').forEach(function(r) {
    if (String(r.status) === CR_REJECTED || String(r.tenant_id) !== tenantId) return;
    var t = lineToTeam[String(r.requested_by || '')];
    var d = _bzD(r.requested_at);
    if (t && (!s || d >= s) && (!e || d <= e)) t.newShops++;
  });

  var list = Object.keys(T).map(function(k) {
    var t = T[k];
    var shops = Object.keys(t.shopSet).length;
    return { id: t.id, code: t.code, name: t.name, seller: t.seller, members: t.members, sales: Math.round(t.sales * 100) / 100,
      bills: t.bills, shops: shops, newShops: t.newShops, cases: Math.round(t.cases * 10) / 10, drafts: t.drafts,
      draftSales: Math.round(t.draftSales * 100) / 100, avgBill: t.bills ? Math.round(t.sales / t.bills * 100) / 100 : 0,
      targetSales: t.targetSales, targetShops: t.targetShops, byDay: t.byDay };
  });
  // ลำดับที่ (เท่ากัน = ลำดับเดียวกัน) · ใช้ทั้งยอดขายและจำนวนร้าน เพราะแข่งสองรางวัล
  var rank = function(key, out) {
    var sorted = list.slice().sort(function(a, b) { return b[key] - a[key]; });
    sorted.forEach(function(t, i) { t[out] = (i > 0 && sorted[i - 1][key] === t[key]) ? sorted[i - 1][out] : i + 1; });
  };
  rank('sales', 'rankSales'); rank('shops', 'rankShops');

  var tot = { sales: 0, bills: 0, cases: 0, newShops: 0, drafts: 0, shops: Object.keys(allShops).length };
  list.forEach(function(t) { tot.sales += t.sales; tot.bills += t.bills; tot.cases += t.cases; tot.newShops += t.newShops; tot.drafts += t.drafts; });
  tot.sales = Math.round(tot.sales * 100) / 100; tot.cases = Math.round(tot.cases * 10) / 10;
  tot.avgBill = tot.bills ? Math.round(tot.sales / tot.bills * 100) / 100 : 0;
  tot.targetSales = list.reduce(function(a, t) { return a + t.targetSales; }, 0);
  tot.targetShops = list.reduce(function(a, t) { return a + t.targetShops; }, 0);

  var out = { success: true, campaign: { id: cid, name: String(camp.name || ''), startDate: s, endDate: e, status: String(camp.status || 'active'), running: _bzActive(camp, _todayStr()) },
    teams: list, totals: tot,
    hourly: Object.keys(hourly).sort().map(function(h) { return { hour: h, sales: Math.round(hourly[h] * 100) / 100 }; }),
    asOf: nowStr(), basis: 'ยอดขายก่อนภาษี · นับบิลที่ยืนยันแล้ว ไม่รวมบิลยกเลิก/ปฏิเสธ (บิลร่างแยกไว้ต่างหาก)' };
  try { cache.put(ck, JSON.stringify(out), 45); } catch (e2) {}
  return out;
}

/** แอดมินดูแดชบอร์ด (หน้า 9.x / พรีวิว) — payload: { campaignId, refresh? } */
function getBlitzDashboardAdmin(session, payload) {
  var err = _requirePermission(session, 'staff', 'view'); if (err) return err;
  payload = payload || {};
  var G = _bzCampaignForSession(session, payload.campaignId); if (G.err) return G.err;
  return _bzBuildDashboard(G.camp, !!payload.refresh);
}

// ───────────────────────── ผู้อำนวยการโครงการ (แอปมือถือ — ตัวตน LINE ที่ยืนยันแล้ว ไม่ต้องเป็นพนักงานที่อนุมัติแล้ว) ─────────────────────────
/** แคมเปญที่ LINE id นี้ดูได้: เป็น director ของแคมเปญนั้น หรือเป็น super_admin ที่ผูก LINE */
function _bzViewerCampaigns(lineUserId) {
  var lid = String(lineUserId || '');
  if (!lid) return [];
  var camps = centralObjects(BZ_CAMPAIGNS);
  if (!camps.length) return [];
  var mine = {}, isSuper = false;
  centralObjects(BZ_MEMBERS).forEach(function(m) { if (String(m.line_user_id) === lid && String(m.role) === 'director') mine[String(m.campaign_id)] = 1; });
  centralObjects('admin_users').forEach(function(u) {
    if (String(u.line_user_id || '') === lid && String(u.status) === ADMIN_STATUS_ACTIVE && String(u.role_code) === 'super_admin') isSuper = true;
  });
  return camps.filter(function(c) { return isSuper || mine[String(c.record_id)]; })
    .sort(function(a, b) { return (Number(b.record_id) || 0) - (Number(a.record_id) || 0); });
}

/** เรียกจาก doPost ข้อ 2.6 หลัง resolveLineIdentity แล้วเท่านั้น */
function getBlitzDashboard(lineUserId, payload) {
  payload = payload || {};
  var camps = _bzViewerCampaigns(lineUserId);
  if (!camps.length) return { success: false, notViewer: true, message: 'บัญชี LINE นี้ไม่ได้เป็นผู้ดูแดชบอร์ด BLITZ RANGER — ให้ผู้ดูแลระบบเพิ่มเป็น "ผู้อำนวยการโครงการ"' };
  var today = _todayStr(), pick = null;
  camps.forEach(function(c) { if (String(c.record_id) === String(payload.campaignId || '')) pick = c; });
  if (!pick) camps.forEach(function(c) { if (!pick && _bzActive(c, today)) pick = c; });
  if (!pick) pick = camps[0];
  var out = _bzBuildDashboard(pick, !!payload.refresh);
  out.campaigns = camps.map(function(c) { return { id: String(c.record_id), name: String(c.name || '') }; });
  return out;
}
var BLITZ_VIEWER_ACTION_MAP = { getBlitzDashboard: 1 };
function _handleBlitzViewerCore(lineUserId, action, payload) {
  try {
    if (action === 'getBlitzDashboard') return getBlitzDashboard(lineUserId, payload || {});
    return { success: false, message: 'ไม่พบ action: ' + action };
  } catch (e) {
    Logger.log('ERROR [' + action + ']: ' + (e.stack || e.message));
    return { success: false, message: 'ระบบผิดพลาด: ' + e.message };
  }
}
