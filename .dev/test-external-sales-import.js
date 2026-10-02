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
  row({ InvoiceDate: '2026/09/26', InvoiceNumber: 'INV-1', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 5, Amt_actual: 5000, DiscountAmt: 100, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Entity: 'TNKI' }),
  row({ InvoiceDate: '2026/09/26', InvoiceNumber: 'INV-1', Customer_id: 'CD00017', ProductNumber: '10115', qtyCT: 2, Amt_actual: 2000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Entity: 'TNKI' }),
  // ใบ INV-2: ก่อน cutoff (2026-09-25) — ต้องถูกตัดทิ้ง
  row({ InvoiceDate: '2026/09/24', InvoiceNumber: 'INV-2', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Entity: 'TNKI' }),
  // ใบ INV-3: Entity ไม่ใช่ TNKI (เช่น ศูนย์ขายต่อ/Sell-out) — ต้องถูกตัดทิ้ง
  row({ InvoiceDate: '2026/09/26', InvoiceNumber: 'INV-3', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-out', Sell_FOC: 'Sell', Entity: 'BDC' }),
  // ใบ INV-4: ศูนย์ที่ไม่มีใน tenants.customer_account — ควรไปอยู่ errors
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-4', Customer_id: 'CD99999', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Entity: 'TNKI' }),
  // ใบ INV-5: สินค้าไม่มีใน products.product_code — ควรไปอยู่ errors
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-5', Customer_id: 'CD00017', ProductNumber: '99999', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Entity: 'TNKI' }),
  // ใบ INV-6: ของแถมล้วน (qtyCT=1 แต่ Amt_actual=0, Sell_FOC=FOC) — เส้นทางนี้ไม่ได้กรองด้วย Sell_FOC โดยตรง
  // (เอนจิ้นดูแค่ qtyCT>0) จึงยังเข้ามาเป็นรายการซื้อปกติที่ Amt_actual=0 — ตรวจว่าคำนวณ unit price ได้ 0 ไม่ error
  row({ InvoiceDate: '2026/09/27', InvoiceNumber: 'INV-6', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 0, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'FOC', Entity: 'TNKI' }),
  // ใบ INV-7: นำเข้าไปแล้ว (จะมี PO ที่ source_ref=INV-7) — ควรไปอยู่ alreadyImported
  row({ InvoiceDate: '2026/09/28', InvoiceNumber: 'INV-7', Customer_id: 'CD00017', ProductNumber: '10114', qtyCT: 1, Amt_actual: 1000, DiscountAmt: 0, Sales_type: 'Sell-in', Sell_FOC: 'Sell', Entity: 'TNKI' })
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
const PURCHASE_ORDERS = [{ record_id: 1, tenant_id: 'T1', source_ref: 'INV-7' }];
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

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
