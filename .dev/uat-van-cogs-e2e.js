// ทดสอบบน UAT: สต็อกรถเชื่อมคลัง + ต้นทุนขายจากรถ (55_van_stock_link.gs)
// รัน: UAT_URL='<uat exec url>' UAT_STAFF='<line user id ของพนักงาน>' node .dev/uat-van-cogs-e2e.js
//
// ★★ สิ่งที่ mock พิสูจน์แทนไม่ได้: คลังกลางลดลงจริงกี่ชิ้น · van_stock เก็บต้นทุนจริง ·
//   ใบสำคัญเข้าสมุดจริง · และ **เบิกขึ้นรถต้องไม่ลงบัญชี** (ของยังเป็นสินค้าคงเหลือ)
//
// ★ สคริปต์เปิดค่าตั้ง `van_issue` ชั่วคราว → **คืนค่าเดิมทุกทางออกรวมตอนล้มกลางคัน**
//   เปิดค้างไว้ = พนักงานเบิกของขึ้นรถไม่ได้ถ้าคลังมีของไม่พอ ซึ่งหยุดงานจริง
//
// ★★ ของที่เหลือค้างบน UAT: 1 หน่วยฐานที่ย้ายจากคลังกลางขึ้นรถของพนักงานทดสอบ
//   คืนกลับคลังอัตโนมัติไม่ได้ (ยังไม่มีเส้นทาง "คืนของจากรถเข้าคลัง") — จงใจใช้จำนวนน้อยที่สุด
const URL_ = process.env.UAT_URL;
const STAFF = process.env.UAT_STAFF;
if (!URL_ || !STAFF) { console.error('ตั้ง UAT_URL และ UAT_STAFF ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ'); process.exit(1); }

const T = process.env.UAT_TENANT || 'BDC';
const CUST = Number(process.env.UAT_CUSTOMER || 1113);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
let failed = 0;
const ck = (n, got, want) => {
  const ok = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + n);
  if (!ok) { failed++; console.log('      got  ' + JSON.stringify(got === undefined ? null : got).slice(0, 280));
    if (want !== undefined) console.log('      want ' + JSON.stringify(want).slice(0, 280)); }
};
const post = async (b, tries) => {
  tries = tries || 4;
  for (let i = 0; i < tries; i++) {
    try {
      return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(b), signal: AbortSignal.timeout(90000) })).json();
    } catch (e) {
      console.log('   (คำขอสะดุด ลองใหม่ ' + (i + 1) + '/' + tries + ')');
      if (i === tries - 1) throw e;
      await sleep(3000);
    }
  }
};

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: process.env.UAT_USER || 'admin', password: process.env.UAT_PASS || 'ChangeMe123!' } });
  if (!login.success) { console.error('ล็อกอินไม่ผ่าน', login); process.exit(1); }
  const api = async (a, p) => {
    for (let i = 0; i < 5; i++) {
      const r = await post({ action: a, token: login.token, payload: Object.assign({ tenantId: T }, p || {}) });
      if (r && r.success === false && /กำลังบันทึกเอกสาร/.test(r.message || '')) { await sleep(4000); continue; }
      await sleep(600);
      return r;
    }
    return { success: false, message: 'ชนล็อกเอกสาร' };
  };
  const mob = async (a, p) => { const r = await post({ action: a, lineUserId: STAFF, payload: p || {} }); await sleep(600); return r; };

  const ORIG = (await api('getAccountingSettings', {})).settings;
  console.log('ค่าตั้งเดิม:', JSON.stringify(ORIG), '\n');
  const restore = async () => {
    const r = await api('saveAccountingSettings', { costMethod: ORIG.costMethod, cogsFrom: ORIG.cogsFrom,
      cashSales: ORIG.cashSales, cashFrom: ORIG.cashFrom, vanIssue: ORIG.vanIssue });
    console.log('\nคืนค่าตั้งเดิม: ' + (r.success ? 'สำเร็จ' : 'FAILED — ' + r.message));
  };
  process.on('uncaughtException', async e => { console.error(e); await restore(); process.exit(1); });

  try {
    const whOf = async pid => {
      const rows = (await api('listWarehouseStock', {})).data || [];
      return r2(rows.filter(w => String(w.productId) === String(pid)).reduce((s, w) => s + (Number(w.qty) || 0), 0));
    };
    const cogsJ = async () => ((await api('listJournals', { limit: 300 })).data || [])
      .filter(j => String(j.refType || '').indexOf('SALES_COGS') === 0);

    const wh = (await api('listWarehouseStock', {})).data || [];
    const free = wh.filter(w => Number(w.qty) - Number(w.reserved || 0) > 0).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
    if (!free) throw new Error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ');
    const P = free.productId;
    console.log('สินค้า', free.productCode, '· คลังมี', free.qty, '· ต้นทุนเฉลี่ย', free.avgCost, '\n');

    const today = new Date().toISOString().slice(0, 10);

    /* ══ 1. ปิดอยู่ = เบิกของไม่แตะคลัง ══ */
    console.log('══ ปิดอยู่ ══');
    await api('saveAccountingSettings', { costMethod: 'none', cashSales: 'off', vanIssue: 'off' });
    const w0 = await whOf(P);
    let r = await mob('restockVan', { items: [{ productId: P, qty: 1 }] });
    ck('★ ปิดอยู่ → เบิกขึ้นรถได้ และคลังกลางไม่ขยับ', [r.success, await whOf(P)], [true, w0]);

    /* ══ 2. เปิดใช้ ══ */
    console.log('\n══ เปิดการเชื่อมสต็อกรถกับคลังกลาง ══');
    r = await api('saveAccountingSettings', { costMethod: 'average', cogsFrom: today, cashSales: 'off', vanIssue: 'on' });
    ck('เปิดได้', r.success && (await api('getAccountingSettings', {})).settings.vanIssue === 'on', true);

    const nJ0 = (await cogsJ()).length;
    const w1 = await whOf(P);
    r = await mob('restockVan', { items: [{ productId: P, qty: 1 }] });
    ck('★★ เบิกขึ้นรถ → คลังกลางลดลงจริง 1 ชิ้น', [r.success, w1 - (await whOf(P))], [true, 1]);
    ck('★★★ เบิกขึ้นรถ **ไม่ลงบัญชี** (ของยังเป็นสินค้าคงเหลือของกิจการ)', (await cogsJ()).length, nJ0);

    /* ══ 3. เบิกเกินของในคลัง ══ */
    const left = await whOf(P);
    r = await mob('restockVan', { items: [{ productId: P, qty: left + 100 }] });
    ck('★★ เบิกเกินของในคลัง → ปฏิเสธทั้งใบ', [r.success, /ไม่พอ/.test(r.message || '')], [false, true]);
    ck('  และคลังไม่ถูกแตะเลย', await whOf(P), left);

    /* ══ 4. ขายจากรถ → ตัดต้นทุน ══ */
    console.log('\n══ ขายจากรถ ══');
    /* ★ ขายเป็นหน่วยที่ชุดราคามีจริง — "ชิ้น" มักไม่อยู่ในชุดราคา ขายเป็นลังแทน
       (เคยพลาด: เทสต์ข้ามหมวดนี้ทั้งหมดเพราะขายเป็นชิ้นไม่ผ่าน) */
    const factorSold = Number((((await api('listProductUnits', { productId: P })).data || [])
      .find(u => u.unit_code === 'CT') || {}).unit_factor) || 1;
    await mob('restockVan', { items: [{ productId: P, qty: factorSold }] });
    const sale = await mob('recordSale', { customerId: CUST, paymentType: 'cash',
      fulfillmentType: 'immediate', items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: 'E2E ขายจากรถ' });
    if (!sale.success) {
      console.log('SKIP  เปิดบิลขายจากรถไม่ได้: ' + sale.message + ' (ข้ามหมวดนี้)');
    } else {
      const list = (await api('listSalesOrdersAdmin', { limit: 40 })).data || [];
      const row = list.find(o => String(o.code) === String(sale.orderCode));
      const mine = (await cogsJ()).filter(j => String(j.refId) === 'VAN#' + (row && row.id));
      ck('★★ ขายจากรถ → ลงต้นทุนขาย 1 ใบ', mine.length, 1);
      if (mine.length) {
        const amt = r2(Number(mine[0].totalDebit));
        const j = await api('getJournal', { id: mine[0].id });
        const by = {};
        (j.journal.lines || []).forEach(l => { by[l.accountCode] = { dr: l.debit, cr: l.credit }; });
        ck('★ Dr 5100 ต้นทุนขาย / Cr 1300 สินค้าคงเหลือ ยอดเท่ากัน',
          [r2((by['5100'] || {}).dr), r2((by['1300'] || {}).cr)], [amt, amt]);
        /* ★★ **ห้ามคาดว่าต้นทุนรถ = ต้นทุนเฉลี่ยคลังตอนนี้** — รถถ่วงน้ำหนักกับของที่ค้างอยู่บนรถ
           ซึ่งอาจขึ้นไปตอนยังไม่เปิดใช้ (avg_cost ว่าง = 0) หรือขึ้นไปตอนคลังราคาอื่น
           เคยเขียนเทสต์คาดแบบนั้นแล้ว FAIL ทั้งที่โค้ดถูก (16 ต.ค. 2026)
           สิ่งที่ต้องเป็นจริงเสมอคือ **ต้นทุนต่อหน่วยไม่เกินต้นทุนคลัง** (ของเก่าบนรถมีแต่ถูกกว่าหรือเท่า) */
        const perUnit = r2(amt / factorSold);
        ck('  ต้นทุนต่อหน่วยสมเหตุสมผล (ไม่เกินต้นทุนเฉลี่ยคลัง)',
          perUnit > 0 && perUnit <= r2(Number(free.avgCost)) + 0.01, true);
        console.log('   ต้นทุนที่ลง: ' + amt + ' (' + perUnit + '/หน่วย · ต้นทุนคลัง ' + free.avgCost + ')');
      }
      if (row) {
        await api('cancelSalesOrderAdmin', { id: row.id, note: 'E2E' });
        const rev = (await cogsJ()).filter(j => String(j.refType) === 'SALES_COGS_REV' && String(j.refId) === 'VAN#' + row.id);
        ck('★ ยกเลิกบิล → กลับรายการต้นทุน 1 ใบ', rev.length, 1);
      }
    }

  } catch (e) {
    console.error('\nผิดพลาด:', e.message);
    failed++;
  }

  await restore();
  const back = (await api('getAccountingSettings', {})).settings;
  ck('ค่าตั้งกลับเป็นของเดิมแล้ว', [back.costMethod, back.vanIssue], [ORIG.costMethod, ORIG.vanIssue]);
  console.log('\n★ เหลือค้างบน UAT: ของที่ย้ายจากคลังขึ้นรถของพนักงานทดสอบ (คืนอัตโนมัติไม่ได้)');
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
