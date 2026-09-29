// รัน: node .dev/test-mobile-sale-detail.js
// ทดสอบ getSaleDetail (06_bootstrap.gs) — ดูรายละเอียดบิล/พิมพ์ซ้ำจากแอปมือถือ (เจ้าของระบบสั่ง 2026-09-30)
// ประเด็นสำคัญที่สุดคือเรื่องสิทธิ์: คนขับต้องดูได้แค่บิลของตัวเอง ดูของคนอื่นในตัวแทนเดียวกันไม่ได้
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const t = {
  sales_orders: [
    { record_id: 1, order_code: 'SO-T1-202609-0001', customer_id: 1, subtotal: 107, discount: 0, total: 107,
      apply_vat: 'TRUE', vat_type: 'inclusive', vat_rate: 0.07, subtotal_ex_vat: 100, vat_amount: 7, exempt_amount: 0,
      payment_method: 'cash', fulfillment_type: 'immediate', status: 'completed',
      sale_by: 'U_DRIVER_A', created_at: '2026-09-30 09:15:00' },
    { record_id: 2, order_code: 'SO-T1-202609-0002', customer_id: 1, subtotal: 200, discount: 0, total: 200,
      apply_vat: 'FALSE', vat_type: 'inclusive', vat_rate: 0.07, subtotal_ex_vat: 200, vat_amount: 0, exempt_amount: 200,
      payment_method: 'cash', fulfillment_type: 'immediate', status: 'completed',
      sale_by: 'U_DRIVER_B', created_at: '2026-09-30 10:00:00' }   // บิลของคนขับอีกคน — ห้าม U_DRIVER_A เห็น
  ],
  order_items: [
    { record_id: 1, order_id: 1, product_id: 1, unit_code: '', qty: 5, price: 20, line_total: 100, is_free: 0 },
    { record_id: 2, order_id: 1, product_id: 1, unit_code: '', qty: 1, price: 0, line_total: 0, is_free: 1 }
  ]
};
const sheetOf = n => { if (!t[n]) t[n] = []; return t[n]; };
const CENTRAL = {
  products: [{ record_id: 1, name: 'เรนเจอร์เอ็กซ์ตรีม แซนดัลวูด' }],
  customers: [{ record_id: 1, name: 'ร้านทดสอบ', name_prefix: '', phone: '081-000-0000' }]
};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-30', getUuid: () => 'uuid' },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  centralObjects: n => (CENTRAL[n] || []).map(o => Object.assign({}, o)),
  tenantObjects: (tid, n) => sheetOf(n).map(o => Object.assign({}, o)),
  safeDateStr: v => String(v || ''), nowStr: () => '2026-09-30 12:00:00'
};
vm.createContext(ctx);
['18_pricing_engine.gs', '33_customers.gs', '06_bootstrap.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const fails = (name, r, re) => {
  const good = r && r.success === false && (!re || re.test(r.message || ''));
  console.log((good ? 'PASS ' : 'FAIL ') + name + (good ? '' : '\n   got ' + JSON.stringify(r)));
  if (!good) failed++;
};

const DRIVER_A = { lineUserId: 'U_DRIVER_A', tenantId: 'T1', role: 'van_sales' };
const DRIVER_B = { lineUserId: 'U_DRIVER_B', tenantId: 'T1', role: 'van_sales' };

console.log('── getSaleDetail(): เห็นได้แค่บิลของตัวเอง ──');
fails('คนขับ A ดูบิลของคนขับ B ไม่ได้ (แม้อยู่ตัวแทนเดียวกัน)',
  ctx.getSaleDetail(DRIVER_A, { orderCode: 'SO-T1-202609-0002' }), /ไม่พบบิลนี้|ไม่ใช่บิลของท่าน/);
fails('รหัสบิลไม่มีจริง → ปฏิเสธ', ctx.getSaleDetail(DRIVER_A, { orderCode: 'SO-NOT-EXIST' }), /ไม่พบบิลนี้/);

console.log('\n── getSaleDetail(): เนื้อหาบิลของตัวเอง ──');
let r = ctx.getSaleDetail(DRIVER_A, { orderCode: 'SO-T1-202609-0001' });
eq('ดึงบิลของตัวเองได้ ครบ header', [r.success, r.order.code, r.order.customer, r.order.total],
  [true, 'SO-T1-202609-0001', 'ร้านทดสอบ', 107]);
eq('  VAT อ่านจากภาพนิ่งที่บันทึกไว้ ไม่คำนวณใหม่ (guide ข้อ 4)', [r.order.applyVat, r.order.vatAmount, r.order.subtotalExVat], [true, 7, 100]);
eq('  แยกรายการที่คิดเงินกับของแถมด้วย isFree', [r.items.length, r.items[0].isFree, r.items[1].isFree, r.items[1].qty], [2, false, true, 1]);

r = ctx.getSaleDetail(DRIVER_B, { orderCode: 'SO-T1-202609-0002' });
eq('บิลที่ไม่มี VAT (ลูกค้ายกเว้นภาษี) — applyVat ต้องเป็น false', [r.success, r.order.applyVat], [true, false]);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
