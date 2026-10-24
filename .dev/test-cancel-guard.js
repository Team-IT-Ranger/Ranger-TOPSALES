// รัน: node .dev/test-cancel-guard.js
// ด่านกั้น "ออกใบแจ้งหนี้/ใบกำกับภาษีแล้ว ห้ามยกเลิกบิลขาย ให้ออกใบลดหนี้แทน" (เจ้าของระบบสั่ง 22 ต.ค. 2026)
// ★ เป็นกติกาเรื่องเงินและภาษี — ของเดิมยกเลิกได้เงียบๆ แล้วใบแจ้งหนี้ค้างเปิดอยู่ในระบบลูกหนี้
//   (รายงานยังทวงเงินลูกค้า ภาษีขายยังอยู่ในสมุด) โดยไม่มีอะไรฟ้องเลย
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  ar_invoices: [
    { record_id: 101, invoice_no: 'INV-BDC-0001', tenant_id: 'BDC', sales_order_id: 7, status: 'open' },
    { record_id: 102, invoice_no: 'INV-BDC-0002', tenant_id: 'BDC', sales_order_id: 8, status: 'void' },
    { record_id: 103, invoice_no: 'INV-BDC-0003', tenant_id: 'BDC', sales_order_id: 9, status: 'voided' },
    // ★ บิลคนละตัวแทนที่ record_id ชนกัน — record_id ไม่ซ้ำข้ามไฟล์ตัวแทน ต้องเทียบ tenant_id ด้วยเสมอ
    { record_id: 104, invoice_no: 'INV-NKN-0009', tenant_id: 'NKN', sales_order_id: 5, status: 'open' }
  ]
};
// บิลในไฟล์ของตัวแทน (tenantRowById)
const orders = {
  5: { record_id: 5, order_code: 'SO-5', status: 'ready_to_ship', fulfillment_type: 'office_delivery', total: 1000, created_at: '2026-10-22 09:00:00' },
  7: { record_id: 7, order_code: 'SO-7', status: 'ready_to_ship', fulfillment_type: 'office_delivery', total: 2000, created_at: '2026-10-22 09:00:00' },
  8: { record_id: 8, order_code: 'SO-8', status: 'ready_to_ship', fulfillment_type: 'office_delivery', total: 3000, created_at: '2026-10-22 09:00:00' },
  9: { record_id: 9, order_code: 'SO-9', status: 'ready_to_ship', fulfillment_type: 'office_delivery', total: 4000, created_at: '2026-10-22 09:00:00' },
  11: { record_id: 11, order_code: 'SO-11', status: 'completed', fulfillment_type: 'immediate', total: 500, sale_by: 'U1',
        tax_invoice_no: 'TAX-BDC-0007', created_at: '2026-10-22 09:00:00' },
  12: { record_id: 12, order_code: 'SO-12', status: 'draft', fulfillment_type: 'office_delivery', total: 900, created_at: '2026-10-22 09:00:00' }
};

const log = [];
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '2026-10-22' },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  centralObjects: n => (sheets[n] || []).map(o => Object.assign({}, o)),
  // ── ทุกตัวข้างล่างคือ "ของที่จะถูกแตะถ้าด่านไม่กั้น" — เทสต์จึงจับได้ว่าด่านปล่อยผ่านจริงหรือไม่ ──
  tenantRowById: (t, sheet, id) => orders[String(id)] ? Object.assign({}, orders[String(id)]) : null,
  // รายการสินค้าในบิล — ต้องมีของจริง ไม่งั้นทางคืนของขึ้นรถคำนวณได้ของเปล่าแล้วข้ามไปเงียบๆ
  tenantObjects: (t, sheet) => (sheet === 'order_items'
    ? Object.keys(orders).map(k => ({ order_id: orders[k].record_id, product_id: 'P1', base_qty: 10 }))
    : []),
  /* ชีตบิลจำลองเป็นตาราง 2 มิติจริง — โค้ดยกเลิกเขียนสถานะด้วย getRange().setValue() แบบดิบ */
  tenantSheet: () => {
    const head = ['record_id', 'status', 'updated_at', 'updated_by'];
    const rows = Object.keys(orders).map(k => [orders[k].record_id, orders[k].status, '', '']);
    return {
      getDataRange: () => ({ getValues: () => [head].concat(rows) }),
      getRange: (r, c) => ({ setValue: v => { const id = String(rows[r - 2][0]); if (c === 2) { orders[id].status = v; log.push('status:' + id + ':' + v); } } })
    };
  },
  tenantUpdate: (t, sheet, id, f) => { Object.assign(orders[String(id)], f); log.push('update:' + id); },
  /* ★ คัดลอกกติกาจุดตัดสต็อกตัวจริงมา (34_sales_status.gs) ไม่ใช่คืนค่าคงที่ —
     ถ้าคืน false ไว้เฉยๆ ทางคืนของจะไม่ถูกรันเลย แล้วเทสต์จะบอกว่า "ไม่แตะอะไร" ผ่านทั้งที่ด่านไม่ได้ทำงาน */
  saleStockTaken: o => String(o.fulfillment_type) === 'immediate' ||
    ['ready_to_ship', 'delivering', 'completed'].indexOf(String(o.status)) >= 0,
  releaseStockReservation: (t, id) => log.push('release:' + id),
  applySaleWarehouseStock: () => ({ success: true }),
  _cutVanStock: (t, u, need, id) => log.push('vanback:' + id),
  reverseVanSaleCogs: () => log.push('cogsrev'),
  reverseCashSaleGl: () => ({ success: true }),
  cacheClearUser: () => {},
  saleOrderHasRounds: () => false,
  saleDeliveryPlan: () => ({ lines: [] }),
  /* ★ ยอดสรุปรายวันเก็บทั้งยอดรวมภาษีและยอดก่อนภาษี (31_sales_rollup.gs) — ยกเลิกบิลต้องหักคืนทั้งคู่
     บันทึกทั้งสองค่าไว้ใน log เพื่อให้เทสต์จับได้ถ้าวันหนึ่งมีใครลืมส่งตัวที่สอง */
  bumpSalesDaily: (t, d, b, amt, ex) => log.push('daily:' + b + ':' + amt + ':' + ex),
  orderExVat: o => Math.round((Number(o.total) || 0) / 1.07 * 100) / 100,
  logOrderStatus: (t, id, from, to, p1, p2, note) => log.push('log:' + id + ':' + to),
  orderPaymentStatus: () => 'unpaid',
  _dOnly: v => String(v).substring(0, 10),
  _adminRoleLabel: () => 'ผู้ดูแล',
  ensureTenantSheetsCurrent: () => {},
  _withDocLock: fn => fn(),
  _requirePermission: () => null,
  _salesTenantId: (s, p) => (p && p.tenantId) || 'BDC',
  _soReachedReady: () => true
};
/* ★ ต้องเอา stub กลับมาทับ **หลัง** โหลดไฟล์ backend เสมอ — `02_helpers.gs` ประกาศ centralObjects /
   tenantRowById / tenantSheet ตัวจริงทับ stub (บทเรียนเดิมที่เขียนไว้ใน CLAUDE.md หัวข้อ test-owner-tenant) */
const MOCKS = Object.assign({}, ctx);
vm.createContext(ctx);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
vm.runInContext(B('19_sales_admin.gs'), ctx, { filename: '19_sales_admin.gs' });
Object.keys(MOCKS).forEach(k => { if (typeof MOCKS[k] === 'function' && k !== 'require') ctx[k] = MOCKS[k]; });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '\n   got ' + JSON.stringify(extra)));
  if (!cond) failed++;
};
const cancel = (id, tenant) => { log.length = 0; return ctx._cancelSalesOrderCore({ adminUserId: '1', displayName: 'ผู้ทดสอบ' }, { id: id }, tenant || 'BDC'); };

console.log('-- ★★ ออกใบแจ้งหนี้แล้ว = ยกเลิกไม่ได้ --');
let r = cancel(7);
eq('ปฏิเสธ', r.success, false);
ok('บอกเลขใบแจ้งหนี้ที่ขวางอยู่', /INV-BDC-0001/.test(r.message), r.message);
ok('บอกทางออกว่าให้ออกใบลดหนี้', /ใบลดหนี้/.test(r.message), r.message);
eq('ติดธงให้หน้าจอพาไปออกใบลดหนี้ได้', [r.needCreditNote, r.invoiceId], [true, '101']);
eq('★ ไม่แตะอะไรเลยสักอย่าง (ไม่คืนของ ไม่หักยอดขาย ไม่เขียนประวัติ)', log, []);

console.log('\n-- ใบแจ้งหนี้ที่ถูกยกเลิกไปแล้ว ไม่ขวาง --');
r = cancel(8);
eq("status 'void' → ยกเลิกบิลได้", r.success, true);
ok('และทำงานครบ (หักยอดขาย + เขียนประวัติ)', log.some(x => x.startsWith('daily:')) && log.some(x => x.startsWith('log:')), log);
/* ★★ ต้องหักคืน **ทั้งสองยอด**: ยอดรวมภาษี (ยอดบนเอกสาร) และยอดขายก่อนภาษี (ตัวที่แดชบอร์ดโชว์)
   ลืมตัวที่สอง = ยอดขายก่อนภาษีบนแดชบอร์ดค้างสูงกว่าความจริงไปเรื่อยๆ ทุกครั้งที่มีคนยกเลิกบิล
   และไม่มีอะไรฟ้อง เพราะยอดรวมภาษียังถูก */
ok('★★ หักคืนทั้งยอดรวมภาษีและยอดก่อนภาษี',
  log.some(x => /^daily:-1:-\d/.test(x) && x.split(':')[3] && Number(x.split(':')[3]) < 0), log);
eq("status 'voided' (อีกสะกดหนึ่งที่ปนอยู่ในระบบ) → ยกเลิกได้เหมือนกัน", cancel(9).success, true);

console.log('\n-- ★ เทียบตัวแทนด้วย ไม่ใช่เทียบแค่เลขบิล --');
r = cancel(5, 'BDC');
eq('บิลเลข 5 ของ BDC ไม่มีใบแจ้งหนี้ → ยกเลิกได้ (ใบ INV-NKN-0009 เป็นของ NKN)', r.success, true);
r = cancel(5, 'NKN');
eq('บิลเลข 5 ของ NKN มีใบแจ้งหนี้ → ถูกกั้น', r.success, false);

console.log('\n-- ขายสดที่ออกใบกำกับภาษีแล้ว: ยกเลิกได้ แต่ต้องเตือน --');
r = cancel(11);
eq('★ ไม่ถูกกั้น เพราะไม่มีใบแจ้งหนี้ลูกหนี้ให้ลดหนี้ (กั้นแล้วจะกลายเป็นทางตัน)', r.success, true);
ok('เตือนให้เก็บต้นฉบับใบกำกับภาษีคืน', /TAX-BDC-0007/.test(r.warning || '') && /เก็บต้นฉบับคืน/.test(r.warning || ''), r.warning);
ok('ของกลับขึ้นรถให้ด้วย', log.some(x => x === 'vanback:11'), log);

console.log('\n-- บิลปกติที่ยังไม่ออกใบอะไรเลย --');
r = cancel(12);
eq('ยกเลิกได้', r.success, true);
eq('ไม่มีคำเตือนให้รก', r.warning, undefined);
ok('ปลดของที่จองไว้', log.some(x => x === 'release:12'), log);

console.log('\n-- บิลที่ยกเลิกไปแล้ว --');
orders['12'].status = 'cancelled';
ok('ยกเลิกซ้ำไม่ได้', cancel(12).success === false, 'cancel twice');

console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
