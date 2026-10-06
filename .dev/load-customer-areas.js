/**
 * เติมตารางจังหวัด/อำเภอ แล้วเติมรหัสพื้นที่ให้ลูกค้า — อ่านจาก customer_for_bdc.xlsx
 *
 *   BACKEND_URL='<exec url>' ADMIN_USER=... ADMIN_PASS=... node .dev/load-customer-areas.js [--commit]
 *
 * ★ ไม่ใส่ --commit = ดูอย่างเดียว ไม่แตะข้อมูล (ค่าตั้งต้น) — งานนี้แก้ลูกค้าหลักพันราย ย้อนกลับยาก
 * ★ ค่าตั้งต้นไม่ทับของเดิม — ส่ง --overwrite ถึงจะทับจังหวัด/อำเภอที่มีคนกรอกไว้แล้ว
 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, 'xlsx.full.min.js'));

const XLSX_PATH = process.env.CUSTOMER_XLSX ||
  'G:\\Shared drives\\AppSpace\\Ranger-TOPSALES\\reference\\customer_for_bdc.xlsx';
const TENANT = process.env.TENANT_ID || 'BDC';
const COMMIT = process.argv.includes('--commit');
const OVERWRITE = process.argv.includes('--overwrite');
const S = v => String(v === null || v === undefined ? '' : v).trim();

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
  // ต้องมี URL เฉพาะตอนเขียนจริง — ดูอย่างเดียวควรรันได้โดยไม่ต้องมี credential
  if (COMMIT && !url) { console.error('ต้องส่ง BACKEND_URL เมื่อใช้ --commit'); process.exit(1); }

  const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
  const sheet = n => {
    if (!wb.Sheets[n]) { console.error('ไม่พบชีต ' + n); process.exit(1); }
    return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
  };

  const provinces = sheet('province')
    .filter(r => S(r.ProvCode) && S(r.ProvCode) !== '00')
    .map(r => ({ id: S(r.ProvCode), name: S(r.ProvDesc) }));
  const districts = sheet('amphur')
    .filter(r => S(r.AmphurCode))
    .map(r => ({ id: S(r.AmphurCode), name: S(r.AmphurDesc), provinceId: S(r.ProvCode) }));

  const items = sheet('customer')
    .filter(r => S(r.CustNo) && S(r.ProvCode) && S(r.AmphurCode))
    .map(r => ({ externalCode: S(r.CustNo), provinceId: S(r.ProvCode), districtId: S(r.AmphurCode) }));

  console.log('จากไฟล์: จังหวัด ' + provinces.length + ' · อำเภอ ' + districts.length + ' · ลูกค้าที่มีรหัสพื้นที่ ' + items.length);
  // ★ รหัสอำเภอต้องไม่ซ้ำ เพราะใช้เป็น id ของตาราง — ซ้ำแล้วแถวหลังทับแถวหน้าเงียบๆ
  const dup = districts.length - new Set(districts.map(d => d.id)).size;
  if (dup) { console.error('★ รหัสอำเภอซ้ำ ' + dup + ' รหัส — หยุดก่อน'); process.exit(1); }
  const provIds = new Set(provinces.map(p => p.id));
  const orphan = districts.filter(d => !provIds.has(d.provinceId));
  if (orphan.length) console.log('⚠ อำเภอที่จังหวัดไม่อยู่ในรายการ ' + orphan.length + ' แถว (จะยังเติมให้ แต่ dropdown จะไม่โชว์)');

  if (!COMMIT) {
    console.log('\n— ดูอย่างเดียว ไม่ได้แตะข้อมูล — ใส่ --commit เพื่อเขียนจริง');
    console.log('ตัวอย่างที่จะเติม:');
    items.slice(0, 5).forEach(i => console.log('   ' + i.externalCode + ' → จังหวัด ' + i.provinceId + ' อำเภอ ' + i.districtId));
    return;
  }

  const lg = await call(url, 'adminLogin', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  if (!lg.success) { console.error('ล็อกอินไม่ผ่าน: ' + (lg.message || lg.raw)); process.exit(1); }

  const r1 = await call(url, 'importAddressRefs', { provinces, districts }, lg.token);
  console.log('เติมตารางอ้างอิง: ' + (r1.success ? JSON.stringify(r1.counts) : '✗ ' + (r1.message || r1.raw)));
  if (!r1.success) process.exit(1);

  const r2 = await call(url, 'backfillCustomerAreas',
    { tenantId: TENANT, items, overwrite: OVERWRITE }, lg.token);
  console.log('เติมให้ลูกค้า: ' + (r2.success ? (r2.message + ' · เขียนคอลัมน์ ' + JSON.stringify(r2.columnsWritten)) : '✗ ' + (r2.message || r2.raw)));
  if (!r2.success) process.exit(1);
})();
