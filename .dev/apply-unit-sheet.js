/**
 * อัปเดตข้อมูลหน่วยขายของสินค้า (factor / ราคาก่อน VAT ต่อหน่วย) + ราคาฐานต่อลัง จากชีต `unitofitem`
 * ใน reference/customer_for_bdc.xlsx (เจ้าของระบบยืนยันว่าข้อมูลถูกต้อง — 3 ต.ค. 2026)
 *
 *   BACKEND_URL='<exec url>' ADMIN_USER='<username>' ADMIN_PASS='<รหัสผ่าน>' node .dev/apply-unit-sheet.js [--commit]
 *   REFERENCE_DIR=<พาธโฟลเดอร์ reference>   (ปกติมีแค่ฝั่ง Drive)
 *   ไม่ใส่ --commit = ดูอย่างเดียว · รันซ้ำได้ (แก้เฉพาะที่ต่างจากชีต)
 *
 * กติกา
 *  - จับคู่สินค้าด้วย product_code = ItemCode เท่านั้น (สินค้าที่ไม่อยู่ในชีตไม่ถูกแตะ)
 *  - หน่วย CT (ลัง) และ PK (แพ็ค): ตั้ง factor + ราคา (UnitPrice = ราคาก่อน VAT ต่อหน่วย) + ชื่อหน่วยปกติ
 *    (ตัดคำเตือน "ยังไม่ยืนยันขนาดบรรจุ" ออก เพราะเจ้าของระบบยืนยันข้อมูลชุดนี้แล้ว) · ไม่มีแถวหน่วยนั้นก็เพิ่มให้
 *    ราคา 0 ในชีต = ไม่ทับราคาเดิม (แต่ factor ยังตั้งให้)
 *  - PC (ชิ้น) เป็นหน่วยฐาน ไม่มีแถวใน product_units อยู่แล้ว → ไม่แตะ · UN/แถวว่าง ข้าม
 *  - products.base_price = ราคา CT ก่อน VAT (= ราคาฐานต่อลัง) — ราคาในชีตตรงกับราคาตั้ง (ไม่รวม VAT) ของชุดราคา
 *    ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้ งวด ต.ค.-ธ.ค. 2026 ทุกรายการที่เทียบแล้ว
 */
const fs = require('fs'), path = require('path');
const XLSX = require('./xlsx.full.min.js');

const COMMIT = process.argv.includes('--commit');
const URL_ = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!URL_ || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const round2 = n => Math.round(n * 100) / 100;
const LABEL = { CT: 'ลัง', PK: 'แพ็ค' };
const norm = c => { const x = String(c || '').trim().toUpperCase(); return { CASE: 'CT', PACK: 'PK', PCS: 'PC' }[x] || x; };

async function post(body) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
      return JSON.parse(await res.text());
    } catch (e) { last = e; await wait(3000 * (i + 1)); }
  }
  throw last;
}

function readSheet() {
  const dir = process.env.REFERENCE_DIR || path.join(__dirname, '..', 'reference');
  const wb = XLSX.read(fs.readFileSync(path.join(dir, 'customer_for_bdc.xlsx')), { type: 'buffer' });
  const ws = wb.Sheets['unitofitem'];
  if (!ws) throw new Error('ไม่พบชีต unitofitem');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const val = (r, c) => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; return cell ? cell.v : undefined; };
  const byCode = {};
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const code = String(val(r, 0) || '').trim(), unit = norm(val(r, 1));
    if (!code || (unit !== 'CT' && unit !== 'PK')) continue;
    const factor = Number(val(r, 2)) || 0, price = Number(val(r, 3)) || 0;
    if (!(factor > 0)) continue;
    (byCode[code] = byCode[code] || {})[unit] = { factor, price: round2(price) };
  }
  return byCode;
}

(async () => {
  const sheet = readSheet();
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.token) throw new Error('ล็อกอินไม่สำเร็จ: ' + JSON.stringify(login).slice(0, 200));
  const call = (action, payload) => post({ action, token: login.token, payload: payload || {} });

  const prods = await call('listProductsAdmin'); if (!prods.success) throw new Error('listProductsAdmin: ' + prods.message);
  const units = await call('listProductUnits'); if (!units.success) throw new Error('listProductUnits: ' + units.message);
  const unitOf = {};
  units.data.forEach(u => { unitOf[String(u.product_id) + '_' + norm(u.unit_code)] = u; });

  const ops = [];   // { label, run }
  let matched = 0, noData = [];
  prods.data.forEach(p => {
    const e = sheet[String(p.product_code).trim()];
    if (!e) { noData.push(p.product_code); return; }
    matched++;
    const ct = e.CT;
    if (ct && ct.price > 0 && Math.abs((Number(p.base_price) || 0) - ct.price) > 0.004)
      ops.push({ label: `${p.product_code} ราคาฐานต่อลัง ${p.base_price || 0} → ${ct.price}`, run: () => call('updateProduct', { id: p.record_id, basePrice: ct.price }) });
    ['CT', 'PK'].forEach(code => {
      const want = e[code]; if (!want) return;
      const cur = unitOf[String(p.record_id) + '_' + code];
      if (!cur) {
        ops.push({ label: `${p.product_code} เพิ่มหน่วย ${code} ×${want.factor} @${want.price}`,
          run: () => call('addProductUnit', { productId: p.record_id, unitCode: code, unitLabel: LABEL[code], unitFactor: want.factor, price: want.price }) });
        return;
      }
      const patch = {}, diff = [];
      if (Number(cur.unit_factor) !== want.factor) { patch.unitFactor = want.factor; diff.push(`factor ${cur.unit_factor}→${want.factor}`); }
      if (want.price > 0 && Math.abs((Number(cur.price) || 0) - want.price) > 0.004) { patch.price = want.price; diff.push(`ราคา ${cur.price || 0}→${want.price}`); }
      if (cur.unit_label !== LABEL[code]) { patch.unitLabel = LABEL[code]; diff.push(`ชื่อ "${cur.unit_label}"→"${LABEL[code]}"`); }
      if (cur.is_active === false || String(cur.is_active).toUpperCase() === 'FALSE') { patch.isActive = 'TRUE'; diff.push('เปิดใช้งาน'); }
      if (diff.length) ops.push({ label: `${p.product_code} ${code}: ${diff.join(', ')}`, run: () => call('updateProductUnit', Object.assign({ id: cur.record_id }, patch)) });
    });
  });
  console.log('สินค้าในระบบ', prods.data.length, '· จับคู่กับชีตได้', matched, '· ไม่อยู่ในชีต', noData.length, noData.length ? '(' + noData.join(', ') + ')' : '');
  console.log('รายการที่ต้องแก้:', ops.length);
  ops.forEach(o => console.log('  ' + o.label));
  if (!COMMIT) { console.log('\n(ดูอย่างเดียว — ใส่ --commit เพื่อบันทึกจริง)'); return; }

  let i = 0, ok = 0; const bad = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < ops.length) {
      const o = ops[i++];
      try { const r = await o.run(); if (r && r.success) ok++; else bad.push(o.label + ' → ' + (r && r.message)); }
      catch (e) { bad.push(o.label + ' → ' + e.message); }
    }
  }));
  console.log('\nสำเร็จ', ok, '/', ops.length, bad.length ? '\nล้มเหลว:\n' + bad.join('\n') : '');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
