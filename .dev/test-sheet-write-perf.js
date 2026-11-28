// รัน: node .dev/test-sheet-write-perf.js — ตรวจว่าการหาเลขถัดไป/เขียนหลายแถว "อ่านน้อยลงจริง" (นับเซลล์ที่อ่าน + จำนวนครั้งที่เรียก Sheets)
// ★ เทสต์ผลลัพธ์อย่างเดียวผ่านทั้งที่โค้ดอ่านทั้งชีต (ผลเหมือนกันเป๊ะ) จึงจับเรื่องความเร็วไม่ได้ — ต้องนับการอ่านเอง
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

function fakeSheet(name, hdr, nRows, maxRows) {
  const rows = [hdr.slice()];
  for (let i = 1; i <= nRows; i++) rows.push(hdr.map((h, c) => c === 0 ? i : 'x' + i + '_' + c));
  const stat = { cellsRead: 0, calls: 0, cellsWritten: 0, appendRow: 0, insertRows: 0 };
  const sh = {
    stat, rows, maxRows: maxRows || rows.length + 1000,
    getName: () => name,
    getLastRow: () => { stat.calls++; return rows.length; },
    getLastColumn: () => { stat.calls++; return hdr.length; },
    getMaxRows: () => sh.maxRows,
    insertRowsAfter: (after, n) => { stat.insertRows += n; sh.maxRows += n; },
    getDataRange: () => ({ getValues: () => { stat.calls++; stat.cellsRead += rows.length * hdr.length; return rows.map(r => r.slice()); } }),
    getRange: (r, c, nr, nc) => { nr = nr || 1; nc = nc || 1; return {
      getValue: () => { stat.calls++; stat.cellsRead++; return rows[r - 1][c - 1]; },
      getValues: () => { stat.calls++; stat.cellsRead += nr * nc; const out = []; for (let i = 0; i < nr; i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return out; },
      setValues: v => { stat.calls++; stat.cellsWritten += v.length * v[0].length; if (r + nr - 1 > sh.maxRows) throw new Error('range outside grid'); v.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); } }; },
    appendRow: row => { stat.calls++; stat.appendRow++; stat.cellsWritten += row.length; rows.push(row.slice()); },
  };
  return sh;
}
const SHEETS = {};
const ctx = { console, JSON, String, Number, Object, Array, Math, parseInt, parseFloat, Date,
  tenantSheet: (t, n) => SHEETS[n], centralInvalidate: () => {} };
vm.createContext(ctx);
// ดึงเฉพาะฟังก์ชันที่ทดสอบจากไฟล์จริง
const src = B('02_helpers.gs');
const grab = name => { const m = new RegExp('function ' + name + String.raw`\([^)]*\) \{[\s\S]*?\r?\n\}`, 'm').exec(src); if (!m) throw new Error('ไม่พบ ' + name); return m[0]; };
['nextIdOf', 'appendRowToSheet', 'appendRowsToSheet', 'tenantAppendMany'].forEach(n => vm.runInContext(grab(n), ctx));

let failed = 0;
const eq = (name, actual, expected) => { const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual))); if (!ok) failed++; };

const HDR = ['record_id', 'order_id', 'product_id', 'unit_code', 'qty', 'price', 'line_total', 'tax_status', 'a', 'b', 'c', 'd'];
console.log('── nextIdOf: ตารางใหญ่ อ่านเฉพาะคอลัมน์ record_id ──');
SHEETS.order_items = fakeSheet('order_items', HDR, 5000);
const st = SHEETS.order_items.stat;
eq('เลขถัดไปถูก (5000 แถว → 5001)', ctx.nextIdOf(SHEETS.order_items), 5001);
eq('★ อ่านไม่เกินเซลล์ของคอลัมน์เดียว (≈5,000 ไม่ใช่ 60,000)', st.cellsRead <= 5001 + 5, true);
console.log('   อ่านไปจริง', st.cellsRead, 'เซลล์ ใน', st.calls, 'การเรียก (ทางเดิมอ่าน', 5001 * HDR.length, 'เซลล์)');

SHEETS.small = fakeSheet('small', HDR, 30);
eq('ตารางเล็กยังใช้ทางเดิมได้ผลเท่ากัน', ctx.nextIdOf(SHEETS.small), 31);
SHEETS.empty = fakeSheet('empty', HDR, 0);
eq('ตารางว่าง → 1', ctx.nextIdOf(SHEETS.empty), 1);
// หัวตารางไม่ได้ขึ้นต้นด้วย record_id → ตกไปทางเดิม ไม่ตอบผิด
const odd = fakeSheet('odd', ['name', 'record_id'], 300); odd.rows.forEach((r, i) => { if (i) { r[0] = 'n' + i; r[1] = 1000 + i; } });
SHEETS.odd = odd;
eq('record_id ไม่ใช่คอลัมน์แรก → ใช้ทางเดิม ได้ค่าถูก', ctx.nextIdOf(odd), 1300 + 1);

console.log('\n── tenantAppendMany: ก้อนเดียว ไม่ใช่ appendRow ทีละแถว ──');
const rowsIn = [1, 2, 3, 4, 5].map(i => ({ order_id: 77, product_id: i, qty: i }));
const before = { ...st };
const n = ctx.tenantAppendMany('T1', 'order_items', rowsIn);
eq('เขียน 5 แถว', n, 5);
eq('★ record_id ต่อเนื่องจากเลขสูงสุด', SHEETS.order_items.rows.slice(-5).map(r => r[0]), [5001, 5002, 5003, 5004, 5005]);
eq('★ ไม่ใช้ appendRow เลย (เขียนด้วย setValues ครั้งเดียว)', [st.appendRow - before.appendRow, st.cellsWritten - before.cellsWritten], [0, 5 * HDR.length]);
eq('  ช่องที่ไม่ได้ส่งเป็นค่าว่าง ตามหัวตาราง', SHEETS.order_items.rows.slice(-1)[0].slice(1, 5), [77, 5, '', 5]);
eq('  record_id ที่ส่งมาเองไม่ถูกทับ', (() => { const o = [{ record_id: 9999, order_id: 1 }]; ctx.tenantAppendMany('T1', 'order_items', o); return o[0].record_id; })(), 9999);

console.log('\n── ชีตที่แถวเต็มพอดี: ต้องขยายตารางก่อน ไม่งั้น setValues ล้ม ──');
const tight = fakeSheet('tight', HDR, 10, 11);        // 11 แถว (รวมหัว) เต็มพอดี
SHEETS.tight = tight;
let threw = null; try { ctx.tenantAppendMany('T1', 'tight', [{ order_id: 1 }, { order_id: 2 }, { order_id: 3 }]); } catch (e) { threw = e.message; }
eq('ไม่ล้ม · ขยายแถวให้ก่อน', [threw, tight.stat.insertRows >= 3, tight.rows.length], [null, true, 14]);

eq('รายการว่าง → ไม่ทำอะไร ไม่แตะชีต', (() => { const c = SHEETS.order_items.stat.calls; ctx.tenantAppendMany('T1', 'order_items', []); return SHEETS.order_items.stat.calls - c; })(), 0);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
