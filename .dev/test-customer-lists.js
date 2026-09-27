// รัน: node .dev/test-customer-lists.js
// ทดสอบรายชื่อร้านค้า (40_customer_lists.gs) และการใช้เป็นเงื่อนไขในกฎสิทธิ์ (member_of_list)
// เกิดจากเกณฑ์จริงในใบอนุมัติ: "ร้านค้าใหม่ที่ยังไม่เคยซื้อ" ซึ่งตัดสินด้วยคน ไม่ใช่วันที่ในฐานข้อมูล
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  customers: [
    { record_id: 1, customer_code: 'C0001', external_code: 'RSM.310040', name: 'ร้านหนึ่ง', tenant_id: 'BDC', group_id: 12, channel_id: 'WS', attributes: '' },
    { record_id: 2, customer_code: 'C0002', external_code: 'RSM.300058', name: 'ร้านสอง', tenant_id: 'BDC', group_id: 12, channel_id: 'PS', attributes: '' },
    { record_id: 3, customer_code: 'C0003', external_code: '', name: 'ร้านของตัวแทนอื่น', tenant_id: 'NKN', group_id: 12, channel_id: 'PS', attributes: '' }
  ],
  customer_lists: [], customer_list_members: [],
  price_list_rules: [], price_list_rule_conditions: [],
  price_lists: [{ record_id: 10, name: 'ชุดทดสอบ', customer_group_id: 12, status: 'active', valid_from: '2026-01-01', valid_to: '2026-12-31' }],
  package_tenants: [{ record_id: 1, package_type: 'price_list', package_id: 10, tenant_id: 'BDC' },
                    { record_id: 2, package_type: 'price_list', package_id: 10, tenant_id: 'NKN' }],
  tenants: [{ tenant_id: 'BDC', name: 'บีดีซี', is_active: 'TRUE' }, { tenant_id: 'NKN', name: 'นครนายก', is_active: 'TRUE' }],
  customer_groups: [], distribution_channels: [], products: [], discount_rules: []
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
  _requirePermission: () => null, ensureSchemaCurrent: () => false,
  _effectiveTenantId: (s, p) => (s.tenant_id || (p && p.tenantId) || null),
  _salesTenantId: (s, p) => (s.tenant_id || (p && p.tenantId) || 'HOUSE'),
  _withDocLock: fn => fn()
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralUpdate', 'centralNextId', 'centralInvalidate', 'deleteRowsWhere', 'nowStr', 'safeDateStr']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
['28_units.gs', '33_customers.gs', '17_pricing.gs', '18_pricing_engine.gs', '36_price_rules.gs', '38_package_distribution.gs', '40_customer_lists.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
vm.runInContext('var HOUSE_TENANT_ID = "HOUSE";', ctx, { filename: 'stub.gs' });
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
const BDC = { adminUserId: '3', role_code: 'admin', tenant_id: 'BDC' };
const NKN = { adminUserId: '4', role_code: 'admin', tenant_id: 'NKN' };
const cust = id => sheets.customers.find(c => c.record_id === id);

console.log('-- สร้างรายชื่อ --');
let companyList, bdcList;
{
  const r = ctx.saveCustomerList(OWNER, { name: 'ร้านค้าใหม่ Jul-Aug 69' });
  companyList = r.id;
  eq('บริษัทสร้างรายชื่อกลางได้', r.success, true);
  const r2 = ctx.saveCustomerList(BDC, { name: 'ร้านที่ BDC อนุมัติเอง' });
  bdcList = r2.id;
  eq('ตัวแทนสร้างรายชื่อของตัวเองได้', r2.success, true);
  eq('  รายชื่อของตัวแทนถูกผูก tenant ให้เอง',
    sheets.customer_lists.find(l => l.record_id === bdcList).tenant_id, 'BDC');
  eq('บริษัทเห็นทั้งหมด รวมของตัวแทน (ต้องตอบได้ว่าตัวแทนผูกรายชื่อไหนกับโปรบ้าง)', ctx.listCustomerLists(OWNER, {}).data.length, 2);
  eq('ตัวแทนเห็นของบริษัท + ของตัวเอง', ctx.listCustomerLists(BDC, {}).data.map(l => l.id), [companyList, bdcList]);
  eq('  ตัวแทนอื่นไม่เห็นรายชื่อของ BDC', ctx.listCustomerLists(NKN, {}).data.map(l => l.id), [companyList]);
  eq('  และแก้รายชื่อของบริษัทไม่ได้',
    ctx.listCustomerLists(BDC, {}).data.find(l => l.id === companyList).canEdit, false);
  fails('ตัวแทนแก้รายชื่อของบริษัท → ปฏิเสธ',
    ctx.saveCustomerList(BDC, { id: companyList, name: 'แอบเปลี่ยน' }), /เป็นของบริษัท/);
}

console.log('\n-- ใส่สมาชิกด้วยรหัสที่วางมา --');
{
  const r = ctx.addCustomerListMembers(OWNER, { id: companyList, codes: 'C0001\nRSM.300058\nC0001, ไม่มีรหัสนี้' });
  eq('★ รับได้ทั้งรหัสของเราและรหัสระบบเดิม (ใบอนุมัติใช้รหัสเดิม)', r.added, 2);
  eq('  รหัสซ้ำในข้อความเดียวกันไม่นับสองรอบ', r.duplicates, 1);
  eq('  ★ รหัสที่หาไม่เจอถูกรายงาน ไม่ข้ามเงียบ', r.notFound, ['ไม่มีรหัสนี้']);
  eq('  อ่านสมาชิกกลับมาได้', ctx.listCustomerListMembers(OWNER, { id: companyList }).data.map(c => c.code).sort(), ['C0001', 'C0002']);
  const again = ctx.addCustomerListMembers(OWNER, { id: companyList, codes: 'C0001' });
  eq('ใส่ซ้ำร้านที่มีอยู่แล้ว ไม่เพิ่มแถว', [again.added, again.duplicates], [0, 1]);
  const scoped = ctx.addCustomerListMembers(BDC, { id: bdcList, codes: 'C0001 C0003' });
  eq('★ ตัวแทนใส่ได้เฉพาะร้านของตัวเอง (C0003 เป็นของ NKN)', [scoped.added, scoped.notFound], [1, ['c0003']]);
}

console.log('\n-- ใช้เป็นเงื่อนไขในกฎสิทธิ์ --');
{
  eq('อ่านค่าคุณลักษณะได้เป็นรายการรายชื่อ', ctx.plrCustomerValue(cust(1), 'member_of_list'), [companyList, bdcList].join(','));
  eq('  ร้านที่ไม่อยู่รายชื่อไหนเลย = ว่าง', ctx.plrCustomerValue(cust(3), 'member_of_list'), '');
  const m = (id, op, val) => ctx.plrConditionMatches(cust(id), { field: 'member_of_list', op: op, value: String(val) });
  eq('★ อยู่ในรายชื่อ → เข้าเงื่อนไข', [m(1, 'in', companyList), m(3, 'in', companyList)], [true, false]);
  eq('  ★ ร้านที่อยู่หลายรายชื่อ ยังเทียบถูก (eq กับสตริง "1,2" จะพังถ้าไม่แยกกรณี)', m(1, 'eq', companyList), true);
  eq('  ไม่อยู่ในรายชื่อ (notin)', [m(1, 'notin', companyList), m(3, 'notin', companyList)], [false, true]);
  eq('  เลือกหลายรายชื่อพร้อมกัน = อยู่อันใดอันหนึ่ง', m(2, 'in', companyList + ',' + bdcList), true);
  eq('  empty/notempty', [m(3, 'empty', ''), m(1, 'notempty', '')], [true, true]);
  eq('รายชื่อโผล่เป็นตัวเลือกให้หน้าเว็บ',
    ctx.plrFieldChoices().member_of_list.map(o => o.label), ['ร้านค้าใหม่ Jul-Aug 69 (ของบริษัท)', 'ร้านที่ BDC อนุมัติเอง (BDC)']);
}

console.log('\n-- ลบรายชื่อที่ถูกใช้อยู่ --');
{
  ctx.savePriceListRule(OWNER, { priceListId: 10, name: 'เฉพาะร้านใหม่', matchType: 'all', priority: 10,
    conditions: [{ field: 'member_of_list', op: 'in', value: String(companyList) }] });
  const r = ctx.deleteCustomerList(OWNER, { id: companyList });
  eq('★ เตือนก่อนลบเมื่อมีกฎอ้างอยู่ (ลบแล้วกฎจะเงียบไปเฉยๆ)', [r.success, r.needConfirm], [false, true]);
  eq('  ยังไม่ถูกลบ', sheets.customer_lists.some(l => l.record_id === companyList), true);
  const f = ctx.deleteCustomerList(OWNER, { id: companyList, force: true });
  eq('ยืนยันแล้วลบได้ พร้อมสมาชิก', [f.success, sheets.customer_list_members.some(m => String(m.list_id) === String(companyList))], [true, false]);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
