/**
 * เดินบิลขายครบสายบน UAT เพื่อดูว่า "เลขเอกสารแต่ละชนิด" ออกจริงตามจังหวะที่ออกแบบไว้
 * และใบแจ้งหนี้ลูกหนี้ถูกตั้งให้อัตโนมัติตอน "พร้อมจัดส่ง"
 *
 *   BACKEND_URL='<uat exec url>' ADMIN_USER='<user>' ADMIN_PASS='<pass>' node .dev/uat-sale-docs-e2e.js
 *
 * ★ ปฏิเสธการรันกับ prod เป็นตัวกันพลาด (สคริปต์นี้เปิดบิลจริง)
 * ★ ทิ้งบิลทดสอบไว้ 1 ใบ แล้วยกเลิกให้ตอนจบ (ยกเลิกแล้วสต็อก/ยอดขายรายวันถูกคืนให้เอง)
 */
const ENDPOINT = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!ENDPOINT || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }
if (/AKfycbxGSgR4/.test(ENDPOINT)) { console.error('★ นี่คือ URL ของ production — สคริปต์นี้เปิดบิลจริง ห้ามรันกับ prod'); process.exit(1); }

let TOKEN = null;
const call = async (action, payload) => {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: TOKEN, payload: payload || {} }) });
  const t = await res.text();
  try { return JSON.parse(t); } catch (e) { return { success: false, message: t.slice(0, 200) }; }
};

let failed = 0;
const chk = (label, cond, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failed++;
};

(async () => {
  const l = await call('adminLogin', { username: USER, password: PASS });
  if (!l.success) { console.error('ล็อกอินไม่สำเร็จ: ' + l.message); process.exit(1); }
  TOKEN = l.token;
  console.log('ล็อกอิน: ' + l.displayName + ' (' + l.roleCode + ')\n');

  // หาลูกค้าเครดิตและสินค้าที่ขายได้จริง
  const cs = await call('listCustomersAdmin', {});
  const cust = (cs.customers || []).find(c => c.groupId && c.isActive !== false) || (cs.customers || [])[0];
  if (!cust) { console.error('ไม่มีลูกค้าใน UAT'); process.exit(1); }
  const ps = await call('listProductsAdmin', {});
  /* ★ ต้องเป็นสินค้าที่ "ขายได้จริงกับลูกค้ารายนี้" ไม่ใช่แถวแรกของทะเบียน —
     สินค้าที่ปิดใช้งาน หรือไม่อยู่ในชุดราคาของกลุ่มลูกค้านั้น จะถูกปฏิเสธตอนเปิดบิล */
  const cands = (ps.data || []).filter(p => p.is_active !== false && p.is_active !== 'FALSE');
  console.log('ลูกค้า: ' + (cust.name || cust.fullName) + ' (กลุ่ม ' + cust.groupId + ') · ' +
    'สินค้าที่ใช้งานอยู่ ' + cands.length + ' รายการ\n');

  /* ★ สำนักงานจัดส่งตัดจากคลังกลาง ไม่ใช่สต็อกรถ — ของไม่พอแล้วกด "พร้อมจัดส่ง" ไม่ผ่าน
     (เคสนี้เคยทำให้ e2e ตัวเก่าพังมาแล้ว — ดูบันทึกใน docs/who-is-doing-what.md 28 ก.ย.)
     จึงต้องรับของเข้าคลังก่อนเสมอ ไม่ใช่ข้อบกพร่องของระบบ */
  console.log('── เติมของเข้าคลังกลางก่อน (สำนักงานจัดส่งตัดจากคลังนี้) ──');
  const vendor = await call('saveVendor', { name: 'ผู้ขายทดสอบ E2E เอกสาร' });
  const vId = vendor.vendor && vendor.vendor.id;
  async function stockUp(productId, unitCode) {
    if (!vId) return false;
    const po = await call('savePurchaseOrder', { vendorId: vId, orderDate: '2026-10-01', vatType: 'none',
      items: [{ productId: productId, qty: 10, unitCode: unitCode, unitFactor: 600, unitPrice: 1 }] });
    if (!po.success) return false;
    await call('issuePurchaseOrder', { id: po.po.id });
    const gr = await call('receiveGoods', { poId: po.po.id, items: po.po.items.map(it => ({ poItemId: it.id, qty: 10 })) });
    return gr.success;
  }

  console.log('── เปิดบิลขายเชื่อ แบบสำนักงานจัดส่ง ──');
  let sale = null, lastMsg = '';
  for (const p of cands.slice(0, 12)) {
    for (const u of [p.sales_unit_code, p.unit_code, 'CT', 'PC']) {
      if (!u) continue;
      sale = await call('recordSaleAdmin', {
        customerId: cust.id, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
        items: [{ productId: p.record_id, unitCode: u, qty: 1 }],
        note: 'E2E ตรวจเลขเอกสาร (ยกเลิกให้ตอนจบ)', requestId: 'e2e-docs-' + Date.now()
      });
      if (sale.success) {
        console.log('   สินค้า: ' + p.name + ' (' + u + ')');
        console.log('   เติมของเข้าคลัง: ' + (await stockUp(p.record_id, u) ? 'สำเร็จ' : 'ไม่สำเร็จ'));
        break;
      }
      lastMsg = sale.message;
    }
    if (sale && sale.success) break;
  }
  if (!sale || !sale.success) { console.error('เปิดบิลไม่สำเร็จ: ' + lastMsg); process.exit(1); }
  const id = sale.orderId || sale.id;
  console.log('   เปิดบิล ' + (sale.orderCode || '') + ' (id ' + id + ')');

  const get = async () => (await call('getSalesOrderAdmin', { id })).order || {};
  let o = await get();
  chk('เปิดบิลแล้วยังไม่มีเลขเอกสารชนิดอื่นเลย',
    !o.pickingNo && !o.deliveryOrderNo && !o.taxInvoiceNo && !o.receiptNo,
    'picking=' + (o.pickingNo || '-') + ' do=' + (o.deliveryOrderNo || '-') + ' tax=' + (o.taxInvoiceNo || '-') + ' rc=' + (o.receiptNo || '-'));

  console.log('\n── รับงาน → พร้อมจัดส่ง ──');
  let r = await call('updateSalesOrderStatus', { id, status: 'accepted' });
  if (!r.success) console.log('   (รับงาน: ' + r.message + ')');
  r = await call('updateSalesOrderStatus', { id, status: 'ready_to_ship' });
  console.log('   ' + (r.message || r.message));
  if (r.warning) console.log('   ⚠️ ' + r.warning);
  o = await get();
  chk('ออกเลขใบจัดของ', /^PICK-/.test(o.pickingNo || ''), o.pickingNo || '(ไม่มี)');
  chk('ออกเลขใบส่งสินค้า', /^DO-/.test(o.deliveryOrderNo || ''), o.deliveryOrderNo || '(ไม่มี)');
  chk('ออกเลขใบกำกับภาษี', /^TAX-/.test(o.taxInvoiceNo || ''), o.taxInvoiceNo || '(ไม่มี)');
  chk('ยังไม่ออกใบเสร็จ (ยังไม่ได้เงิน)', !o.receiptNo, o.receiptNo || '(ว่าง ถูกต้อง)');
  chk('ตั้งลูกหนี้ให้อัตโนมัติ + มีเลขใบแจ้งหนี้', /^INV-/.test(o.arInvoiceNo || ''), o.arInvoiceNo || '(ไม่มี)');

  console.log('\n── ถอยกลับแล้วเดินหน้าใหม่ (ต้องได้เลขเดิม) ──');
  const before = { p: o.pickingNo, d: o.deliveryOrderNo, t: o.taxInvoiceNo };
  await call('updateSalesOrderStatus', { id, status: 'accepted' });
  await call('updateSalesOrderStatus', { id, status: 'ready_to_ship' });
  o = await get();
  chk('เลขทั้งสามไม่เปลี่ยน ไม่กินตัวนับเพิ่ม',
    o.pickingNo === before.p && o.deliveryOrderNo === before.d && o.taxInvoiceNo === before.t,
    o.pickingNo + ' · ' + o.deliveryOrderNo + ' · ' + o.taxInvoiceNo);

  console.log('\n── บันทึกรับชำระบางส่วน ──');
  const half = Math.max(1, Math.round((o.total || 2) / 2));
  r = await call('updateSalesOrderStatus', { id, paidAmount: half });
  console.log('   ' + (r.message || ''));
  o = await get();
  chk('ออกเลขใบเสร็จตอนได้เงินครั้งแรก', /^RC-/.test(o.receiptNo || ''), o.receiptNo || '(ไม่มี)');
  const rc1 = o.receiptNo;
  await call('updateSalesOrderStatus', { id, paidAmount: o.total });
  o = await get();
  chk('รับงวดที่สองใช้ใบเสร็จใบเดิม', o.receiptNo === rc1, o.receiptNo);

  console.log('\n── เก็บกวาด ──');
  const c = await call('cancelSalesOrderAdmin', { id, reason: 'E2E ตรวจเลขเอกสาร' });
  console.log('   ' + (c.success ? 'ยกเลิกบิลทดสอบแล้ว' : 'ยกเลิกไม่สำเร็จ: ' + c.message));

  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
