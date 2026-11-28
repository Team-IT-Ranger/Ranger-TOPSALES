// รัน: node .dev/test-mobile-dashboard.js — การ์ด "ใบสั่งขายวันนี้" บนหน้าแรกแอปมือถือ (getDashboard · 06_bootstrap.gs)
// ★ บั๊กจริง 28 พ.ย. 2026: Sheets ส่ง created_at กลับมาเป็น Date → String(Date).indexOf('2026-11-28') ไม่เคยตรง การ์ดเป็น 0 ทั้งที่มีบิล
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');
const TODAY = '2026-11-28';
const mkDate = (iso) => vm.runInContext('new Date("' + iso + '")', ctx);   // ต้องสร้างใน realm เดียวกับโค้ด ไม่งั้น instanceof Date ไม่ตรง
let ORDERS = [], VISITS = [];
const ctx = {
  console, JSON, String, Number, Object, Array, Date, Math, parseFloat, parseInt, isNaN,
  Utilities: { formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'); const t = new Date(d.getTime() + 7 * 3600e3);
    return f === 'yyyy-MM-dd' ? t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) : ''; } },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  cacheGet: () => null, cachePut: () => {}, CACHE_TTL_DASHBOARD: 1,
  tenantObjects: (t, n) => n === 'sales_orders' ? ORDERS : n === 'visits' ? VISITS : [],
  centralObjects: () => [],
  orderExVat: o => Number(o.total) / 1.07, _round2: x => Math.round(x * 100) / 100,
};
vm.createContext(ctx);
// _dOnly ตัวจริงจาก 17_pricing.gs (ดึงเฉพาะฟังก์ชัน ไม่โหลดทั้งไฟล์)
const m = B('17_pricing.gs').match(/function _dOnly\(v\) \{[\s\S]*?\n\}/);
vm.runInContext(m[0], ctx);
// ตัดวันที่ "วันนี้" ให้คงที่ — getDashboard คำนวณ today จาก new Date() จึงสร้างบิลเทียบกับวันนี้จริง
vm.runInContext(B('06_bootstrap.gs'), ctx, { filename: '06_bootstrap.gs' });

let failed = 0;
const eq = (name, actual, expected) => { const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual))); if (!ok) failed++; };

const nowIso = new Date().toISOString();                       // วันนี้จริง (UTC) — เวลาไทยอาจเป็นวันถัดไปตอนดึก จึงคำนวณ today แบบเดียวกับโค้ด
const todayTh = ctx.Utilities.formatDate(new Date(), 'x', 'yyyy-MM-dd');
const U = { tenantId: 'T1', lineUserId: 'U1' };
const mk = (id, created, total, by) => ({ record_id: id, sale_by: by || 'U1', created_at: created, total });

ORDERS = [mk(1, mkDate(nowIso), 107), mk(2, mkDate(nowIso), 214), mk(3, todayTh + ' 09:00:00', 107), mk(4, mkDate('2020-01-01T00:00:00Z'), 999), mk(5, mkDate(nowIso), 500, 'U2')];
VISITS = [{ line_user_id: 'U1', check_in_at: mkDate(nowIso) }, { line_user_id: 'U1', check_in_at: '2020-01-01 10:00:00' }];
const r = ctx.getDashboard(U);
eq('★ created_at เป็น Date จริงก็นับ (บั๊กเดิมได้ 0) · เป็นข้อความก็นับ · วันอื่น/คนอื่นไม่นับ', [r.success, r.bills], [true, 3]);
eq('  ยอดก่อนภาษี = (107+214+107)/1.07 = 400', r.revenue, 400);
eq('  ยอดรวมภาษี = 428', r.revenueInclVat, 428);
eq('★ เช็คอินที่เก็บเป็น Date ก็นับ (จุดเดียวกัน)', r.visits, 1);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
