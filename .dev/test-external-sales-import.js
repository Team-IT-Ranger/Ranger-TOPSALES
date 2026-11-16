// รัน: node .dev/test-external-sales-import.js
// ทดสอบเฉพาะตรรกะกรอง/จับกลุ่ม/จับคู่ของ _computeExternalSalesCandidates() (43_external_sales_import.gs)
// ล้วนๆ ด้วย SpreadsheetApp จำลอง — ไม่โหลด backend ไฟล์อื่น (ฟังก์ชันนี้พึ่งแค่ centralObjects/_money)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

// แถวดิบของชีต FactSales จำลอง (คอลัมน์ครบตามที่ _readExternalFactSalesRows ต้องการ)
const HEADER = ['tYear', 'InvoiceDate', 'InvoiceNumber', 'Customer_id', 'ProductNumber', 'qtyCT', 'Amt_actual', 'DiscountAmt', 'SalesUnit', 'Sales_type', 'Sell_FOC', 'Sales_channel', 'Sales_business', 'Category', 'subCategory', 'Entity'];
function row(o) { return HEADER.map(h => (o[h] !== undefined ? o[h] : '')); }

const SHEET_ROWS = [
  HEADER,
  // ใบ INV-1: TNKI ขายให้ศูนย์ CD00017, 2 บรรทัดสินค้า — ควรผ่าน
  row({ InvoiceDate: '2026/09/26', InvoiceNumber: 'INV-1', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 5, Amt_actual: 5000, DiscountAmt: 100, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'TNKI' }),
  row({ InvoiceDate: '2026/09/26', InvoiceNumber: 'INV-1', Customer_id: 'CD00017', ProductNumber: '10115', qtyCT: 2, Amt_actual: 2000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'TNKI' }),
  // ใบ INV-2: ก่อน cutoff (2026-09-25) — ต้องถูกตัดทิ้ง
  row({ InvoiceDate: '2026/09/24', InvoiceNumber: 'INV-2', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'TNKI' }),
  // ใบ INV-3: Entity ไม่ใช่ TNKI (เช่น ศูนย์ขายต่อ/Sell-out) — ต้องถูกตัดทิ้ง
  row({ InvoiceDate: '2026/09/26', InvoiceNumber: 'INV-3', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-out', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'BDC' }),
  // ใบ INV-4: ศูนย์ที่ไม่มีใน tenants.customer_account — ควรไปอยู่ errors
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-4', Customer_id: 'CD99999', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'TNKI' }),
  // ใบ INV-5: สินค้าไม่มีใน products.product_code — ควรไปอยู่ errors
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-5', Customer_id: 'CD00017', ProductNumber: '99999', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'TNKI' }),
  // ใบ INV-6: ของแถมล้วน (qtyCT=1 แต่ Amt_actual=0, Sell_FOC=FOC) — เส้นทางนี้ไม่ได้กรองด้วย Sell_FOC โดยตรง
  // (เอนจิ้นดูแค่ qtyCT>0) จึงยังเข้ามาเป็นรายการซื้อปกติที่ Amt_actual=0 — ตรวจว่าคำนวณ unit price ได้ 0 ไม่ error
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-6', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 0, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'FOC', Sales_business: 'TD', Entity: 'TNKI' }),
  // ใบ INV-7: นำเข้าไปแล้ว (จะมี PO ที่ source_ref=INV-7) — ควรไปอยู่ alreadyImported
  row({ InvoiceDate: '2026/09/28', InvoiceNumber: 'INV-7', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'TD', Entity: 'TNKI' }),
  // ใบ INV-8: Sales_business ไม่ใช่ 'TD' (ธุรกิจสายอื่นปนอยู่ในชีตเดียวกัน, เพิ่ม 2 ต.ค. 2026) — ต้องถูกตัดทิ้ง
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-8', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Sales_business: 'XY', Entity: 'TNKI' })
];

class FakeSheet { getDataRange() { return { getValues: () => SHEET_ROWS }; } }
class FakeSpreadsheet { getSheetByName(n) { return n === 'FactSales' ? new FakeSheet() : null; } }

const ctx = {
  console, JSON, String, Number, Object, Array, Math, isNaN, isFinite,
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Logger: { log: () => {} },
  SpreadsheetApp: { openById: (id) => { if (id !== '19MzAR7dpg4kBJsZCHhWYgMUhdpQ1Z8pFBN7JObi5YA0') throw new Error('wrong sheet id'); return new FakeSpreadsheet(); } },
};
vm.createContext(ctx);
vm.runInContext(B('43_external_sales_import.gs'), ctx, { filename: '43_external_sales_import.gs' });

const TENANTS = [{ tenant_id: 'T1', name: 'ศูนย์ทดสอบ', customer_account: 'CD00017' }];
const PRODUCTS = [{ record_id: 1, product_code: '10114', name: 'สินค้า A' }, { record_id: 2, product_code: '10115', name: 'สินค้า B' }];
const PURCHASE_ORDERS = [{ record_id: 1, tenant_id: 'T1', source_ref: 'INV-7', status: 'sent' },
  { record_id: 9, tenant_id: 'T1', source_ref: 'INV-1', status: 'cancelled' }];   // INV-1 เคยนำเข้าแล้วถูกถอนกลับ — ต้องนำเข้าใหม่ได้
ctx._money = n => Math.round(n * 100) / 100;
ctx.centralObjects = name => { if (name === 'tenants') return TENANTS; if (name === 'products') return PRODUCTS; if (name === 'purchase_orders') return PURCHASE_ORDERS; return []; };

const r = ctx._computeExternalSalesCandidates();

eq('พบใบที่พร้อมนำเข้า 3 ใบ (INV-1 2 บรรทัด, INV-6 ของแถม, ไม่นับ INV-2/3/4/5/7)',
  r.candidates.map(c => c.invoiceNumber).sort(), ['INV-1', 'INV-6']);

const inv1 = r.candidates.find(c => c.invoiceNumber === 'INV-1');
eq('INV-1 จับคู่ศูนย์ถูก (tenant_id=T1) และรวม 2 บรรทัดสินค้า', [inv1.tenantId, inv1.lines.length, inv1.totalAmt], ['T1', 2, 7000]);
eq('INV-1 บรรทัดแรกจับคู่ product_id ถูก (10114→record_id 1)', inv1.lines[0].productId, 1);

eq('INV-2 ถูกตัดทิ้งเพราะก่อน cutoff (2026-09-24 < 2026-09-25) — ไม่อยู่ใน candidates/errors เลย (กรองตั้งแต่อ่านชีต)',
  [r.candidates.some(c => c.invoiceNumber === 'INV-2'), r.errors.some(e => e.invoiceNumber === 'INV-2')], [false, false]);

eq('INV-3 ถูกตัดทิ้งเพราะ Entity ไม่ใช่ TNKI', r.candidates.some(c => c.invoiceNumber === 'INV-3'), false);

eq('INV-4 ไปอยู่ errors เพราะหา tenant จาก customer_account ไม่เจอ',
  r.errors.some(e => e.invoiceNumber === 'INV-4' && /ไม่พบศูนย์/.test(e.reason)), true);

eq('INV-5 ไปอยู่ errors เพราะหาสินค้าจาก product_code ไม่เจอ',
  r.errors.some(e => e.invoiceNumber === 'INV-5' && /ไม่พบสินค้า/.test(e.reason)), true);

eq('INV-7 ไปอยู่ alreadyImported เพราะมี PO ที่ source_ref ตรงกันอยู่แล้ว',
  r.alreadyImported.some(a => a.invoiceNumber === 'INV-7'), true);

eq('INV-8 ถูกตัดทิ้งเพราะ Sales_business ไม่ใช่ TD (2 ต.ค. 2026 — ธุรกิจสายอื่นปนอยู่ในชีตเดียวกัน)',
  [r.candidates.some(c => c.invoiceNumber === 'INV-8'), r.errors.some(e => e.invoiceNumber === 'INV-8')], [false, false]);


console.log('\n── ถอนใบรับของ + รหัสเอกสารใหม่ไม่ชนแถวกำพร้า (2 ต.ค. 2026) ──');
eq('INV-1 เคยถูกถอน (PO cancelled) → กลับมาเป็นรายการพร้อมนำเข้าอีกครั้ง ไม่ติด alreadyImported',
  [r.candidates.some(c => c.invoiceNumber === 'INV-1'), r.alreadyImported.some(a => a.invoiceNumber === 'INV-1')], [true, false]);

// _freshParentId: ใบแม่ถูกลบ (PO id 2,3 หาย) แต่ po_items ยังอ้าง po_id 3 อยู่ → ใบใหม่ต้องข้ามไปเป็น 4 ไม่ใช่ 2
const CHILD = { po_items: [{ record_id: 1, po_id: 3 }, { record_id: 2, po_id: 3 }] };
ctx.centralNextId = name => (name === 'purchase_orders' ? 2 : 1);
ctx.centralObjects = name => CHILD[name] || [];
eq('รหัส PO ใหม่ข้ามแถวลูกกำพร้า (po_id 3 ยังค้างใน po_items → ได้ 4 ไม่ใช่ 2)', ctx._freshParentId('purchase_orders', 'po_items', 'po_id'), 4);
CHILD.po_items = [];
eq('ไม่มีลูกกำพร้า → ใช้เลขถัดไปปกติ', ctx._freshParentId('purchase_orders', 'po_items', 'po_id'), 2);

// withdrawExternalGoodsReceipt
const DB = { goods_receipts: [{ record_id: 3, gr_no: 'GR-1', status: 'pending_review', po_id: 2, source_ref: 'IV1', note: '' },
                              { record_id: 4, gr_no: 'GR-2', status: 'posted', po_id: 3, source_ref: 'IV2', note: '' },
                              { record_id: 5, gr_no: 'GR-3', status: 'pending_review', po_id: 7, source_ref: '', note: '' }],
  purchase_orders: [{ record_id: 2, status: 'sent', source_ref: 'IV1', note: '' }, { record_id: 3, status: 'received', source_ref: 'IV2', note: '' },
                    { record_id: 7, status: 'sent', source_ref: '', note: '' }] };
/* ★ 7 ต.ค. 2026 — ตรวจรับใบนำเข้าแล้วลงบัญชี + ตั้งหนี้ให้อัตโนมัติ (ดู 23_accounting.gs)
   ไฟล์นี้เป็นเทสต์ของ "การนำเข้า/ตรวจรับ" ไม่ใช่ของบัญชี จึงดักไว้แทนการโหลดโมดูลบัญชีทั้งก้อน
   แล้วตรวจเฉพาะสิ่งที่เป็นหน้าที่ของไฟล์นี้: เรียกไหม ด้วยสมุดของใคร วันที่อะไร ยอดเท่าไหร่
   (ตรรกะการลงบัญชีมีเทสต์ของตัวเองใน .dev/test-purchasing-accounting.js) */
Object.assign(ctx, {
  GL_ACCT: { INVENTORY: '1300', GRNI: '2150' },
  _normBook: t => String(t || ''),
  jvCalls: [], apCalls: [], jvFails: false,
  _postJournal: function (o) {
    ctx.jvCalls.push({ date: o.date, book: o.tenantId, refId: o.refId,
      debit: (o.lines || []).reduce((s2, l) => s2 + (l.debit || 0), 0) });
    return ctx.jvFails ? { success: false, message: 'ผังบัญชียังไม่พร้อม' }
      : { success: true, journalId: 900 + ctx.jvCalls.length, journalNo: 'JV-TEST-' + ctx.jvCalls.length };
  },
  _createApBillFromGrCore: function (session, payload, book) {
    ctx.apCalls.push({ grId: payload.grId, billDate: payload.billDate, book: book });
    return { success: true, billId: 1, billNo: 'AP-TEST-0001' };
  },
  _requirePermission: () => null, _purchaseScope: () => 'T1', _withDocLock: fn => fn(), nowStr: () => '2026-10-02 10:00:00',
  _findScoped: (name, id) => DB[name].find(x => String(x.record_id) === String(id)) || null,
  _childrenOf: (name, fk, id) => (DB[name] || []).filter(r => String(r[fk]) === String(id)),
  centralUpdate: (name, id, patch) => { Object.assign(DB[name].find(x => String(x.record_id) === String(id)), patch); return true; }
});
DB.po_items = [{ record_id: 1, po_id: 2, received_qty: 0 }, { record_id: 2, po_id: 7, received_qty: 0 }, { record_id: 3, po_id: 8, received_qty: 5 }];
DB.goods_receipts.push({ record_id: 6, gr_no: 'GR-R', status: 'pending_review', po_id: 8, source_ref: 'IV3', note: '' });
DB.purchase_orders.push({ record_id: 8, status: 'partial', source_ref: 'IV3', note: '' });
let w = ctx.withdrawExternalGoodsReceipt({ displayName: 'แอดมิน' }, { id: 3 });
eq('ถอนใบที่รอตรวจรับ → สำเร็จ + GR/PO เป็น cancelled', [w.success, DB.goods_receipts[0].status, DB.purchase_orders[0].status], [true, 'cancelled', 'cancelled']);
w = ctx.withdrawExternalGoodsReceipt({}, { id: 4 });
eq('ถอนใบที่ตรวจรับ (posted) ไปแล้วไม่ได้', [w.success, DB.goods_receipts[1].status], [false, 'posted']);
w = ctx.withdrawExternalGoodsReceipt({}, { id: 6 });
eq('ถอนใบ "ส่วนที่เหลือรอรับต่อ" (PO มีของรับไปแล้ว) → ยกเลิกแค่ใบรับของ ใบสั่งซื้อยังเปิด (partial)',
  [w.success, DB.goods_receipts[3].status, DB.purchase_orders[3].status], [true, 'cancelled', 'partial']);
w = ctx.withdrawExternalGoodsReceipt({}, { id: 5 });
eq('ใบที่ไม่ได้มาจากการนำเข้าอัตโนมัติ (PO ไม่มี source_ref) ถอนไม่ได้', [w.success, DB.goods_receipts[2].status], [false, 'pending_review']);


console.log('\n── นำเข้าอัตโนมัติตามเวลา (scheduledExternalSalesImport) + ตั้ง trigger ──');
const STORE = { purchase_orders: [], po_items: [], goods_receipts: [], gr_items: [] };
const PROPS = {};
let docNo = 0;
Object.assign(ctx, {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in PROPS ? PROPS[k] : null), setProperty: (k, v) => { PROPS[k] = v; } }) },
  _withDocLock: fn => fn(),
  centralObjects: name => STORE[name] || [],
  centralNextId: name => (STORE[name] || []).reduce((m, o) => Math.max(m, o.record_id || 0), 0) + 1,
  centralAppend: (name, row) => { STORE[name].push(Object.assign({}, row)); },
  centralAppendMany: (name, rows) => { rows.forEach(r => STORE[name].push(Object.assign({}, r))); },
  _ensureCompanyVendor: () => 1, _ensureScopeWarehouse: () => 1,
  _nextCentralDocNo: kind => kind + '-' + (++docNo),
  UNIT_CT: 'CT', _productCaseFactor: () => 12,
  _findById: (name, id) => STORE[name].find(x => String(x.record_id) === String(id)),
  nowStr: () => '2026-10-02 12:30:00'
});
const CAND = { invoiceNumber: 'IV-A', invoiceDate: '2026-09-26', tenantId: 'T1', tenantName: 'ศูนย์ทดสอบ', lines: [{ productId: 1, productName: 'สินค้า A', qtyCT: 2, amtActual: 200 }], totalAmt: 200 };
ctx._computeExternalSalesCandidates = () => ({ candidates: [CAND], errors: [{ invoiceNumber: 'IV-X', reason: 'ไม่พบศูนย์' }], alreadyImported: [] });

let st = ctx.scheduledExternalSalesImport();
eq('รอบอัตโนมัติ: นำเข้า 1 ใบโดยไม่ต้องมี session', [st.ok, st.created, st.unmatched], [true, 1, 1]);
eq('ผู้สร้าง = system:auto และใบรับของยังเป็น pending_review (สต็อกไม่ขยับ)',
  [STORE.purchase_orders[0].created_by, STORE.goods_receipts[0].created_by, STORE.goods_receipts[0].status], ['system:auto', 'system:auto', 'pending_review']);
eq('gr_items สร้างจากแถว po_items ที่เพิ่งสร้าง: 1 แถว base_qty = 2 ลัง × factor 12 = 24', [STORE.gr_items.length, STORE.gr_items[0].base_qty], [1, 24]);
eq('บันทึกผลรอบล่าสุดลง Script Property', JSON.parse(PROPS.EXTERNAL_SALES_AUTO_LAST_RUN).created, 1);

st = ctx.scheduledExternalSalesImport();
eq('รอบถัดไป ใบเดิมไม่ถูกสร้างซ้ำ (กันซ้ำหลังได้ล็อก)', [st.created, st.skipped, STORE.purchase_orders.length], [0, 1, 1]);

ctx._computeExternalSalesCandidates = () => { throw new Error('ชีตอ่านไม่ได้'); };
let threw = false; try { ctx.scheduledExternalSalesImport(); } catch (e) { threw = true; }
eq('อ่านชีตล้ม → ต้องโยน error (ให้ trigger นับเป็นล้มเหลวและส่งอีเมลแจ้ง) + บันทึก ok:false',
  [threw, JSON.parse(PROPS.EXTERNAL_SALES_AUTO_LAST_RUN).ok], [true, false]);

const TRIG = [];
ctx.ScriptApp = {
  getProjectTriggers: () => TRIG.slice(),
  deleteTrigger: t => { TRIG.splice(TRIG.indexOf(t), 1); },
  newTrigger: fn => { const t = { fn, hour: null, getHandlerFunction: () => fn };
    const b = { timeBased: () => b, everyDays: () => b, atHour: h => { t.hour = h; return b; }, nearMinute: () => b, create: () => { TRIG.push(t); return t; } }; return b; }
};
TRIG.push({ getHandlerFunction: () => 'scheduledExternalSalesImport', hour: 99 }, { getHandlerFunction: () => 'อื่นๆ', hour: 1 });
let ins = ctx.installExternalSalesImportTriggers();
eq('ตั้ง trigger: ลบของเดิมของฟังก์ชันนี้ 1 ตัว (ไม่แตะ trigger อื่น) แล้วสร้าง 3 ตัว 8/12/18 นาฬิกา',
  [ins.removed, TRIG.filter(t => t.getHandlerFunction() === 'scheduledExternalSalesImport').map(t => t.hour), TRIG.length], [1, [8, 12, 18], 4]);
ctx.installExternalSalesImportTriggers();
eq('รันตั้ง trigger ซ้ำ → ยังมี 3 ตัว ไม่ซ้อนกัน', TRIG.filter(t => t.getHandlerFunction() === 'scheduledExternalSalesImport').length, 3);
eq('เอา trigger ออก', [ctx.removeExternalSalesImportTriggers().removed, TRIG.length], [3, 1]);


console.log('\n── ใบรับของรอตรวจรับยืดหยุ่น: factor ปัจจุบัน / หน่วยรายบรรทัด / เพิ่ม-ลบบรรทัด / รับบางส่วน (2 ต.ค. 2026) ──');
let D2;
const STOCK = [];
function fresh() {
  STOCK.length = 0;
  D2 = {
    products: [{ record_id: 1, name: 'สินค้า 1', product_code: 'P1', unit: 'ชิ้น' }, { record_id: 2, name: 'สินค้า 2', product_code: 'P2', unit: 'ชิ้น' },
               { record_id: 3, name: 'สินค้า 3', product_code: 'P3', unit: 'ชิ้น' }],
    // สินค้า 1: ทะเบียนหน่วยแก้เป็น 60 แล้ว (ตอนนำเข้าใบนี้เก็บ factor 1 ไว้) · สินค้า 2 ไม่มีแถวหน่วย CT เลย
    product_units: [{ product_id: 1, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 60, is_active: 'TRUE' },
                    { product_id: 3, unit_code: 'PK', unit_label: 'แพ็ค', unit_factor: 5, is_active: 'TRUE' }],
    purchase_orders: [{ record_id: 10, tenant_id: 'T1', status: 'sent', source_ref: 'IV9', subtotal_ex_vat: 6400, total: 6400, note: '' }],
    po_items: [{ record_id: 100, po_id: 10, product_id: 1, qty: 10, unit_code: 'CT', unit_factor: 1, unit_price: 600, amount: 6000, received_qty: 0 },
               { record_id: 101, po_id: 10, product_id: 2, qty: 4, unit_code: 'CT', unit_factor: 1, unit_price: 100, amount: 400, received_qty: 0 }],
    goods_receipts: [{ record_id: 20, tenant_id: 'T1', gr_no: 'GR-20', po_id: 10, status: 'pending_review', source_ref: 'IV9', receive_date: '2026-09-25', warehouse_id: 1, vendor_id: 1, note: 'เดิม' }],
    gr_items: [{ record_id: 200, gr_id: 20, po_item_id: 100, product_id: 1, qty: 10, unit_code: 'CT', unit_factor: 1, base_qty: 10, unit_cost: 600, amount: 6000 },
               { record_id: 201, gr_id: 20, po_item_id: 101, product_id: 2, qty: 4, unit_code: 'CT', unit_factor: 1, base_qty: 4, unit_cost: 100, amount: 400 }]
  };
}
let grDoc = 20;
Object.assign(ctx, {
  UNIT_PC: 'PC',
  normUnitCode: (c, d) => { const x = String(c == null ? '' : c).trim().toUpperCase(); return x ? ({ CASE: 'CT', PACK: 'PK', PCS: 'PC' }[x] || x) : (d === undefined ? '' : d); },
  _numOrNull: v => (v === null || v === undefined || String(v).trim() === '' ? null : (isFinite(Number(v)) ? Number(v) : NaN)),
  safeDateStr: v => String(v || ''),
  centralObjects: name => D2[name] || [],
  _scoped: name => D2[name] || [],
  _findScoped: (name, id) => D2[name].find(x => String(x.record_id) === String(id)) || null,
  _childrenOf: (name, fk, id) => D2[name].filter(r => String(r[fk]) === String(id)),
  centralUpdate: (name, id, patch) => { Object.assign(D2[name].find(x => String(x.record_id) === String(id)), patch); return true; },
  centralAppend: (name, row) => { D2[name].push(Object.assign({}, row)); },
  centralAppendMany: (name, rows) => { rows.forEach(r => D2[name].push(Object.assign({}, r))); },
  centralNextId: name => (D2[name] || []).reduce((m, o) => Math.max(m, o.record_id || 0), 0) + 1,
  centralSheet: name => ({ __n: name }),
  deleteRowsWhere: (sh, col, val) => { D2[sh.__n] = D2[sh.__n].filter(r => String(r[col]) !== String(val)); return 1; },
  _nextCentralDocNo: kind => kind + '-NEW-' + (++grDoc),
  _applyStockIn: (scope, wh, pid, baseQty, cost) => { STOCK.push({ pid, baseQty, cost }); }
});
const S1 = { adminUserId: 'u1' };

fresh();
const lst = ctx.listPendingExternalGoodsReceipts(S1, {}).data[0].items;
eq('รายการแสดง factor "ปัจจุบัน" ของสินค้า (60) ไม่ใช่ค่าตอนนำเข้า (1) และบอกค่าตอนนำเข้าไว้ด้วย', [lst[0].unitFactor, lst[0].importedFactor], [60, 1]);
eq('หน่วยที่เลือกได้ = หน่วยฐาน + หน่วยขายที่ใช้งานอยู่ (ชิ้น, CT)', lst[0].units.map(u => u.code), ['PC', 'CT']);
eq('สินค้าที่ไม่มีแถวหน่วย CT ใช้ค่าที่เก็บไว้ (1) แทน', lst[1].unitFactor, 1);

fresh();
let c = ctx.confirmExternalGoodsReceipt(S1, { id: 20, items: [{ grItemId: 200, qty: 10 }, { grItemId: 201, qty: 4 }] });
eq('ยืนยันโดยไม่ส่ง factor → ใช้ factor ปัจจุบัน: สินค้า 1 เข้าสต็อก 10 ลัง × 60 = 600 ชิ้น (ไม่ต้องถอนนำเข้าใหม่)',
  [c.success, STOCK.find(x => x.pid === '1').baseQty, STOCK.find(x => x.pid === '2').baseQty], [true, 600, 4]);
eq('ต้นทุนต่อหน่วยฐาน = ราคาต่อลัง 600 ÷ 60 = 10 · ใบสั่งซื้อรับครบ → received · ใบรับของ posted · ไม่มีใบเหลือ',
  [STOCK.find(x => x.pid === '1').cost, D2.purchase_orders[0].status, D2.goods_receipts[0].status, D2.goods_receipts.length], [10, 'received', 'posted', 1]);

fresh();
c = ctx.confirmExternalGoodsReceipt(S1, { id: 20, receiveDate: '2026-09-28', note: 'ของมาถึงช้า',
  items: [{ grItemId: 200, qty: 4 }, { grItemId: 201, remove: true }],
  newItems: [{ productId: 3, qty: 2, unitCode: 'PK', amount: 50 }] });
eq('รับบางส่วน + ลบบรรทัด + เพิ่มบรรทัด: สำเร็จ', c.success, true);
eq('สต็อกเข้า: สินค้า 1 = 4×60 = 240 · สินค้าเพิ่ม 3 = 2 แพ็ค × 5 = 10 · บรรทัดที่ลบไม่เข้า',
  STOCK.map(x => x.pid + ':' + x.baseQty).sort(), ['1:240', '3:10']);
eq('บรรทัดที่ลบ (สินค้า 2) หายทั้ง gr_items/po_items (เลขแถวลูกถูกใช้ซ้ำได้ ไม่เป็นไร เพราะลบคู่กัน)', [D2.gr_items.some(x => x.product_id === 2), D2.po_items.some(x => x.product_id === 2)], [false, false]);
const remGr = D2.goods_receipts.find(g => g.record_id !== 20);
const remItems = remGr ? D2.gr_items.filter(g => g.gr_id === remGr.record_id) : [];
eq('ส่วนที่เหลือ 6 ลัง (10−4) สร้างเป็นใบรอตรวจรับใหม่ pending_review ผูก PO เดิม + ใบกำกับภาษีเดิม',
  [!!remGr, remGr && remGr.status, remGr && remGr.po_id, remGr && remGr.source_ref, remItems.length, remItems[0] && remItems[0].qty, remItems[0] && remItems[0].amount],
  [true, 'pending_review', 10, 'IV9', 1, 6, 3600]);
eq('ใบสั่งซื้อ: partial · ยอดรวมคำนวณใหม่ = 6000 + 50 · วันที่รับ/หมายเหตุอัปเดต + บันทึกการลบ/เพิ่มไว้ในหมายเหตุ',
  [D2.purchase_orders[0].status, D2.purchase_orders[0].total, D2.goods_receipts[0].receive_date, /ของมาถึงช้า/.test(D2.goods_receipts[0].note), /ลบบรรทัด/.test(D2.goods_receipts[0].note), /เพิ่มบรรทัด/.test(D2.goods_receipts[0].note)],
  ['partial', 6050, '2026-09-28', true, true, true]);

fresh();
c = ctx.confirmExternalGoodsReceipt(S1, { id: 20, createRemainder: false, items: [{ grItemId: 200, qty: 4 }, { grItemId: 201, qty: 0 }] });
eq('createRemainder:false → ไม่สร้างใบเหลือ (ส่วนที่เหลือค้างอยู่ใน PO)', [c.success, D2.goods_receipts.length, D2.purchase_orders[0].status], [true, 1, 'partial']);

fresh();
c = ctx.confirmExternalGoodsReceipt(S1, { id: 20, items: [{ grItemId: 200, qty: 0 }, { grItemId: 201, qty: 0 }] });
eq('ไม่ติ๊กรับสักบรรทัด (qty 0 ทั้งหมด ไม่เพิ่มบรรทัด) → ปฏิเสธ ไม่เขียนอะไร', [c.success, D2.goods_receipts[0].status, STOCK.length], [false, 'pending_review', 0]);

fresh();
c = ctx.confirmExternalGoodsReceipt(S1, { id: 20, items: [{ grItemId: 200, qty: 10, unitFactor: 12 }, { grItemId: 201, qty: 4 }],
  newItems: [{ productId: 3, qty: 1, unitCode: 'CT', unitFactor: 99, amount: 0 }] });
eq('factor แก้ตรงๆ ไม่ได้: ส่ง unitFactor 12 / 99 มาก็ถูกเมิน ใช้ factor ปัจจุบันของหน่วย (สินค้า 1 ลัง = 60 → 600 ชิ้น · สินค้า 3 ไม่มีแถว CT → 1)',
  [STOCK.find(x => x.pid === '1').baseQty, STOCK.find(x => x.pid === '3').baseQty], [600, 1]);

fresh();
c = ctx.confirmExternalGoodsReceipt(S1, { id: 20, items: [{ grItemId: 200, qty: 120, unitCode: 'PC' }, { grItemId: 201, qty: 4 }] });
eq('เปลี่ยนหน่วยที่รับจริงเป็นชิ้น (PC) รับ 120 ชิ้น → เข้าสต็อก 120 · PO นับเป็น 2 ลัง (120÷60) · ต้นทุนยังอิงราคาลัง 600÷60 = 10 · เหลือ 8 ลังเป็นใบใหม่',
  [STOCK.find(x => x.pid === '1').baseQty, STOCK.find(x => x.pid === '1').cost, D2.po_items[0].received_qty, D2.purchase_orders[0].status,
   (D2.gr_items.find(g => g.gr_id !== 20 && g.product_id === 1) || {}).qty], [120, 10, 2, 'partial', 8]);


console.log('\n── ★ ตรวจรับแล้วลงบัญชี + ตั้งหนี้ให้อัตโนมัติ (เจ้าของระบบสั่ง 7 ต.ค. 2026) ──');
/* เส้นทางนี้คือเส้นทางจริงของ BDC — ของเข้าทางนี้ทุกวัน ไม่ใช่ทาง receiveGoods
   เดิมเขียนไว้ว่า "ไม่ลงบัญชี" ตามกติกาเก่าที่ตัวแทนยังไม่มีสมุด พอตัวแทนมีสมุดแล้วแต่ลืมแก้ที่นี่
   สมุดของเขาจะว่างเปล่าตลอดไป (เจอจริง: ต้องไล่ backfill 2 ใบรวมล้านกว่าบาทบน UAT) */
{
  fresh();
  ctx.jvCalls = []; ctx.apCalls = [];
  const c2 = ctx.confirmExternalGoodsReceipt(S1, { id: 20, receiveDate: '2026-09-28',
    items: [{ grItemId: 200, qty: 10 }, { grItemId: 201, qty: 4 }] });
  /* ★ เทียบกับมูลค่าที่เข้าสต็อกจริง ไม่ใช่ตัวเลขที่เขียนตายไว้ — นี่คือสิ่งที่ต้องจริงเสมอ:
     บัญชีสินค้าคงเหลือต้องขยับเท่ากับของที่เข้าคลังจริง ไม่งั้นบัญชีกับคลังจะเริ่มเพี้ยนจากกัน */
  const stockValue = STOCK.reduce((sum, x) => sum + x.baseQty * x.cost, 0);
  eq('ตรวจรับแล้วลงบัญชีให้ ด้วยยอดเท่ามูลค่าที่เข้าสต็อกจริง',
    [ctx.jvCalls.length, ctx.jvCalls[0] && ctx.jvCalls[0].debit, stockValue > 0], [1, stockValue, true]);
  eq('  ★ ลงวันที่รับของจริง ไม่ใช่วันที่กดตรวจรับ (นาฬิกาในกล่องทดสอบคือ 2 ต.ค.)',
    ctx.jvCalls[0].date, '2026-09-28');
  eq('  ★ ลงในสมุดของตัวแทนเจ้าของใบ', ctx.jvCalls[0].book, 'T1');
  eq('  ติดเลขใบสำคัญกลับไปที่ใบรับของ', !!D2.goods_receipts[0].journal_id, true);
  eq('  ตั้งหนี้ให้ต่อทันที ด้วยวันที่และสมุดเดียวกัน',
    [ctx.apCalls.length, ctx.apCalls[0] && ctx.apCalls[0].billDate, ctx.apCalls[0] && ctx.apCalls[0].book],
    [1, '2026-09-28', 'T1']);
  eq('  ตอบกลับหน้าจอบอกทั้งเลขใบสำคัญและเลขตั้งหนี้', [!!c2.journalId, c2.billNo], [true, 'AP-TEST-0001']);

  /* ★★ ลงบัญชีไม่สำเร็จ ต้องไม่ล้มการตรวจรับ — ของเข้าสต็อกไปแล้ว ย้อนไม่ได้
     และต้องไม่ตั้งหนี้ต่อ (ตั้งหนี้คือการล้าง GR-NI ที่ยังไม่ได้ตั้งขึ้นมา) */
  fresh();
  ctx.jvCalls = []; ctx.apCalls = []; ctx.jvFails = true;
  const c3 = ctx.confirmExternalGoodsReceipt(S1, { id: 20, items: [{ grItemId: 200, qty: 10 }, { grItemId: 201, qty: 4 }] });
  eq('ลงบัญชีล้ม → ตรวจรับยังสำเร็จ ของเข้าสต็อกตามปกติ และบอกเหตุผลเป็นคำเตือน',
    [c3.success, D2.goods_receipts[0].status, STOCK.find(x => x.pid === '1').baseQty,
     /ยังไม่ได้ลงบัญชี/.test(c3.warning || '')], [true, 'posted', 600, true]);
  eq('  และต้องไม่ตั้งหนี้ต่อ (ยังไม่มี GR-NI ให้ล้าง)', ctx.apCalls.length, 0);
  ctx.jvFails = false;
}

console.log('\n── 4.3.3 ประวัติใบรับของที่นำเข้า (ผู้ใช้สั่ง 13 พ.ย. 2026) ──');
/* ★ 4.3.2 กรองแค่ pending_review — ตรวจรับแล้วใบหายจากหน้าจอทันที ไม่มีทางกลับไปดูว่ารับอะไรเข้ามา
   หน้านี้คือที่เดียวที่จับคู่ "เลขเอกสารฝั่ง TNK (source_ref)" กับใบรับของ/ใบสั่งซื้อของเราได้ */
{
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const D3 = {
    products: [{ record_id: 1, product_code: 'P1', name: 'สินค้า 1' }],
    warehouses: [{ record_id: 1, name: 'คลังศูนย์' }],
    purchase_orders: [{ record_id: 10, po_no: 'PO-A', source_ref: 'IV-A' }, { record_id: 11, po_no: 'PO-B', source_ref: 'IV-B' },
                      { record_id: 12, po_no: 'PO-C', source_ref: 'IV-C' }, { record_id: 13, po_no: 'PO-MANUAL', source_ref: '' },
                      { record_id: 14, po_no: 'PO-OLD', source_ref: 'IV-OLD' }],
    ap_bills: [{ record_id: 5, gr_id: 20, bill_no: 'AP-1', status: 'posted' },
               { record_id: 6, gr_id: 21, bill_no: 'AP-VOID', status: 'void' }],   // ใบที่ void แล้วต้องไม่นับว่าตั้งหนี้แล้ว
    goods_receipts: [
      { record_id: 20, gr_no: 'GR-20', po_id: 10, warehouse_id: 1, source_ref: 'IV-A', status: 'posted', receive_date: daysAgo(3), journal_id: 900, note: 'ตรวจรับแล้ว', created_at: '2026-11-10 09:00:00', created_by: 'system:auto' },
      { record_id: 21, gr_no: 'GR-21', po_id: 11, warehouse_id: 1, source_ref: 'IV-B', status: 'pending_review', receive_date: today, journal_id: '', note: '', created_at: '', created_by: 'system:auto' },
      { record_id: 22, gr_no: 'GR-22', po_id: 12, warehouse_id: 1, source_ref: 'IV-C', status: 'cancelled', receive_date: daysAgo(1), journal_id: '', note: 'ถอนกลับ', created_at: '', created_by: '' },
      { record_id: 23, gr_no: 'GR-23', po_id: 13, warehouse_id: 1, source_ref: '', status: 'posted', receive_date: today, journal_id: '', note: 'คีย์เองในระบบ', created_at: '', created_by: 'u1' },
      { record_id: 24, gr_no: 'GR-24', po_id: 14, warehouse_id: 1, source_ref: 'IV-OLD', status: 'posted', receive_date: daysAgo(200), journal_id: '', note: '', created_at: '', created_by: 'system:auto' }
    ],
    gr_items: [{ record_id: 200, gr_id: 20, product_id: 1, qty: 10, unit_code: 'CT', unit_factor: 60, base_qty: 600, unit_cost: 10, amount: 6000 },
               { record_id: 201, gr_id: 20, product_id: 1, qty: 2, unit_code: 'CT', unit_factor: 60, base_qty: 120, unit_cost: 10, amount: 1200 },
               { record_id: 202, gr_id: 21, product_id: 1, qty: 1, unit_code: 'CT', unit_factor: 60, base_qty: 60, unit_cost: 10, amount: 600 },
               { record_id: 203, gr_id: 24, product_id: 1, qty: 1, unit_code: 'CT', unit_factor: 60, base_qty: 60, unit_cost: 10, amount: 600 }]
  };
  Object.assign(ctx, {
    _dOnly: v => String(v || ''), _todayStr: () => today,
    centralObjects: name => D3[name] || [], _scoped: name => D3[name] || [],
    _childrenOf: (name, fk, id) => (D3[name] || []).filter(r => String(r[fk]) === String(id))
  });

  const h = ctx.listExternalGoodsReceiptHistory({ adminUserId: 'u1' }, {});
  eq('ไม่ส่งช่วงวันที่ = ย้อนหลัง 90 วัน · เอาเฉพาะใบที่มีเลขเอกสาร TNK (ใบที่คีย์เองและใบเก่า 200 วันไม่ติดมา)',
    h.data.map(g => g.sourceRef), ['IV-B', 'IV-C', 'IV-A']);
  eq('  ★ เรียงใหม่สุดอยู่บน (วันนี้ → เมื่อวาน → 3 วันก่อน)', h.data.map(g => g.grNo), ['GR-21', 'GR-22', 'GR-20']);
  eq('  ★★ ทุกใบบอกเลขเอกสารฝั่ง TNK คู่กับเลขใบรับของและใบสั่งซื้อของเรา — กุญแจจับคู่ที่ขาดไปก่อนหน้านี้',
    h.data.map(g => g.sourceRef + '=' + g.grNo + '/' + g.poNo), ['IV-B=GR-21/PO-B', 'IV-C=GR-22/PO-C', 'IV-A=GR-20/PO-A']);

  const a = h.data.find(g => g.sourceRef === 'IV-A');
  eq('  รายการสินค้ามาพร้อมในคำขอเดียว (ไม่ต้องยิง getGoodsReceipt ทีละใบ) พร้อมรหัส/ชื่อ/หน่วยฐาน/ต้นทุน',
    [a.itemCount, a.items[0].productCode, a.items[0].baseQty, a.items[0].unitCost], [2, 'P1', 600, 10]);
  eq('  มูลค่าใบ = ผลรวมของรายการในใบนั้น (6000 + 1200)', a.amount, 7200);
  eq('  ใบที่ตั้งหนี้แล้วบอกเลขใบตั้งหนี้ · ใบสถานะยังอยู่ครบทั้งสามแบบ',
    [a.billNo, a.status, h.data.find(g => g.sourceRef === 'IV-B').status, h.data.find(g => g.sourceRef === 'IV-C').status],
    ['AP-1', 'posted', 'pending_review', 'cancelled']);
  eq('  ใบตั้งหนี้ที่ void แล้วไม่นับว่าตั้งหนี้ (GR-21 ต้องว่าง)', h.data.find(g => g.grNo === 'GR-21').billNo, '');

  const narrow = ctx.listExternalGoodsReceiptHistory({ adminUserId: 'u1' }, { from: daysAgo(2), to: today });
  eq('ส่งช่วงวันที่มา → กรองตามนั้น (3 วันก่อนหลุดออกไป) และบอกช่วงที่ใช้กลับมาให้หน้าจอ',
    [narrow.data.map(g => g.grNo), narrow.from, narrow.to], [['GR-21', 'GR-22'], daysAgo(2), today]);

  const old = ctx.listExternalGoodsReceiptHistory({ adminUserId: 'u1' }, { from: daysAgo(201), to: daysAgo(199) });
  eq('ย้อนไปช่วงเก่าได้ (ใบ 200 วันก่อนยังหาเจอ — ประวัติไม่ได้ถูกตัดทิ้ง แค่ไม่โหลดมาทั้งหมดโดยปริยาย)',
    old.data.map(g => g.grNo), ['GR-24']);
}


console.log('\n── ★ 4.3.1: Ultra Admin ใช้ในนามตัวแทนได้ แต่เห็น/นำเข้าได้เฉพาะใบของตัวแทนนั้น (เจ้าของระบบสั่ง 16 พ.ย. 2026) ──');
{
  // ★ ดึงตัวตัดสินสิทธิ์จากไฟล์จริงมาใช้ ไม่เขียนเลียนแบบ — ไม่งั้นวันที่ของจริงเปลี่ยน เทสต์จะยังเขียวทั้งที่ด่านพัง
  const grab = (file, name) => { const m = B(file).match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}')); if (!m) throw new Error('ไม่พบ ' + name); return m[0]; };
  vm.runInContext('var OWNER_TENANT_ID = "TNKI";\n' + grab('02_helpers.gs', '_isCompanySide') + '\n' + grab('14_permissions.gs', '_effectiveTenantId'), ctx);

  const S3 = { purchase_orders: [], po_items: [], goods_receipts: [], gr_items: [] };
  let n3 = 0;
  Object.assign(ctx, {
    _requirePermission: () => null,
    _withDocLock: fn => fn(),
    centralObjects: name => S3[name] || [],
    centralNextId: name => (S3[name] || []).reduce((m, o) => Math.max(m, o.record_id || 0), 0) + 1,
    centralAppend: (name, row) => { S3[name].push(Object.assign({}, row)); },
    centralAppendMany: (name, rows) => { rows.forEach(r => S3[name].push(Object.assign({}, r))); },
    _findById: (name, id) => S3[name].find(x => String(x.record_id) === String(id)),
    _nextCentralDocNo: kind => kind + '-' + (++n3),
    _ensureCompanyVendor: () => 1, _ensureScopeWarehouse: () => 1,
  });
  const mk = (inv, tid, name) => ({ invoiceNumber: inv, invoiceDate: '2026-09-26', tenantId: tid, tenantName: name,
    lines: [{ productId: 1, productName: 'สินค้า A', qtyCT: 2, amtActual: 200 }], totalAmt: 200 });
  const CANDS = () => ({
    candidates: [mk('IV-T1', 'T1', 'ศูนย์ที่ 1'), mk('IV-T2', 'T2', 'ศูนย์ที่ 2')],
    alreadyImported: [{ invoiceNumber: 'IV-OLD1', invoiceDate: '2026-09-20', tenantId: 'T1' }, { invoiceNumber: 'IV-OLD2', invoiceDate: '2026-09-20', tenantId: 'T2' }],
    errors: [{ invoiceNumber: 'IV-E1', tenantId: 'T1', reason: 'ไม่พบสินค้า' }, { invoiceNumber: 'IV-E2', tenantId: 'T2', reason: 'ไม่พบสินค้า' },
             { invoiceNumber: 'IV-E3', reason: 'ไม่พบศูนย์ที่ customer_account = "X"' }]
  });
  ctx._computeExternalSalesCandidates = CANDS;

  const COMPANY_ADMIN = { adminUserId: 'a1', role_code: 'owner_admin', tenant_id: '' };
  const ULTRA        = { adminUserId: 'u9', role_code: 'super_admin', tenant_id: '' };
  const ULTRA_TNKI   = { adminUserId: 'u9', role_code: 'super_admin', tenant_id: 'TNKI' };   // ฝั่งบริษัทเก็บสังกัดเป็น TNKI (truthy) — กับดักเดิมของ _effectiveTenantId
  const TENANT_USER  = { adminUserId: 't1', role_code: 'tenant_admin', tenant_id: 'T1' };
  const ids = a => a.map(x => x.invoiceNumber);

  // ── ในนามบริษัท: เหมือนเดิมทุกอย่าง เห็นทุกศูนย์ ──
  let r1 = ctx.previewExternalSalesImport(COMPANY_ADMIN, {});
  eq('ในนามบริษัท: เห็นทุกศูนย์ (ใบ/นำเข้าแล้ว/จับคู่ไม่ได้ ครบ รวมใบที่ไม่รู้ว่าเป็นของใคร)',
    [r1.success, ids(r1.candidates), ids(r1.alreadyImported), ids(r1.errors)], [true, ['IV-T1', 'IV-T2'], ['IV-OLD1', 'IV-OLD2'], ['IV-E1', 'IV-E2', 'IV-E3']]);
  eq('เรียกแบบไม่ส่ง payload เลย (ของเดิมเรียกแบบนี้) ก็ยังทำงาน', ctx.previewExternalSalesImport(COMPANY_ADMIN).success, true);

  // ── Ultra Admin สวมสิทธิ์ตัวแทน: เห็นเฉพาะของตัวแทนนั้น ──
  let r2 = ctx.previewExternalSalesImport(ULTRA, { tenantId: 'T1' });
  eq('Ultra Admin สวมสิทธิ์ T1: เห็นเฉพาะใบของ T1 (ใบของ T2 ถูกกรองออก ไม่ใช่แค่ซ่อน)',
    [r2.success, ids(r2.candidates), ids(r2.alreadyImported), r2.scopeTenantId], [true, ['IV-T1'], ['IV-OLD1'], 'T1']);
  eq('  ★ ใบที่จับคู่ศูนย์ไม่ได้ (ไม่รู้ว่าเป็นของใคร) ไม่โผล่ในมุมมองของตัวแทน — ตอบไม่ได้ว่าเป็นของเขา', ids(r2.errors), ['IV-E1']);
  eq('  ★★ สังกัดเก็บเป็น TNKI (truthy) ก็สวมสิทธิ์ได้ — กับดักเดียวกับที่ทำให้ฝั่งบริษัทเข้าไปดูแลตัวแทนไม่ได้ทั้งระบบ (1 ต.ค. 2026)',
    ids(ctx.previewExternalSalesImport(ULTRA_TNKI, { tenantId: 'T1' }).candidates), ['IV-T1']);
  eq('  Ultra Admin ที่ยังไม่ได้สวมสิทธิ์ใคร ยังเห็นทุกศูนย์', ids(ctx.previewExternalSalesImport(ULTRA, {}).candidates), ['IV-T1', 'IV-T2']);

  // ── บทบาทฝั่งบริษัทอื่น (ไม่ใช่ Ultra) สวมสิทธิ์ตัวแทนแล้วใช้ไม่ได้ ──
  let r3 = ctx.previewExternalSalesImport(COMPANY_ADMIN, { tenantId: 'T1' });
  eq('แอดมินบริษัท (ไม่ใช่ Ultra) สวมสิทธิ์ T1 → ปฏิเสธ ไม่คืนรายการสักใบ', [r3.success, r3.candidates], [false, undefined]);
  eq('  ข้อความบอกทางออก (กลับไปทำในนามบริษัท)', /Ultra Admin/.test(r3.message) && /นามบริษัท/.test(r3.message), true);

  // ── ตัวแทนจริง: ไม่มีทางเข้า แม้ส่ง tenantId มาเอง ──
  eq('บัญชีที่สังกัดตัวแทน → ปฏิเสธ (ข้อมูลขายออกเป็นของบริษัท กติกาเดิม)', ctx.previewExternalSalesImport(TENANT_USER, {}).success, false);
  eq('  ส่ง tenantId ตัวเองมาก็ไม่ช่วย', ctx.previewExternalSalesImport(TENANT_USER, { tenantId: 'T1' }).success, false);
  eq('  ส่ง tenantId ของศูนย์อื่นมาก็ไม่ช่วย', ctx.previewExternalSalesImport(TENANT_USER, { tenantId: 'T2' }).success, false);
  eq('  แม้ role_code จะเป็น super_admin แต่สังกัดตัวแทนอยู่ → ยังปฏิเสธ (สังกัดตัดสินก่อนบทบาท)',
    ctx.previewExternalSalesImport({ adminUserId: 'x', role_code: 'super_admin', tenant_id: 'T1' }, { tenantId: 'T1' }).success, false);

  // ── นำเข้าจริง: กรองซ้ำฝั่ง backend เพราะเลขใบมาจากหน้าจอ (เชื่อไม่ได้) ──
  let im = ctx.importExternalSalesInvoices(ULTRA, { tenantId: 'T1', invoiceNumbers: ['IV-T1', 'IV-T2'] });
  eq('สวมสิทธิ์ T1 แล้วส่งเลขใบของ T2 มาด้วย → นำเข้าเฉพาะของ T1 ใบของ T2 ถูกข้ามพร้อมเหตุผล',
    [im.success, ids(im.created), im.skipped.map(x => x.invoiceNumber), S3.purchase_orders.map(x => x.source_ref)], [true, ['IV-T1'], ['IV-T2'], ['IV-T1']]);
  eq('  ★ ใบที่ถูกข้ามไม่สร้างเอกสารสักแถว (ไม่มี PO/GR ของ T2 โผล่ในสมุดคนอื่น)',
    [S3.purchase_orders.filter(x => x.tenant_id === 'T2').length, S3.goods_receipts.filter(x => x.tenant_id === 'T2').length], [0, 0]);
  eq('  เหตุผลที่ข้ามบอกชื่อศูนย์เจ้าของใบ', /ศูนย์ที่ 2/.test(im.skipped[0].reason), true);

  const before = S3.purchase_orders.length;
  let bad = ctx.importExternalSalesInvoices(COMPANY_ADMIN, { tenantId: 'T2', invoiceNumbers: ['IV-T2'] });
  eq('แอดมินบริษัท (ไม่ใช่ Ultra) สวมสิทธิ์แล้วสั่งนำเข้า → ปฏิเสธ และไม่สร้างอะไร', [bad.success, S3.purchase_orders.length], [false, before]);
  let bad2 = ctx.importExternalSalesInvoices(TENANT_USER, { invoiceNumbers: ['IV-T2'] });
  eq('บัญชีตัวแทนสั่งนำเข้า → ปฏิเสธ และไม่สร้างอะไร', [bad2.success, S3.purchase_orders.length], [false, before]);

  let all = ctx.importExternalSalesInvoices(ULTRA, { invoiceNumbers: ['IV-T2'] });
  eq('ในนามบริษัท (ไม่สวมสิทธิ์) นำเข้าใบของ T2 ได้ตามปกติ — พฤติกรรมเดิมไม่เปลี่ยน',
    [all.success, ids(all.created), S3.purchase_orders.some(x => x.source_ref === 'IV-T2' && x.tenant_id === 'T2')], [true, ['IV-T2'], true]);

  // ── สถานะนำเข้าอัตโนมัติ ──
  eq('สถานะนำเข้าอัตโนมัติ: Ultra Admin สวมสิทธิ์ตัวแทนดูได้', ctx.getExternalSalesAutoImportStatus(ULTRA, { tenantId: 'T1' }).success, true);
  eq('  แอดมินบริษัทที่ไม่ใช่ Ultra สวมสิทธิ์ → ปฏิเสธ', ctx.getExternalSalesAutoImportStatus(COMPANY_ADMIN, { tenantId: 'T1' }).success, false);
  eq('  บัญชีตัวแทน → ปฏิเสธ', ctx.getExternalSalesAutoImportStatus(TENANT_USER, {}).success, false);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
