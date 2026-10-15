// ทดสอบปลายทางถึงปลายทางบน UAT: รอบจัดส่ง → ใบกำกับภาษี/ใบแจ้งหนี้รายรอบ → ไฟเขียว/ส้มของหน้ารายการ
// รัน: UAT_URL='<uat exec url>' node .dev/uat-delivery-rounds-e2e.js
//
// ทิ้งอะไรไว้บน UAT บ้าง: บิลขาย 1 ใบที่เดินจนปิดงาน (ลบไม่ได้ตามหลักบัญชี เพราะออกใบกำกับภาษีไปแล้ว)
// + ใบสั่งซื้อ/ใบรับของของการเติมสต็อกระหว่างทาง · บิลที่ใช้ทดสอบไฟสถานะถูกยกเลิกให้เองตอนจบ
//
// ★ บทเรียนตอนเขียนครั้งแรก: อย่าคาดหมายสีไฟเป็นค่าตายตัว — ไฟตอบว่า "ใบนี้หยิบของได้จริงไหม"
//   ซึ่งขึ้นกับว่ามีบิลอื่นกันของชิ้นเดียวกันไว้หรือยัง · เทสต์จึงต้องเทียบกับ getSaleDeliveryPlan
//   ของใบเดียวกัน ไม่ใช่เขียนว่า "ต้องเป็นสีส้ม" แล้วสงสัยโค้ดเวลามันไม่ตรง
const URL_ = process.env.UAT_URL;
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ (เทสต์ชุดนี้เขียนข้อมูลจริง)'); process.exit(1); }

const T = process.env.UAT_TENANT || 'BDC';
const CUST = Number(process.env.UAT_CUSTOMER || 1113);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
let failed = 0;
const ck = (name, ok, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n      ' + JSON.stringify(extra === undefined ? null : extra).slice(0, 400))); if (!ok) failed++; };
const post = async body => {
  for (let i = 0; i < 3; i++) {
    try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).json(); }
    catch (e) { if (i === 2) throw e; }
  }
};

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: process.env.UAT_USER || 'admin', password: process.env.UAT_PASS || 'ChangeMe123!' } });
  if (!login.success) { console.error('ล็อกอินไม่ผ่าน', login); process.exit(1); }
  /* ★ ยิงรัวๆ จะชน `_withDocLock` ("ระบบกำลังบันทึกเอกสารอยู่") — คนกดหน้าจอไม่เร็วขนาดนี้
     สคริปต์จึงต้องรอแล้วลองใหม่เอง ไม่ใช่ถือว่าระบบพัง */
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
  const factorOf = async pid => Number((((await api('listProductUnits', { productId: pid })).data || [])
    .find(u => u.unit_code === 'CT') || {}).unit_factor) || 1;

  /* ── เลือกสินค้าที่ยังไม่มีใครจอง เพื่อไม่ไปแย่งของบิลจริง ──
     ★★ เลือกตัวที่ของ **น้อยที่สุด** ที่ยังพอขายได้ ไม่ใช่มากที่สุด — เทสต์ต้องสั่งเกินของที่มีเพื่อให้เกิด
       ของค้างส่ง ถ้าไปหยิบสินค้าที่มีของ 36,000 ชิ้น บิลทดสอบจะกลายเป็นเจ็ดแสนบาทและตัดสต็อกเกลี้ยงคลัง
       (เคยพลาดมาแล้วจริงๆ 15 ต.ค. 2026 ต้องตามเก็บกวาดทั้งยกเลิกบิล คืนของ และกลับรายการบัญชี) */
  const wh = (await api('listWarehouseStock')).data || [];
  const free = wh.filter(w => Number(w.qty) > 0 && !Number(w.reserved)).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
  if (!free) { console.error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ'); process.exit(1); }
  const P = free.productId, factor = await factorOf(P);
  const have = await stockOf(P), canCT = Math.floor(have / factor);
  console.log('สินค้า', free.productCode, '·', have, 'ชิ้น · 1 ลัง =', factor, 'ชิ้น → ส่งได้', canCT, 'ลัง\n');

  /* ══ ไฟเขียว/ส้ม: เทียบกับแผนจัดส่งของใบเดียวกันเสมอ ══ */
  console.log('══ ไฟสถานะของในหน้ารายการบิล ══');
  const flagOf = async id => ((await api('getSalesOrderStockFlags', {})).flags || {})[String(id)] || null;
  const expectFlag = async id => {
    const plan = await api('getSaleDeliveryPlan', { id });
    const lines = plan.lines.map(x => ({ need: (x.ordered - x.shipped) * x.factor, pick: x.onHand - x.reservedOther }));
    const short = lines.filter(x => x.pick + 0.0001 < x.need).length;
    return short === 0 ? 'full' : (lines.some(x => x.pick > 0.0001) ? 'partial' : 'none');
  };

  let r = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
    items: [{ productId: P, unitCode: 'CT', qty: Math.max(1, canCT - 1) }], note: 'E2E ไฟสถานะ (ยกเลิกเอง)' });
  ck('สั่งน้อยกว่าของที่มี → ไฟเขียว', (await flagOf(r.orderId) || {}).flag === 'full', await flagOf(r.orderId));
  await api('cancelSalesOrderAdmin', { id: r.orderId, note: 'E2E' });

  r = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
    items: [{ productId: P, unitCode: 'CT', qty: canCT + 3 }], note: 'E2E ไฟสถานะ (ยกเลิกเอง)' });
  ck('สั่งเกินของที่มี แต่ยังมีของบ้าง → ไฟส้ม', (await flagOf(r.orderId) || {}).flag === 'partial', await flagOf(r.orderId));
  ck('  และไฟตรงกับที่คำนวณจากแผนจัดส่งของใบเดียวกัน', (await flagOf(r.orderId) || {}).flag === await expectFlag(r.orderId));
  await api('cancelSalesOrderAdmin', { id: r.orderId, note: 'E2E' });

  /* ══ รอบจัดส่ง + ใบกำกับภาษี/ใบแจ้งหนี้รายรอบ ══ */
  console.log('\n══ ใบกำกับภาษี/ใบแจ้งหนี้ ตามรอบจัดส่ง ══');
  const orderCT = canCT + 2;                      // สั่งเกินของที่มี 2 ลัง
  r = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
    items: [{ productId: P, unitCode: 'CT', qty: orderCT }] });
  ck('เปิดบิลขายเชื่อได้แม้ของไม่พอ (เตือนอย่างเดียว)', r.success && !!r.stockWarning, r);
  const id = r.orderId, billTotal = r.total;
  console.log('   บิล', r.orderCode, 'B' + billTotal, '\n');

  await api('updateSalesOrderStatus', { id, status: 'accepted' });
  let plan = await api('getSaleDeliveryPlan', { id });
  r = await api('saveDeliveryRound', { id, lines: [{ itemId: plan.lines[0].itemId, qty: canCT }] });
  ck('แยกรอบ 1 = ส่งเท่าที่มี · ค้าง 1 รายการ', r.success && r.shortLines === 1, r);

  r = await api('updateSalesOrderStatus', { id, status: 'ready_to_ship' });
  ck('รอบ 1 พร้อมจัดส่ง: ตัดสต็อก + ออกใบกำกับภาษี + ตั้งลูกหนี้ของรอบ',
    r.success && /ใบกำกับภาษี/.test(r.message) && /ตั้งลูกหนี้/.test(r.message), r);
  plan = await api('getSaleDeliveryPlan', { id });
  const R1 = plan.rounds[0];
  ck('  รอบ 1 มีเลขใบกำกับ/ใบแจ้งหนี้ของตัวเอง และยอดน้อยกว่ายอดบิล (ส่งไปแค่บางส่วน)',
    !!R1.taxInvoiceNo && !!R1.arInvoiceNo && R1.invoiced && R1.total < billTotal,
    { tax: R1.taxInvoiceNo, inv: R1.arInvoiceNo, total: R1.total, bill: billTotal });
  ck('  ก่อนภาษี + ภาษี = ยอดของรอบเป๊ะ', r2(R1.subtotalExVat + R1.vatAmount), R1.total);
  const iv1 = ((await api('listArInvoices', {})).data || []).find(x => String(x.invoiceNo) === String(R1.arInvoiceNo));
  ck('  ใบแจ้งหนี้ในสมุดบัญชี ยอดตรงกับรอบ และผูกกับบิลขายใบนี้',
    !!iv1 && r2(iv1.total) === R1.total && String(iv1.salesOrderId) === String(id), iv1);

  await api('updateSalesOrderStatus', { id, status: 'delivering' });
  r = await api('updateSalesOrderStatus', { id, status: 'completed' });
  ck('กดจัดส่งสำเร็จขณะยังมีของค้าง → ปิดรอบ 1 เปิดรอบ 2 บิลกลับไปขั้นรับงาน',
    r.success && r.status === 'accepted' && /ปิดรอบที่ 1/.test(r.message), r);

  r = await api('updateSalesOrderStatus', { id, status: 'ready_to_ship' });
  ck('ของค้างยังไม่เข้าคลัง → เดินหน้าไม่ได้ และบอกว่าขาดเท่าไร', !r.success && /ไม่พอ/.test(r.message || ''), r);

  const vendor = await api('saveVendor', { name: 'E2E ผู้ขายรอบจัดส่ง' });
  const po = await api('savePurchaseOrder', { vendorId: (vendor.vendor || {}).id, orderDate: new Date().toISOString().slice(0, 10),
    vatType: 'none', items: [{ productId: P, qty: 2, unitCode: 'ลัง', unitFactor: factor, unitPrice: 1 }] });
  await api('issuePurchaseOrder', { id: po.po.id });
  await api('receiveGoods', { poId: po.po.id, items: po.po.items.map(it => ({ poItemId: it.id, qty: 2 })) });

  r = await api('updateSalesOrderStatus', { id, status: 'ready_to_ship' });
  ck('ของเข้าแล้ว → รอบ 2 เดินหน้าได้ และออกใบกำกับภาษี/ใบแจ้งหนี้ใบใหม่',
    r.success && /ใบกำกับภาษี/.test(r.message), r);
  await api('updateSalesOrderStatus', { id, status: 'delivering' });
  r = await api('updateSalesOrderStatus', { id, status: 'completed' });
  ck('ส่งครบ → บิลปิดจริง', r.success && r.status === 'completed', r);

  plan = await api('getSaleDeliveryPlan', { id });
  const [a1, a2] = plan.rounds;
  ck('ได้ใบกำกับภาษี 2 ใบคนละเลข · ใบแจ้งหนี้ 2 ใบคนละเลข',
    a1.taxInvoiceNo !== a2.taxInvoiceNo && a1.arInvoiceNo !== a2.arInvoiceNo && !!a2.taxInvoiceNo && !!a2.arInvoiceNo,
    plan.rounds.map(x => [x.roundNo, x.taxInvoiceNo, x.arInvoiceNo, x.total]));
  const d = await api('getSalesOrderAdmin', { id });
  ck('★★ ผลรวมทุกรอบ = ยอดบิลเป๊ะ (รวม · ก่อนภาษี · ภาษี)',
    [r2(a1.total + a2.total), r2(a1.subtotalExVat + a2.subtotalExVat), r2(a1.vatAmount + a2.vatAmount)],
    [r2(d.order.total), r2(d.order.subtotalExVat), r2(d.order.vatAmount)]);
  ck('  ยอดบิลไม่เคยขยับตั้งแต่ต้นจนจบ', d.order.total, billTotal);
  const mine = ((await api('listArInvoices', {})).data || []).filter(x => String(x.salesOrderId) === String(id));
  ck('  สมุดลูกหนี้มีสองใบของบิลนี้ รวมเท่ากับยอดบิล',
    mine.length === 2 && r2(mine.reduce((s, x) => s + Number(x.total), 0)) === r2(billTotal),
    mine.map(x => [x.invoiceNo, x.total]));

  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
