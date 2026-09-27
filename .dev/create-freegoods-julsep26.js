/**
 * สร้างชุดแถมจากใบอนุมัติ reference/Promotion Jul-Sep'26.pdf เข้าสภาพแวดล้อมที่ระบุ
 *
 *   BACKEND_URL='<exec url>' ADMIN_TOKEN='<token>' node .dev/create-freegoods-julsep26.js [--commit] [--tenant BDC]
 *   ไม่ใส่ --commit = ดูอย่างเดียว
 *
 * ★ สร้างเป็นสถานะ "ร่าง" เสมอ — ช่วงเวลาตามใบอนุมัติคือ ก.ค.-ส.ค. 2569 ซึ่งผ่านไปแล้ว
 *   เปิดใช้งานเองจะไม่มีผลอะไร และถ้าวันหนึ่งมีคนแก้วันที่โดยไม่ดูให้ดี ของจะไหลออกทันที
 *
 * ★ "กล่อง"/"กระป๋อง" ในใบอนุมัติ = หน่วยฐานของสินค้านั้น (ระบบมี 3 หน่วย CT/PK/PC เท่านั้น)
 *   Pet 24 ขด: 1 ลัง = 30 กล่อง · Pet 40 ขด: 1 ลัง = 12 กระป๋อง — ตรวจจาก product_units จริงก่อนใช้
 *   ไม่ใช่เดาเอง เพราะแถมผิดหน่วยคือของออกจากคลังผิดจำนวนเป็นสิบเท่า
 */
const COMMIT = process.argv.includes('--commit');
const _ti = process.argv.indexOf('--tenant');
const TENANT = (_ti !== -1 && process.argv[_ti + 1]) ? process.argv[_ti + 1] : 'BDC';
const ENDPOINT = process.env.BACKEND_URL, TOKEN = process.env.ADMIN_TOKEN;
if (!ENDPOINT || !TOKEN) { console.error('ต้องตั้ง BACKEND_URL และ ADMIN_TOKEN'); process.exit(1); }

const wait = ms => new Promise(r => setTimeout(r, ms));
const call = async (action, payload) => {
  for (let i = 1; i <= 3; i++) {
    let t;
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: TOKEN, payload: payload || {} }) });
      t = await res.text();
      return JSON.parse(t);
    } catch (e) {
      if (i === 3) return { success: false, message: 'ตอบกลับไม่ใช่ JSON: ' + String(t || e).slice(0, 140) };
      await wait(4000 * i);
    }
  }
};
const die = m => { console.error('\n✗ ' + m); process.exit(1); };

/* ตระกูลสินค้าตามที่ใบอนุมัติเรียก → ชื่อสินค้าในระบบ */
const FAMILY = {
  '12hrs':   /สเก้าท์\s*1\s*12\s*ชม|สเก้าท์1\s*12ชม/,
  'extreme': /เอ็กซ์ตรีม|เอ๊กตรีม/,
  'pet24':   /สเก้าท์พี.*24\s*ขด/,
  'pet40':   /สเก้าท์พี.*40\s*ขด/,
  'dryspray': /ดรายสเปรย์/
};

/* ใบอนุมัติ: หมวด Sales out (on invoice) — หมวด Offtake ไม่อยู่ในนี้เพราะระบุว่า "ไม่ใช่รายการ on invoice" */
const PLAN = [
  { key: '12hrs', name: 'Sales out: Ranger 12hrs (1-31 ก.ค. 69)', from: '2026-07-01', to: '2026-07-31',
    group: '12hrs-FOC', freeFrom: '12hrs',
    tiers: [ { min: 12, minU: 'CT', qty: 1, u: 'CT', note: 'ซื้อ 12 ลัง FOC 1 ลัง' },
             { min: 6,  minU: 'CT', qty: 6, u: 'PK', note: 'ซื้อ 6 ลัง FOC 6 แพ็ค' },
             { min: 1,  minU: 'CT', qty: 1, u: 'PK', note: 'ซื้อ 1 ลัง FOC 1 แพ็ค' } ] },
  { key: 'extreme', name: 'Sales out: Ranger Extreme (1-7 ก.ค. 69)', from: '2026-07-01', to: '2026-07-07',
    group: 'extreme-FOC', freeFrom: 'extreme',
    tiers: [ { min: 12, minU: 'CT', qty: 1, u: 'CT', note: 'ซื้อ 12 ลัง FOC 1 ลัง (จบรายการพร้อมกัน)' } ] },
  { key: 'pet24', name: 'Sales out: Ranger Pet 24 ขด (1-31 ก.ค. 69)', from: '2026-07-01', to: '2026-07-31',
    group: 'pet24-FOC', freeFrom: 'pet24',
    tiers: [ { min: 5, minU: 'CT', qty: 6, u: 'PC', note: 'ซื้อ 5 ลัง FOC 6 กล่อง' },
             { min: 3, minU: 'CT', qty: 3, u: 'PC', note: 'ซื้อ 3 ลัง FOC 3 กล่อง' } ] },
  { key: 'pet40', name: 'Sales out: Ranger Pet 40 ขด (1-31 ก.ค. 69)', from: '2026-07-01', to: '2026-07-31',
    group: 'pet40-FOC', freeFrom: 'pet40',
    tiers: [ { min: 5, minU: 'CT', qty: 6, u: 'PC', note: 'ซื้อ 5 ลัง FOC 6 กระป๋อง' },
             { min: 1, minU: 'CT', qty: 1, u: 'PC', note: 'ซื้อ 1 ลัง FOC 1 กระป๋อง' } ] },
  // "Ranger Dry" = Dry Spray (เจ้าของระบบยืนยัน 27 ก.ย. 2026) — คนละกลไกกับชุดร้านใหม่ จึงได้พร้อมกันได้
  { key: 'dryspray', name: 'Sales out: Ranger Dry (1-31 ก.ค. 69)', from: '2026-07-01', to: '2026-07-31',
    group: 'dry-FOC', freeFrom: 'dryspray',
    tiers: [ { min: 30, minU: 'CT', qty: 1, u: 'CT', note: 'ซื้อ 30 ลัง FOC 1 ลัง' } ] },
  { key: 'dryspray', name: 'Sales out: Ranger Dry Spray — ร้านใหม่ (1 ก.ค.-31 ส.ค. 69)', from: '2026-07-01', to: '2026-08-31',
    group: 'dryspray-new-FOC', freeFrom: 'dryspray', newShopsOnly: true,
    note: 'เฉพาะร้านค้าใหม่ — ผูกกับรายชื่อร้านค้าที่แอดมินระบุเอง (40_customer_lists.gs)',
    tiers: [ { min: 5, minU: 'CT', qty: 5, u: 'PK', note: 'ซื้อ 5 ลัง FOC 5 แพ็ค' },
             { min: 1, minU: 'CT', qty: 1, u: 'PK', note: 'ซื้อ 1 ลัง FOC 1 แพ็ค' } ] }
];

(async () => {
  console.log('ตัวแทนที่จะจ่ายชุดให้: ' + TENANT + ' · โหมด: ' + (COMMIT ? 'สร้างจริง' : 'ดูอย่างเดียว'));

  const pr = await call('listProductsAdmin', {});
  if (!pr.success) die('อ่านสินค้าไม่ได้: ' + pr.message);
  const products = pr.data || pr.products || [];
  const ur = await call('listProductUnits', {});
  if (!ur.success) die('อ่านหน่วยสินค้าไม่ได้: ' + ur.message);
  const unitsOf = {};
  (ur.data || []).forEach(u => {
    (unitsOf[String(u.product_id)] = unitsOf[String(u.product_id)] || {})[String(u.unit_code)] = Number(u.unit_factor) || 1;
  });

  /* ★ นับเฉพาะ SKU ที่ "ขายเป็นลังได้จริง" — SKU ที่ไม่มีหน่วยขายเลย สั่งเป็นลังไม่ได้อยู่แล้ว
     ถ้าใส่เข้าไปด้วยจะดูเหมือนตระกูลครบ แต่ที่จริงเป็นแถวตาย */
  const familyOf = key => products.filter(p => FAMILY[key].test(String(p.name)) && unitsOf[String(p.record_id)] && unitsOf[String(p.record_id)].CT);
  const nameOf = id => { const p = products.find(x => String(x.record_id) === String(id)); return p ? p.name : '#' + id; };

  let problems = [];
  const built = PLAN.map(s => {
    const fam = familyOf(s.key);
    const freeFam = familyOf(s.freeFrom);
    if (!fam.length) problems.push(s.name + ' — ไม่พบสินค้าที่ขายเป็นลังได้ในตระกูลนี้');
    // สินค้าที่จะแถม: ตัวแรกของตระกูล (ใบอนุมัติไม่ได้ระบุ SKU — ต้องให้เจ้าของระบบยืนยัน)
    const freeProduct = freeFam[0];
    const tiers = s.tiers.map(t => {
      const u = unitsOf[String(freeProduct && freeProduct.record_id)] || {};
      if (t.u !== 'PC' && !u[t.u]) problems.push(s.name + ' — สินค้าที่แถมไม่มีหน่วย ' + t.u);
      return Object.assign({}, t, { factor: t.u === 'PC' ? 1 : (u[t.u] || 1) });
    });
    return { spec: s, triggers: fam, freeProduct: freeProduct, tiers: tiers };
  });

  built.forEach(b => {
    console.log('\n── ' + b.spec.name);
    console.log('   ต้องซื้อ (' + b.triggers.length + ' SKU): ' + b.triggers.map(p => p.product_code).join(', '));
    console.log('   แถมสินค้า: ' + (b.freeProduct ? b.freeProduct.product_code + ' ' + String(b.freeProduct.name).slice(0, 40) : '(ไม่พบ)'));
    b.tiers.forEach(t => console.log('     • ' + t.note + '  → ' + t.qty + ' ' + t.u + ' = ' + (t.qty * t.factor) + ' หน่วยฐาน'));
    if (b.spec.note) console.log('   ⚠ ' + b.spec.note);
  });

  if (problems.length) { console.log('\n⚠ ที่ต้องดู:'); problems.forEach(p => console.log('   - ' + p)); }
  if (!COMMIT) { console.log('\n[ดูอย่างเดียว] ยังไม่ได้สร้างอะไร — ใส่ --commit เพื่อสร้างจริง'); return; }

  console.log('\n══ สร้างจริง ══');
  for (const b of built) {
    if (!b.triggers.length || !b.freeProduct) { console.log('✗ ข้าม ' + b.spec.name); continue; }
    const set = await call('saveFreeGoodsSet', { name: b.spec.name, status: 'draft',
      validFrom: b.spec.from, validTo: b.spec.to,
      note: 'ตามใบอนุมัติ Promotion Jul-Sep\'26' + (b.spec.note ? ' · ' + b.spec.note : '') });
    if (!set.success) { console.log('✗ ' + b.spec.name + ' — ' + set.message); continue; }
    for (const t of b.tiers) {
      const r = await call('saveFreeGoodsItem', { setId: set.id, tierGroup: b.spec.group,
        triggerProductIds: b.triggers.map(p => Number(p.record_id)),
        minQty: t.min, minUnitCode: t.minU,
        freeProductId: b.freeProduct.record_id, freeQty: t.qty, freeUnitCode: t.u, note: t.note });
      if (!r.success) console.log('   ✗ ขั้น "' + t.note + '" — ' + r.message);
    }
    /* ★ "ร้านค้าใหม่ที่ยังไม่เคยซื้อ" ตัดสินด้วยคน ไม่ใช่ last_sale_at — ผูกกับรายชื่อที่แอดมินทำเอง
       สร้างรายชื่อเปล่าให้ แล้วให้คนไปใส่รหัสร้านเอง · รายชื่อว่าง = ยังไม่มีร้านไหนได้ ซึ่งปลอดภัยกว่าเดา */
    if (spec.newShopsOnly) {
      const lists = await call('listCustomerLists', {});
      let nl = (lists.data || []).find(l => /ร้านค้าใหม่/.test(l.name));
      if (!nl) {
        const c = await call('saveCustomerList', { name: 'ร้านค้าใหม่ที่ยังไม่เคยซื้อ (ก.ค.-ส.ค. 69)',
          note: 'ตามใบอนุมัติ Promotion Jul-Sep\'26 — แอดมินเป็นผู้ใส่รหัสร้านที่เข้าเกณฑ์' });
        nl = { id: c.id };
        console.log('   + สร้างรายชื่อ "ร้านค้าใหม่ฯ" (ยังว่าง — ต้องใส่รหัสร้านเอง)');
      }
      const rule = await call('savePriceListRule', { targetType: 'free_goods', priceListId: set.id,
        name: 'เฉพาะร้านในรายชื่อ "ร้านค้าใหม่"', matchType: 'all', priority: 10,
        conditions: [{ field: 'member_of_list', op: 'in', value: String(nl.id) }] });
      if (!rule.success) console.log('   ✗ ผูกกฎร้านใหม่ไม่ได้ — ' + rule.message);
    }
    const asg = await call('savePackageTenants', { packageType: 'free_goods', packageId: set.id, tenantIds: [TENANT] });
    console.log('✓ ' + b.spec.name + ' (ชุด #' + set.id + ', ' + b.tiers.length + ' ขั้น) → จ่ายให้ ' + (asg.assigned || []).join(', '));
  }

  const all = await call('listFreeGoodsSets', {});
  console.log('\nชุดแถมในระบบตอนนี้ ' + (all.data || []).length + ' ชุด:');
  (all.data || []).forEach(s => console.log('  #' + s.id + ' [' + s.status + '] ' + String(s.name).slice(0, 52).padEnd(54) +
    s.tierCount + ' ขั้น · ' + (s.tenants.join(',') || 'ยังไม่ได้จ่าย')));
})();
