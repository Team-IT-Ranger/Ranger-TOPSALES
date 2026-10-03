// เพิ่มราคา Pao Pao (ใบรายการขายผ้าอ้อมเปาเปา พ.ย.-ธ.ค. 2026 "สำหรับร้านค้าทั่วไป") เข้าชุดราคาร้านค้า Q4 ของกลุ่มที่ BDC ใช้ + ให้สิทธิ์ BDC
//   node .dev/add-paopao-price-lines.js            ← ดูอย่างเดียว
//   node .dev/add-paopao-price-lines.js --commit   ← เขียนจริง
// env: BACKEND_URL, ADMIN_USER, ADMIN_PASS   (ต้องเป็นแอดมินฝั่งบริษัท · ห้ามชี้ prod/uat ผิดตัว — ตรวจ URL ก่อนรัน)
// ทำไมเพิ่มเข้าชุดเดิมแทนสร้างชุด Pao Pao ใหม่: ร้านหนึ่งได้ "ชุดราคาเดียว" (resolvePriceListForCustomer เลือกชุดเดียวตาม priority → valid_from → id)
//   สร้างชุดแยกสำหรับกลุ่มเดียวกัน = ชุดใหม่ชนะ แล้วสินค้ายาจุดยุง/สเปรย์ขายไม่ได้ทั้งหมด (สินค้านอกชุดที่ชนะขายไม่ได้)
// ราคา = รวม VAT ต่อลัง ขั้น 1-3 / 4-9 / 10-29 / 30+ ลัง · 1 ลัง (CT) = 6 / 8 / 4 แพ็ค (PK) = 6 / 8 / 4 ชิ้น (PC) ตามกลุ่ม
// แถวแพ็ค (PK, factor 1 = 1 PC): ราคาแพ็ค = ราคาลังขั้น 1 ÷ จำนวนแพ็คต่อลัง · ขายเฉพาะรถ+เงินสดตามกติกาแพ็คของระบบ (ตรงกับแถว "ขายแยกหน่วยแพ็ค" ในใบราคา)
const URL = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
const COMMIT = process.argv.includes('--commit');
if (!URL || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }

const T = (min, max, cash, credit) => ({ min, max, cashInclVat: cash, creditInclVat: credit,
  label: 'ซื้อ ' + (max ? (min === max ? min : min + ' - ' + max) : min + ' ลังขึ้นไป') + (max ? ' ลัง' : '') });
const LINES = [
  { name: 'Mini', codes: ['10257', '10258', '10259'], caseFactor: 6, listExVat: 403.74, suggestedPack: 60, retailPiece: 18,
    tiers: [T(1, 3, 372, 382), T(4, 9, 360, 370), T(10, 29, 348, 358), T(30, null, 336, 346)],
    pack: { cashInclVat: 62, listExVat: 67.29 } },
  { name: 'Regular', codes: ['10263', '10264', '10265'], caseFactor: 8, listExVat: 1069.16, suggestedPack: null, retailPiece: 79,
    tiers: [T(1, 3, 496, 506), T(4, 9, 480, 490), T(10, 29, 456, 466), T(30, null, 432, 442)],
    pack: { cashInclVat: 62, listExVat: 133.64 } },
  { name: 'Jumbo', codes: ['10267', '10268', '10269', '10270'], caseFactor: 4, listExVat: 1342.06, suggestedPack: null, retailPiece: 269,
    tiers: [T(1, 3, 1056, 1066), T(4, 9, 1016, 1026), T(10, 29, 976, 986), T(30, null, 936, 946)],
    pack: { cashInclVat: 264, listExVat: 335.51 } }
];

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
  if (!login.token) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 200));
  const token = login.token;
  const call = (action, payload) => post({ action, token, payload: payload || {} });

  // 1) ชุดราคาปลายทาง = ชุด active ของกลุ่ม "ร้านค้า เหนือ…ใต้" ที่ครอบ 2026-12-31 (กลุ่มที่ร้าน BDC อยู่)
  const lists = (await call('listPriceLists')).data || [];
  const targets = lists.filter(l => l.status === 'active' && /^ร้านค้า เหนือ/.test(l.customerGroupName) && l.validTo >= '2026-12-31');
  if (targets.length !== 1) throw new Error('ชุดปลายทางต้องมี 1 ชุด แต่เจอ ' + targets.length + ': ' + targets.map(l => l.id + ' ' + l.name).join(' | '));
  const list = targets[0];
  console.log('ชุดปลายทาง:', list.id, list.name, '(กลุ่ม', list.customerGroupId + ')');

  const products = (await call('listProductsAdmin')).data || [];
  const idOf = {}; products.forEach(p => { idOf[String(p.product_code)] = p.record_id; });
  const detail = await call('getPriceList', { id: list.id });
  const have = new Set(); (detail.lines || []).forEach(l => l.products.forEach(p => have.add(String(p.productCode))));

  for (const ln of LINES) {
    const missing = ln.codes.filter(c => !idOf[c]);
    if (missing.length) { console.log('  ข้าม', ln.name, '— ไม่มีสินค้ารหัส', missing.join(',')); continue; }
    const existing = (detail.lines || []).find(l => l.products.some(p => ln.codes.includes(String(p.productCode))));
    if (existing && (existing.packs || []).length) { console.log('  ข้าม', ln.name, '— มีในชุดพร้อมแถวแพ็คแล้ว'); continue; }
    const payload = { priceListId: list.id, productIds: ln.codes.map(c => idOf[c]), caseFactor: ln.caseFactor, listExVat: ln.listExVat,
      tiers: ln.tiers, packs: [{ factor: 1, cashInclVat: ln.pack.cashInclVat, listExVat: ln.pack.listExVat, note: '(ขายเฉพาะหน่วยรถ) แพ็ค' }],
      suggestedPack: ln.suggestedPack, retailPiece: ln.retailPiece };
    if (existing) payload.lineId = existing.lineId;   // มีแล้วแต่ยังไม่มีแถวแพ็ค → เขียนทับทั้ง line
    console.log('  ' + (COMMIT ? (existing ? 'อัปเดต' : 'เพิ่ม') : '(ดูเฉยๆ) จะ' + (existing ? 'อัปเดต' : 'เพิ่ม')), ln.name, ln.codes.join(','), '× ลังละ', ln.caseFactor, '→', ln.tiers.map(t => t.min + '+:' + t.cashInclVat + '/' + t.creditInclVat).join(' '), '| แพ็ค', ln.pack.cashInclVat);
    if (COMMIT) { const r = await call('savePriceListLine', payload); if (!r.success) throw new Error(ln.name + ': ' + r.message); (r.warnings || []).forEach(w => console.log('    เตือน:', w)); }
  }

  // 2) สิทธิ์ BDC ใช้ชุดนี้ (ชั้น A — จ่ายชุดให้ตัวแทน) · เขียนทับทั้งก้อน จึงต้องรวมของเดิมไว้ด้วย
  const pk = await call('listPackageTenants', { packageType: 'price_list', packageId: list.id });
  const assigned = (pk.assigned || []).map(x => String(x.tenantId || x));
  console.log('ตัวแทนที่ได้ชุดนี้อยู่แล้ว:', assigned.join(',') || '(ไม่มี)');
  if (!assigned.includes('BDC')) {
    console.log('  ' + (COMMIT ? 'เพิ่ม' : '(ดูเฉยๆ) จะเพิ่ม') + ' BDC');
    if (COMMIT) { const r = await call('savePackageTenants', { packageType: 'price_list', packageId: list.id, tenantIds: assigned.concat('BDC') }); if (!r.success) throw new Error('savePackageTenants: ' + r.message); }
  }
  console.log(COMMIT ? 'เสร็จ' : 'ดูอย่างเดียว — ใส่ --commit เพื่อเขียนจริง');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
