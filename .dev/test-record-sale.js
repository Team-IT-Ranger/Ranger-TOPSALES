// รัน: node .dev/test-record-sale.js
// harness ของ recordSale() (07_sales.gs) ทั้งเส้น — ช่องว่างที่ who-is-doing-what.md ชี้ไว้ว่ายังไม่มี unit test เลย
// (มีแต่ _priceSaleCart ใน .dev/test-sales.js) โดยเฉพาะเส้นทาง "แก้ใบร่าง" (payload.editOrderCode, เพิ่ม 2 ต.ค. 2026)
// ซึ่งตอนนี้ตรวจด้วย e2e บน UAT อย่างเดียว — mock เฉพาะจุดที่ recordSale เรียกจริง ไม่โหลดไฟล์อื่นทั้งก้อน
// (แพทเทิร์นเดียวกับ .dev/test-sales-status.js) แล้ว override _priceSaleCart หลังโหลดไฟล์ (lookup เป็น global
// ตอนเรียก ไม่ใช่ closure — override ทีหลังได้ปกติ)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

// ── ชีตจำลองของตัวแทน T1 ──
// van_stock/order_items ต้องเดินผ่าน "สมุดจำลองแบบ getDataRange/getRange/appendRow/deleteRow" ให้จริง
// เพราะ _cutVanStock (tenantSheet ตรงๆ) และ deleteRowsWhere (02_helpers.gs ของจริง) ใช้ API นี้ ไม่ใช่ array ธรรมดา
const HEADERS = {
  van_stock: ['line_user_id', 'product_id', 'qty'],
  order_items: ['record_id', 'order_id', 'product_id', 'unit_code', 'unit_factor', 'qty', 'base_qty',
    'price', 'line_total', 'unit_discount', 'line_discount', 'list_price_ex_vat', 'is_free', 'tax_status']
};
function sheetView(name) {
  const hdr = HEADERS[name];
  const rows = sheets[name];
  return {
    getName: () => name,
    getDataRange: () => ({ getValues: () => [hdr].concat(rows.map(r => hdr.map(h => (r[h] === undefined ? '' : r[h])))) }),
    getRange: (row, col) => ({ setValue: v => { rows[row - 2][hdr[col - 1]] = v; } }),
    appendRow: arr => { const o = {}; hdr.forEach((h, i) => { o[h] = arr[i]; }); rows.push(o); },
    deleteRow: row => { rows.splice(row - 2, 1); }
  };
}
let sheets, dailyBumps, statusLogs, officeStockResult;
const CENTRAL = {};   // ตารางกลางเพิ่มเติม (blitz_*) — ว่าง = ไม่มีแคมเปญ
function reset() {
  sheets = {
    sales_orders: [], order_items: [], order_discounts: [], stock_movements: [],
    van_stock: [{ line_user_id: 'U1', product_id: '101', qty: 50 }, { line_user_id: 'U1', product_id: '102', qty: 3 }]
  };
  dailyBumps = [];
  statusLogs = [];
  officeStockResult = { success: true };
}
reset();

const PRODUCTS = [
  { record_id: 101, name: 'สินค้า A', base_price: 100, tax_status: 'vat', is_stock: '', has_transactions: '' },
  { record_id: 102, name: 'สินค้า B', base_price: 50, tax_status: 'vat', is_stock: '', has_transactions: '' }
];

/* ★ 7 ต.ค. 2026 — ขายสดจากรถออกเลขใบเสร็จ + ใบกำกับภาษีตั้งแต่กดบันทึก (34_sales_status.gs)
   ไฟล์นี้เป็นเทสต์ของ recordSale ไม่ใช่ของเลขเอกสาร จึงดักไว้แล้วตรวจแค่ "เรียกไหม ขอชนิดไหน"
   (กติกาการออกเลขซ้ำ/ไม่ซ้ำ มีเทสต์ของตัวเองใน .dev/test-sales-status.js) */
const DOCNO_CALLS = [];
const ctx = {
  issueSaleDocNos: (tenantId, order, kinds) => {
    DOCNO_CALLS.push({ tenantId, hasOrder: !!order, kinds });
    const f = {};
    (kinds || []).forEach(k => {
      const m = { receipt: ['receipt_no', 'RC'], tax: ['tax_invoice_no', 'TAX-IV'],
                  picking: ['picking_no', 'PICK'], delivery: ['delivery_order_no', 'DO'] }[k];
      if (m) { f[m[0]] = m[1] + '-TEST-0001'; f[m[0].replace(/_no$/, '_at')] = '2026-10-07 10:00:00'; }
    });
    return { fields: f, issued: [] };
  },
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Logger: { log: () => {} },
  // ── ค่าคงที่ที่ปกติมาจาก 34_sales_status.gs / 28_units.gs (ไม่โหลดทั้งไฟล์ — mock เฉพาะที่ recordSale ใช้จริง) ──
  SO_DRAFT: 'draft', SO_COMPLETED: 'completed', SO_CONFIRMED: 'confirmed',
  SO_MOBILE_EDITABLE: ['draft'],
  SO_STATUS_LABELS: { draft: 'ร่าง', completed: 'เสร็จสมบูรณ์', pending_delivery: 'รอจัดส่ง' },
  UNIT_PC: 'PC',
  _soStatusOf: o => (o && o.status) || 'draft',
  initialPaymentStatus: (pay, ful) => (ful === 'immediate' ? 'paid' : 'unpaid'),
  // ── I/O ที่ recordSale เรียกตรงๆ ──
  ensureTenantSheetsCurrent: () => {},
  centralObjects: name => (name === 'products' ? PRODUCTS : name === 'customers' ? CUSTOMERS : (CENTRAL[name] || [])),
  customerSaleGate: () => null,   // ไม่บล็อกลูกค้าในชุดทดสอบนี้ (คุมแยกแล้วใน test-customers.js)
  /* ด่านวงเงินเครดิต (56_customer_credit.gs) — ตรรกะของมันมีเทสต์ของตัวเองใน test-customer-credit.js
     ที่นี่ดักไว้เพื่อตรวจ **การต่อสาย**: recordSale เรียกมันไหม · ส่งยอดบิลที่คิดเสร็จแล้วไปหรือเปล่า ·
     และพอปฏิเสธแล้ว "ต้องไม่เหลือร่องรอย" (ไม่มีแถวบิล ไม่แตะสต็อก) */
  creditGateCalls: [],
  creditGateResult: null,
  creditSaleGate: function (tenantId, customer, paymentType, total) {
    ctx.creditGateCalls.push({ tenantId: tenantId, customerId: customer && customer.record_id,
      paymentType: paymentType, total: total });
    return ctx.creditGateResult;
  },
  isStockProduct: p => !(p && String(p.is_stock) === 'FALSE'),
  getNextDocNumber: () => 'SO-TEST-0001',
  tenantObjects: (tid, n) => sheets[n].map(r => Object.assign({}, r)),
  // recordSale อ่านแถวบิลที่เพิ่งเขียนกลับมาเพื่อส่งให้ postCashSaleGl (52_cash_sales_gl.gs)
  tenantRowById: (tid, n, id) => (sheets[n] || []).filter(r => String(r.record_id) === String(id)).pop() || null,
  tenantAppend: (tid, n, row) => sheets[n].push(Object.assign({}, row)),
  tenantUpdate: (tid, n, id, patch) => {
    const r = sheets[n].find(x => String(x.record_id) === String(id));
    if (r) Object.assign(r, patch);
    return !!r;
  },
  tenantNextId: (tid, n) => sheets[n].reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  tenantSheet: (tid, n) => sheetView(n),
  // ตัวจริง (02_helpers.gs): อ่าน getDataRange, หา col, ไล่ลบจากท้ายด้วย sh.deleteRow() — จำลองพฤติกรรมเดียวกัน
  deleteRowsWhere: (sh, col, val) => {
    const data = sh.getDataRange().getValues();
    const c = data[0].indexOf(col);
    if (c === -1) return 0;
    let n = 0;
    for (let i = data.length - 1; i >= 1; i--) if (String(data[i][c]) === String(val)) { sh.deleteRow(i + 1); n++; }
    return n;
  },
  logOrderStatus: (...args) => statusLogs.push(args),
  checkOfficeDeliveryStock: () => officeStockResult,
  bumpSalesDaily: (tid, date, count, total) => dailyBumps.push({ tid, date, count, total }),
  touchCustomerLastSale: () => {},
  cacheClearUser: () => {},
  centralUpdate: () => {},
  nowStr: () => '2026-10-02 10:00:00',
  _todayStr: () => '2026-10-02',
  safeDateStr: v => String(v || ''),
  isFlagOn: v => v === 'TRUE' || v === true,
  isCreditPayment: c => ['credit_term', 'credit'].indexOf(String(c || '').toLowerCase()) >= 0,
  isNotOff: v => !(v === false || String(v).toUpperCase() === 'FALSE'),
  _mobileRoleLabel: r => r,
};
vm.createContext(ctx);
// 50/52: recordSale ลงบัญชีขายสดแล้ว (16 ต.ค. 2026) — บน Apps Script ทุกไฟล์อยู่ scope เดียวกัน
// กล่องทดสอบโหลดเป็นชุดย่อย จึงต้องใส่เอง ไม่งั้น ReferenceError ตอนเรียก postCashSaleGl
['50_cogs.gs', '52_cash_sales_gl.gs', '55_van_stock_link.gs', '62_blitz.gs', '08_stock.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
vm.runInContext(B('07_sales.gs'), ctx, { filename: '07_sales.gs' });

// override หลังโหลดไฟล์ — recordSale เรียก _priceSaleCart() แบบ global lookup ตอนรันจริง ไม่ใช่ closure
// จึงตั้งทีหลังได้ปกติ (แพทเทิร์นเดียวกับ .dev/test-sales.js ที่ override priceCart/getPricingContextForCustomer)
function stubPriced(items) {
  return {
    success: true, priceListUsed: null,
    items: items,
    calc: {
      subtotal: items.reduce((s, it) => s + it.lineTotal, 0),
      discount: 0, total: items.reduce((s, it) => s + it.lineTotal, 0),
      freeGoods: [], appliedRules: [],
      vat: { applyVat: 'FALSE', vatType: 'none', rate: 0, exVat: items.reduce((s, it) => s + it.lineTotal, 0), vat: 0, exemptAmount: 0, taxOf: () => 'vat' }
    }
  };
}

const CUSTOMERS = [{ record_id: 1, name: 'ร้านทดสอบ', tenant_id: 'T1', credit_limit: 0, status: 'active' }];

const U1 = { tenantId: 'T1', lineUserId: 'U1', role: 'van_sales', displayName: 'คนขับ 1' };

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

console.log('── recordSale(): ขายจากรถ (immediate) ──');
reset();
ctx._priceSaleCart = () => stubPriced([{ productId: 101, unitCode: 'PC', qty: 2, baseQty: 2, price: 100, lineTotal: 200, unitDiscount: 0, lineDiscount: 0 }]);
let r = ctx.recordSale(U1, { customerId: 1, paymentType: 'cash', fulfillmentType: 'immediate', items: [{ productId: 101, unitCode: 'PC', qty: 2 }] });
eq('บันทึกสำเร็จ สถานะ completed ทันที', [r.success, sheets.sales_orders[0].status], [true, 'completed']);
/* ★ 7 ต.ค. 2026 — ขายสดจากรถได้เลขใบเสร็จ + ใบกำกับภาษีตั้งแต่กดบันทึก
   บิลพวกนี้ "ไม่เคย" เดินผ่านสถานะ "พร้อมจัดส่ง" ซึ่งเป็นจุดออกเลขของฝั่งสำนักงาน
   ไม่ออกตรงนี้ = บิลที่ขายหน้าร้านทุกใบไม่มีเลขใบเสร็จ/ใบกำกับภาษีเลยทั้งระบบ
   ★★ ตรวจว่าค่า "ถูกเขียนลงแถวจริง" ไม่ใช่แค่ถูกเรียก — คอลัมน์ใหม่หล่นหายระหว่างประกอบแถวได้ง่าย */
eq('ขายสดจากรถได้เลขใบเสร็จ + ใบกำกับภาษี เขียนลงแถวจริง',
  [/^RC-/.test(sheets.sales_orders[0].receipt_no || ''),
   /^TAX-/.test(sheets.sales_orders[0].tax_invoice_no || '')], [true, true]);
eq('ตัดสต็อกรถ 2 ชิ้น', sheets.van_stock.find(s => s.product_id === '101').qty, 48);
eq('นับยอดขายรายวัน +1 ใบ', dailyBumps.length, 1);
eq('เขียนบรรทัดสินค้า 1 บรรทัด', sheets.order_items.length, 1);

console.log('\n── recordSale(): ขายจากรถ สต็อกไม่พอ = ปฏิเสธทั้งใบ ──');
reset();
ctx._priceSaleCart = () => stubPriced([{ productId: 102, unitCode: 'PC', qty: 10, baseQty: 10, price: 50, lineTotal: 500, unitDiscount: 0, lineDiscount: 0 }]);
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'cash', fulfillmentType: 'immediate', items: [{ productId: 102, unitCode: 'PC', qty: 10 }] });
eq('ของมี 3 ขอ 10 — ปฏิเสธ', r.success, false);
eq('ไม่เขียนใบขายเลย', sheets.sales_orders.length, 0);

console.log('\n── recordSale(): office_delivery ของคลังกลางไม่พอ = เตือนไม่บล็อก (กติกา 2026-09-30) ──');
reset();
officeStockResult = { success: true, warning: 'ของในคลังไม่พอขาย (บันทึกบิลแล้ว แต่ต้องรีบสั่งของเพิ่ม): สินค้า A' };
ctx._priceSaleCart = () => stubPriced([{ productId: 101, unitCode: 'PC', qty: 5, baseQty: 5, price: 100, lineTotal: 500, unitDiscount: 0, lineDiscount: 0 }]);
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'office_delivery', items: [{ productId: 101, unitCode: 'PC', qty: 5 }] });
eq('บันทึกผ่านแม้ของไม่พอ', r.success, true);
eq('ส่ง stockWarning กลับมาด้วย', r.stockWarning !== '', true);
eq('สถานะเป็น draft (ใบนัดส่งยังไม่ใช่การขายจริง)', sheets.sales_orders[0].status, 'draft');
eq('ใบร่างยังไม่นับเข้ายอดขายรายวัน', dailyBumps.length, 0);
eq('ใบร่างยังไม่กินเลขที่เอกสารจริง — ใช้รหัส DRAFT-<id>', sheets.sales_orders[0].order_code, 'DRAFT-1');

console.log('\n── recordSale(): แก้ไขใบร่าง (editOrderCode) — เขียนทับใบเดิม ไม่ออกเลขใหม่ ──');
reset();
ctx._priceSaleCart = () => stubPriced([{ productId: 101, unitCode: 'PC', qty: 1, baseQty: 1, price: 100, lineTotal: 100, unitDiscount: 0, lineDiscount: 0 }]);
ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'office_delivery', items: [{ productId: 101, unitCode: 'PC', qty: 1 }] });
const firstCode = sheets.sales_orders[0].order_code, firstId = sheets.sales_orders[0].record_id, firstCreatedAt = sheets.sales_orders[0].created_at;
eq('มีใบร่าง 1 ใบ บรรทัดสินค้า 1 บรรทัด', [sheets.sales_orders.length, sheets.order_items.length], [1, 1]);

ctx._priceSaleCart = () => stubPriced([
  { productId: 101, unitCode: 'PC', qty: 2, baseQty: 2, price: 100, lineTotal: 200, unitDiscount: 0, lineDiscount: 0 },
  { productId: 102, unitCode: 'PC', qty: 1, baseQty: 1, price: 50, lineTotal: 50, unitDiscount: 0, lineDiscount: 0 }
]);
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'office_delivery', editOrderCode: firstCode,
  items: [{ productId: 101, unitCode: 'PC', qty: 2 }, { productId: 102, unitCode: 'PC', qty: 1 }] });
eq('แก้สำเร็จ', r.success, true);
eq('ยังมีใบเดียว (เขียนทับ ไม่เพิ่มใบใหม่)', sheets.sales_orders.length, 1);
eq('เลขที่เอกสาร/record_id/วันที่เปิดบิลเดิมไม่เปลี่ยน', [sheets.sales_orders[0].order_code, sheets.sales_orders[0].record_id, sheets.sales_orders[0].created_at], [firstCode, firstId, firstCreatedAt]);
eq('ยอดใหม่ถูกต้อง (250 ไม่ใช่ 100 เดิม)', sheets.sales_orders[0].total, 250);
eq('บรรทัดสินค้าเก่าถูกลบแล้วแทนที่ด้วยชุดใหม่ 2 บรรทัด (ไม่ใช่ 3)', sheets.order_items.length, 2);
eq('แก้ใบร่างไม่นับยอดขายรายวันซ้ำ (ยังเป็น 0 ตลอด)', dailyBumps.length, 0);

console.log('\n── recordSale(): แก้ใบคนอื่น / แก้ใบที่พ้นสถานะร่างแล้ว ──');
reset();
sheets.sales_orders.push({ record_id: 5, order_code: 'DRAFT-5', sale_by: 'U2', status: 'draft', created_at: '2026-10-01 08:00:00' });
sheets.sales_orders.push({ record_id: 6, order_code: 'SO-20261001-0003', sale_by: 'U1', status: 'completed', created_at: '2026-10-01 08:00:00' });
ctx._priceSaleCart = () => stubPriced([{ productId: 101, unitCode: 'PC', qty: 1, baseQty: 1, price: 100, lineTotal: 100, unitDiscount: 0, lineDiscount: 0 }]);
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'cash', fulfillmentType: 'office_delivery', editOrderCode: 'DRAFT-5', items: [{ productId: 101, unitCode: 'PC', qty: 1 }] });
eq('แก้ใบของคนอื่นไม่ได้ (sale_by ไม่ตรง)', [r.success, /ไม่ใช่บิลของท่าน/.test(r.message || '')], [false, true]);
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'cash', fulfillmentType: 'office_delivery', editOrderCode: 'SO-20261001-0003', items: [{ productId: 101, unitCode: 'PC', qty: 1 }] });
eq('แก้ใบที่ไม่ใช่สถานะร่างแล้วไม่ได้', [r.success, /แก้ไขเองไม่ได้/.test(r.message || '')], [false, true]);

console.log('\n── ★ ขายสดจากรถได้เลขใบเสร็จ + ใบกำกับภาษีตั้งแต่กดบันทึก (แอดมินขอ 7 ต.ค. 2026) ──');
/* บิลขายสดจากรถ "ไม่เคย" เดินผ่านสถานะ "พร้อมจัดส่ง" ซึ่งเป็นจุดออกเลขของฝั่งสำนักงาน
   ถ้าไม่ออกตรงนี้ บิลที่ขายหน้าร้านทุกใบจะไม่มีเลขใบเสร็จ/ใบกำกับภาษีเลยทั้งระบบ */
{
  const immediate = DOCNO_CALLS.filter(c => (c.kinds || []).indexOf('receipt') >= 0);
  eq('ขายสดจากรถเรียกออกเลข และขอทั้งใบเสร็จและใบกำกับภาษี',
    [immediate.length > 0, immediate[0] && immediate[0].kinds.sort().join(',')], [true, 'receipt,tax']);
  eq('  ★ ส่ง order เป็น null (เปิดบิลใหม่ ยังไม่มีแถวให้เทียบ) — ไม่ใช่ความพลาด',
    immediate[0].hasOrder, false);
  const rows = sheets.sales_orders || [];
  const drafts = rows.filter(o => String(o.order_code || '').indexOf('DRAFT-') === 0);
  eq('  ★ ใบร่าง/ใบนัดส่งต้องยังไม่มีเลข (ยังไม่ได้ส่งของและยังไม่ได้เงิน)',
    drafts.every(o => !o.receipt_no && !o.tax_invoice_no), true);
}

/* ══ ด่านวงเงินเครดิต: การต่อสาย (56_customer_credit.gs) ══ */
console.log('\n── ด่านวงเงินเครดิต ──');
ctx.creditGateCalls = [];
ctx.creditGateResult = null;
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
  items: [{ productId: 101, unitCode: 'PC', qty: 2 }] });
eq('★ recordSale เรียกด่านด้วยยอดบิลที่คิดเสร็จแล้ว',
  [r.success, ctx.creditGateCalls.length, ctx.creditGateCalls[0] && ctx.creditGateCalls[0].total], [true, 1, r.total]);

const ordersBefore = sheets.sales_orders.length;
const stockBefore = JSON.stringify(sheets.van_stock);
ctx.creditGateCalls = [];
ctx.creditGateResult = { success: false, message: 'เกินวงเงินเครดิต', creditBlocked: true };
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
  items: [{ productId: 101, unitCode: 'PC', qty: 2 }] });
eq('★★ ด่านปฏิเสธ → ไม่บันทึกบิล และไม่แตะสต็อกเลย',
  [r.success, sheets.sales_orders.length - ordersBefore, JSON.stringify(sheets.van_stock) === stockBefore],
  [false, 0, true]);

ctx.creditGateResult = { warning: 'ร้านทดสอบ: เกินวงเงินเครดิต' };
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'office_delivery',
  items: [{ productId: 101, unitCode: 'PC', qty: 1 }] });
eq('โหมดเตือน → บันทึกบิลได้ และส่งคำเตือนกลับไปให้พนักงานเห็น',
  [r.success, r.creditWarning], [true, 'ร้านทดสอบ: เกินวงเงินเครดิต']);
ctx.creditGateResult = null;

/* ══ แคมเปญ BLITZ RANGER (62_blitz.gs) ══
   ผู้ป้อนบิลของทีม: ราคาเงินสดเสมอ · ตัด "สต็อกทีม" ไม่ใช่สต็อกรถตัวเอง · บิลติดตราแคมเปญ/ทีมเป็นภาพนิ่ง */
console.log('\n── BLITZ RANGER ──');
const TEAM_KEY = 'TEAM:1:11';
function blitzSetup(endDate) {
  CENTRAL.blitz_campaigns = [{ record_id: 1, code: 'BLITZ-1', name: 'BLITZ RANGER', tenant_id: 'T1', start_date: '2026-10-01', end_date: endDate || '2026-10-03', status: 'active', cash_price: '' }];
  CENTRAL.blitz_teams = [{ record_id: 11, campaign_id: 1, code: 'A', name: 'Team A' }, { record_id: 12, campaign_id: 1, code: 'B', name: 'Team B' }];
  CENTRAL.blitz_members = [
    { record_id: 1, campaign_id: 1, team_id: 11, line_user_id: 'U2', name: 'ผู้ป้อนบิล A', role: 'seller' },
    { record_id: 2, campaign_id: 1, team_id: 11, line_user_id: 'U3', name: 'สมาชิก A', role: 'member' },
    { record_id: 3, campaign_id: 1, team_id: '', line_user_id: 'U9', name: 'ผอ.โครงการ', role: 'director' }
  ];
}
const U2 = { tenantId: 'T1', lineUserId: 'U2', role: 'credit_sales', displayName: 'ผู้ป้อนบิล A' };
let seenOpts = null;
const stubWithOpts = items => (cid, raw, pay, isVan, opts) => { seenOpts = opts; return stubPriced(items); };

/* ★ 28 พ.ย. 2026: ทีมไม่มีสต็อกของตัวเอง — บิลทีมเป็น office_delivery เสมอ ส่งเข้าศูนย์เป็น "รออนุมัติ" ทันที ไม่ตัดสต็อกที่ไหนตอนบันทึก */
reset(); blitzSetup();
sheets.van_stock.push({ line_user_id: TEAM_KEY, product_id: '101', qty: 20 });
ctx._priceSaleCart = stubWithOpts([{ productId: 101, unitCode: 'PC', qty: 2, baseQty: 2, price: 100, lineTotal: 200, unitDiscount: 0, lineDiscount: 0 }]);
r = ctx.recordSale(U2, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'immediate', items: [{ productId: 101, unitCode: 'PC', qty: 2 }] });
eq('ผู้ป้อนบิลของทีมขายสำเร็จ', r.success, true);
eq('★ บังคับราคาเงินสด (forceCash) ส่งเข้าเครื่องคิดราคา แม้ชำระเครดิต', seenOpts && seenOpts.forceCash, true);
eq('★★ แอปส่ง immediate มาก็ถูกบังคับเป็น office_delivery (เซิร์ฟเวอร์ตัดสินเอง)', [r.fulfillmentType, sheets.sales_orders[0].fulfillment_type], ['office_delivery', 'office_delivery']);
eq('★★ ไม่ตัดสต็อกทีมและไม่แตะสต็อกรถ — ของออกคลังหลักตอนศูนย์ยืนยัน', [sheets.van_stock.find(s => s.line_user_id === TEAM_KEY).qty, sheets.van_stock.find(s => s.line_user_id === 'U1' && s.product_id === '101').qty, sheets.stock_movements.length], [20, 50, 0]);
eq('  ไม่มีสต็อกรถส่วนตัวของ U2 งอกขึ้น', sheets.van_stock.filter(s => s.line_user_id === 'U2').length, 0);
const bo = sheets.sales_orders[0];
eq('★ ข้ามร่าง → รออนุมัติ (confirmed) ทันที ได้เลขจริง ไม่ใช่ DRAFT-', [bo.status, /^DRAFT-/.test(bo.order_code)], ['confirmed', false]);
eq('  ยังไม่รับเงิน (ศูนย์ยืนยันทีหลัง) · ยังไม่ออกใบเสร็จ/ใบกำกับ', [bo.payment_status, bo.receipt_no || '', bo.tax_invoice_no || ''], ['unpaid', '', '']);
eq('★ นับเข้ายอดขายรายวันทันที (ไม่ใช่ร่างแล้ว)', dailyBumps.length, 1);
eq('★ บิลติดตราแคมเปญ/ทีม เป็นภาพนิ่งลงแถวจริง · stock_holder ว่าง (ไม่มีสต็อกทีม)', [bo.campaign_id, bo.team_id, bo.stock_holder], ['1', '11', '']);
eq('  ชำระเครดิตแต่คิดราคาเงินสด → ติดตรา price_basis=cash ไว้อธิบายย้อนหลัง', bo.price_basis, 'cash');
eq('  sale_by ยังเป็นคนที่กดบันทึกจริง (ไว้ตามว่าใครป้อน)', bo.sale_by, 'U2');
eq('  วันนัดส่ง = วันเปิดบิล (ส่งมอบหน้างานแล้ว) และ note บอกว่าส่งมอบแล้ว', [bo.requested_delivery_date, /ส่งมอบหน้างาน/.test(bo.note)], ['2026-10-02', true]);
eq('  ประวัติสถานะ: เปิดบิลเข้าสู่ confirmed ครั้งเดียว', [statusLogs.length, statusLogs[0][2], statusLogs[0][3]], [1, '', 'confirmed']);

reset(); blitzSetup();
ctx._priceSaleCart = stubWithOpts([{ productId: 101, unitCode: 'PC', qty: 2, baseQty: 2, price: 100, lineTotal: 200, unitDiscount: 0, lineDiscount: 0 }]);
r = ctx.recordSale(U2, { customerId: 1, paymentType: 'cash', fulfillmentType: 'office_delivery', requestedDeliveryDate: '2026-10-09', items: [{ productId: 101, unitCode: 'PC', qty: 2 }] });
eq('★ เลือก "รอจัดส่ง": ยังเป็นบิลสำนักงาน รออนุมัติ ไม่แตะสต็อก แต่ note/วันนัดบอกว่ารอจัดส่ง ไม่ใช่ส่งมอบแล้ว',
  [r.success, sheets.sales_orders[0].status, sheets.sales_orders[0].requested_delivery_date, /รอจัดส่ง/.test(sheets.sales_orders[0].note), /ส่งมอบหน้างาน/.test(sheets.sales_orders[0].note), sheets.stock_movements.length],
  [true, 'confirmed', '2026-10-09', true, false, 0]);

reset(); blitzSetup();
ctx._priceSaleCart = stubWithOpts([{ productId: 101, unitCode: 'PC', qty: 500, baseQty: 500, price: 100, lineTotal: 50000, unitDiscount: 0, lineDiscount: 0 }]);
officeStockResult = { success: true, warning: 'ของในคลังไม่พอขาย' };
r = ctx.recordSale(U2, { customerId: 1, paymentType: 'cash', fulfillmentType: 'immediate', items: [{ productId: 101, unitCode: 'PC', qty: 500 }] });
eq('★ ของในคลังหลักไม่พอ = บันทึกได้ + เตือน ไม่บล็อก (ของส่งมอบไปแล้ว)', [r.success, r.stockWarning], [true, 'ของในคลังไม่พอขาย']);
officeStockResult = { success: true };

reset(); blitzSetup();
ctx._priceSaleCart = stubWithOpts([{ productId: 101, unitCode: 'PC', qty: 2, baseQty: 2, price: 100, lineTotal: 200, unitDiscount: 0, lineDiscount: 0 }]);
seenOpts = null;
r = ctx.recordSale(U1, { customerId: 1, paymentType: 'credit_term', fulfillmentType: 'immediate', items: [{ productId: 101, unitCode: 'PC', qty: 2 }] });
eq('★ พนักงานปกติ (ไม่ได้อยู่ทีม) ไม่ถูกบังคับราคาเงินสด · ตัดสต็อกรถตัวเอง · ไม่มีตรา',
  [seenOpts && seenOpts.forceCash, sheets.van_stock.find(s => s.line_user_id === 'U1' && s.product_id === '101').qty,
   sheets.sales_orders[0].campaign_id, sheets.sales_orders[0].stock_holder, sheets.sales_orders[0].price_basis], [false, 48, '', '', '']);

eq('สมาชิกทีม (ไม่ใช่ผู้ป้อนบิล) ไม่มี context', ctx.blitzContextFor('U3', 'T1'), null);
eq('ผู้อำนวยการไม่มี context การขาย', ctx.blitzContextFor('U9', 'T1'), null);
eq('แคมเปญของตัวแทนอื่นไม่โดน', ctx.blitzContextFor('U2', 'T2'), null);
blitzSetup('2026-10-01');   // แคมเปญจบเมื่อวาน
eq('★ แคมเปญจบแล้ว (เลยวันสิ้นสุด) → ผู้ป้อนบิลกลับไปขายปกติ ไม่มี context', ctx.blitzContextFor('U2', 'T1'), null);
blitzSetup(); CENTRAL.blitz_campaigns[0].status = 'closed';
eq('แคมเปญที่ปิดไว้ → ไม่มี context ทั้งที่ยังอยู่ในช่วงวันที่', ctx.blitzContextFor('U2', 'T1'), null);
blitzSetup(); CENTRAL.blitz_campaigns[0].cash_price = 'FALSE';
eq('ปิดสวิตช์ราคาเงินสด → ยังเป็นทีม แต่ forceCash=false', ctx.blitzContextFor('U2', 'T1').forceCash, false);
blitzSetup();
r = ctx.restockVan(U2, { items: [{ productId: 101, qty: 5 }] });
eq('★ ผู้ป้อนบิลของทีมเบิกของเข้าทีมเองจากมือถือไม่ได้ (ทีมไม่ต้องเบิกของแล้ว)', [r.success, /ไม่ต้องเบิก/.test(r.message || '')], [false, true]);
Object.keys(CENTRAL).forEach(k => delete CENTRAL[k]);

// ── _restockHolder: สินค้าเดียวกันมาหลายรายการต้องรวมกัน (ตัวบวกอ่านตารางครั้งเดียวแล้ววนบวกทีละรายการ) ──
{
  const saved = { issue: ctx.issueVanStockFromWarehouse, clear: ctx.cacheClear };
  let issuedItems = null;
  ctx.issueVanStockFromWarehouse = (tid, items) => { issuedItems = items; return { success: true, cost: null, skipped: 'จำลอง' }; };
  ctx.cacheClear = () => {};
  reset();   // van_stock ของ U1: 101=50, 102=3
  r = ctx._restockHolder('T1', 'U1', [{ productId: 101, qty: 3 }, { productId: 101, qty: 4 }, { productId: 102, qty: 2 }], 'ทดสอบ', 'restock');
  eq('เบิกสินค้าเดียวกันสองรายการ: สำเร็จ', r.success, true);
  eq('★ จำนวนรวมกันครบ ไม่ใช่รายการหลังเขียนทับรายการแรก: 50+3+4 = 57', sheets.van_stock.find(s => s.line_user_id === 'U1' && s.product_id === '101').qty, 57);
  eq('  สินค้าอื่นบวกตามปกติ 3+2 = 5', sheets.van_stock.find(s => s.line_user_id === 'U1' && s.product_id === '102').qty, 5);
  eq('  ตัวตัดคลังกลางได้รับรายการที่รวมแล้ว (ไม่ใช่สามรายการ)', issuedItems.map(x => [String(x.productId), x.qty]), [['101', 7], ['102', 2]]);
  eq('  บันทึกการเคลื่อนไหวครั้งเดียวต่อสินค้า (ไม่ซ้ำ)', sheets.stock_movements.filter(m => String(m.product_id) === '101').length, 1);
  reset();
  r = ctx._restockHolder('T1', 'UNEW', [{ productId: 101, qty: 3 }, { productId: 101, qty: 4 }], 'ทดสอบ', 'restock');
  eq('★ ผู้ถือที่ยังไม่มีแถวสต็อก + สินค้าเดียวกันสองรายการ → แถวเดียว ไม่ต่อแถวซ้ำ',
    sheets.van_stock.filter(s => s.line_user_id === 'UNEW').map(s => [s.product_id, s.qty]), [[101, 7]]);
  r = ctx._restockHolder('T1', 'U1', [{ productId: 101, qty: 0 }], 'ทดสอบ', 'restock');
  eq('ทุกรายการจำนวน 0 = ไม่มีรายการเบิก', [r.success, r.message], [false, 'ไม่มีรายการเบิก']);
  ctx.issueVanStockFromWarehouse = saved.issue; ctx.cacheClear = saved.clear;
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
