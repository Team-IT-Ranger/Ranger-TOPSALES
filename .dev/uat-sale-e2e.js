// ทดสอบปลายทางถึงปลายทางบน UAT: ชุดราคา → บิลขายจริง (recordSale) — ต้องตั้ง UAT_URL (ห้ามชี้ production!)
// node .dev/uat-sale-e2e.js
const URL_ = process.env.UAT_URL, USER = process.env.UAT_USER || 'admin', PASS = process.env.UAT_PASS || 'ChangeMe123!';
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ (เทสต์ชุดนี้เขียนข้อมูลจริง ห้ามยิงใส่ dev/production)'); process.exit(1); }
const post = async body => { for (let i = 0; i < 3; i++) { try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' })).json(); } catch (e) { if (i === 2) throw e; } } };
let failed = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) failed++; };

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  const token = login.token;
  const admin = (action, payload) => post({ action, token, payload: payload || {} });

  const lists = (await admin('listPriceLists')).data;
  const groups = (await admin('listCustomerGroups')).data;
  const bkkGroup = groups.find(g => g.name.includes('กทม.'));
  const bkkList = lists.find(l => l.customerGroupId === bkkGroup.record_id && l.name.includes('กทม.'));
  console.log('BKK group', bkkGroup.record_id, 'list', bkkList.id, bkkList.status);
  if (bkkList.status !== 'active') console.log('activate', JSON.stringify(await admin('setPriceListStatus', { id: bkkList.id, status: 'active' })));

  const products = (await admin('listProductsAdmin')).data;
  const ext = products.find(p => String(p.product_code) === '10189'), lav = products.find(p => String(p.product_code) === '10190');

  // 1) ทดลองคิดราคา (แอดมิน)
  let r = await admin('previewPricing', { customerGroupId: bkkGroup.record_id, paymentType: 'cash', isVan: true,
    items: [{ productCode: '10189', unitCode: 'CT', qty: 1 }, { productCode: '10190', unitCode: 'CT', qty: 1 }] });
  check('previewPricing: แซนดัลวูด 1 + ลาเวนเดอร์ 1 = 2 หีบรวม → 1,200 ต่อหีบ (2,400)', r.success && r.total === 2400 && r.lines.every(l => l.unitPrice === 1200), r);
  r = await admin('previewPricing', { customerGroupId: bkkGroup.record_id, paymentType: 'cash', isVan: false, items: [{ productCode: '10189', unitCode: 'PK', qty: 1 }] });
  check('previewPricing: แพ็คนอก Cash Van ถูกปฏิเสธ', !r.success && r.code === 'PACK_VAN_ONLY', r);

  // 2) ตัวแทน + ลูกค้า + พนักงานขาย (ของทดสอบบน UAT)
  const tid = 'UATP' + String(Date.now()).slice(-6);
  console.log('createTenant', tid, JSON.stringify(await admin('createTenant', { tenantId: tid, name: 'ตัวแทนทดสอบราคา', region: 'UAT' })).slice(0, 120));
  await admin('addCustomerAdmin', { tenantId: tid, name: 'ร้านทดสอบ กทม.', groupId: bkkGroup.record_id, phone: '0800000000' });
  const custs = (await admin('listCustomersAdmin', { tenantId: tid })).data;
  const cust = custs[custs.length - 1];
  check('ลูกค้าอยู่กลุ่ม กทม.', String(cust.group_id) === String(bkkGroup.record_id), cust);

  const uid = 'U_UATTEST_' + tid;
  await post({ action: 'registerUser', payload: { lineUid: uid, name: 'พนักงานทดสอบ', schema: tid } });
  console.log('approve', JSON.stringify(await admin('updateStaffAdmin', { lineUserId: uid, status: 'Yes', tenantId: tid })));

  const mobile = (action, payload) => post({ action, lineUserId: uid, payload });
  console.log('restock', JSON.stringify(await mobile('restockVan', { items: [{ productId: ext.record_id, qty: 3000 }, { productId: lav.record_id, qty: 3000 }] })));

  // 3) บิลจริง — เงินสด 1 + 1 หีบ (นับรวม 2 หีบ)
  const beforeQuote = await mobile('quoteSale', { customerId: cust.record_id, paymentType: 'cash', items: [{ productId: ext.record_id, unitCode: 'CT', qty: 1 }, { productId: lav.record_id, unitCode: 'CT', qty: 1 }] });
  check('quoteSale ตรงกับเครื่องยนต์ (2,400)', beforeQuote.success && beforeQuote.total === 2400 && beforeQuote.priceList && beforeQuote.priceList.id === bkkList.id, beforeQuote);

  let sale = await mobile('recordSale', { customerId: cust.record_id, paymentType: 'cash', items: [{ productId: ext.record_id, unitCode: 'CT', qty: 1 }, { productId: lav.record_id, unitCode: 'CT', qty: 1 }] });
  check('recordSale เงินสด 2 หีบรวม = 2,400', sale.success && sale.total === 2400, sale);

  sale = await mobile('recordSale', { customerId: cust.record_id, paymentType: 'credit_term', fulfillmentType: 'office_delivery', items: [{ productId: ext.record_id, unitCode: 'CT', qty: 1 }] });
  check('recordSale เครดิต 1 หีบ = 1,225', sale.success && sale.total === 1225, sale);

  sale = await mobile('recordSale', { customerId: cust.record_id, paymentType: 'cash', items: [{ productId: ext.record_id, unitCode: 'PK', qty: 2 }] });
  check('recordSale แพ็ค Cash Van เงินสด 2 แพ็ค = 202', sale.success && sale.total === 202, sale);

  sale = await mobile('recordSale', { customerId: cust.record_id, paymentType: 'credit_term', fulfillmentType: 'office_delivery', items: [{ productId: ext.record_id, unitCode: 'PK', qty: 1 }] });
  check('recordSale แพ็คแบบเครดิต ถูกปฏิเสธ', !sale.success && sale.code === 'PACK_CASH_ONLY', sale);

  sale = await mobile('recordSale', { customerId: cust.record_id, paymentType: 'cash', items: [{ productId: ext.record_id, unitCode: 'CT', qty: 0 }] });
  check('recordSale จำนวน 0 ถูกปฏิเสธ', !sale.success, sale);

  const prod = (await admin('listProductsAdmin')).data.find(p => p.record_id === ext.record_id);
  check('has_transactions ของสินค้าที่ขายถูกตั้ง TRUE', String(prod.has_transactions).toUpperCase() === 'TRUE', prod.has_transactions);

  const recent = await mobile('getRecentSales', {});
  console.log('recent sales sample:', JSON.stringify(recent).slice(0, 400));

  // 4) เปิดบิลขายจากแอดมินเอง (19_sales_admin.gs)
  r = await admin('previewSaleAdmin', { tenantId: tid, customerId: cust.record_id, paymentType: 'cash', fulfillmentType: 'office_delivery',
    items: [{ productId: ext.record_id, unitCode: 'CT', qty: 1 }, { productId: lav.record_id, unitCode: 'CT', qty: 1 }] });
  check('previewSaleAdmin ตรงกับเครื่องยนต์ (2,400)', r.success && r.total === 2400, r);

  sale = await admin('recordSaleAdmin', { tenantId: tid, customerId: cust.record_id, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
    items: [{ productId: ext.record_id, unitCode: 'CT', qty: 1 }] });
  check('recordSaleAdmin (office_delivery, เครดิต 1 หีบ) = 1,225', sale.success && sale.total === 1225, sale);
  const officeOrderId = sale.orderId;

  sale = await admin('recordSaleAdmin', { tenantId: tid, customerId: cust.record_id, paymentType: 'cash', fulfillmentType: 'immediate',
    items: [{ productId: ext.record_id, unitCode: 'PK', qty: 2 }] });
  check('recordSaleAdmin ตัดสต็อกทันทีแต่ไม่ระบุพนักงาน ถูกปฏิเสธ', !sale.success, sale);

  sale = await admin('recordSaleAdmin', { tenantId: tid, customerId: cust.record_id, paymentType: 'cash', fulfillmentType: 'immediate', soldByLineUserId: uid,
    items: [{ productId: ext.record_id, unitCode: 'PK', qty: 2 }] });
  check('recordSaleAdmin (immediate ตัดสต็อกพนักงาน, แพ็คเงินสด 2 แพ็ค) = 202', sale.success && sale.total === 202, sale);
  const immediateOrderId = sale.orderId;

  const listed = await admin('listSalesOrdersAdmin', { tenantId: tid });
  check('listSalesOrdersAdmin เห็นบิลที่เพิ่งเปิดทั้งสองใบ', listed.success && listed.data.some(o => o.id === officeOrderId) && listed.data.some(o => o.id === immediateOrderId), listed);

  const detail = await admin('getSalesOrderAdmin', { tenantId: tid, id: officeOrderId });
  check('getSalesOrderAdmin รายละเอียดตรง (1,225 · 1 รายการ)', detail.success && detail.order.total === 1225 && detail.items.length === 1, detail);

  const cancel = await admin('cancelSalesOrderAdmin', { tenantId: tid, id: immediateOrderId });
  check('cancelSalesOrderAdmin ยกเลิกบิลที่ตัดสต็อกแล้วสำเร็จ', cancel.success, cancel);
  const afterCancel = await admin('listSalesOrdersAdmin', { tenantId: tid, status: 'cancelled' });
  check('บิลที่ยกเลิกสถานะเป็น cancelled', afterCancel.success && afterCancel.data.some(o => o.id === immediateOrderId), afterCancel);

  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
