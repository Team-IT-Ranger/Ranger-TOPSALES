/**
 * นำเข้าทะเบียนสินค้าจากไฟล์ของระบบเดิม เข้าทะเบียนสินค้าส่วนกลาง
 *
 *   node .dev/import-products.js --file reference/customer_for_bdc.xlsx --sheet item --dry
 *   BACKEND_URL='<exec url>' ADMIN_USER='<user>' ADMIN_PASS='<pass>' \
 *     node .dev/import-products.js --file ... --sheet item --commit
 *
 * --dry (ค่าตั้งต้น) = อ่านไฟล์ แปลง รายงาน ไม่แตะ backend
 * จับคู่ด้วย **รหัสสินค้า (product_code)** เป็นหลัก — ของที่มีอยู่แล้วถูกอัปเดต ไม่ใช่สร้างซ้ำ
 * รันซ้ำได้ ค่าที่ไฟล์ไม่มีจะไม่ถูกล้าง
 */
const fs = require('fs'), path = require('path');
const XLSX = require(path.join(__dirname, 'xlsx.full.min.js'));

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FILE = arg('--file');
const SHEET = arg('--sheet', 'item');
const COMMIT = args.includes('--commit');
if (!FILE) { console.error('ต้องระบุ --file <path>'); process.exit(1); }

const S = v => String(v === undefined || v === null ? '' : v).trim();
const num = v => { const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const clean = o => { const r = {}; Object.keys(o).forEach(k => { if (o[k] !== '' && o[k] !== undefined && o[k] !== null) r[k] = o[k]; }); return r; };

/* ชื่อกลุ่มสินค้าภาษาไทยจากรหัสหมวดของ Smartsales — รหัสดิบอ่านไม่รู้เรื่องสำหรับคนใช้งาน
   หมวดที่ไม่รู้จักใช้รหัสเดิมไปก่อน (ดีกว่าเดาผิด) แล้วค่อยเปลี่ยนชื่อในแอปทีหลัง */
const CLASS_NAME = {
  'IC-COIL': 'ยาจุดกันยุง', 'IC-AE': 'สเปรย์ไล่ยุง', 'IC-LE': 'เครื่องไล่ยุงไฟฟ้า',
  'IC-GLUE': 'กาวดักแมลง', 'HEALTHCARE': 'ผลิตภัณฑ์เพื่อสุขภาพ', 'BEAUTY': 'ความงาม',
  'XPE': 'รายการพิเศษ (ไม่ใช่สินค้า)'
};

const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer' });
if (!wb.SheetNames.includes(SHEET)) { console.error('ไม่พบชีต "' + SHEET + '" (มี: ' + wb.SheetNames.join(', ') + ')'); process.exit(1); }
const src = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: '' });

const rows = [], notes = [];
src.forEach((r, i) => {
  const code = S(r.ItemCode), name = S(r.ItemDesc);
  if (!code || !name) { notes.push('แถว ' + (i + 2) + ': ไม่มีรหัสหรือชื่อ — ข้าม'); return; }
  const cls = S(r.ClassCode);
  const isService = cls === 'XPE';                       // ค่าเช่าพื้นที่ / ยกเลิกบิล — ไม่ใช่ของที่มีตัวตน
  const nameEn = S(r.UnitName);                          // ★ คอลัมน์ชื่อ UnitName แต่ข้างในเป็นชื่อสินค้าภาษาอังกฤษ
  rows.push(clean({
    productCode: code,
    name,
    nameEn: nameEn && nameEn !== name ? nameEn : '',
    // Cost/Price ในไฟล์เป็น 0 ทุกแถว — ไม่ส่งไป จะได้ไม่ไปทับราคาที่ตั้งไว้แล้วในระบบให้เป็นศูนย์
    groupName: CLASS_NAME[cls] || cls,
    taxStatus: S(r.VatStatus) === '0' ? 'exempt' : '',
    isStock: isService ? 'FALSE' : 'TRUE',
    isActive: S(r.IsCancel) === '1' ? 'FALSE' : 'TRUE',
    isSellable: S(r.Approved) === '0' ? 'FALSE' : 'TRUE',
    // หมวดย่อยของระบบเดิม เก็บไว้ในหมายเหตุ ระบบเรามีกลุ่มสินค้าชั้นเดียว
    note: S(r.CategoryCode) ? ('หมวดย่อยเดิม: ' + S(r.CategoryCode)) : '',
    externalCode: code, externalSystem: 'bdc'
  }));
  if (isService) notes.push('แถว ' + (i + 2) + ' [' + code + '] "' + name + '" อยู่หมวด XPE — ตั้งเป็นไม่ตัดสต็อกให้แล้ว ตรวจดูว่าควรมีในทะเบียนสินค้าไหม');
  if (name.length >= 58) notes.push('แถว ' + (i + 2) + ' [' + code + '] ชื่อยาว ' + name.length + ' ตัว อาจถูกตัดมาจากระบบเดิม');
});

const fill = {};
rows.forEach(m => Object.keys(m).forEach(k => { fill[k] = (fill[k] || 0) + 1; }));
console.log('ไฟล์: ' + path.basename(FILE) + ' ชีต "' + SHEET + '" → ทะเบียนสินค้าส่วนกลาง');
console.log('แปลงได้ ' + rows.length + ' รายการ จาก ' + src.length + ' แถว\n');
console.log('ฟิลด์ที่มีข้อมูล:');
Object.keys(fill).sort((a, b) => fill[b] - fill[a]).forEach(k =>
  console.log('  ' + k.padEnd(16) + String(fill[k]).padStart(5) + '  (' + Math.round(fill[k] / rows.length * 100) + '%)'));

const groups = {};
rows.forEach(m => { groups[m.groupName] = (groups[m.groupName] || 0) + 1; });
console.log('\nกลุ่มสินค้าที่จะใช้/สร้าง:');
Object.keys(groups).sort((a, b) => groups[b] - groups[a]).forEach(g => console.log('  ' + g.padEnd(32) + groups[g] + ' รายการ'));

const exempt = rows.filter(m => m.taxStatus === 'exempt');
if (exempt.length) console.log('\nยกเว้น VAT: ' + exempt.map(m => m.productCode + ' ' + m.name).join(' · '));

if (notes.length) {
  console.log('\nข้อสังเกต ' + notes.length + ' รายการ:');
  notes.slice(0, 12).forEach(n => console.log('  - ' + n));
  if (notes.length > 12) console.log('  … อีก ' + (notes.length - 12) + ' รายการ');
}
console.log('\nตัวอย่างที่จะส่งเข้าระบบ:');
rows.slice(0, 2).forEach(m => console.log(JSON.stringify(m, null, 1)));

if (!COMMIT) {
  console.log('\n[dry run] ยังไม่ได้เขียนอะไรลง backend — ใส่ --commit พร้อม BACKEND_URL/ADMIN_USER/ADMIN_PASS เพื่อนำเข้าจริง');
  process.exit(0);
}

const BACKEND_URL = process.env.BACKEND_URL;
const USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!BACKEND_URL || !USER || !PASS) { console.error('ต้องตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS'); process.exit(1); }
const call = async body => {
  const res = await fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบผิดรูปแบบ: ' + txt.slice(0, 200)); }
};

(async () => {
  const login = await call({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.success) { console.error('เข้าสู่ระบบไม่สำเร็จ: ' + login.message); process.exit(1); }
  const r = await call({ action: 'importExpressProducts', token: login.token,
    payload: { rows, externalSystem: 'bdc' } });
  if (!r.success) { console.error('นำเข้าไม่สำเร็จ: ' + r.message); process.exit(1); }
  console.log('\n' + r.message);
  if (r.groupsAdded && r.groupsAdded.length) console.log('กลุ่มสินค้าที่สร้างใหม่: ' + r.groupsAdded.join(', '));
  (r.errors || []).forEach(e => console.log('  ' + e));
})();
