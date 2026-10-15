// ทดสอบปลายทางถึงปลายทางบน UAT: ใบลดหนี้ (ม.86/10) และใบเพิ่มหนี้ (ม.86/9)
// รัน: UAT_URL='<uat exec url>' node .dev/uat-ar-adjust-notes-e2e.js
//
// ทิ้งอะไรไว้บน UAT บ้าง: บิลขายเล็กๆ 1 ใบที่ออกใบกำกับภาษีแล้ว + ใบแจ้งหนี้ + ใบลดหนี้ 1 ใบ
// + ใบเพิ่มหนี้ 1 ใบ และใบสำคัญบัญชีของทั้งหมด — **ลบไม่ได้ตามหลักบัญชี** สคริปต์จึงปิดงานให้เรียบร้อย
// (รับชำระยอดที่เหลือจนใบปิด) แทนการพยายามล้างทิ้ง
//
// ★ สั่งแค่ 1 ลังของสินค้าที่สต็อกน้อยที่สุด — เทสต์ชุดนี้ไม่ต้องการของค้างส่ง ต้องการแค่ใบกำกับภาษี
//   1 ใบให้ปรับหนี้ · หยิบสินค้าที่ของเยอะจะได้บิลหลายแสนบาทค้างอยู่ในระบบจริงโดยไม่จำเป็น
const URL_ = process.env.UAT_URL;
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ (เทสต์ชุดนี้เขียนข้อมูลจริง)'); process.exit(1); }

const T = process.env.UAT_TENANT || 'BDC';
const CUST = Number(process.env.UAT_CUSTOMER || 1113);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
let failed = 0;
const ck = (name, got, want) => {
  const ok = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) { failed++; console.log('      got  ' + JSON.stringify(got === undefined ? null : got).slice(0, 400));
    if (want !== undefined) console.log('      want ' + JSON.stringify(want).slice(0, 400)); }
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
  const api = async (action, payload) => {
    for (let i = 0; i < 6; i++) {
      const r = await post({ action, token: login.token, payload: Object.assign({ tenantId: T }, payload || {}) });
      if (r && r.success === false && /กำลังบันทึกเอกสาร/.test(r.message || '')) { await sleep(4000); continue; }
      await sleep(800);
      return r;
    }
    return { success: false, message: 'ชนล็อกเอกสารซ้ำหลายครั้ง' };
  };
  const stockOf = async pid => ((await api('listWarehouseStock')).data || [])
    .filter(w => String(w.productId) === String(pid)).reduce((s, w) => s + (Number(w.qty) || 0), 0);
  const ivOf = async no => ((await api('listArInvoices', {})).data || []).find(x => String(x.invoiceNo) === String(no));
  const jLines = async id => {
    const j = await api('getJournal', { id });
    const m = {};
    (j.journal ? j.journal.lines : []).forEach(l => {
      m[l.accountCode] = m[l.accountCode] || { dr: 0, cr: 0 };
      m[l.accountCode].dr = r2(m[l.accountCode].dr + l.debit);
      m[l.accountCode].cr = r2(m[l.accountCode].cr + l.credit);
    });
    return m;
  };

  /* ── บิลเล็กที่สุดที่เป็นไปได้ เพื่อให้มีใบกำกับภาษีให้ปรับหนี้ ── */
  const wh = (await api('listWarehouseStock')).data || [];
  const free = wh.filter(w => Number(w.qty) - Number(w.reserved || 0) > 0).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
  if (!free) { console.error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ'); process.exit(1); }
  const P = free.productId;
  const factor = Number((((await api('listProductUnits', { productId: P })).data || [])
    .find(u => u.unit_code === 'CT') || {}).unit_factor) || 1;
  console.log('สินค้า', free.productCode, '· 1 ลัง =', factor, 'ชิ้น · ในคลัง', free.qty, 'ชิ้น\n');

  console.log('══ ตั้งต้น: บิล 1 ลัง → ใบกำกับภาษี + ใบแจ้งหนี้ ══');
  let r = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
    items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: 'E2E ใบลดหนี้/ใบเพิ่มหนี้' });
  ck('เปิดบิลขายเชื่อ', r.success, true);
  const id = r.orderId, billTotal = r2(r.total);
  await api('updateSalesOrderStatus', { id, status: 'accepted' });
  r = await api('updateSalesOrderStatus', { id, status: 'ready_to_ship' });
  ck('พร้อมจัดส่ง → ตัดสต็อก + ใบกำกับภาษี + ตั้งลูกหนี้', r.success && /ใบกำกับภาษี/.test(r.message || ''), true);
  await api('updateSalesOrderStatus', { id, status: 'delivering' });
  await api('updateSalesOrderStatus', { id, status: 'completed' });
  const invNo = (((await api('getSaleDeliveryPlan', { id })).rounds || [])[0] || {}).arInvoiceNo
    || ((await api('getSalesOrderAdmin', { id })).order || {}).arInvoiceNo;
  let iv = await ivOf(invNo);
  ck('ได้ใบแจ้งหนี้ ยอดเท่ายอดบิล · ค้างเต็มจำนวน', [r2(iv.total), r2(iv.outstanding)], [billTotal, billTotal]);
  const IV = iv.id;
  const stock0 = await stockOf(P);

  /* ══════════ ใบลดหนี้ ══════════ */
  console.log('\n══ ใบลดหนี้ (ม.86/10) ══');
  let d = await api('getArCreditNoteDraft', { invoiceId: IV, kind: 'credit' });
  ck('ร่างบอกยอดที่ลดได้ = ยอดใบ และมีบรรทัดสินค้าจากบิลจริง',
    [r2(d.invoice.creditable), d.lines.length, d.lines[0].qty], [billTotal, 1, 1]);
  const unitNet = d.lines[0].unitPrice;

  r = await api('createArCreditNote', { invoiceId: IV, lines: [{ productId: P, qty: 1, unitPrice: unitNet }] });
  ck('ไม่ระบุเหตุผล → ปฏิเสธ (กฎหมายบังคับ)', !r.success && /เหตุผล/.test(r.message || ''), true);

  r = await api('createArCreditNote', { invoiceId: IV, reasonCode: 'return', reason: 'ลูกค้าคืนของ',
    lines: [{ itemId: d.lines[0].itemId, productId: P, unitCode: 'CT', unitFactor: factor, qty: 2, unitPrice: unitNet, taxStatus: d.lines[0].taxStatus } ] });
  ck('ลดเกินยอดใบ → ปฏิเสธ', !r.success && /เกิน/.test(r.message || ''), true);

  // ลดครึ่งใบแบบคืนของจริง (ครึ่งลังไม่ได้ จึงลดเป็นเงินครึ่งหนึ่งของ 1 ลังไม่ได้ → ลด 1 ลังเต็ม แต่คืนของ)
  r = await api('createArCreditNote', { invoiceId: IV, reasonCode: 'return', reason: 'E2E ลูกค้าคืนของ 1 ลัง',
    creditDate: new Date().toISOString().slice(0, 10), returnStock: true, vatRate: d.vatRate,
    lines: [{ itemId: d.lines[0].itemId, productId: P, unitCode: 'CT', unitFactor: factor, qty: 1, unitPrice: unitNet, taxStatus: d.lines[0].taxStatus }] });
  ck('ออกใบลดหนี้ได้', r.success, true);
  const cn = (await api('listArCreditNotes', { invoiceId: IV })).data[0];
  ck('  เลขที่ขึ้นต้นด้วย CN · ยอดเท่ายอดใบ · ธงคืนของติด',
    [/^CN-/.test(cn.noteNo), r2(cn.total), cn.stockReturned], [true, billTotal, true]);
  ck('  ★ ก่อนภาษี + ภาษี = ยอดใบลดหนี้เป๊ะ', r2(cn.subtotalExVat + cn.vatAmount), r2(cn.total));
  let J = await jLines(cn.journalId);
  ck('  ★ ลงบัญชีกลับทางกับใบแจ้งหนี้: Dr 4100 รายได้ + Dr 2200 ภาษีขาย / Cr 1200 ลูกหนี้',
    [J['4100'].dr, J['2200'].dr, J['1200'].cr, J['1200'].dr],
    [r2(cn.subtotalExVat), r2(cn.vatAmount), r2(cn.total), 0]);
  iv = await ivOf(invNo);
  ck('  ยอดค้างเหลือ 0 และใบปิดด้วยสถานะ credited (ไม่ใช่ paid — ลูกค้าไม่ได้จ่ายเงิน)',
    [r2(iv.outstanding), iv.status], [0, 'credited']);
  ck('  ★ ของกลับเข้าคลังตามหน่วยฐาน', (await stockOf(P)) - stock0, factor);

  r = await api('createArCreditNote', { invoiceId: IV, reasonCode: 'return', reason: 'ลดซ้ำ',
    lines: [{ productId: P, unitCode: 'CT', qty: 1, unitPrice: unitNet, taxStatus: 'vat' }] });
  ck('ลดซ้ำอีกไม่ได้ ลดเต็มจำนวนไปแล้ว', !r.success, true);

  /* ══════════ ใบเพิ่มหนี้ ══════════ */
  console.log('\n══ ใบเพิ่มหนี้ (ม.86/9) ══');
  d = await api('getArCreditNoteDraft', { invoiceId: IV, kind: 'debit' });
  ck('ร่างฝั่งเพิ่มหนี้ใช้ได้ทั้งที่ใบถูกลดหนี้เต็มแล้ว (เพิ่มหนี้ไม่มีเพดาน)',
    [d.success, d.kind, d.label], [true, 'debit', 'ใบเพิ่มหนี้']);

  r = await api('createArDebitNote', { invoiceId: IV, lines: [{ productId: P, qty: 1, unitPrice: unitNet }] });
  ck('ไม่ระบุเหตุผล → ปฏิเสธ (เหมือนใบลดหนี้)', !r.success && /เหตุผล/.test(r.message || ''), true);

  const stock1 = await stockOf(P);
  r = await api('createArDebitNote', { invoiceId: IV, reasonCode: 'extra', reason: 'E2E ส่งของเพิ่ม 1 ลัง',
    creditDate: new Date().toISOString().slice(0, 10), moveStock: true, vatRate: d.vatRate,
    lines: [{ itemId: d.lines[0].itemId, productId: P, unitCode: 'CT', unitFactor: factor, qty: 1, unitPrice: unitNet, taxStatus: d.lines[0].taxStatus }] });
  ck('ออกใบเพิ่มหนี้ได้ แม้ยอดใบจะถูกลดหนี้เต็มไปแล้ว', r.success, true);
  const dn = (await api('listArDebitNotes', { invoiceId: IV })).data[0];
  ck('  เลขที่ขึ้นต้นด้วย DN · คนละเล่มกับ CN', [/^DN-/.test(dn.noteNo), dn.noteNo !== cn.noteNo], [true, true]);
  ck('  ★ ก่อนภาษี + ภาษี = ยอดใบเพิ่มหนี้เป๊ะ', r2(dn.subtotalExVat + dn.vatAmount), r2(dn.total));
  J = await jLines(dn.journalId);
  ck('  ★ ลงบัญชีทางเดียวกับใบแจ้งหนี้: Dr 1200 ลูกหนี้ / Cr 4100 รายได้ + Cr 2200 ภาษีขาย',
    [J['1200'].dr, J['4100'].cr, J['2200'].cr, J['1200'].cr],
    [r2(dn.total), r2(dn.subtotalExVat), r2(dn.vatAmount), 0]);
  iv = await ivOf(invNo);
  ck('  ★ ใบที่ปิดไปแล้วกลับมาค้างอีกครั้ง ตามยอดที่เพิ่ม',
    [r2(iv.outstanding), iv.status !== 'credited'], [r2(dn.total), true]);
  ck('  ★ ของออกจากคลัง (ตรงข้ามกับใบลดหนี้)', (await stockOf(P)) - stock1, -factor);
  ck('  โผล่ในรายงานอายุหนี้ตามยอดที่เพิ่ม', r2((((await api('getArAging', {})).data || [])
    .flatMap(g => g.docs || []).find(x => String(x.docNo) === String(invNo)) || {}).outstanding), r2(dn.total));

  console.log('\n══ ปิดงาน: รับชำระยอดที่เพิ่มหนี้ไว้ ══');
  r = await api('receiveArPayment', { invoiceId: IV, amount: r2(dn.total) + 1, method: 'transfer' });
  ck('รับเกินยอดค้าง → ปฏิเสธ', !r.success, true);
  r = await api('receiveArPayment', { invoiceId: IV, amount: r2(dn.total), method: 'transfer',
    paymentDate: new Date().toISOString().slice(0, 10) });
  ck('รับครบ → ใบปิด ค้าง 0', r.success, true);
  iv = await ivOf(invNo);
  ck('  ยอดค้างสุดท้าย 0 (ยอดใบ + เพิ่มหนี้ − รับชำระ − ลดหนี้)', r2(iv.outstanding), 0);

  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
