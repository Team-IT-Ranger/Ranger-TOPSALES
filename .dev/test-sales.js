// รัน: node .dev/test-sales.js — ทดสอบ _priceSaleCart() (07_sales.gs) โดยเฉพาะกติกา "แพ็คขายเฉพาะ Cash Van เงินสด"
// ในเส้นทาง fallback (ลูกค้าที่ยังไม่มีชุดราคาที่ใช้งานอยู่ → applyPromotions แบบเดิม) ซึ่งเดิมไม่เช็คกติกานี้เลย
// (บั๊กที่เจอจริงบน UAT 2026-09-28 ตอนสร้างตัวแทนทดสอบใหม่แล้วขายแพ็คด้วยเครดิตผ่านฉลุย — ดู CLAUDE.md/who-is-doing-what.md)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Utilities: { formatDate: () => '2026-09-28', computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' } },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
};
vm.createContext(ctx);
for (const f of ['28_units.gs', '17_pricing.gs', '18_pricing_engine.gs', '11_promotions.gs', '07_sales.gs']) {
  vm.runInContext(B(f), ctx, { filename: f });
}

// ── ข้อมูลจำลอง ──
const PRODUCTS = [{ record_id: 1, name: 'เรนเจอร์เอ็กซ์ตรีม แซนดัลวูด', group_id: 0, base_price: 20, tax_status: 'vat' }];
const PRODUCT_UNITS = [
  { product_id: 1, unit_code: 'PK', unit_factor: 5, price: 101, is_active: 'TRUE' },
  { product_id: 1, unit_code: 'CT', unit_factor: 60, price: 1200, is_active: 'TRUE' }
];
const CUSTOMERS = [{ record_id: 1, name: 'ร้านทดสอบ', tax_type: '' }];
ctx.centralObjects = name => {
  if (name === 'products') return PRODUCTS;
  if (name === 'product_units') return PRODUCT_UNITS;
  if (name === 'customers') return CUSTOMERS;
  if (name === 'discount_rules') return [];
  return [];
};
// บังคับให้ไม่มีชุดราคาที่ใช้ได้เสมอ (จำลองลูกค้า/ตัวแทนที่ยังไม่ได้จ่ายชุดราคาให้ — เส้นทาง fallback)
ctx.getPricingContextForCustomer = () => null;

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

console.log('── _priceSaleCart(): แพ็คขายเฉพาะ Cash Van + เงินสด แม้ไม่มีชุดราคา (fallback ก็ต้องเช็ค) ──');

let r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'PK', qty: 2 }], 'cash', false);
eq('แพ็คนอก Cash Van (isVan=false) ถูกปฏิเสธแม้ลูกค้าไม่มีชุดราคา', [r.success, r.code], [false, 'PACK_VAN_ONLY']);

r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'PK', qty: 2 }], 'credit_term', true);
eq('แพ็คแบบเครดิตถูกปฏิเสธแม้ลูกค้าไม่มีชุดราคา (บั๊กเดิม: ผ่านฉลุย)', [r.success, r.code], [false, 'PACK_CASH_ONLY']);

r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'PK', qty: 2 }], 'cash', true);
eq('แพ็ค Cash Van เงินสด ผ่านปกติ (ราคาต่อแพ็ค × 2)', [r.success, r.items[0].lineTotal], [true, 202]);

r = ctx._priceSaleCart(1, [{ productId: 1, unitCode: 'CT', qty: 1 }], 'credit_term', false);
eq('ขายเป็นลัง (ไม่ใช่แพ็ค) ด้วยเครดิตนอก Cash Van ยังขายได้ปกติ (กติกานี้จำเพาะแพ็คเท่านั้น)', r.success, true);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
