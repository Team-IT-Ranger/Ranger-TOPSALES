// ทดสอบปลายทางบน UAT: งานซื้อทั้งสาย (ผู้ขาย → สายอนุมัติ → ใบขอซื้อ → อนุมัติ → ใบสั่งซื้อ → รับของ) + บัญชี (ตั้งหนี้ → จ่าย → ลูกหนี้ → งบ)
// node .dev/uat-purchasing-e2e.js   (ต้องตั้ง UAT_URL — ห้ามชี้ production)
// หมายเหตุ: เอกสารที่ลงบัญชีแล้ว (ใบรับของ/ใบสำคัญ/ใบแจ้งหนี้) ลบไม่ได้ตามหลักบัญชี — สคริปต์นี้จึงทิ้งเอกสารทดสอบไว้ใน UAT
//           (ตั้งชื่อขึ้นต้นด้วย E2E ทุกใบ) ใบขอซื้อ/ใบสั่งซื้อที่ยังไม่รับของจะถูกยกเลิกให้ตอนจบ
const URL_ = process.env.UAT_URL, USER = process.env.UAT_USER || 'admin', PASS = process.env.UAT_PASS || 'ChangeMe123!';
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ (เทสต์ชุดนี้เขียนข้อมูลจริง ห้ามยิงใส่ dev/production)'); process.exit(1); }
const post = async body => { for (let i = 0; i < 3; i++) { try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' })).json(); } catch (e) { if (i === 2) throw e; } } };
let failed = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) failed++; };
const today = new Date().toISOString().slice(0, 10);
const stamp = Date.now().toString().slice(-6);

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.success) { console.error('ล็อกอินไม่ได้: ' + login.message); process.exit(1); }
  const api = (action, payload) => post({ action, token: login.token, payload: payload || {} });
  let prId, poId, flowId;
  try {
    // ── ข้อมูลตั้งต้น ──
    const products = (await api('listProductsAdmin')).data || [];
    const prod = products.filter(p => String(p.is_active) !== 'FALSE')[0];
    if (!prod) { console.error('UAT ไม่มีสินค้า'); process.exit(1); }
    let r = await api('saveVendor', { code: 'E2E-' + stamp, name: 'E2E ผู้ขายทดสอบ ' + stamp, paymentTermsDays: 30 });
    check('สร้างผู้ขาย', r.success, r);
    const vendorId = r.vendor.id;
    r = await api('listWarehouses');
    check('มีคลังกลางอย่างน้อย 1 แห่ง (seed ตอน setup)', r.success && r.data.length > 0, r);
    const warehouseId = (r.data.find(w => w.isDefault) || r.data[0]).id;

    // ── สายอนุมัติ 2 ขั้น ──
    r = await api('saveApprovalFlow', { docType: 'PR', name: 'E2E สายทดสอบ ' + stamp, minAmount: 0, maxAmount: null,
      steps: [{ name: 'ขั้นที่ 1', approverType: 'role', approverRef: 'super_admin', requiredApprovals: 1 },
              { name: 'ขั้นที่ 2', approverType: 'role', approverRef: 'super_admin', requiredApprovals: 1 }] });
    check('สร้างสายอนุมัติ 2 ขั้น', r.success && r.flow.steps.length === 2, r);
    flowId = r.flow.id;

    // ── ใบขอซื้อ → อนุมัติ 2 ขั้น ──
    r = await api('savePurchaseRequisition', { department: 'E2E', note: 'E2E test ' + stamp,
      items: [{ productId: prod.record_id, qty: 100, unitCode: prod.unit || 'ชิ้น', unitPrice: 10 }] });
    check('เปิดใบขอซื้อ', r.success && r.pr.totalExVat === 1000, r);
    prId = r.pr.id;
    r = await api('submitPurchaseRequisition', { id: prId });
    check('ส่งขออนุมัติ → รอขั้น 1', r.success && r.pr.status === 'pending' && r.pr.currentStep === 1, r);
    r = await api('savePurchaseRequisition', { id: prId, items: [{ productId: prod.record_id, qty: 1, unitPrice: 1 }] });
    check('ระหว่างรออนุมัติแก้ไม่ได้', r.success === false, r);
    r = await api('decidePurchaseRequisition', { id: prId, decision: 'approve', comment: 'E2E ขั้น 1' });
    check('อนุมัติขั้น 1 → เลื่อนไปขั้น 2', r.success && r.pr.status === 'pending' && r.pr.currentStep === 2, r);
    r = await api('decidePurchaseRequisition', { id: prId, decision: 'approve', comment: 'E2E ขั้น 2' });
    check('อนุมัติขั้น 2 → อนุมัติทั้งใบ', r.success && r.pr.status === 'approved', r);

    // ── ใบสั่งซื้อจากใบขอซื้อ ──
    const lines = (await api('listApprovedPrLines')).data.filter(l => String(l.prId) === String(prId));
    check('ใบขอซื้อมีรายการค้างให้ออก PO', lines.length === 1 && lines[0].remainQty === 100, lines);
    r = await api('savePurchaseOrder', { vendorId, warehouseId, orderDate: today, vatType: 'excluded', note: 'E2E ' + stamp,
      items: [{ prItemId: lines[0].prItemId, productId: prod.record_id, qty: 100, unitCode: prod.unit || 'ชิ้น', unitFactor: 1, unitPrice: 10 }] });
    check('เปิดใบสั่งซื้อจากใบขอซื้อ (1,000 + VAT = 1,070)', r.success && r.po.total === 1070, r);
    poId = r.po.id;
    const poItemId = r.po.items[0].id;
    r = await api('issuePurchaseOrder', { id: poId });
    check('ส่งให้ผู้ขาย → sent', r.success && r.po.status === 'sent', r);
    check('  ใบขอซื้อถูกปิดเพราะออก PO ครบ', (await api('getPurchaseRequisition', { id: prId })).pr.status === 'closed');

    // ── รับของเข้าคลัง (แบ่ง 2 ครั้ง) ──
    const stockBefore = (await api('listWarehouseStock', { warehouseId })).data.find(s => String(s.productId) === String(prod.record_id));
    const qtyBefore = stockBefore ? stockBefore.qty : 0;
    r = await api('receiveGoods', { poId, warehouseId, receiveDate: today, items: [{ poItemId, qty: 60 }] });
    check('รับของครั้งที่ 1 (60) → partial', r.success && r.po.status === 'partial', r);
    const grId = r.grId;
    r = await api('receiveGoods', { poId, warehouseId, receiveDate: today, items: [{ poItemId, qty: 41 }] });
    check('รับเกินยอดค้าง → ปฏิเสธ', r.success === false, r);
    r = await api('receiveGoods', { poId, warehouseId, receiveDate: today, items: [{ poItemId, qty: 40 }] });
    check('รับของครั้งที่ 2 (40) → received', r.success && r.po.status === 'received', r);
    const stockAfter = (await api('listWarehouseStock', { warehouseId })).data.find(s => String(s.productId) === String(prod.record_id));
    check('สต็อกเพิ่มขึ้น 100 หน่วยฐาน', stockAfter && Math.abs(stockAfter.qty - (qtyBefore + 100)) < 0.001, { qtyBefore, after: stockAfter && stockAfter.qty });

    // ── บัญชี: ตั้งหนี้ → จ่าย ──
    r = await api('createApBillFromGr', { grId, vendorInvoiceNo: 'E2E-INV-' + stamp, billDate: today });
    check('ตั้งหนี้จากใบรับของครั้งที่ 1 (600 + VAT = 642)', r.success && r.total === 642, r);
    const billId = r.billId;
    r = await api('createApBillFromGr', { grId, billDate: today });
    check('ตั้งหนี้ซ้ำจากใบรับของเดิม → ปฏิเสธ', r.success === false, r);
    r = await api('payApBills', { vendorId, paymentDate: today, method: 'transfer', allocations: [{ billId, amount: 642 }] });
    check('จ่ายเจ้าหนี้เต็มจำนวน', r.success && r.amount === 642, r);
    const bill = (await api('listApBills', { vendorId })).data.find(b => b.id === billId);
    check('  ใบแจ้งหนี้เป็น paid ไม่มียอดค้าง', bill && bill.status === 'paid' && bill.outstanding === 0, bill);
    const aging = await api('getApAging', {});
    check('รายงานอายุหนี้เจ้าหนี้เรียกได้', aging.success, aging);

    // ── บัญชี: ลูกหนี้ ──
    const customers = (await api('listCustomersAdmin')).data || [];
    if (customers.length) {
      r = await api('createArInvoice', { customerId: customers[0].record_id, invoiceDate: today, dueDays: 30, subtotalExVat: 1000, note: 'E2E ' + stamp });
      check('ออกใบแจ้งหนี้ลูกค้า (1,000 + VAT = 1,070)', r.success && r.total === 1070, r);
      const invId = r.invoiceId;
      r = await api('receiveArPayment', { customerId: customers[0].record_id, receiptDate: today, method: 'transfer', allocations: [{ invoiceId: invId, amount: 500 }] });
      check('รับชำระบางส่วน 500', r.success && r.amount === 500, r);
      const inv = (await api('listArInvoices', {})).data.find(x => x.id === invId);
      check('  ใบแจ้งหนี้เป็น partial ค้าง 570', inv && inv.status === 'partial' && inv.outstanding === 570, inv);
      check('รายงานอายุหนี้ลูกหนี้เรียกได้', (await api('getArAging', {})).success);
    } else console.log('SKIP ลูกหนี้ — UAT ไม่มีลูกค้า');

    // ── งบ ──
    const tb = await api('getTrialBalance', {});
    check('งบทดลองสมดุล', tb.success && Math.abs(tb.totalDebit - tb.totalCredit) < 0.01, { d: tb.totalDebit, c: tb.totalCredit });
    const stockValue = (await api('listWarehouseStock', {})).totalValue;
    const invAcct = tb.data.find(a => a.code === '1300');
    check('บัญชีสินค้าคงเหลือ (1300) = มูลค่าสต็อกจริงในคลัง', invAcct && Math.abs(invAcct.balance - stockValue) < 0.01, { gl: invAcct && invAcct.balance, stock: stockValue });
    const bs = await api('getBalanceSheet', {});
    check('งบดุลสมดุล', bs.success && bs.balanced, bs);
    check('งบกำไรขาดทุนเรียกได้', (await api('getIncomeStatement', {})).success);
  } finally {
    // เก็บกวาดเท่าที่ลบได้: ปิดสายอนุมัติทดสอบ (เอกสารบัญชีลบไม่ได้ตามหลักการ)
    if (flowId) { const d = await api('deleteApprovalFlow', { id: flowId }); check('ลบสายอนุมัติทดสอบ', d.success, d); }
    console.log('หมายเหตุ: ใบขอซื้อ/ใบสั่งซื้อ/ใบรับของ/ใบสำคัญที่ขึ้นต้นด้วย E2E ยังอยู่ใน UAT (ลบไม่ได้ตามหลักบัญชี)');
    await post({ action: 'adminLogout', token: login.token });
  }
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
