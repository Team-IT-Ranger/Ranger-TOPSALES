/**
 * รัน: node .dev/test-barcode.js
 * ตรวจตัวสร้างบาร์โค้ด Code 128B ใน frontend-admin/doc-print.js
 *
 * ★ บาร์โค้ดที่ลายผิด "สแกนไม่ออก" หรือแย่กว่านั้นคือ "อ่านได้ผิดตัว" ซึ่งแย่กว่าไม่มีบาร์โค้ดเลย
 *   และตาคนดูไม่ออกว่าผิด — เทสต์จึงต้องตรวจถึงระดับลายเส้น ไม่ใช่แค่ว่ามี <svg> ออกมา
 *
 * ตรวจ 3 ชั้น:
 *   1. ตารางลายเส้นถูกต้องตามคุณสมบัติของมาตรฐาน (ทุกตัวรวม 11 โมดูล · แท่งรวมเป็นเลขคู่)
 *   2. ถอดรหัสกลับจาก <svg> ที่สร้างได้ ต้องได้ข้อความเดิมและ checksum ตรง
 *   3. กรณีขอบ: ข้อความว่าง · อักขระนอกช่วง (ภาษาไทย) ต้องคืนค่าว่าง ไม่ใช่วาดมั่ว
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend-admin', 'doc-print.js'), 'utf8');
// ดึงเฉพาะสองก้อนที่ต้องใช้ออกมารันในกล่อง — ไฟล์เต็มต้องมี document/window ซึ่งไม่มีใน node
const tbl = /var C128 = \([\s\S]*?\)\.split\(','\);/.exec(src);
const fn = /function barcodeSvg\(text, opt\) \{[\s\S]*?\n  \}/.exec(src);
if (!tbl || !fn) { console.log('FAIL อ่านโค้ดบาร์โค้ดจาก doc-print.js ไม่ได้ (โครงไฟล์เปลี่ยน?)'); process.exit(1); }
const ctx = { parseInt, String };
vm.createContext(ctx);
vm.runInContext(tbl[0] + '\n' + fn[0] + '\nthis.__t = C128; this.__f = barcodeSvg;', ctx);
const C128 = ctx.__t, barcodeSvg = ctx.__f;

let failed = 0;
const eq = (name, a, b) => {
  const good = JSON.stringify(a) === JSON.stringify(b);
  console.log((good ? 'PASS ' : 'FAIL ') + name + (good ? '' : '\n   expected ' + JSON.stringify(b) + '\n   actual   ' + JSON.stringify(a)));
  if (!good) failed++;
};

console.log('── ตารางลายเส้นตรงตามคุณสมบัติของมาตรฐาน ──');
eq('มีครบ 107 ตัว (0-106)', C128.length, 107);

const bad11 = [], badParity = [];
C128.forEach((p, i) => {
  const d = p.split('').map(Number);
  const sum = d.reduce((a, b) => a + b, 0);
  const bars = d.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
  // ตัวหยุด (106) ยาว 7 ช่วง 13 โมดูลโดยนิยาม ตัวอื่นต้อง 6 ช่วง 11 โมดูล
  if (i === 106) { if (p.length !== 7 || sum !== 13) bad11.push(i); }
  else if (p.length !== 6 || sum !== 11) bad11.push(i);
  if (i !== 106 && bars % 2 !== 0) badParity.push(i);
});
eq('ทุกตัวรวมได้ 11 โมดูล (ตัวหยุด 13)', bad11, []);
eq('ผลรวมของแท่งเป็นเลขคู่เสมอ', badParity, []);

console.log('\n── ถอดรหัสกลับจาก svg ที่สร้างเอง ──');
/* ถอดรหัส: อ่านความกว้างทุกช่วงจาก <rect> (แท่ง) + ช่องว่างระหว่างแท่ง แล้วจับคู่กลับเป็นตัวอักษร
   ★ ไม่ได้ใช้ตารางเดียวกับตัวเข้ารหัสแบบ "เชื่อว่าถูก" เฉยๆ — ชั้นที่ 1 ข้างบนเป็นตัวยืนยันว่าตารางเองถูก
     ชั้นนี้จึงยืนยันว่า "ลำดับการต่อลาย + checksum + ตัวเริ่ม/ตัวหยุด" ถูกด้วย */
const QUIET = 10;
function decode(svg, unit) {
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].map(m => [+m[1], +m[2]]);
  const mods = [];
  let pos = QUIET * unit;                        // ข้าม quiet zone หัวแถบ
  if (rects.length && rects[0][0] !== pos) return { error: 'quiet zone หัวแถบไม่ใช่ ' + QUIET + ' โมดูล' };
  rects.forEach(([x, w]) => {
    if (x > pos) mods.push((x - pos) / unit);   // ช่องว่างก่อนแท่งนี้
    mods.push(w / unit);
    pos = x + w;
  });
  const codes = [];
  let i = 0;
  while (i < mods.length) {
    // ★ ตัวหยุดยาว 7 ช่วง ไม่ใช่ 6 — เหลือ 7 ช่วงพอดีเมื่อไหร่คือตัวหยุด
    const len = (mods.length - i === 7) ? 7 : 6;
    const pat = mods.slice(i, i + len).join('');
    const idx = C128.indexOf(pat);
    if (idx < 0) return { error: 'ลายไม่ตรงตารางที่ช่วง ' + i + ' (' + pat + ')' };
    codes.push(idx);
    i += len;
  }
  return { codes: codes };
}

const CASES = ['SO-20261007-0001', 'DO-TNKN-20261007-0012', 'A', '0123456789', 'INV-202610-0001'];
CASES.forEach(text => {
  const svg = barcodeSvg(text, { unit: 2, height: 40 });
  const d = decode(svg, 2);
  if (d.error) { console.log('FAIL ถอดรหัส "' + text + '": ' + d.error); failed++; return; }
  const codes = d.codes;
  const start = codes[0], stop = codes[codes.length - 1];
  const check = codes[codes.length - 2];
  const data = codes.slice(1, codes.length - 2);
  let sum = 104;
  data.forEach((v, i) => { sum += v * (i + 1); });
  const decoded = data.map(v => String.fromCharCode(v + 32)).join('');
  eq('"' + text + '" → เริ่ม/หยุด/checksum/ข้อความ ถูกครบ',
    [start, stop, check, decoded], [104, 106, sum % 103, text]);
});

console.log('\n── กรณีขอบ ──');
eq('ข้อความว่าง → ไม่วาดอะไร', barcodeSvg('', {}), '');
eq('null/undefined → ไม่วาดอะไร', [barcodeSvg(null, {}), barcodeSvg(undefined, {})], ['', '']);
eq('★ ภาษาไทย (นอกช่วง ASCII) → คืนค่าว่าง ไม่ใช่วาดลายมั่ว', barcodeSvg('ใบส่งของ', {}), '');
eq('ผสมไทย-อังกฤษ ก็ต้องคืนค่าว่างทั้งอัน', barcodeSvg('SO-ก001', {}), '');
{
  const svg = barcodeSvg('SO-1', { unit: 2 });
  const w = +/width="(\d+)"/.exec(svg)[1];
  const last = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].pop();
  eq('★ quiet zone ท้ายแถบ 10 โมดูลเต็ม (สแกนไม่ติดถ้าขาด และตาคนมองไม่เห็น)',
    w - (+last[1] + +last[2]), 10 * 2);
}
const svg1 = barcodeSvg('SO-1', { unit: 3, height: 50 });
eq('ขนาดตามที่สั่ง (unit 3 · สูง 50) และเป็นสีดำล้วน',
  [/height="50"/.test(svg1), /fill="#000"/.test(svg1), /gradient/i.test(svg1)], [true, true, false]);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
