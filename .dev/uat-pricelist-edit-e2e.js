// ทดสอบปลายทางบน UAT: กรอก/แก้ชุดราคาเอง (createPriceList / clonePriceList / savePriceListLine / deletePriceListLine /
// savePriceListBillPromos) ผ่าน backend จริง — ต้องตั้ง UAT_URL (ห้ามชี้ production!)
// node .dev/uat-pricelist-edit-e2e.js
// ไม่แตะชุด active เดิม (แค่ยืนยันว่าแก้ไม่ได้) · สร้างเฉพาะชุดร่างของตัวเองแล้วลบทิ้งตอนจบ · ใช้สินค้าที่มีหน่วยหีบ factor เดิมอยู่แล้ว
// (ไม่ไปสร้าง product_units ใหม่บน UAT)
const URL_ = process.env.UAT_URL, USER = process.env.UAT_USER || 'admin', PASS = process.env.UAT_PASS || 'ChangeMe123!';
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (URL_.includes('AKfycbzDLcX5')) { console.error('นี่คือ URL production — ปฏิเสธ'); process.exit(1); }
const post = async body => { for (let i = 0; i < 3; i++) { try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' })).json(); } catch (e) { if (i === 2) throw e; } } };
let failed = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) failed++; };

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.success) { console.error('ล็อกอินไม่ได้: ' + login.message); process.exit(1); }
  const admin = (action, payload) => post({ action, token: login.token, payload: payload || {} });
  const created = [];
  try {
    const lists = (await admin('listPriceLists')).data || [];
    const active = lists.find(l => l.status === 'active' && l.lineCount > 0);
    if (!active) { console.error('UAT ไม่มีชุด active ที่มีรายการ — นำเข้าชุดราคาก่อน'); process.exit(1); }
    const src = await admin('getPriceList', { id: active.id });
    const srcLine = src.lines.find(l => l.tiers.length && l.caseFactor);
    const before = JSON.stringify(src.lines);

    // 1) ชุด active แก้ไม่ได้
    let r = await admin('savePriceListLine', { priceListId: active.id, lineId: srcLine.lineId, productIds: srcLine.products.map(p => p.productId), caseFactor: srcLine.caseFactor, tiers: [{ min: 1, max: null, cashInclVat: 1 }] });
    check('ชุด active: savePriceListLine ถูกปฏิเสธ', r.success === false, r);
    r = await admin('deletePriceListLine', { priceListId: active.id, lineId: srcLine.lineId });
    check('ชุด active: deletePriceListLine ถูกปฏิเสธ', r.success === false, r);
    r = await admin('savePriceListBillPromos', { priceListId: active.id, promos: [] });
    check('ชุด active: savePriceListBillPromos ถูกปฏิเสธ', r.success === false, r);
    check('  ราคาในชุด active ไม่เปลี่ยน', JSON.stringify((await admin('getPriceList', { id: active.id })).lines) === before);

    // 2) คัดลอกเป็นงวดใหม่
    r = await admin('clonePriceList', { id: active.id, name: 'E2E clone ' + Date.now(), validFrom: '2099-01-01', validTo: '2099-03-31' });
    check('clonePriceList → draft', r.success && r.list.status === 'draft' && r.list.lineCount === src.lines.length, r);
    if (r.success) created.push(r.id);
    const cloneId = r.id;
    let c = await admin('getPriceList', { id: cloneId });
    const strip = ls => ls.map(l => ({ p: l.products.map(x => x.productId), f: l.caseFactor, t: l.tiers.map(t => [t.min, t.max, t.cashInclVat, t.creditInclVat]), k: l.packs.map(p => [p.unitFactor, p.cashInclVat]) }));
    check('  รายการที่ก๊อปตรงกับต้นฉบับทุกขั้นราคา', JSON.stringify(strip(c.lines)) === JSON.stringify(strip(src.lines)));
    check('  โปรระดับบิลถูกก๊อป', JSON.stringify(c.billPromos) === JSON.stringify(src.billPromos));

    // 3) แก้ 1 รายการในชุดใหม่ (เปลี่ยนราคา) แล้วคิดราคาด้วย previewPricing
    const cl = c.lines.find(l => JSON.stringify(l.products.map(p => p.productId)) === JSON.stringify(srcLine.products.map(p => p.productId)));
    r = await admin('savePriceListLine', { priceListId: cloneId, lineId: cl.lineId, productIds: cl.products.map(p => p.productId), caseFactor: cl.caseFactor, listExVat: cl.listExVat,
      tiers: [{ min: 1, max: null, cashInclVat: 777, creditInclVat: 788 }], packs: [] });
    check('แก้รายการในชุดร่าง', r.success && r.line.lineId == cl.lineId && r.line.tiers[0].cashInclVat === 777, r);
    const pid = cl.products[0].productId;
    r = await admin('previewPricing', { priceListId: cloneId, paymentType: 'cash', isVan: false, items: [{ productId: pid, unitCode: 'CASE', qty: 3 }] });
    check('  previewPricing ใช้ราคาใหม่ 3 × 777', r.success && r.lines[0].unitPrice === 777 && r.lines[0].lineTotal === 2331, r);
    r = await admin('previewPricing', { priceListId: cloneId, paymentType: 'credit_term', isVan: false, items: [{ productId: pid, unitCode: 'CASE', qty: 1 }] });
    check('  เครดิต = 788', r.success && r.lines[0].unitPrice === 788, r);
    r = await admin('previewPricing', { priceListId: active.id, paymentType: 'cash', isVan: false, items: [{ productId: pid, unitCode: 'CASE', qty: 3 }] });
    check('  ชุด active ยังคิดราคาเดิม', r.success && r.lines[0].unitPrice !== 777, r);

    // 4) validation ผ่าน backend จริง
    r = await admin('savePriceListLine', { priceListId: cloneId, productIds: [pid], caseFactor: cl.caseFactor, tiers: [{ min: 1, max: null, cashInclVat: 1 }] });
    check('สินค้าซ้ำกับรายการอื่นในชุด → ปฏิเสธ', r.success === false && /รายการอื่น/.test(r.message), r);
    r = await admin('savePriceListLine', { priceListId: cloneId, lineId: cl.lineId, productIds: [pid], caseFactor: cl.caseFactor, tiers: [{ min: 1, max: 5, cashInclVat: 1 }, { min: 5, max: null, cashInclVat: 1 }] });
    check('ขั้นทับกัน → ปฏิเสธ', r.success === false, r);

    // 5) โปรระดับบิล + ลบรายการ
    r = await admin('savePriceListBillPromos', { priceListId: cloneId, promos: [{ minAmountExVat: 90000, percent: 1.5 }] });
    check('บันทึกโปรระดับบิล', r.success && r.billPromos.length === 1, r);
    r = await admin('deletePriceListLine', { priceListId: cloneId, lineId: cl.lineId });
    check('ลบรายการ', r.success, r);
    c = await admin('getPriceList', { id: cloneId });
    check('  เหลือรายการ ' + (src.lines.length - 1) + ' + โปร 1 ขั้น', c.lines.length === src.lines.length - 1 && c.billPromos.length === 1 && c.billPromos[0].percent === 1.5, { lines: c.lines.length, promos: c.billPromos });

    // 6) ชุดเปล่า
    r = await admin('createPriceList', { name: 'E2E empty ' + Date.now(), customerGroupId: active.customerGroupId, validFrom: '2099-04-01', validTo: '2099-06-30' });
    check('createPriceList ชุดเปล่า', r.success && r.list.status === 'draft' && r.list.lineCount === 0, r);
    if (r.success) created.push(r.id);
    r = await admin('savePriceListLine', { priceListId: r.id, productIds: srcLine.products.map(p => p.productId), caseFactor: srcLine.caseFactor, tiers: [{ min: 1, max: null, cashInclVat: 500 }] });
    check('  เพิ่มรายการขั้นเดียว (แบบราคาศูนย์)', r.success && r.line.tiers.length === 1 && !(r.warnings || []).length, r);
  } finally {
    for (const id of created) { const d = await admin('deletePriceList', { id }); check('ลบชุดทดสอบ #' + id, d.success, d); }
    await post({ action: 'adminLogout', token: login.token });
  }
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
