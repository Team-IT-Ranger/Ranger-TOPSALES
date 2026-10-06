// รัน: node .dev/test-address-refs.js
// จังหวัด/อำเภอของลูกค้า (47_address_refs.gs) — เติมรหัสให้ลูกค้า 2,039 รายบน prod ซึ่งย้อนกลับยาก
// จึงต้องคุมให้แน่ว่า: ไม่ทับของที่คนแก้ไว้ · รหัสผิดต้องไม่ถูกเขียนลงไปเงียบๆ · ขอบเขตตัวแทนถูกต้อง
const fs = require('fs'), path = require('path'), vm = require('vm');
// ไฟล์ .gs เป็น CRLF — normalise ก่อน ไม่งั้น regex ที่ตัดฟังก์ชันออกมาจะไม่ตรง
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8').split('\r\n').join('\n');

// ── ชีตจำลองแบบ 2 มิติจริง — updateColumnsWhere อ่าน getDataRange()/เขียน getRange().setValues()
//    ถ้า mock เป็น array ของ object ตัวเขียนคอลัมน์จะไม่เคยถูกรันเลย (บทเรียนจาก test-customer-bulk.js)
let sheets;
function sheetView(name) {
  const grid = sheets[name];
  return {
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => (grid[0] || []).length,
    getDataRange: () => ({ getValues: () => grid.map(r => r.slice()) }),
    getRange: (row, col, nRows, nCols) => ({
      setValues: vals => { for (let i = 0; i < vals.length; i++) grid[row - 1 + i][col - 1] = vals[i][0]; },
      clearContent: () => { for (let i = 0; i < (nRows || 0); i++) for (let j = 0; j < (nCols || 0); j++) grid[row - 1 + i][col - 1 + j] = ''; }
    })
  };
}
const objectsOf = name => {
  const g = sheets[name]; const h = g[0];
  return g.slice(1).filter(r => r[0] !== '' && r[0] !== null)
    .map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; });
};

function reset() {
  sheets = {
    provinces: [['id', 'name', 'name_en', 'region'], [20, 'ชลบุรี', 'Chon Buri', 'กลาง'], [22, 'จันทบุรี', 'Chanthaburi', 'กลาง']],
    districts: [['id', 'name', 'name_en', 'province_id'], [20000, 'อ.เมืองชลบุรี', '', 20], [22000, 'อ.เมืองจันทบุรี', '', 22]],
    customers: [
      ['record_id', 'customer_code', 'tenant_id', 'external_code', 'province_id', 'district_id'],
      [1, 'C0001', 'T1', 'X001', '', ''],
      [2, 'C0002', 'T1', 'X002', '', ''],
      [3, 'C0003', 'T1', 'X003', 22, 22000],      // คนแก้ไว้เองแล้ว
      [4, 'C0004', 'T2', 'X004', '', '']          // ตัวแทนอื่น
    ]
  };
}
reset();

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Logger: { log: () => {} },
  centralSheet: sheetView,
  centralObjects: objectsOf,
  centralInvalidate: () => {},
  centralAppendMany: (n, objs) => { const h = sheets[n][0]; objs.forEach(o => sheets[n].push(h.map(k => (o[k] === undefined ? '' : o[k])))); },
  _requirePermission: () => null,
  _effectiveTenantId: (s, p) => (s && s.tenant_id) || (p && p.tenantId) || null
};
vm.createContext(ctx);
vm.runInContext(B('02_helpers.gs').match(/function updateColumnsWhere[\s\S]*?\n}\n/)[0], ctx, { filename: 'updateColumnsWhere' });
vm.runInContext(B('47_address_refs.gs'), ctx, { filename: '47_address_refs.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const cust = code => objectsOf('customers').find(c => c.customer_code === code);

console.log('── เติมจังหวัด/อำเภอ ──');
reset();
let r = ctx.backfillCustomerAreas({ tenant_id: 'T1' }, { items: [
  { externalCode: 'X001', provinceId: '20', districtId: '20000' },
  { externalCode: 'X002', provinceId: '22', districtId: '22000' },
  { externalCode: 'X003', provinceId: '20', districtId: '20000' },
  { externalCode: 'X004', provinceId: '20', districtId: '20000' }
] });
eq('เติมสำเร็จ', r.success, true);
eq('ลูกค้าที่ยังว่าง ได้รหัสครบ', [String(cust('C0001').province_id), String(cust('C0001').district_id)], ['20', '20000']);
eq('  อีกราย', [String(cust('C0002').province_id), String(cust('C0002').district_id)], ['22', '22000']);
eq('★ แถวที่คนแก้ไว้แล้ว ต้องไม่ถูกทับ', [String(cust('C0003').province_id), String(cust('C0003').district_id)], ['22', '22000']);
eq('★ ลูกค้าตัวแทนอื่น ต้องไม่ถูกแตะ', [String(cust('C0004').province_id), String(cust('C0004').district_id)], ['', '']);

console.log('\n── ทับของเดิมเมื่อสั่งเท่านั้น ──');
reset();
ctx.backfillCustomerAreas({ tenant_id: 'T1' }, { overwrite: true, items: [
  { externalCode: 'X003', provinceId: '20', districtId: '20000' }
] });
eq('ส่ง overwrite:true แล้วทับได้', [String(cust('C0003').province_id), String(cust('C0003').district_id)], ['20', '20000']);

console.log('\n── ★ รหัสที่ไม่มีในตารางอ้างอิง ต้องไม่ถูกเขียนลงไปเงียบๆ ──');
reset();
r = ctx.backfillCustomerAreas({ tenant_id: 'T1' }, { items: [
  { externalCode: 'X001', provinceId: '99', districtId: '99999' }
] });
eq('ปฏิเสธทั้งชุด', r.success, false);
eq('  บอกด้วยว่ารหัสไหนผิด', /99/.test(r.message), true);
eq('  และต้องไม่เขียนอะไรลงไปเลย', [String(cust('C0001').province_id), String(cust('C0001').district_id)], ['', '']);

console.log('\n── เติมตารางอ้างอิง ──');
reset();
r = ctx.importAddressRefs({}, { districts: [
  { id: '20000', name: 'อ.เมืองชลบุรี', provinceId: '20' },
  { id: '20110', name: 'อ.ศรีราชา', provinceId: '20' }
] });
eq('เติมอำเภอได้', [r.success, r.counts.districts], [true, 2]);
eq('★ เขียนทับทั้งตาราง ไม่เติมต่อท้าย (รันซ้ำไม่เกิดแถวซ้ำ)', objectsOf('districts').length, 2);
ctx.importAddressRefs({}, { districts: [{ id: '20000', name: 'อ.เมืองชลบุรี', provinceId: '20' }] });
eq('  รันซ้ำด้วยชุดที่เล็กลง ตารางต้องเหลือเท่าที่ส่งมา', objectsOf('districts').length, 1);

console.log('\n── รายการอ้างอิงให้หน้าเว็บ ──');
reset();
const refs = ctx.listAddressRefs({}, {});
eq('คืนจังหวัดและอำเภอครบ', [refs.provinces.length, refs.districts.length], [2, 2]);
eq('  อำเภอบอกด้วยว่าอยู่จังหวัดไหน (ไว้ทำ dropdown ลูกโซ่)', refs.districts[0].provinceId, '20');

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
