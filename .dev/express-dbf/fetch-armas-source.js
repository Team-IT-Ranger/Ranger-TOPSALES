/**
 * ดึงข้อมูลที่ build_armas.py ต้องใช้ มารวมเป็นไฟล์เดียว → data/armas_source.json  (ไม่ commit)
 *
 * สองแหล่ง:
 *   1) ลูกค้าบน prod (ผ่าน listCustomersAdmin) — เป็นข้อมูลที่ "สะอาดแล้ว": แยกคำนำหน้าออกจากชื่อ,
 *      เติมศูนย์นำหน้าเลขภาษีคืน, ออกรหัสลูกค้าของเราเอง (ดู .dev/import-customers.js)
 *   2) customer_for_bdc.xlsx — เอาเฉพาะ "รหัสพื้นที่" ที่ระบบเราไม่ได้เก็บไว้:
 *      Tumbol / AmphurCode / ProvCode  แล้วแปลงเป็นชื่อด้วยชีต amphur + province ในไฟล์เดียวกัน
 *      (ระบบเราเก็บ address เป็นก้อนเดียว · district_id/province_id ว่างทั้ง 2,039 ราย)
 *
 * ★ จับคู่สองแหล่งด้วย customers.external_code ↔ customer.CustNo — ตรวจแล้วตรงกัน 2,039/2,039
 *
 * ใช้:
 *   BACKEND_URL='<prod exec url>' ADMIN_USER='...' ADMIN_PASS='...' node .dev/express-dbf/fetch-armas-source.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'xlsx.full.min.js'));

const XLSX_PATH = process.env.CUSTOMER_XLSX ||
  'G:\\Shared drives\\AppSpace\\Ranger-TOPSALES\\reference\\customer_for_bdc.xlsx';
const TENANT = process.env.TENANT_ID || 'BDC';
const OUT_DIR = path.join(__dirname, 'data');

const S = v => String(v === null || v === undefined ? '' : v).trim();

async function call(url, action, payload, token) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, payload: payload || {} })
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { success: false, raw: t.slice(0, 200) }; }
}

(async () => {
  const url = process.env.BACKEND_URL;
  if (!url) { console.error('ต้องส่ง BACKEND_URL'); process.exit(1); }

  // ── 1) ลูกค้าบน prod ──
  const lg = await call(url, 'adminLogin', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  if (!lg.success) { console.error('ล็อกอินไม่ผ่าน: ' + (lg.message || lg.raw)); process.exit(1); }
  const cr = await call(url, 'listCustomersAdmin', { tenantId: TENANT }, lg.token);
  const customers = cr.customers || [];
  // ★ Apps Script ตอบไม่ครบเป็นระยะ — เช็คก่อนเขียนทับไฟล์ ไม่งั้นไฟล์ที่ได้จะขาดคนเงียบๆ
  if (!cr.success || !customers.length) { console.error('ดึงลูกค้าไม่สำเร็จ: ' + (cr.message || cr.raw || 'ว่าง')); process.exit(1); }

  // ── 2) รหัสพื้นที่จาก xlsx ──
  const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
  const sheet = n => {
    if (!wb.Sheets[n]) { console.error('ไม่พบชีต ' + n + ' ในไฟล์ ' + XLSX_PATH); process.exit(1); }
    return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
  };
  const provName = {}, amphurName = {};
  sheet('province').forEach(r => { provName[S(r.ProvCode)] = S(r.ProvDesc); });
  sheet('amphur').forEach(r => { amphurName[S(r.ProvCode) + '|' + S(r.AmphurCode)] = S(r.AmphurDesc); });

  const src = {};
  sheet('customer').forEach(r => {
    const p = S(r.ProvCode), a = S(r.AmphurCode);
    src[S(r.CustNo)] = {
      addr1: S(r.Addr1), tumbol: S(r.Tumbol),
      amphur: amphurName[p + '|' + a] || '',
      province: provName[p] || ''
    };
  });

  // ── รวมสองแหล่ง ──
  let matched = 0, noArea = 0;
  const rows = customers.map(c => {
    const ext = S(c.externalCode);
    const a = src[ext];
    if (a) matched++; else noArea++;
    return {
      code: S(c.code), externalCode: ext,
      namePrefix: S(c.namePrefix), name: S(c.name), name2: S(c.name2),
      contactName: S(c.contactName), phone: S(c.phone),
      taxId: S(c.taxId), taxBranchCode: S(c.taxBranchCode),
      postcode: S(c.postcode), note: S(c.note),
      paymentTermsDays: Number(c.paymentTermsDays) || 0,
      creditLimit: Number(c.creditLimit) || 0,
      status: S(c.status), lastSaleAt: S(c.lastSaleAt),
      // ที่อยู่สามบรรทัดตามที่เจ้าของระบบกำหนด: ADDR01 = เลขที่+ถนน+ตำบล · ADDR02 = อำเภอ · ADDR03 = จังหวัด
      addr01: a ? [a.addr1, a.tumbol].filter(x => x && x !== '-').join(' ') : S(c.address),
      addr02: a ? a.amphur : '',
      addr03: a ? a.province : ''
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'armas_source.json'), JSON.stringify(rows, null, 1), 'utf8');

  const noAmphur = rows.filter(r => !r.addr02).length;
  console.log('ลูกค้าจาก prod (' + TENANT + '): ' + rows.length + ' ราย');
  console.log('จับคู่กับ xlsx ได้ ' + matched + ' · ไม่เจอ ' + noArea);
  console.log('ไม่มีชื่ออำเภอ/จังหวัด ' + noAmphur + ' ราย (ต้นทางไม่มีรหัสพื้นที่)');
  console.log('เขียน ' + path.join(OUT_DIR, 'armas_source.json'));
})();
