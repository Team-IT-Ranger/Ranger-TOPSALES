/**
 * แปลงรหัสจังหวัดจาก "รหัสของ Smartsales" → "รหัสมาตรฐานไทย" (เจ้าของระบบสั่ง 6 ต.ค. 2026)
 *
 *   BACKEND_URL='<exec url>' ADMIN_USER=... ADMIN_PASS=... node .dev/fix-province-codes.js [--commit]
 *
 * ★ ทำไมต้องแปลง: รหัสของ Smartsales ตั้งแต่ 20 ขึ้นไปตรงกับมาตรฐาน แต่ต่ำกว่านั้นเลื่อนกันหนึ่งตำแหน่ง
 *   (19 = สมุทรปราการ ของเขา แต่ = สระบุรี ตามมาตรฐาน) · ปล่อยไว้แล้ววันหนึ่งจะมีคนอ่านรหัสด้วยสมมติฐานผิด
 *
 * ★★ จับคู่ด้วย "ชื่อจังหวัด" ไม่ใช่ตำแหน่งในรายการ — ชื่อคือสิ่งเดียวที่สองระบบตกลงกัน
 *   ชีต Smartsales เขียน "จ.ชลบุรี" ส่วนมาตรฐานเขียน "ชลบุรี" จึงต้องตัดคำนำหน้าก่อนเทียบ
 *   **ถ้าจับคู่ไม่ครบ = หยุด ไม่เขียนอะไรเลย** รหัสจังหวัดผิดแปลว่าที่อยู่ลูกค้าผิด
 *
 * ต้องแปลง 3 ที่: ตาราง provinces · districts.province_id · customers.province_id
 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, 'xlsx.full.min.js'));

const XLSX_PATH = process.env.CUSTOMER_XLSX ||
  'G:\\Shared drives\\AppSpace\\Ranger-TOPSALES\\reference\\customer_for_bdc.xlsx';
const TENANT = process.env.TENANT_ID || 'BDC';
const COMMIT = process.argv.includes('--commit');
const S = v => String(v === null || v === undefined ? '' : v).trim();
// "จ.ชลบุรี" / "จังหวัดชลบุรี" / "ชลบุรี" → "ชลบุรี"  · กรุงเทพฯ เขียนได้หลายแบบ
const norm = n => S(n).replace(/^จังหวัด/, '').replace(/^จ\./, '').replace(/\s+/g, '')
  .replace(/^กรุงเทพฯ$/, 'กรุงเทพมหานคร');

async function call(url, action, payload, token) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, payload: payload || {} })
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { success: false, raw: t.slice(0, 200) }; }
}

(async () => {
  const url = process.env.BACKEND_URL;
  if (COMMIT && !url) { console.error('ต้องส่ง BACKEND_URL เมื่อใช้ --commit'); process.exit(1); }

  // รหัสมาตรฐาน — ดึงจาก _seedProvinces() ในซอร์ส ซึ่งเป็นตัวที่ระบบใช้มาตั้งแต่ตั้งต้น
  const src = fs.readFileSync(path.join(__dirname, '..', 'backend', '00_setup_sheets.gs'), 'utf8');
  const body = src.match(/function _seedProvinces\(\)[\s\S]*?\n}/)[0];
  const std = [...body.matchAll(/\[(\d+),'([^']+)','([^']*)','([^']*)'\]/g)]
    .map(m => ({ id: m[1], name: m[2], nameEn: m[3], region: m[4] }));
  const stdByName = {};
  std.forEach(p => { stdByName[norm(p.name)] = p; });

  const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
  const sheet = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
  const smart = sheet('province').filter(r => S(r.ProvCode) && S(r.ProvCode) !== '00');

  // รหัส Smartsales → รหัสมาตรฐาน
  const remap = {}, unmatched = [];
  smart.forEach(r => {
    const hit = stdByName[norm(r.ProvDesc)];
    if (hit) remap[S(r.ProvCode)] = hit.id; else unmatched.push(S(r.ProvCode) + ' ' + S(r.ProvDesc));
  });

  const custRows = sheet('customer').filter(r => S(r.CustNo) && S(r.ProvCode) && S(r.AmphurCode));
  const usedCodes = [...new Set(custRows.map(r => S(r.ProvCode)))];
  const missing = usedCodes.filter(c => !remap[c]);

  console.log('จังหวัดในชีต Smartsales ' + smart.length + ' · จับคู่กับรหัสมาตรฐานได้ ' + Object.keys(remap).length);
  if (unmatched.length) console.log('⚠ จับคู่ไม่ได้ ' + unmatched.length + ': ' + unmatched.slice(0, 8).join(' · '));
  console.log('รหัสที่ลูกค้าใช้จริง ' + usedCodes.length + ' รหัส: ' + usedCodes.sort((a, b) => a - b).join(', '));
  console.log();
  console.log('ตารางแปลง (เฉพาะที่ลูกค้าใช้):');
  usedCodes.sort((a, b) => a - b).forEach(c => {
    const sm = smart.find(r => S(r.ProvCode) === c);
    const to = remap[c];
    const stdName = (std.find(p => p.id === to) || {}).name || '?';
    console.log('   ' + c.padStart(3) + ' ' + S(sm && sm.ProvDesc).padEnd(16) + ' →  ' + String(to).padStart(3) + ' ' + stdName +
      (c === to ? '' : '   ★ เปลี่ยน'));
  });

  // ★ ลูกค้าใช้รหัสไหนแล้วแปลงไม่ได้ = หยุด ไม่เขียนอะไรเลย
  if (missing.length) {
    console.error('\n★ หยุด — รหัสที่ลูกค้าใช้แต่แปลงไม่ได้: ' + missing.join(', '));
    process.exit(1);
  }

  const districts = sheet('amphur').filter(r => S(r.AmphurCode)).map(r => ({
    id: S(r.AmphurCode), name: S(r.AmphurDesc), provinceId: remap[S(r.ProvCode)] || ''
  }));
  const items = custRows.map(r => ({
    externalCode: S(r.CustNo), provinceId: remap[S(r.ProvCode)], districtId: S(r.AmphurCode)
  }));
  const orphan = districts.filter(d => !d.provinceId).length;
  console.log('\nอำเภอ ' + districts.length + ' แถว (จังหวัดแปลงไม่ได้ ' + orphan + ') · ลูกค้าที่จะอัปเดต ' + items.length);

  if (!COMMIT) { console.log('\n— ดูอย่างเดียว ไม่ได้แตะข้อมูล — ใส่ --commit เพื่อเขียนจริง'); return; }

  const lg = await call(url, 'adminLogin', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  if (!lg.success) { console.error('ล็อกอินไม่ผ่าน: ' + (lg.message || lg.raw)); process.exit(1); }

  // ลำดับสำคัญ: เขียนตารางอ้างอิงก่อน ไม่งั้น backfill จะปฏิเสธเพราะรหัสใหม่ยังไม่มีในตาราง
  const r1 = await call(url, 'importAddressRefs', { provinces: std, districts }, lg.token);
  console.log('ตารางอ้างอิง: ' + (r1.success ? JSON.stringify(r1.counts) : '✗ ' + (r1.message || r1.raw)));
  if (!r1.success) process.exit(1);

  // overwrite เพราะกำลัง "แก้ค่าที่ผิดอยู่" ไม่ใช่เติมช่องว่าง
  const r2 = await call(url, 'backfillCustomerAreas',
    { tenantId: TENANT, items, overwrite: true }, lg.token);
  console.log('ลูกค้า: ' + (r2.success ? r2.message : '✗ ' + (r2.message || r2.raw)));
  if (!r2.success) process.exit(1);
})();
