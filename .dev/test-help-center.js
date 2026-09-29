// รัน: node .dev/test-help-center.js
// ทดสอบคู่มือใช้งานระบบ (42_help_center.gs) — เก็บเนื้อหาใน Central Sheet ไม่ hardcode ใน index.html
// (เจ้าของระบบสั่ง 2026-09-29: "Training-Free" สำหรับแอดมินตัวแทน)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = { help_articles: [] };
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-29', getUuid: () => 'uuid' },
  Logger: { log: () => {} },
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralAppend: (n, o) => sheetOf(n).push(Object.assign({}, o)),
  centralUpdate: (n, id, f) => { const r = sheetOf(n).find(x => String(x.record_id) === String(id)); if (r) Object.assign(r, f); return !!r; },
  centralNextId: n => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralInvalidate: () => {},
  nowStr: () => '2026-09-29 10:00:00'
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralAppend', 'centralUpdate', 'centralNextId', 'centralInvalidate', 'nowStr'].forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
vm.runInContext(B('42_help_center.gs'), ctx, { filename: '42_help_center.gs' });

const SUPER = { role_code: 'super_admin', adminUserId: '1' };
const OWNER = { role_code: 'owner_admin', adminUserId: '2' };
const TENANT = { role_code: 'tenant_admin', adminUserId: '3', tenant_id: 'T1' };

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const fails = (name, r, re) => {
  const good = r && r.success === false && (!re || re.test(r.message || ''));
  console.log((good ? 'PASS ' : 'FAIL ') + name + (good ? '' : '\n   got ' + JSON.stringify(r)));
  if (!good) failed++;
};

console.log('── สิทธิ์แก้ไข: เฉพาะ super_admin/owner_admin ──');
fails('ตัวแทนแก้ไม่ได้', ctx.saveHelpArticle(TENANT, { code: 'x', category: 'sales', title: 'ทดสอบ' }), /เฉพาะเจ้าของระบบ/);
fails('หมวดหมู่ผิด → ปฏิเสธ (whitelist กันพิมพ์ผิด)', ctx.saveHelpArticle(SUPER, { code: 'x', category: 'ไม่มีจริง', title: 'ทดสอบ' }), /หมวดหมู่ไม่ถูกต้อง/);
fails('ไม่ใส่หัวข้อ → ปฏิเสธ', ctx.saveHelpArticle(SUPER, { code: 'x', category: 'sales', title: '' }), /หัวข้อ/);

console.log('\n── สร้าง/แก้/รหัสซ้ำ ──');
let r = ctx.saveHelpArticle(SUPER, { code: 'sales-01', category: 'sales', title: 'เปิดบิลขาย', summary: 'ทีละขั้นตอน',
  body: '1. เลือกลูกค้า\n2. เพิ่มรายการ\n\n[ภาพ: หน้าจอเปิดบิลขาย]', sortOrder: 1 });
eq('สร้างบทความใหม่สำเร็จ', r.success, true);
const id1 = r.id;
fails('รหัสซ้ำกับตัวอื่น → ปฏิเสธ', ctx.saveHelpArticle(OWNER, { code: 'sales-01', category: 'sales', title: 'อีกเรื่อง' }), /ถูกใช้แล้ว/);
r = ctx.saveHelpArticle(OWNER, { id: id1, code: 'sales-01', category: 'sales', title: 'เปิดบิลขาย (แก้แล้ว)', sortOrder: 1 });
eq('แก้ของเดิมด้วยรหัสเดิมของตัวเอง ไม่ถือว่าซ้ำ', [r.success, ctx.centralObjects('help_articles').find(a => String(a.record_id) === id1).title],
  [true, 'เปิดบิลขาย (แก้แล้ว)']);

console.log('\n── มองเห็น: คนทั่วไปเห็นแต่ที่เปิดใช้งาน ── ');
ctx.saveHelpArticle(SUPER, { code: 'sales-02', category: 'sales', title: 'ยกเลิกบิล', sortOrder: 2 });
ctx.setHelpArticleActive(SUPER, { id: id1, isActive: false });
r = ctx.listHelpArticles(TENANT, {});
eq('ตัวแทน (ไม่ใช่ editor) ไม่เห็นบทความที่ปิดไว้ แม้ขอ includeInactive มาด้วย', r.data.some(a => a.id === id1), false);
eq('ยังเห็นบทความที่เปิดอยู่ตามปกติ', r.data.some(a => a.title === 'ยกเลิกบิล'), true);
eq('canEdit=false สำหรับตัวแทน', r.canEdit, false);
r = ctx.listHelpArticles(SUPER, { includeInactive: true });
eq('super_admin ขอ includeInactive เห็นบทความที่ปิดไว้ด้วย', r.data.some(a => a.id === id1), true);
eq('canEdit=true สำหรับ super_admin', r.canEdit, true);

console.log('\n── เรียงลำดับ: ตามหมวด → sortOrder → record_id ──');
ctx.setHelpArticleActive(SUPER, { id: id1, isActive: true });
ctx.saveHelpArticle(SUPER, { code: 'start-01', category: 'start', title: 'เข้าสู่ระบบครั้งแรก', sortOrder: 1 });
r = ctx.listHelpArticles(SUPER, {});
eq('เรียงตามหมวด (เรียงตัวอักษร) มาก่อน แล้วค่อย sortOrder ภายในหมวด',
  r.data.map(a => a.category), ['sales', 'sales', 'start']);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
