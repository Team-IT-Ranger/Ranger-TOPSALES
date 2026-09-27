// รัน: node .dev/test-free-goods.js
// ทดสอบชุดแถม (39_free_goods.gs) — สร้างจากใบอนุมัติจริง Promotion Jul-Sep'26 ซึ่งเป็นของแถมล้วนทั้งใบ
// จุดที่ต้องคุมให้แน่น: "ซื้อ 12 ลัง FOC 1 ลัง · ซื้อ 6 ลัง FOC 6 แพ็ค · ซื้อ 1 ลัง FOC 1 แพ็ค" คือกลไกเดียว
// สามขั้น ไม่ใช่สามโปรที่ได้พร้อมกัน — ถ้าให้ทุกขั้นทำงาน บริษัทแจกของฟรีเกินที่อนุมัติโดยไม่มีใครเห็น
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'HOUSE', name: 'บริษัท', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี', is_active: 'TRUE' },
    { tenant_id: 'NKN', name: 'นครนายก', is_active: 'TRUE' }
  ],
  customers: [
    { record_id: 1, customer_code: 'C0001', name: 'ร้านของ BDC', tenant_id: 'BDC', group_id: 12, channel_id: 'WS', attributes: '' },
    { record_id: 2, customer_code: 'C0002', name: 'ร้านของ NKN', tenant_id: 'NKN', group_id: 12, channel_id: 'PS', attributes: '' }
  ],
  // 12hrs = 3 SKU · Extreme = 2 SKU (ทั้งคู่อยู่กลุ่ม 7 — กลุ่มจึงแยกสองตระกูลนี้ไม่ได้)
  products: [
    { record_id: 101, name: 'สเก้าท์1 12ชม แซนดัลวูด', group_id: 7 },
    { record_id: 102, name: 'สเก้าท์1 12ชม ลาเวนเดอร์', group_id: 7 },
    { record_id: 103, name: 'สเก้าท์1 12ชม ควันน้อย', group_id: 7 },
    { record_id: 201, name: 'เอ็กซ์ตรีม 8ชม แซนดัลวูด', group_id: 7 },
    { record_id: 202, name: 'เอ็กซ์ตรีม 8ชม ลาเวนเดอร์', group_id: 7 },
    { record_id: 301, name: 'ดรายสเปรย์ 600มล', group_id: 9 }
  ],
  product_units: [
    { product_id: 101, unit_code: 'CT', unit_factor: 60 }, { product_id: 101, unit_code: 'PK', unit_factor: 5 },
    { product_id: 201, unit_code: 'CT', unit_factor: 60 }, { product_id: 201, unit_code: 'PK', unit_factor: 5 },
    { product_id: 301, unit_code: 'CT', unit_factor: 12 }, { product_id: 301, unit_code: 'PK', unit_factor: 3 }
  ],
  free_goods_sets: [
    { record_id: 1, name: 'Sales out Ranger 12hrs (1-31 ก.ค. 69)', status: 'active',
      valid_from: '2026-07-01', valid_to: '2026-07-31', customer_group_id: '' },
    { record_id: 2, name: 'Dry Spray ร้านใหม่ (1 ก.ค.-31 ส.ค. 69)', status: 'active',
      valid_from: '2026-07-01', valid_to: '2026-08-31', customer_group_id: '' },
    { record_id: 3, name: 'ชุดร่างยังไม่เปิด', status: 'draft', valid_from: '2026-07-01', valid_to: '2026-12-31', customer_group_id: '' },
    { record_id: 4, name: 'ชุดหมดอายุแล้ว', status: 'active', valid_from: '2026-01-01', valid_to: '2026-06-30', customer_group_id: '' }
  ],
  // ★ ชุด 1 = กลไกเดียวสามขั้น (tier_group 'A') ตรงตามใบอนุมัติ
  free_goods_items: [
    { record_id: 1, set_id: 1, tier_group: 'A', trigger_product_ids: '101,102,103', trigger_group_ids: '',
      min_qty: 12, min_unit_code: 'CT', free_product_id: 101, free_qty: 1, free_unit_code: 'CT', note: 'ซื้อ 12 ลัง FOC 1 ลัง', is_active: 'TRUE' },
    { record_id: 2, set_id: 1, tier_group: 'A', trigger_product_ids: '101,102,103', trigger_group_ids: '',
      min_qty: 6, min_unit_code: 'CT', free_product_id: 101, free_qty: 6, free_unit_code: 'PK', note: 'ซื้อ 6 ลัง FOC 6 แพ็ค', is_active: 'TRUE' },
    { record_id: 3, set_id: 1, tier_group: 'A', trigger_product_ids: '101,102,103', trigger_group_ids: '',
      min_qty: 1, min_unit_code: 'CT', free_product_id: 101, free_qty: 1, free_unit_code: 'PK', note: 'ซื้อ 1 ลัง FOC 1 แพ็ค', is_active: 'TRUE' },
    { record_id: 4, set_id: 2, tier_group: 'B', trigger_product_ids: '301', trigger_group_ids: '',
      min_qty: 5, min_unit_code: 'CT', free_product_id: 301, free_qty: 5, free_unit_code: 'PK', note: 'ซื้อ 5 ลัง FOC 5 แพ็ค', is_active: 'TRUE' },
    { record_id: 5, set_id: 3, tier_group: 'C', trigger_product_ids: '101', trigger_group_ids: '',
      min_qty: 1, min_unit_code: 'CT', free_product_id: 101, free_qty: 99, free_unit_code: 'CT', note: 'ร่าง', is_active: 'TRUE' },
    { record_id: 6, set_id: 4, tier_group: 'D', trigger_product_ids: '101', trigger_group_ids: '',
      min_qty: 1, min_unit_code: 'CT', free_product_id: 101, free_qty: 99, free_unit_code: 'CT', note: 'หมดอายุ', is_active: 'TRUE' }
  ],
  package_tenants: [
    { record_id: 1, package_type: 'free_goods', package_id: 1, tenant_id: 'BDC' },
    { record_id: 2, package_type: 'free_goods', package_id: 2, tenant_id: 'BDC' },
    { record_id: 3, package_type: 'free_goods', package_id: 3, tenant_id: 'BDC' },
    { record_id: 4, package_type: 'free_goods', package_id: 4, tenant_id: 'BDC' }
  ],
  price_list_rules: [], price_list_rule_conditions: [], price_lists: [], customer_groups: []
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const CACHE = {};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-07-15', getUuid: () => 'uuid' },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({ get: k => (CACHE[k] === undefined ? null : CACHE[k]), put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralAppend: (n, o) => sheetOf(n).push(Object.assign({}, o)),
  centralAppendMany: (n, os) => os.forEach(o => sheetOf(n).push(Object.assign({}, o))),
  centralUpdate: (n, id, f) => { const r = sheetOf(n).find(x => String(x.record_id) === String(id)); if (r) Object.assign(r, f); },
  centralNextId: n => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralInvalidate: () => {},
  deleteRowsWhere: (sh, col, v) => { sheets[sh.__name] = sheetOf(sh.__name).filter(r => String(r[col]) !== String(v)); },
  nowStr: () => '2026-07-15 10:00:00', safeDateStr: v => String(v || ''),
  _requirePermission: () => null, ensureSchemaCurrent: () => false,
  _salesTenantId: (s, p) => (s.tenant_id || (p && p.tenantId) || 'HOUSE'),
  _withDocLock: fn => fn()
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralUpdate', 'centralNextId', 'centralInvalidate', 'deleteRowsWhere', 'nowStr', 'safeDateStr']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
['28_units.gs', '33_customers.gs', '17_pricing.gs', '18_pricing_engine.gs', '36_price_rules.gs', '38_package_distribution.gs', '11_promotions.gs', '39_free_goods.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
vm.runInContext('var HOUSE_TENANT_ID = "HOUSE";', ctx, { filename: 'stub.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const OWNER = { adminUserId: '9', role_code: 'super_admin', tenant_id: '' };
const cust = id => sheets.customers.find(c => c.record_id === id);
const DAY = '2026-07-15';
const setsFor = id => ctx.freeGoodsSetsForCustomer(cust(id), DAY);
const unitBase = ctx._fgUnitBaseFn();
const got = (lines, id) => ctx.computeFreeGoods(lines, setsFor(id || 1), unitBase);
const CT = (pid, qty) => ({ productId: pid, groupId: 7, qty, unitCode: 'CT' });

console.log('-- ขั้นการแถม: ได้ขั้นสูงสุดที่ถึง "ขั้นเดียว" --');
{
  const r = got([CT(101, 12)]);
  eq('★ ซื้อ 12 ลัง → ได้ 1 ลัง เท่านั้น (ไม่ใช่ 1 ลัง + 6 แพ็ค + 1 แพ็ค)',
    r.map(f => [f.qty, f.unitCode]), [[1, 'CT']]);
  eq('  แปลงเป็นหน่วยฐานให้ตัดสต็อกถูก (1 ลัง = 60 ชิ้น)', r[0].baseQty, 60);
  eq('ซื้อ 6 ลัง → ขั้นกลาง 6 แพ็ค', got([CT(101, 6)]).map(f => [f.qty, f.unitCode]), [[6, 'PK']]);
  eq('  หน่วยฐานของ 6 แพ็ค = 30 ชิ้น', got([CT(101, 6)])[0].baseQty, 30);
  // ทุกขั้นในใบอนุมัติคือ "1 แพ็คต่อ 1 ลัง" (12 ลัง = 1 ลังแถม = 12 แพ็ค) ขั้นล่างจึงคูณรอบได้
  eq('ซื้อ 3 ลัง → ขั้นต่ำสุดคูณสามรอบ = 3 แพ็ค', got([CT(101, 3)]).map(f => [f.qty, f.unitCode]), [[3, 'PK']]);
  eq('★ ซื้อ 7 ลัง → ขั้น 6 ชนะ ได้ 6 แพ็ค (ไม่ใช่ 7 แพ็คจากขั้นล่าง) — ขั้นสูงกว่าชนะเสมอ แม้ให้น้อยกว่า',
    got([CT(101, 7)]).map(f => [f.qty, f.unitCode]), [[6, 'PK']]);
  eq('ซื้อ 24 ลัง → ขั้นสูงสุดคูณสองรอบ = 2 ลัง', got([CT(101, 24)]).map(f => [f.qty, f.unitCode]), [[2, 'CT']]);
  eq('ซื้อไม่ถึงขั้นต่ำสุด → ไม่ได้อะไร', got([{ productId: 101, groupId: 7, qty: 3, unitCode: 'PK' }]).length, 0);
}

console.log('\n-- นับรวมทั้งตระกูล ไม่ใช่ทีละ SKU --');
{
  eq('★ 4+4+4 ลัง จากสาม SKU ในตระกูลเดียว = 12 ลัง → ได้ขั้นสูงสุด',
    got([CT(101, 4), CT(102, 4), CT(103, 4)]).map(f => [f.qty, f.unitCode]), [[1, 'CT']]);
  eq('สินค้านอกตระกูล (Extreme อยู่กลุ่ม 7 เหมือนกัน) ไม่ถูกนับ',
    got([CT(201, 12), CT(202, 12)]).length, 0);
  eq('  ซื้อปนกัน นับเฉพาะตระกูลที่ระบุ (12hrs 6 ลัง → ขั้นกลาง)',
    got([CT(101, 6), CT(201, 20)]).map(f => [f.qty, f.unitCode]), [[6, 'PK']]);
}

console.log('\n-- หน่วยของเงื่อนไขต้องตรง --');
eq('เงื่อนไขนับเป็น "ลัง" ซื้อมาเป็นแพ็ค 100 แพ็ค ก็ไม่เข้า',
  got([{ productId: 101, groupId: 7, qty: 100, unitCode: 'PK' }]).length, 0);

console.log('\n-- สถานะ ช่วงวันที่ และการจ่ายชุดให้ตัวแทน --');
{
  eq('ชุดร่าง/หมดอายุ ไม่ถูกใช้ (ถ้าหลุดมาจะแถม 99 ลัง)', setsFor(1).map(s => s.record_id), [1, 2]);
  eq('★ ร้านของตัวแทนที่ไม่ได้รับชุดแถม ไม่ได้อะไรเลย', setsFor(2).length, 0);
  eq('  แม้ตะกร้าจะถึงขั้นก็ตาม', got([CT(101, 12)], 2).length, 0);
  const keep = sheets.package_tenants.slice();
  sheets.package_tenants = keep.concat([{ record_id: 9, package_type: 'free_goods', package_id: 1, tenant_id: 'NKN' }]);
  eq('  จ่ายชุดให้ตัวแทนนั้นแล้ว ได้ทันที', got([CT(101, 12)], 2).map(f => [f.qty, f.unitCode]), [[1, 'CT']]);
  sheets.package_tenants = keep;
}

console.log('\n-- กฎสิทธิ์ใช้กับชุดแถมได้ (ชั้น B) --');
{
  const r = ctx.savePriceListRule(OWNER, { targetType: 'free_goods', priceListId: 1, name: 'เฉพาะค้าส่ง',
    matchType: 'all', priority: 10, conditions: [{ field: 'channel_id', op: 'eq', value: 'WS' }] });
  eq('ตั้งกฎสิทธิ์ให้ชุดแถมได้', r.success, true);
  eq('  ร้านค้าส่ง (WS) ยังได้', setsFor(1).map(s => s.record_id), [1, 2]);
  sheets.customers[0].channel_id = 'PS';
  eq('  ★ ร้านที่ไม่เข้าเงื่อนไข ไม่ได้ชุดนั้น แม้จ่ายให้ตัวแทนแล้ว', setsFor(1).map(s => s.record_id), [2]);
  sheets.customers[0].channel_id = 'WS';
}

console.log('\n-- หลายชุดพร้อมกัน --');
eq('ซื้อครบสองตระกูลในบิลเดียว ได้แถมจากทั้งสองชุด',
  got([CT(101, 12), { productId: 301, groupId: 9, qty: 5, unitCode: 'CT' }])
    .map(f => [f.setId, f.qty, f.unitCode]), [[1, 1, 'CT'], [2, 5, 'PK']]);

console.log('\n-- หน้าจอ --');
{
  const p = ctx.previewFreeGoods(OWNER, { customerId: 1, date: DAY, items: [{ productId: 101, qty: 12, unitCode: 'CT' }] });
  eq('ทดลองดูว่าร้านนี้จะได้แถมอะไร', [p.success, p.freeGoods.length, p.freeGoods[0].unitLabel], [true, 1, 'ลัง']);
  eq('  บอกเหตุผลว่ามาจากขั้นไหน', /ซื้อครบ 12 ลัง/.test(p.freeGoods[0].reason), true);
  const none = ctx.previewFreeGoods(OWNER, { customerId: 2, date: DAY, items: [{ productId: 101, qty: 12, unitCode: 'CT' }] });
  eq('  ร้านที่ไม่มีชุดแถม บอกให้ไปตรวจการจ่ายชุด', /จ่ายชุดให้ตัวแทน/.test(none.message), true);

  const bad = ctx.saveFreeGoodsItem(OWNER, { setId: 1, minQty: 5, minUnitCode: 'CT', freeProductId: 101, freeQty: 1 });
  eq('บันทึกขั้นที่ไม่ระบุสินค้าที่ต้องซื้อ → ปฏิเสธ (กันแถมมั่วทั้งบิล)',
    [bad.success, /ต้องระบุสินค้าที่ต้องซื้อ/.test(bad.message)], [false, true]);
  const ok2 = ctx.saveFreeGoodsItem(OWNER, { setId: 1, tierGroup: 'A', triggerProductIds: [101],
    minQty: 30, minUnitCode: 'CT', freeProductId: 101, freeQty: 3, freeUnitCode: 'CT', note: 'ขั้นใหม่' });
  eq('เพิ่มขั้นใหม่แล้วอ่านกลับได้', ok2.success && ok2.items.length, 4);
  eq('  ★ ขั้นใหม่ที่สูงกว่า ชนะขั้นเดิมทันที', got([CT(101, 30)]).map(f => [f.qty, f.unitCode]), [[3, 'CT']]);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
