/**
 * ★ เลิกใช้ (3 ต.ค. 2026) — ถูกแทนที่ด้วย .dev/apply-unit-sheet.js : base_price ตอนนี้เป็นราคา "ก่อน VAT ต่อลัง" ห้ามรันสคริปต์นี้ (เขียนราคารวม VAT ทับ)
 *
 * อัปเดต products.base_price ให้ตรงกับราคาตั้งงวด Oct-Dec 2569 (2026-09-30 (2), เจ้าของระบบสั่ง —
 * "ระบบราคาจะใช้ราคาก่อนภาษีเป็นตัวตั้งต้น ... เอาราคานี้ใส่เป็นราคาขายตั้งต้นในtable สินค้า")
 *
 *   BACKEND_URL='<exec url>' ADMIN_USER='<username>' ADMIN_PASS='<รหัสผ่าน>' node .dev/refresh-base-price-q4-2026.js [--commit]
 *   REFERENCE_DIR=<พาธ>  ถ้า reference/ ไม่ได้อยู่ข้างๆ repo นี้ (ปกติมีแค่ clone ฝั่ง Drive)
 *   ไม่ใส่ --commit = ดูอย่างเดียว (ค่าเดิม → ค่าใหม่ ต่อสินค้า)
 *
 * ★ ทำไมใช้คอลัมน์ H (ราคาตั้ง รวม VAT) ไม่ใช่คำนวณ G × (1+VAT) เอง: products.base_price ทั้งระบบเป็นราคา
 * "รวม VAT แล้ว" เสมอ (ดู CLAUDE.md หัวข้อ VAT) — ยังไม่เปลี่ยนอนุสัญญานี้ เพราะ base_price ยังถูกใช้เป็นราคาจริง
 * ที่คิดเงินได้ในเส้นทาง fallback (ลูกค้าที่กลุ่มยังไม่มีชุดราคา active — ดู 07_sales.gs) และโชว์เป็นราคาอ้างอิง
 * ในแอปมือถือ (06_bootstrap.gs) — เปลี่ยนความหมายคอลัมน์นี้ทั้งระบบจะกระทบสองจุดนั้นทันที เสี่ยงเกินไปสำหรับ
 * การอัปเดตราคาอ้างอิงรอบนี้ · ที่มาของ "ราคาก่อนภาษี" (คอลัมน์ G) ยังคงอยู่ครบใน price_list_items.list_price_ex_vat
 * ของชุดราคาแต่ละงวด (ดู import-pricelists.js) ซึ่งเป็นตัวที่ใบขายจริงใช้แสดงส่วนลดต่อบรรทัด (ดู
 * _lineListBreakdown, 18_pricing_engine.gs) — งวดนี้แค่รีเฟรช "ราคาอ้างอิง" ในทะเบียนสินค้าให้ตรงกับงวดล่าสุด
 *
 * เฉพาะสินค้าที่มีรหัสตรงกับใบราคา (จับคู่ product_code หรือ alias_codes เหมือน importPriceList) — สินค้าที่ไม่มี
 * ในใบราคานี้ (เช่นสินค้าเฉพาะกลุ่มอื่น) จะไม่ถูกแตะ
 */
const XLSX = require('./xlsx.full.min.js'), fs = require('fs'), path = require('path');
const P = require('../frontend-admin/pricelist-parser.js');

const URL_ = process.env.BACKEND_URL, USER = process.env.ADMIN_USER || 'admin', PASS = process.env.ADMIN_PASS || 'ChangeMe123!';
const COMMIT = process.argv.includes('--commit');
if (!URL_) { console.error('ตั้ง BACKEND_URL ก่อน'); process.exit(1); }

const call = async body => {
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), redirect: 'follow' });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบไม่ใช่ JSON: ' + t.slice(0, 120)); }
};
const round2 = n => Math.round(n * 100) / 100;

(async () => {
  const dir = process.env.REFERENCE_DIR || path.join(__dirname, '..', 'reference');
  // ใช้ไฟล์ "ร้านค้า" (เหนือ/อีสาน/ตะวันออก หรือ กรุงเทพฯ/กลาง/ตะวันตก) เป็นแหล่งราคาตั้ง — เจ้าของระบบระบุ
  // "ไฟล์ 1 หรือ 2" เพราะทั้งสองไฟล์ใช้ราคาตั้ง (คอลัมน์ G/H) ชุดเดียวกันทุกรายการ (ตรวจแล้ว 2026-09-30)
  const files = fs.readdirSync(dir).filter(x => x.startsWith('Go Live') && x.endsWith('.xlsx') && (x.includes('เหนือ') || x.includes('กรุงเทพฯ')));
  if (!files.length) { console.error('ไม่พบไฟล์ "ร้านค้า เหนือ.../กรุงเทพฯ..." ใน ' + dir); process.exit(1); }
  const f = files[0];
  console.log('อ่านราคาตั้งจาก: ' + f + (files.length > 1 ? ' (เจอ ' + files.length + ' ไฟล์ ใช้ไฟล์แรก — ตรวจแล้วราคาตั้งเหมือนกันทุกไฟล์ในกลุ่มนี้)' : ''));
  const parsed = P.parse(XLSX, fs.readFileSync(path.join(dir, f)), { type: 'buffer' });
  const sheet = parsed.sheets[0];
  if (!sheet) { console.error('อ่านไฟล์ไม่สำเร็จ'); process.exit(1); }
  if (sheet.warnings.length) console.log('คำเตือนจากไฟล์ (ไม่ได้กันการรันต่อ): ' + sheet.warnings.join(' / '));

  const login = await call({ action: 'adminLogin', payload: { username: USER, password: PASS } });
  if (!login.success) { console.error('ล็อกอินไม่ได้: ' + login.message); process.exit(1); }
  const token = login.token;
  console.log('ล็อกอินเป็น ' + USER + ' (' + login.roleCode + ')\n');

  const products = await call({ action: 'listProductsAdmin', token });
  if (!products.success) { console.error('อ่านทะเบียนสินค้าไม่สำเร็จ: ' + products.message); process.exit(1); }
  // ★ listProductsAdmin คืนแถวดิบจากชีต (snake_case: record_id/product_code/alias_codes/base_price) ไม่ใช่ camelCase
  const byCode = new Map();
  (products.data || []).forEach(p => {
    const codes = [p.product_code].concat(String(p.alias_codes || '').split(',')).map(c => String(c || '').trim().toLowerCase()).filter(Boolean);
    codes.forEach(c => byCode.set(c, p));
  });

  const plan = [];   // { product, newPrice, codes, name }
  const notFound = [];
  sheet.items.forEach(item => {
    if (item.listInclVat == null) return;   // ไม่มีราคาตั้งรวม VAT ให้ใช้ (ไม่ควรเกิดกับไฟล์นี้ แต่กันไว้)
    const newPrice = round2(item.listInclVat);
    item.variants.forEach(v => {
      const codes = v.codes.map(c => String(c).trim().toLowerCase());
      const hit = codes.map(c => byCode.get(c)).find(Boolean);
      if (!hit) { notFound.push(v.name + ' (' + v.codes.join('/') + ')'); return; }
      if (plan.some(x => x.product.record_id === hit.record_id)) return;   // ตัวแปรอื่นของ item เดียวกันจับคู่กับสินค้าเดียวกันแล้ว
      plan.push({ product: hit, newPrice, name: v.name, codes: v.codes });
    });
  });

  console.log('จับคู่ได้ ' + plan.length + ' สินค้า, หาไม่เจอ ' + notFound.length + (notFound.length ? ' (' + notFound.join(', ') + ')' : ''));
  console.log('');
  let changed = 0, unchanged = 0;
  for (const p of plan) {
    const oldPrice = Number(p.product.base_price) || 0;
    const same = Math.abs(oldPrice - p.newPrice) < 0.005;
    if (same) { unchanged++; continue; }
    changed++;
    console.log((COMMIT ? '→ ' : '  จะแก้: ') + p.product.product_code + ' ' + p.name + '  ฿' + oldPrice.toFixed(2) + ' → ฿' + p.newPrice.toFixed(2));
    if (COMMIT) {
      const r = await call({ action: 'updateProduct', token, payload: { id: p.product.record_id, basePrice: p.newPrice } });
      if (!r.success) console.log('   ✗ ' + r.message);
    }
  }
  console.log('\n' + changed + ' รายการราคาเปลี่ยน, ' + unchanged + ' รายการราคาเดิมอยู่แล้ว' +
    (COMMIT ? '' : ' — โหมดดูอย่างเดียว ใส่ --commit เพื่อบันทึกจริง'));
})().catch(e => { console.error(e.message || e); process.exit(1); });
