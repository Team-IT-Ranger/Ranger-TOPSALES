// ดึงข้อมูลจาก prod (อ่านอย่างเดียว) ไปให้ build_dbf.py ใช้ → .dev/express-dbf/data/ (ไม่ commit)
//   BACKEND_URL='<prod exec url>' ADMIN_USER=... ADMIN_PASS=... node .dev/express-dbf/fetch-prod-data.js
// ได้ prod_products.json (สินค้า+หน่วย+รายการชุดราคา) และ pl_prod_<id>_full.json ของทุกชุดที่ active — build_dbf.py ใช้ชุด 5 (ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้ ที่ BDC ใช้)
//   ⚠ id ของชุดราคาเปลี่ยนตาม env/งวด — ถ้างวดใหม่ ให้แก้เลข 5 ใน build_dbf.py ให้ตรงชุดที่ BDC ใช้
const fs = require('fs'), path = require('path');
const URL = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!URL || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }
const OUT = path.join(__dirname, 'data'); fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function post(body, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }); return JSON.parse(await r.text()); }
    catch (e) { last = e; await wait(3000 * (i + 1)); }
  }
  throw last;
}
(async () => {
  const l = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!l.token) throw new Error('login failed');
  const call = (action, payload) => post({ action, token: l.token, payload: payload || {} });
  const p = await call('listProductsAdmin'), u = await call('listProductUnits'), lists = await call('listPriceLists');
  if (!p.success || !u.success || !lists.success) throw new Error('คำตอบจาก backend ไม่สมบูรณ์ (อาจสะดุด) — ลองใหม่');
  fs.writeFileSync(path.join(OUT, 'prod_products.json'), JSON.stringify({ products: p.data, units: u.data, lists: lists.data }));
  for (const x of lists.data.filter(x => x.status === 'active')) {
    const d = await call('getPriceList', { id: x.id });
    fs.writeFileSync(path.join(OUT, 'pl_prod_' + x.id + '_full.json'), JSON.stringify(d));
    console.log('ชุด', x.id, x.name);
  }
  console.log('สินค้า', p.data.length, 'หน่วย', u.data.length, '→', OUT);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
