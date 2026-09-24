// นำเข้าใบราคาจริงจาก reference/*.xlsx เข้าสภาพแวดล้อมใดก็ได้ผ่าน API (ใช้ตัวอ่านไฟล์ชุดเดียวกับหน้าเว็บ)
//
//   BACKEND_URL='<exec url>' node .dev/import-pricelists.js            → นำเข้าจริง (ได้ชุดราคาสถานะ "ร่าง")
//   BACKEND_URL='<exec url>' node .dev/import-pricelists.js --dry      → อ่านไฟล์อย่างเดียว ไม่แตะ backend
//   ADMIN_USER / ADMIN_PASS  → ถ้าไม่ตั้ง ใช้ admin / ChangeMe123!
//
// นำเข้าแล้วได้ชุดราคา **สถานะร่าง** เสมอ — การเปิดใช้งาน (activate) ต้องกดเองในแอป เพราะชุดที่เปิดใช้แล้ว
// แก้ไม่ได้อีก (ใบเสร็จเก่าอ้างอิงราคานั้น ดู _draftListOrError ใน backend/17_pricing.gs)
// สคริปต์นี้แทน .dev/import-to-uat.js เดิมที่ล็อกไว้กับ UAT อย่างเดียว
const XLSX = require('./xlsx.full.min.js'), fs = require('fs'), path = require('path');
const P = require('../frontend-admin/pricelist-parser.js');

const URL_ = process.env.BACKEND_URL, USER = process.env.ADMIN_USER || 'admin', PASS = process.env.ADMIN_PASS || 'ChangeMe123!';
const DRY = process.argv.includes('--dry');
if (!URL_ && !DRY) { console.error('ตั้ง BACKEND_URL ก่อน (หรือใส่ --dry เพื่ออ่านไฟล์อย่างเดียว)'); process.exit(1); }

// ชื่อกลุ่มลูกค้าตามไฟล์ — คำในชื่อไฟล์ → ชื่อกลุ่มที่จะใช้ในระบบ (ไม่มีกลุ่มนี้ backend สร้างให้เอง)
const GROUPS = [
  ['กรุงเทพ',    'ร้านค้า กทม./กลาง/ตะวันตก'],
  ['เหนือ',      'ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้'],
  ['ซุปเปอร์ชีป', 'ซุปเปอร์ชีป'],
  ['ศูนย์',      'ศูนย์/ตัวแทนจำหน่าย']
];

const call = async body => {
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบไม่ใช่ JSON: ' + t.slice(0, 120)); }
};

(async () => {
  const dir = path.join(__dirname, '..', 'reference');
  const files = fs.readdirSync(dir).filter(x => x.startsWith('Go Live') && x.endsWith('.xlsx'));
  if (!files.length) { console.error('ไม่พบไฟล์ใบราคาใน reference/ (โฟลเดอร์นี้มีเฉพาะใน clone ฝั่ง Drive)'); process.exit(1); }

  let token = null;
  if (!DRY) {
    const login = await call({ action: 'adminLogin', payload: { username: USER, password: PASS } });
    if (!login.success) { console.error('ล็อกอินไม่ได้: ' + login.message); process.exit(1); }
    token = login.token;
    console.log('ล็อกอินเป็น ' + USER + ' (' + login.roleCode + ') → ' + URL_.slice(0, 60) + '…\n');
  }

  let failed = 0;
  for (const f of files) {
    const out = P.parse(XLSX, fs.readFileSync(path.join(dir, f)), { type: 'buffer' });
    const s = out.sheets[0];
    if (!s) { console.error('อ่านไฟล์ไม่สำเร็จ: ' + f); failed++; continue; }
    const period = P.parsePeriod(s.title);
    const grp = GROUPS.find(g => f.includes(g[0]));
    if (!grp) { console.error('ไม่รู้ว่าไฟล์นี้เป็นของกลุ่มลูกค้าไหน: ' + f); failed++; continue; }
    if (!period) { console.error('อ่านช่วงเวลาจากหัวไฟล์ไม่ได้: ' + f); failed++; continue; }

    const name = grp[1] + ' ' + period.from + '..' + period.to;
    console.log('■ ' + grp[1] + ' — ' + s.items.length + ' กลุ่มราคา · ' +
      s.items.reduce((n, i) => n + i.variants.length, 0) + ' สินค้า · ' +
      s.items.reduce((n, i) => n + i.tiers.length, 0) + ' ขั้น · ' +
      s.items.reduce((n, i) => n + i.packs.length, 0) + ' แพ็ค · โปรบิล ' + s.billPromos.length);
    if (s.warnings.length) console.log('   คำเตือนจากไฟล์: ' + s.warnings.join(' / '));
    if (DRY) continue;

    const res = await call({ action: 'importPriceList', token, payload: {
      name: name, customerGroupName: grp[1], validFrom: period.from, validTo: period.to,
      sourceFile: f, lines: s.items, billPromos: s.billPromos } });
    if (!res.success) { console.error('   ✗ ' + res.message + (res.warnings ? ' | ' + res.warnings.join(' / ') : '')); failed++; continue; }
    const st = res.stats || {};
    console.log('   ✓ id ' + res.id + ' · ขั้นราคา ' + st.itemsCreated + ' · สินค้าใหม่ ' + st.productsCreated +
      ' · จับคู่สินค้าเดิม ' + st.productsMatched + (st.groupCreated ? ' · สร้างกลุ่มลูกค้าใหม่' : ''));
    if ((res.warnings || []).length) console.log('   ⚠ ' + res.warnings.join('\n   ⚠ '));
  }
  console.log('\n' + (failed ? failed + ' ไฟล์ไม่สำเร็จ' : 'ครบทุกไฟล์') +
    (DRY ? ' (dry run — ไม่ได้เขียนอะไรลง backend)' : ' — ชุดราคาที่ได้เป็น "ร่าง" ทั้งหมด ต้องกดเปิดใช้งานเองในแอป'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.message || e); process.exit(1); });
