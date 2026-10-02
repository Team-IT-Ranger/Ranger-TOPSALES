/**
 * ตั้งหน่วยขาย (sales_unit_code) และหน่วยซื้อ (purchase_unit_code) ตั้งต้นของ "ทุกสินค้า" เป็นหน่วยลัง (CT)
 * (เจ้าของระบบสั่ง 2 ต.ค. 2026 — ทั้ง UAT และ prod)
 *
 *   BACKEND_URL='<exec url>' ADMIN_USER='<username>' ADMIN_PASS='<รหัสผ่าน>' node .dev/set-default-trade-units.js [--commit]
 *   ไม่ใส่ --commit = ดูอย่างเดียว · รันซ้ำได้ (ข้ามสินค้าที่ตั้งเป็น CT แล้ว)
 *
 * ใช้เฉพาะ action ที่มีอยู่แล้ว (updateProduct / addProductUnit) ไม่ต้อง deploy backend ใหม่
 * สินค้าที่ยังไม่มีแถวหน่วย CT ใน product_units จะถูกเติมให้ก่อน (factor 1 + ชื่อหน่วยเขียนเตือน "ยังไม่ยืนยันขนาดบรรจุ"
 * เหมือน ensureDefaultSalesUnit) — ตั้งหน่วยตั้งต้นเป็น CT ทั้งที่ไม่มีแถว CT จะทำให้เปิดบิล/ใบสั่งซื้อหาหน่วยไม่เจอ
 */
const COMMIT = process.argv.includes('--commit');
const URL_ = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!URL_ || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const UNCONFIRMED = 'ลัง (ยังไม่ยืนยันขนาดบรรจุ)';

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
const norm = c => { const x = String(c || '').toUpperCase(); return { CASE: 'CT', PACK: 'PK', PCS: 'PC', SHEET: 'PC' }[x] || x; };

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.token) throw new Error('ล็อกอินไม่สำเร็จ: ' + JSON.stringify(login).slice(0, 200));
  const call = (action, payload) => post({ action, token: login.token, payload: payload || {} });

  const prods = await call('listProductsAdmin');
  if (!prods.success) throw new Error('listProductsAdmin: ' + prods.message);
  const units = await call('listProductUnits');
  if (!units.success) throw new Error('listProductUnits: ' + units.message);
  const hasCt = {};
  units.data.forEach(u => { if (norm(u.unit_code) === 'CT') hasCt[String(u.product_id)] = true; });

  const needUnit = prods.data.filter(p => !hasCt[String(p.record_id)]);
  const needDefault = prods.data.filter(p => norm(p.sales_unit_code) !== 'CT' || norm(p.purchase_unit_code) !== 'CT');
  console.log('สินค้าทั้งหมด', prods.data.length, '· ยังไม่มีแถวหน่วย CT', needUnit.length, '· ต้องตั้งหน่วยซื้อ/ขายเป็น CT', needDefault.length);
  if (!COMMIT) { console.log('(ดูอย่างเดียว — ใส่ --commit เพื่อบันทึกจริง)'); return; }

  async function pool(items, n, fn) {
    let i = 0, ok = 0, bad = [];
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < items.length) {
        const it = items[i++];
        try { const r = await fn(it); if (r && r.success) ok++; else bad.push({ id: it.record_id, msg: r && r.message }); }
        catch (e) { bad.push({ id: it.record_id, msg: e.message }); }
      }
    }));
    return { ok, bad };
  }
  const a = await pool(needUnit, 4, p => call('addProductUnit', { productId: p.record_id, unitCode: 'CT', unitLabel: UNCONFIRMED, unitFactor: 1, price: Number(p.base_price) || 0 }));
  console.log('เติมแถวหน่วย CT:', a.ok, 'สำเร็จ', a.bad.length ? JSON.stringify(a.bad) : '');
  const b = await pool(needDefault, 4, p => call('updateProduct', { id: p.record_id, salesUnitCode: 'CT', purchaseUnitCode: 'CT' }));
  console.log('ตั้งหน่วยซื้อ/ขายเป็น CT:', b.ok, 'สำเร็จ', b.bad.length ? JSON.stringify(b.bad) : '');

  const after = await call('listProductsAdmin');
  const left = after.data.filter(p => norm(p.sales_unit_code) !== 'CT' || norm(p.purchase_unit_code) !== 'CT');
  console.log('ตรวจซ้ำ: เหลือที่ยังไม่เป็น CT', left.length);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
