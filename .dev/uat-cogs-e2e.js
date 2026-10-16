// ทดสอบปลายทางถึงปลายทางบน UAT: ต้นทุนขาย (COGS) — 50_cogs.gs
// รัน: UAT_URL='<uat exec url>' node .dev/uat-cogs-e2e.js
//
// ★★ สคริปต์นี้ "เปลี่ยนค่าตั้งของสมุด" ซึ่งกระทบทุกบิลที่เดินหลังจากนั้น
//   จึง **คืนค่าตั้งกลับเป็นของเดิมทุกทางออก** (รวมตอนล้มกลางคัน) ไม่งั้นอีกคนที่กำลังเทสต์อยู่
//   จะเจอใบสำคัญต้นทุนงอกในบิลของเขาโดยไม่รู้ว่ามาจากไหน
//
// ★ สั่งแค่ 1 ลังของสินค้าที่สต็อกน้อยที่สุด และยกเลิกบิลทุกใบตอนจบ — บทเรียนจาก
//   uat-delivery-rounds: หยิบสินค้าที่ของเยอะแล้วได้บิลทดสอบหลักแสนค้างในระบบจริง
const URL_ = process.env.UAT_URL;
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ'); process.exit(1); }

const T = process.env.UAT_TENANT || 'BDC';
const CUST = Number(process.env.UAT_CUSTOMER || 1113);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
let failed = 0;
const ck = (n, got, want) => {
  const okNow = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
  console.log((okNow ? 'PASS ' : 'FAIL ') + n);
  if (!okNow) { failed++; console.log('      got  ' + JSON.stringify(got === undefined ? null : got).slice(0, 300));
    if (want !== undefined) console.log('      want ' + JSON.stringify(want).slice(0, 300)); }
};
const post = async body => {
  for (let i = 0; i < 3; i++) {
    try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json(); }
    catch (e) { if (i === 2) throw e; }
  }
};

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: process.env.UAT_USER || 'admin', password: process.env.UAT_PASS || 'ChangeMe123!' } });
  if (!login.success) { console.error('ล็อกอินไม่ผ่าน', login); process.exit(1); }
  const api = async (a, p) => {
    for (let i = 0; i < 6; i++) {
      const r = await post({ action: a, token: login.token, payload: Object.assign({ tenantId: T }, p || {}) });
      if (r && r.success === false && /กำลังบันทึกเอกสาร/.test(r.message || '')) { await sleep(4000); continue; }
      await sleep(700);
      return r;
    }
    return { success: false, message: 'ชนล็อกเอกสารซ้ำหลายครั้ง' };
  };

  const settings = async () => (await api('getAccountingSettings', {})).settings;
  const ORIGINAL = await settings();
  console.log('ค่าตั้งเดิมของสมุด ' + T + ':', JSON.stringify(ORIGINAL), '\n');

  const restore = async () => {
    const r = await api('saveAccountingSettings', { costMethod: ORIGINAL.costMethod, cogsFrom: ORIGINAL.cogsFrom });
    console.log('\nคืนค่าตั้งเดิม: ' + (r.success ? 'สำเร็จ' : 'FAILED — ' + r.message));
  };
  process.on('uncaughtException', async e => { console.error(e); await restore(); process.exit(1); });

  try {
    // ── สินค้าทดสอบ: ของน้อยที่สุดที่ยังขายได้ ──
    const wh = (await api('listWarehouseStock', {})).data || [];
    const free = wh.filter(w => Number(w.qty) - Number(w.reserved || 0) > 0).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
    if (!free) { console.error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ'); await restore(); process.exit(1); }
    const P = free.productId, avg = Number(free.avgCost) || 0;
    const factor = Number((((await api('listProductUnits', { productId: P })).data || [])
      .find(u => u.unit_code === 'CT') || {}).unit_factor) || 1;
    console.log('สินค้า', free.productCode, '· ต้นทุนเฉลี่ย', avg, '· 1 ลัง =', factor, 'ชิ้น\n');

    const cogsJournals = async () => ((await api('listJournals', { limit: 500 })).data || [])
      .filter(j => String(j.refType || '').indexOf('SALES_COGS') === 0);
    const acctBalance = async code => {
      const tb = await api('getTrialBalance', {});
      const row = (tb.data || tb.rows || []).find(a => String(a.code) === code) || {};
      return { dr: r2(Number(row.debit) || 0), cr: r2(Number(row.credit) || 0) };
    };

    const newBill = async note => {
      const r = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term',
        fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: note });
      if (!r.success) throw new Error('เปิดบิลไม่ได้: ' + r.message);
      await api('updateSalesOrderStatus', { id: r.orderId, status: 'accepted' });
      return r.orderId;
    };
    const ship = id => api('updateSalesOrderStatus', { id, status: 'ready_to_ship' });

    /* ══ 1. ปิดอยู่ = ไม่ลงบัญชีต้นทุน ══ */
    console.log('══ ปิดการตัดต้นทุน ══');
    let r = await api('saveAccountingSettings', { costMethod: 'none' });
    ck('ปิดการตัดต้นทุนได้', r.success, true);
    const before0 = (await cogsJournals()).length;
    let id1 = await newBill('E2E COGS ปิดอยู่');
    await ship(id1);
    ck('★ ปิดอยู่ → ตัดสต็อกได้ แต่ไม่มีใบสำคัญต้นทุนเพิ่ม', (await cogsJournals()).length, before0);
    await api('cancelSalesOrderAdmin', { id: id1, note: 'E2E' });

    /* ══ 2. เปิดแบบเฉลี่ยถ่วงน้ำหนัก ══ */
    console.log('\n══ ต้นทุนเฉลี่ยถ่วงน้ำหนัก ══');
    const today = new Date().toISOString().slice(0, 10);
    r = await api('saveAccountingSettings', { costMethod: 'average', cogsFrom: today });
    ck('เปิดใช้ต้นทุนเฉลี่ย เริ่มวันนี้', r.success && (await settings()).costMethod === 'average', true);
    r = await api('saveAccountingSettings', { costMethod: 'average' });
    ck('  ไม่ระบุวันที่เริ่ม → ปฏิเสธ', !r.success, true);
    await api('saveAccountingSettings', { costMethod: 'average', cogsFrom: today });

    const c0 = await acctBalance('5100'), i0 = await acctBalance('1300');
    const id2 = await newBill('E2E COGS เฉลี่ย');
    await ship(id2);
    const mine = (await cogsJournals()).filter(j => String(j.refId) === String(id2) || String(j.refId).indexOf(id2 + '#') === 0);
    ck('★ มีใบสำคัญต้นทุนของบิลนี้ 1 ใบ', mine.length, 1);
    const amt = mine.length ? r2(Number(mine[0].totalDebit) || 0) : 0;
    ck('  ยอด = ต้นทุนเฉลี่ย × จำนวนหน่วยฐาน (' + avg + ' × ' + factor + ')', amt, r2(avg * factor));
    const c1 = await acctBalance('5100'), i1 = await acctBalance('1300');
    ck('★ Dr 5100 ต้นทุนขาย เพิ่มตามยอด · Cr 1300 สินค้าคงเหลือ เพิ่มตามยอด',
      [r2(c1.dr - c0.dr), r2(i1.cr - i0.cr)], [amt, amt]);

    const pl = await api('getIncomeStatement', {});
    const row = (pl.expense || []).find(a => String(a.code) === '5100');
    ck('★★ งบกำไรขาดทุนมีบรรทัดต้นทุนขายแล้ว', !!row && Number(row.debit) > 0, true);

    /* ══ 3. ยกเลิกบิล → กลับรายการด้วยยอดเดิม ══ */
    console.log('\n══ ยกเลิกบิล = กลับรายการ ══');
    await api('cancelSalesOrderAdmin', { id: id2, note: 'E2E คืนของ' });
    const rev = (await cogsJournals()).filter(j => String(j.refType) === 'SALES_COGS_REV' &&
      (String(j.refId) === String(id2) || String(j.refId).indexOf(id2 + '#') === 0));
    ck('★ มีใบกลับรายการ 1 ใบ ยอดเท่าเดิมเป๊ะ', [rev.length, rev.length ? r2(Number(rev[0].totalDebit)) : 0], [1, amt]);
    const c2 = await acctBalance('5100'), i2 = await acctBalance('1300');
    ck('★★ ขาไป-ขากลับหักล้างกันสนิททั้งสองบัญชี',
      [r2((c2.dr - c2.cr) - (c0.dr - c0.cr)), r2((i2.cr - i2.dr) - (i0.cr - i0.dr))], [0, 0]);

    /* ══ 4. FIFO ══ */
    console.log('\n══ FIFO ══');
    r = await api('saveAccountingSettings', { costMethod: 'fifo', cogsFrom: today });
    ck('สลับเป็น FIFO', r.success, true);
    const id3 = await newBill('E2E COGS FIFO');
    await ship(id3);
    const f = (await cogsJournals()).filter(j => String(j.refType) === 'SALES_COGS' &&
      (String(j.refId) === String(id3) || String(j.refId).indexOf(id3 + '#') === 0));
    ck('★ ลงต้นทุนด้วย FIFO ได้ และยอดมากกว่า 0', f.length === 1 && Number(f[0].totalDebit) > 0, true);
    if (f.length) console.log('   FIFO ' + r2(Number(f[0].totalDebit)) + ' · เฉลี่ยจะได้ ' + r2(avg * factor) +
      (r2(Number(f[0].totalDebit)) === r2(avg * factor) ? ' (เท่ากันเพราะสินค้านี้มีล็อตเดียว)' : ' (ต่างกันเพราะมีหลายล็อต)'));
    await api('cancelSalesOrderAdmin', { id: id3, note: 'E2E' });

    /* ══ 5. ไม่ย้อนหลัง ══ */
    console.log('\n══ ไม่ย้อนหลังก่อนวันที่เริ่ม ══');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await api('saveAccountingSettings', { costMethod: 'average', cogsFrom: tomorrow });
    const nBefore = (await cogsJournals()).length;
    const id4 = await newBill('E2E COGS ก่อนวันเริ่ม');
    await ship(id4);
    ck('★ บิลวันนี้ แต่ตั้งให้เริ่มพรุ่งนี้ → ไม่ลงต้นทุน (งวดเก่าห้ามขยับ)',
      (await cogsJournals()).length, nBefore);
    await api('cancelSalesOrderAdmin', { id: id4, note: 'E2E' });

  } catch (e) {
    console.error('\nผิดพลาด:', e.message);
    failed++;
  }

  await restore();
  const back = await settings();
  ck('ค่าตั้งกลับเป็นของเดิมแล้ว', [back.costMethod, back.cogsFrom], [ORIGINAL.costMethod, ORIGINAL.cogsFrom]);
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
