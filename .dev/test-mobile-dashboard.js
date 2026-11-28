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
  centralObjects: () => [],
  orderExVat: o => Number(o.total) / 1.07, _round2: x => Math.round(x * 100) / 100,
};
vm.createContext(ctx);
const TABLES = { sales_orders: [], visits: [], order_items: [] };
// getRecentSales ใช้ตัวช่วยพวกนี้ (02_helpers / 34_sales_status) — ดึงของจริงมาจากไฟล์ ไม่เขียนเลียนแบบ
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', '02_helpers.gs'), 'utf8').match(/function safeDateStr\(value\) \{[\s\S]*?\r?\n\}/)[0], ctx);
ctx.SO_STATUS_LABELS = {}; ctx._soStatusOf = o => String((o && o.status) || 'draft');
const STATS = require('./lib-fake-tenant-sheets').install(ctx, TABLES);
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

TABLES.sales_orders = [mk(1, mkDate(nowIso), 107), mk(2, mkDate(nowIso), 214), mk(3, todayTh + ' 09:00:00', 107), mk(4, mkDate('2020-01-01T00:00:00Z'), 999), mk(5, mkDate(nowIso), 500, 'U2')];
TABLES.visits = [{ record_id: 1, line_user_id: 'U1', check_in_at: mkDate(nowIso) }, { record_id: 2, line_user_id: 'U1', check_in_at: '2020-01-01 10:00:00' }];
const r = ctx.getDashboard(U);
eq('★ created_at เป็น Date จริงก็นับ (บั๊กเดิมได้ 0) · เป็นข้อความก็นับ · วันอื่น/คนอื่นไม่นับ', [r.success, r.bills], [true, 3]);
eq('  ยอดก่อนภาษี = (107+214+107)/1.07 = 400', r.revenue, 400);
eq('  ยอดรวมภาษี = 428', r.revenueInclVat, 428);
eq('★ เช็คอินที่เก็บเป็น Date ก็นับ (จุดเดียวกัน)', r.visits, 1);


/* ══ ตารางบิลใหญ่: ต้องอ่านเฉพาะท้ายตาราง ไม่ลากทั้งทะเบียน (28 พ.ย. 2026 — ผู้ใช้แจ้งว่าแอปช้า) ══ */
console.log('\n── ตารางใหญ่ 3,000 บิลเก่า + 4 บิลวันนี้ ──');
const old = []; for (let i = 1; i <= 3000; i++) old.push({ record_id: i, sale_by: i % 7 ? 'U9' : 'U1', created_at: '2026-09-' + String(1 + Math.floor((i - 1) / 110)).padStart(2, '0') + ' 10:00:00', total: 107, a: 'x', b: 'y', c: 'z', d: 'w', e: 'v', f: 'u' });
// เรียงตามเวลา: ทุกใบเก่าก่อนวันนี้ แล้วค่อยบิลวันนี้ (ตารางจริงต่อท้ายตามเวลา)
TABLES.sales_orders = old.concat([mk(3001, todayTh + ' 08:00:00', 107), mk(3002, todayTh + ' 09:00:00', 214), mk(3003, todayTh + ' 10:00:00', 321, 'U2'), mk(3004, todayTh + ' 11:00:00', 107)]);
TABLES.order_items = []; for (let i = 1; i <= 9000; i++) TABLES.order_items.push({ record_id: i, order_id: Math.ceil(i / 3), product_id: 1, qty: 1, is_free: 0 });
[3001, 3002, 3004].forEach((oid, k) => { TABLES.order_items.push({ record_id: 9001 + k * 2, order_id: oid, product_id: 7, qty: 2, is_free: 0 }, { record_id: 9002 + k * 2, order_id: oid, product_id: 8, qty: 5, is_free: 0 }); });
TABLES.visits = [];
STATS.cellsRead = 0;
const big = ctx.getDashboard(U);
eq('ผลถูกเหมือนอ่านทั้งตาราง: บิลของ U1 วันนี้ = 3 · ยอดก่อนภาษี (107+214+107)/1.07 = 400', [big.bills, big.revenue], [3, 400]);
eq('  สินค้าขายดีวันนี้มาจากรายการของบิลวันนี้เท่านั้น (ไม่ปนของเก่า)', big.topProducts.map(t => t.sold), [15, 6]);
const full = 3004 * 7 + 9006 * 6;                              // ทางเดิม: อ่านทั้งตารางบิล + ทั้งตารางรายการ
console.log('   อ่านไปจริง', STATS.cellsRead, 'เซลล์ (ทางเดิมอ่านราว', full, ')');
eq('★ อ่านน้อยกว่าทางเดิมอย่างน้อย 5 เท่า', STATS.cellsRead * 5 < full, true);

// ไม่มีบิลวันนี้เลย ต้องไม่อ่านตารางรายการสินค้า
STATS.cellsRead = 0; STATS.reads = {};
const none = ctx.getDashboard({ tenantId: 'T1', lineUserId: 'U_NOBODY' });
eq('คนที่ไม่มีบิลวันนี้ → 0 และไม่แตะตารางรายการสินค้าเลย', [none.bills, none.revenue, STATS.reads.order_items || 0], [0, 0, 0]);

console.log('\n── getRecentSales: ท้ายตารางพอให้ครบ limit ──');
STATS.cellsRead = 0;
const rec = ctx.getRecentSales({ tenantId: 'T1', lineUserId: 'U1' }, { limit: 15 });
const expectIds = TABLES.sales_orders.filter(o => o.sale_by === 'U1').slice(-15).reverse().map(o => String(o.order_code));
eq('ได้ 15 ใบล่าสุดของ U1 เรียงใหม่→เก่า เหมือนเรียงทั้งตารางแล้วตัด', rec.data.length, 15);
eq('  ใบแรกคือใบล่าสุดของวันนี้', rec.data[0].time, '11:00');
console.log('   อ่านไปจริง', STATS.cellsRead, 'เซลล์ (ทางเดิมอ่านราว', 3004 * 7, ')');
eq('★ อ่านน้อยกว่าทางเดิมอย่างน้อย 3 เท่า', STATS.cellsRead * 3 < 3004 * 7, true);
// คนที่มีบิลน้อยมาก (ทั้งตารางมี 2 ใบ) → ขยายจนถึงหัวตารางแล้วตอบเท่าที่มี ไม่ตกหล่น
TABLES.sales_orders[5].sale_by = 'U_RARE'; TABLES.sales_orders[2500].sale_by = 'U_RARE';
const rare = ctx.getRecentSales({ tenantId: 'T1', lineUserId: 'U_RARE' }, { limit: 15 });
eq('★ คนที่บิลอยู่ไกลถึงต้นตาราง ก็ยังเจอครบ (ขยายช่วงอ่านจนถึงหัวตาราง)', rare.data.length, 2);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
