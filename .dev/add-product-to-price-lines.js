/**
 * เพิ่มสินค้าตัวใหม่เข้า "line" เดียวกับสินค้าตัวที่ใช้ราคาเดียวกัน ในชุดราคาทุกชุดของงวดที่ระบุ (3 ต.ค. 2026: 10504 เข้า line ของ 10503 ใน Q4 บน prod)
 *
 *   BACKEND_URL=… ADMIN_USER=… ADMIN_PASS=…  node .dev/add-product-to-price-lines.js <รหัสสินค้าใหม่> <รหัสสินค้าที่ใช้ราคาเดียวกัน> <ช่วงในชื่อชุด เช่น 2026-10-01..2026-12-31> [--commit]
 *   ไม่ใส่ --commit = ดูอย่างเดียว · รันซ้ำได้ (ชุดที่มีสินค้านั้นอยู่แล้วข้าม)
 *
 * ใช้ savePriceListLine เขียน line เดิมใหม่ทั้งก้อนด้วยค่าเดิมทุกช่อง (ขั้นราคา/แพ็ค/ราคาตั้ง/ราคาแนะนำ/ปลีก) + productIds เพิ่มอีกตัว
 * แล้วอ่านกลับเทียบว่าราคาไม่เปลี่ยนแม้แต่ช่องเดียว · ชุดที่ใช้งานอยู่แก้ได้ (มี price_list_change_log บันทึก) · archived ข้าม
 */
const COMMIT = process.argv.includes('--commit');
const [NEW_CODE, LIKE_CODE, PERIOD] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const URL_ = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!URL_ || !USER || !PASS || !NEW_CODE || !LIKE_CODE || !PERIOD) { console.error('ต้องตั้ง BACKEND_URL/ADMIN_USER/ADMIN_PASS และระบุ <รหัสใหม่> <รหัสที่ใช้ราคาเดียวกัน> <ช่วง>'); process.exit(1); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function post(body) {
  let last;
  for (let i = 0; i < 5; i++) {
    try { const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }); return JSON.parse(await res.text()); }
    catch (e) { last = e; await wait(3000 * (i + 1)); }
  }
  throw last;
}
const strip = L => JSON.stringify({ t: L.tiers.map(t => [t.min, t.max, t.cashInclVat, t.creditInclVat, t.label, t.listExVat]), p: L.packs.map(p => [p.unitFactor, p.cashInclVat, p.listExVat, p.label]), f: L.caseFactor, l: L.listExVat, s: L.suggestedPack, r: L.retailPiece });

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.token) throw new Error('ล็อกอินไม่สำเร็จ');
  const call = (action, payload) => post({ action, token: login.token, payload: payload || {} });
  const prods = await call('listProductsAdmin');
  const np = prods.data.find(p => String(p.product_code).trim() === NEW_CODE);
  if (!np) throw new Error('ไม่พบสินค้า ' + NEW_CODE);
  const lists = (await call('listPriceLists')).data.filter(l => l.name.includes(PERIOD) && l.status !== 'archived');
  console.log('ชุดราคาที่เกี่ยวข้อง', lists.length);
  let changed = 0, bad = 0;
  for (const l of lists) {
    const d = await call('getPriceList', { id: l.id });
    const L = d.lines.find(x => x.products.some(p => String(p.productCode) === LIKE_CODE));
    if (!L) { console.log(`- [${l.id}] ${l.name}: ไม่มีสินค้า ${LIKE_CODE} ข้าม`); continue; }
    if (L.products.some(p => String(p.productCode) === NEW_CODE)) { console.log(`= [${l.id}] ${l.name}: มี ${NEW_CODE} อยู่แล้ว`); continue; }
    if (d.lines.some(x => x.products.some(p => String(p.productCode) === NEW_CODE))) { console.log(`! [${l.id}] ${l.name}: ${NEW_CODE} อยู่ line อื่นแล้ว ข้าม`); bad++; continue; }
    console.log(`+ [${l.id}] ${l.name}: line ${L.lineId} (${L.products.map(p => p.productCode).join('/')}) + ${NEW_CODE}`);
    changed++;
    if (!COMMIT) continue;
    const payload = {
      priceListId: l.id, lineId: L.lineId, productIds: L.products.map(p => p.productId).concat([np.record_id]),
      caseFactor: L.caseFactor, listExVat: L.listExVat, suggestedPack: L.suggestedPack, retailPiece: L.retailPiece,
      tiers: L.tiers.map(t => ({ min: t.min, max: t.max, cashInclVat: t.cashInclVat, creditInclVat: t.creditInclVat, label: t.label })),
      packs: L.packs.map(p => ({ factor: p.unitFactor, cashInclVat: p.cashInclVat, listExVat: p.listExVat, note: p.label }))
    };
    const r = await call('savePriceListLine', payload);
    if (!r.success) { console.log('   ✗ ' + r.message); bad++; continue; }
    const after = (await call('getPriceList', { id: l.id })).lines.find(x => x.lineId === L.lineId || x.products.some(p => String(p.productCode) === NEW_CODE));
    const ok = after && strip(after) === strip(L) && after.products.some(p => String(p.productCode) === NEW_CODE) && after.products.some(p => String(p.productCode) === LIKE_CODE);
    console.log(ok ? '   ✓ บันทึกแล้ว ราคาเหมือนเดิมทุกช่อง' : '   ✗ อ่านกลับแล้วไม่ตรง — ตรวจด้วยมือ');
    if (!ok) bad++;
  }
  console.log(`\nเพิ่ม ${changed} ชุด · ผิดพลาด ${bad}` + (COMMIT ? '' : ' — โหมดดูอย่างเดียว ใส่ --commit เพื่อบันทึกจริง'));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
