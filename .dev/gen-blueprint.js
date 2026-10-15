/**
 * สร้าง "รายการประกอบแบบ" ของชุดแบบ (docs/blueprint/06-schedules.generated.md) จากโค้ดจริง
 * รัน: node .dev/gen-blueprint.js        (เขียนไฟล์)
 *      node .dev/gen-blueprint.js --check (ไม่เขียน แค่บอกว่าแบบตรงกับโค้ดหรือยัง — ใช้ก่อน commit)
 *
 * ★★ ทำไมต้อง generate: แบบที่พิมพ์มือจะเก่าภายในสองสัปดาห์ แล้วมันจะโกหก ซึ่งแย่กว่าไม่มีแบบ
 *   เพราะคนทำงานตามแบบ (เคยเกิดกับ docs/topshop_architecture.html และ who-is-doing-what.md)
 *   → ส่วนที่เป็น "รายการ" (action / ตาราง / สิทธิ์ / เอกสาร / เมนู) อ่านจากโค้ดทุกครั้ง
 *     ส่วนที่เป็น "เหตุผลและสัญญา" เขียนมือในแผ่น 01-05 เพราะสร้างจากโค้ดไม่ได้
 *
 * ★ ตัวนี้อ่านอย่างเดียว ไม่ยิงเน็ต ไม่แตะ backend รันได้ทุกเครื่อง ทุกเวลา
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'blueprint', '06-schedules.generated.md');
const CHECK = process.argv.includes('--check');
const warn = [];

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const lines = s => s.split(/\r?\n/).length;

/* ── ดึง object/array literal ออกมาจากไฟล์แล้ว eval ──
   ของที่ดึงเป็น "ข้อมูลล้วน" ทุกตัว (ไม่มีการเรียกฟังก์ชัน) จึง eval ได้ปลอดภัยพอสำหรับเครื่องมือภายใน
   ★ ต้องจับคู่วงเล็บเอง ไม่ใช่ regex — literal พวกนี้มีวงเล็บซ้อนหลายชั้นและมีคอมเมนต์ไทยปน */
function literal(src, decl, where, raw) {
  const i = src.indexOf(decl);
  if (i === -1) { warn.push('หาไม่เจอ: ' + decl + ' ใน ' + where); return null; }
  let j = i + decl.length;
  while (j < src.length && src[j] !== '{' && src[j] !== '[') j++;
  const openCh = src[j], closeCh = openCh === '{' ? '}' : ']';
  let depth = 0, k = j, inS = null, inLine = false, inBlock = false;
  for (; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
    if (inS) { if (c === '\\') { k++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inLine = true; k++; continue; }
    if (c === '/' && n === '*') { inBlock = true; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) { depth--; if (!depth) break; }
  }
  if (depth) { warn.push('วงเล็บไม่ครบ: ' + decl + ' ใน ' + where); return null; }
  const body = src.slice(j, k + 1);
  if (raw) return body;
  try { return eval('(' + body + ')'); }
  catch (e) { warn.push('eval ไม่ผ่าน: ' + decl + ' ใน ' + where + ' — ' + e.message); return null; }
}

/* ★ ACTION_MAP แมปชื่อ → **ตัวฟังก์ชัน** จึง eval ไม่ได้ (ฟังก์ชันอยู่ในไฟล์อื่น)
   เอาแค่ "ชื่อคีย์" ซึ่งคือชื่อ action ที่หน้าเว็บส่งมาจริง — ตัดคอมเมนต์ออกก่อนไม่ให้ชื่อในคอมเมนต์ปน */
function keysOf(src, decl, where) {
  const body = literal(src, decl, where, true);
  if (!body) return [];
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const names = [];
  const re = /(^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(clean))) names.push(m[2]);
  return [...new Set(names)];
}

/* ── ชื่อ action → ไฟล์ที่นิยามฟังก์ชัน + โมดูลสิทธิ์ที่มันตรวจ ──
   โมดูลสิทธิ์อ่านจาก `_requirePermission(session, 'โมดูล', 'view'|'edit')` ในตัวฟังก์ชันเอง
   ★ อ่านจากของจริง ไม่ใช่ตารางที่พิมพ์มือ — action ที่ลืมใส่การตรวจสิทธิ์จะโผล่เป็น "—" ให้เห็น */
const BE = fs.readdirSync(path.join(ROOT, 'backend')).filter(f => f.endsWith('.gs')).sort();
const fnIndex = {};                                      // ชื่อฟังก์ชัน → { file, perms:[[mod,act]] }
for (const f of BE) {
  const src = read('backend/' + f);
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  const hits = [];
  let m;
  while ((m = re.exec(src))) hits.push({ name: m[1], at: m.index });
  hits.forEach((h, i) => {
    const body = src.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : src.length);
    const perms = [];
    const pre = /_requirePermission\(\s*session\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
    let p;
    while ((p = pre.exec(body))) perms.push([p[1], p[2]]);
    const superOnly = /_requireSuperAdmin|role\s*===\s*'super_admin'/.test(body);
    fnIndex[h.name] = { file: f, perms, superOnly, lines: lines(body) };
  });
}

const routerSrc = read('backend/05_router.gs');
const authSrc = read('backend/04_auth.gs');
const MOBILE = keysOf(routerSrc, 'var ACTION_MAP =', '05_router.gs');
const ADMIN = keysOf(routerSrc, 'var ADMIN_ACTION_MAP =', '05_router.gs');
/* action ที่เรียกได้โดยไม่มี token เลย — ★ ลิสต์นี้คือพื้นผิวที่คนนอกยิงถึง ต้องอ่านง่ายที่สุดในแบบ */
const publicNames = (() => {
  const m = authSrc.match(/PUBLIC_ACTIONS?\s*=\s*(\[[^\]]*\]|\{[^}]*\})/);
  if (m) { try { return Object.keys(eval('(' + m[1] + ')')).length ? Object.keys(eval('(' + m[1] + ')')) : eval('(' + m[1] + ')'); } catch (e) { /* ลงท้ายด้วยการสแกนแบบล่าง */ } }
  const set = new Set();
  [routerSrc, authSrc].forEach(s => {
    const re = /action\s*===\s*'([A-Za-z][\w]*)'/g;
    let x; while ((x = re.exec(s))) set.add(x[1]);
  });
  return [...set];
})();

const idemBe = literal(read('backend/35_idempotency.gs'), 'var IDEMPOTENT_ACTIONS =', '35_idempotency.gs')
  || literal(routerSrc, 'var IDEMPOTENT_ACTIONS =', '05_router.gs') || {};
const feSrc = read('frontend-admin/index.html');
const setOf = decl => {
  const i = feSrc.indexOf(decl);
  if (i === -1) { warn.push('หาไม่เจอ: ' + decl + ' ใน index.html'); return new Set(); }
  const a = feSrc.indexOf('[', i), b = feSrc.indexOf(']', a);
  try { return new Set(eval('(' + feSrc.slice(a, b + 1) + ')')); }
  catch (e) { warn.push('eval ไม่ผ่าน: ' + decl); return new Set(); }
};
const MUT = setOf('const MUTATING_ACTIONS = new Set(');
const IDEM_FE = setOf('const IDEMPOTENT_ACTIONS = new Set(');

const setupSrc = read('backend/00_setup_sheets.gs');
const CENTRAL = literal(setupSrc, 'var CENTRAL_SHEETS =', '00_setup_sheets.gs') || {};
const OWNER_MODULES = literal(setupSrc, 'var OWNER_MODULES =', '00_setup_sheets.gs') || [];
const TENANT_MODULES = literal(setupSrc, 'var TENANT_MODULES =', '00_setup_sheets.gs') || [];
const TENANT_VIEW_ONLY = literal(setupSrc, 'var TENANT_VIEW_ONLY_MODULES =', '00_setup_sheets.gs') || [];
const TENANT_TABS = literal(read('backend/13_tenants.gs'), 'var TENANT_SHEET_TABS =', '13_tenants.gs') || {};
const CACHED = literal(read('backend/02_helpers.gs'), 'var SHEET_CACHE_TABLES =', '02_helpers.gs') || {};
const DOC_TYPES = literal(read('backend/12_docnum.gs'), 'var DOC_SERIES_TYPES =', '12_docnum.gs') || [];
const GL = literal(read('backend/23_accounting.gs'), 'var GL_ACCT =', '23_accounting.gs') || {};
const NAV = literal(feSrc, 'const NAV_GROUPS =', 'index.html') || [];

/* ── ประกอบเอกสาร ── */
const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|');
const out = [];
const H = (n, t) => out.push('', '#'.repeat(n) + ' ' + t, '');
const P = t => out.push(t, '');
const TBL = (head, rows) => {
  out.push('| ' + head.join(' | ') + ' |');
  out.push('|' + head.map(() => '---').join('|') + '|');
  rows.forEach(r => out.push('| ' + r.map(esc).join(' | ') + ' |'));
  out.push('');
};

const stamp = new Date().toISOString().slice(0, 10);
out.push('<!-- ★ ไฟล์นี้ถูกสร้างด้วย `node .dev/gen-blueprint.js` ห้ามแก้ด้วยมือ — แก้แล้วจะถูกทับ',
  '     เพิ่ม action / ตาราง / โมดูล / เอกสารใหม่แล้ว รันตัวนี้ซ้ำ แบบจะตามเอง -->',
  '# แผ่น 06 — รายการประกอบแบบ (สร้างจากโค้ด)', '',
  '> สร้างเมื่อ ' + stamp + ' จากโค้ดใน repo นี้ · `node .dev/gen-blueprint.js` เพื่อสร้างใหม่',
  '> · `node .dev/gen-blueprint.js --check` เพื่อเช็คว่าแบบยังตรงกับโค้ดอยู่',
  '',
  'แผ่นนี้ตอบคำถาม **"มีอะไรอยู่บ้าง"** · ส่วน **"ทำไมและห้ามแตะอะไร"** อยู่ในแผ่น',
  '[01](01-site-plan.md)–[05](05-contracts.md) ซึ่งเขียนมือ', '');

/* ── A. สรุปขนาดงาน ── */
H(2, 'A. ขนาดของสิ่งก่อสร้าง');
const feFiles = ['frontend-admin/index.html', 'frontend-admin/doc-print.js', 'frontend-admin/pricelist-parser.js',
  'frontend-admin/dragboard.js', 'frontend-admin/config.js', 'frontend-mobile/index.html', 'frontend-mobile/config.js'];
const beTotal = BE.reduce((s, f) => s + lines(read('backend/' + f)), 0);
TBL(['ส่วน', 'ไฟล์', 'บรรทัด'], [
  ['Backend (Apps Script)', BE.length + ' ไฟล์ `.gs`', beTotal.toLocaleString()],
  ['แอดมิน (หน้าเว็บ)', '`frontend-admin/`', feFiles.filter(f => f.startsWith('frontend-admin')).reduce((s, f) => s + lines(read(f)), 0).toLocaleString()],
  ['แอปมือถือ (LIFF)', '`frontend-mobile/`', feFiles.filter(f => f.startsWith('frontend-mobile')).reduce((s, f) => s + lines(read(f)), 0).toLocaleString()],
  ['ตารางข้อมูล', Object.keys(CENTRAL).length + ' ชีตกลาง + ' + Object.keys(TENANT_TABS).length + ' ชีตต่อตัวแทน', ''],
  ['Action', MOBILE.length + ' มือถือ + ' + ADMIN.length + ' แอดมิน', '']
]);

/* ── B. ไฟล์ backend ── */
H(2, 'B. ไฟล์ backend — ผังพื้นแบบละเอียด');
P('เลขนำหน้าไฟล์คือ**ลำดับที่ Apps Script โหลด** ไฟล์เลขน้อยถูกอ่านก่อน จึงใช้เลขน้อยกับของที่คนอื่นเรียก');
TBL(['ไฟล์', 'บรรทัด', 'หัวเรื่องในไฟล์'], BE.map(f => {
  const src = read('backend/' + f);
  const m = src.match(/={3,}\s*([^=\n]+?)\s*={3,}/) || src.match(/^\s*\/\*\*?\s*\n?\s*\*?\s*(.+)$/m);
  return ['`' + f + '`', lines(src).toLocaleString(), m ? m[1].trim().slice(0, 70) : ''];
}));

/* ── C. action ── */
const actRows = surface => surface.slice().sort().map(a => {
  const fi = fnIndex[a] || {};
  const perms = (fi.perms || []).map(p => p[0] + ':' + p[1]);
  const uniq = [...new Set(perms)];
  return ['`' + a + '`', fi.file ? '`' + fi.file + '`' : '**หาไม่เจอ**',
    uniq.length ? uniq.join(' · ') : (fi.superOnly ? 'super_admin' : '—'),
    [MUT.has(a) ? 'กันกดซ้ำ' : '', (IDEM_FE.has(a) || idemBe[a]) ? 'requestId' : ''].filter(Boolean).join(' · ')];
});
H(2, 'C. Action ทั้งหมด (ทางเข้าของระบบ)');
P('**ทางเข้ามีทางเดียวคือ `doPost`** แล้วแยกเป็นสามพื้นผิว เพราะวิธียืนยันตัวตนต่างกัน' +
  ' — ดู [แผ่น 01](01-site-plan.md) หัวข้อ "ทางเข้า"');
P('ช่อง "สิทธิ์" อ่านจาก `_requirePermission()` ในตัวฟังก์ชันจริง **เครื่องหมาย — คือไม่พบการตรวจสิทธิ์**' +
  ' (ถูกต้องสำหรับ action ที่ตรวจเองด้วยวิธีอื่น แต่ถ้าเป็น action ที่เขียนข้อมูล ให้สงสัยไว้ก่อน)');
H(3, 'C.1 แอปมือถือ — `ACTION_MAP` (ยืนยันตัวตนด้วย LINE ID token)');
TBL(['action', 'นิยามที่', 'สิทธิ์', 'กันกดซ้ำ'], actRows(MOBILE));
H(3, 'C.2 แอดมิน — `ADMIN_ACTION_MAP` (ยืนยันตัวตนด้วย token จากการล็อกอิน)');
TBL(['action', 'นิยามที่', 'สิทธิ์', 'กันกดซ้ำ'], actRows(ADMIN));
H(3, 'C.3 เรียกได้โดยไม่ต้องล็อกอิน');
P('พื้นผิวที่คนนอกยิงถึง — **เพิ่มที่นี่ต้องคิดเรื่องการกรอกข้อมูลขยะและการสวมรอยเสมอ**');
out.push(publicNames.sort().map(n => '`' + n + '`').join(' · '), '');

/* ── D. ตารางข้อมูล ── */
H(2, 'D. ตารางข้อมูล');
P('**ข้อมูลอยู่สองที่** — ชีตกลาง (Central Sheet, ไฟล์เดียวของทั้ง env) กับไฟล์ของตัวแทนแต่ละราย' +
  ' · เหตุผลและกติกาการเลือกที่เก็บอยู่ใน [แผ่น 03](03-structure.md)');
H(3, 'D.1 ชีตกลาง (`CENTRAL_SHEETS` — `00_setup_sheets.gs`)');
P('ช่อง "แคช" = อยู่ใน `SHEET_CACHE_TABLES` (`02_helpers.gs`) อ่านข้ามคำขอได้ TTL 5 นาที' +
  ' — **ตารางเอกสาร/ตัวนับเลขที่/ผู้ใช้ ห้ามแคช**');
TBL(['ชีต', 'คอลัมน์', 'แคช', 'รายชื่อคอลัมน์'], Object.keys(CENTRAL).sort().map(t =>
  ['`' + t + '`', CENTRAL[t].length, CACHED[t] ? '✓' : '', CENTRAL[t].map(c => '`' + c + '`').join(' ')]));
H(3, 'D.2 ชีตในไฟล์ของตัวแทน (`TENANT_SHEET_TABS` — `13_tenants.gs`)');
P('**เพิ่มคอลัมน์ที่นี่ต้องเรียก `ensureTenantSheetsCurrent(tenantId)` ก่อนเขียนเสมอ**' +
  ' ไม่งั้นค่าถูกทิ้งเงียบๆ เพราะเขียนลงชีตด้วยชื่อหัวคอลัมน์');
TBL(['ชีต', 'คอลัมน์', 'รายชื่อคอลัมน์'], Object.keys(TENANT_TABS).sort().map(t =>
  ['`' + t + '`', TENANT_TABS[t].length, TENANT_TABS[t].map(c => '`' + c + '`').join(' ')]));

/* ── E. สิทธิ์ ── */
H(2, 'E. โมดูลสิทธิ์');
P('สิทธิ์เป็น **ดู / แก้ รายโมดูล** ผูกกับบทบาท (`roles` + `role_permissions`) ไม่ได้ผูกกับคนโดยตรง' +
  ' · โมดูลที่ไม่อยู่ในลิสต์ของฝั่งไหน **ฝั่งนั้นกดไม่ได้เลย** แม้เมนูจะตั้ง `scope` ให้เห็น');
const allMods = [...new Set([...OWNER_MODULES, ...TENANT_MODULES, ...TENANT_VIEW_ONLY])].sort();
TBL(['โมดูล', 'บริษัทเจ้าของสินค้า', 'ตัวแทน'], allMods.map(m => [
  '`' + m + '`',
  OWNER_MODULES.includes(m) ? 'ดู + แก้' : '—',
  TENANT_MODULES.includes(m) ? 'ดู + แก้' : (TENANT_VIEW_ONLY.includes(m) ? 'ดูอย่างเดียว' : '—')
]));

/* ── F. เอกสารที่มีเลข ── */
H(2, 'F. เอกสารที่มีเลขกำกับ (`DOC_SERIES_TYPES` — `12_docnum.gs`)');
P('`ที่เก็บตัวนับ = กลาง` หมายถึงแถวตัวนับอยู่ในชีตกลาง **ไม่ได้แปลว่าเลขเดินร่วมกันระหว่างบริษัท**' +
  ' — ทุกสมุดมีเล่มของตัวเอง (คีย์ `PO@BDC` แยกจาก `PO`)');
TBL(['รหัส', 'เอกสาร', 'ที่เก็บตัวนับ', 'รูปแบบตั้งต้น', 'หมายเหตุ'], DOC_TYPES.map(d => {
  const f = d.defaults || {};
  return ['`' + d.code + '`', d.label, d.central ? 'กลาง' : 'ไฟล์ตัวแทน',
    [f.prefix, f.date_format, 'x'.repeat(f.running_digits || 0)].filter(Boolean).join(f.separator || '-')
      + (f.reset_cycle && f.reset_cycle !== 'none' ? ' · รีเซ็ต' + ({ yearly: 'รายปี', monthly: 'รายเดือน', daily: 'รายวัน' }[f.reset_cycle] || f.reset_cycle) : ''),
    d.note || ''];
}));

/* ── G. ผังบัญชี ── */
H(2, 'G. รหัสบัญชีที่ระบบอ้างอิงเอง (`GL_ACCT` — `23_accounting.gs`)');
P('**เปลี่ยนรหัสในผังบัญชีต้องแก้ `GL_ACCT` ด้วย** ไม่งั้นระบบลงบัญชีไปที่รหัสที่ไม่มีอยู่');
const coaNames = {};
(setupSrc.match(/\['(\d{4})',\s*'([^']+)'/g) || []).forEach(s => {
  const m = s.match(/\['(\d{4})',\s*'([^']+)'/); if (m) coaNames[m[1]] = m[2];
});
TBL(['ค่าคงที่', 'รหัส', 'ชื่อบัญชี'], Object.keys(GL).map(k => ['`GL_ACCT.' + k + '`', GL[k], coaNames[GL[k]] || '']));

/* ── H. เมนู ── */
H(2, 'H. เมนูแอดมิน (`NAV_GROUPS` — `frontend-admin/index.html`)');
P('**ชุดเดียวใช้ทั้งสองฝั่ง** เลขเดียวกันทุกคน ต่างกันแค่เห็น/ไม่เห็น และกดได้/กดไม่ได้ (`navState()`)' +
  ' · กลุ่ม 6 สำรองไว้ตามที่เจ้าของระบบสั่ง');
const navRows = [];
NAV.forEach(g => (g.subs || []).forEach(s => (s.items || []).forEach(it => navRows.push([
  it.n, g.label + ' › ' + s.label + ' › ' + it.label, '`' + it.view + '`', '`' + (it.mod || '') + '`',
  it.scope === 'both' ? 'ทั้งสองฝั่ง' : (it.scope === 'owner' ? 'บริษัท' : (it.scope === 'tenant' ? 'ตัวแทน' : it.scope || '')),
  it.ready ? 'ใช้งานได้' : '**ยังไม่ได้ทำ**'
]))));
TBL(['เลข', 'เมนู', 'view', 'โมดูล', 'ฝั่ง', 'สถานะ'], navRows);
const notReady = navRows.filter(r => /ยังไม่/.test(r[5]));
P('**ยังไม่ได้ทำ ' + notReady.length + ' เมนู**: ' + notReady.map(r => r[0] + ' ' + r[1].split(' › ').pop()).join(' · '));

/* ── I. เทสต์ ── */
H(2, 'I. เทสต์ที่คุมแบบนี้อยู่');
const tests = fs.readdirSync(path.join(ROOT, '.dev')).filter(f => /^(test|uat)-.*\.js$/.test(f)).sort();
TBL(['สคริปต์', 'ชนิด', 'บรรทัด'], tests.map(f => ['`.dev/' + f + '`',
  f.startsWith('uat-') ? 'ยิง UAT จริง (เขียนข้อมูล)' : 'หน่วย (ไม่ยิงเน็ต)', lines(read('.dev/' + f)).toLocaleString()]));

if (warn.length) {
  H(2, 'คำเตือนจากตัวสร้างแบบ');
  P('**ตัวสร้างอ่านของบางอย่างไม่ได้ ตารางข้างบนจึงอาจไม่ครบ** — แก้ `.dev/gen-blueprint.js` ให้ตามโค้ดที่ย้ายไป');
  warn.forEach(w => out.push('- ' + w));
  out.push('');
}

const text = out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
const strip = s => s.replace(/> สร้างเมื่อ \d{4}-\d{2}-\d{2} /, '> สร้างเมื่อ — ');

if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const same = strip(cur.replace(/\r\n/g, '\n')) === strip(text);
  console.log(same ? 'แบบตรงกับโค้ด' : '★ แบบไม่ตรงกับโค้ดแล้ว — รัน `node .dev/gen-blueprint.js` แล้ว commit ไปด้วย');
  if (warn.length) warn.forEach(w => console.log('  คำเตือน: ' + w));
  process.exit(same ? 0 : 1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text.replace(/\n/g, '\r\n'));
console.log('เขียน ' + path.relative(ROOT, OUT) + ' — ' + lines(text).toLocaleString() + ' บรรทัด');
console.log('  action ' + (MOBILE.length + ADMIN.length) +
  ' · ชีตกลาง ' + Object.keys(CENTRAL).length + ' · ชีตตัวแทน ' + Object.keys(TENANT_TABS).length +
  ' · เมนู ' + navRows.length + ' · เทสต์ ' + tests.length);
if (warn.length) { console.log('\n★ คำเตือน:'); warn.forEach(w => console.log('  - ' + w)); }
