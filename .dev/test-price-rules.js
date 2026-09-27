// รัน: node .dev/test-price-rules.js
// ทดสอบสิทธิ์เข้าถึงชุดราคา (36_price_rules.gs): เงื่อนไขตามคุณลักษณะลูกค้า, ลำดับความสำคัญ,
// ความเข้ากันได้กับชุดราคาแบบเดิมที่ผูกกลุ่มลูกค้า, และตัวตัดสินตอนคะแนนเท่ากัน
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  customers: [
    { record_id: 1, customer_code: 'C0001', name: 'ร้านทั่วไปเหนือ', group_id: 1, channel_id: 'MM', area_code: 'N1',
      sales_mode: 'van', payment_type: 'cash', tenant_id: 'BDC', is_active: 'TRUE', attributes: '{"sourceGroupCode":"SV01"}' },
    { record_id: 2, customer_code: 'C0002', name: 'ซุปเปอร์ชีป สาขาตะวันออก', group_id: 1, channel_id: 'SC', area_code: 'E2',
      sales_mode: 'preorder', payment_type: 'credit', tenant_id: 'BDC', is_active: 'TRUE', attributes: '{"sourceGroupCode":"SV02"}' },
    { record_id: 3, customer_code: 'C0003', name: 'ศูนย์กระจายสินค้า', group_id: 3, channel_id: 'WS', area_code: 'E2',
      sales_mode: 'preorder', payment_type: 'credit', tenant_id: '', is_active: 'TRUE', attributes: '' },
    { record_id: 4, customer_code: 'C0004', name: 'ร้านไม่เข้าเงื่อนไขอะไรเลย', group_id: 9, channel_id: '', area_code: '',
      sales_mode: '', payment_type: 'cash', tenant_id: 'BDC', is_active: 'TRUE', attributes: '' }
  ],
  price_lists: [
    { record_id: 10, name: 'ร้านค้าทั่วไป', customer_group_id: 1, valid_from: '2026-07-01', valid_to: '2026-12-31', status: 'active' },
    { record_id: 11, name: 'ซุปเปอร์ชีป',   customer_group_id: '', valid_from: '2026-07-01', valid_to: '2026-12-31', status: 'active' },
    { record_id: 12, name: 'ศูนย์/ตัวแทน',  customer_group_id: 3, valid_from: '2026-07-01', valid_to: '2026-12-31', status: 'active' },
    { record_id: 13, name: 'ชุดร่างยังไม่เปิด', customer_group_id: '', valid_from: '2026-07-01', valid_to: '2026-12-31', status: 'draft' },
    { record_id: 14, name: 'ชุดหมดอายุแล้ว', customer_group_id: '', valid_from: '2026-01-01', valid_to: '2026-06-30', status: 'active' }
  ],
  price_list_items: [], price_list_bill_promos: [],
  price_list_rules: [
    // ซุปเปอร์ชีป: ช่องทาง SC หรือ รหัสกลุ่มเดิม SV02 — คนละนิยาม สองกฎแยกกัน
    { record_id: 1, price_list_id: 11, name: 'ช่องทางซุปเปอร์ชีป', match_type: 'all', priority: 10, is_active: 'TRUE' },
    { record_id: 2, price_list_id: 11, name: 'รหัสกลุ่มเดิม SV02', match_type: 'all', priority: 10, is_active: 'TRUE' },
    // ชุดร่าง/หมดอายุ ตั้งกฎกว้างๆ ไว้ ต้องไม่ถูกเลือกเพราะติดสถานะ/วันที่
    { record_id: 3, price_list_id: 13, name: 'ทุกร้าน (ร่าง)', match_type: 'all', priority: 99, is_active: 'TRUE' },
    { record_id: 4, price_list_id: 14, name: 'ทุกร้าน (หมดอายุ)', match_type: 'all', priority: 99, is_active: 'TRUE' },
    // กฎที่ปิดไว้ ต้องไม่ถูกนับ
    { record_id: 5, price_list_id: 12, name: 'ปิดอยู่', match_type: 'all', priority: 50, is_active: 'FALSE' }
  ],
  // ★ ชั้น A: ชุดราคาต้องถูก "จ่าย" ให้ตัวแทนก่อน ไม่งั้นกฎสิทธิ์จะดีแค่ไหนก็ใช้ไม่ได้
  //   (ชุด 12 จ่ายให้ทั้ง BDC และ HOUSE เพราะร้าน C0003 เป็นของบริษัทเอง tenant_id ว่าง)
  tenants: [
    { tenant_id: 'BDC', name: 'บีดีซี', is_active: 'TRUE' },
    { tenant_id: 'HOUSE', name: 'บริษัทเจ้าของสินค้า', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'ZZZ', name: 'ตัวแทนที่ยังไม่ได้รับชุดไหนเลย', is_active: 'TRUE' }
  ],
  package_tenants: [
    { record_id: 1, package_type: 'price_list', package_id: 10, tenant_id: 'BDC' },
    { record_id: 2, package_type: 'price_list', package_id: 11, tenant_id: 'BDC' },
    { record_id: 3, package_type: 'price_list', package_id: 12, tenant_id: 'BDC' },
    { record_id: 4, package_type: 'price_list', package_id: 12, tenant_id: 'HOUSE' },
    { record_id: 5, package_type: 'price_list', package_id: 13, tenant_id: 'BDC' },
    { record_id: 6, package_type: 'price_list', package_id: 14, tenant_id: 'BDC' }
  ],
  price_list_rule_conditions: [
    { record_id: 1, rule_id: 1, field: 'channel_id', op: 'eq', value: 'SC' },
    { record_id: 2, rule_id: 2, field: 'attr:sourceGroupCode', op: 'eq', value: 'SV02' },
    { record_id: 3, rule_id: 3, field: 'payment_type', op: 'notempty', value: '' },
    { record_id: 4, rule_id: 4, field: 'payment_type', op: 'notempty', value: '' },
    { record_id: 5, rule_id: 5, field: 'channel_id', op: 'eq', value: 'WS' }
  ]
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const CACHE = {};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-27', getUuid: () => 'uuid' },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({ get: k => (CACHE[k] === undefined ? null : CACHE[k]),
    put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
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
  deleteRowsWhere: (sh, col, v) => { const n = sh.__name; sheets[n] = sheetOf(n).filter(r => String(r[col]) !== String(v)); },
  nowStr: () => '2026-09-27 10:00:00', safeDateStr: v => String(v || ''),
  _requirePermission: () => null,
  ensureSchemaCurrent: () => false
};
vm.createContext(ctx);
const fakes = {};
['centralObjects','centralSheet','centralAppend','centralAppendMany','centralUpdate','centralNextId','centralInvalidate','deleteRowsWhere','nowStr','safeDateStr']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
['28_units.gs', '13_tenants.gs', '33_customers.gs', '17_pricing.gs', '18_pricing_engine.gs', '36_price_rules.gs', '38_package_distribution.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
vm.runInContext(/function _withDocLock\(fn\) \{[\s\S]*?\n\}/.exec(B('20_purchasing_master.gs'))[0], ctx, { filename: '20.gs' });

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
const S = { adminUserId: '1', role_code: 'super_admin', tenant_id: '' };
const cust = id => sheets.customers.find(c => c.record_id === id);
const won = id => { const r = ctx.resolvePriceListForCustomer(cust(id), '2026-09-27'); return r ? r.list.name : null; };

console.log('\n-- เข้ากันได้กับชุดราคาแบบเดิม (ผูกกลุ่มลูกค้า ไม่มีกฎ) --');
eq('ร้านกลุ่ม 1 ได้ชุด "ร้านค้าทั่วไป" เหมือนเดิม', won(1), 'ร้านค้าทั่วไป');
eq('ร้านกลุ่ม 3 ได้ชุด "ศูนย์/ตัวแทน"', won(3), 'ศูนย์/ตัวแทน');
eq('  เหตุผลบอกว่ามาจากกลุ่มลูกค้าแบบเดิม', ctx.resolvePriceListForCustomer(cust(1), '2026-09-27').reason, 'กลุ่มลูกค้าของชุดราคา (แบบเดิม)');
eq('ร้านที่ไม่เข้าเงื่อนไขไหนเลย → null (ตกไปใช้โปรโมชั่นแบบเดิม)', won(4), null);

console.log('\n-- กฎตามคุณลักษณะอื่นที่ไม่ใช่กลุ่มลูกค้า --');
eq('ร้าน C0002 อยู่กลุ่ม 1 แต่ช่องทาง SC → ได้ซุปเปอร์ชีป (priority 10 ชนะ 0)', won(2), 'ซุปเปอร์ชีป');
eq('  บอกได้ว่าชนะเพราะกฎข้อไหน', ctx.resolvePriceListForCustomer(cust(2), '2026-09-27').reason, 'ช่องทางซุปเปอร์ชีป');
eq('อ่านค่าจาก attributes (JSON) ได้', ctx.plrCustomerValue(cust(2), 'attr:sourceGroupCode'), 'SV02');
eq('  ร้านที่ไม่มี attributes ไม่พัง', ctx.plrCustomerValue(cust(3), 'attr:sourceGroupCode'), '');

console.log('\n-- สถานะและช่วงวันที่ยังกั้นอยู่ (กฎกว้างแค่ไหนก็ข้ามไม่ได้) --');
eq('ชุดร่าง priority 99 ไม่ถูกเลือก', won(1) !== 'ชุดร่างยังไม่เปิด', true);
eq('ชุดหมดอายุ priority 99 ไม่ถูกเลือก', won(1) !== 'ชุดหมดอายุแล้ว', true);
eq('กฎที่ปิดไว้ไม่ถูกนับ (C0003 ช่องทาง WS ยังได้ชุดเดิมของกลุ่ม)', won(3), 'ศูนย์/ตัวแทน');

console.log('\n-- ตัวดำเนินการ --');
const t = (op, value, field, cid) => ctx.plrConditionMatches(cust(cid), { field: field || 'area_code', op, value });
eq('eq / ne', [t('eq','E2',null,2), t('ne','E2',null,2)], [true, false]);
eq('in / notin', [t('in','n1, e2',null,2), t('notin','n1',null,2)], [true, true]);
eq('contains / startswith', [t('contains','ซุปเปอร์','name',2), t('startswith','ร้าน','name',1)], [true, true]);
eq('empty / notempty', [t('empty','','channel_id',4), t('notempty','','channel_id',4)], [true, false]);
eq('gte / lte (ตัวเลข)', [t('gte','1','group_id',3), t('lte','1','group_id',1)], [true, true]);
eq('เทียบไม่สนตัวพิมพ์และช่องว่างหัวท้าย', t('eq','  sc  ','channel_id',2), true);

console.log('\n-- match_type --');
const r2 = { match_type: 'all' }, rAny = { match_type: 'any' };
const cAnd = [{ field:'channel_id', op:'eq', value:'SC' }, { field:'payment_type', op:'eq', value:'credit' }];
eq('all: ต้องผ่านทุกข้อ', [ctx.plrRuleMatches(cust(2), r2, cAnd), ctx.plrRuleMatches(cust(1), r2, cAnd)], [true, false]);
eq('any: ผ่านข้อใดข้อหนึ่งพอ', ctx.plrRuleMatches(cust(1), rAny, [{ field:'channel_id', op:'eq', value:'MM' }, { field:'area_code', op:'eq', value:'ไม่มี' }]), true);
eq('★ กฎที่ไม่มีเงื่อนไขเลย = ไม่ผ่าน (ไม่ใช่ครอบคลุมทุกคน)', ctx.plrRuleMatches(cust(1), r2, []), false);

console.log('\n-- ลำดับความสำคัญและตัวตัดสินตอนเท่ากัน --');
sheets.price_list_rules.push({ record_id: 6, price_list_id: 12, name: 'แย่งลูกค้ากลุ่ม 1', match_type: 'all', priority: 10, is_active: 'TRUE' });
sheets.price_list_rule_conditions.push({ record_id: 6, rule_id: 6, field: 'group_id', op: 'eq', value: '1' });
eq('สองชุดคะแนนเท่ากัน (10) → ตัดสินด้วย record_id สูงกว่า', won(1), 'ศูนย์/ตัวแทน');
sheets.price_list_rules.find(r => r.record_id === 6).priority = 5;
eq('  ลดคะแนนลง → กลับไปได้ชุดที่คะแนนสูงกว่า', won(2), 'ซุปเปอร์ชีป');
sheets.price_list_rules = sheets.price_list_rules.filter(r => r.record_id !== 6);
sheets.price_list_rule_conditions = sheets.price_list_rule_conditions.filter(c => c.rule_id !== 6);

console.log('\n-- บันทึกกฎผ่านหน้าจอ --');
let r = ctx.savePriceListRule(S, { priceListId: 12, name: 'เขตตะวันออกขายเชื่อ', matchType: 'all', priority: 20,
  conditions: [{ field: 'area_code', op: 'eq', value: 'E2' }, { field: 'payment_type', op: 'eq', value: 'credit' }] });
eq('สร้างกฎใหม่ได้ (ชุด 12 มีกฎที่ปิดอยู่เดิม 1 + ใหม่ 1)', [r.success, r.data.length], [true, 2]);
eq('  มีผลกับการเลือกชุดราคาทันที', won(2), 'ศูนย์/ตัวแทน');
fails('กฎต้องมีเงื่อนไขอย่างน้อยหนึ่งข้อ', ctx.savePriceListRule(S, { priceListId: 12, conditions: [] }), /อย่างน้อยหนึ่ง/);
fails('คุณลักษณะที่ไม่รองรับ → ปฏิเสธ (พิมพ์ผิดแล้วกฎเงียบคือสิ่งที่ต้องกัน)',
  ctx.savePriceListRule(S, { priceListId: 12, conditions: [{ field: 'grup_id', op: 'eq', value: '1' }] }), /ไม่รองรับ/);
fails('ตัวดำเนินการที่ไม่รองรับ → ปฏิเสธ',
  ctx.savePriceListRule(S, { priceListId: 12, conditions: [{ field: 'group_id', op: 'like', value: '1' }] }), /ไม่รองรับ/);
fails('เงื่อนไขที่ต้องมีค่า แต่เว้นว่าง → ปฏิเสธ',
  ctx.savePriceListRule(S, { priceListId: 12, conditions: [{ field: 'group_id', op: 'eq', value: '' }] }), /ต้องระบุค่า/);
fails('ไม่พบชุดราคา', ctx.savePriceListRule(S, { priceListId: 999, conditions: [{ field: 'group_id', op: 'eq', value: '1' }] }), /ไม่พบชุดราคา/);

const ruleId = r.ruleId;
r = ctx.savePriceListRule(S, { id: ruleId, priceListId: 12, name: 'แก้แล้ว', matchType: 'any', priority: 1,
  conditions: [{ field: 'area_code', op: 'eq', value: 'E2' }] });
eq('แก้กฎเดิม: เงื่อนไขถูกเขียนทับทั้งชุด ไม่ทับซ้อนของเก่า',
  sheets.price_list_rule_conditions.filter(c => String(c.rule_id) === String(ruleId)).length, 1);
r = ctx.deletePriceListRule(S, { id: ruleId });
eq('ลบกฎแล้วเงื่อนไขหายตามไปด้วย (ไม่เหลือแถวกำพร้า)',
  [r.success, sheets.price_list_rule_conditions.filter(c => String(c.rule_id) === String(ruleId)).length], [true, 0]);

console.log('\n-- เครื่องมือช่วยตั้งค่า --');
r = ctx.previewPriceListAudience(S, { matchType: 'all', conditions: [{ field: 'tenant_id', op: 'eq', value: 'BDC' }] });
eq('ทดลองกฎ: บอกจำนวนร้านที่เข้าเงื่อนไขก่อนกดใช้จริง', [r.success, r.matched, r.total], [true, 3, 4]);
eq('  มีตัวอย่างร้านให้ดูด้วย', r.sample.length > 0 && !!r.sample[0].code, true);
fails('ไม่มีเงื่อนไข → ไม่ให้ทดลอง', ctx.previewPriceListAudience(S, { conditions: [] }), /ยังไม่มีเงื่อนไข/);

r = ctx.explainCustomerPricing(S, { customerId: 2, date: '2026-09-27' });
eq('อธิบายได้ว่าร้านนี้ได้ชุดไหนเพราะอะไร', [r.success, r.winner.name, r.winner.reason], [true, 'ซุปเปอร์ชีป', 'ช่องทางซุปเปอร์ชีป']);
eq('  บอกชุดที่แข่งอยู่และเหตุที่ใช้ไม่ได้ด้วย', (() => {
  const blocked = r.candidates.filter(c => !c.usable).map(c => c.blockedBy);
  return blocked.length > 0 && blocked.every(Boolean);
})(), true);
r = ctx.explainCustomerPricing(S, { customerId: 4, date: '2026-09-27' });
eq('ร้านที่ไม่เข้าเงื่อนไขไหนเลย บอกให้รู้ว่าจะตกไปใช้โปรโมชั่นแบบเดิม', [r.winner, /discount_rules/.test(r.message)], [null, true]);
fails('ไม่พบลูกค้า', ctx.explainCustomerPricing(S, { customerId: 999 }), /ไม่พบลูกค้า/);

console.log('\n-- ชั้น A: ชุดต้องถูกจ่ายให้ตัวแทนก่อน (38_package_distribution.gs) --');
eq('ชุดที่จ่ายให้ตัวแทนของร้านแล้ว → ใช้ได้ตามปกติ', won(1), 'ร้านค้าทั่วไป');
{
  const keep = sheets.package_tenants.slice();
  sheets.package_tenants = keep.filter(r => String(r.package_id) !== '10');
  eq('★ ถอนชุดคืนจากตัวแทน → ร้านนั้นหาชุดราคาไม่เจอทันที', won(1), null);
  eq('  ร้านของตัวแทนอื่นที่ยังได้ชุดอยู่ ไม่กระทบ', won(3), 'ศูนย์/ตัวแทน');
  sheets.package_tenants = keep;
  eq('  จ่ายคืนแล้วกลับมาใช้ได้', won(1), 'ร้านค้าทั่วไป');
}
{
  const keep = sheets.package_tenants.slice();
  sheets.package_tenants = [];
  eq('★ ตารางการจ่ายชุดว่างทั้งตาราง = ยังไม่เริ่มใช้เรื่องนี้ → ราคายังทำงานเหมือนเดิมทุกร้าน',
     [won(1), won(2), won(3)], ['ร้านค้าทั่วไป', 'ซุปเปอร์ชีป', 'ศูนย์/ตัวแทน']);
  sheets.package_tenants = keep;
}
eq('กฎสิทธิ์ผ่านแต่ยังไม่ได้จ่ายชุด → explain บอกเหตุผลตรงๆ', (() => {
  const keep = sheets.package_tenants.slice();
  sheets.package_tenants = keep.filter(r => String(r.package_id) !== '11');
  const x = ctx.explainCustomerPricing(S, { customerId: 2, date: '2026-09-27' });
  const c = x.candidates.find(c => String(c.priceListId) === '11');
  sheets.package_tenants = keep;
  return [c.usable, /ยังไม่ได้จ่ายชุดนี้ให้ตัวแทน/.test(c.blockedBy)];
})(), [false, true]);
eq('ตัวแทนที่ไม่ได้รับชุดไหนเลย ขายไม่ได้แม้ร้านจะเข้าเงื่อนไขทุกข้อ', (() => {
  const c = Object.assign({}, cust(1), { tenant_id: 'ZZZ' });
  return ctx.resolvePriceListForCustomer(c, '2026-09-27');
})(), null);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
