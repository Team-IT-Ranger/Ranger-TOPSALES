// ทดสอบบน UAT: งานใบลดหนี้/ใบรับคืนรอบ 23 ต.ค. 2026
// รัน: UAT_URL='<uat exec url>' node .dev/uat-credit-note-e2e.js
//
// ★★★ ข้อที่ของจำลองพิสูจน์แทนไม่ได้ และเป็นเหตุผลที่ต้องมีไฟล์นี้:
//   1. คอลัมน์ใหม่ (`warehouses.purpose`, `goods_return_items.warehouse_id`) **เขียนลงชีตจริงติดไหม**
//      — บั๊กคลังงอกซ้ำเกิดจากคอลัมน์ไม่มีในชีตแล้วค่าหายเงียบๆ ซึ่ง mock ไม่มีวันจับได้
//   2. ของเข้าคลัง **ไหนจริงๆ** และกี่ชิ้น
//   3. ใบลดหนี้ออกใบรับคืนให้จริง และไม่ขยับสต็อกซ้ำ
// ★ สั่ง 2 ลังของสินค้าที่สต็อกน้อยสุด · เก็บกวาดตอนจบ
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
    console.log('══ 1. คลังมีหน้าที่ ══');
    const whs = (await api('listWarehouses', {})).data || [];
    const byPurpose = p => whs.filter(w => w.purpose === p && w.isActive);
    ck('listWarehouses ส่ง purpose/sellable มาด้วย', whs.length > 0 && whs[0].purpose !== undefined, true);
    console.log('   คลังที่ใช้งานอยู่: ' + whs.filter(w => w.isActive).map(w => w.name + '[' + w.purpose + ']').join(' · '));
    ck('★★ คลังรับคืนและคลังของเสียมีอย่างละ 1 ใบ (ไม่งอกซ้ำ)',
      [byPurpose('quarantine').length, byPurpose('scrap').length], [1, 1]);
    const SALE = (whs.filter(w => w.isDefault)[0] || {}).id;
    const SCRAP = (byPurpose('scrap')[0] || {}).id;
    const QUAR = (byPurpose('quarantine')[0] || {}).id;
    ck('คลังหลักเป็นคลังขาย', (whs.filter(w => w.isDefault)[0] || {}).sellable, true);

    const stockRows = async () => (await api('listWarehouseStock', {})).data || [];
    const rows0 = await stockRows();
    /* ★ ต้องมี productCode ด้วย — แถวสต็อกของสินค้าที่ถูกลบไปแล้วยังค้างอยู่ในชีต
       เลือกไปแล้วจะเปิดบิลไม่ได้ ("ไม่พบสินค้า") เสียเวลาไปรอบหนึ่งฟรีๆ */
    const free = rows0.filter(w => w.sellable && w.productCode && Number(w.qty) - Number(w.reserved || 0) > 2)
      .sort((a, b) => Number(a.qty) - Number(b.qty))[0];
    if (!free) throw new Error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ');
    const P = free.productId;
    const qtyAt = async wh => {
      const rows = await stockRows();
      return r2(rows.filter(w => String(w.productId) === String(P) && String(w.warehouseId) === String(wh))
        .reduce((s, w) => s + (Number(w.qty) || 0), 0));
    };
    console.log('   สินค้าทดสอบ ' + free.productCode + ' · คลังขายมี ' + free.qty + '\n');

    console.log('══ 2. ขายออกไป 2 ลัง ══');
    const b = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term',
      fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 2 }], note: 'E2E ใบลดหนี้' });
    if (!b.success) throw new Error('เปิดบิลไม่ได้: ' + b.message);
    orderId = b.orderId;
    for (const st of ['accepted', 'ready_to_ship', 'delivering', 'completed']) await api('updateSalesOrderStatus', { id: orderId, status: st });
    const saleQty = await qtyAt(SALE);
    /* ★ บิลเครดิตได้ใบแจ้งหนี้อัตโนมัติตอนเข้าสถานะ "พร้อมจัดส่ง" อยู่แล้ว — สั่งตั้งซ้ำจะถูกปฏิเสธ
       (พลาดตรงนี้รอบแรก) · หาใบของบิลนี้แทน ตั้งใหม่เฉพาะตอนไม่มีจริงๆ */
    let ivRow = ((await api('listArInvoices', {})).data || []).filter(x => String(x.salesOrderId) === String(orderId))[0];
    if (!ivRow) {
      const made = await api('createArInvoice', { salesOrderId: orderId, invoiceDate: new Date().toISOString().slice(0, 10), dueDays: 30 });
      ck('ตั้งลูกหนี้ได้', made.success, true);
      ivRow = ((await api('listArInvoices', {})).data || []).filter(x => String(x.salesOrderId) === String(orderId))[0];
    }
    ck('บิลเครดิตมีใบแจ้งหนี้แล้ว', !!ivRow, true);
    const invoiceId = ivRow.id;

    console.log('\n══ 3. ยกเลิกบิลที่ออกใบแจ้งหนี้แล้ว = ไม่ได้ ══');
    const cancel = await api('cancelSalesOrderAdmin', { id: orderId });
    ck('★★ ถูกกั้น และบอกให้ไปออกใบลดหนี้', [cancel.success, !!cancel.needCreditNote], [false, true]);
    console.log('   ' + cancel.message);

    console.log('\n══ 4. ร่างใบลดหนี้: ราคาที่ขายจริง + จำนวนที่ยังลดได้ ══');
    let d = await api('getArCreditNoteDraft', { invoiceId, kind: 'credit' });
    ck('ร่างเปิดได้', d.success, true);
    const L = (d.lines || [])[0] || {};
    ck('★ บอกจำนวนขาย · เคยลดแล้ว · ที่ยังลดได้', [L.qty, L.doneQty, L.remainQty], [2, 0, 2]);
    ck('★ ส่งรายการคลังปลายทางมาให้เลือก (เรียงคลังขายขึ้นก่อน)',
      [(d.warehouses || []).length >= 3, (d.warehouses || [])[0].sellable], [true, true]);
    ck('★ บอกว่าเหตุผลข้อไหนเป็นความผิดฝั่งไหน',
      [(d.reasonFault || {}).shortage, (d.reasonFault || {}).return], ['seller', 'buyer']);
    const sold = L.unitPrice;
    console.log('   ราคาที่ขายจริง ' + sold + '/ลัง · ยอดใบ ' + d.invoice.total);

    console.log('\n══ 5. ความผิดฝั่งเรา = กดราคาลงไม่ได้ ══');
    const low = await api('createArCreditNote', { invoiceId, reasonCode: 'shortage',
      creditDate: new Date().toISOString().slice(0, 10), vatRate: d.vatRate,
      lines: [{ itemId: L.itemId, productId: P, unitCode: 'CT', unitFactor: L.unitFactor, qty: 1, unitPrice: r2(sold - 50), taxStatus: L.taxStatus }] });
    ck('★★★ ปฏิเสธ', [low.success, /ความผิดฝั่งเรา/.test(low.message || '')], [false, true]);

    const high = await api('createArCreditNote', { invoiceId, reasonCode: 'return',
      creditDate: new Date().toISOString().slice(0, 10), vatRate: d.vatRate,
      lines: [{ itemId: L.itemId, productId: P, unitCode: 'CT', unitFactor: L.unitFactor, qty: 1, unitPrice: r2(sold + 100), taxStatus: L.taxStatus }] });
    ck('★ ใส่ราคาสูงกว่าที่ขายไป = ปฏิเสธ', high.success, false);

    console.log('\n══ 6. ออกใบลดหนี้พร้อมรับของเข้าคลังรอตรวจ ══');
    const quarBefore = await qtyAt(QUAR);
    const cn = await api('createArCreditNote', { invoiceId, reasonCode: 'return',
      creditDate: new Date().toISOString().slice(0, 10), vatRate: d.vatRate,
      moveStock: true, warehouseId: QUAR,
      lines: [{ itemId: L.itemId, productId: P, unitCode: 'CT', unitFactor: L.unitFactor, qty: 1, unitPrice: sold, taxStatus: L.taxStatus }] });
    ck('★★ ออกใบลดหนี้ได้ และได้ใบรับคืนมาด้วย', [cn.success, /^GRN-/.test(cn.returnNo || '')], [true, true]);
    console.log('   ' + cn.message);
    ck('★★★ ของเข้า "คลังรอตรวจ" ตามที่เลือก ไม่ใช่คลังขาย',
      [r2(await qtyAt(QUAR) - quarBefore), r2(await qtyAt(SALE) - saleQty)], [L.unitFactor, 0]);

    const grn = ((await api('listGoodsReturns', {})).data || []).filter(g => g.returnNo === cn.returnNo)[0] || {};
    ck('★ ใบรับคืนผูกกลับไปหาใบลดหนี้', String(grn.creditNoteId || ''), String(cn.noteId));
    const grnDetail = await api('getGoodsReturn', { id: grn.id });
    ck('★ ใบรับคืนบันทึกคลังปลายทางรายบรรทัด (คอลัมน์ใหม่เขียนลงชีตติดจริง)',
      String(((grnDetail.items || [])[0] || {}).warehouseId || ''), String(QUAR));
    ck('★ และราคาบนใบรับคืน = ราคาที่ขายจริง', ((grnDetail.items || [])[0] || {}).unitPrice, sold);

    console.log('\n══ 7. ลดซ้ำเกินจำนวนที่เหลือไม่ได้ ══');
    d = await api('getArCreditNoteDraft', { invoiceId, kind: 'credit' });
    const L2 = (d.lines || [])[0] || {};
    ck('★ ร่างรอบถัดไปหักของที่ลดไปแล้ว', [L2.qty, L2.doneQty, L2.remainQty], [2, 1, 1]);
    const over = await api('createArCreditNote', { invoiceId, reasonCode: 'return',
      creditDate: new Date().toISOString().slice(0, 10), vatRate: d.vatRate,
      lines: [{ itemId: L2.itemId, productId: P, unitCode: 'CT', unitFactor: L2.unitFactor, qty: 2, unitPrice: 1, taxStatus: L2.taxStatus }] });
    ck('★★★ ลดเกินจำนวนที่เหลือ → ปฏิเสธ แม้ยอดเงินจะต่ำมาก',
      [over.success, /เกินจำนวนที่ยังลดได้/.test(over.message || '')], [false, true]);

    console.log('\n══ 8. รับคืนตรงๆ: เลือกคลังของเสีย ══');
    const gd = await api('getGoodsReturnDraft', { orderId });
    ck('ร่างใบรับคืนบอกคลังปลายทางและค่าตั้งต้น',
      [(gd.warehouses || []).length >= 3, String(gd.defaultWarehouseId.damaged) === String(SCRAP)], [true, true]);
    const GL = (gd.lines || [])[0] || {};
    ck('★ ราคาบนร่างใบรับคืน = ราคาที่ขายจริงเท่ากับฝั่งใบลดหนี้', GL.unitPrice, sold);
    const scrapBefore = await qtyAt(SCRAP);
    const gr = await api('createGoodsReturn', { orderId, reasonCode: 'damaged',
      returnDate: new Date().toISOString().slice(0, 10),
      lines: [{ itemId: GL.itemId, qty: 1, condition: 'damaged', warehouseId: SCRAP }] });
    ck('★★ รับคืนเข้าคลังของเสียได้', gr.success, true);
    console.log('   ' + (gr.message || ''));
    ck('★★★ ของเข้าคลังของเสียจริง (เดิมของเสียหายไปจากระบบเลย)',
      r2(await qtyAt(SCRAP) - scrapBefore), GL.unitFactor);
    ck('★ นับเป็น "ไม่ใช่ของขายได้" ทั้งก้อน', [gr.restockQty, gr.scrapQty], [0, GL.unitFactor]);

    console.log('\n══ 9. เก็บกวาด ══');
    const back = await api('cancelGoodsReturn', { id: gr.returnId, reason: 'E2E cleanup' });
    ck('ยกเลิกใบรับคืนที่ยังไม่ออกใบลดหนี้ได้', back.success, true);
    ck('★ ของถูกหักออกจากคลังของเสีย ไม่ใช่คลังขาย',
      [r2(await qtyAt(SCRAP) - scrapBefore), r2(await qtyAt(SALE) - saleQty)], [0, 0]);
  } catch (e) {
    failed++; console.error('\nล้มกลางทาง: ' + e.message);
  }

  console.log('\n★ บิลทดสอบ ' + (orderId || '-') + ' ยกเลิกไม่ได้เพราะออกใบลดหนี้ไปแล้ว — ปล่อยไว้เป็นหลักฐาน');
  console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
