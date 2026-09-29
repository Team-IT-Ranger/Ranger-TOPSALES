// นำเข้าใบราคาจริงจาก reference/*.xlsx เข้าสภาพแวดล้อมใดก็ได้ผ่าน API (ใช้ตัวอ่านไฟล์ชุดเดียวกับหน้าเว็บ)
//
//   BACKEND_URL='<exec url>' node .dev/import-pricelists.js            → นำเข้าจริง (ได้ชุดราคาสถานะ "ร่าง")
//   BACKEND_URL='<exec url>' node .dev/import-pricelists.js --dry      → อ่านไฟล์อย่างเดียว ไม่แตะ backend
//   ADMIN_USER / ADMIN_PASS  → ถ้าไม่ตั้ง ใช้ admin / ChangeMe123!
//   REFERENCE_DIR            → ถ้าไม่ตั้ง ใช้ reference/ ข้างๆ repo (ปกติมีเฉพาะ clone ฝั่ง Drive — ดู CLAUDE.md
//                              "ทำงานสองคน" · เครื่องอื่นชี้ตรงไป G:\Shared drives\...\reference ได้เลย)
//
// นำเข้าแล้วได้ชุดราคา **สถานะร่าง** เสมอ — การเปิดใช้งาน (activate) ต้องกดเองในแอป เพราะชุดที่เปิดใช้แล้ว
// แก้ไม่ได้อีก (ใบเสร็จเก่าอ้างอิงราคานั้น ดู _draftListOrError ใน backend/17_pricing.gs)
// สคริปต์นี้แทน .dev/import-to-uat.js เดิมที่ล็อกไว้กับ UAT อย่างเดียว
const XLSX = require('./xlsx.full.min.js'), fs = require('fs'), path = require('path');
const P = require('../frontend-admin/pricelist-parser.js');

const URL_ = process.env.BACKEND_URL, USER = process.env.ADMIN_USER || 'admin', PASS = process.env.ADMIN_PASS || 'ChangeMe123!';
const DRY = process.argv.includes('--dry');
// ★ ต้องมี BACKEND_URL แม้ตอน --dry เพราะต้องล็อกอินไปอ่าน listPriceLists จริง มาหากลุ่มลูกค้าปลายทาง
// (เลือกจาก "กลุ่มที่มีชุดราคา active อยู่" ไม่ใช่เดาจากชื่อ) — --dry แค่ข้ามขั้นตอนเขียนจริงตอนท้าย
if (!URL_) { console.error('ตั้ง BACKEND_URL ก่อนเสมอ (แม้จะ --dry ก็ต้องอ่านกลุ่มลูกค้าจริงจาก backend ก่อนตัดสินใจ)'); process.exit(1); }

// ★ 2026-09-30 (2) คำในชื่อไฟล์ → หากลุ่มลูกค้าจาก "กลุ่มที่มีชุดราคา active อยู่ตอนนี้" ไม่ใช่จากชื่อกลุ่มตรงๆ
// (กติกาเดียวกับ .dev/assign-bdc-groups.js) — ก่อนหน้านี้สคริปต์นี้ส่ง customerGroupName ตรงๆ ซึ่งเสี่ยงมาก:
// UAT มีกลุ่มชื่อเกือบซ้ำกันจากคนละที่มา ("ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้" ไม่มีชุดราคา ตัวจริงที่ลูกค้า BDC
// 2,030 รายผูกอยู่คือ "ร้านค้า เหนือ, อีสาน, ตะวันออก, ใต้") ชื่อกลุ่มที่เคยฮาร์ดโค้ดไว้ตรงกับกลุ่ม "เปล่า" พอดี
// — เอาราคาใหม่ไปลงกลุ่มผิดโดยไม่มีอะไรฟ้อง จนร้านค้าจริงเปิดบิลไม่ได้เหมือนเดิม
const GROUPS = [
  ['กรุงเทพ',    'กทม./กลาง/ตะวันตก'],
  ['เหนือ',      'เหนือ'],
  ['ซุปเปอร์ชีป', 'ซุปเปอร์ชีป'],
  ['ศูนย์',      'ศูนย์']
];

const call = async body => {
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบไม่ใช่ JSON: ' + t.slice(0, 120)); }
};

(async () => {
  const dir = process.env.REFERENCE_DIR || path.join(__dirname, '..', 'reference');
  const files = fs.readdirSync(dir).filter(x => x.startsWith('Go Live') && x.endsWith('.xlsx'));
  if (!files.length) { console.error('ไม่พบไฟล์ใบราคาใน ' + dir + ' (ปกติมีเฉพาะ clone ฝั่ง Drive — ตั้ง REFERENCE_DIR ชี้ไป G:\\Shared drives\\...\\reference ได้)'); process.exit(1); }

  const login = await call({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.success) { console.error('ล็อกอินไม่ได้: ' + login.message); process.exit(1); }
  const token = login.token;
  console.log('ล็อกอินเป็น ' + USER + ' (' + login.roleCode + ') → ' + URL_.slice(0, 60) + '…\n');

  // ★ 2026-09-30 (2) หากลุ่มลูกค้าปลายทางจาก "กลุ่มที่มีชุดราคา active อยู่ตอนนี้" ตรงกับคำในชื่อไฟล์ — ไม่ใช่
  // ส่ง customerGroupName ตรงๆ (เสี่ยงไปสร้าง/ชนกับกลุ่มชื่อใกล้เคียงที่ไม่มีชุดราคา ดูคอมเมนต์เหนือ GROUPS)
  const activeLists = await call({ action: 'listPriceLists', token });
  if (!activeLists.success) { console.error('อ่านรายการชุดราคาเดิมไม่สำเร็จ: ' + activeLists.message); process.exit(1); }
  const active = (activeLists.data || []).filter(l => l.status === 'active');

  let failed = 0;
  for (const f of files) {
    const out = P.parse(XLSX, fs.readFileSync(path.join(dir, f)), { type: 'buffer' });
    const s = out.sheets[0];
    if (!s) { console.error('อ่านไฟล์ไม่สำเร็จ: ' + f); failed++; continue; }
    const period = P.parsePeriod(s.title);
    const grp = GROUPS.find(g => f.includes(g[0]));
    if (!grp) { console.error('ไม่รู้ว่าไฟล์นี้เป็นของกลุ่มลูกค้าไหน: ' + f); failed++; continue; }
    if (!period) { console.error('อ่านช่วงเวลาจากหัวไฟล์ไม่ได้: ' + f); failed++; continue; }

    const matches = active.filter(l => (l.customerGroupName || '').indexOf(grp[1]) !== -1);
    const groupIds = [...new Set(matches.map(l => l.customerGroupId))];
    if (groupIds.length !== 1) {
      console.error('✗ ' + f + ' — หากลุ่มลูกค้าปลายทางไม่ได้ (คำ "' + grp[1] + '" เจอชุดราคา active ' + groupIds.length + ' กลุ่ม, ต้องการเจอ 1)' +
        (matches.length ? ' — พบ: ' + matches.map(l => l.customerGroupName + ' (id ' + l.customerGroupId + ')').join(' / ') : ' — ไม่พบชุดราคา active ที่ชื่อกลุ่มมีคำนี้เลย'));
      failed++; continue;
    }
    const groupId = groupIds[0], groupName = matches[0].customerGroupName;

    const name = groupName + ' ' + period.from + '..' + period.to;
    console.log('■ ' + f + ' → กลุ่ม "' + groupName + '" (id ' + groupId + ', จากชุดราคา active เดิม: ' + matches.map(l => l.name).join(', ') + ')');
    console.log('   ' + s.items.length + ' กลุ่มราคา · ' +
      s.items.reduce((n, i) => n + i.variants.length, 0) + ' สินค้า · ' +
      s.items.reduce((n, i) => n + i.tiers.length, 0) + ' ขั้น · ' +
      s.items.reduce((n, i) => n + i.packs.length, 0) + ' แพ็ค · โปรบิล ' + s.billPromos.length);
    if (s.warnings.length) console.log('   คำเตือนจากไฟล์: ' + s.warnings.join(' / '));
    if (DRY) continue;

    const res = await call({ action: 'importPriceList', token, payload: {
      name: name, customerGroupId: groupId, validFrom: period.from, validTo: period.to,
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
