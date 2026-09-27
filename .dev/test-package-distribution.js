// รัน: node .dev/test-package-distribution.js
// ทดสอบการจ่ายชุดราคา/โปรโมชั่นให้ตัวแทน (38_package_distribution.gs) และการกรองโปรโมชั่นสองชั้น (11_promotions.gs)
// กติกาเจ้าของระบบ 27 ก.ย. 2026: "จะไม่เอาทุกชุดไปโยนให้ตัวแทนแบบเหมารวม"
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'HOUSE', name: 'บริษัทเจ้าของสินค้า', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', is_active: 'TRUE' },
    { tenant_id: 'NKN', name: 'นครนายก', is_active: 'TRUE' },
    { tenant_id: 'OLD', name: 'เลิกใช้แล้ว', is_active: 'FALSE' }
  ],
  price_lists: [
    { record_id: 10, name: 'ร้านค้าทั่วไป', customer_group_id: 1, status: 'active', valid_from: '2026-07-01', valid_to: '2026-12-31' },
    { record_id: 11, name: 'ซุปเปอร์ชีป', customer_group_id: 2, status: 'active', valid_from: '2026-07-01', valid_to: '2026-12-31' }
  ],
  discount_rules: [
    { record_id: 50, name: 'ลดน้ำยา 10%', product_group_id: 5, customer_group_id: 0, type: 'percent', value: 10, priority: 10, stackable: 'TRUE', is_active: 'TRUE' },
    { record_id: 51, name: 'โปรเฉพาะกลุ่ม 2', product_group_id: 5, customer_group_id: 2, type: 'percent', value: 5, priority: 20, stackable: 'TRUE', is_active: 'TRUE' },
    { record_id: 52, name: 'โปรที่ปิดอยู่', product_group_id: 5, customer_group_id: 0, type: 'percent', value: 99, priority: 1, stackable: 'TRUE', is_active: 'FALSE' }
  ],
  customers: [
    { record_id: 1, customer_code: 'C0001', name: 'ร้านของ BDC', tenant_id: 'BDC', group_id: 1, channel_id: 'PS', attributes: '' },
    { record_id: 2, customer_code: 'C0002', name: 'ร้านของ NKN', tenant_id: 'NKN', group_id: 2, channel_id: 'WS', attributes: '' },
    { record_id: 3, customer_code: 'C0003', name: 'ร้านขายตรงของบริษัท', tenant_id: '', group_id: 1, channel_id: 'PS', attributes: '' }
  ],
  package_tenants: [], price_list_rules: [], price_list_rule_conditions: [], customer_groups: []
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const CACHE = {};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-27', getUuid: () => 'uuid' },
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
  nowStr: () => '2026-09-27 10:00:00', safeDateStr: v => String(v || ''),
  _requirePermission: () => null,
  _salesTenantId: (s, p) => (s.tenant_id || (p && p.tenantId) || 'HOUSE'),
  _ensureHouseTenant: () => 'HOUSE',
  _withDocLock: fn => fn(),
  ensureSchemaCurrent: () => false
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralUpdate', 'centralNextId', 'centralInvalidate', 'deleteRowsWhere', 'nowStr', 'safeDateStr']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
['28_units.gs', '33_customers.gs', '17_pricing.gs', '18_pricing_engine.gs', '36_price_rules.gs', '38_package_distribution.gs', '11_promotions.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
vm.runInContext('var HOUSE_TENANT_ID = "HOUSE";', ctx, { filename: 'stub.gs' });
// _deleteRowsMatching ตัวจริงคุยกับ Range ของ Sheets — ชีตจำลองนี้เป็น array จึงต้องแทน
ctx._deleteRowsMatching = (sh, match) => {
  const n = sh.__name, before = sheetOf(n).length;
  sheets[n] = sheetOf(n).filter(r => !match(r));
  return before - sheets[n].length;
};

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
const OWNER = { adminUserId: '9', role_code: 'super_admin', tenant_id: '' };
const AGENT = { adminUserId: '3', role_code: 'admin', tenant_id: 'BDC' };
const cust = id => sheets.customers.find(c => c.record_id === id);
const assigned = (type, id) => ctx.packageTenantsOf(type, id);

console.log('-- ยังไม่เคยตั้งค่าเลย ต่างจาก "ตั้งแล้วแต่ไม่ได้ให้ใคร" --');
eq('★ ตารางว่างทั้งตาราง = ยังไม่เริ่มใช้เรื่องนี้ → ยังไม่กั้น (ไม่งั้นหลัง deploy ทั้งระบบขายไม่ได้ทันที)',
  [ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'price_list', 10, 'BDC'),
   ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'promo', 50, 'BDC')], [true, true]);
{
  // พอมีการจ่ายชุดแม้แถวเดียวในระบบ = เริ่มใช้แล้ว → ชุดที่ไม่ได้ถูกจ่ายถูกกั้นทันที
  sheets.package_tenants.push({ record_id: 999, package_type: 'price_list', package_id: 11, tenant_id: 'NKN' });
  eq('★ มีการจ่ายชุดแล้วแม้แถวเดียว → ชุดอื่นที่ยังไม่ได้จ่าย ถูกกั้นทันที',
    ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'price_list', 10, 'BDC'), false);
  eq('  ชุดที่ถูกจ่ายให้ตัวแทนนั้น ใช้ได้', ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'price_list', 11, 'NKN'), true);
  sheets.package_tenants = [];
}

console.log('\n-- จ่ายชุดให้ตัวแทน --');
{
  const r = ctx.savePackageTenants(OWNER, { packageType: 'price_list', packageId: 10, tenantIds: ['BDC', 'HOUSE'] });
  eq('จ่ายชุดราคาให้สองตัวแทน', [r.success, r.assigned], [true, ['BDC', 'HOUSE']]);
  eq('  ตัวแทนที่ได้รับ ใช้ได้', ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'price_list', 10, 'BDC'), true);
  eq('  ตัวแทนที่ไม่ได้รับ ใช้ไม่ได้', ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'price_list', 10, 'NKN'), false);
  eq('  ★ ตัวแทนว่าง (ขายตรงในนามบริษัท) เทียบกับตัวแทนบ้าน HOUSE',
    ctx.packageAllowedForTenant(ctx.packageTenantIndex(), 'price_list', 10, ''), true);

  ctx.savePackageTenants(OWNER, { packageType: 'price_list', packageId: 10, tenantIds: ['NKN'] });
  eq('บันทึกใหม่ = เขียนทับทั้งชุด ไม่ใช่เพิ่มต่อท้าย', assigned('price_list', 10), ['NKN']);

  const empty = ctx.savePackageTenants(OWNER, { packageType: 'price_list', packageId: 10, tenantIds: [] });
  eq('ส่งรายชื่อว่าง = ถอนคืนทั้งหมด', [assigned('price_list', 10).length, /ยังไม่มีตัวแทนรายไหนได้ใช้/.test(empty.message)], [0, true]);

  ctx.savePackageTenants(OWNER, { packageType: 'price_list', packageId: 10, tenantIds: ['BDC', 'ไม่มีจริง', 'OLD', 'BDC'] });
  eq('ตัวแทนที่ไม่มีจริง/ปิดใช้งานแล้ว/ซ้ำ ถูกตัดทิ้ง', assigned('price_list', 10), ['BDC']);
}

console.log('\n-- ตัวแทนแก้ไม่ได้ (ราคาคุมจากส่วนกลาง) --');
fails('★ ตัวแทนกำหนดเองว่าจะใช้ชุดไหนไม่ได้',
  ctx.savePackageTenants(AGENT, { packageType: 'price_list', packageId: 11, tenantIds: ['BDC'] }),
  /เฉพาะบริษัทเจ้าของสินค้า/);
eq('  และของเดิมไม่ขยับ', assigned('price_list', 11), []);

console.log('\n-- เขียนย้อนหลังให้ชุดที่มีอยู่ก่อน --');
{
  const before = JSON.stringify(assigned('price_list', 10));
  const r = ctx.migratePackageAssignments(OWNER);
  eq('จ่ายชุดที่ยังไม่เคยกำหนดให้ครบทุกตัวแทน', r.success, true);
  eq('  ชุดที่ยังไม่เคยกำหนด → ได้ทุกตัวแทนที่ยังใช้งาน (ไม่รวมที่ปิดแล้ว)',
    assigned('price_list', 11), ['BDC', 'HOUSE', 'NKN']);
  eq('  ★ ชุดที่คนตั้งใจเลือกไว้แล้ว ไม่ถูกทับ', JSON.stringify(assigned('price_list', 10)), before);
  eq('  โปรโมชั่นก็ถูกเขียนย้อนหลังด้วย', assigned('promo', 50), ['BDC', 'HOUSE', 'NKN']);
  const n = sheets.package_tenants.length;
  ctx.migratePackageAssignments(OWNER);
  eq('  รันซ้ำไม่เพิ่มแถว', sheets.package_tenants.length, n);
}

console.log('\n-- โปรโมชั่นผ่านสองชั้น --');
{
  ctx.savePackageTenants(OWNER, { packageType: 'promo', packageId: 50, tenantIds: ['BDC'] });
  ctx.savePackageTenants(OWNER, { packageType: 'promo', packageId: 51, tenantIds: ['BDC', 'NKN'] });
  eq('ร้านของ BDC ได้โปรที่จ่ายให้ BDC (กลุ่ม 1 → โปร 51 ที่จำกัดกลุ่ม 2 ไม่เข้า)',
    ctx.promosForCustomer(cust(1)).map(r => r.id), [50]);
  eq('ร้านของ NKN ไม่ได้โปร 50 เพราะไม่ได้จ่ายให้ NKN', ctx.promosForCustomer(cust(2)).map(r => r.id), [51]);
  eq('  โปรที่ปิดอยู่ไม่ถูกนับไม่ว่าจ่ายให้ใคร', ctx.promosForCustomer(cust(1)).some(r => r.id === 52), false);
  eq('ร้านขายตรงของบริษัท (tenant ว่าง) เทียบกับ HOUSE', ctx.promosForCustomer(cust(3)).map(r => r.id), []);
  ctx.savePackageTenants(OWNER, { packageType: 'promo', packageId: 50, tenantIds: ['BDC', 'HOUSE'] });
  eq('  จ่ายให้ HOUSE แล้ว ร้านขายตรงได้โปร', ctx.promosForCustomer(cust(3)).map(r => r.id), [50]);
}

console.log('\n-- กฎสิทธิ์ใช้กับโปรโมชั่นได้ด้วย (ชั้น B) --');
{
  const r = ctx.savePriceListRule(OWNER, { targetType: 'promo', priceListId: 50, name: 'เฉพาะช่องทางค้าส่ง',
    matchType: 'all', priority: 10, conditions: [{ field: 'channel_id', op: 'eq', value: 'WS' }] });
  eq('ตั้งกฎสิทธิ์ให้โปรโมชั่นได้', r.success, true);
  eq('  ★ ร้านที่ไม่เข้าเงื่อนไข ไม่ได้โปรนั้น แม้บริษัทจะจ่ายให้ตัวแทนแล้ว',
    ctx.promosForCustomer(cust(1)).map(x => x.id), []);
  ctx.savePackageTenants(OWNER, { packageType: 'promo', packageId: 50, tenantIds: ['BDC', 'NKN'] });
  eq('  ร้านที่เข้าเงื่อนไข (ช่องทาง WS) ได้', ctx.promosForCustomer(cust(2)).map(x => x.id).sort(), [50, 51]);
  eq('  กฎของโปรไม่ไปโผล่ในกฎของชุดราคา', ctx.listPriceListRules(OWNER, { priceListId: 50 }).data.length, 0);
  eq('  และอ่านกลับมาได้ด้วย targetType', ctx.listPriceListRules(OWNER, { priceListId: 50, targetType: 'promo' }).data.length, 1);
  fails('ตั้งกฎให้โปรที่ไม่มีจริง → ปฏิเสธ',
    ctx.savePriceListRule(OWNER, { targetType: 'promo', priceListId: 999, name: 'x',
      conditions: [{ field: 'channel_id', op: 'eq', value: 'WS' }] }), /ไม่พบโปรโมชั่น/);
}

console.log('\n-- ฝั่งตัวแทนเปิดดูได้ว่าตัวเองมีอะไร --');
{
  const r = ctx.listMyPackages(AGENT, {});
  eq('ตัวแทนเห็นเฉพาะชุดที่ได้รับ', [r.success, r.tenantId, r.priceLists.map(p => p.id)], [true, 'BDC', [10, 11]]);
  eq('  และโปรของตัวเอง', r.promos.map(p => p.id).sort(), [50, 51, 52]);
  eq('  โปรที่จ่ายให้แล้วแต่ยังปิดอยู่ ก็เห็น พร้อมสถานะ (ตัวแทนจะได้ไม่งงว่าทำไมไม่ทำงาน)',
    r.promos.filter(p => p.status !== 'active').map(p => [p.id, p.status]), [[52, 'inactive']]);
  const nkn = ctx.listMyPackages(OWNER, { tenantId: 'NKN' });
  eq('บริษัทเปิดดูแทนตัวแทนรายอื่นได้', nkn.priceLists.map(p => p.id), [11]);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
