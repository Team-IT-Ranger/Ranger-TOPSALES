// แก้หน่วยของกาวดักแมลงวัน 10503/10504: 1 CT = 10 PK = 50 PC (1 PK = 5 PC) — เจ้าของระบบยืนยัน 3 ต.ค. 2026
//   เดิมระบบมี CT=500 / PK=50 (มาจากชีต unitofitem ที่นับเป็น "แผ่น") แต่ร้านค้าขายที่หน่วย "ซองเล็ก" = PC
//   node .dev/fix-glue-units.js            ← ดูอย่างเดียว
//   node .dev/fix-glue-units.js --commit   ← เขียนจริง
// env: BACKEND_URL, ADMIN_USER, ADMIN_PASS
// 1) product_units: CT factor 50, PK factor 5 (ราคาหน่วยไม่เปลี่ยน — ราคาต่อลัง/ต่อแพ็คเท่าเดิม)
// 2) ชุดราคาที่ยังใช้ได้อยู่ (ไม่หมดอายุ): เขียน line เดิมซ้ำด้วย caseFactor 50 / แพ็ค factor 5 — ขั้นราคา/ราคา/ราคาแนะนำคงเดิมทุกตัว
//    ชุดที่หมดอายุแล้ว (Q3) ไม่แตะ เป็นบันทึกของงวดเก่า · ค่า factor ในชุดราคาใช้แสดงผล การขายตัดสต็อกอ่านจาก product_units
const URL = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
const COMMIT = process.argv.includes('--commit');
if (!URL || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }
const CODES = ['10503', '10504'], CT = 50, PK = 5;
const today = new Date().toISOString().slice(0, 10);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function post(body, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
      return JSON.parse(await res.text());
    } catch (e) { last = e; await wait(3000 * (i + 1)); }
  }
  throw last;
}
(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.token) throw new Error('login failed');
  const call = (action, payload) => post({ action, token: login.token, payload: payload || {} });

  const products = (await call('listProductsAdmin')).data || [];
  const ids = {}; products.filter(p => CODES.includes(String(p.product_code))).forEach(p => { ids[p.record_id] = String(p.product_code); });
  if (Object.keys(ids).length !== CODES.length) throw new Error('ไม่พบสินค้า ' + CODES.join(',') + ' (คำตอบจาก backend อาจสะดุด — ลองใหม่)');
  const unitsRes = await call('listProductUnits');
  if (!unitsRes.success) throw new Error('listProductUnits ล้มเหลว: ' + (unitsRes.message || JSON.stringify(unitsRes).slice(0, 120)));
  const units = unitsRes.data || [];
  for (const u of units) {
    if (!(u.product_id in ids) || (u.unit_code !== 'CT' && u.unit_code !== 'PK')) continue;
    const want = u.unit_code === 'CT' ? CT : PK;
    if (Number(u.unit_factor) === want) { console.log(ids[u.product_id], u.unit_code, 'factor', want, 'ถูกอยู่แล้ว'); continue; }
    console.log(ids[u.product_id], u.unit_code, 'factor', u.unit_factor, '→', want, COMMIT ? '' : '(ดูเฉยๆ)');
    if (COMMIT) { const r = await call('updateProductUnit', { id: u.record_id, unitFactor: want }); if (!r.success) throw new Error(r.message); }
  }

  const listsRes = await call('listPriceLists');
  if (!listsRes.success) throw new Error('listPriceLists ล้มเหลว');
  const lists = (listsRes.data || []).filter(l => (l.status === 'active' || l.status === 'draft') && l.validTo >= today);
  for (const l of lists) {
    const d = await call('getPriceList', { id: l.id });
    for (const ln of (d.lines || [])) {
      if (!ln.products.some(p => CODES.includes(String(p.productCode)))) continue;
      const packs = (ln.packs || []).map(k => ({ factor: PK, cashInclVat: k.cashInclVat, listExVat: k.listExVat, note: k.label }));
      const same = Number(ln.caseFactor) === CT && (ln.packs || []).every(k => Number(k.unitFactor) === PK);
      console.log('ชุด', l.id, l.name.slice(0, 40), '| line', ln.lineId, ln.products.map(p => p.productCode).join(','), '| caseFactor', ln.caseFactor, '→', CT, '| packs', (ln.packs || []).map(k => k.unitFactor).join(',') || '-', same ? '(ถูกอยู่แล้ว)' : '');
      if (same || !COMMIT) continue;
      const r = await call('savePriceListLine', { priceListId: l.id, lineId: ln.lineId, productIds: ln.products.map(p => p.productId), caseFactor: CT, listExVat: ln.listExVat,
        tiers: ln.tiers.map(t => ({ min: t.min, max: t.max, cashInclVat: t.cashInclVat, creditInclVat: t.creditInclVat, label: t.label })),
        packs, suggestedPack: ln.suggestedPack, retailPiece: ln.retailPiece });
      if (!r.success) throw new Error('savePriceListLine ชุด ' + l.id + ': ' + r.message);
      (r.warnings || []).forEach(w => console.log('   เตือน:', w));
    }
  }
  console.log(COMMIT ? 'เสร็จ' : 'ดูอย่างเดียว — ใส่ --commit เพื่อเขียนจริง');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
