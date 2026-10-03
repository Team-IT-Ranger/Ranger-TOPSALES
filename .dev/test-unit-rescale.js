// รัน: node .dev/test-unit-rescale.js
// ทดสอบ rescaleProductBaseUnit (45_unit_rescale.gs): สต็อก/ledger/จอง/GR/PO ของ 10503-4 ถูกหาร 10 ต้นทุนคูณ 10 มูลค่าคงเดิม · สินค้าอื่นไม่ถูกแตะ · dry run ไม่เขียน · รันซ้ำถูกปฏิเสธ
const fs = require('fs'), path = require('path'), vm = require('vm');
let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const T = {
  products: [{ record_id: 6, product_code: '10503' }, { record_id: 18, product_code: '10504' }, { record_id: 9, product_code: '10185' }],
  warehouse_stock: [{ record_id: 1, product_id: 18, qty: 5000, avg_cost: 1.56 }, { record_id: 2, product_id: 9, qty: 600, avg_cost: 19.44 }],
  stock_ledger: [{ record_id: 1, product_id: 18, change_qty: 5000, balance_after: 5000, unit_cost: 1.56 }, { record_id: 2, product_id: 9, change_qty: 600, balance_after: 600, unit_cost: 19.44 }],
  stock_reservations: [{ record_id: 1, product_id: 18, qty: 500, status: 'active' }],
  gr_items: [{ record_id: 1, product_id: 18, qty: 10, unit_factor: 500, base_qty: 5000, unit_cost: 1.56 }, { record_id: 2, product_id: 18, qty: 3, unit_factor: 1, base_qty: 3, unit_cost: 15 }, { record_id: 3, product_id: 9, qty: 10, unit_factor: 60, base_qty: 600, unit_cost: 19.44 }],
  po_items: [{ record_id: 1, product_id: 18, qty: 10, unit_factor: 500, received_qty: 10 }, { record_id: 2, product_id: 9, qty: 10, unit_factor: 60, received_qty: 10 }]
};
const props = {};
const updates = [];
const ctx = {
  console, JSON, String, Number, Object, Array, Math, Error,
  centralObjects: t => (T[t] || []).map(r => Object.assign({}, r)),
  centralUpdate: (t, id, f) => { updates.push([t, id, f]); const r = T[t].find(x => x.record_id === id); Object.assign(r, f); return true; },
  nowStr: () => '2026-10-03 20:00:00', Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', '45_unit_rescale.gs'), 'utf8'), ctx);

console.log('\n── dry run ──');
let rep = ctx.rescaleProductBaseUnit(['10503', '10504'], 500, 10, true);
eq('รายงานแถวที่จะแก้ แต่ไม่เขียนอะไร', [rep.length > 0, updates.length, T.warehouse_stock[0].qty, Object.keys(props).length], [true, 0, 5000, 0]);

console.log('\n── เขียนจริง ──');
rep = ctx.rescaleProductBaseUnit(['10503', '10504'], 500, 10, false);
const ws = T.warehouse_stock[0];
eq('สต็อก ÷10 ต้นทุน ×10', [ws.qty, ws.avg_cost], [500, 15.6]);
eq('มูลค่าสต็อกคงเดิม (7,800)', Math.round(ws.qty * ws.avg_cost * 100) / 100, 7800);
eq('ledger ÷10 / ต้นทุน ×10', [T.stock_ledger[0].change_qty, T.stock_ledger[0].balance_after, T.stock_ledger[0].unit_cost], [500, 500, 15.6]);
eq('ยอดจอง ÷10', T.stock_reservations[0].qty, 50);
eq('gr_items แถวลัง: factor 50 · base 500 · ต้นทุน ×10', [T.gr_items[0].unit_factor, T.gr_items[0].base_qty, T.gr_items[0].unit_cost], [50, 500, 15.6]);
eq('gr_items แถวหน่วยอื่น (factor 1) ไม่ถูกแตะ', T.gr_items[1], { record_id: 2, product_id: 18, qty: 3, unit_factor: 1, base_qty: 3, unit_cost: 15 });
eq('po_items: factor 50 · qty/received ไม่เปลี่ยน', [T.po_items[0].unit_factor, T.po_items[0].qty, T.po_items[0].received_qty], [50, 10, 10]);
eq('สินค้าอื่น (10185) ไม่ถูกแตะเลย', [T.warehouse_stock[1], T.stock_ledger[1], T.gr_items[2], T.po_items[1]],
  [{ record_id: 2, product_id: 9, qty: 600, avg_cost: 19.44 }, { record_id: 2, product_id: 9, change_qty: 600, balance_after: 600, unit_cost: 19.44 }, { record_id: 3, product_id: 9, qty: 10, unit_factor: 60, base_qty: 600, unit_cost: 19.44 }, { record_id: 2, product_id: 9, qty: 10, unit_factor: 60, received_qty: 10 }]);

console.log('\n── กันรันซ้ำ / พารามิเตอร์ ──');
let err = ''; try { ctx.rescaleProductBaseUnit(['10503', '10504'], 500, 10, false); } catch (e) { err = e.message; }
eq('รันจริงรอบสองถูกปฏิเสธ (ไม่หารซ้ำ)', /ห้ามรันซ้ำ/.test(err), true);
eq('  สต็อกยัง 500 (ไม่ถูกหารซ้ำ)', T.warehouse_stock[0].qty, 500);
err = ''; try { ctx.rescaleProductBaseUnit(['10503', '99999'], 500, 10, true); } catch (e) { err = e.message; }
eq('รหัสที่ไม่มีในระบบ → ปฏิเสธ', /ไม่พบสินค้าครบ/.test(err), true);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
