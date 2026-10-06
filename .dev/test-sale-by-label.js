// รัน: node .dev/test-sale-by-label.js
// ป้ายชื่อ "ใครขาย" (_saleByLabel ใน 41_sales_reports.gs) — แอดมินขอมา 6 ต.ค. 2026 ให้รู้ว่าบิลมาจากพนักงานคนไหน
// เดิมใช้แค่ในรายงาน 1.8.1 (เรียกต่อ "พนักงาน") ตอนนี้หน้ารายการบิลขายเรียกต่อ "บิล" ด้วย
// จึงต้องคุมทั้งความถูกต้องและกรณีขอบที่ทำให้แอดมินตามตัวคนขายไม่ได้
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let sheets, reads;
function reset() {
  sheets = {
    liff_users: [
      { line_user_id: 'U001', display_name: 'สมชาย ขายดี', tenant_id: 'T1' },
      { line_user_id: 'U002', display_name: '', tenant_id: 'T1' }          // ยังไม่ได้ตั้งชื่อ
    ],
    admin_users: [
      { username: 'noi', display_name: 'น้อย แอดมิน' },
      { username: 'ghost', display_name: '' }
    ]
  };
  reads = 0;
}
reset();

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '2026-10-06' },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  centralObjects: n => { reads++; return (sheets[n] || []).map(r => Object.assign({}, r)); },
  tenantObjects: () => [],
  _requirePermission: () => null,
  _salesTenantId: () => 'T1',
  _money: n => Math.round(n * 100) / 100
};
vm.createContext(ctx);
vm.runInContext(B('41_sales_reports.gs'), ctx, { filename: '41_sales_reports.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

console.log('── แปลง sale_by เป็นชื่อคน ──');

eq('พนักงานขับรถ → ชื่อที่ตั้งไว้', ctx._saleByLabel('U001'), 'สมชาย ขายดี');
eq('บิลที่แอดมินเปิดเอง → มีป้ายบอกว่าเป็นแอดมิน', ctx._saleByLabel('admin:noi'), '[แอดมิน] น้อย แอดมิน');
eq('ไม่มี sale_by (ข้อมูลเก่า) → บอกว่าไม่ระบุ ไม่ใช่ค่าว่าง', ctx._saleByLabel(''), '(ไม่ระบุ)');
eq('  undefined ก็ต้องไม่พัง', ctx._saleByLabel(undefined), '(ไม่ระบุ)');

// ★ กรณีที่ทำให้แอดมินตามตัวคนขายไม่ได้ ถ้าเผลอคืนค่าว่าง
eq('★ พนักงานที่ไม่อยู่ในทะเบียนแล้ว (ลาออก/ข้อมูลเก่า) → คืน id ดิบไว้ ยังตามตัวได้',
  ctx._saleByLabel('U999'), 'U999');
eq('★ พนักงานที่ยังไม่ได้ตั้งชื่อ → คืน id ดิบ ไม่ใช่ช่องว่าง', ctx._saleByLabel('U002'), 'U002');
eq('★ แอดมินที่ยังไม่ได้ตั้งชื่อ → ใช้ username แทน', ctx._saleByLabel('admin:ghost'), '[แอดมิน] ghost');
eq('  แอดมินที่ไม่มีในระบบแล้ว → ใช้ username ที่ติดมากับบิล', ctx._saleByLabel('admin:เก่า'), '[แอดมิน] เก่า');

console.log('\n── ต้นทุนการอ่านชีต (หน้ารายการบิลเรียกต่อบิล ไม่ใช่ต่อคน) ──');
reset();
ctx._saleByIdxMemo = null;            // ล้างดัชนีให้เหมือนเริ่มคำขอใหม่
for (let i = 0; i < 300; i++) ctx._saleByLabel('U001');
eq('★ เรียก 300 ครั้ง อ่านชีตแค่ 2 ครั้ง (liff_users + admin_users) ไม่ใช่ 600',
  reads, 2);

console.log('\n── ดัชนีต้องสะท้อนข้อมูลของคำขอนั้นจริง ──');
reset();
ctx._saleByIdxMemo = null;
eq('ก่อนเปลี่ยนชื่อ', ctx._saleByLabel('U001'), 'สมชาย ขายดี');
sheets.liff_users[0].display_name = 'สมชาย เปลี่ยนชื่อ';
ctx._saleByIdxMemo = null;            // คำขอใหม่ = ดัชนีใหม่
eq('คำขอถัดไปเห็นชื่อใหม่ (ดัชนีไม่ค้างข้ามคำขอ)', ctx._saleByLabel('U001'), 'สมชาย เปลี่ยนชื่อ');

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
