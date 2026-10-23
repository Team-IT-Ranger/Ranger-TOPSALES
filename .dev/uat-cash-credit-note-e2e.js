// ทดสอบบน UAT: ทะเบียนใบกำกับภาษี (5.3.1) + ใบลดหนี้ของบิลขายสด (23 ต.ค. 2026)
// รัน: UAT_URL='<uat exec url>' node .dev/uat-cash-credit-note-e2e.js
//
// ★★★ ข้อที่ของจำลองพิสูจน์แทนไม่ได้: **คู่บัญชีที่ลงไปในสมุดจริง**
//   ใบลดหนี้ของบิลขายสดต้องเครดิต "เงินสด 1110" ไม่ใช่ "ลูกหนี้ 1200"
//   ลงผิด = ลูกหนี้ติดลบทั้งที่ลูกค้าไม่เคยติดหนี้ และเงินในบัญชีไม่ตรงกับลิ้นชัก
// ★ ขาย 1 ลังของสินค้าที่สต็อกเยอะสุด · ใบที่ออกลบไม่ได้ตามหลักบัญชี จึงยกเลิกใบลดหนี้ตอนจบแทน
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

  try {
    console.log('══ 1. เปิดบิลขายสด ══');
    const rows = (await api('listWarehouseStock', {})).data || [];
    const free = rows.filter(w => w.sellable && w.productCode && Number(w.qty) - Number(w.reserved || 0) > 2)
      .sort((a, b) => Number(b.qty) - Number(a.qty))[0];
    if (!free) throw new Error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ');
    const P = free.productId;
    /* ★ ขายสดแบบ "ตัดสต็อกทันที" ต้องระบุพนักงานขับรถ (ตัดจากสต็อกรถของเขา) — เทสต์จึงใช้
       ขายสดแบบสำนักงานจัดส่ง ซึ่งออกใบกำกับภาษีตอนเข้า "พร้อมจัดส่ง" เหมือนกัน */
    const b = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'cash',
      fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: 'E2E ใบลดหนี้ขายสด' });
    if (!b.success) throw new Error('เปิดบิลไม่ได้: ' + b.message);
    const orderId = b.orderId;
    for (const st of ['accepted', 'ready_to_ship']) await api('updateSalesOrderStatus', { id: orderId, status: st });
    const so = await api('getSalesOrderAdmin', { id: orderId });
    const taxNo = (so.order || {}).taxInvoiceNo || '';
    ck('★ ขายสดได้เลขใบกำกับภาษีตั้งแต่กดบันทึก', !!taxNo, true);
    console.log('   บิล ' + (so.order || {}).code + ' · ใบกำกับ ' + taxNo + ' · ยอด ' + (so.order || {}).total);

    console.log('\n══ 2. ทะเบียนใบกำกับภาษี (5.3.1) ══');
    const month = new Date().toISOString().slice(0, 7);
    const reg = await api('listTaxInvoices', { month: month });
    ck('เปิดทะเบียนได้', reg.success, true);
    const mine = (reg.data || []).filter(t => String(t.orderId) === String(orderId))[0];
    ck('★★ บิลขายสดโผล่ในทะเบียน และติดป้ายว่าเงินสด',
      [!!mine, mine && mine.paymentType, mine && mine.docNo], [true, 'cash', taxNo]);
    console.log('   เดือนนี้มีใบกำกับ ' + (reg.summary || {}).docs + ' ใบ · เงินสด ' +
      (reg.summary || {}).cash + ' · เครดิต ' + (reg.summary || {}).credit);
    ck('★ ขายสดไม่มีใบแจ้งหนี้ลูกหนี้ (จึงต้องออกใบลดหนี้อีกทาง)', String((mine || {}).arInvoiceId || ''), '');

    console.log('\n══ 3. ร่างใบลดหนี้จากบิลขายสด ══');
    const d = await api('getArCreditNoteDraft', { salesOrderId: orderId, kind: 'credit' });
    ck('★★ เปิดร่างได้โดยไม่ต้องมีใบแจ้งหนี้', d.success, true);
    ck('★ บอกว่าเป็นขายสด และอ้างเลขใบกำกับภาษี', [d.isCash, d.invoice.invoiceNo], [true, taxNo]);
    const L = (d.lines || [])[0] || {};
    ck('★ รายการและราคามาจากบิลจริง', [L.qty, L.remainQty, L.unitPrice > 0], [1, 1, true]);

    console.log('\n══ 4. ออกใบลดหนี้ → ต้องเครดิต "เงินสด" ไม่ใช่ "ลูกหนี้" ══');
    const cn = await api('createArCreditNote', { salesOrderId: orderId, reasonCode: 'return',
      creditDate: new Date().toISOString().slice(0, 10), vatRate: d.vatRate,
      lines: [{ itemId: L.itemId, productId: P, unitCode: 'CT', unitFactor: L.unitFactor, qty: 1, unitPrice: L.unitPrice, taxStatus: L.taxStatus }] });
    ck('★★ ออกใบลดหนี้จากบิลขายสดได้', [cn.success, /^CN-/.test(cn.noteNo || '')], [true, true]);
    console.log('   ' + (cn.message || cn.error || ''));

    /* ★ ผลลัพธ์ของ createArCreditNote ส่งมาแต่ `journalNo` (ไม่มี id) — ต้องหาใบสำคัญจากเลขที่
       และบรรทัดอยู่ใต้ `journal.lines` (พลาดสองจุดนี้รอบแรก เลยอ่านได้เป็นก้อนว่าง) */
    const jlist = (await api('listJournals', { limit: 50 })).data || [];
    const jrow = jlist.filter(x => String(x.journalNo) === String(cn.journalNo))[0] || {};
    const jr = await api('getJournal', { id: jrow.id });
    const lines = ((jr.journal || {}).lines || []);
    const cr = lines.filter(l => Number(l.credit) > 0).map(l => String(l.accountCode || l.account_code));
    const dr = lines.filter(l => Number(l.debit) > 0).map(l => String(l.accountCode || l.account_code)).sort();
    ck('★★★ เครดิตเงินสด 1110 (ไม่ใช่ลูกหนี้ 1200)', cr, ['1110']);
    ck('★ เดบิตรายได้ 4100 + ภาษีขาย 2200', dr, ['2200', '4100']);

    console.log('\n══ 5. เพดานนับจากบิล ══');
    const again = await api('getArCreditNoteDraft', { salesOrderId: orderId, kind: 'credit' });
    ck('★ รอบถัดไปรู้ว่าลดไปหมดแล้ว', [again.invoice.creditable, again.lines[0].remainQty], [0, 0]);
    const over = await api('createArCreditNote', { salesOrderId: orderId, reasonCode: 'return',
      creditDate: new Date().toISOString().slice(0, 10), vatRate: d.vatRate,
      lines: [{ itemId: L.itemId, productId: P, unitCode: 'CT', unitFactor: L.unitFactor, qty: 1, unitPrice: L.unitPrice, taxStatus: L.taxStatus }] });
    ck('★★ ลดซ้ำเกินยอดบิลไม่ได้', over.success, false);

    console.log('\n══ 6. ใบเพิ่มหนี้ของขายสดยังปิดอยู่ ══');
    const dn = await api('createArDebitNote', { salesOrderId: orderId, reasonCode: 'undercharge',
      creditDate: new Date().toISOString().slice(0, 10),
      lines: [{ productId: P, unitCode: 'CT', qty: 1, unitPrice: 10, taxStatus: 'vat' }] });
    ck('★ ปฏิเสธพร้อมบอกทางออก', [dn.success, /ขายใหม่/.test(dn.message || '')], [false, true]);

    console.log('\n══ 7. เก็บกวาด ══');
    const vd = await api('voidArAdjustNote', { id: cn.noteId, kind: 'credit', reason: 'E2E cleanup' });
    ck('★ ยกเลิกใบลดหนี้ของขายสดได้ (กลับรายการ ไม่ลบ)', vd.success, true);
    const after = await api('getArCreditNoteDraft', { salesOrderId: orderId, kind: 'credit' });
    ck('★ ยกเลิกแล้วของกลับมาลดได้ใหม่', after.invoice.creditable > 0, true);
    const cancel = await api('cancelSalesOrderAdmin', { id: orderId });
    ck('ยกเลิกบิลทดสอบ (ขายสดยังยกเลิกได้)', cancel.success, true);
    if (cancel.warning) console.log('   เตือน: ' + cancel.warning);
  } catch (e) {
    failed++; console.error('\nล้มกลางทาง: ' + e.message);
  }

  console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
