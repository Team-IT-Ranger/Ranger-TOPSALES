// ทดสอบบน UAT: ลงบัญชีขายสด (52_cash_sales_gl.gs) + ใบวางบิล (53_billing_notes.gs)
// รัน: UAT_URL='<uat exec url>' node .dev/uat-cash-and-billing-e2e.js
//
// ★★ เปลี่ยนค่าตั้งของสมุด (เปิดลงบัญชีขายสด) → **คืนค่าเดิมทุกทางออก** รวมตอนล้มกลางคัน
//   ไม่งั้นอีกคนที่เทสต์อยู่จะเจอใบสำคัญงอกในบิลของเขาโดยไม่รู้ที่มา
// ★ สั่งแค่ 1 ลังของสินค้าที่สต็อกน้อยสุด · ยกเลิกบิลทุกใบตอนจบ
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
const post = async b => {
  for (let i = 0; i < 3; i++) {
    try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) })).json(); }
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
      await sleep(650);
      return r;
    }
    return { success: false, message: 'ชนล็อกเอกสารซ้ำหลายครั้ง' };
  };

  const ORIGINAL = (await api('getAccountingSettings', {})).settings;
  console.log('ค่าตั้งเดิมของสมุด ' + T + ':', JSON.stringify(ORIGINAL), '\n');
  const restore = async () => {
    const r = await api('saveAccountingSettings', { costMethod: ORIGINAL.costMethod, cogsFrom: ORIGINAL.cogsFrom,
      cashSales: ORIGINAL.cashSales, cashFrom: ORIGINAL.cashFrom });
    console.log('\nคืนค่าตั้งเดิม: ' + (r.success ? 'สำเร็จ' : 'FAILED — ' + r.message));
  };
  process.on('uncaughtException', async e => { console.error(e); await restore(); process.exit(1); });

  const cleanup = [];
  try {
    const wh = (await api('listWarehouseStock', {})).data || [];
    const free = wh.filter(w => Number(w.qty) - Number(w.reserved || 0) > 0).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
    if (!free) throw new Error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ');
    const P = free.productId;
    console.log('สินค้า', free.productCode, '· คงเหลือ', free.qty, '\n');

    const journalsOf = async type => ((await api('listJournals', { limit: 500 })).data || [])
      .filter(j => String(j.refType) === type);
    const newBill = async (pay, note) => {
      const r = await api('recordSaleAdmin', { customerId: CUST, paymentType: pay,
        fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: note });
      if (!r.success) throw new Error('เปิดบิลไม่ได้: ' + r.message);
      cleanup.push(r.orderId);
      await api('updateSalesOrderStatus', { id: r.orderId, status: 'accepted' });
      return r;
    };

    /* ══════════ 1. ลงบัญชีขายสด ══════════ */
    console.log('══ ลงบัญชีขายสด ══');
    await api('saveAccountingSettings', { costMethod: ORIGINAL.costMethod, cogsFrom: ORIGINAL.cogsFrom, cashSales: 'off' });
    const n0 = (await journalsOf('SALES_CASH')).length;
    let b = await newBill('cash', 'E2E ขายสด ปิดอยู่');
    await api('updateSalesOrderStatus', { id: b.orderId, status: 'ready_to_ship' });
    ck('★ ปิดอยู่ → ไม่ลงบัญชีขายสด', (await journalsOf('SALES_CASH')).length, n0);
    await api('cancelSalesOrderAdmin', { id: b.orderId, note: 'E2E' });

    const today = new Date().toISOString().slice(0, 10);
    let r = await api('saveAccountingSettings', { costMethod: ORIGINAL.costMethod, cogsFrom: ORIGINAL.cogsFrom,
      cashSales: 'on', cashFrom: today });
    ck('เปิดลงบัญชีขายสด เริ่มวันนี้', r.success && (await api('getAccountingSettings', {})).settings.cashSales === 'on', true);

    b = await newBill('cash', 'E2E ขายสด เปิดแล้ว');
    r = await api('updateSalesOrderStatus', { id: b.orderId, status: 'ready_to_ship' });
    ck('  พร้อมจัดส่ง → ข้อความบอกว่าลงบัญชีขายสดให้แล้ว', /ลงบัญชีขายสด/.test((r.changes || []).join(' ') + (r.message || '')), true);
    const mine = (await journalsOf('SALES_CASH')).filter(j => String(j.refId) === String(b.orderId));
    ck('★ มีใบสำคัญขายสดของบิลนี้ 1 ใบ ยอดเท่ายอดบิล',
      [mine.length, mine.length ? r2(Number(mine[0].totalDebit)) : 0], [1, r2(b.total)]);
    if (mine.length) {
      const j = await api('getJournal', { id: mine[0].id });
      const by = {};
      (j.journal.lines || []).forEach(l => { by[l.accountCode] = { dr: l.debit, cr: l.credit }; });
      ck('★★ Dr เงินสด/ธนาคาร = ยอดบิล · Cr 4100 รายได้ + Cr 2200 ภาษีขาย',
        [r2((by['1110'] || by['1120'] || {}).dr), r2((by['4100'] || {}).cr) + r2((by['2200'] || {}).cr)],
        [r2(b.total), r2(b.total)]);
      ck('  เดบิต = เครดิต', r2(j.journal.totalDebit), r2(j.journal.totalCredit));
    }

    await api('cancelSalesOrderAdmin', { id: b.orderId, note: 'E2E คืนของ' });
    const rev = (await journalsOf('SALES_CASH_REV')).filter(j => String(j.refId) === String(b.orderId));
    ck('★ ยกเลิกบิล → กลับรายการ 1 ใบ ยอดเท่าเดิม',
      [rev.length, rev.length ? r2(Number(rev[0].totalDebit)) : 0], [1, r2(b.total)]);

    const vat = await api('getVatSalesReport', { month: today.slice(0, 7) });
    ck('★★ รายงานภาษีนับใบที่ลงบัญชีแล้วถูกต้อง (ไม่นับว่ายังไม่ลง)', vat.success, true);

    /* ══════════ 2. ใบวางบิล ══════════ */
    console.log('\n══ ใบวางบิล ══');
    const c1 = await newBill('credit_term', 'E2E วางบิล 1');
    await api('updateSalesOrderStatus', { id: c1.orderId, status: 'ready_to_ship' });
    const c2 = await newBill('credit_term', 'E2E วางบิล 2');
    await api('updateSalesOrderStatus', { id: c2.orderId, status: 'ready_to_ship' });

    let able = (await api('listBillableInvoices', { customerId: CUST })).data || [];
    const want = able.filter(x => [String(c1.orderId), String(c2.orderId)].indexOf(String(x.salesOrderId)) !== -1);
    ck('★ ใบแจ้งหนี้ของสองบิลที่เพิ่งเปิด ขึ้นในรายการที่วางบิลได้', want.length, 2);

    r = await api('createBillingNote', { customerId: CUST, invoiceIds: want.map(x => x.id),
      noteDate: today, dueDate: today, note: 'E2E วางบิล' });
    ck('★ ออกใบวางบิลได้ เลขขึ้นต้นด้วย BN', r.success && /^BN-/.test(r.noteNo || ''), true);
    const BN = r.noteId, bnTotal = r2(r.total);
    ck('  ยอดรวม = ผลรวมยอดค้างของสองใบ', bnTotal, r2(want.reduce((s, x) => s + x.outstanding, 0)));

    able = (await api('listBillableInvoices', { customerId: CUST })).data || [];
    ck('★ ใบที่วางบิลแล้วหายจากรายการที่วางบิลได้',
      able.filter(x => want.map(w => String(w.id)).indexOf(String(x.id)) !== -1).length, 0);

    r = await api('createBillingNote', { customerId: CUST, invoiceIds: [want[0].id], noteDate: today });
    ck('★ วางบิลซ้ำใบเดิมไม่ได้', !r.success && /วางบิลไปแล้ว/.test(r.message || ''), true);

    const note = ((await api('listBillingNotes', {})).data || []).find(x => String(x.id) === String(BN));
    ck('  รายการแสดงยอดวางบิลและยอดคงค้างของวันนี้',
      [note.invoiceCount, note.total, note.outstanding], [2, bnTotal, bnTotal]);
    const d = await api('getBillingNote', { id: BN });
    ck('  รายละเอียดมีรายการครบ 2 ใบ พร้อมข้อมูลลูกค้าและผู้ออก',
      [d.success, (d.items || []).length, !!d.customer, !!d.issuer], [true, 2, true, true]);

    r = await api('cancelBillingNote', { id: BN, reason: 'E2E' });
    ck('ยกเลิกใบวางบิลได้', r.success, true);
    able = (await api('listBillableInvoices', { customerId: CUST })).data || [];
    ck('★ ยกเลิกแล้วใบแจ้งหนี้กลับมาวางบิลใหม่ได้',
      able.filter(x => want.map(w => String(w.id)).indexOf(String(x.id)) !== -1).length, 2);

    await api('cancelSalesOrderAdmin', { id: c1.orderId, note: 'E2E' });
    await api('cancelSalesOrderAdmin', { id: c2.orderId, note: 'E2E' });

  } catch (e) {
    console.error('\nผิดพลาด:', e.message);
    failed++;
  }

  await restore();
  const back = (await api('getAccountingSettings', {})).settings;
  ck('ค่าตั้งกลับเป็นของเดิมแล้ว', [back.costMethod, back.cashSales], [ORIGINAL.costMethod, ORIGINAL.cashSales]);
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
