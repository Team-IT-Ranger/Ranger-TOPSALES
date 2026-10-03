// รัน: node .dev/test-sheet-cache.js
// ทดสอบชั้นแคชก้อนใหญ่ (gzip + แบ่งชิ้น) ใน 02_helpers.gs + เลขเวอร์ชันแคตตาล็อกใน 03_cache.gs + การเขียนแถวครั้งเดียว
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

// CacheService จำลองที่บังคับเพดานจริง: ค่าละ ≤ 100 KB
const store = {};
const cacheApi = {
  get: k => (k in store ? store[k] : null),
  getAll: ks => { const o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); return o; },
  put: (k, v) => { if (String(v).length > 100 * 1024) throw new Error('Argument too large: value'); store[k] = String(v); },
  putAll: o => Object.keys(o).forEach(k => cacheApi.put(k, o[k])),
  remove: k => { delete store[k]; }, removeAll: ks => ks.forEach(k => { delete store[k]; })
};
const blob = (bytes, type) => ({ _b: Buffer.from(bytes), getBytes() { return [...this._b]; }, getDataAsString() { return this._b.toString('utf8'); }, type });
const ctx = {
  console, JSON, String, Number, Object, Array, Date, Math, isNaN, isFinite, parseInt, parseFloat, RegExp, Buffer,
  CacheService: { getScriptCache: () => cacheApi },
  Utilities: {
    newBlob: (data, type) => blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : data, type),
    gzip: b => blob(zlib.gzipSync(b._b)),
    ungzip: b => blob(zlib.gunzipSync(b._b)),
    base64Encode: bytes => Buffer.from(bytes).toString('base64'),
    base64Decode: s => [...Buffer.from(s, 'base64')]
  },
  Logger: { log: () => {} }, Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) }
};
vm.createContext(ctx);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
vm.runInContext(B('03_cache.gs'), ctx, { filename: '03_cache.gs' });

// ชีตจำลอง: นับจำนวนครั้งที่ถูกอ่านสด + บันทึกการเขียน
const TABLES = {};
let sheetReads = 0;
const writes = [];
ctx.centralSheet = name => ({
  getName: () => name,
  getDataRange: () => ({ getValues: () => { sheetReads++; return TABLES[name].map(r => r.slice()); } }),
  getRange: (r, c, nr, nc) => ({ setValues: v => writes.push(['setValues', name, r, c, nr, nc, v]), setValue: v => writes.push(['setValue', name, r, c, v]) })
});
const memoReset = () => { Object.keys(ctx._objMemo).forEach(k => delete ctx._objMemo[k]); };
const mk = (name, nRows, big) => {
  const rows = [['record_id', 'name', 'note', 'is_active']];
  for (let i = 1; i <= nRows; i++) rows.push([i, 'ร้านค้า ' + i + ' ' + 'ก'.repeat(big ? 30 : 1), big ? 'หมายเหตุยาวๆ '.repeat(10) + i : '', true]);
  TABLES[name] = rows;
};
const keysOf = n => Object.keys(store).filter(k => k.indexOf('sheet_' + n + '_v1') === 0);

console.log('\n── ตารางเล็ก: เก็บคีย์เดียว ไม่บีบ (เหมือนเดิม) ──');
mk('product_groups', 20);
memoReset();
let a = ctx.centralObjects('product_groups'); sheetReads = 0;
memoReset();
let b = ctx.centralObjects('product_groups');
eq('อ่านซ้ำจากแคช ไม่แตะชีต · ข้อมูลเท่าเดิม', [sheetReads, b.length, b[19].name], [0, 20, a[19].name]);
eq('  เก็บเป็นคีย์เดียว (ไม่มีชิ้นย่อย)', keysOf('product_groups'), ['sheet_product_groups_v1']);

console.log('\n── ตารางใหญ่ (เกิน 100 KB): บีบ + แบ่งชิ้น ──');
mk('customers', 3000, true);
const raw = JSON.stringify(TABLES.customers.slice(1).map(r => ({ record_id: r[0], name: r[1], note: r[2], is_active: r[3] })));
eq('ตั้งต้น: JSON ดิบใหญ่กว่า 90,000 (เดิมไม่เคยถูกแคช)', raw.length > 90000, true);
memoReset(); sheetReads = 0;
a = ctx.centralObjects('customers');
eq('อ่านครั้งแรก = อ่านชีตสด 1 ครั้ง', [sheetReads, a.length], [1, 3000]);
const keys = keysOf('customers');
eq('  เก็บเป็นคีย์จำนวน + ชิ้นย่อย (ทุกชิ้น ≤ 100 KB — mock จะ throw ถ้าเกิน)', [keys.includes('sheet_customers_v1#n'), keys.length >= 2], [true, true]);
eq('  บีบแล้วเล็กกว่าดิบอย่างน้อย 3 เท่า', keys.filter(k => !k.endsWith('#n')).reduce((s, k) => s + store[k].length, 0) * 3 < raw.length, true);
memoReset(); sheetReads = 0;
b = ctx.centralObjects('customers');
eq('อ่านซ้ำจากแคช: ไม่แตะชีต · ข้อมูลตรงเป๊ะ (3000 แถว ภาษาไทยครบ)', [sheetReads, JSON.stringify(b) === JSON.stringify(a)], [0, true]);

console.log('\n── ล้างแคช ──');
ctx.centralInvalidate('customers');
eq('centralInvalidate ลบทุกชิ้น + คีย์จำนวน (ไม่มีขยะค้าง)', keysOf('customers'), []);
memoReset(); sheetReads = 0; ctx.centralObjects('customers');
eq('  หลังล้างอ่านชีตสดใหม่', sheetReads, 1);
delete store['sheet_customers_v1#0'];   // ชิ้นใดชิ้นหนึ่งหาย (หมดอายุไม่พร้อมกัน) → ต้องไม่ได้ข้อมูลครึ่งเดียว
memoReset(); sheetReads = 0; const c = ctx.centralObjects('customers');
eq('ชิ้นหาย → ถือว่าไม่มีแคช อ่านชีตสดแทน (ไม่ได้ข้อมูลครึ่งๆ กลางๆ)', [sheetReads, c.length], [1, 3000]);

console.log('\n── เลขเวอร์ชันแคตตาล็อก (แคช bootstrap มือถือ) ──');
const k1 = ctx.getCacheKey('bootstrap', 'U1');
ctx.centralInvalidate('products');
const k2 = ctx.getCacheKey('bootstrap', 'U1');
eq('แก้สินค้า → คีย์ bootstrap เปลี่ยน (ทุกคนได้แคตตาล็อกสดทันที ไม่ต้องรอ 10 นาที)', k1 !== k2, true);
ctx.centralInvalidate('vendors');
eq('  ตารางที่ไม่เกี่ยว (ผู้ขาย) ไม่ทำให้แคชหมด', ctx.getCacheKey('bootstrap', 'U1'), k2);
eq('  แคชอื่น (dashboard) ไม่ผูกกับเวอร์ชันนี้', ctx.getCacheKey('dashboard', 'U1'), 'topshop_dashboard_U1');

console.log('\n── เขียนแถว ──');
TABLES.vendors = [['record_id', 'a', 'b', 'c', 'd'], [1, 'x', 'y', 'z', 'w'], [2, 'p', 'q', 'r', 's']];
writes.length = 0;
ctx.updateRowInSheet(ctx.centralSheet('vendors'), 2, { b: 'Q', d: 'S2' });
eq('แก้ 2 คอลัมน์ = เขียนครั้งเดียวด้วย setValues ช่วง b..d (คอลัมน์ c ที่คั่นกลางเขียนกลับค่าเดิม)', writes, [['setValues', 'vendors', 3, 3, 1, 3, [['Q', 'r', 'S2']]]]);
writes.length = 0;
eq('ไม่พบ record → false และไม่เขียนอะไร', [ctx.updateRowInSheet(ctx.centralSheet('vendors'), 99, { b: 1 }), writes.length], [false, 0]);
memoReset(); mk('customers', 5, false); ctx.centralObjects('customers');
const before = keysOf('customers').length;
ctx.centralUpdateQuiet('customers', 2, { name: 'ใหม่' });
eq('centralUpdateQuiet ไม่ล้างแคช (ใช้กับ last_sale_at ที่เขียนถี่)', keysOf('customers').length, before);
ctx.centralUpdate('customers', 2, { name: 'ใหม่2' });
eq('  centralUpdate ปกติยังล้างแคช', keysOf('customers').length, 0);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
