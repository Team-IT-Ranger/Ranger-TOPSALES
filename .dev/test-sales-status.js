// รัน: node .dev/test-sales-status.js
// ทดสอบสถานะบิลขายสองแกน (34_sales_status.gs): การส่งของ / การเงิน, การเปลี่ยนสถานะที่อนุญาต, ประวัติที่ต้องถูกบันทึก
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const t = {   // ชีตของตัวแทน T1
  sales_orders: [
    { record_id: 1, order_code: 'SO-20260926-0001', customer_id: 1, total: 1000, payment_method: 'credit',
      fulfillment_type: 'office_delivery', status: 'pending_delivery', payment_status: 'unpaid', paid_amount: 0,
      sale_by: 'admin:owner', created_at: '2026-09-26 09:00:00' },
    { record_id: 2, order_code: 'SO-20260926-0002', customer_id: 2, total: 500, payment_method: 'cash',
      fulfillment_type: 'immediate', status: 'completed', payment_status: 'paid', paid_amount: 500,
      sale_by: 'U1', created_at: '2026-09-26 09:30:00' },
    // บิลเก่าที่บันทึกก่อนมีคอลัมน์ payment_status (ต้องอ่านออกโดยไม่พัง)
    { record_id: 3, order_code: 'SO-20260901-0009', customer_id: 1, total: 200, payment_method: 'cash',
      fulfillment_type: 'immediate', status: 'completed', created_at: '2026-09-01 10:00:00' }
  ],
  order_status_log: []
};
const sheetOf = n => { if (!t[n]) t[n] = []; return t[n]; };
// คลังกลางของตัวแทน T1 (ชีตกลาง ไม่ใช่ชีตของตัวแทน) + บัญชีคุมการเคลื่อนไหว
const WH = { warehouse_stock: [{ tenant_id: 'T1', warehouse_id: 'W1', product_id: '101', qty: 50, avg_cost: 10 },
                               { tenant_id: 'T1', warehouse_id: 'W1', product_id: '102', qty: 4,  avg_cost: 20 }] };
const LEDGER = [];
const whQty = pid => { const r = WH.warehouse_stock.find(x => String(x.product_id) === String(pid)); return r ? r.qty : 0; };
const CACHE = {};
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-26', getUuid: () => 'uuid',
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' } },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({ get: k => (CACHE[k] === undefined ? null : CACHE[k]),
    put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  centralInvalidate: () => {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); }, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  nowStr: () => '2026-09-26 12:00:00', safeDateStr: v => String(v || ''),
  // เลขที่เอกสาร — นับเพิ่มทุกครั้งที่เรียก เพื่อจับได้ว่าโค้ดเรียกซ้ำโดยไม่ตั้งใจ (เลขเอกสารกินตัวนับทุกครั้ง)
  docNoCalls: 0,
  getNextDocNumber: function (tenantId, type) { ctx.docNoCalls++; return type + '-TEST-' + String(ctx.docNoCalls).padStart(4, '0'); },
  tenantObjects: (tid, n) => sheetOf(n).map(o => Object.assign({}, o)),
  // tab ที่เพิ่มเข้ามาทีหลัง: ไฟล์ตัวแทนเก่ายังไม่มี → ต้องคืน [] ไม่ใช่ throw (ของจริงอยู่ใน 02_helpers.gs)
  tenantObjectsIfExists: (tid, n) => (t[n] ? t[n].map(o => Object.assign({}, o)) : []),
  tenantAppend: (tid, n, o) => sheetOf(n).push(Object.assign({}, o)),
  // ใช้โดย confirmSalesOrder/cancelMySalesOrder (34_sales_status.gs)
  tenantUpdate: (tid, n, id, patch) => { const r = sheetOf(n).find(x => String(x.record_id) === String(id));
    if (r) Object.assign(r, patch); return !!r; },
  tenantNextId: (tid, n) => sheetOf(n).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  // ชีตจำลองแบบ getDataRange/getRange เท่าที่ _updateOrderRow ใช้จริง
  tenantSheet: (tid, n) => {
    const rows = sheetOf(n);
    /* ★ หัวชีตต้องมีครบทุกคอลัมน์ที่โค้ดจะเขียน — `_updateOrderRow` เขียนเฉพาะคอลัมน์ที่มีในหัว
       ขาดคอลัมน์ไหน ค่าจะถูกทิ้งเงียบๆ (ของจริงกันด้วย ensureTenantSheetsCurrent ที่เติมคอลัมน์ให้ก่อนเขียน)
       เพิ่มคอลัมน์ใน TENANT_SHEET_TABS เมื่อไหร่ ต้องมาเพิ่มที่นี่ด้วย ไม่งั้นเทสต์จะผ่านทั้งที่ของจริงไม่ได้เขียน */
    const hdr = ['record_id','order_code','customer_id','total','payment_method','fulfillment_type','status',
      'payment_status','paid_amount','delivered_at','paid_at','updated_at','updated_by','sale_by','created_at',
      'requested_delivery_date','center_edited_at','center_edited_by','delivery_order_no','delivery_order_at'];
    const values = [hdr].concat(rows.map(r => hdr.map(h => (r[h] === undefined ? '' : r[h]))));
    return { getDataRange: () => ({ getValues: () => values }),
      getRange: (row, col) => ({ setValue: v => { rows[row - 2][hdr[col - 1]] = v; } }) };
  },
  ensureTenantSheetsCurrent: () => {},
  HOUSE_TENANT_ID: 'HOUSE',
  _ensureScopeWarehouse: () => 'W1',
  _scoped: (name, scope) => (WH[name] || []).filter(r => String(r.tenant_id || '') === String(scope || '')),
  _applyStockIn: (scope, wh, pid, qty, cost, moveType, refType, refId, note, by) => {
    const row = (WH.warehouse_stock || []).find(r => String(r.tenant_id || '') === String(scope || '')
      && String(r.warehouse_id) === String(wh) && String(r.product_id) === String(pid));
    if (row) row.qty = (Number(row.qty) || 0) + qty;
    else WH.warehouse_stock.push({ tenant_id: scope || '', warehouse_id: wh, product_id: pid, qty: qty, avg_cost: cost });
    LEDGER.push({ pid: String(pid), qty, moveType, refId: String(refId) });
  },
  _requirePermission: () => null,
  _salesTenantId: (session, payload) => session.tenant_id || (payload && payload.tenantId) || null,
  // จำลอง 26_roles.gs::_adminRoleLabel (ไม่โหลดทั้งไฟล์ — ไฟล์นี้ต้องมีแค่ _withDocLock กับ 34_sales_status.gs เอง)
  _adminRoleLabel: session => 'แอดมิน (' + (session && session.role_code || '') + ')',
  centralObjects: name => (name === 'products'
    ? [{ record_id: 101, name: 'น้ำยาล้างจาน' }, { record_id: 102, name: 'ผงซักฟอก' }] : []),
  // stock_reservations เป็นตารางกลาง (เหมือน warehouse_stock) เก็บใน WH ก้อนเดียวกัน — mock centralAppend/centralNextId/
  // centralSheet ให้เขียนลง WH ตรงๆ (แบบเดียวกับ tenantAppend/tenantNextId/tenantSheet ด้านบนที่เขียนลง t)
  centralNextId: name => { WH[name] = WH[name] || []; return WH[name].reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1; },
  centralAppend: (name, o) => { WH[name] = WH[name] || []; WH[name].push(Object.assign({}, o)); },
  centralSheet: name => {
    const rows = WH[name] || (WH[name] = []);
    const hdr = ['record_id', 'tenant_id', 'warehouse_id', 'product_id', 'qty', 'order_id', 'status', 'created_at', 'released_at'];
    const values = [hdr].concat(rows.map(r => hdr.map(h => (r[h] === undefined ? '' : r[h]))));
    return { getDataRange: () => ({ getValues: () => values }),
      getRange: (row, col) => ({ setValue: v => { rows[row - 2][hdr[col - 1]] = v; } }) };
  }
};
vm.createContext(ctx);
['20_purchasing_master.gs', '34_sales_status.gs'].forEach(f => {
  const src = B(f);
  // 20_purchasing_master มี _withDocLock ที่เราต้องใช้ — โหลดเฉพาะฟังก์ชันนั้นพอ
  if (f === '20_purchasing_master.gs') {
    const m = /function _withDocLock\(fn\) \{[\s\S]*?\n\}/.exec(src);
    vm.runInContext(m[0], ctx, { filename: f });
  } else vm.runInContext(src, ctx, { filename: f });
});

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
const S = { adminUserId: '2', username: 'owner', displayName: 'แอดมินบริษัท', role_code: 'owner_admin', tenant_id: 'T1' };
const row = id => t.sales_orders.find(o => String(o.record_id) === String(id));
const logs = id => t.order_status_log.filter(l => String(l.order_id) === String(id));

console.log('\n── สถานะการเงินตั้งต้นตอนเปิดบิล ──');
eq('ขายสดจากรถ = รับเงินแล้วทันที', ctx.initialPaymentStatus('cash', 'immediate'), 'paid');
eq('ขายเชื่อจากรถ = ยังไม่ชำระ', ctx.initialPaymentStatus('credit', 'immediate'), 'unpaid');
eq('ขายสดแต่ให้ออฟฟิศส่ง = ยังไม่ชำระ (เก็บเงินตอนส่ง)', ctx.initialPaymentStatus('cash', 'office_delivery'), 'unpaid');
eq('บิลเก่าที่ไม่มีคอลัมน์ payment_status → เดาจากวิธีขาย', ctx.orderPaymentStatus(row(3)), 'paid');

console.log('\n── เดินสถานะการส่งของตามลำดับงานจริง ──');
/* ★ 1 ต.ค. 2026 สายงานใหม่: ยืนยัน → รับงาน → พร้อมจัดส่ง → กำลังจัดส่ง → จัดส่งแล้ว
   บิลเก่าที่เป็น `pending_delivery` ถือว่าอยู่ขั้น "ยืนยันแล้ว" เดินต่อได้โดยไม่ต้อง migrate */
fails('ยืนยันแล้ว → กำลังจัดส่ง (ข้ามรับงาน/พร้อมส่ง) ไม่ได้',
  ctx.updateSalesOrderStatus(S, { id: 1, status: 'delivering' }), /ไม่ได้/);
let r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'accepted' });
eq('ยืนยันแล้ว → ศูนย์รับงาน', [r.success, row(1).status], [true, 'accepted']);
eq('  บันทึกประวัติไว้ 1 บรรทัด พร้อมชื่อและตำแหน่งคนเปลี่ยน (guide 1.6)', (() => { const l = logs(1);
  return [l.length, l[0].from_status, l[0].to_status, l[0].changed_by, l[0].changed_by_role]; })(),
  [1, 'pending_delivery', 'accepted', 'แอดมินบริษัท', 'แอดมิน (owner_admin)']);
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'ready_to_ship' });
eq('ศูนย์รับงาน → พร้อมจัดส่ง (จุดตัดสต็อกใหม่)', [r.success, row(1).status], [true, 'ready_to_ship']);
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'delivering' });
eq('พร้อมจัดส่ง → กำลังจัดส่ง', [r.success, row(1).status], [true, 'delivering']);
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'completed' });
eq('กำลังจัดส่ง → จัดส่งแล้ว และประทับเวลาส่ง', [r.success, row(1).status, row(1).delivered_at], [true, 'completed', '2026-09-26 12:00:00']);
eq('  ข้อความที่ตอบกลับบอกสิ่งที่เปลี่ยนจริง', r.message, 'กำลังจัดส่ง → จัดส่งแล้ว');
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'delivering' });
eq('ถอยกลับหนึ่งขั้นได้ (กดผิดเป็นเรื่องปกติ) และล้างเวลาส่งทิ้ง', [r.success, row(1).status, row(1).delivered_at], [true, 'delivering', '']);
fails('ข้ามขั้นจากกำลังจัดส่งกลับไปหาอะไรที่ไม่มีในสาย ไม่ได้', ctx.updateSalesOrderStatus(S, { id: 1, status: 'ส่งแล้วมั้ง' }), /สถานะไม่ถูกต้อง/);
fails('ยกเลิกผ่านทางนี้ไม่ได้ (ต้องคืนสต็อก/หักยอดขาย)', ctx.updateSalesOrderStatus(S, { id: 1, status: 'cancelled' }), /ปุ่มยกเลิก/);
fails('ไม่พบบิล', ctx.updateSalesOrderStatus(S, { id: 999, status: 'completed' }), /ไม่พบบิลขาย/);
fails('ไม่ได้เปลี่ยนอะไรเลย', ctx.updateSalesOrderStatus(S, { id: 1 }), /ไม่มีอะไรเปลี่ยน/);

console.log('\n── บิลที่ยกเลิกแล้ว ──');
t.sales_orders.push({ record_id: 4, order_code: 'SO-X', customer_id: 1, total: 100, payment_method: 'cash',
  fulfillment_type: 'immediate', status: 'cancelled', payment_status: 'unpaid', paid_amount: 0, created_at: '2026-09-26 08:00:00' });
fails('เปลี่ยนสถานะบิลที่ยกเลิกแล้วไม่ได้', ctx.updateSalesOrderStatus(S, { id: 4, status: 'completed' }), /ยกเลิกแล้ว/);

console.log('\n── แกนการเงิน ──');
r = ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 400 });
eq('รับชำระบางส่วน → partial', [r.success, row(1).payment_status, row(1).paid_amount], [true, 'partial', 400]);
r = ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 1000 });
eq('รับครบ → paid และประทับเวลารับเงิน', [row(1).payment_status, row(1).paid_at], ['paid', '2026-09-26 12:00:00']);
fails('รับเกินยอดบิลไม่ได้', ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 1500 }), /มากกว่ายอดบิล/);
fails('ยอดติดลบไม่ได้', ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: -1 }), /ไม่ติดลบ/);
r = ctx.updateSalesOrderStatus(S, { id: 1, paidAmount: 0 });
eq('ล้างการรับชำระกลับเป็น unpaid และล้างเวลารับเงิน', [row(1).payment_status, row(1).paid_amount, row(1).paid_at], ['unpaid', 0, '']);
r = ctx.updateSalesOrderStatus(S, { id: 1, paymentStatus: 'paid' });
eq('กดปุ่ม "รับเงินครบ" → เติมยอดให้เท่ายอดบิลเอง', [row(1).payment_status, row(1).paid_amount], ['paid', 1000]);
fails('สั่ง partial ลอยๆ โดยไม่บอกยอด ไม่ได้', ctx.updateSalesOrderStatus(S, { id: 2, paymentStatus: 'partial' }), /ระบุยอด/);

console.log('\n── เปลี่ยนสองแกนพร้อมกันในครั้งเดียว ──');
const before = logs(1).length;
r = ctx.updateSalesOrderStatus(S, { id: 1, status: 'completed', paidAmount: 0, note: 'ส่งของแล้วแต่ยังไม่ได้เก็บเงิน' });
eq('ส่งของแล้ว + ยังไม่ชำระ', [row(1).status, row(1).payment_status], ['completed', 'unpaid']);
eq('  ประวัติบรรทัดเดียวเก็บทั้งสองแกน พร้อมหมายเหตุ', (() => { const l = logs(1).slice(-1)[0];
  return [logs(1).length - before, l.to_status, l.to_payment, l.note]; })(),
  [1, 'completed', 'unpaid', 'ส่งของแล้วแต่ยังไม่ได้เก็บเงิน']);
eq('ประวัติที่ส่งให้หน้าเว็บมีป้ายภาษาไทยมาแล้ว พร้อมตำแหน่งคนเปลี่ยน', (() => { const h = ctx.orderStatusLog('T1', 1).slice(-1)[0];
  return [h.toLabel, h.toPaymentLabel, h.by, h.byRole]; })(), ['จัดส่งแล้ว', 'ยังไม่ชำระ', 'แอดมินบริษัท', 'แอดมิน (owner_admin)']);

console.log('\n── ป้ายและเส้นทางที่ส่งให้หน้าเว็บ ──');
console.log('\n== จุดตัดสต็อก: office_delivery ตัดตอน "กำลังจัดส่ง" ==');
t.sales_orders.push({ record_id: 10, order_code: 'SO-OD-1', customer_id: 1, total: 900, payment_method: 'credit',
  fulfillment_type: 'office_delivery', status: 'pending_delivery', payment_status: 'unpaid', paid_amount: 0,
  sale_by: 'admin:owner', created_at: '2026-09-27 09:00:00' });
t.order_items = [{ record_id: 1, order_id: 10, product_id: 101, base_qty: 12 },
                 { record_id: 2, order_id: 10, product_id: 102, base_qty: 3 }];
eq('บิลที่ยังรอจัดส่ง ถือว่ายังไม่ได้ตัดของ', ctx.saleStockTaken(row(10)), false);
eq('ยังไม่แตะคลังเลยตอนเปิดบิล', [whQty(101), whQty(102)], [50, 4]);

ctx.updateSalesOrderStatus(S, { id: 10, status: 'accepted' });
eq('ศูนย์รับงาน → กันของไว้ แต่ยังไม่ตัดออกจากคลัง',
  [ctx.saleStockTaken(row(10)), whQty(101), whQty(102)], [false, 50, 4]);
r = ctx.updateSalesOrderStatus(S, { id: 10, status: 'ready_to_ship' });
eq('เข้า "พร้อมจัดส่ง" → ตัดของออกจากคลัง', [r.success, whQty(101), whQty(102)], [true, 38, 1]);
eq('  บอกในข้อความว่าตัดสต็อกแล้ว', /ตัดสต็อกออกจากคลังแล้ว/.test(r.message), true);
eq('  เขียนบัญชีคุมการเคลื่อนไหวเป็นยอดติดลบ', LEDGER.filter(l => l.moveType === 'sale_out').map(l => l.qty), [-12, -3]);
eq('  ตอนนี้ถือว่าของถูกตัดไปแล้ว', ctx.saleStockTaken(row(10)), true);

LEDGER.length = 0;
ctx.updateSalesOrderStatus(S, { id: 10, status: 'delivering' });
r = ctx.updateSalesOrderStatus(S, { id: 10, status: 'completed' });
eq('เดินต่อไปจนจัดส่งแล้ว → ★ ห้ามตัดซ้ำ', [r.success, whQty(101), whQty(102), LEDGER.length], [true, 38, 1, 0]);

r = ctx.updateSalesOrderStatus(S, { id: 10, status: 'delivering' });
eq('ถอยจาก "จัดส่งแล้ว" กลับมา "กำลังจัดส่ง" ก็ไม่ขยับสต็อก (ยังเลยจุดตัดอยู่)', [whQty(101), whQty(102)], [38, 1]);
ctx.updateSalesOrderStatus(S, { id: 10, status: 'ready_to_ship' });   // ยังเลยจุดตัด ยังไม่คืนของ
r = ctx.updateSalesOrderStatus(S, { id: 10, status: 'accepted' });
eq('ถอยกลับก่อนจุดตัด → คืนของเข้าคลังครบ', [r.success, whQty(101), whQty(102)], [true, 50, 4]);
eq('  บอกในข้อความว่าคืนของแล้ว', /คืนของเข้าคลังแล้ว/.test(r.message), true);

console.log('\n== ห้ามข้ามขั้น (ข้ามแล้วของออกโดยไม่มีใครหักยอด) ==');
fails('รับงานแล้ว → จัดส่งแล้ว ตรงๆ ไม่ได้', ctx.updateSalesOrderStatus(S, { id: 10, status: 'completed' }), /ไม่ได้/);
eq('  และสต็อกไม่ถูกแตะ', [whQty(101), whQty(102)], [50, 4]);

console.log('\n== ของในคลังไม่พอ ==');
t.sales_orders.push({ record_id: 11, order_code: 'SO-OD-2', customer_id: 1, total: 100, payment_method: 'cash',
  fulfillment_type: 'office_delivery', status: 'pending_delivery', payment_status: 'unpaid', paid_amount: 0,
  created_at: '2026-09-27 09:30:00' });
t.order_items.push({ record_id: 3, order_id: 11, product_id: 101, base_qty: 5 },
                   { record_id: 4, order_id: 11, product_id: 102, base_qty: 99 });
LEDGER.length = 0;
ctx.updateSalesOrderStatus(S, { id: 11, status: 'accepted' });   // รับงานได้แม้ของไม่พอ (เตือนอย่างเดียว)
r = ctx.updateSalesOrderStatus(S, { id: 11, status: 'ready_to_ship' });
eq('ของไม่พอ → ปฏิเสธ พร้อมบอกว่าตัวไหนขาดเท่าไหร่', [r.success, /ผงซักฟอก \(มี 4 ต้องใช้ 99\)/.test(r.message)], [false, true]);
eq('  ★ ไม่ตัดครึ่งๆ กลางๆ — ตัวที่พอก็ต้องไม่ถูกแตะ', [whQty(101), whQty(102), LEDGER.length], [50, 4, 0]);
eq('  สถานะไม่เปลี่ยนตาม (ค้างที่รับงาน ไม่ได้ไปพร้อมจัดส่ง)', row(11).status, 'accepted');

console.log('\n== ขายจากรถยังตัดตอนบันทึกบิลเหมือนเดิม ==');
eq('บิลขายจากรถถือว่าตัดของแล้วเสมอ ไม่ว่าสถานะอะไร', [
  ctx.saleStockTaken({ fulfillment_type: 'immediate', status: 'completed' }),
  ctx.saleStockTaken({ fulfillment_type: 'immediate', status: 'pending_delivery' })], [true, true]);
eq('คลังของบริษัทขายตรง (HOUSE) = คลังกลาง scope ว่าง', [ctx._saleStockScope('HOUSE'), ctx._saleStockScope('T1')], ['', 'T1']);

eq('อ่านประวัติจากไฟล์ที่ยังไม่มี tab ประวัติ (สคีมาเก่า) → ลิสต์ว่าง ไม่ใช่ error', (() => {
  const keep = t.order_status_log; delete t.order_status_log;     // จำลองไฟล์ตัวแทนที่ยังไม่ได้ migrate
  let out;
  try { out = ctx.orderStatusLog('T1', 1); } catch (e) { out = 'THREW: ' + e.message; }
  t.order_status_log = keep;
  return out;
})(), []);
// สายงานใหม่ 1 ต.ค. 2026: ใหม่ · ยืนยัน(+ชื่อเดิม pending_delivery) · รับงาน · พร้อมจัดส่ง · กำลังจัดส่ง · จัดส่งแล้ว · ปฏิเสธ · ยกเลิก
eq('ป้ายสถานะครบทุกขั้น', Object.keys(ctx.SO_STATUS_LABELS).length, 9);
eq('ชื่อเดิม pending_delivery ยังอยู่และแปลว่า "ยืนยันแล้ว" เหมือนกัน',
  ctx.SO_STATUS_LABELS.pending_delivery, ctx.SO_STATUS_LABELS.confirmed);
eq('จากยืนยันแล้ว ไปได้: รับงาน · ปฏิเสธ · ตีกลับเป็นร่าง · ยกเลิก (ข้ามไปจัดส่งไม่ได้)',
  ctx.SO_TRANSITIONS.pending_delivery, ['accepted', 'rejected', 'draft', 'cancelled']);
eq('ร่างไปได้แค่ยืนยันหรือยกเลิก', ctx.SO_TRANSITIONS.draft, ['confirmed', 'cancelled']);
eq('บิลที่ยกเลิกแล้วไปไหนไม่ได้เลย', ctx.SO_TRANSITIONS.cancelled, []);

console.log('\n── ยอดจอง (reserved) — guide ข้อ 1.3 ──');
WH.warehouse_stock.push({ tenant_id: 'T1', warehouse_id: 'W1', product_id: '201', qty: 50, avg_cost: 5 });
WH.stock_reservations = [];

eq('ยังไม่มีใครจอง → available = on-hand เต็มจำนวน', ctx.getAvailableQty('T1', 'W1', '201'), 50);

let sc = ctx.checkOfficeDeliveryStock('T1', { 201: 30 });
eq('ของพอ (30 จาก 50) → ผ่าน พร้อมบอกคลังที่จะใช้', [sc.success, sc.warehouseId], [true, 'W1']);
ctx.reserveStockForSale('T1', 'W1', { 201: 30 }, 901);
eq('จองแล้วมีแถว active 1 แถว อ้างอิงใบขายถูกต้อง', WH.stock_reservations.map(r => [r.product_id, r.qty, r.order_id, r.status]),
  [['201', 30, 901, 'active']]);
eq('★ available ลดลงตามที่จองไปแล้ว (50 − 30 = 20) — on-hand ไม่ได้ถูกแตะเลย', [ctx.getAvailableQty('T1', 'W1', '201'), whQty(201)], [20, 50]);

console.log('  -- อีกใบหนึ่งมาขอของชิ้นเดียวกันตอนที่ 30 ถูกจองไปแล้ว (สถานการณ์ที่ guide เตือนไว้) --');
// ★ 2026-09-30 เจ้าของระบบสั่ง: office_delivery ของไม่พอ = แค่เตือน ไม่บล็อกการบันทึก (ต่างจากเดิมที่ปฏิเสธทั้งใบ)
// — ยังจองต่อได้แม้เกินของที่มีจริง (ตั้งใจ: เป็นคำมั่นว่าจะส่งของ ยังไม่ต้องมีของครบตอนนี้ อาจกำลังสั่งซื้อเพิ่มอยู่)
sc = ctx.checkOfficeDeliveryStock('T1', { 201: 25 });
eq('ขอ 25 ทั้งที่เหลือขายได้จริงแค่ 20 → ผ่านเสมอ (success:true) แต่มี warning บอกไว้ (ไม่ใช่เอา on-hand 50 มาเทียบ)',
  [sc.success, /ขายได้จริง 20.*ต้องใช้ 25/.test(sc.warning)], [true, true]);
sc = ctx.checkOfficeDeliveryStock('T1', { 201: 20 });
eq('ขอพอดีที่เหลือ (20) → ผ่าน ไม่มี warning', [sc.success, sc.warning], [true, '']);
ctx.reserveStockForSale('T1', 'W1', { 201: 20 }, 902);
eq('จองซ้อนกันได้สองใบ (แถวแยกกัน คนละ order_id)', WH.stock_reservations.filter(r => r.status === 'active').length, 2);
eq('ตอนนี้ available = 0 (จองครบเต็มของที่มี)', ctx.getAvailableQty('T1', 'W1', '201'), 0);

console.log('  -- ยกเลิกใบแรกก่อนถึงจุดตัด → ปลดจอง ไม่แตะ on-hand --');
ctx.releaseStockReservation('T1', 901);
eq('แถวของใบ 901 เปลี่ยนเป็น released พร้อมเวลา · ของใบ 902 ยังไม่ถูกแตะ', [
  WH.stock_reservations.find(r => r.order_id === 901).status,
  !!WH.stock_reservations.find(r => r.order_id === 901).released_at,
  WH.stock_reservations.find(r => r.order_id === 902).status
], ['released', true, 'active']);
eq('ปลดจองแล้ว available กลับมา 30 (50 − 20 ที่ยังจองค้างอยู่) โดย on-hand ไม่ขยับเลย', ctx.getAvailableQty('T1', 'W1', '201'), 30);

console.log('  -- เดินสถานะจริงผ่าน updateSalesOrderStatus: จองไว้ก่อน → ตัดจริงตอนกำลังจัดส่ง → ปลดจองอัตโนมัติ --');
t.sales_orders.push({ record_id: 20, order_code: 'SO-RES-1', customer_id: 1, total: 100, payment_method: 'cash',
  fulfillment_type: 'office_delivery', status: 'pending_delivery', payment_status: 'unpaid', paid_amount: 0, created_at: '2026-09-28 08:00:00' });
t.order_items.push({ order_id: 20, product_id: '201', base_qty: 20 });
// ★ 1 ต.ค. 2026 การจองย้ายมาเกิดตอน "ศูนย์รับงาน" แล้ว ไม่ใช่ตอนเปิดบิล
r = ctx.updateSalesOrderStatus(S, { id: 20, status: 'accepted' });
eq('ศูนย์รับงาน → ระบบกันของให้เอง', [r.success, /กันของในคลังไว้ให้แล้ว/.test(r.message)], [true, true]);
eq('  มีแถวจองของใบนี้', ctx._scoped('stock_reservations', 'T1').filter(x => String(x.order_id) === '20' && x.status === 'active').length, 1);
ctx.updateSalesOrderStatus(S, { id: 20, status: 'ready_to_ship' });
r = ctx.updateSalesOrderStatus(S, { id: 20, status: 'delivering' });
eq('เข้า "กำลังจัดส่ง" สำเร็จ (ของพอเพราะกันไว้ตั้งแต่รับงาน)', r.success, true);
eq('การจองของบิลนี้ถูกปลดแล้ว (ของถูกตัดจริงเข้า warehouse_stock แทน ไม่ถูกนับซ้ำสองทาง)',
  WH.stock_reservations.filter(r2 => r2.order_id === 20 && r2.status === 'active').length, 0);
eq('ถอยกลับมา "รอจัดส่ง" → คืนของเข้าคลัง และจองกันของไว้ใหม่ให้บิลเดิม (ยังเป็นคำมั่นกับลูกค้าอยู่)', (() => {
  // สายใหม่: ถอยจากกำลังจัดส่งต้องผ่านพร้อมจัดส่งก่อน แล้วค่อยกลับไป "รับงาน" ซึ่งเป็นขั้นที่กันของไว้
  ctx.updateSalesOrderStatus(S, { id: 20, status: 'ready_to_ship' });
  const back = ctx.updateSalesOrderStatus(S, { id: 20, status: 'accepted' });
  const active = WH.stock_reservations.filter(r2 => r2.order_id === 20 && r2.status === 'active');
  return [back.success, active.length, active[0] && active[0].qty];
})(), [true, 1, 20]);


/* ── ฝั่งมือถือ: ยืนยัน / ยกเลิกใบของตัวเอง (1 ต.ค. 2026) ── */
console.log('\n== มือถือยืนยัน/ยกเลิกใบของตัวเอง ==');
ctx.bumpSalesDaily = ctx.bumpSalesDaily || function(){};
ctx._mobileRoleLabel = ctx._mobileRoleLabel || function(r){ return String(r || ''); };
const U1 = { tenantId: 'T1', lineUserId: 'U-SALES-1', displayName: 'เซลส์ เอ', role: 'credit_sales' };
t.sales_orders.push({ record_id: 30, order_code: 'SO-M-1', customer_id: 1, total: 900, payment_method: 'credit_term',
  fulfillment_type: 'office_delivery', status: 'draft', payment_status: 'unpaid', paid_amount: 0,
  sale_by: 'U-SALES-1', created_at: '2026-10-01 09:00:00' });
t.sales_orders.push({ record_id: 31, order_code: 'SO-M-2', customer_id: 1, total: 500, payment_method: 'credit_term',
  fulfillment_type: 'office_delivery', status: 'accepted', payment_status: 'unpaid', paid_amount: 0,
  sale_by: 'U-SALES-1', created_at: '2026-10-01 09:10:00' });

let m = ctx.confirmSalesOrder(U1, { orderCode: 'SO-M-1' });
eq('ร่าง → กดยืนยันได้', [m.success, row(30).status], [true, 'confirmed']);
eq('  กดยืนยันซ้ำ ตอบว่าทำไปแล้ว ไม่ใช่ error', ctx.confirmSalesOrder(U1, { orderCode: 'SO-M-1' }).alreadyDone, true);
fails('ใบที่ศูนย์รับงานแล้ว ยืนยันไม่ได้', ctx.confirmSalesOrder(U1, { orderCode: 'SO-M-2' }), /ยืนยันซ้ำไม่ได้/);
fails('★ ใบของคนอื่น แตะไม่ได้แม้อยู่ตัวแทนเดียวกัน',
  ctx.confirmSalesOrder({ tenantId: 'T1', lineUserId: 'U-OTHER' }, { orderCode: 'SO-M-1' }), /ไม่ใช่บิลของท่าน/);

m = ctx.cancelMySalesOrder(U1, { orderCode: 'SO-M-1', reason: 'ลูกค้าเปลี่ยนใจ' });
eq('ยืนยันแล้วแต่ศูนย์ยังไม่รับงาน → ยกเลิกเองได้', [m.success, row(30).status], [true, 'cancelled']);
fails('★ ศูนย์รับงานแล้ว ยกเลิกเองไม่ได้ ต้องแจ้งศูนย์',
  ctx.cancelMySalesOrder(U1, { orderCode: 'SO-M-2' }), /แจ้งศูนย์/);
t.sales_orders.push({ record_id: 32, order_code: 'SO-M-3', customer_id: 1, total: 100, payment_method: 'cash',
  fulfillment_type: 'immediate', status: 'completed', sale_by: 'U-SALES-1', created_at: '2026-10-01 09:20:00' });
fails('บิลขายจากรถยกเลิกเองไม่ได้ (ของออกจากรถไปแล้ว)',
  ctx.cancelMySalesOrder(U1, { orderCode: 'SO-M-3' }), /แจ้งศูนย์/);

/* ── แอดมินศูนย์แก้ไขรายการในใบที่รับงานแล้ว (3 ต.ค. 2026) ── */
console.log('\n== editSalesOrderAdmin: แก้รายการ/วันนัดส่งหลังรับงาน ==');
const origSheet = ctx.tenantSheet;
ctx.tenantSheet = (tid, n) => Object.assign(origSheet(tid, n), { __n: n });
ctx.deleteRowsWhere = (sh, col, val) => { const rows = sheetOf(sh.__n); for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i][col]) === String(val)) rows.splice(i, 1); };
ctx._round2 = n => Math.round(n * 100) / 100;
ctx._dOnly = v => String(v || '').substring(0, 10);
ctx.isFlagOn = v => v === true || String(v).toUpperCase() === 'TRUE';
ctx.centralUpdate = () => true;
ctx.centralInvalidate = () => {};
const DAILY = [];
ctx.bumpSalesDaily = (tid, d, b, r2) => DAILY.push([d, b, r2]);
ctx._customerInTenant = id => (String(id) === '1' ? { record_id: 1 } : null);
// ราคาจำลอง: 100 ต่อหน่วย · ลัง = 12 หน่วยฐาน (ของจริงอยู่ที่ 07_sales.gs/_priceSaleCart มีเทสต์ของตัวเองแล้ว)
ctx._priceSaleCart = (cust, raw, pay, isVan) => {
  if (raw.some(i => String(i.productId) === '999')) return { success: false, message: 'สินค้านี้ไม่อยู่ในชุดราคา' };
  const items = raw.map(i => ({ productId: String(i.productId), unitCode: i.unitCode, unitFactor: 12, qty: i.qty, baseQty: i.qty * 12, price: 100, lineTotal: 100 * i.qty }));
  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  return { success: true, items, calc: { subtotal: total, discount: 0, total, freeGoods: [], appliedRules: [],
    vat: { applyVat: true, vatType: 'inclusive', rate: 0.07, exVat: Math.round(total / 1.07 * 100) / 100, vat: 0, exemptAmount: 0, taxOf: () => 'vat' } } };
};
t.sales_orders.push({ record_id: 40, order_code: 'SO-ED-1', customer_id: 1, total: 800, payment_method: 'credit_term',
  fulfillment_type: 'office_delivery', status: 'accepted', payment_status: 'unpaid', paid_amount: 0,
  sale_by: 'U-SALES-1', created_at: '2026-10-01 09:00:00', requested_delivery_date: '2026-10-05' });
t.sales_orders.push({ record_id: 41, order_code: 'SO-ED-2', customer_id: 1, total: 300, payment_method: 'cash',
  fulfillment_type: 'office_delivery', status: 'accepted', payment_status: 'partial', paid_amount: 100, created_at: '2026-10-01 09:05:00' });
t.order_items.push({ record_id: 400, order_id: 40, product_id: '101', qty: 2, unit_code: 'CT', base_qty: 24, is_free: 0 });
ctx.reserveStockForSale('T1', 'W1', { '101': 24 }, 40);
const resOf = oid => WH.stock_reservations.filter(x => String(x.order_id) === String(oid) && x.status === 'active').map(x => [String(x.product_id), x.qty]);
eq('ตั้งต้น: ใบ 40 จองของ 101 ไว้ 24 หน่วยฐาน', resOf(40), [['101', 24]]);

fails('ใบที่ยังไม่อยู่ขั้น "บันทึกรับงานแล้ว" แก้ไม่ได้', ctx.editSalesOrderAdmin(S, { id: 2, items: [{ productId: '101', unitCode: 'CT', qty: 1 }] }), /เฉพาะใบที่/);
fails('ใบที่รับชำระแล้วแก้ไม่ได้', ctx.editSalesOrderAdmin(S, { id: 41, items: [{ productId: '101', unitCode: 'CT', qty: 1 }] }), /รับชำระเงินแล้ว/);
fails('ไม่มีรายการ → ปฏิเสธ', ctx.editSalesOrderAdmin(S, { id: 40, items: [] }), /อย่างน้อย 1/);
fails('วันนัดส่งรูปแบบผิด → ปฏิเสธ', ctx.editSalesOrderAdmin(S, { id: 40, items: [{ productId: '101', unitCode: 'CT', qty: 1 }], requestedDeliveryDate: '5/10/2026' }), /yyyy-MM-dd/);
fails('สินค้าที่ไม่อยู่ในชุดราคา → ปฏิเสธ (ผ่านเครื่องคิดราคาตัวเดียวกับตอนเปิดบิล) และไม่แตะอะไรเลย',
  ctx.editSalesOrderAdmin(S, { id: 40, items: [{ productId: '999', unitCode: 'CT', qty: 1 }] }), /ชุดราคา/);
eq('  ปฏิเสธแล้วของเดิมยังอยู่ครบ (บรรทัด/ยอดจอง/ยอดบิล)', [t.order_items.filter(i => i.order_id === 40).length, resOf(40), row(40).total], [1, [['101', 24]], 800]);

let e = ctx.editSalesOrderAdmin(S, { id: 40, items: [{ productId: '102', unitCode: 'CT', qty: 3 }, { productId: '101', unitCode: 'CT', qty: 1 }], requestedDeliveryDate: '2026-10-09' });
eq('แก้ได้: เปลี่ยนรหัสสินค้า/จำนวน/วันนัดส่ง แล้วคิดราคาใหม่ (4 ลัง × 100)', [e.success, e.total, e.previousTotal], [true, 400, 800]);
eq('  บรรทัดบิลถูกแทนที่ทั้งชุด (ไม่ใช่พ่วง)', t.order_items.filter(i => i.order_id === 40).map(i => [i.product_id, i.qty, i.base_qty]).sort(), [['101', 1, 12], ['102', 3, 36]]);
eq('  ยอดจองเดิมถูกปลด · จองใหม่ตามรายการใหม่ (หน่วยฐาน)', resOf(40).sort(), [['101', 12], ['102', 36]]);
eq('  เลขที่เอกสาร/สถานะคงเดิม · วันนัดส่งใหม่ · ยอดบิลใหม่', [row(40).order_code, row(40).status, row(40).requested_delivery_date, row(40).total], ['SO-ED-1', 'accepted', '2026-10-09', 400]);
eq('  ติดธง "ศูนย์แก้ไขแล้ว" (ชื่อผู้แก้ + เวลา)', [row(40).center_edited_by, row(40).center_edited_at], ['แอดมินบริษัท', '2026-09-26 12:00:00']);
eq('  ยอดขายรายวัน: ขยับเฉพาะส่วนต่าง (−400) ที่วันที่เปิดบิล ไม่นับจำนวนใบเพิ่ม', DAILY[DAILY.length - 1], ['2026-10-01', 0, -400]);
eq('  ประวัติสถานะ: สถานะเดิม→เดิม พร้อมสรุปก่อน-หลัง', (() => { const l = logs(40).pop(); return [l.from_status, l.to_status, /ศูนย์แก้ไขรายการ/.test(l.note), /101×2 CT/.test(l.note), /102×3 CT/.test(l.note), /วันนัดส่ง 2026-10-09/.test(l.note)]; })(),
  ['accepted', 'accepted', true, true, true, true]);
e = ctx.editSalesOrderAdmin(S, { id: 40, items: [{ productId: '101', unitCode: 'CT', qty: 1 }], requestedDeliveryDate: '' });
eq('ส่งวันนัดว่าง = ล้างวันนัด · ไม่ส่ง = ไม่แตะ', [e.success, row(40).requested_delivery_date], [true, '']);
e = ctx.editSalesOrderAdmin(S, { id: 40, items: [{ productId: '101', unitCode: 'CT', qty: 2 }] });
eq('  (ไม่ส่งวันนัดมา → วันนัดเดิมไม่ถูกแตะ)', [e.success, row(40).requested_delivery_date], [true, '']);

console.log('\n── ★ ใบส่งสินค้ามีเลขของตัวเอง ออกตอน "พร้อมจัดส่ง" (แอดมินขอ 6 ต.ค. 2026) ──');
{
  // ใบใหม่ office_delivery เดินถึง "พร้อมจัดส่ง"
  t.sales_orders.push({ record_id: 50, order_code: 'SO-50', customer_id: 1, total: 100,
    payment_method: 'credit_term', fulfillment_type: 'office_delivery', status: 'accepted',
    payment_status: 'unpaid', paid_amount: 0, created_at: '2026-09-26 09:00:00' });
  t.order_items.push({ record_id: 500, order_id: 50, product_id: '101', unit_code: 'CT', qty: 1, base_qty: 1 });

  eq('ก่อนถึงพร้อมจัดส่ง ยังไม่มีเลขใบส่งของ', !row(50).delivery_order_no, true);

  const before = ctx.docNoCalls;
  let d = ctx.updateSalesOrderStatus(S, { id: 50, status: 'ready_to_ship' });
  eq('เข้าสถานะพร้อมจัดส่ง → ได้เลขใบส่งของ', [d.success, /^DO-/.test(row(50).delivery_order_no || '')], [true, true]);
  eq('  ตอบกลับหน้าจอพร้อมเลขเลย ไม่ต้องโหลดใหม่', d.deliveryOrderNo, row(50).delivery_order_no);
  eq('  ติดเวลาที่ออกเลขไว้ด้วย', !!row(50).delivery_order_at, true);
  eq('  เรียกตัวออกเลขครั้งเดียว', ctx.docNoCalls - before, 1);

  const issued = row(50).delivery_order_no;
  // ★ ถอยกลับแล้วเดินหน้าใหม่ — ใบที่พิมพ์ส่งไปกับรถแล้วต้องยังอ้างเลขเดิมได้
  ctx.updateSalesOrderStatus(S, { id: 50, status: 'accepted' });
  const mid = ctx.docNoCalls;
  ctx.updateSalesOrderStatus(S, { id: 50, status: 'ready_to_ship' });
  eq('★★ ถอยกลับแล้วเดินหน้าใหม่ ต้องได้เลขเดิม ไม่ใช่เลขใหม่', row(50).delivery_order_no, issued);
  eq('  และต้องไม่กินตัวนับเลขเอกสารเพิ่ม', ctx.docNoCalls - mid, 0);

  // เดินต่อไปสถานะถัดๆ ไปก็ไม่ออกเลขใหม่
  const mid2 = ctx.docNoCalls;
  ctx.updateSalesOrderStatus(S, { id: 50, status: 'delivering' });
  ctx.updateSalesOrderStatus(S, { id: 50, status: 'completed' });
  eq('  เดินต่อจนจัดส่งแล้ว ก็ยังเป็นเลขเดิมและไม่ออกใหม่',
    [row(50).delivery_order_no, ctx.docNoCalls - mid2], [issued, 0]);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
