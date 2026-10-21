// รัน: node .dev/test-inventory-report.js
// ของคงเหลือ คลัง + บนรถ + รวม หน่วยลัง (58_inventory_report.gs)
// เจ้าของระบบสั่ง 21 ต.ค. 2026: "มีคอลัมน์คลังหลักและคอลัมน์ของรวมบนรถ ทั้งคู่ มีช่องรวม หน่วยเป็นลัง"
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'TNKI', name: 'ตัวแทนบ้าน', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', is_active: 'TRUE' },
    { tenant_id: 'NEW', name: 'ตัวแทนใหม่ ยังไม่มีไฟล์', is_active: 'TRUE' }
  ],
  company_profile: [{ record_id: 1, name: 'บริษัท ธนัทกร จำกัด' }],
  products: [
    { record_id: 1, product_code: '10143', name: 'น้ำยาถูพื้น 900ml', unit: 'ชิ้น', is_active: 'TRUE' },
    { record_id: 2, product_code: '10185', name: 'สเปรย์กันยุง', unit: 'ชิ้น', is_active: 'TRUE' },
    { record_id: 3, product_code: '10505', name: 'กาวดักแมลงวัน', unit: 'แผ่น', is_active: 'TRUE' },
    { record_id: 4, product_code: '10999', name: 'สินค้ายังไม่ยืนยันบรรจุ', unit: 'ชิ้น', is_active: 'TRUE' },
    { record_id: 5, product_code: '10777', name: 'ของหมดทั้งคลังและรถ', unit: 'ชิ้น', is_active: 'TRUE' }
  ],
  product_units: [
    { record_id: 1, product_id: 1, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 12, is_active: 'TRUE' },
    { record_id: 2, product_id: 1, unit_code: 'PK', unit_label: 'แพ็ค', unit_factor: 4, is_active: 'TRUE' },
    { record_id: 3, product_id: 2, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 60, is_active: 'TRUE' },
    // รหัสเก่า CASE ยังค้างอยู่ได้ (ก่อน migrateUnitCodes) — ต้องยังนับเป็นลัง
    { record_id: 4, product_id: 3, unit_code: 'CASE', unit_label: 'หีบ', unit_factor: 100, is_active: 'TRUE' },
    // ★ ค่าที่ ensureDefaultSalesUnit ใส่ไว้ตอนยังไม่รู้ขนาดบรรจุจริง
    { record_id: 5, product_id: 4, unit_code: 'CT', unit_label: 'ลัง (ยังไม่ยืนยันขนาดบรรจุ)', unit_factor: 1, is_active: 'TRUE' },
    { record_id: 6, product_id: 5, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 10, is_active: 'TRUE' },
    // หน่วยที่ปิดใช้งานแล้วต้องไม่ถูกหยิบไปหาร
    { record_id: 7, product_id: 2, unit_code: 'CT', unit_label: 'ลังเก่า', unit_factor: 999, is_active: 'FALSE' }
  ],
  warehouse_stock: [
    // คลังของบริษัท (tenant_id ว่าง)
    { record_id: 1, tenant_id: '', warehouse_id: 1, product_id: 1, qty: 120 },
    { record_id: 2, tenant_id: '', warehouse_id: 2, product_id: 1, qty: 6 },     // สองคลัง รวมเป็นสินค้าตัวเดียว
    { record_id: 3, tenant_id: '', warehouse_id: 1, product_id: 2, qty: 90 },
    { record_id: 4, tenant_id: '', warehouse_id: 1, product_id: 4, qty: 7 },
    { record_id: 5, tenant_id: '', warehouse_id: 1, product_id: 5, qty: 0 },
    // คลังของ BDC
    { record_id: 6, tenant_id: 'BDC', warehouse_id: 9, product_id: 1, qty: 24 },
    { record_id: 7, tenant_id: 'BDC', warehouse_id: 9, product_id: 3, qty: 250 },
    // ★ แถวที่ tenant_id = 'TNKI' ต้องไม่ถูกนับเป็นของบริษัท (ขอบเขตของบริษัทคือ scope ว่าง)
    { record_id: 8, tenant_id: 'TNKI', warehouse_id: 1, product_id: 2, qty: 999999 }
  ],
  van: {
    // ของบนรถ: แยกตามพนักงาน ต้องรวมเป็นก้อนเดียวต่อสินค้า
    TNKI: [
      { line_user_id: 'U1', product_id: 1, qty: 24 },
      { line_user_id: 'U2', product_id: 1, qty: 12 },
      { line_user_id: 'U2', product_id: 3, qty: 50 },
      { line_user_id: 'U3', product_id: 5, qty: 0 },      // คนที่รถว่าง ไม่ควรถูกนับเป็นพนักงานที่มีของ
      { line_user_id: 'U9', product_id: '', qty: 5 }       // แถวขยะไม่มีรหัสสินค้า
    ],
    BDC: [{ line_user_id: 'B1', product_id: 1, qty: 12 }]
  }
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '2026-10-21' },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralAppend: () => {}, centralAppendMany: () => {}, centralNextId: () => 1, centralInvalidate: () => {},
  deleteRowsWhere: () => {},
  nowStr: () => '2026-10-21 09:00:00',
  _requirePermission: () => null,
  _effectiveTenantId: (s, p) => (s && s.tenant_id) || (p && p.tenantId) || '',
  // ตัวจริงอยู่ใน 20_purchasing_master.gs — จำลองพฤติกรรมเดียวกัน (กรองด้วย tenant_id ตรงตัว)
  _scoped: (name, scope) => sheetOf(name).filter(r => String(r.tenant_id || '') === String(scope || '')),
  tenantObjectsIfExists: (tid, name) => {
    if (name !== 'van_stock') return [];
    if (!sheets.van[tid]) throw new Error('ไม่พบไฟล์ของตัวแทน ' + tid);
    return sheets.van[tid].map(o => Object.assign({}, o));
  }
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralNextId', 'centralInvalidate', 'deleteRowsWhere', 'nowStr', 'tenantObjectsIfExists']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });
vm.runInContext('var ADMIN_STATUS_ACTIVE = "active";', ctx, { filename: 'stub.gs' });
['28_units.gs', '57_user_tenants.gs', '58_inventory_report.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));

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
const row = (snap, code) => snap.rows.find(r => r.productCode === code);

console.log('-- ขอบเขตของบริษัทเจ้าของสินค้า --');
const own = ctx.inventorySnapshot('TNKI', {});
eq('★ คลัง = แถวที่ tenant_id ว่าง · แถว TNKI 999999 ไม่ถูกนับ', row(own, '10185').warehouseBase, 90);
eq('★ แต่ของบนรถอ่านจากไฟล์ของตัวแทนบ้าน TNKI', row(own, '10143').vanBase, 36);
eq('ว่าง = บริษัท (เหมือนส่ง TNKI)', ctx.inventorySnapshot('', {}).tenantId, 'TNKI');
eq('ชื่อหัวรายงานใช้ชื่อบริษัทจริง', own.tenantName, 'บริษัท ธนัทกร จำกัด');
eq('นับพนักงานที่มีของบนรถ (คนที่รถว่างไม่นับ)', own.vanStaff, 2);

console.log('\n-- รวมหลายคลัง หลายคน แล้วแปลงเป็นลัง --');
eq('คลังสองแห่งรวมกัน 120+6 = 126 ชิ้น', row(own, '10143').warehouseBase, 126);
eq('★ 126 ชิ้น ÷ 12 = 10.5 ลัง', row(own, '10143').warehouse, 10.5);
eq('รถ 36 ชิ้น = 3 ลัง', row(own, '10143').van, 3);
eq('รวม 162 ชิ้น = 13.5 ลัง', row(own, '10143').total, 13.5);
eq('ช่องรวม = คลัง + รถ เสมอ', row(own, '10143').total, row(own, '10143').warehouse + row(own, '10143').van);
eq('หน่วยที่ปิดใช้งาน (factor 999) ไม่ถูกหยิบมาหาร: 90 ÷ 60 = 1.5', row(own, '10185').warehouse, 1.5);
eq('แถวขยะที่ไม่มีรหัสสินค้าไม่เข้ารายงาน', own.rows.filter(r => !r.productCode).length, 0);

console.log('\n-- ยังไม่ยืนยันขนาดบรรจุ: ห้ามหารมั่ว --');
const un = row(own, '10999');
eq('★ ไม่หาร — คืนจำนวนชิ้นตามจริง', un.total, 7);
eq('ติดธงไว้ให้ฝั่งแสดงผล', un.confirmed, false);
eq('หน่วยที่แสดงเป็นหน่วยฐานของสินค้า ไม่ใช่คำว่าลัง', un.unitLabel, 'ชิ้น');
eq('นับจำนวนรายการที่ยังไม่ยืนยัน', own.unconfirmed, 1);
eq('★ ยอดรวมลังไม่บวกชิ้นเข้าไป (10.5 + 1.5 = 12 ไม่ใช่ 19)', own.totals.warehouse, 12);
eq('ยอดรวมหน่วยฐานยังรวมทุกแถว (126+90+7)', own.totals.warehouseBase, 223);

console.log('\n-- ตัวแทนรายอื่น --');
const bdc = ctx.inventorySnapshot('BDC', {});
eq('เห็นเฉพาะคลังของตัวเอง', bdc.rows.map(r => r.productCode).sort(), ['10143', '10505']);
eq('ของบริษัทไม่ปนมา', row(bdc, '10143').warehouseBase, 24);
eq('รถของ BDC', row(bdc, '10143').vanBase, 12);
eq('★ รหัสหน่วยเก่า CASE ยังนับเป็นลัง: 250 ÷ 100 = 2.5', row(bdc, '10505').total, 2.5);
// ของตัวนี้บนรถ 50 ชิ้นอยู่ในไฟล์ของ TNKI — ต้องไม่ไหลข้ามมาหา BDC
eq('★ ของบนรถของตัวแทนอื่นไม่ปนมา', row(bdc, '10505').vanBase, 0);
eq('และ 50 ชิ้นนั้นยังอยู่ฝั่งบริษัทครบ', row(own, '10505').vanBase, 50);
eq('ชื่อตัวแทนปกติไม่ถูกแทนด้วยชื่อบริษัท', bdc.tenantName, 'บีดีซี ตะวันออก');

console.log('\n-- ตัวแทนที่ยังไม่มีไฟล์ --');
const nw = ctx.inventorySnapshot('NEW', {});
eq('★ อ่านรถไม่ได้ ต้องบอก ไม่ใช่รายงาน 0 ให้เข้าใจว่ารถว่าง', nw.vanAvailable, false);
eq('ยังตอบสำเร็จ ไม่ล้มทั้งรายงาน', nw.success, true);
eq('คลังของตัวแทนรายนี้ยังไม่มีของ', nw.rows.length, 0);

console.log('\n-- การกรองและเรียง --');
eq('★ ของที่หมดทั้งคลังและรถไม่โผล่ (nonZeroOnly ค่าตั้งต้น)', row(own, '10777'), undefined);
eq('ขอให้แสดงของที่หมดด้วยก็ได้',
  ctx.inventorySnapshot('TNKI', { nonZeroOnly: false }).rows.some(r => r.productCode === '10777'), true);
eq('★ เรียงตามของรวม (หน่วยฐาน) มากไปน้อย — ไม่เอาลังปนชิ้นมาเรียง',
  own.rows.map(r => r.productCode), ['10143', '10185', '10505', '10999']);
const cut = ctx.inventorySnapshot('TNKI', { limit: 2 });
eq('จำกัดจำนวนแถว', cut.rows.length, 2);
eq('★ ยังบอกว่ามีทั้งหมดกี่รายการ (ไม่งั้นคนอ่านคิดว่ามีแค่นี้)', [cut.shown, cut.products], [2, 4]);
eq('ยอดรวมยังเป็นของทั้งหมด ไม่ใช่แค่แถวที่โชว์', cut.totals.warehouse, own.totals.warehouse);
eq('ค้นหาด้วยชื่อ', ctx.inventorySnapshot('TNKI', { search: 'ยุง' }).rows.map(r => r.productCode), ['10185']);
eq('ค้นหาด้วยรหัส', ctx.inventorySnapshot('TNKI', { search: '10505' }).rows.map(r => r.productCode), ['10505']);

console.log('\n-- action ของแอปแอดมิน: ต้องดูแลตัวแทนรายนั้นอยู่จริง --');
sheets.admin_user_tenants = [{ record_id: 1, admin_user_id: '7', tenant_id: 'BDC' }];
const RESP = { adminUserId: '7', record_id: '7', role_code: 'owner_admin', tenant_id: '' };
eq('ดูของตัวแทนที่ตัวเองดูแล', ctx.getInventorySnapshot(RESP, { tenantId: 'BDC' }).tenantId, 'BDC');
fails('★ ส่งรหัสตัวแทนที่ไม่ได้ดูแลมาเอง = ปฏิเสธ', ctx.getInventorySnapshot(RESP, { tenantId: 'TNKI' }), /ไม่มีสิทธิ์/);
const AGENT = { adminUserId: '8', record_id: '8', role_code: 'tenant_admin', tenant_id: 'BDC' };
eq('แอดมินตัวแทนไม่ต้องส่งรหัสมา ได้ของตัวเอง', ctx.getInventorySnapshot(AGENT, {}).tenantId, 'BDC');
fails('แอดมินตัวแทนขอดูของบริษัท', ctx.getInventorySnapshot(AGENT, { tenantId: 'TNKI' }), /ไม่มีสิทธิ์/);

console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
