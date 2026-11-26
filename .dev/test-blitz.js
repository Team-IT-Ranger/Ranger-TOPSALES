// รัน: node .dev/test-blitz.js
// แคมเปญ BLITZ RANGER (backend/62_blitz.gs) — ตั้งค่าแคมเปญ/ทีม/สมาชิก · สต็อกทีม · แดชบอร์ด · สิทธิ์ผู้อำนวยการ
// ส่วน "ขายแล้วราคาเงินสด/ตัดสต็อกทีม/ติดตรา" อยู่ใน test-record-sale.js และ test-sales.js (ต้องวิ่งผ่าน recordSale จริง)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

// ── ชีตกลาง/ชีตตัวแทนจำลอง (แถวเป็น object — เพียงพอ เพราะ 62_blitz.gs อ่านผ่าน centralObjects/tenantObjectsIfExists) ──
const C = {};   // ตารางกลาง
const T = {};   // ตารางของตัวแทน T1
const calls = { restock: [], cut: [], stockIn: [], cleared: [] };
function reset() {
  C.blitz_campaigns = []; C.blitz_teams = []; C.blitz_members = [];
  C.admin_users = [{ record_id: 1, username: 'owner', display_name: 'เจ้าของระบบ', role_code: 'super_admin', status: 'active', line_user_id: 'Uowner', tenant_id: '' }];
  C.liff_users = [
    { line_user_id: 'U2', display_name: 'ผู้ป้อนบิล A', tenant_id: 'T1', status: 'Yes', expires_at: '' },
    { line_user_id: 'U4', display_name: 'พนักงานตัวแทนอื่น', tenant_id: 'T2', status: 'Yes', expires_at: '' },
    { line_user_id: 'U5', display_name: 'ยังไม่อนุมัติ', tenant_id: 'T1', status: 'No', expires_at: '' },
    { line_user_id: 'U6', display_name: 'หมดอายุ', tenant_id: 'T1', status: 'Yes', expires_at: '2026-01-01' },
    { line_user_id: 'U7', display_name: 'ผู้ป้อนบิล B', tenant_id: 'T1', status: 'Yes', expires_at: '' }
  ];
  C.tenants = [{ tenant_id: 'T1', name: 'ศูนย์ทดสอบ', is_active: 'TRUE' }];
  C.products = [{ record_id: 101, product_code: '10101', name: 'สินค้า A' }, { record_id: 102, product_code: '10102', name: 'สินค้า B' }];
  C.product_units = [{ product_id: 101, unit_code: 'CT', unit_factor: 12 }, { product_id: 101, unit_code: 'PK', unit_factor: 4 },
                     { product_id: 102, unit_code: 'CT', unit_factor: 6 }];
  C.customer_requests = [];
  T.sales_orders = []; T.order_items = []; T.van_stock = [];
  calls.restock = []; calls.cut = []; calls.stockIn = []; calls.cleared = [];
}
reset();

let session = { adminUserId: '1', tenant_id: '', role_code: 'super_admin', displayName: 'แอดมิน' };
const ctx = {
  console, JSON, String, Number, Object, Array, Date, Math, isNaN, parseInt, parseFloat, RegExp, Boolean,
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'uat' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  getConfig: () => ({ LIFF_ID: '2010417493-TEST' }),
  ADMIN_STATUS_ACTIVE: 'active', OWNER_TENANT_ID: 'TNKI', SA_ST_YES: 'yes', CR_APPROVED: 'approved',
  _saNorm: s => String(s || '').trim().toLowerCase(),
  _saExpired: d => !!d && String(d) < '2026-10-02',
  _todayStr: () => '2026-10-02', nowStr: () => '2026-10-02 10:00:00',
  safeDateStr: v => String(v || ''),
  isNotOff: v => !(v === false || String(v).toUpperCase() === 'FALSE'),
  isFlagOn: v => v === true || String(v).toUpperCase() === 'TRUE',
  _requirePermission: () => null,
  _effectiveTenantId: (s, p) => (s.tenant_id && s.tenant_id !== 'TNKI' ? s.tenant_id : null),
  _isCompanySide: s => !s.tenant_id || s.tenant_id === 'TNKI',
  _activeTenantRow: id => C.tenants.find(t => t.tenant_id === id) || null,
  _withDocLock: fn => fn(),
  centralObjects: n => (C[n] || []).map(r => Object.assign({}, r)),
  centralEnsureColumns: () => {},
  centralNextId: n => (C[n] || []).reduce((m, r) => Math.max(m, Number(r.record_id) || 0), 0) + 1,
  centralAppend: (n, row) => { (C[n] = C[n] || []).push(Object.assign({}, row)); },
  centralAppendMany: (n, rows) => { rows.forEach(r => (C[n] = C[n] || []).push(Object.assign({}, r))); },
  centralUpdate: (n, id, patch) => { const r = C[n].find(x => String(x.record_id) === String(id)); if (r) Object.assign(r, patch); },
  centralSheet: n => ({ __name: n }),
  deleteRowsWhere: (sh, col, val) => { C[sh.__name] = C[sh.__name].filter(r => String(r[col]) !== String(val)); },
  tenantObjectsIfExists: (tid, n) => (T[n] || []).map(r => Object.assign({}, r)),
  cacheClear: (k, id) => calls.cleared.push(id), cacheClearUser: () => {},
  // ค่าที่ 62_blitz.gs อ่านจากบิล: ยอดก่อนภาษีใช้ตัวจริงของระบบไม่ได้ (ต้องโหลด 18/่หลายไฟล์) — เก็บไว้ใน subtotal_ex_vat ตรงๆ
  orderExVat: o => Number(o.subtotal_ex_vat) || 0,
  // สต็อก/คลัง
  _restockHolder: (tid, holder, items, note, type) => { calls.restock.push({ tid, holder, items, note, type }); return { success: true, skippedWarehouse: false }; },
  vanStockCost: (tid, holder) => {
    const o = {};
    (T.van_stock || []).forEach(r => { if (r.line_user_id === holder) o[String(r.product_id)] = { qty: Number(r.qty) || 0, cost: Number(r.avg_cost) || 0 }; });
    return o;
  },
  _cutVanStock: (tid, holder, need, ref, type) => {
    Object.keys(need).forEach(pid => {
      const r = T.van_stock.find(x => x.line_user_id === holder && String(x.product_id) === pid);
      if (r) r.qty = (Number(r.qty) || 0) - need[pid];
      calls.cut.push({ holder, pid, qty: need[pid], type });
    });
  },
  vanIssueOn: () => ctx.__vanIssue, __vanIssue: true,
  _saleStockScope: t => t, _ensureScopeWarehouse: () => 'WH1',
  _applyStockIn: (...a) => calls.stockIn.push(a),
};
vm.createContext(ctx);
vm.runInContext(B('28_units.gs'), ctx, { filename: '28_units.gs' });
vm.runInContext(B('62_blitz.gs'), ctx, { filename: '62_blitz.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '\n   ' + JSON.stringify(info))); if (!cond) failed++; };

console.log('── ตั้งค่าแคมเปญ ──');
let r = ctx.saveBlitzCampaign(session, { tenantId: 'T1', name: 'BLITZ RANGER', startDate: '2026-11-28', endDate: '2026-11-29' });
eq('สร้างแคมเปญสำเร็จ', r.success, true);
eq('★ สร้างทีม A–E ให้เองทั้ง 5 ทีม', C.blitz_teams.map(t => t.code), ['A', 'B', 'C', 'D', 'E']);
eq('ตั้งรหัสแคมเปญ', C.blitz_campaigns[0].code, 'BLITZ-1');
r = ctx.saveBlitzCampaign(session, { tenantId: 'T1', name: 'ซ้อน', startDate: '2026-11-29', endDate: '2026-11-30' });
eq('★ แคมเปญที่เปิดอยู่ซ้อนช่วงวันที่กัน (ตัวแทนเดียวกัน) = ปฏิเสธ', [r.success, /ซ้อนกับแคมเปญ/.test(r.message || '')], [false, true]);
r = ctx.saveBlitzCampaign(session, { tenantId: 'T1', name: 'คนละช่วง', startDate: '2026-12-10', endDate: '2026-12-11' });
eq('ช่วงวันที่ไม่ซ้อน = สร้างได้', r.success, true);
r = ctx.saveBlitzCampaign(session, { tenantId: 'T1', name: 'ผิด', startDate: '2026-12-20', endDate: '2026-12-19' });
eq('วันสิ้นสุดก่อนวันเริ่ม = ปฏิเสธ', r.success, false);
r = ctx.saveBlitzCampaign(session, { tenantId: 'T1', name: '', startDate: '2027-01-01', endDate: '2027-01-02' });
eq('ไม่ใส่ชื่อ = ปฏิเสธ', r.success, false);
r = ctx.saveBlitzCampaign(session, { name: 'ไม่ระบุตัวแทน', startDate: '2027-02-01', endDate: '2027-02-02' });
eq('ฝั่งบริษัทไม่เลือกตัวแทน = ปฏิเสธ', r.success, false);
r = ctx.saveBlitzCampaign({ adminUserId: '9', tenant_id: 'T2' }, { tenantId: 'T1', name: 'ข้ามตัวแทน', startDate: '2027-03-01', endDate: '2027-03-02' });
eq('★ ตัวแทนอื่นตั้งแคมเปญให้ตัวแทนที่ไม่ใช่ของตัวเองไม่ได้ (T2 พยายามตั้งให้ T1)', r.success, false);
r = ctx.saveBlitzCampaign(session, { tenantId: 'T1', id: 2, name: 'ปิดแล้ว', startDate: '2026-12-10', endDate: '2026-12-11', status: 'closed' });
eq('ปิดแคมเปญได้ (แก้สถานะ)', [r.success, C.blitz_campaigns[1].status], [true, 'closed']);
// ใช้แคมเปญ 1 ต่อ — ลบแคมเปญที่ 2 ออกให้เหลือชุดเดียวไว้ตรวจต่อ
C.blitz_campaigns = C.blitz_campaigns.slice(0, 1);

console.log('\n── สมาชิก ──');
const teamA = C.blitz_teams.find(t => t.code === 'A'), teamB = C.blitz_teams.find(t => t.code === 'B');
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, lineUserId: 'U2', role: 'seller' });
eq('ตั้งผู้ป้อนบิลทีม A สำเร็จ (ดึงชื่อจากรายชื่ออัตโนมัติ)', [r.success, C.blitz_members[0].name], [true, 'ผู้ป้อนบิล A']);
eq('  ล้างแคชแอปมือถือของคนนั้นเพื่อให้เห็นป้ายทีมทันที', calls.cleared.indexOf('U2') >= 0, true);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, lineUserId: 'U7', role: 'seller' });
eq('★ ทีมมีผู้ป้อนบิลแล้ว → ต้องยืนยันการเปลี่ยน (needReplace) ไม่ทับเงียบๆ', [r.success, r.needReplace], [false, true]);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, lineUserId: 'U7', role: 'seller', replace: true });
eq('ยืนยันแล้วเปลี่ยนได้ · คนเดิมลงเป็นสมาชิก (ไม่หายจากทีม)',
  [r.success, C.blitz_members.find(m => m.line_user_id === 'U2').role, C.blitz_members.find(m => m.line_user_id === 'U7').role], [true, 'member', 'seller']);
eq('  ผู้ป้อนบิลทีมหนึ่งมีได้คนเดียวเท่านั้น', C.blitz_members.filter(m => m.team_id == teamA.record_id && m.role === 'seller').length, 1);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamB.record_id, lineUserId: 'U2', role: 'member' });
eq('★ คนหนึ่งอยู่ได้ทีมเดียวต่อแคมเปญ — ย้ายทีมโดยบันทึกใหม่ ไม่เกิดแถวซ้ำ',
  [r.success, C.blitz_members.filter(m => m.line_user_id === 'U2').length, C.blitz_members.find(m => m.line_user_id === 'U2').team_id], [true, 1, String(teamB.record_id)]);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, lineUserId: 'U5', role: 'seller' });
eq('ผู้ป้อนบิลที่ยังไม่ได้อนุมัติใช้แอป = ปฏิเสธ (เขาจะเปิดบิลไม่ได้)', [r.success, /ยังไม่ได้รับอนุมัติ/.test(r.message || '')], [false, true]);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, lineUserId: 'U6', role: 'seller' });
eq('ผู้ป้อนบิลที่สิทธิ์หมดอายุ = ปฏิเสธ', [r.success, /หมดอายุ/.test(r.message || '')], [false, true]);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, lineUserId: 'U4', role: 'seller' });
eq('★ ผู้ป้อนบิลสังกัดตัวแทนอื่น = ปฏิเสธ', [r.success, /ตัวแทนอื่น/.test(r.message || '')], [false, true]);
r = ctx.saveBlitzMember(session, { campaignId: 1, teamId: teamA.record_id, name: 'น้องสมศักดิ์ (ไม่มีบัญชี)', role: 'member' });
eq('สมาชิกทีมไม่ต้องมี LINE/บัญชี — ใส่แค่ชื่อได้', [r.success, C.blitz_members.some(m => m.name === 'น้องสมศักดิ์ (ไม่มีบัญชี)' && !m.line_user_id)], [true, true]);
r = ctx.saveBlitzMember(session, { campaignId: 1, role: 'director', lineUserId: 'U' + 'a'.repeat(32), name: 'คุณ Zaleng' });
eq('★ ผู้อำนวยการยังไม่เคยเข้าระบบก็ตั้งได้ (กรอก LINE User ID เอง ไม่ผูกทีม)', [r.success, C.blitz_members.find(m => m.role === 'director').team_id], [true, '']);
r = ctx.saveBlitzMember(session, { campaignId: 1, role: 'director', lineUserId: 'ไม่ใช่ไอดี', name: 'x' });
eq('LINE User ID รูปแบบผิด = ปฏิเสธ', r.success, false);
r = ctx.saveBlitzMember(session, { campaignId: 1, role: 'director', name: 'ไม่มีไอดี' });
eq('ผู้อำนวยการไม่มี LINE id = ปฏิเสธ', r.success, false);
// UID ต้องเป็น U + 32 hex
const DIR = 'U' + 'a'.repeat(32);
r = ctx.saveBlitzMember(session, { campaignId: 1, role: 'director', lineUserId: DIR, name: 'คุณ Zaleng' });
eq('LINE id รูปแบบถูกต้อง (U + 32 ตัว) = ผ่าน', r.success, true);

console.log('\n── สต็อกทีม ──');
r = ctx.issueBlitzTeamStock(session, { teamId: teamA.record_id, items: [{ productId: 101, qty: 2, unitCode: 'CT' }, { productId: 102, qty: 3, unitCode: 'PC' }] });
eq('เบิกให้ทีม สำเร็จ', r.success, true);
eq('★ แปลงหน่วยเป็นหน่วยฐาน: 2 ลัง×12 = 24 · 3 ชิ้น = 3', calls.restock[0].items, [{ productId: '101', qty: 24 }, { productId: '102', qty: 3 }]);
eq('  ผู้ถือสต็อก = รหัสทีม (ไม่ใช่ตัวคน)', [calls.restock[0].holder, calls.restock[0].type], ['TEAM:1:' + teamA.record_id, 'blitz_issue']);
r = ctx.issueBlitzTeamStock(session, { teamId: teamA.record_id, items: [{ productId: 101, qty: 1, unitCode: 'XX' }] });
eq('★ หน่วยที่ไม่รู้จัก = ปฏิเสธ ไม่เดา (เบิกผิดสิบเท่าแก้ทีหลังยาก)', r.success, false);
r = ctx.issueBlitzTeamStock(session, { teamId: teamA.record_id, items: [{ productId: 101, qty: 0 }] });
eq('ไม่มีรายการ = ปฏิเสธ', r.success, false);
r = ctx.issueBlitzTeamStock(session, { teamId: 9999, items: [{ productId: 101, qty: 1, unitCode: 'CT' }] });
eq('ทีมที่ไม่มีอยู่ = ปฏิเสธ', r.success, false);

const KEY = 'TEAM:1:' + teamA.record_id;
T.van_stock = [{ line_user_id: KEY, product_id: '101', qty: 30, avg_cost: 10 }, { line_user_id: KEY, product_id: '102', qty: 4, avg_cost: 5 }];
r = ctx.returnBlitzTeamStock(session, { teamId: teamA.record_id, items: [{ productId: 101, qty: 31 }] });
eq('★ คืนเกินของที่ทีมถืออยู่ = ปฏิเสธ', [r.success, /คืนเกิน/.test(r.message || '')], [false, true]);
r = ctx.returnBlitzTeamStock(session, { teamId: teamA.record_id, items: [{ productId: 101, qty: 10 }] });
eq('คืนบางส่วน: สต็อกทีมลด 30→20', [r.success, T.van_stock[0].qty], [true, 20]);
eq('★ คืนเข้าคลังกลางด้วยต้นทุนที่ทีมพกมา (10) ไม่ใช่ต้นทุนคลังตอนนี้', [calls.stockIn[0][3], calls.stockIn[0][4], calls.stockIn[0][5]], [10, 10, 'van_return']);
r = ctx.returnBlitzTeamStock(session, { teamId: teamA.record_id, all: true });
eq('คืนทั้งหมดตอนปิดวัน: เหลือ 0 ทั้งสองรายการ', [r.success, T.van_stock.map(x => x.qty)], [true, [0, 0]]);
eq('  คืนครบแล้วไม่มีอะไรให้คืนอีก', ctx.returnBlitzTeamStock(session, { teamId: teamA.record_id, all: true }).success, false);
ctx.__vanIssue = false; calls.stockIn = [];
T.van_stock = [{ line_user_id: KEY, product_id: '101', qty: 5, avg_cost: 0 }];
r = ctx.returnBlitzTeamStock(session, { teamId: teamA.record_id, all: true });
eq('★ ปิดการเชื่อมสต็อกรถกับคลังกลางอยู่ → คืนแล้วไม่บวกคลังกลาง (ตอนเบิกก็ไม่เคยตัด) แต่บอกผู้ใช้ชัดเจน',
  [r.success, calls.stockIn.length, /ยังไม่ได้บวกคลังกลาง/.test(r.message || '')], [true, 0, true]);
ctx.__vanIssue = true;

console.log('\n── แดชบอร์ด ──');
// 4 ใบของทีม A + 2 ใบทีม B + ใบยกเลิก/ปฏิเสธ/ร่าง + ใบที่ไม่ใช่แคมเปญ (ต้องไม่นับ)
const tA = String(teamA.record_id), tB = String(teamB.record_id);
const mk = (id, team, cust, st, ex, at) => ({ record_id: id, campaign_id: team ? '1' : '', team_id: team, customer_id: cust, status: st, subtotal_ex_vat: ex, created_at: at });
T.sales_orders = [
  mk(1, tA, 10, 'completed', 1000, '2026-11-28 09:10:00'),
  mk(2, tA, 10, 'completed', 500, '2026-11-28 09:40:00'),     // ร้านเดิมซ้ำ → นับบิลแต่ร้านไม่เพิ่ม
  mk(3, tA, 11, 'accepted', 2000, '2026-11-29 14:00:00'),
  mk(4, tA, 12, 'cancelled', 9999, '2026-11-28 10:00:00'),    // ยกเลิก → ไม่นับ
  mk(5, tA, 13, 'rejected', 8888, '2026-11-28 10:05:00'),     // ปฏิเสธ → ไม่นับ
  mk(6, tA, 14, 'draft', 700, '2026-11-28 10:10:00'),         // ร่าง → แยกต่างหาก ไม่รวมยอด
  mk(7, tB, 20, 'completed', 3500, '2026-11-28 11:00:00'),
  mk(8, tB, 21, 'completed', 500, '2026-11-29 11:00:00'),
  mk(9, '', 30, 'completed', 77777, '2026-11-28 11:00:00')    // ไม่ใช่บิลแคมเปญ → ไม่นับเด็ดขาด
];
T.order_items = [
  { order_id: 1, product_id: 101, base_qty: 24, is_free: 0 },   // 24/12 = 2 ลัง
  { order_id: 2, product_id: 101, base_qty: 6, is_free: 0 },    // 0.5 ลัง
  { order_id: 2, product_id: 101, base_qty: 12, is_free: 1 },   // ของแถม → ไม่นับลัง
  { order_id: 7, product_id: 102, base_qty: 12, is_free: 0 },   // 12/6 = 2 ลัง
  { order_id: 4, product_id: 101, base_qty: 120, is_free: 0 }   // บิลยกเลิก → ไม่นับ
];
C.customer_requests = [
  { tenant_id: 'T1', status: 'approved', requested_by: 'U7', decided_at: '2026-11-28 12:00:00' },   // ทีม A ในช่วงแคมเปญ
  { tenant_id: 'T1', status: 'approved', requested_by: 'U7', decided_at: '2026-11-27 12:00:00' },   // ก่อนแคมเปญ → ไม่นับ
  { tenant_id: 'T1', status: 'pending', requested_by: 'U7', decided_at: '' },                      // ยังไม่อนุมัติ → ไม่นับ
  { tenant_id: 'T1', status: 'approved', requested_by: 'Ucc', decided_at: '2026-11-28 12:00:00' }   // คนนอกทีม → ไม่นับ
];
C.blitz_teams.find(t => t.code === 'A').target_sales = 5000;
C.blitz_teams.find(t => t.code === 'A').target_shops = 4;
const d = ctx.getBlitzDashboardAdmin(session, { campaignId: 1, refresh: true });
const dA = d.teams.find(t => t.code === 'A'), dB = d.teams.find(t => t.code === 'B');
eq('★ ยอดทีม A = 1000+500+2000 (ไม่รวมยกเลิก/ปฏิเสธ/ร่าง/บิลนอกแคมเปญ)', dA.sales, 3500);
eq('จำนวนบิลทีม A (ไม่นับร่าง/ยกเลิก/ปฏิเสธ)', dA.bills, 3);
eq('★ จำนวนร้านทีม A นับร้านไม่ซ้ำ (10 ซื้อสองบิล → 10, 11) = 2', dA.shops, 2);
eq('  ลังทีม A = 2 + 0.5 (ของแถมไม่นับ · บิลยกเลิกไม่นับ)', dA.cases, 2.5);
eq('★ บิลร่างแยกต่างหาก (ไว้ตามให้ยืนยัน) ไม่ปนในยอด', [dA.drafts, dA.draftSales], [1, 700]);
eq('ร้านเปิดใหม่ = คำขอที่อนุมัติแล้วในช่วงแคมเปญ ของคนในทีมเท่านั้น', dA.newShops, 1);
eq('ยอดเฉลี่ยต่อบิล', dA.avgBill, Math.round(3500 / 3 * 100) / 100);
eq('ยอดรายวันของทีม A', dA.byDay, { '2026-11-28': 1500, '2026-11-29': 2000 });
eq('ทีม B: ยอด/ร้าน/ลัง', [dB.sales, dB.shops, dB.cases], [4000, 2, 2]);
eq('★ อันดับแยกสองรางวัล: ยอดขาย B(1) A(2) · จำนวนร้านเสมอกัน (ทั้งคู่ 2 → อันดับ 1)', [dB.rankSales, dA.rankSales, dA.rankShops, dB.rankShops], [1, 2, 1, 1]);
eq('เป้าหมายส่งไปให้หน้าจอเทียบความคืบหน้า', [dA.targetSales, dA.targetShops], [5000, 4]);
eq('ยอดรวมทั้งแคมเปญ (ก่อนภาษี)', [d.totals.sales, d.totals.bills, d.totals.shops, d.totals.drafts], [7500, 5, 4, 1]);
eq('ร้านรวมทั้งแคมเปญไม่ซ้ำข้ามทีม', d.totals.shops, 4);
eq('ยอดรายชั่วโมง เรียงตามเวลา', d.hourly.map(h => h.hour), ['2026-11-28 09', '2026-11-28 11', '2026-11-29 11', '2026-11-29 14']);
ok('บอกฐานการนับให้คนอ่านรู้ว่าเป็นยอดก่อนภาษี', /ก่อนภาษี/.test(d.basis), d.basis);
eq('ทีมที่ไม่มีบิลเลยก็ยังอยู่ในตาราง (ครบ 5 ทีม ยอด 0)', [d.teams.length, d.teams.find(t => t.code === 'E').sales], [5, 0]);

console.log('\n── ผู้อำนวยการดูแดชบอร์ดบนมือถือ ──');
r = ctx.getBlitzDashboard(DIR, {});
eq('★ ผู้อำนวยการ (ยังไม่เคยสมัครเป็นพนักงาน) ดูได้', [r.success, r.campaign.name, r.teams.length], [true, 'BLITZ RANGER', 5]);
r = ctx.getBlitzDashboard('Urandom', {});
eq('★ คนอื่นดูไม่ได้ และได้ notViewer (แอปเงียบ ไม่เด้ง error)', [r.success, r.notViewer], [false, true]);
r = ctx.getBlitzDashboard('U2', {});
eq('ผู้ป้อนบิลของทีมเองก็ยังดูแดชบอร์ดรวมไม่ได้ (ไม่ใช่ผู้อำนวยการ)', r.success, false);
r = ctx.getBlitzDashboard('Uowner', {});
eq('super_admin ที่ผูก LINE ดูได้', r.success, true);
eq('คนว่างไม่เจออะไร', ctx.getBlitzDashboard('', {}).success, false);
eq('บอกให้แอปรู้ว่าเป็นผู้ดูแดชบอร์ด (ไว้โชว์เมนู)', ctx.blitzMobileInfo({ lineUserId: DIR, tenantId: 'T1' }).blitzViewer, true);
eq('ผู้ป้อนบิลได้ป้ายทีม ไม่ใช่ผู้ดู', (() => { const x = ctx.blitzMobileInfo({ lineUserId: 'U7', tenantId: 'T1' }); return [!!x.blitz, x.blitzViewer]; })(), [false, false]);   // แคมเปญ 28-29 พ.ย. ยังไม่เริ่ม (วันนี้ 2 ต.ค.)

console.log('\n── หน้าตั้งค่า (getBlitzAdmin) ──');
T.van_stock = [{ line_user_id: KEY, product_id: '101', qty: 7, avg_cost: 10 }, { line_user_id: 'U2', product_id: '101', qty: 99, avg_cost: 1 }];
const ad = ctx.getBlitzAdmin(session, { tenantId: 'T1' });
eq('เห็นแคมเปญ 5 ทีม และสมาชิก', [ad.success, ad.campaign.name, ad.teams.length, ad.members.length > 0], [true, 'BLITZ RANGER', 5, true]);
eq('★ สต็อกของทีม A แสดงเฉพาะของทีม ไม่ปนสต็อกรถของคน (U2 99 ชิ้น ไม่โผล่)', ad.teams.find(t => t.code === 'A').stock.map(s => [s.productId, s.qty]), [['101', 7]]);
eq('ลิงก์สำหรับผู้อำนวยการ (เปิดหน้าแดชบอร์ดในแอป)', ad.viewerLink, 'https://liff.line.me/2010417493-TEST?go=blitz');
eq('ตัวแทนอื่นเปิดแคมเปญของ T1 ไม่ได้', ctx.getBlitzAdmin({ adminUserId: '9', tenant_id: 'T2' }, { tenantId: 'T1' }).success, false);
r = ctx.removeBlitzMember(session, { id: C.blitz_members[0].record_id });
eq('ถอดสมาชิกได้', r.success, true);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
