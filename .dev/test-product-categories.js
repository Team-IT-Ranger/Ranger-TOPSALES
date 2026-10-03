// รัน: node .dev/test-product-categories.js
// ทดสอบ 44_product_categories.gs — ซิงก์ Category/subCategory จากแท็บ lu_prodcate เข้า products ด้วย SpreadsheetApp จำลอง
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

let SHEET_ROWS = [];
const ctx = {
  console, JSON, String, Number, Object, Array, Math, isNaN, isFinite, Date,
  SpreadsheetApp: { openById: id => ({ getSheetByName: n => n === 'lu_prodcate' ? { getDataRange: () => ({ getValues: () => SHEET_ROWS }) } : null }) },
};
vm.createContext(ctx);
vm.runInContext(B('43_external_sales_import.gs'), ctx, { filename: '43' });   // EXTERNAL_SALES_SHEET_ID
vm.runInContext(B('44_product_categories.gs'), ctx, { filename: '44' });
// _productAllCodes ตัวจริงจาก 10_master_data.gs (ตัดมาเฉพาะฟังก์ชัน — ไฟล์ทั้งไฟล์พึ่งของอื่นเยอะ)
vm.runInContext(B('10_master_data.gs').replace(/\r\n/g, '\n').match(/function _productAllCodes[\s\S]*?\n}\n/)[0], ctx);

let PRODUCTS = [], WRITES = [], COMPANY = true, DENY = false;
ctx.centralObjects = n => n === 'products' ? PRODUCTS : [];
ctx.centralUpdate = (t, id, f) => { WRITES.push({ t, id, f }); const p = PRODUCTS.find(x => x.record_id === id); Object.assign(p, f); return true; };
ctx.nowStr = () => '2026-10-03 10:00:00';
ctx._requirePermission = () => DENY ? { success: false, message: 'ไม่มีสิทธิ์' } : null;
ctx._isCompanySide = () => COMPANY;
const S = { adminUserId: 7 };
const fresh = () => {
  WRITES = []; COMPANY = true; DENY = false;
  SHEET_ROWS = [['ProductNumber', 'SalesUnit', 'Category', 'subCategory'],
    ['10114', 'CT60', 'COIL', 'ขด8ชมทุกกลิ่นหอม'], ['10501', 'CT500', 'GLUE', 'กาวดักแมลงวัน'], [10806, 'CT12', 'LE', 'ลิควิด'], ['', 'CT1', 'X', 'Y']];
  PRODUCTS = [
    { record_id: 1, product_code: '10114', name: 'A', alias_codes: '', category: '', sub_category: '' },
    { record_id: 2, product_code: '99999', name: 'B (alias ตรงชีต)', alias_codes: '10501', category: '', sub_category: '' },
    { record_id: 3, product_code: '10806', name: 'C (รหัสในชีตเป็นตัวเลข)', alias_codes: '', category: 'MANUAL', sub_category: '' },
    { record_id: 4, product_code: 'ZZZ', name: 'D ไม่มีในชีต', alias_codes: '', category: '', sub_category: '' }];
};

console.log('\n── lookup จากแท็บ ──');
fresh();
let l = ctx._readProductCategoryLookup();
eq('อ่านได้ 3 รหัส (ข้ามแถวรหัสว่าง) รหัสตัวเลขแปลงเป็นข้อความ', Object.keys(l.map).sort(), ['10114', '10501', '10806']);
eq('ค่า Category/subCategory ถูก trim และตรงแถว', l.map['10114'], { category: 'COIL', subCategory: 'ขด8ชมทุกกลิ่นหอม' });
SHEET_ROWS.push(['10114', 'CT60', 'AEROSOL', 'อื่น']);
eq('รหัสซ้ำค่าไม่ตรงกัน → ใช้แถวแรก + รายงาน conflicts', [ctx._readProductCategoryLookup().map['10114'].category, ctx._readProductCategoryLookup().conflicts], ['COIL', ['10114']]);
SHEET_ROWS = [['a', 'b'], ['1', '2']];
let threw = ''; try { ctx._readProductCategoryLookup(); } catch (e) { threw = e.message; }
eq('หัวคอลัมน์ไม่ครบ → error ชัดเจน', /ProductNumber/.test(threw), true);

console.log('\n── วางแผน/เขียน ──');
fresh();
let r = ctx.syncProductCategories(S, { dryRun: true });
eq('dryRun: ไม่เขียนอะไร แต่บอกจำนวน (เปลี่ยน 2 · ค่าที่กรอกเองไว้ไม่ทับ → สินค้า C เติมเฉพาะ sub)', [WRITES.length, r.updated, r.matched, r.unmatched], [0, 3, 3, 1]);
fresh();
r = ctx.syncProductCategories(S, {});
eq('เขียนจริง: จับคู่ด้วย product_code และ alias_codes', PRODUCTS.slice(0, 2).map(p => [p.category, p.sub_category]), [['COIL', 'ขด8ชมทุกกลิ่นหอม'], ['GLUE', 'กาวดักแมลงวัน']]);
eq('ค่า Category ที่กรอกเองไว้ไม่ถูกทับ (MANUAL) แต่ subCategory ที่ว่างถูกเติม', [PRODUCTS[2].category, PRODUCTS[2].sub_category], ['MANUAL', 'ลิควิด']);
eq('สินค้าที่ไม่มีในชีตไม่ถูกแตะ', [PRODUCTS[3].category, WRITES.some(w => w.id === 4)], ['', false]);
eq('ประทับผู้แก้/เวลา', [WRITES[0].f.updated_by, WRITES[0].f.updated_at], ['7', '2026-10-03 10:00:00']);
WRITES = [];
r = ctx.syncProductCategories(S, {});
eq('รันซ้ำ = ไม่มีอะไรเปลี่ยน (0 เขียน)', [WRITES.length, r.updated], [0, 0]);
fresh();
r = ctx.syncProductCategories(S, { overwrite: true });
eq('overwrite: ทับค่าที่กรอกเองด้วย', PRODUCTS[2].category, 'LE');

console.log('\n── สิทธิ์ ──');
fresh(); COMPANY = false;
eq('ฝั่งตัวแทนซิงก์ไม่ได้ (ทะเบียนสินค้าเป็นข้อมูลกลาง)', [ctx.syncProductCategories(S, {}).success, WRITES.length], [false, 0]);
fresh(); DENY = true;
eq('ไม่มีสิทธิ์แก้สินค้า = ปฏิเสธ', ctx.syncProductCategories(S, {}).success, false);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
