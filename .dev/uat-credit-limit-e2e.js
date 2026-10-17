// ทดสอบบน UAT: วงเงินเครดิตและหนี้ค้าง (56_customer_credit.gs)
// รัน: UAT_URL='<uat exec url>' node .dev/uat-credit-limit-e2e.js
//
// ★★ สิ่งที่ mock พิสูจน์แทนไม่ได้:
//   · หนี้ค้างที่คิดจาก **ข้อมูลจริง** (ใบแจ้งหนี้จริง + บิลเครดิตจริงที่ยังไม่ออกใบ) ตรงกับที่ควรเป็น
//   · ด่านกั้น **ปฏิเสธการเปิดบิลจริง** และ **ไม่เหลือบิลค้างไว้ในระบบ**
//   · เปิดด่านแล้ว **การขายเงินสดยังทำได้ตามปกติ** (ข้อนี้พังแล้วงานหยุดทั้งศูนย์)
//
// ★ สคริปต์เปิดด่านชั่วคราว → **คืนค่าเดิมทุกทางออกรวมตอนล้มกลางคัน**
//   เปิดค้างไว้ = เช้าวันถัดมาพนักงานเปิดบิลเชื่อไม่ได้โดยไม่มีใครรู้ว่าทำไม
//
// ★ ของที่เหลือค้างบน UAT: บิลทดสอบยอดน้อยๆ ที่สร้างระหว่างทาง — ยกเลิกให้เองตอนจบ
const URL_ = process.env.UAT_URL;
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ'); process.exit(1); }

const T = process.env.UAT_TENANT || 'BDC';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
let failed = 0;
const ck = (n, got, want) => {
  const ok = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + n);
  if (!ok) { failed++; console.log('      got  ' + JSON.stringify(got === undefined ? null : got).slice(0, 300));
    if (want !== undefined) console.log('      want ' + JSON.stringify(want).slice(0, 300)); }
};
/* ★ เคสที่ "ต้องถูกปฏิเสธ" ต้องเทียบ **ข้อความ** ด้วยเสมอ — ไม่งั้น payload ผิดรูปก็ตอบ success:false
   เหมือนกัน แล้วเทสต์ผ่านโดยไม่ได้ทดสอบอะไรเลย (เคยพลาดมาแล้วกับ receiveArPayment 16 ต.ค. 2026) */
const rejects = (n, r, re) => {
  const ok = r && r.success === false && re.test(r.message || '');
  console.log((ok ? 'PASS ' : 'FAIL ') + n);
  if (!ok) { failed++; console.log('      got ' + JSON.stringify(r).slice(0, 300)); }
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

  const ORIG = (await api('getCreditSettings', {})).settings;
  if (!ORIG) { console.error('ยังไม่มี action getCreditSettings — deploy ตัวใหม่ก่อน'); process.exit(1); }
  console.log('ค่าตั้งเดิม:', JSON.stringify(ORIG), '\n');
  const restore = async () => {
    const r = await api('saveCreditSettings', { mode: ORIG.mode, overdueDays: ORIG.overdueDays });
    console.log('\nคืนค่าตั้งเดิม: ' + (r.success ? 'สำเร็จ (' + ORIG.mode + ')' : 'FAILED — ' + r.message));
  };
  process.on('uncaughtException', async e => { console.error(e); await restore(); process.exit(1); });

  const madeOrders = [];
  const openBill = async (customerId, pay, items) => {
    const r = await api('recordSaleAdmin', { customerId: customerId, paymentType: pay,
      fulfillmentType: 'office_delivery', items: items, note: 'E2E วงเงินเครดิต',
      requestId: 'e2e-credit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) });
    if (r.success && r.orderId) madeOrders.push(r.orderId);
    return r;
  };

  try {
    /* ── หาร้านและสินค้าที่ "ขายได้จริง" ──
       ★ ห้ามหยิบสินค้าตัวแรกที่เจอมาขาย — ร้านที่มีชุดราคาจะขายได้เฉพาะสินค้าในชุดนั้น
         เดาผิดแล้วบิลเปิดไม่ได้ เทสต์จะ SKIP ทั้งหมวดโดยที่โค้ดไม่ได้ผิดอะไรเลย
         (เคยเสียเวลากับเรื่องนี้มาแล้วตอนเทสต์ต้นทุนขายจากรถ 16 ต.ค. 2026) */
    const custs = (await api('listCustomersAdmin', { slim: true })).customers || [];
    const cust = custs.filter(c => c.isActive)[0];
    if (!cust) throw new Error('ไม่มีลูกค้าให้ทดสอบ');
    const pl = (await api('listPriceLists', {})).data || [];
    const active = pl.filter(p => p.status === 'active')[0];
    console.log('ร้านที่ใช้ทดสอบ:', cust.id, cust.name, '· ชุดราคา:', active ? active.name : '(ไม่มี)');

    let candidates = [];
    if (active) {
      const det = await api('getPriceList', { id: active.id });
      (det.lines || []).forEach(function (ln) {
        (ln.products || []).forEach(function (p) { if (p.productId) candidates.push(p.productId); });
      });
    }
    if (!candidates.length) {
      candidates = ((await api('listProductsAdmin', {})).data || [])
        .filter(function (p) { return String(p.is_active) !== 'FALSE'; })
        .slice(0, 5).map(function (p) { return p.record_id; });
    }
    if (!candidates.length) throw new Error('ไม่มีสินค้าให้ทดสอบ');

    /* ── 1. อ่านหนี้ค้างของร้าน ── */
    console.log('\n══ หนี้ค้างจากข้อมูลจริง ══');
    let cc = await api('getCustomerCredit', { customerId: cust.id });
    ck('อ่านเครดิตของร้านได้', cc.success, true);
    const before = cc.credit;
    console.log('   ค้างอยู่ ' + before.outstanding + ' · เลยกำหนด ' + before.overdue +
      ' · ยังไม่ออกใบแจ้งหนี้ ' + before.unbilled + ' · วงเงิน ' + before.limit);

    const list = await api('listCustomerCredit', {});
    ck('ตารางหนี้ค้างทั้งตัวแทนอ่านได้', list.success, true);
    if (list.success) {
      const row = (list.rows || []).find(r => String(r.id) === String(cust.id));
      ck('★ ตัวเลขในตารางตรงกับที่ดูรายร้าน (นิยามเดียวกันจริง)',
        row ? r2(row.outstanding) : r2(before.outstanding), r2(before.outstanding));
      console.log('   ร้านในตาราง ' + list.rows.length + ' ร้าน · ค้างรวม ' + list.totals.outstanding);
    }

    /* ── 2. เปิดบิลเชื่อแล้วหนี้ค้างต้องเพิ่มขึ้นเท่ายอดบิล ── */
    console.log('\n══ เปิดบิลเชื่อ → หนี้ค้างขยับ ══');
    await api('saveCreditSettings', { mode: 'off', overdueDays: 0 });
    /* ไล่ลองสินค้าในชุดราคาทีละตัวจนเปิดบิลได้ — บางตัวอาจตั้งห้ามขาย/ไม่มีขั้นราคาเป็นลัง */
    let bill = { success: false, message: 'ยังไม่ได้ลอง' }, PID = null;
    for (let i = 0; i < Math.min(candidates.length, 5) && !bill.success; i++) {
      PID = candidates[i];
      bill = await openBill(cust.id, 'credit_term', [{ productId: PID, unitCode: 'CT', qty: 1 }]);
      if (!bill.success) console.log('   (สินค้า ' + PID + ' ขายไม่ได้: ' + bill.message + ')');
    }
    if (!bill.success) {
      console.log('SKIP  เปิดบิลเชื่อไม่ได้เลยสักตัว: ' + bill.message + ' (ข้ามหมวดที่เหลือ)');
    } else {
      console.log('   บิล ' + bill.orderCode + ' ยอด ' + bill.total);
      cc = await api('getCustomerCredit', { customerId: cust.id });
      ck('★★ หนี้ค้างเพิ่มขึ้นเท่ายอดบิลที่เพิ่งเปิด',
        r2(cc.credit.outstanding - before.outstanding), r2(bill.total));
      ck('   และนับเป็นส่วนที่ "ยังไม่ออกใบแจ้งหนี้"',
        r2(cc.credit.unbilled - before.unbilled), r2(bill.total));

      /* ── 3. เปิดด่าน block แล้วตั้งวงเงินต่ำกว่าหนี้ที่มี ── */
      console.log('\n══ ด่านกั้น ══');
      const nowOwed = cc.credit.outstanding;
      const origLimit = before.limit;
      const setLimit = async v => api('updateCustomerAdmin', { id: cust.id, creditLimit: v });
      let up = await setLimit(Math.max(1, Math.floor(nowOwed)));   // วงเงินเท่าหนี้ที่มีพอดี = บิลถัดไปต้องเกิน
      ck('ตั้งวงเงินของร้านทดสอบได้', up.success, true);
      await api('saveCreditSettings', { mode: 'block', overdueDays: 0 });

      const ordersBefore = ((await api('listSalesOrdersAdmin', { limit: 200 })).data || []).length;
      const blocked = await openBill(cust.id, 'credit_term', [{ productId: PID, unitCode: 'CT', qty: 1 }]);
      rejects('★★★ เกินวงเงิน → เปิดบิลเชื่อไม่ได้จริง', blocked, /เกินวงเงิน/);
      const ordersAfter = ((await api('listSalesOrdersAdmin', { limit: 200 })).data || []).length;
      ck('★★ ถูกปฏิเสธแล้วต้องไม่มีบิลค้างอยู่ในระบบ', ordersAfter, ordersBefore);

      const cash = await openBill(cust.id, 'cash', [{ productId: PID, unitCode: 'CT', qty: 1 }]);
      ck('★★★ เปิดด่านอยู่ แต่ขายเงินสดยังได้ตามปกติ', cash.success, true);

      await api('saveCreditSettings', { mode: 'warn', overdueDays: 0 });
      const warned = await openBill(cust.id, 'credit_term', [{ productId: PID, unitCode: 'CT', qty: 1 }]);
      ck('★★ โหมดเตือน → ขายได้ และได้คำเตือนกลับมา',
        [warned.success, /เกินวงเงิน/.test(warned.creditWarning || '')], [true, true]);

      await api('saveCreditSettings', { mode: 'off', overdueDays: 0 });
      const okAgain = await openBill(cust.id, 'credit_term', [{ productId: PID, unitCode: 'CT', qty: 1 }]);
      ck('ปิดด่านแล้วกลับมาเปิดบิลเชื่อได้ตามเดิม', okAgain.success, true);

      await setLimit(origLimit);   // คืนวงเงินเดิมของร้าน
      ck('คืนวงเงินเดิมของร้านแล้ว',
        r2(((await api('getCustomerCredit', { customerId: cust.id })).credit || {}).limit), r2(origLimit));
    }

  } catch (e) {
    console.error('\nผิดพลาด:', e.message);
    failed++;
  }

  // เก็บกวาดบิลทดสอบ
  for (const id of madeOrders) {
    const r = await api('cancelSalesOrderAdmin', { id: id, note: 'E2E วงเงินเครดิต' });
    console.log('   ยกเลิกบิลทดสอบ ' + id + ': ' + (r.success ? 'สำเร็จ' : r.message));
  }
  await restore();
  const back = (await api('getCreditSettings', {})).settings;
  ck('ค่าตั้งกลับเป็นของเดิมแล้ว', [back.mode, back.overdueDays], [ORIG.mode, ORIG.overdueDays]);
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
