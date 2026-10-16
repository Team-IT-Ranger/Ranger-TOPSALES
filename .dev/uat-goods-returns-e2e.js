// ทดสอบบน UAT: ใบรับคืนสินค้า (54_goods_returns.gs)
// รัน: UAT_URL='<uat exec url>' node .dev/uat-goods-returns-e2e.js
//
// ★★★ ข้อที่ต้องพิสูจน์บนของจริงที่ mock พิสูจน์แทนไม่ได้: **สต็อกขยับกี่ชิ้นจริงๆ**
//   ใบรับคืนเป็นตัวที่ขยับสต็อก · ใบลดหนี้ที่ออกจากมันต้องไม่ขยับซ้ำ
//   สองที่ขยับของชิ้นเดียวกันเมื่อไหร่ สต็อกงอกเป็นสองเท่าโดยไม่มีใครเห็น
// ★ สั่งแค่ 2 ลังของสินค้าที่สต็อกน้อยสุด · ยกเลิกบิลตอนจบ
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

  let orderId = null;
  try {
    const wh = (await api('listWarehouseStock', {})).data || [];
    const free = wh.filter(w => Number(w.qty) - Number(w.reserved || 0) > 0).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
    if (!free) throw new Error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ');
    const P = free.productId;
    const factor = Number((((await api('listProductUnits', { productId: P })).data || [])
      .find(u => u.unit_code === 'CT') || {}).unit_factor) || 1;
    const stockOf = async () => {
      const rows = (await api('listWarehouseStock', {})).data || [];
      return r2(rows.filter(w => String(w.productId) === String(P)).reduce((s, w) => s + (Number(w.qty) || 0), 0));
    };
    console.log('สินค้า', free.productCode, '· 1 ลัง =', factor, 'ชิ้น · คงเหลือ', free.qty, '\n');

    // ── เปิดบิลเครดิต 2 ลัง แล้วส่งให้จบ ──
    const b = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term',
      fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 2 }], note: 'E2E ใบรับคืน' });
    if (!b.success) throw new Error('เปิดบิลไม่ได้: ' + b.message);
    orderId = b.orderId;
    await api('updateSalesOrderStatus', { id: orderId, status: 'accepted' });
    await api('updateSalesOrderStatus', { id: orderId, status: 'ready_to_ship' });
    await api('updateSalesOrderStatus', { id: orderId, status: 'delivering' });
    await api('updateSalesOrderStatus', { id: orderId, status: 'completed' });
    const afterSale = await stockOf();
    console.log('ส่งของแล้ว คงเหลือ', afterSale, '\n');

    console.log('══ รับคืนสินค้า ══');
    let d = await api('getGoodsReturnDraft', { orderId });
    ck('ร่างบอกจำนวนที่รับคืนได้ = จำนวนที่ส่งไป', [d.success, d.lines.length, d.lines[0].returnable], [true, 1, 2]);

    let r = await api('createGoodsReturn', { orderId, reasonCode: 'damaged',
      returnDate: new Date().toISOString().slice(0, 10), note: 'E2E กล่องบุบ',
      lines: [{ itemId: d.lines[0].itemId, qty: 2, condition: 'good' }] });
    ck('★ รับคืน 2 ลัง สภาพดี', [r.success, /^GRN-/.test(r.returnNo || '')], [true, true]);
    const GRN = r.returnId;
    const afterReturn = await stockOf();
    ck('★★ ของสภาพดีกลับเข้าคลังตามหน่วยฐาน (2 ลัง × ' + factor + ')', afterReturn - afterSale, 2 * factor);

    d = await api('getGoodsReturnDraft', { orderId });
    ck('  ร่างรอบถัดไปหักของที่คืนไปแล้ว', [d.lines.length ? d.lines[0].returnable : 0], [0]);

    r = await api('createGoodsReturn', { orderId, reasonCode: 'damaged',
      lines: [{ itemId: (d.lines[0] || {}).itemId || 1, qty: 1, condition: 'good' }] });
    ck('★ รับคืนเกินที่ส่งไป → ปฏิเสธ', !r.success, true);

    console.log('\n══ ออกใบลดหนี้จากใบรับคืน ══');
    const beforeCn = await stockOf();
    r = await api('createCreditNoteFromReturn', { returnId: GRN });
    ck('★ ออกใบลดหนี้ได้ เลขขึ้นต้นด้วย CN', r.success && /^CN-/.test(r.creditNoteNo || ''), true);
    ck('★★★ สต็อกไม่ขยับซ้ำ (ของเข้าคลังไปแล้วตอนรับคืน)', (await stockOf()) - beforeCn, 0);
    ck('  ออกซ้ำจากใบรับคืนเดิมไม่ได้', !(await api('createCreditNoteFromReturn', { returnId: GRN })).success, true);
    ck('  ออกใบลดหนี้แล้ว ยกเลิกใบรับคืนไม่ได้', !(await api('cancelGoodsReturn', { id: GRN })).success, true);

    const list = (await api('listGoodsReturns', {})).data || [];
    const mine = list.find(x => String(x.id) === String(GRN));
    ck('รายการแสดงว่าออกใบลดหนี้แล้ว และนับของเข้าคลังถูก',
      [!!mine.creditNoteId, mine.restockQty, mine.scrapQty], [true, 2 * factor, 0]);

    console.log('\n══ ของเสียต้องไม่เข้าคลัง ══');
    const b2 = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term',
      fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: 'E2E ของเสีย' });
    await api('updateSalesOrderStatus', { id: b2.orderId, status: 'accepted' });
    await api('updateSalesOrderStatus', { id: b2.orderId, status: 'ready_to_ship' });
    const d2 = await api('getGoodsReturnDraft', { orderId: b2.orderId });
    const beforeScrap = await stockOf();
    r = await api('createGoodsReturn', { orderId: b2.orderId, reasonCode: 'expired',
      lines: [{ itemId: d2.lines[0].itemId, qty: 1, condition: 'damaged' }] });
    ck('★★ รับคืนของชำรุด → ไม่เข้าคลังขายสักชิ้น',
      [r.success, r.restocked, r.scrapQty, (await stockOf()) - beforeScrap], [true, 0, factor, 0]);
    await api('cancelSalesOrderAdmin', { id: b2.orderId, note: 'E2E' });

  } catch (e) {
    console.error('\nผิดพลาด:', e.message);
    failed++;
  }

  /* ★ ไม่ยกเลิกบิลใบแรก — ออกใบลดหนี้ไปแล้ว การยกเลิกจะคืนของซ้ำอีกรอบ
     (เอกสารที่ลงบัญชีแล้วลบไม่ได้ตามหลักบัญชีอยู่แล้ว) */
  console.log('\nบิล E2E ใบแรกปล่อยไว้ตามเดิม — ออกใบลดหนี้ไปแล้ว ยกเลิกจะคืนของซ้ำ');
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
