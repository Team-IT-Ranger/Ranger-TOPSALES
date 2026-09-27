// รัน: node .dev/test-customer-bulk.js
// ทดสอบ "จัดกลุ่มลูกค้าเป็นชุด" (37_customer_bulk.gs) + ตัวเขียนชีตหลายแถว updateColumnsWhere (02_helpers.gs)
// จุดที่ต้องคุมให้แน่น: งานนี้แก้ข้อมูลทีละพันแถวและย้อนกลับไม่ได้ ถ้าเงื่อนไขกว้างเกินไปคือแก้ผิดทั้งฐาน
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

/* ── ชีตจำลองที่ทำงานเป็น 2 มิติจริง เพื่อให้ updateColumnsWhere ถูกทดสอบของจริง ──
   (ถ้า mock เป็น array ของ object ตัวเขียนคอลัมน์จะไม่เคยถูกรัน ซึ่งเป็นโค้ดเสี่ยงที่สุดในไฟล์นี้) */
const CUST_COLS = ['record_id', 'customer_code', 'name_prefix', 'name', 'tenant_id', 'group_id', 'channel_id', 'sales_mode',
  'area_code', 'salesman_line_user_id', 'payment_type', 'status', 'is_active', 'inactive_at', 'attributes',
  'external_code', 'updated_at', 'updated_by'];
class FakeSheet {
  constructor(name, cols, rows) {
    this.__name = name; this.writes = 0;
    this.grid = [cols.slice()].concat(rows.map(r => cols.map(c => (r[c] === undefined ? '' : r[c]))));
  }
  getName() { return this.__name; }
  getDataRange() { const g = this.grid; return { getValues: () => g.map(r => r.slice()) }; }
  getLastRow() { return this.grid.length; }
  getLastColumn() { return this.grid[0].length; }
  getRange(row, col, nRows, nCols) {
    const self = this;
    return {
      getValues: () => self.grid.slice(row - 1, row - 1 + nRows).map(r => r.slice(col - 1, col - 1 + nCols)),
      setValues: vals => { self.writes++; vals.forEach((r, i) => r.forEach((v, j) => { self.grid[row - 1 + i][col - 1 + j] = v; })); }
    };
  }
  objects() {
    const h = this.grid[0];
    return this.grid.slice(1).filter(r => r[0] !== '' && r[0] !== null)
      .map(r => { const o = {}; h.forEach((c, i) => o[c] = r[i]); return o; });
  }
}

const A = o => JSON.stringify(o);
const customers = [
  { record_id: 1, customer_code: 'C0001', name: 'ร้านชลบุรี', tenant_id: 'BDC', group_id: 0, channel_id: '', area_code: '',
    payment_type: 'cash', status: 'active', is_active: 'TRUE', attributes: A({ sourceGroupCode: 'SV11', sourceProvCode: '20', sourceShopType: 'PS' }) },
  { record_id: 2, customer_code: 'C0002', name: 'ร้านระยอง', tenant_id: 'BDC', group_id: 0, channel_id: '', area_code: '',
    payment_type: 'cash', status: 'active', is_active: 'TRUE', attributes: A({ sourceGroupCode: 'SV11', sourceProvCode: '21', sourceShopType: 'MM' }) },
  { record_id: 3, customer_code: 'C0003', name: 'ร้านปราจีนบุรี', tenant_id: 'BDC', group_id: 0, channel_id: '', area_code: '',
    payment_type: 'credit', status: 'active', is_active: 'TRUE', attributes: A({ sourceGroupCode: 'SV12', sourceProvCode: '25', sourceShopType: 'WS' }) },
  { record_id: 4, customer_code: 'C0004', name: 'New', tenant_id: 'BDC', group_id: 0, channel_id: '', area_code: '',
    payment_type: 'cash', status: 'active', is_active: 'TRUE', external_code: 'SV11', attributes: A({ sourceGroupCode: 'SV11' }) },
  { record_id: 5, customer_code: 'C0005', name: 'ร้านของตัวแทนอื่น', tenant_id: 'XYZ', group_id: 7, channel_id: '', area_code: '',
    payment_type: 'cash', status: 'active', is_active: 'TRUE', attributes: A({ sourceGroupCode: 'SV11', sourceProvCode: '20' }) },
  { record_id: 6, customer_code: 'C0006', name: 'ร้านที่จัดกลุ่มไว้แล้ว', tenant_id: 'BDC', group_id: 2, channel_id: '', area_code: 'OLD',
    payment_type: 'cash', status: 'active', is_active: 'TRUE', attributes: A({ sourceGroupCode: 'SV12', sourceProvCode: '24' }) }
];

const sheets = {
  customers: new FakeSheet('customers', CUST_COLS, customers),
  customer_groups: [{ record_id: 1, name: 'ร้านค้าเหนือ-อีสาน-ตะวันออก-ใต้' }, { record_id: 2, name: 'ร้านค้า กทม.-กลาง-ตะวันตก' }],
  distribution_channels: [{ record_id: 'PS', name: 'ร้านชำ' }, { record_id: 'WS', name: 'ค้าส่ง' }],
  tenants: [{ tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', is_active: 'TRUE' }, { tenant_id: 'OLD', name: 'เลิกใช้แล้ว', is_active: 'FALSE' }]
};
const objectsOf = n => (sheets[n] instanceof FakeSheet ? sheets[n].objects() : (sheets[n] || []));

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
  centralObjects: objectsOf,
  centralSheet: n => sheets[n],
  centralAppend: () => {}, centralAppendMany: () => {},
  centralUpdate: () => { throw new Error('bulk assign ต้องไม่แก้ทีละแถวด้วย centralUpdate'); },
  centralNextId: () => 1, centralInvalidate: () => {},
  nowStr: () => '2026-09-27 10:00:00', safeDateStr: v => String(v || ''),
  _requirePermission: () => null,
  _salesTenantId: (s, p) => (s.tenant_id || (p && p.tenantId) || '')
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralUpdate', 'centralNextId', 'centralInvalidate', 'nowStr', 'safeDateStr']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });   // ให้ชีตจำลองชนะของจริง แต่เก็บ updateColumnsWhere ตัวจริงไว้
['28_units.gs', '33_customers.gs', '17_pricing.gs', '18_pricing_engine.gs', '36_price_rules.gs', '37_customer_bulk.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));

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
const row = id => sheets.customers.objects().find(c => String(c.record_id) === String(id));
const east = { conditions: [{ field: 'attr:sourceProvCode', op: 'in', value: '20,21,22,23,24,25,26,27' }], matchType: 'all' };

console.log('\n-- ตัวเขียนหลายแถว updateColumnsWhere --');
{
  const sh = new FakeSheet('t', ['record_id', 'a', 'b'], [{ record_id: 1, a: 'x', b: 1 }, { record_id: 2, a: 'x', b: 2 }, { record_id: 3, a: 'y', b: 3 }]);
  const bOf = id => sh.objects().find(o => String(o.record_id) === String(id)).b;
  const r = ctx.updateColumnsWhere(sh, o => o.a === 'x', { b: 99 });
  eq('แก้เฉพาะแถวที่เข้าเงื่อนไข', sh.objects().map(o => o.b), [99, 99, 3]);
  eq('  บอกจำนวนแถวที่โดนและคอลัมน์ที่เขียน', [r.matched, r.columns], [2, ['b']]);
  eq('  เขียนชีตครั้งเดียวต่อคอลัมน์ ไม่ใช่ครั้งเดียวต่อแถว', sh.writes, 1);
  sh.writes = 0;
  const r2 = ctx.updateColumnsWhere(sh, o => o.a === 'x', { b: 99 });
  eq('ค่าเดิมตรงอยู่แล้ว → ไม่เขียนชีตเลย', [r2.matched, sh.writes], [2, 0]);
  ctx.updateColumnsWhere(sh, o => String(o.record_id) === '3', { b: o => String(o.a) + '!' });
  eq('ค่าใหม่เป็นฟังก์ชันของแถวเดิมได้', bOf(3), 'y!');
  eq('คอลัมน์ที่ไม่มีในชีต ไม่ทำให้พัง', ctx.updateColumnsWhere(sh, () => true, { ไม่มีคอลัมน์นี้: 1 }).columns, []);
  eq('ไม่ส่งอะไรมาเลย = ไม่ทำอะไร', ctx.updateColumnsWhere(sh, () => true, {}).matched, 0);
}

console.log('\n-- ดูตัวอย่างก่อนลงมือ --');
{
  const r = ctx.previewCustomerBulkAssign(OWNER, east);
  eq('นับร้านที่เข้าเงื่อนไขได้ (บริษัทเห็นทุกตัวแทน)', [r.matched, r.total], [5, 6]);
  eq('  มีตัวอย่างร้านให้ตรวจ', r.samples.length > 0 && !!r.samples[0].name, true);
  eq('  บอกว่าตอนนี้ร้านเหล่านั้นอยู่กลุ่มอะไร (กำลังทับของเดิมหรือเปล่า)',
    r.byGroup.map(g => [g.groupId, g.count]), [['0', 3], ['2', 1], ['7', 1]]);
  eq('  ส่งตัวเลือกกลุ่ม/ช่องทาง/ตัวแทน มาให้หน้าเว็บด้วย',
    [r.meta.choices.group_id.length, r.meta.choices.channel_id.length, r.meta.choices.tenant_id.length], [2, 2, 1]);
  eq('  ตัวแทนที่ปิดใช้งานแล้วไม่อยู่ในตัวเลือก', r.meta.choices.tenant_id.map(t => t.value), ['BDC']);
  eq('  บอกคีย์ใน attributes ที่มีอยู่จริง (คนตั้งค่าจะได้ไม่ต้องเดาชื่อ)',
    r.meta.attrKeys.map(a => a.key).sort(), ['attr:sourceGroupCode', 'attr:sourceProvCode', 'attr:sourceShopType']);
  eq('  พร้อมตัวอย่างค่าที่พบ', r.meta.attrKeys.find(a => a.key === 'attr:sourceProvCode').samples, ['20', '21', '24', '25']);
  const mine = ctx.previewCustomerBulkAssign(BDC, east);
  eq('ตัวแทนเห็นเฉพาะร้านของตัวเอง', [mine.total, mine.matched], [5, 4]);
  const empty = ctx.previewCustomerBulkAssign(OWNER, { conditions: [] });
  eq('★ เงื่อนไขว่างต้องแปลว่า "ไม่มีร้าน" ไม่ใช่ "ทุกร้าน"', [empty.matched, /ยังไม่ได้ตั้งเงื่อนไข/.test(empty.message)], [0, true]);
}

console.log('\n-- ลงมือจริง --');
{
  // ทำในนามตัวแทน BDC เพื่อทดสอบเส้นทางเขียนว่าขอบเขตตัวแทนกั้นจริง ไม่ใช่แค่ตอนอ่าน
  const r = ctx.applyCustomerBulkAssign(BDC, Object.assign({}, east, { set: { group_id: 1 }, confirmCount: 4 }));
  eq('ตั้งกลุ่มให้ทุกร้านที่เข้าเงื่อนไข', [r.success, r.matched], [true, 4]);
  eq('  ร้านที่เข้าเงื่อนไขได้กลุ่มใหม่', [row(1).group_id, row(2).group_id, row(3).group_id], ['1', '1', '1']);
  eq('  ★ ร้านที่เคยจัดกลุ่มไว้แล้วก็ถูกทับ (preview เตือนไว้ก่อนแล้ว)', row(6).group_id, '1');
  eq('  ★ ร้านของตัวแทนอื่นไม่ถูกแตะ แม้เข้าเงื่อนไข', row(5).group_id, 7);
  eq('  บันทึกว่าใครแก้เมื่อไหร่', [row(1).updated_by, row(1).updated_at], ['3', '2026-09-27 10:00:00']);
  eq('  ข้อความบอกว่าตั้งค่าอะไรไป', /กลุ่มลูกค้า = 1/.test(r.message), true);
}

console.log('\n-- กันพลาด --');
fails('เงื่อนไขว่าง = ปฏิเสธ (ไม่ใช่ "แก้ทุกร้าน")',
  ctx.applyCustomerBulkAssign(OWNER, { conditions: [], set: { group_id: 1 } }), /ต้องตั้งเงื่อนไข/);
fails('★ จำนวนที่ยืนยันไม่ตรงกับที่นับได้จริง = ปฏิเสธ',
  ctx.applyCustomerBulkAssign(BDC, Object.assign({}, east, { set: { area_code: 'E' }, confirmCount: 99 })),
  /เปลี่ยนไปจากตอนที่กดดูตัวอย่าง/);
eq('  ปฏิเสธแล้วต้องไม่แก้อะไรเลย', row(1).area_code, '');
fails('ไม่ได้เลือกว่าจะตั้งค่าอะไร', ctx.applyCustomerBulkAssign(OWNER, Object.assign({}, east, { set: {} })), /ยังไม่ได้เลือก/);
fails('ค่าที่ส่งมาว่าง = ไม่ถือว่าเป็นการสั่งล้างข้อมูล',
  ctx.applyCustomerBulkAssign(OWNER, Object.assign({}, east, { set: { area_code: '' } })), /ยังไม่ได้เลือก/);
fails('ไม่มีร้านไหนเข้าเงื่อนไข', ctx.applyCustomerBulkAssign(OWNER,
  { conditions: [{ field: 'area_code', op: 'eq', value: 'ไม่มีจริง' }], set: { group_id: 1 } }), /ไม่มีร้านไหน/);
{
  const before = JSON.stringify(sheets.customers.objects());
  ctx.applyCustomerBulkAssign(OWNER, Object.assign({}, east, { set: { name: 'โดนเปลี่ยนชื่อ', tax_id: '1' } }));
  eq('★ คอลัมน์นอก whitelist แก้ไม่ได้ (ชื่อ/เลขภาษีต้องแก้ทีละร้าน)', JSON.stringify(sheets.customers.objects()), before);
}

console.log('\n-- สถานะต้องเขียนคู่กับ is_active เสมอ --');
{
  const r = ctx.applyCustomerBulkAssign(OWNER,
    { conditions: [{ field: 'customer_code', op: 'eq', value: 'C0004' }], set: { status: 'inactive' }, confirmCount: 1 });
  eq('ปิดใช้งานแถวขยะที่นำเข้ามาได้', r.success, true);
  eq('  ★ status กับ is_active ตรงกัน (ทั้งระบบอ่าน is_active)', [row(4).status, row(4).is_active], ['inactive', 'FALSE']);
  eq('  ลงวันที่ปิดให้ด้วย', row(4).inactive_at, '2026-09-27 10:00:00');
  ctx.applyCustomerBulkAssign(OWNER, { conditions: [{ field: 'customer_code', op: 'eq', value: 'C0004' }], set: { status: 'active' }, confirmCount: 1 });
  eq('เปิดกลับ → is_active กลับมาและล้างวันที่ปิด', [row(4).status, row(4).is_active, row(4).inactive_at], ['active', 'TRUE', '']);
}

console.log('\n-- ตั้งสายวิ่งจากรหัสกลุ่มเดิม (เคสจริงของ BDC) --');
{
  ctx.applyCustomerBulkAssign(BDC, { conditions: [{ field: 'attr:sourceGroupCode', op: 'eq', value: 'SV11' }], set: { area_code: 'SV11' } });
  ctx.applyCustomerBulkAssign(BDC, { conditions: [{ field: 'attr:sourceGroupCode', op: 'eq', value: 'SV12' }], set: { area_code: 'SV12' } });
  eq('SV11/SV12 ไปอยู่ที่สายวิ่ง ไม่ใช่กลุ่มลูกค้า',
    [row(1).area_code, row(3).area_code, row(6).area_code], ['SV11', 'SV12', 'SV12']);
  eq('  กลุ่มลูกค้าที่ตั้งไว้ก่อนหน้าไม่ถูกลบทิ้งไปด้วย', [row(1).group_id, row(3).group_id], ['1', '1']);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
