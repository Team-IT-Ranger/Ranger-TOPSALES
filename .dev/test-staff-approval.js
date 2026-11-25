// รัน: node .dev/test-staff-approval.js
// อนุมัติผู้ใช้งานแอปมือถือผ่าน LINE (backend/61_staff_approval.gs) — โจทย์ sales blitz ของศูนย์ BDC (25 พ.ย. 2026)
// ★ โหลดไฟล์จริงของ backend ทั้งหมด (02 · 04 · 10 · 14 · 57 · 61) ไม่เขียนตัวเลียนแบบ — เทสต์ที่เขียนตามความเข้าใจของตัวเอง
//   ยืนยันได้แค่ว่าโค้ดทำตามที่เราคิด ไม่ได้ยืนยันว่าสิทธิ์ถูก (บทเรียนจาก CLAUDE.md หัวข้อ "สังกัดเก็บเป็นรหัส")
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

// ── ชีตจำลองเป็นตาราง 2 มิติจริง (โค้ดอ่าน/เขียนด้วย getDataRange/getRange ตามตำแหน่ง) ──
function mkSheet(name, header, rows) {
  const s = { name, data: [header.slice()].concat(rows.map(r => r.slice())) };
  s.getName = () => name;
  s.getDataRange = () => ({ getValues: () => s.data.map(r => r.slice()) });
  s.getLastColumn = () => s.data[0].length;
  s.getLastRow = () => s.data.length;
  s.getMaxRows = () => s.data.length + 50;
  s.getRange = (r, c, nr, nc) => ({
    getValues: () => s.data.slice(r - 1, r - 1 + (nr || 1)).map(row => row.slice(c - 1, c - 1 + (nc || 1))),
    setValues: vals => vals.forEach((vr, ri) => { while (s.data.length < r + ri) s.data.push(new Array(s.data[0].length).fill('')); vr.forEach((v, ci) => { s.data[r - 1 + ri][c - 1 + ci] = v; }); }),
    setValue: v => { s.data[r - 1][c - 1] = v; },
    setNumberFormat: () => {}
  });
  return s;
}
const OLD_HDR = ['line_user_id', 'display_name', 'role', 'tenant_id', 'status', 'last_login'];
const NEW_COLS = ['requested_at', 'expires_at', 'decided_by', 'decided_by_name', 'decided_at', 'decision_note', 'campaign'];
const liff = mkSheet('liff_users', OLD_HDR, []);                 // ★ เริ่มด้วยสคีมาเก่า: คอลัมน์ใหม่ต้องถูกเติมเอง
const addLiff = (o) => {
  const hdr = liff.data[0];
  liff.data.push(hdr.map(h => (o[h] !== undefined ? o[h] : '')));
};
const liffObjs = () => liff.data.slice(1).filter(r => r[0] !== '').map(r => { const o = {}; liff.data[0].forEach((h, i) => { o[h] = r[i]; }); return o; });
const liffRow = uid => liffObjs().find(o => o.line_user_id === uid);

const tables = {
  tenants: [
    { tenant_id: 'TNKI', name: 'ตัวแทนบ้าน', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', is_active: 'TRUE' },
    { tenant_id: 'NKN', name: 'นครนายก', is_active: 'TRUE' },
    { tenant_id: 'CBI', name: 'ชลบุรี', is_active: 'TRUE' },
    { tenant_id: 'OLD', name: 'เลิกใช้แล้ว', is_active: 'FALSE' }
  ],
  company_profile: [{ record_id: 1, name: 'บริษัท ธนัทกร จำกัด' }],
  admin_users: [
    { record_id: 1, username: 'ultra', display_name: 'อุลตร้า', role_code: 'super_admin', tenant_id: '', status: 'active', line_user_id: 'Uultra' },
    { record_id: 2, username: 'bdcadmin', display_name: 'แอดมิน BDC', role_code: 'tenant_admin', tenant_id: 'BDC', status: 'active', line_user_id: 'Ubdcadmin' },
    { record_id: 3, username: 'somchai', display_name: 'สมชาย', role_code: 'owner_admin', tenant_id: '', status: 'active', line_user_id: 'Usom' },
    { record_id: 4, username: 'nknonly', display_name: 'ดูแลนครนายก', role_code: 'owner_admin', tenant_id: '', status: 'active', line_user_id: 'Unknonly' },
    { record_id: 5, username: 'viewer', display_name: 'ดูอย่างเดียว', role_code: 'viewer', tenant_id: '', status: 'active', line_user_id: 'Uview' },
    { record_id: 6, username: 'quit', display_name: 'ลาออกแล้ว', role_code: 'owner_admin', tenant_id: '', status: 'suspended', line_user_id: 'Uquit' },
    { record_id: 7, username: 'nknadmin', display_name: 'แอดมิน NKN', role_code: 'tenant_admin', tenant_id: 'NKN', status: 'active', line_user_id: 'Unknadmin' },
    { record_id: 8, username: 'nolink', display_name: 'ยังไม่ผูก LINE', role_code: 'owner_admin', tenant_id: '', status: 'active', line_user_id: '' }
  ],
  role_permissions: [
    { role_code: 'tenant_admin', module_code: 'staff', can_view: 'TRUE', can_edit: 'TRUE' },
    { role_code: 'owner_admin', module_code: 'staff', can_view: 'TRUE', can_edit: 'TRUE' },
    { role_code: 'viewer', module_code: 'staff', can_view: 'TRUE', can_edit: 'FALSE' }
  ],
  admin_user_tenants: [{ record_id: 1, admin_user_id: '4', tenant_id: 'NKN' }],
  staff_approvers: [],
  staff_approval_log: []
};
const sheets = {};          // ชีตที่เป็นตาราง 2 มิติ (เขียนผ่าน setValues/appendRow)
const props = { LIFF_ID: '2010417493-TEST', LINE_CHANNEL_ACCESS_TOKEN: 'tok', STAFF_APPROVAL_LINE_GROUP_ID: 'Cgroup1' };
const pushes = [];
let clock = 0;
const pad = n => String(n).padStart(2, '0');
const fmt = (d, f) => {
  const t = new Date(d.getTime() + 7 * 3600e3).toISOString();          // เขตเวลาไทย
  return f === 'yyyy-MM-dd' ? t.slice(0, 10) : t.slice(0, 10) + ' ' + t.slice(11, 19);
};

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, parseInt, parseFloat, RegExp, Math, Error,
  Logger: { log: () => {} },
  Utilities: { formatDate: (d, tz, f) => fmt(d, f) },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props[k] === undefined ? null : props[k]) }) },
  UrlFetchApp: { fetch: (url, opts) => { pushes.push({ url, body: JSON.parse(opts.payload) }); return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  centralObjects: n => {
    if (n === 'liff_users') return liffObjs();
    if (sheets[n]) return sheets[n].data.slice(1).map(r => { const o = {}; sheets[n].data[0].forEach((h, i) => { o[h] = r[i]; }); return o; });
    return (tables[n] || []).map(o => Object.assign({}, o));
  },
  centralSheet: n => { if (n === 'liff_users') return liff; if (!sheets[n]) throw new Error('no sheet ' + n); return sheets[n]; },
  centralEnsureColumns: n => { if (n === 'liff_users') NEW_COLS.forEach(c => { if (liff.data[0].indexOf(c) === -1) { liff.data[0].push(c); liff.data.slice(1).forEach(r => r.push('')); } }); },
  centralAppend: (n, o) => { if (n === 'liff_users') return addLiff(o); (tables[n] = tables[n] || []).push(Object.assign({}, o)); },
  centralAppendMany: (n, os) => os.forEach(o => (tables[n] = tables[n] || []).push(Object.assign({}, o))),
  centralNextId: n => (tables[n] || []).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralInvalidate: () => {},
  deleteRowsWhere: (sh, col, v) => { tables[sh.__name] = (tables[sh.__name] || []).filter(r => String(r[col]) !== String(v)); },
  nowStr: () => '2026-11-25 10:' + pad(++clock) + ':00',
  _withDocLock: fn => fn(),
  cacheClearUser: () => {},
  _activeTenantRow: id => tables.tenants.find(t => t.tenant_id === id && t.is_active === 'TRUE')
};
// deleteRowsWhere/centralSheet ของตารางแบบ object-array: ส่ง sheet ปลอมที่จำชื่อไว้
const origCentralSheet = ctx.centralSheet;
ctx.centralSheet = n => (n === 'liff_users' ? liff : (sheets[n] || { __name: n, getName: () => n }));
vm.createContext(ctx);
const fakes = {};
Object.keys(ctx).forEach(k => { if (typeof ctx[k] === 'function' && /^(central|deleteRowsWhere|nowStr|_withDocLock|cacheClearUser|_activeTenantRow)/.test(k)) fakes[k] = ctx[k]; });
['01_config.gs', '02_helpers.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
vm.runInContext('var ADMIN_STATUS_ACTIVE = "active", ADMIN_STATUS_PENDING = "pending", ADMIN_STATUS_REJECTED = "rejected";', ctx);
['04_auth.gs', '10_master_data.gs', '14_permissions.gs', '57_user_tenants.gs', '61_staff_approval.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
// 14_permissions เรียก centralObjects('role_permissions') ผ่านแคช — ใช้ของจริงได้เลย
ctx.APPROVER_ACTION_MAP = { listStaffApprovals: ctx.listStaffApprovals, decideStaffApproval: ctx.decideStaffApproval };

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '\n   got ' + JSON.stringify(extra)));
  if (!cond) failed++;
};
const today = () => ctx._saToday();
const addDays = n => fmt(new Date(Date.now() + n * 86400e3), 'yyyy-MM-dd');
const act = (lid, action, payload) => ctx._handleApproverActionCore(lid, action, payload || {});
const tenantsOf = c => (c ? (c.all ? 'ALL' : Object.keys(c.tenants).sort()) : null);

// ── ข้อมูลตั้งต้น ──
addLiff({ line_user_id: 'Upend1', display_name: 'ทีมชั่วคราว 1', role: 'van_sales', tenant_id: 'BDC', status: 'No', last_login: '' });
addLiff({ line_user_id: 'Upend2', display_name: 'คนนครนายก', role: 'van_sales', tenant_id: 'NKN', status: 'No', last_login: '' });
addLiff({ line_user_id: 'Uyes1', display_name: 'พนักงานเก่า BDC', role: 'credit_sales', tenant_id: 'BDC', status: 'Yes', last_login: '' });
addLiff({ line_user_id: 'Ustaffco', display_name: 'พนักงานขายบริษัท', role: 'van_sales', tenant_id: '', status: 'Yes', last_login: '' });
addLiff({ line_user_id: 'Ustaffexp', display_name: 'พนักงานบริษัทหมดอายุ', role: 'van_sales', tenant_id: '', status: 'Yes', last_login: '' });
console.log('-- สคีมาเก่า (ยังไม่มีคอลัมน์ใหม่): ห้ามพัง --');
eq('checkUser กับชีตที่ยังไม่มี expires_at = ไม่หมดอายุ ไม่ error', [ctx.checkUser('Uyes1').exists, ctx.checkUser('Uyes1').expired], [true, false]);

console.log('\n-- registerUser: เติมคอลัมน์ + ส่งการ์ดเข้ากลุ่ม --');
let r = ctx.registerUser({ lineUid: 'Unew1', name: 'สมศรี ทีมเสริม', schema: 'BDC' });
eq('สมัครสำเร็จและรออนุมัติ', [r.success, r.pending], [true, true]);
ok('★ เติมคอลัมน์ใหม่ให้ชีตเก่าเอง และเก็บเวลาที่ขอ (ไม่งั้นค่าถูกทิ้งเงียบๆ)', NEW_COLS.every(c => liff.data[0].indexOf(c) !== -1) && !!liffRow('Unew1').requested_at, liff.data[0]);
eq('ส่งการ์ดเข้า "กลุ่ม" ที่ตั้งไว้ใน Script Property (ไม่ใช่ DM)', pushes.map(p => p.body.to), ['Cgroup1']);
const card = pushes[0].body.messages[0];
ok('การ์ดเป็น Flex มีชื่อคนสมัครกับสังกัด', card.type === 'flex' && JSON.stringify(card).indexOf('สมศรี ทีมเสริม') !== -1 && JSON.stringify(card).indexOf('บีดีซี ตะวันออก') !== -1, card);
const uri = card.contents.footer.contents[0].action.uri;
ok('ปุ่มเป็นลิงก์ LIFF ของ env นี้ พก go=approvals และ id ผู้สมัคร', uri === 'https://liff.line.me/2010417493-TEST?go=approvals&u=Unew1', uri);
ok('★ ลิงก์ไม่พกอะไรที่เป็นสิทธิ์ (ไม่มี token/รหัสผ่าน) — ความปลอดภัยอยู่ที่ตัวตนคนกด', !/token|pass|secret/i.test(uri), uri);
pushes.length = 0;
delete props.STAFF_APPROVAL_LINE_GROUP_ID;
r = ctx.registerUser({ lineUid: 'Unew2', name: 'ไม่มีกลุ่มตั้งไว้', schema: 'BDC' });
eq('ไม่ตั้งกลุ่ม + ไม่มีรายชื่อเพิ่ม = ไม่ส่งอะไร แต่สมัครสำเร็จ (ไม่ล้ม)', [r.success, pushes.length], [true, 0]);
tables.staff_approvers.push({ record_id: 1, admin_user_id: '', line_user_id: 'Ustaffco', tenant_id: 'BDC' });
tables.staff_approvers.push({ record_id: 2, admin_user_id: '2', line_user_id: '', tenant_id: 'BDC' });
r = ctx.registerUser({ lineUid: 'Unew3', name: 'ไม่มีกลุ่ม แต่มีผู้อนุมัติในรายชื่อ', schema: 'BDC' });
eq('★ ไม่ตั้งกลุ่ม → DM ผู้อนุมัติในรายชื่อเพิ่มของตัวแทนนั้น (ทั้งแบบพนักงานขายและแบบบัญชีแอดมิน)', pushes.map(p => p.body.to).sort(), ['Ubdcadmin', 'Ustaffco']);
pushes.length = 0;
tables.staff_approvers.length = 0;
props.STAFF_APPROVAL_LINE_GROUP_ID = 'Cgroup1, Cgroup2';
ctx.registerUser({ lineUid: 'Unew4', name: 'สองกลุ่ม', schema: 'BDC' });
eq('ตั้งหลายกลุ่มคั่นด้วยจุลภาค → ส่งครบทุกกลุ่ม', pushes.map(p => p.body.to), ['Cgroup1', 'Cgroup2']);
pushes.length = 0;
const tok = props.LINE_CHANNEL_ACCESS_TOKEN; delete props.LINE_CHANNEL_ACCESS_TOKEN;
r = ctx.registerUser({ lineUid: 'Unew5', name: 'ไม่มี token', schema: 'BDC' });
eq('★ ไม่มี LINE_CHANNEL_ACCESS_TOKEN = ไม่ส่ง แต่ไม่ล้มการสมัคร (คนสมัครไปแล้ว ย้อนไม่ได้)', [r.success, pushes.length], [true, 0]);
props.LINE_CHANNEL_ACCESS_TOKEN = tok;
const fetchBackup = ctx.UrlFetchApp.fetch;
ctx.UrlFetchApp.fetch = () => { throw new Error('LINE ล่ม'); };
r = ctx.registerUser({ lineUid: 'Unew6', name: 'LINE ล่ม', schema: 'BDC' });
eq('★ LINE ตอบ error/ล่ม = ไม่ล้มการสมัครเช่นกัน', r.success, true);
ctx.UrlFetchApp.fetch = fetchBackup;
delete props.LIFF_ID; pushes.length = 0;
ctx.registerUser({ lineUid: 'Unew7', name: 'ไม่มี LIFF', schema: 'BDC' });
ok('ไม่ได้ตั้ง LIFF_ID → การ์ดยังออก แต่ไม่มีปุ่ม (ไม่ใช่ลิงก์เสีย)', pushes.length === 2 && !pushes[0].body.messages[0].contents.footer, pushes[0] && pushes[0].body.messages[0].contents.footer);
props.LIFF_ID = '2010417493-TEST'; pushes.length = 0;
eq('สมัครซ้ำ (เน็ตกระตุก) ไม่ได้การ์ดซ้ำ', (ctx.registerUser({ lineUid: 'Unew1', name: 'ซ้ำ', schema: 'BDC' }), pushes.length), 0);
// เก็บกวาด: ผู้สมัครทดสอบด้านบนไม่เกี่ยวกับหมวดอื่น
liff.data = liff.data.filter((row, i) => i === 0 || /^(Upend|Uyes|Ustaff)/.test(row[0]) || row[0] === 'Unew1');

console.log('\n-- ใครอนุมัติได้ (สิทธิ์เดิม + รายชื่อเพิ่ม) --');
const ctxOf = lid => ctx._saApproverCtx(lid);
eq('Ultra Admin = ทุกตัวแทน', tenantsOf(ctxOf('Uultra')), 'ALL');
eq('★ แอดมินที่สังกัดตัวแทน = ตัวแทนของตัวเองรายเดียว', tenantsOf(ctxOf('Ubdcadmin')), ['BDC']);
eq('แอดมินฝั่งบริษัทที่ไม่มีแถวผู้รับผิดชอบ = ทุกรายที่เปิดอยู่ (กติกาเดิมของ 57)', tenantsOf(ctxOf('Usom')), ['BDC', 'CBI', 'NKN', 'TNKI']);
eq('แอดมินฝั่งบริษัทที่ถูกกำหนดผู้รับผิดชอบไว้ = เฉพาะรายนั้น', tenantsOf(ctxOf('Unknonly')), ['NKN']);
eq('★ บทบาทที่ไม่มีสิทธิ์แก้โมดูล staff + ไม่อยู่ในรายชื่อเพิ่ม = ไม่ใช่ผู้อนุมัติ', ctxOf('Uview'), null);
eq('บัญชีที่ถูกระงับ = ไม่ใช่ผู้อนุมัติ', ctxOf('Uquit'), null);
eq('คนที่ไม่รู้จัก = ไม่ใช่ผู้อนุมัติ', ctxOf('Usomeone'), null);
eq('พนักงานขายที่ไม่ได้อยู่ในรายชื่อเพิ่ม = ไม่ใช่ผู้อนุมัติ (อนุมัติแล้วไม่ได้แปลว่าอนุมัติคนอื่นได้)', ctxOf('Uyes1'), null);
tables.staff_approvers.push({ record_id: 10, admin_user_id: '', line_user_id: 'Ustaffco', tenant_id: 'BDC' },
  { record_id: 11, admin_user_id: '', line_user_id: 'Ustaffco', tenant_id: 'NKN' },
  { record_id: 12, admin_user_id: '', line_user_id: 'Ustaffco', tenant_id: 'OLD' });
eq('★ พนักงานขายบริษัทในรายชื่อเพิ่ม อนุมัติได้หลายตัวแทน (ตัวแทนที่ปิดใช้งานแล้วไม่นับ)', tenantsOf(ctxOf('Ustaffco')), ['BDC', 'NKN']);
tables.staff_approvers.push({ record_id: 13, admin_user_id: '5', line_user_id: '', tenant_id: 'CBI' });
eq('แอดมินที่ไม่มีสิทธิ์ staff แต่อยู่ในรายชื่อเพิ่ม = อนุมัติได้เฉพาะรายที่ตั้ง (ไม่ได้สิทธิ์อื่นเพิ่ม)', tenantsOf(ctxOf('Uview')), ['CBI']);
tables.staff_approvers.push({ record_id: 14, admin_user_id: '2', line_user_id: '', tenant_id: 'NKN' });
eq('★ แอดมินที่สังกัดตัวแทน ถูกเพิ่มในรายชื่อให้อนุมัติอีกตัวแทนได้ (รวมกับของเดิม)', tenantsOf(ctxOf('Ubdcadmin')), ['BDC', 'NKN']);
const stfExp = liffRow('Ustaffexp'); liff.data.find(rw => rw[0] === 'Ustaffexp')[liff.data[0].indexOf('expires_at')] = addDays(-1);
tables.staff_approvers.push({ record_id: 15, admin_user_id: '', line_user_id: 'Ustaffexp', tenant_id: 'BDC' });
eq('★ พนักงานในรายชื่อเพิ่มที่สิทธิ์หมดอายุแล้ว = อนุมัติไม่ได้อีก', ctxOf('Ustaffexp'), null);
tables.staff_approvers.length = 0;

console.log('\n-- getApproverContext / ด่านตัวตน --');
let g = act('Usomeone', 'getApproverContext');
eq('คนทั่วไปถามว่าเป็นผู้อนุมัติไหม → isApprover:false ไม่ใช่ error (แอปถามทุกครั้งที่เปิด ต้องเงียบ)', [g.success, g.isApprover], [true, false]);
g = act('Ubdcadmin', 'getApproverContext');
eq('ผู้อนุมัติ BDC: เห็นรายการตัวแทนที่อนุมัติได้ + จำนวนที่รออยู่ของตัวเอง', [g.isApprover, g.tenants.map(t => t.tenantId), g.pendingCount], [true, ['BDC'], 2]);
eq('คนที่ไม่ใช่ผู้อนุมัติเรียก list → ปฏิเสธ มีธง notApprover', (r = act('Uyes1', 'listStaffApprovals', {}), [r.success, r.notApprover]), [false, true]);
eq('คนที่ไม่ใช่ผู้อนุมัติเรียก decide → ปฏิเสธและไม่แก้อะไร', (r = act('Uyes1', 'decideStaffApproval', { lineUserId: 'Upend1', decision: 'approve' }), [r.success, liffRow('Upend1').status]), [false, 'No']);
eq('action ที่ไม่มี → ตอบไม่พบ ไม่ throw', act('Ubdcadmin', 'nope').success, false);

console.log('\n-- รายการรออนุมัติ / ประวัติ --');
// ตั้งข้อมูลประวัติ
liff.data.find(rw => rw[0] === 'Uyes1')[liff.data[0].indexOf('decided_at')] = '2026-11-20 09:00:00';
liff.data.find(rw => rw[0] === 'Uyes1')[liff.data[0].indexOf('decided_by_name')] = 'แอดมิน BDC';
addLiff({ line_user_id: 'Urej1', display_name: 'ถูกปฏิเสธ', role: 'van_sales', tenant_id: 'BDC', status: 'Rejected', decided_at: '2026-11-24 09:00:00', decided_by_name: 'อุลตร้า' });
r = act('Ubdcadmin', 'listStaffApprovals', { view: 'pending' });
eq('★ รออนุมัติของ BDC เห็นเฉพาะ BDC (Upend2 ของนครนายกไม่โผล่)', r.data.map(x => x.lineUserId).sort(), ['Unew1', 'Upend1']);
eq('★ รายการส่ง `me` มาด้วย (หน้าอนุมัติเปิดคำขอเดียว ไม่ต้องถามสิทธิ์แยก): ชื่อ · ตัวแทนที่ดูแล · จำนวนที่รออยู่', [r.me.name, r.me.tenants.map(t => t.tenantId), r.me.pendingCount, r.me.all], ['แอดมิน BDC', ['BDC'], 2, false]);
eq('  Ultra Admin: me.all = true และได้รายการตัวแทนที่เปิดอยู่ทั้งหมดให้เลือกกรอง', (() => { const m = act('Uultra', 'listStaffApprovals', { view: 'pending' }).me; return [m.all, m.tenants.map(t => t.tenantId).sort()]; })(), [true, ['BDC', 'CBI', 'NKN', 'TNKI']]);
eq('  คนที่ไม่ใช่ผู้อนุมัติไม่ได้ me (ไม่รั่วข้อมูลสิทธิ์)', act('Uyes1', 'listStaffApprovals', {}).me, undefined);
eq('  นับยอดแต่ละแท็บมาให้ (ป้ายตัวเลขบนแท็บ)', r.counts, { pending: 2, approved: 1, rejected: 1 });
eq('  ชื่อสังกัดมาเป็นชื่อ ไม่ใช่รหัส', r.data[0].tenantName, 'บีดีซี ตะวันออก');
r = act('Ubdcadmin', 'listStaffApprovals', { view: 'history' });
eq('ประวัติ = ที่ตัดสินแล้วทั้งอนุมัติและไม่อนุมัติ เรียงใหม่สุดก่อน', r.data.map(x => x.lineUserId), ['Urej1', 'Uyes1']);
eq('กรอง "ไม่อนุมัติ" อย่างเดียว', act('Ubdcadmin', 'listStaffApprovals', { view: 'history', filter: 'rejected' }).data.map(x => x.lineUserId), ['Urej1']);
eq('ค้นหาด้วยชื่อ', act('Ubdcadmin', 'listStaffApprovals', { view: 'history', q: 'เก่า' }).data.map(x => x.lineUserId), ['Uyes1']);
r = act('Uultra', 'listStaffApprovals', { view: 'pending' });
eq('Ultra Admin เห็นทุกตัวแทน', r.data.map(x => x.lineUserId).sort(), ['Unew1', 'Upend1', 'Upend2']);
eq('  กรองตามตัวแทนที่เลือก', act('Uultra', 'listStaffApprovals', { view: 'pending', tenantId: 'NKN' }).data.map(x => x.lineUserId), ['Upend2']);
r = act('Ubdcadmin', 'listStaffApprovals', { view: 'pending', uid: 'Uyes1' });
eq('★ เปิดจากลิงก์ในกลุ่ม: คนที่ตัดสินไปแล้วยังได้ focus (หน้าจอจะบอกว่าใครตัดสินไปแล้ว ไม่ใช่หาไม่เจอ)', [r.focus && r.focus.lineUserId, r.focus && r.focus.status], ['Uyes1', 'Yes']);
eq('★ focus ของคนนอกขอบเขตต้องไม่รั่ว (ตัวแทนอื่น)', act('Ubdcadmin', 'listStaffApprovals', { view: 'pending', uid: 'Upend2' }).focus, null);

console.log('\n-- อนุมัติ --');
const exp3 = addDays(3);
r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Upend1', decision: 'approve', expiresAt: exp3, expectStatus: 'No', note: 'ทีม blitz' });
eq('อนุมัติสำเร็จ', [r.success, r.row.status, r.message], [true, 'Yes', 'อนุมัติแล้ว']);
let row = liffRow('Upend1');
eq('★ บทบาทค่าตั้งต้น van_sales (เจ้าของระบบสั่ง) · เขียนสถานะ/วันหมดอายุ/ผู้ตัดสิน/หมายเหตุครบ',
  [row.status, row.role, row.expires_at, row.decided_by, row.decided_by_name, row.decision_note], ['Yes', 'van_sales', exp3, 'Ubdcadmin', 'แอดมิน BDC', 'ทีม blitz']);
eq('ลงประวัติ (log) หนึ่งแถว พร้อมสถานะก่อน/หลัง', (() => { const l = tables.staff_approval_log[tables.staff_approval_log.length - 1]; return [l.from_status, l.to_status, l.by_name, l.channel, l.expires_at]; })(), ['No', 'Yes', 'แอดมิน BDC', 'mobile', exp3]);
const lastPush = pushes[pushes.length - 1];
ok('แจ้งผู้สมัครกลับ (ถ้าเพิ่มเพื่อนกับบอทไว้) พร้อมวันหมดอายุ', lastPush.body.to === 'Upend1' && /ใช้งานได้ถึงวันที่ /.test(lastPush.body.messages[0].text) && lastPush.body.messages[0].text.indexOf(exp3) !== -1, lastPush);
let cu = ctx.checkUser('Upend1');
eq('★ checkUser เห็นว่าอนุมัติแล้วและยังไม่หมดอายุ', [cu.status, cu.expiresAt, cu.expired], ['Yes', exp3, false]);
eq('เลือกบทบาทเครดิตได้ตอนอนุมัติ', (r = act('Uultra', 'decideStaffApproval', { lineUserId: 'Upend2', decision: 'approve', role: 'credit_sales' }), [r.success, liffRow('Upend2').role, liffRow('Upend2').expires_at]), [true, 'credit_sales', '']);

console.log('\n-- กันพลาด --');
eq('★ อนุมัติข้ามตัวแทนไม่ได้ (แอดมิน BDC → คนของนครนายก)', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Upend2', decision: 'reject' }), [r.success, liffRow('Upend2').status]), [false, 'Yes']);
eq('อนุมัติตัวเองไม่ได้', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Ubdcadmin', decision: 'approve' }), r.success), false);
addLiff({ line_user_id: 'Uself', display_name: 'ผู้อนุมัติที่เป็นพนักงานด้วย', role: 'van_sales', tenant_id: 'BDC', status: 'No' });
tables.staff_approvers.push({ record_id: 20, admin_user_id: '', line_user_id: 'Uself', tenant_id: 'BDC' });
// Uself ยังไม่อนุมัติ → ไม่ใช่ผู้อนุมัติ (ต้องเป็นพนักงานที่ใช้งานได้ก่อน) แล้วต้องไม่ใช่ช่องให้อนุมัติตัวเอง
eq('★ คนที่ยังรออนุมัติอยู่ ใส่ชื่อตัวเองในรายชื่อเพิ่มก็อนุมัติตัวเองไม่ได้ (ไม่ใช่ผู้อนุมัติเลย)', (r = act('Uself', 'decideStaffApproval', { lineUserId: 'Uself', decision: 'approve' }), [r.success, liffRow('Uself').status]), [false, 'No']);
tables.staff_approvers.length = 0;
eq('วันหมดอายุย้อนหลัง → ปฏิเสธและไม่แก้สถานะ', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Unew1', decision: 'approve', expiresAt: addDays(-1) }), [r.success, liffRow('Unew1').status]), [false, 'No']);
eq('รูปแบบวันที่ผิด (31 พ.ย. ไม่มีจริง) → ปฏิเสธ', act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Unew1', decision: 'approve', expiresAt: '2026-11-31' }).success, false);
eq('วันหมดอายุเป็นวันนี้ ใช้ได้ (นับรวมทั้งวัน)', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Unew1', decision: 'approve', expiresAt: today() }), r.success), true);
eq('  ★ และวันนี้ยังไม่ถือว่าหมดอายุ', ctx.checkUser('Unew1').expired, false);
eq('บทบาทที่ไม่มีในระบบ → ปฏิเสธ', act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Uself', decision: 'approve', role: 'super_admin' }).success, false);
eq('คำตัดสินแปลกๆ → ปฏิเสธ', act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Uself', decision: 'maybe' }).success, false);
eq('ผู้ใช้ที่ไม่มีจริง → ปฏิเสธ', act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Unobody', decision: 'approve' }).success, false);

console.log('\n-- สองคนกดลิงก์เดียวกันพร้อมกัน (ในกลุ่มมีผู้อนุมัติหลายคน) --');
addLiff({ line_user_id: 'Urace', display_name: 'คนที่สองคนกดพร้อมกัน', role: 'van_sales', tenant_id: 'BDC', status: 'No' });
r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Urace', decision: 'approve', expectStatus: 'No' });
eq('คนแรกอนุมัติได้', r.success, true);
r = act('Uultra', 'decideStaffApproval', { lineUserId: 'Urace', decision: 'reject', expectStatus: 'No' });
eq('★ คนที่สองกดตามหลังโดยเห็นสถานะเก่า (รออนุมัติ) → ปฏิเสธ ไม่เขียนทับเงียบๆ', [r.success, r.conflict, liffRow('Urace').status], [false, true, 'Yes']);
ok('  ข้อความบอกว่าใครตัดสินไปแล้ว', /อนุมัติไปแล้ว โดย แอดมิน BDC/.test(r.message), r.message);
eq('  ถ้าคนที่สองตั้งใจแก้จริง (เห็นสถานะ Yes แล้ว) ทำได้', (r = act('Uultra', 'decideStaffApproval', { lineUserId: 'Urace', decision: 'reject', expectStatus: 'Yes' }), [r.success, liffRow('Urace').status]), [true, 'Rejected']);

console.log('\n-- แก้คำตัดสินจากหน้าประวัติ --');
eq('ไม่อนุมัติ → เปลี่ยนเป็นอนุมัติได้', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Urej1', decision: 'approve', role: 'credit_sales', expiresAt: addDays(7), expectStatus: 'Rejected' }), [r.success, liffRow('Urej1').status, liffRow('Urej1').role]), [true, 'Yes', 'credit_sales']);
let lg = tables.staff_approval_log[tables.staff_approval_log.length - 1];
eq('  ประวัติเก็บว่าเปลี่ยนจาก Rejected เป็น Yes (ไม่ทับของเดิม)', [lg.from_status, lg.to_status, tables.staff_approval_log.filter(l => l.line_user_id === 'Urej1').length], ['Rejected', 'Yes', 1]);
eq('อนุมัติแล้ว → แก้วันหมดอายุ/บทบาทได้ (ข้อความบอกว่าแก้ไข)', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Urej1', decision: 'approve', role: 'van_sales', expiresAt: addDays(10), expectStatus: 'Yes' }), [r.success, r.message, liffRow('Urej1').role]), [true, 'บันทึกการแก้ไขแล้ว', 'van_sales']);
eq('อนุมัติแล้ว → เปลี่ยนเป็นไม่อนุมัติได้ และล้างวันหมดอายุ', (r = act('Ubdcadmin', 'decideStaffApproval', { lineUserId: 'Urej1', decision: 'reject', note: 'เลิกจ้าง', expectStatus: 'Yes' }), [r.success, liffRow('Urej1').status, liffRow('Urej1').expires_at, liffRow('Urej1').decision_note]), [true, 'Rejected', '', 'เลิกจ้าง']);
ok('  แจ้งผู้สมัครว่าไม่ได้รับอนุมัติ', /ไม่ได้รับอนุมัติ/.test(pushes[pushes.length - 1].body.messages[0].text), pushes[pushes.length - 1]);

console.log('\n-- หมดอายุเอง --');
const ecol = liff.data[0].indexOf('expires_at');
liff.data.find(rw => rw[0] === 'Uyes1')[ecol] = addDays(-1);
cu = ctx.checkUser('Uyes1');
eq('★ เมื่อเลยวันหมดอายุ: status ยังเป็น Yes แต่ expired = true', [cu.status, cu.expired, cu.expiresAt], ['Yes', true, addDays(-1)]);
liff.data.find(rw => rw[0] === 'Uyes1')[ecol] = fmt(new Date(Date.UTC(2099, 0, 1)), 'yyyy-MM-dd');
eq('วันหมดอายุในอนาคต = ใช้ได้', ctx.checkUser('Uyes1').expired, false);
liff.data.find(rw => rw[0] === 'Uyes1')[ecol] = new Date(Date.now() - 2 * 86400e3);
eq('★ Sheets แปลงข้อความวันที่เป็น Date เองได้ — ก็ยังอ่านถูก (ไม่พังตามเขตเวลา)', ctx.checkUser('Uyes1').expired, true);
liff.data.find(rw => rw[0] === 'Uyes1')[ecol] = '';
eq('ว่าง = ไม่หมดอายุ', ctx.checkUser('Uyes1').expired, false);
const routerSrc = B('05_router.gs');
ok('★ ด่านมือถือ (_handleMobileActionCore) ตรวจ expired จริง — ไม่งั้นทีมชั่วคราวใช้ได้ตลอดไปแม้เลยวัน',
  /userStatus\.expired/.test(routerSrc) && routerSrc.indexOf('userStatus.expired') > routerSrc.indexOf("userStatus.status !== 'Yes'"), 'no check');

console.log('\n-- ทางแอปแอดมินเดิม (updateStaffAdmin) ต้องลงประวัติเหมือนกัน --');
const ADMIN_SESS = { adminUserId: '2', displayName: 'แอดมิน BDC', role_code: 'tenant_admin', tenant_id: 'BDC' };
addLiff({ line_user_id: 'Uweb1', display_name: 'อนุมัติทางเว็บ', role: 'van_sales', tenant_id: 'BDC', status: 'No' });
const logBefore = tables.staff_approval_log.length;
r = ctx.updateStaffAdmin(ADMIN_SESS, { lineUserId: 'Uweb1', status: 'Yes', role: 'credit_sales', expiresAt: addDays(5) });
eq('อนุมัติทางหน้าเว็บ + ตั้งวันหมดอายุได้', [r.success, liffRow('Uweb1').status, liffRow('Uweb1').role, liffRow('Uweb1').expires_at], [true, 'Yes', 'credit_sales', addDays(5)]);
eq('  ประทับผู้ตัดสิน + ลงประวัติ channel=admin (แท็บประวัติในมือถือเห็นด้วย)', [liffRow('Uweb1').decided_by_name, tables.staff_approval_log.length - logBefore, tables.staff_approval_log[tables.staff_approval_log.length - 1].channel], ['แอดมิน BDC', 1, 'admin']);
eq('★ วันหมดอายุผิด → ปฏิเสธก่อนเขียนอะไร สถานะต้องไม่ขยับ', (r = ctx.updateStaffAdmin(ADMIN_SESS, { lineUserId: 'Uweb1', status: 'No', expiresAt: '2020-01-01' }), [r.success, liffRow('Uweb1').status]), [false, 'Yes']);
eq('ไม่ส่ง expiresAt = ไม่แตะวันหมดอายุเดิม', (ctx.updateStaffAdmin(ADMIN_SESS, { lineUserId: 'Uweb1', role: 'van_sales' }), liffRow('Uweb1').expires_at), addDays(5));
r = ctx.listStaffAdmin(ADMIN_SESS, {});
const w = r.data.find(x => x.lineUserId === 'Uweb1');
eq('listStaffAdmin ส่ง expiresAt/ผู้ตัดสินมาให้หน้าเว็บ', [w.expiresAt, w.expired, w.decidedBy], [addDays(5), false, 'แอดมิน BDC']);

console.log('\n-- ตั้งรายชื่อผู้อนุมัติเพิ่ม (ฝั่งบริษัทเท่านั้น) --');
const COMPANY = { adminUserId: '3', displayName: 'สมชาย', role_code: 'owner_admin', tenant_id: '' };
const ULTRA = { adminUserId: '1', displayName: 'อุลตร้า', role_code: 'super_admin', tenant_id: '' };
eq('แอดมินตัวแทนตั้งผู้อนุมัติไม่ได้', ctx.saveStaffApprover(ADMIN_SESS, { lineUserId: 'Ustaffco', tenantIds: ['BDC'] }).success, false);
eq('แอดมินตัวแทนดูรายชื่อไม่ได้', ctx.listStaffApprovers(ADMIN_SESS, {}).success, false);
let lst = ctx.listStaffApprovers(COMPANY, {});
ok('รายชื่อให้เลือก: แอดมินฝั่งบริษัทที่ผูก LINE แล้ว + พนักงานขายบริษัท · ไม่มีคนที่ไม่ได้ผูก LINE/สังกัดตัวแทน/ระงับ',
  JSON.stringify(lst.people.map(p => p.name).sort()) === JSON.stringify(['พนักงานขายบริษัท', 'ดูแลนครนายก', 'ดูอย่างเดียว', 'สมชาย', 'อุลตร้า'].sort()), lst.people.map(p => p.name));
eq('  ไม่มีตัวแทนที่ปิดใช้งานในรายการติ๊ก', lst.tenants.some(t => t.tenantId === 'OLD'), false);
eq('ตั้งพนักงานขายบริษัทเป็นผู้อนุมัติ 2 ตัวแทน', (r = ctx.saveStaffApprover(COMPANY, { lineUserId: 'Ustaffco', tenantIds: ['BDC', 'NKN', 'BDC'] }), [r.success, r.tenantIds]), [true, ['BDC', 'NKN']]);
eq('  มีผลกับสิทธิ์จริง (ctx ของเขา)', tenantsOf(ctxOf('Ustaffco')), ['BDC', 'NKN']);
eq('★ เขียนทับทั้งชุด: ตั้งใหม่เหลือรายเดียว ของเก่าหายไป', (ctx.saveStaffApprover(COMPANY, { lineUserId: 'Ustaffco', tenantIds: ['CBI'] }), tenantsOf(ctxOf('Ustaffco'))), ['CBI']);
eq('ส่งรายการว่าง = ถอนสิทธิ์ที่ตั้งเพิ่ม (พนักงานขายธรรมดาไม่ใช่ผู้อนุมัติอีก)', (ctx.saveStaffApprover(COMPANY, { lineUserId: 'Ustaffco', tenantIds: [] }), ctxOf('Ustaffco')), null);
eq('ตัวแทนที่ไม่มี/ปิดใช้งาน → ปฏิเสธทั้งชุด', ctx.saveStaffApprover(COMPANY, { lineUserId: 'Ustaffco', tenantIds: ['BDC', 'OLD'] }).success, false);
eq('★ คนที่มีบัญชีแอดมินอยู่แล้วตั้งผ่านพนักงานขายไม่ได้ (ไม่ให้มีสองชุดขัดกัน)', ctx.saveStaffApprover(COMPANY, { lineUserId: 'Usom', tenantIds: ['BDC'] }).success, false);
eq('ตั้งผ่านบัญชีแอดมินได้', (r = ctx.saveStaffApprover(COMPANY, { adminUserId: '5', tenantIds: ['BDC'] }), [r.success, tenantsOf(ctxOf('Uview'))]), [true, ['BDC']]);
eq('บัญชีที่ยังไม่ผูก LINE ตั้งไม่ได้ (อนุมัติผ่านแอปมือถือไม่ได้อยู่แล้ว)', ctx.saveStaffApprover(COMPANY, { adminUserId: '8', tenantIds: ['BDC'] }).success, false);
eq('บัญชีที่สังกัดตัวแทนตั้งผ่านรายชื่อเพิ่มไม่ได้ (ใช้สิทธิ์เดิมของเขา)', ctx.saveStaffApprover(COMPANY, { adminUserId: '2', tenantIds: ['NKN'] }).success, false);
eq('พนักงานที่ยังไม่อนุมัติ ตั้งไม่ได้', ctx.saveStaffApprover(COMPANY, { lineUserId: 'Upend2', tenantIds: ['BDC'] }).success, false);
eq('ระบุสองคีย์พร้อมกัน → ปฏิเสธ', ctx.saveStaffApprover(COMPANY, { adminUserId: '5', lineUserId: 'Ustaffco', tenantIds: ['BDC'] }).success, false);
eq('Ultra Admin ตั้งได้', ctx.saveStaffApprover(ULTRA, { adminUserId: '5', tenantIds: ['CBI'] }).success, true);
lst = ctx.listStaffApprovers(COMPANY, {});
eq('  รายการที่ตั้งไว้โชว์ในหน้าจอ', lst.people.find(p => p.name === 'ดูอย่างเดียว').tenantIds, ['CBI']);

console.log('\n-- ลิงก์/QR ของทีม Sales Blitz --');
pushes.length = 0;
props.STAFF_APPROVAL_LINE_GROUP_ID = 'Cgroup1';
ctx.registerUser({ lineUid: 'Ublitz1', name: 'ทีม blitz คนที่ 1', schema: 'BDC', campaign: 'blitz' });
eq('สมัครผ่านลิงก์ blitz (พิมพ์เล็กก็ได้) → เก็บป้าย BLITZ', liffRow('Ublitz1').campaign, 'BLITZ');
const bc = pushes[pushes.length - 1].body.messages[0];
ok('★ การ์ดเข้ากลุ่มระบุชัดว่าเป็นทีม Sales Blitz (หัวการ์ด + สี + altText ต่างจากคำขอปกติ)',
  /ทีม Sales Blitz/.test(JSON.stringify(bc.contents.header)) && bc.contents.header.backgroundColor === '#6D4AFF' && /Sales Blitz/.test(bc.altText), bc);
ctx.registerUser({ lineUid: 'Ublitz2', name: 'ใส่แคมเปญมั่ว', schema: 'BDC', campaign: '<script>' });
eq('★ แคมเปญที่ไม่รู้จักถูกทิ้งเป็นว่าง (ลิงก์เป็นของสาธารณะ ใครแก้ URL ก็ได้)', liffRow('Ublitz2').campaign, '');
const normalCard = pushes[pushes.length - 1].body.messages[0];
ok('  และการ์ดของคนสมัครปกติไม่มีป้าย blitz', !/Blitz/.test(JSON.stringify(normalCard)) && normalCard.contents.header.backgroundColor === '#B4741A', normalCard);
r = act('Ubdcadmin', 'listStaffApprovals', { view: 'pending' });
const bl = r.data.find(x => x.lineUserId === 'Ublitz1');
eq('หน้าอนุมัติเห็นป้าย (แยกจากคนสมัครปกติได้)', [bl.campaign, bl.campaignLabel, r.data.find(x => x.lineUserId === 'Ublitz2').campaign], ['BLITZ', 'Sales Blitz', '']);
eq('listStaffAdmin (หน้าเว็บ) ก็ส่งป้ายมา', ctx.listStaffAdmin(ADMIN_SESS, {}).data.find(x => x.lineUserId === 'Ublitz1').campaign, 'BLITZ');

let lk = ctx.getBlitzRegisterLink(ADMIN_SESS, {});
eq('แอดมินตัวแทน: ได้ลิงก์ของตัวแทนตัวเอง พก c=BLITZ และ t=รหัสตัวแทน',
  [lk.success, lk.url, lk.tenantName, lk.campaignLabel], [true, 'https://liff.line.me/2010417493-TEST?go=register&c=BLITZ&t=BDC', 'บีดีซี ตะวันออก', 'Sales Blitz']);
eq('★ แอดมินตัวแทนขอลิงก์ของตัวแทนอื่นไม่ได้ (ส่ง tenantId มาก็ไม่ช่วย)', ctx.getBlitzRegisterLink(ADMIN_SESS, { tenantId: 'NKN' }).tenantId, 'BDC');
eq('ฝั่งบริษัทไม่เลือกตัวแทน → ขอให้เลือก', (lk = ctx.getBlitzRegisterLink(COMPANY, {}), [lk.success, /เลือกตัวแทน/.test(lk.message)]), [false, true]);
eq('ฝั่งบริษัทเลือกตัวแทนได้', ctx.getBlitzRegisterLink(COMPANY, { tenantId: 'NKN' }).url, 'https://liff.line.me/2010417493-TEST?go=register&c=BLITZ&t=NKN');
eq('ตัวแทนที่ปิดใช้งาน/ไม่มี → ปฏิเสธ', [ctx.getBlitzRegisterLink(COMPANY, { tenantId: 'OLD' }).success, ctx.getBlitzRegisterLink(COMPANY, { tenantId: 'XXX' }).success], [false, false]);
eq('บทบาทที่ไม่มีสิทธิ์แก้พนักงานขาย → ขอลิงก์ไม่ได้', ctx.getBlitzRegisterLink({ adminUserId: '5', role_code: 'viewer', tenant_id: '' }, { tenantId: 'BDC' }).success, false);
delete props.LIFF_ID;
eq('ไม่ได้ตั้ง LIFF_ID → บอกตรงๆ ไม่คืนลิงก์เสีย', (lk = ctx.getBlitzRegisterLink(COMPANY, { tenantId: 'BDC' }), [lk.success, /LIFF_ID/.test(lk.message)]), [false, true]);
props.LIFF_ID = '2010417493-TEST';
props.ENV_NAME = 'uat';
eq('บอก env กลับไปให้หน้าจอเตือน (ลิงก์ UAT ห้ามปริ้นท์แจกหน้างาน)', ctx.getBlitzRegisterLink(COMPANY, { tenantId: 'BDC' }).env, 'uat');

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
