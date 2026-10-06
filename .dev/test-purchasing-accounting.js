// รัน: node .dev/test-purchasing-accounting.js
// ทดสอบงานซื้อ (ใบขอซื้อ → อนุมัติ → ใบสั่งซื้อ → รับของเข้าคลัง) และบัญชี (แยกประเภท/เจ้าหนี้/ลูกหนี้)
// กับชีตจำลองในหน่วยความจำ ไม่ยิงเน็ต — ตรวจทั้งกติกาทางธุรกิจและความถูกต้องของการลงบัญชี (เดบิต=เครดิตเสมอ)
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

// หัวคอลัมน์จริงจาก 00_setup_sheets.gs (ไม่ก๊อปมาไว้ซ้ำ จะได้ไม่หลุดกันเวลาสคีมาเปลี่ยน)
const CENTRAL_SHEETS = (() => {
  const c = { Utilities: {}, Session: {}, PropertiesService: {}, LockService: {}, SpreadsheetApp: {}, Logger: { log() {} } };
  vm.createContext(c);
  vm.runInContext(B('00_setup_sheets.gs') + '\nthis.__S = CENTRAL_SHEETS;', c);
  return c.__S;
})();

class FakeSheet {
  constructor(headers) { this.rows = [headers.slice()]; }
  getDataRange() { return { getValues: () => this.rows.map(r => r.slice()) }; }
  getRange(row, col) { const sh = this; return { setValue(v) { while (sh.rows[row - 1].length < col) sh.rows[row - 1].push(''); sh.rows[row - 1][col - 1] = v; } }; }
  deleteRow(n) { this.rows.splice(n - 1, 1); }
  deleteRows(n, count) { this.rows.splice(n - 1, count); }
  getLastRow() { return this.rows.length; }
  appendRow(r) { this.rows.push(r.slice()); }
}
const sheets = {}, tenantSheets = {};
Object.keys(CENTRAL_SHEETS).forEach(n => { sheets[n] = new FakeSheet(CENTRAL_SHEETS[n]); });
const TENANT_COLS = {
  sales_orders: ['record_id','order_code','customer_id','subtotal','discount','total','payment_method','fulfillment_type','status','sale_by','lat','lng','map','note','created_at'],
  order_items: ['record_id','order_id','product_id','unit_code','unit_factor','qty','base_qty','price','line_total','is_free','tax_status'],
  /* ★ 1 ต.ค. 2026 — เลขเอกสารกลางอ่านรูปแบบจาก doc_number_series แล้ว (ดู _nextCentralDocNo)
     ปล่อยว่างไว้ตั้งใจ: จะได้ทดสอบว่า "ไม่เคยตั้งค่า → เลขออกมาเหมือนเดิมทุกตัวอักษร"
     ซึ่งเป็นสิ่งที่ต้องไม่พังที่สุดของการเปลี่ยนรอบนี้ */
  doc_number_series: ['record_id','doc_type','prefix','date_format','running_digits','reset_cycle','separator','is_active']
};
Object.keys(TENANT_COLS).forEach(n => { tenantSheets[n] = new FakeSheet(TENANT_COLS[n]); });

const objs = sh => sh.rows.slice(1).filter(r => r[0] !== '' && r[0] != null).map(r => Object.fromEntries(sh.rows[0].map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
const append = (sh, o) => sh.rows.push(sh.rows[0].map(h => (o[h] !== undefined ? o[h] : '')));
const pad = (n, w) => String(n).padStart(w, '0');
let CLOCK = new Date('2026-09-23T10:00:00Z'), lockHeld = false;

/* ★ นาฬิกาในกล่องทดสอบต้องหยุดนิ่งที่ CLOCK (1 ต.ค. 2026)
   เดิมส่ง `Date` ตัวจริงเข้า vm แล้ว `nowStr()` เท่านั้นที่ใช้ CLOCK — แต่ `_nextCentralDocNo()`
   (`20_purchasing_master.gs`) เรียก `new Date()` เอาเดือน**ปัจจุบันจริง** มาทำเลขที่เอกสาร
   เทสต์จึงคาด `PR-202609-0001` ไว้ตายตัว แล้ว **พังเองตอนเที่ยงคืนวันขึ้นเดือนใหม่** (ได้ 202610)
   ไม่ใช่โค้ดผลิตพัง — เป็นเทสต์ที่ผูกกับวันที่รันโดยไม่ได้ตั้งใจ และจะพังซ้ำทุกเดือนถ้าไม่หยุดนาฬิกา
   `new Date(x)` ที่ส่งค่ามาด้วยยังทำงานตามปกติ (formatDate ใช้ทางนั้น) */
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor() { super(...(arguments.length ? arguments : [CLOCK.getTime()])); }
  static now() { return CLOCK.getTime(); }
}

const ctx = {
  console, JSON, Math, String, Number, Object, Array, Date: FrozenDate, isFinite, parseInt, parseFloat, RegExp,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const D = new Date(d);
      const map = { yyyy: D.getUTCFullYear(), MM: pad(D.getUTCMonth() + 1, 2), dd: pad(D.getUTCDate(), 2), HH: pad(D.getUTCHours(), 2), mm: pad(D.getUTCMinutes(), 2), ss: pad(D.getUTCSeconds(), 2) };
      return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
    }
  },
  LockService: { getScriptLock: () => ({ tryLock() { if (lockHeld) return false; lockHeld = true; return true; }, releaseLock() { lockHeld = false; } }) },
  centralSheet: n => { if (!sheets[n]) throw new Error('ไม่รู้จักชีต ' + n); return sheets[n]; },
  centralObjects: n => objs(ctx.centralSheet(n)),
  centralAppend: (n, o) => append(ctx.centralSheet(n), o),
  centralAppendMany: (n, os) => { os.forEach(o => append(ctx.centralSheet(n), o)); return os.length; },
  centralNextId: n => objs(ctx.centralSheet(n)).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  centralUpdate: (n, id, f) => { const sh = ctx.centralSheet(n), r = sh.rows.find((x, i) => i && String(x[0]) === String(id)); if (!r) return false; Object.keys(f).forEach(k => { const c = sh.rows[0].indexOf(k); if (c >= 0) { while (r.length <= c) r.push(''); r[c] = f[k]; } }); return true; },
  deleteRowsWhere: (sh, col, v) => { const c = sh.rows[0].indexOf(col); let n = 0; for (let i = sh.rows.length - 1; i >= 1; i--) if (String(sh.rows[i][c]) === String(v)) { sh.rows.splice(i, 1); n++; } return n; },
  tenantObjects: (t, n) => objs(tenantSheets[n]),
  // สมุดของบริษัทเอง — _nextCentralDocNo ใช้หาว่าจะอ่านรูปแบบเลขจากไฟล์ไหนเมื่อเอกสารเป็นของบริษัท
  _ensureHouseTenant: () => 'TNKI',
  nowStr: () => ctx.Utilities.formatDate(CLOCK, 'tz', 'yyyy-MM-dd HH:mm:ss'),
  safeDateStr: v => String(v || ''),
  _requirePermission: (s, m, a) => (s.perms === 'none' ? { success: false, message: 'ไม่มีสิทธิ์ (' + m + ')' } : (a === 'edit' && s.readOnly ? { success: false, message: 'ไม่มีสิทธิ์แก้ไข' } : null)),
  _salesTenantId: (s, p) => (p && p.tenantId) || 'T1',
  // เหมือน _effectiveTenantId ใน 14_permissions.gs: ตัวแทนใช้ของตัวเอง · ฝั่งบริษัทสวมสิทธิ์ตัวแทนได้ด้วย payload.tenantId
  _effectiveTenantId: (s, p) => s.tenant_id || ((s.role_code === 'super_admin' || s.role_code === 'owner_admin') && p && p.tenantId ? String(p.tenantId) : null),
  isCreditPayment: c => { c = String(c || '').toLowerCase(); return c === 'credit_term' || c === 'credit'; }
};
vm.createContext(ctx);
// โหลด 02_helpers.gs ของจริงก่อน (มี isFlagOn/isNotOff ที่โมดูลอื่นเรียกใช้) แล้วคืนค่าชีตจำลองทับ
const _fakes = { centralSheet: ctx.centralSheet, centralObjects: ctx.centralObjects, centralAppend: ctx.centralAppend,
  centralAppendMany: ctx.centralAppendMany, centralNextId: ctx.centralNextId, centralUpdate: ctx.centralUpdate,
  deleteRowsWhere: ctx.deleteRowsWhere, tenantObjects: ctx.tenantObjects, nowStr: ctx.nowStr, safeDateStr: ctx.safeDateStr };
ctx.SpreadsheetApp = { openById: () => { throw new Error('should not be called'); } };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '' }) };
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', '02_helpers.gs'), 'utf8'), ctx, { filename: '02_helpers.gs' });
Object.keys(_fakes).forEach(k => { if (_fakes[k]) ctx[k] = _fakes[k]; });
// 34_sales_status.gs โหลดมาเพื่อ _reservedQty()/getAvailableQty() ที่ listWarehouseStock (22_purchase_order.gs) เรียกใช้
// (ยอดจอง — guide ข้อ 1.3) ไม่ได้ทดสอบสถานะบิลขายจากไฟล์นี้โดยตรง (ดู .dev/test-sales-status.js)
// 41_sales_reports.gs โหลดมาเพื่อทดสอบรายงานการขาย 1.8.1/1.8.2/1.8.3 (ต่อท้ายไฟล์นี้ — อ่านอย่างเดียว ไม่แตะสถานะอื่น)
// 12_docnum.gs ถูกโหลดด้วยเพราะ _nextCentralDocNo อ่านรูปแบบผ่าน _docSeriesConfig/_periodKey ของไฟล์นั้น
['00_setup_sheets.gs', '12_docnum.gs', '17_pricing.gs', '18_pricing_engine.gs', '20_purchasing_master.gs', '21_purchase_requisition.gs', '22_purchase_order.gs', '33_customers.gs', '23_accounting.gs', '34_sales_status.gs', '41_sales_reports.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const ok = (name, r, extra) => eq(name, r && r.success === true ? true : (r && r.message) || r, true);
const fails = (name, r, re) => {
  const good = r && r.success === false && (!re || re.test(r.message || ''));
  console.log((good ? 'PASS ' : 'FAIL ') + name + (good ? '' : '\n   got ' + JSON.stringify(r)));
  if (!good) failed++;
};

// ── ข้อมูลตั้งต้น ──
ctx._seedGlAccounts();
append(sheets.warehouses, { record_id: 1, code: 'MAIN', name: 'คลังกลาง', is_active: 'TRUE', is_default: 'TRUE' });
[[10, 'P-100', 'กล่องกระดาษ', 'ใบ'], [11, 'P-200', 'เทปกาว', 'ม้วน'], [12, 'P-300', 'ฟิล์มยืด', 'ม้วน']]
  .forEach(p => append(sheets.products, { record_id: p[0], product_code: p[1], name: p[2], unit: p[3], base_price: 0, is_active: true }));
/* T1 = "ตัวแทนบ้าน" ของบริษัท (ขายตรงในนามบริษัท) — บิลของ T1 จึงลงสมุดบริษัทได้
   T9 = ตัวแทนจำหน่ายจริง ซึ่งซื้อขาดไปจากบริษัท รายได้จากการขายต่อเป็นของเขา ลงสมุดบริษัทไม่ได้
   ★ ตารางนี้ต้องมีจริง ไม่งั้น _arTenantBlocked หาตัวแทนไม่เจอแล้วปฏิเสธทุกใบ (ตั้งใจให้ล้มไปทางปลอดภัย) */
append(sheets.tenants, { tenant_id: 'T1', name: 'บริษัท (ขายตรง)', is_house: 'TRUE', is_active: 'TRUE' });
append(sheets.tenants, { tenant_id: 'T9', name: 'บูรพา ดีซี', is_house: 'FALSE', is_active: 'TRUE' });
append(sheets.customers, { record_id: 500, name: 'ร้านค้าเครดิต', tenant_id: 'T1', is_active: true });
append(sheets.customers, { record_id: 509, name: 'ร้านของตัวแทน', tenant_id: 'T9', is_active: true });
[[1, 'ผู้จัดการฝ่ายจัดซื้อ', 'purchasing_mgr'], [2, 'ผู้จัดการบัญชี', 'finance_mgr'], [3, 'กรรมการ', 'owner_admin'], [4, 'พนักงานจัดซื้อ', 'staff_user']]
  .forEach(u => append(sheets.admin_users, { record_id: u[0], username: 'u' + u[0], display_name: u[1], role_code: u[2] }));
const S = (id, role) => ({ adminUserId: String(id), role_code: role, tenant_id: '' });
const REQ = S(4, 'staff_user'), MGR = S(1, 'purchasing_mgr'), FIN = S(2, 'finance_mgr'), BOSS = S(3, 'owner_admin'), SUPER = S(9, 'super_admin');
const NOPERM = { adminUserId: '4', role_code: 'staff_user', perms: 'none' };

console.log('\n── ผู้ขาย ──');
fails('ไม่มีสิทธิ์ → ปฏิเสธ', ctx.saveVendor(NOPERM, { name: 'x' }));
fails('ไม่ใส่ชื่อ → ปฏิเสธ', ctx.saveVendor(MGR, { code: 'V1' }));
let r = ctx.saveVendor(MGR, { code: 'V-001', name: 'บจก. กระดาษไทย', paymentTermsDays: 30, taxId: '0105512345678' });
ok('สร้างผู้ขาย', r); const VENDOR = r.vendor.id;
fails('รหัสผู้ขายซ้ำ → ปฏิเสธ', ctx.saveVendor(MGR, { code: 'v-001', name: 'อีกราย' }), /ซ้ำ/);
r = ctx.saveVendor(MGR, { id: VENDOR, code: 'V-001', name: 'บจก. กระดาษไทย (แก้ไข)', paymentTermsDays: 15 });
eq('แก้ผู้ขาย', [r.success, r.vendor.name, r.vendor.paymentTermsDays], [true, 'บจก. กระดาษไทย (แก้ไข)', 15]);
const VENDOR2 = ctx.saveVendor(MGR, { code: 'V-002', name: 'ร้านวัสดุ', paymentTermsDays: 0 }).vendor.id;

console.log('\n── สายอนุมัติ ──');
fails('ไม่มีขั้น → ปฏิเสธ', ctx.saveApprovalFlow(MGR, { name: 'ว่าง', steps: [] }), /อย่างน้อย 1 ขั้น/);
fails('ผู้อนุมัติน้อยกว่าจำนวนที่ต้องอนุมัติ → ปฏิเสธ',
  ctx.saveApprovalFlow(MGR, { name: 'x', steps: [{ approverType: 'user', approverRef: '1', requiredApprovals: 2 }] }), /ระบุผู้อนุมัติไว้ 1 คน/);
fails('วงเงินสูงสุด ≤ ขั้นต่ำ → ปฏิเสธ', ctx.saveApprovalFlow(MGR, { name: 'x', minAmount: 100, maxAmount: 100, steps: [{ approverType: 'role', approverRef: 'owner_admin' }] }));
// วงเงินน้อย: ขั้นเดียว ผู้จัดการจัดซื้อคนเดียวพอ
r = ctx.saveApprovalFlow(MGR, { name: 'ซื้อทั่วไป (ไม่เกิน 50,000)', docType: 'PR', minAmount: 0, maxAmount: 50000,
  steps: [{ name: 'ผู้จัดการจัดซื้อ', approverType: 'role', approverRef: 'purchasing_mgr', requiredApprovals: 1 }] });
ok('สายวงเงินน้อย', r); const FLOW_SMALL = r.flow.id;
// วงเงินสูง: 2 ขั้น ขั้นแรกต้องอนุมัติ 2 คนจาก 3 คน
r = ctx.saveApprovalFlow(MGR, { name: 'ซื้อวงเงินสูง (เกิน 50,000)', docType: 'PR', minAmount: 50000, maxAmount: null,
  steps: [{ name: 'ผู้จัดการ 2 ใน 3', approverType: 'user', approverRef: '1,2,3', requiredApprovals: 2 },
          { name: 'กรรมการ', approverType: 'role', approverRef: 'owner_admin', requiredApprovals: 1 }] });
ok('สายวงเงินสูง 2 ขั้น', r); const FLOW_BIG = r.flow.id;
eq('  อ่านสายกลับมาได้ครบ', ctx.listApprovalFlows(MGR, { docType: 'PR' }).data.map(f => [f.name.split(' ')[0], f.steps.length, f.steps[0].requiredApprovals]),
   [['ซื้อทั่วไป', 1, 1], ['ซื้อวงเงินสูง', 2, 2]]);
eq('เลือกสายตามวงเงิน: 20,000 → สายเล็ก', ctx._resolveApprovalFlow('PR', 20000).flow.record_id, FLOW_SMALL);
eq('เลือกสายตามวงเงิน: 80,000 → สายใหญ่', ctx._resolveApprovalFlow('PR', 80000).flow.record_id, FLOW_BIG);
eq('เลือกสายตามวงเงิน: 50,000 พอดี → สายใหญ่ (เฉพาะเจาะจงกว่า)', ctx._resolveApprovalFlow('PR', 50000).flow.record_id, FLOW_BIG);

console.log('\n── ใบขอซื้อ: วงเงินน้อย ขั้นเดียว ──');
fails('ไม่มีรายการ → ปฏิเสธ', ctx.savePurchaseRequisition(REQ, { items: [] }));
fails('จำนวน 0 → ปฏิเสธ', ctx.savePurchaseRequisition(REQ, { items: [{ productId: 10, qty: 0, unitPrice: 5 }] }), /จำนวน/);
fails('สินค้าไม่มีจริง → ปฏิเสธ', ctx.savePurchaseRequisition(REQ, { items: [{ productId: 999, qty: 1, unitPrice: 5 }] }), /ไม่พบสินค้า/);
r = ctx.savePurchaseRequisition(REQ, { department: 'คลังสินค้า', needByDate: '2026-10-15',
  items: [{ productId: 10, qty: 1000, unitPrice: 12, unitCode: 'ใบ' }, { productId: 11, qty: 100, unitPrice: 25, unitCode: 'ม้วน' }] });
ok('สร้างใบขอซื้อ', r);
const PR1 = r.pr.id;
eq('  เลขที่เอกสารรูปแบบ PR-yyyyMM-0001', r.pr.prNo, 'PR-202609-0001');
eq('  ยอดรวม 1000×12 + 100×25 = 14,500', r.pr.totalExVat, 14500);
eq('  สถานะเริ่มเป็นร่าง + ชื่อสินค้าเติมให้อัตโนมัติ', [r.pr.status, r.pr.items[0].description], ['draft', 'กล่องกระดาษ']);
fails('ยังไม่ส่ง → อนุมัติไม่ได้', ctx.decidePurchaseRequisition(MGR, { id: PR1, decision: 'approve' }), /ไม่ได้อยู่ระหว่างรออนุมัติ/);
r = ctx.submitPurchaseRequisition(REQ, { id: PR1 });
eq('ส่งขออนุมัติ → pending ขั้น 1 สายเล็ก', [r.success, r.pr.status, r.pr.currentStep, r.pr.flowId], [true, 'pending', 1, FLOW_SMALL]);
fails('  ระหว่างรออนุมัติ แก้ไม่ได้', ctx.savePurchaseRequisition(REQ, { id: PR1, items: [{ productId: 10, qty: 1, unitPrice: 1 }] }), /แก้ได้เฉพาะ/);
fails('  คนที่ไม่ใช่ผู้อนุมัติกดไม่ได้', ctx.decidePurchaseRequisition(FIN, { id: PR1, decision: 'approve' }), /ไม่ใช่ผู้อนุมัติ/);
eq('  ใบนี้ค้างอยู่ในคิวของผู้จัดการจัดซื้อ', ctx.listPurchaseRequisitions(MGR, { waitingForMe: true }).data.map(p => p.id), [PR1]);
eq('  แต่ไม่ได้อยู่ในคิวของบัญชี', ctx.listPurchaseRequisitions(FIN, { waitingForMe: true }).data.length, 0);
r = ctx.decidePurchaseRequisition(MGR, { id: PR1, decision: 'approve', comment: 'ตามงบประมาณ' });
eq('อนุมัติ 1 คน → ผ่านทั้งใบ', [r.success, r.pr.status, r.pr.approvals.length], [true, 'approved', 1]);
fails('  อนุมัติซ้ำไม่ได้', ctx.decidePurchaseRequisition(MGR, { id: PR1, decision: 'approve' }));

console.log('\n── ใบขอซื้อ: วงเงินสูง 2 ขั้น (ขั้นแรก 2 ใน 3) ──');
r = ctx.savePurchaseRequisition(REQ, { department: 'ผลิต', items: [{ productId: 12, qty: 500, unitPrice: 180 }] });
const PR2 = r.pr.id;
eq('ยอด 90,000 → เข้าสายใหญ่', ctx.submitPurchaseRequisition(REQ, { id: PR2 }).pr.flowId, FLOW_BIG);
r = ctx.decidePurchaseRequisition(MGR, { id: PR2, decision: 'approve' });
eq('  อนุมัติคนที่ 1 → ยังค้างขั้น 1', [r.pr.status, r.pr.currentStep, /1\/2/.test(r.message)], ['pending', 1, true]);
r = ctx.decidePurchaseRequisition(FIN, { id: PR2, decision: 'approve' });
eq('  ครบ 2 คน → เลื่อนไปขั้น 2', [r.pr.status, r.pr.currentStep], ['pending', 2]);
fails('  ผู้จัดการขั้น 1 กดในขั้น 2 ไม่ได้', ctx.decidePurchaseRequisition(FIN, { id: PR2, decision: 'approve' }), /ไม่ใช่ผู้อนุมัติ/);
r = ctx.decidePurchaseRequisition(BOSS, { id: PR2, decision: 'approve' });
eq('  กรรมการอนุมัติขั้น 2 → อนุมัติทั้งใบ', [r.pr.status, r.pr.approvals.length], ['approved', 3]);

console.log('\n── ตีกลับแล้วส่งใหม่ ──');
r = ctx.savePurchaseRequisition(REQ, { items: [{ productId: 11, qty: 10, unitPrice: 30 }] });
const PR3 = r.pr.id;
ctx.submitPurchaseRequisition(REQ, { id: PR3 });
r = ctx.decidePurchaseRequisition(MGR, { id: PR3, decision: 'reject', comment: 'ของยังมีในคลัง' });
eq('ตีกลับ → rejected', [r.pr.status, r.pr.approvals[0].decision], ['rejected', 'rejected']);
ok('  ใบที่ถูกตีกลับแก้ได้', ctx.savePurchaseRequisition(REQ, { id: PR3, items: [{ productId: 11, qty: 4, unitPrice: 30 }] }));
r = ctx.submitPurchaseRequisition(REQ, { id: PR3 });
eq('  ส่งใหม่ → เริ่มนับใหม่ที่ขั้น 1 ประวัติเดิมถูกล้าง', [r.pr.status, r.pr.currentStep, r.pr.approvals.length], ['pending', 1, 0]);
ok('  super_admin อนุมัติแทนได้', ctx.decidePurchaseRequisition(SUPER, { id: PR3, decision: 'approve' }));
r = ctx.savePurchaseRequisition(REQ, { items: [{ description: 'ค่าบริการขนส่ง', qty: 1, unitPrice: 800 }] });
ok('รายการที่ไม่ผูกสินค้าในระบบก็ขอซื้อได้', r);
ok('  ยกเลิกใบร่างได้', ctx.cancelPurchaseRequisition(REQ, { id: r.pr.id }));

console.log('\n── ใบสั่งซื้อจากใบขอซื้อ ──');
const prLines = ctx.listApprovedPrLines(MGR).data;
eq('รายการค้างจากใบที่อนุมัติแล้ว', prLines.map(l => [l.prNo, l.remainQty]), [['PR-202609-0001', 1000], ['PR-202609-0001', 100], ['PR-202609-0002', 500], ['PR-202609-0003', 4]]);
const line10 = prLines.find(l => String(l.productId) === '10');
fails('สั่งเกินยอดค้างของใบขอซื้อ → ปฏิเสธ', ctx.savePurchaseOrder(MGR, { vendorId: VENDOR, orderDate: '2026-09-23',
  items: [{ prItemId: line10.prItemId, productId: 10, qty: 1200, unitPrice: 12 }] }), /เหลือให้สั่งได้ 1000/);
fails('ไม่เลือกผู้ขาย → ปฏิเสธ', ctx.savePurchaseOrder(MGR, { orderDate: '2026-09-23', items: [{ productId: 10, qty: 1, unitPrice: 1 }] }), /เลือกผู้ขาย/);
r = ctx.savePurchaseOrder(MGR, { vendorId: VENDOR, orderDate: '2026-09-23', expectedDate: '2026-09-30', vatType: 'excluded',
  items: [{ prItemId: line10.prItemId, productId: 10, qty: 50, unitCode: 'ลัง', unitFactor: 20, unitPrice: 240 },
          { prItemId: prLines.find(l => String(l.productId) === '11').prItemId, productId: 11, qty: 100, unitCode: 'ม้วน', unitFactor: 1, unitPrice: 25 }] });
ok('เปิดใบสั่งซื้อจากใบขอซื้อ', r);
const PO1 = r.po.id;
eq('  เลขที่ + ยอด (50×240 + 100×25 = 14,500 + VAT 7% = 15,515)', [r.po.poNo, r.po.subtotalExVat, r.po.vatAmount, r.po.total], ['PO-202609-0001', 14500, 1015, 15515]);
eq('  ผูกกับใบขอซื้อใบเดียวกัน', String(r.po.prId), String(PR1));
fails('รับของตั้งแต่ยังเป็นร่างไม่ได้', ctx.receiveGoods(MGR, { poId: PO1, items: [{ poItemId: r.po.items[0].id, qty: 1 }] }), /ยังเป็นร่าง/);
r = ctx.issuePurchaseOrder(MGR, { id: PO1 });
eq('ส่งใบสั่งซื้อให้ผู้ขาย → sent', r.po.status, 'sent');
eq('  ตัดยอดค้างของใบขอซื้อแล้ว (50 ลัง × 20 = 1000 ใบ)', ctx.listApprovedPrLines(MGR).data.filter(l => l.prNo === 'PR-202609-0001').map(l => l.remainQty), []);
eq('  ใบขอซื้อออก PO ครบ → ปิดใบ', ctx.getPurchaseRequisition(MGR, { id: PR1 }).pr.status, 'closed');
fails('  ส่งแล้วแก้ไม่ได้', ctx.savePurchaseOrder(MGR, { id: PO1, vendorId: VENDOR, items: [{ productId: 10, qty: 1, unitPrice: 1 }] }), /ยังเป็นร่าง/);

console.log('\n── รับของเข้าคลัง ──');
const po1 = ctx.getPurchaseOrder(MGR, { id: PO1 }).po;
const [itemBox, itemTape] = po1.items;
fails('รับเกินจำนวนที่สั่ง → ปฏิเสธ', ctx.receiveGoods(MGR, { poId: PO1, items: [{ poItemId: itemBox.id, qty: 60 }] }), /เหลือให้รับได้ 50/);
r = ctx.receiveGoods(MGR, { poId: PO1, receiveDate: '2026-09-24', items: [{ poItemId: itemBox.id, qty: 30 }] });
ok('รับของบางส่วน 30 ลัง', r);
eq('  สถานะ PO = partial', r.po.status, 'partial');
eq('  เลขใบรับของ', r.grNo, 'GR-202609-0001');
let stock = ctx.listWarehouseStock(MGR, {}).data;
eq('  เข้าสต็อกเป็นหน่วยฐาน 30×20 = 600 ใบ ต้นทุน/ใบ = 240/20 = 12', stock.map(s => [String(s.productId), s.qty, s.avgCost]), [['10', 600, 12]]);
eq('  ledger บันทึก 1 แถว', ctx.listStockLedger(MGR, {}).data.map(l => [l.changeQty, l.balanceAfter, l.moveType, l.refType]), [[600, 600, 'receipt', 'GR']]);
let j = ctx.getJournal(MGR, { id: r.journalId }).journal;
eq('  ลงบัญชี Dr สินค้าคงเหลือ / Cr GR-NI 7,200', [j.lines.map(l => [l.accountCode, l.debit, l.credit]), j.totalDebit === j.totalCredit],
   [[['1300', 7200, 0], ['2150', 0, 7200]], true]);
const GR1 = r.grId;
r = ctx.receiveGoods(MGR, { poId: PO1, receiveDate: '2026-09-25', items: [{ poItemId: itemBox.id, qty: 20 }, { poItemId: itemTape.id, qty: 100 }] });
ok('รับของส่วนที่เหลือ', r);
eq('  รับครบ → สถานะ received', r.po.status, 'received');
stock = ctx.listWarehouseStock(MGR, {}).data;
eq('  สต็อกรวม: กล่อง 1000 ใบ, เทป 100 ม้วน', stock.map(s => [s.productCode, s.qty, s.avgCost]), [['P-100', 1000, 12], ['P-200', 100, 25]]);
eq('  มูลค่าสินค้าคงเหลือรวม 12,000 + 2,500', ctx.listWarehouseStock(MGR, {}).totalValue, 14500);
const GR2 = r.grId;
fails('รับครบแล้ว รับอีกไม่ได้', ctx.receiveGoods(MGR, { poId: PO1, items: [{ poItemId: itemBox.id, qty: 1 }] }), /เหลือให้รับได้ 0/);
fails('ยกเลิก PO ที่รับของแล้วไม่ได้', ctx.cancelPurchaseOrder(MGR, { id: PO1 }), /รับของเข้าคลังไปแล้ว/);

console.log('\n── ยกเลิกใบรับของ (แก้ไข/ยกเลิกหลังลงบัญชีแล้ว) ──');
// สินค้าใหม่ (20) กันชนตัวเลขรวมของสินค้า 10/11/12 ที่เช็คไว้แล้วด้านบนและจะถูกเช็คต่อด้านล่าง (ต้นทุนเฉลี่ย/งบทดลอง)
append(sheets.products, { record_id: 20, product_code: 'P-400', name: 'ถุงพลาสติก', unit: 'ห่อ', category: 'PACK', sub_category: 'ถุง', base_price: 0, is_active: true });
r = ctx.savePurchaseOrder(MGR, { vendorId: VENDOR, orderDate: '2026-09-27', vatType: 'excluded',
  items: [{ productId: 20, qty: 40, unitCode: 'กล่อง', unitFactor: 5, unitPrice: 100 }] });
const PO5 = r.po.id;
ctx.issuePurchaseOrder(MGR, { id: PO5 });
const po5 = ctx.getPurchaseOrder(MGR, { id: PO5 }).po;
r = ctx.receiveGoods(MGR, { poId: PO5, receiveDate: '2026-09-27', items: [{ poItemId: po5.items[0].id, qty: 40 }] });
ok('รับของก่อนทดสอบยกเลิก (40 กล่อง × 5 = 200 ห่อ ต้นทุน/ห่อ = 100/5 = 20)', r);
eq('  เข้าสต็อกและลงบัญชีถูกต้อง', [ctx.listWarehouseStock(MGR, {}).data.find(s => String(s.productId) === '20'), r.po.status],
   [{ warehouseId: 1, warehouseName: 'คลังกลาง', productId: '20', productCode: 'P-400', productName: 'ถุงพลาสติก', unit: 'ห่อ', category: 'PACK', subCategory: 'ถุง',
      qty: 200, reserved: 0, available: 200, avgCost: 20, value: 4000, updatedAt: '2026-09-23 10:00:00' }, 'received']);
const GR5 = r.grId, JV5 = r.journalId;

fails('ยังไม่ใช่แอดมินฝ่ายคลัง (ไม่มีสิทธิ์แก้ไข) ยกเลิกไม่ได้', ctx.cancelGoodsReceipt(NOPERM, { id: GR5 }), /ไม่มีสิทธิ์/);

console.log('  -- ของถูกใช้ไปบางส่วนแล้ว (เช่น ขายออกแล้ว) ยกเลิกไม่ได้ --');
ctx._applyStockIn('', 1, '20', -150, 20, 'test_consume', 'TEST', 0, 'จำลองของถูกใช้ไปก่อนเทสต์ยกเลิก', 'tester');
fails('เหลือในคลังแค่ 50 แต่ใบรับของนี้รับมา 200 → ปฏิเสธ', ctx.cancelGoodsReceipt(MGR, { id: GR5 }),
  /เหลือในคลัง 50 แต่ใบนี้รับเข้ามา 200/);
eq('  ★ ปฏิเสธทั้งใบ ไม่คืนครึ่งๆ กลางๆ — สต็อก/สถานะ/บัญชีไม่ถูกแตะเลย', [
  ctx.listWarehouseStock(MGR, {}).data.find(s => String(s.productId) === '20').qty,
  ctx.getGoodsReceipt(MGR, { id: GR5 }).gr.status, ctx.getJournal(MGR, { id: JV5 }).journal.status
], [50, 'posted', 'posted']);
ctx._applyStockIn('', 1, '20', 150, 20, 'test_consume_undo', 'TEST', 0, 'คืนของกลับก่อนเทสต์ต่อ', 'tester');   // คืนให้เทสต์ถัดไปเริ่มสะอาด

console.log('  -- ทางปกติ: ของยังอยู่ครบ ยกเลิกได้ --');
r = ctx.cancelGoodsReceipt(MGR, { id: GR5, reason: 'นับสต็อกแล้วพบว่ารับผิดรุ่น' });
ok('ยกเลิกใบรับของสำเร็จ', r);
eq('  สต็อกกลับเป็น 0 (คืนครบ)', (ctx.listWarehouseStock(MGR, {}).data.find(s => String(s.productId) === '20') || { qty: 0 }).qty, 0);
eq('  ใบรับของเปลี่ยนเป็น cancelled พร้อมเหตุผล', (() => { const g = ctx.getGoodsReceipt(MGR, { id: GR5 }).gr; return [g.status, /นับสต็อกแล้วพบว่ารับผิดรุ่น/.test(g.note)]; })(),
   ['cancelled', true]);
eq('  ★ ใบสำคัญเดิมกลับรายการ (ไม่ลบ) + มีใบสำคัญกลับรายการใหม่ที่เดบิต/เครดิตสลับกัน', (() => {
  const orig = ctx.getJournal(MGR, { id: JV5 }).journal;
  const revJournals = ctx.listJournals(MGR, { source: 'INV' }).data.filter(x => String(x.refId) === String(JV5) && x.refType === 'VOID');
  const rev = ctx.getJournal(MGR, { id: revJournals[0].id }).journal;
  return [orig.status, orig.lines.map(l => [l.accountCode, l.debit, l.credit]), rev.lines.map(l => [l.accountCode, l.debit, l.credit])];
})(), ['voided', [['1300', 4000, 0], ['2150', 0, 4000]], [['1300', 0, 4000], ['2150', 4000, 0]]]);
eq('  ยอดค้างคืนให้ PO แล้ว เดินสถานะกลับเป็น "sent" (ยังไม่ได้รับของเลยสักหีบ)', ctx.getPurchaseOrder(MGR, { id: PO5 }).po.status, 'sent');
r = ctx.receiveGoods(MGR, { poId: PO5, receiveDate: '2026-09-27', items: [{ poItemId: po5.items[0].id, qty: 40 }] });
ok('  รับของใหม่ให้ถูกได้ทันที (นี่คือ "แก้ไข" ใบรับของในระบบนี้ — ยกเลิกใบเดิมแล้วรับใหม่ ไม่ใช่แก้ตัวเลขในใบเดิม)', r);
fails('ยกเลิกซ้ำ (กดสองครั้ง) ไม่เกิดผลซ้ำ', ctx.cancelGoodsReceipt(MGR, { id: GR5 }), /ถูกยกเลิกไปแล้ว/);
ok('  ล้างของที่รับใหม่ทิ้งด้วย (กันผลกระทบข้ามไปงบทดลองท้ายไฟล์ — เทสต์ส่วนนี้ตั้งใจให้หักล้างกันหมด สุทธิเป็นศูนย์)',
  ctx.cancelGoodsReceipt(MGR, { id: r.grId, reason: 'เคลียร์ท้ายเทสต์' }));

console.log('\n── ต้นทุนเฉลี่ยถ่วงน้ำหนัก ──');
let po2 = ctx.savePurchaseOrder(MGR, { vendorId: VENDOR2, orderDate: '2026-09-26', vatType: 'none',
  items: [{ productId: 11, qty: 100, unitCode: 'ม้วน', unitFactor: 1, unitPrice: 35 }] }).po;
ctx.issuePurchaseOrder(MGR, { id: po2.id });
r = ctx.receiveGoods(MGR, { poId: po2.id, receiveDate: '2026-09-26', items: [{ poItemId: po2.items[0].id, qty: 100 }] });
ok('รับเทปล็อตใหม่ราคาสูงขึ้น', r);
eq('  ต้นทุนเฉลี่ยใหม่ = (100×25 + 100×35)/200 = 30', ctx.listWarehouseStock(MGR, {}).data.find(s => s.productCode === 'P-200').avgCost, 30);

console.log('\n── ใบสั่งซื้อเปิดตรง (ไม่มีใบขอซื้อ) + ยกเลิก ──');
r = ctx.savePurchaseOrder(MGR, { vendorId: VENDOR2, orderDate: '2026-09-23', vatType: 'included',
  items: [{ productId: 12, qty: 10, unitCode: 'ม้วน', unitFactor: 1, unitPrice: 107 }] });
eq('เปิดตรงได้ + VAT included ถอดออกถูก (1,070 → 1,000 + 70)', [r.success, r.po.prId, r.po.subtotalExVat, r.po.vatAmount, r.po.total], [true, '', 1000, 70, 1070]);
const PO3 = r.po.id;
ok('ยกเลิกใบสั่งซื้อที่ยังไม่รับของ', ctx.cancelPurchaseOrder(MGR, { id: PO3, reason: 'ผู้ขายไม่มีของ' }));
eq('  สถานะ cancelled', ctx.getPurchaseOrder(MGR, { id: PO3 }).po.status, 'cancelled');
// ยกเลิก PO ที่ release จาก PR แล้ว → คืนยอดค้างให้ PR
r = ctx.savePurchaseOrder(MGR, { vendorId: VENDOR, orderDate: '2026-09-23',
  items: [{ prItemId: ctx.listApprovedPrLines(MGR).data.find(l => l.prNo === 'PR-202609-0002').prItemId, productId: 12, qty: 500, unitFactor: 1, unitPrice: 180 }] });
const PO4 = r.po.id;
ctx.issuePurchaseOrder(MGR, { id: PO4 });
eq('  PR-0002 ถูกปิดหลังออก PO ครบ', ctx.getPurchaseRequisition(MGR, { id: PR2 }).pr.status, 'closed');
ok('ยกเลิก PO ที่ release จาก PR', ctx.cancelPurchaseOrder(MGR, { id: PO4 }));
eq('  PR กลับมาเป็น approved และมียอดค้างคืน 500', [ctx.getPurchaseRequisition(MGR, { id: PR2 }).pr.status,
   ctx.listApprovedPrLines(MGR).data.filter(l => l.prNo === 'PR-202609-0002').map(l => l.remainQty)], ['approved', [500]]);

console.log('\n── เจ้าหนี้ (AP) ──');
r = ctx.createApBillFromGr(FIN, { grId: GR1, vendorInvoiceNo: 'INV-8891', billDate: '2026-09-24' });
ok('ตั้งหนี้จากใบรับของ', r);
const BILL1 = r.billId;
eq('  ยอด 7,200 + VAT 7% = 7,704', r.total, 7704);
let bill = ctx.listApBills(FIN, {}).data.find(b => b.id === BILL1);
eq('  ครบกำหนด = วันที่บิล + เครดิต 15 วัน', bill.dueDate, '2026-10-09');
j = ctx.getJournal(FIN, { id: ctx.listApBills(FIN, {}).data.find(b => b.id === BILL1).journalId }).journal;
eq('  ลงบัญชี Dr GR-NI 7,200 + Dr ภาษีซื้อ 504 / Cr เจ้าหนี้ 7,704', j.lines.map(l => [l.accountCode, l.debit, l.credit]),
   [['2150', 7200, 0], ['1400', 504, 0], ['2100', 0, 7704]]);
fails('ตั้งหนี้จากใบรับของเดิมซ้ำ → ปฏิเสธ', ctx.createApBillFromGr(FIN, { grId: GR1 }), /ตั้งหนี้ไปแล้ว/);
fails('ใบรับของที่ตั้งหนี้ไปแล้ว ยกเลิกไม่ได้ (ต้องยกเลิกใบตั้งหนี้ก่อน)', ctx.cancelGoodsReceipt(MGR, { id: GR1 }), /ตั้งหนี้ไปแล้ว.*ต้องยกเลิกใบตั้งหนี้ก่อน/);
r = ctx.createApBillFromGr(FIN, { grId: GR2, billDate: '2026-09-25' });
const BILL2 = r.billId;
eq('ตั้งหนี้ใบที่ 2 (กล่อง 20 ลัง 4,800 + เทป 2,500 = 7,300 + VAT = 7,811)', r.total, 7811);
fails('จ่ายเกินยอดค้าง → ปฏิเสธ', ctx.payApBills(FIN, { vendorId: VENDOR, allocations: [{ billId: BILL1, amount: 999999 }] }), /ยอดค้าง/);
fails('จ่ายใบของผู้ขายคนละราย → ปฏิเสธ', ctx.payApBills(FIN, { vendorId: VENDOR2, allocations: [{ billId: BILL1, amount: 100 }] }), /ไม่ใช่ของผู้ขาย/);
r = ctx.payApBills(FIN, { vendorId: VENDOR, paymentDate: '2026-10-05', method: 'transfer', allocations: [{ billId: BILL1, amount: 7704 }, { billId: BILL2, amount: 2000 }] });
ok('จ่ายเจ้าหนี้ 2 ใบในครั้งเดียว', r);
eq('  ยอดจ่ายรวม 9,704', r.amount, 9704);
let bills = ctx.listApBills(FIN, {}).data;
eq('  ใบแรกจ่ายครบ = paid, ใบสองจ่ายบางส่วน = partial ค้าง 5,811',
   bills.filter(b => b.id === BILL1 || b.id === BILL2).map(b => [b.status, b.outstanding]), [[ 'partial', 5811 ], [ 'paid', 0 ]]);
j = ctx.getJournal(FIN, { id: ctx.listJournals(FIN, { source: 'AP' }).data[0].id }).journal;
eq('  ลงบัญชีจ่าย Dr เจ้าหนี้ / Cr ธนาคาร', j.lines.map(l => [l.accountCode, l.debit, l.credit]), [['2100', 9704, 0], ['1120', 0, 9704]]);
r = ctx.createApBillManual(FIN, { vendorId: VENDOR2, billDate: '2026-09-30', subtotalExVat: 5000, note: 'ค่าขนส่งเดือน ก.ย.' });
ok('ตั้งหนี้ค่าใช้จ่ายทั่วไป (ไม่ผูกใบสั่งซื้อ)', r);
const aging = ctx.getApAging(FIN, { asOf: '2026-10-20' }).data;
eq('อายุหนี้เจ้าหนี้ ณ 20 ต.ค.', aging.map(a => [a.partyName, a.total, a.d1_30, a.notDue]),
   [['บจก. กระดาษไทย (แก้ไข)', 5811, 5811, 0], ['ร้านวัสดุ', 5350, 5350, 0]]);

console.log('\n── ลูกหนี้ (AR) ──');
append(tenantSheets.sales_orders, { record_id: 77, order_code: 'SO-26092301', customer_id: 500, total: 10700, payment_method: 'credit_term', status: 'completed', created_at: '2026-09-23 09:00:00' });
append(tenantSheets.sales_orders, { record_id: 78, order_code: 'SO-26092302', customer_id: 500, total: 500, payment_method: 'cash', status: 'completed', created_at: '2026-09-23 09:30:00' });
eq('บิลเครดิตที่ยังไม่ออกใบแจ้งหนี้ (บิลเงินสดไม่นับ)', ctx.listUninvoicedSalesOrders(FIN, { tenantId: 'T1' }).data.map(o => o.orderCode), ['SO-26092301']);
r = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 77, invoiceDate: '2026-09-23', dueDays: 30 });
ok('ออกใบแจ้งหนี้จากบิลขายเครดิต', r);
const INV1 = r.invoiceId;
eq('  ถอด VAT จากยอดรวม 10,700 = 10,000 + 700', ctx.listArInvoices(FIN, {}).data[0].subtotalExVat, 10000);
j = ctx.getJournal(FIN, { id: ctx.listArInvoices(FIN, {}).data[0].journalId }).journal;
eq('  ลงบัญชี Dr ลูกหนี้ 10,700 / Cr รายได้ 10,000 + Cr ภาษีขาย 700', j.lines.map(l => [l.accountCode, l.debit, l.credit]),
   [['1200', 10700, 0], ['4100', 0, 10000], ['2200', 0, 700]]);
fails('บิลขายเดิมออกใบแจ้งหนี้ซ้ำ → ปฏิเสธ', ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 77 }), /ออกใบแจ้งหนี้ไปแล้ว/);
eq('  ไม่เหลือบิลค้างออกใบแจ้งหนี้', ctx.listUninvoicedSalesOrders(FIN, { tenantId: 'T1' }).data.length, 0);
fails('รับชำระเกินยอดค้าง → ปฏิเสธ', ctx.receiveArPayment(FIN, { customerId: 500, allocations: [{ invoiceId: INV1, amount: 20000 }] }), /ค้าง/);
r = ctx.receiveArPayment(FIN, { customerId: 500, receiptDate: '2026-10-10', method: 'transfer', allocations: [{ invoiceId: INV1, amount: 6700 }] });
ok('รับชำระบางส่วน', r);
eq('  ใบแจ้งหนี้เป็น partial ค้าง 4,000', ctx.listArInvoices(FIN, {}).data[0].outstanding, 4000);
r = ctx.receiveArPayment(FIN, { customerId: 500, receiptDate: '2026-11-01', method: 'cash', allocations: [{ invoiceId: INV1, amount: 4000 }] });
eq('  รับครบ → paid', [r.success, ctx.listArInvoices(FIN, {}).data[0].status], [true, 'paid']);
r = ctx.createArInvoice(FIN, { customerId: 500, invoiceDate: '2026-08-01', dueDate: '2026-08-31', subtotalExVat: 2000 });
ok('ออกใบแจ้งหนี้เองได้ (ไม่ผูกบิลขาย)', r);

console.log('\n-- ★★ ตัวแทนซื้อขาด: รายได้จากการขายต่อเป็นของเขา ลงสมุดบริษัทไม่ได้ (6 ต.ค. 2026) --');
/* ฝั่งซื้อ (createApBillFromGr) กั้นไว้ตั้งแต่ต้น แต่ฝั่งขายไม่เคยกั้น — ตั้งลูกหนี้จากบิลของตัวแทนได้
   และ _postJournal ลงสมุดบริษัทให้ทุกใบ = รับรู้รายได้ซ้ำ (บริษัทรับรู้ตอนขายให้ตัวแทนไปแล้วรอบหนึ่ง) */
const beforeJv = sheets.gl_journals.rows.length;
fails('ตั้งลูกหนี้จากบิลขายของตัวแทน → ปฏิเสธ',
  ctx.createArInvoice(FIN, { tenantId: 'T9', salesOrderId: 77 }), /ซื้อขาด|สมุดของบริษัท/);
fails('ออกใบแจ้งหนี้ให้ลูกค้าของตัวแทนเองก็ไม่ได้',
  ctx.createArInvoice(FIN, { customerId: 509, invoiceDate: '2026-08-01', subtotalExVat: 1000 }), /ซื้อขาด|สมุดของบริษัท/);
eq('  ★ ต้องไม่มีใบสำคัญบัญชีเกิดขึ้นเลย', sheets.gl_journals.rows.length, beforeJv);
fails('ตัวแทนที่ไม่มีในระบบ → ปฏิเสธ (ล้มไปทางปลอดภัย ไม่ใช่ปล่อยผ่าน)',
  ctx.createArInvoice(FIN, { tenantId: 'T404', salesOrderId: 77 }), /ไม่พบตัวแทน/);
eq('อายุหนี้ลูกหนี้ ณ 20 ต.ค. (เกินกำหนด 50 วัน → ช่วง 31-60)',
   ctx.getArAging(FIN, { asOf: '2026-10-20' }).data.map(a => [a.total, a.d31_60, a.docs[0].overdueDays]), [[2140, 2140, 50]]);

console.log('\n── แยกประเภท (GL) ──');
fails('ใบสำคัญไม่สมดุล → ปฏิเสธ', ctx.postManualJournal(FIN, { date: '2026-09-30', memo: 'x',
  lines: [{ accountCode: '1110', debit: 100, credit: 0 }, { accountCode: '4100', debit: 0, credit: 90 }] }), /เดบิตไม่เท่าเครดิต/);
fails('รหัสบัญชีไม่มีในผัง → ปฏิเสธ', ctx.postManualJournal(FIN, { date: '2026-09-30', memo: 'x',
  lines: [{ accountCode: '9999', debit: 100, credit: 0 }, { accountCode: '1110', debit: 0, credit: 100 }] }), /ไม่พบรหัสบัญชี/);
r = ctx.postManualJournal(FIN, { date: '2026-09-30', memo: 'ปรับปรุงยอดเงินสด',
  lines: [{ accountCode: '1110', description: 'เงินสดย่อย', debit: 3000, credit: 0 }, { accountCode: '1120', description: 'ถอนจากธนาคาร', debit: 0, credit: 3000 }] });
ok('ลงใบสำคัญเอง', r);
const JV = r.journalId;
const tb = ctx.getTrialBalance(FIN, {});
eq('งบทดลองสมดุล (เดบิตรวม = เครดิตรวม)', tb.totalDebit === tb.totalCredit, true);
eq('  ยอดคงเหลือบัญชีหลัก', ['1300', '2150', '2100', '1200'].map(c => { const a = tb.data.find(x => x.code === c); return [c, a ? a.balance : 0]; }),
   [['1300', 18000], ['2150', 3500], ['2100', 11161], ['1200', 2140]]);   // GR-NI 3,500 = ใบรับของล็อตเทปที่ยังไม่ได้ตั้งหนี้
eq('  สินค้าคงเหลือในบัญชี = มูลค่าสต็อกจริงในคลัง', tb.data.find(x => x.code === '1300').balance, ctx.listWarehouseStock(FIN, {}).totalValue);
r = ctx.voidJournal(FIN, { id: JV, date: '2026-09-30', reason: 'ลงผิดงวด' });
ok('กลับรายการใบสำคัญ', r);
eq('  ใบเดิมเป็น voided และผลของมันถูกล้างด้วยใบกลับรายการ (เหลือแต่เงินสดจากรับชำระ 4,000)',
   [ctx.getJournal(FIN, { id: JV }).journal.status, ctx.getTrialBalance(FIN, {}).data.find(x => x.code === '1110').balance], ['voided', 4000]);
const tb2 = ctx.getTrialBalance(FIN, {});
eq('  งบทดลองยังสมดุลหลังกลับรายการ', tb2.totalDebit === tb2.totalCredit, true);
eq('สิทธิ์: ผู้ใช้ read-only ลงบัญชีไม่ได้', ctx.postManualJournal({ adminUserId: '4', role_code: 'staff_user', readOnly: true }, { date: '2026-09-30', lines: [] }).success, false);
const pl = ctx.getIncomeStatement(FIN, {});
eq('งบกำไรขาดทุน: รายได้ 10,000 + 2,000 · ค่าใช้จ่าย 5,000 (ค่าขนส่ง) → กำไร 7,000',
   [pl.totalIncome, pl.totalExpense, pl.netProfit], [12000, 5000, 7000]);
const bs = ctx.getBalanceSheet(FIN, { asOf: '2026-12-31' });   // ครอบคลุมเอกสารที่ลงวันที่ล่วงหน้าในเทสต์ด้วย
eq('งบดุลสมดุล: สินทรัพย์ = หนี้สิน + ทุน + กำไรงวดนี้', [bs.balanced, bs.totalAssets === bs.totalLiabilitiesAndEquity], [true, true]);
eq('  กำไรในงบดุลตรงกับงบกำไรขาดทุน', bs.netProfit, pl.netProfit);
console.log('\n── ตัวแทนจำหน่ายใช้ระบบงานซื้อเอง (ข้อมูลต้องไม่ปนกับของบริษัท) ──');
const TEN = 'TNKN';
const TADMIN = { adminUserId: '7', role_code: 'tenant_admin', tenant_id: TEN };
append(sheets.admin_users, { record_id: 7, username: 'u7', display_name: 'แอดมินตัวแทนเหนือ', role_code: 'tenant_admin', tenant_id: TEN });
const ownerVendorCount = ctx.listVendors(MGR, {}).data.length;
const ownerStockValue = ctx.listWarehouseStock(FIN, {}).totalValue;
const ownerTbBefore = ctx.getTrialBalance(FIN, {}).totalDebit;

r = ctx.saveVendor(TADMIN, { code: 'V-001', name: 'ร้านค้าส่งเชียงใหม่', paymentTermsDays: 7 });
ok('ตัวแทนสร้างผู้ขายของตัวเองได้ (รหัสซ้ำกับของบริษัทได้ เพราะคนละบริษัท)', r);
const TVENDOR = r.vendor.id;
eq('  ตัวแทนเห็นเฉพาะผู้ขายของตัวเอง', ctx.listVendors(TADMIN, {}).data.map(v => v.name), ['ร้านค้าส่งเชียงใหม่']);
eq('  บริษัทไม่เห็นผู้ขายของตัวแทน', ctx.listVendors(MGR, {}).data.length, ownerVendorCount);
fails('  บริษัทแก้ผู้ขายของตัวแทนไม่ได้', ctx.saveVendor(MGR, { id: TVENDOR, name: 'แอบแก้' }), /ไม่พบผู้ขาย/);
fails('  บริษัทเปิดใบสั่งซื้อกับผู้ขายของตัวแทนไม่ได้',
  ctx.savePurchaseOrder(MGR, { vendorId: TVENDOR, items: [{ productId: 10, qty: 1, unitPrice: 1 }] }), /เลือกผู้ขาย/);

r = ctx.savePurchaseRequisition(TADMIN, { department: 'หน้าร้าน', items: [{ productId: 12, qty: 20, unitPrice: 50, unitCode: 'ม้วน' }] });
ok('ตัวแทนเปิดใบขอซื้อได้', r);
const TPR = r.pr.id;
eq('  เลขที่เอกสารแยกเล่มของตัวแทน', /^PR-TNKN-\d{6}-0001$/.test(r.pr.prNo), true);
eq('  ใบขอซื้อของตัวแทนไม่โผล่ในรายการของบริษัท',
   ctx.listPurchaseRequisitions(MGR, {}).data.some(x => String(x.id) === String(TPR)), false);
fails('  บริษัทเปิดใบขอซื้อของตัวแทนตรงๆ ไม่ได้', ctx.getPurchaseRequisition(MGR, { id: TPR }), /ไม่พบ/);
eq('  แต่ฝั่งบริษัท (owner_admin) สวมสิทธิ์เข้าไปดูแทนได้',
   ctx.getPurchaseRequisition(BOSS, { id: TPR, tenantId: TEN }).pr.id, TPR);
r = ctx.submitPurchaseRequisition(TADMIN, { id: TPR });
eq('  ตัวแทนยังไม่ได้ตั้งสายอนุมัติ → อนุมัติอัตโนมัติ (สายของบริษัทไม่มีผลข้ามบริษัท)',
   [r.success, r.pr.status], [true, 'approved']);

r = ctx.savePurchaseOrder(TADMIN, { vendorId: TVENDOR, orderDate: '2026-09-24', vatType: 'excluded',
  items: [{ prItemId: ctx.listApprovedPrLines(TADMIN, {}).data[0].prItemId, productId: 12, qty: 20, unitCode: 'ม้วน', unitFactor: 1, unitPrice: 50 }] });
ok('ตัวแทนออกใบสั่งซื้อจากใบขอซื้อของตัวเองได้', r);
const TPO = r.po.id;
eq('  เลขที่ใบสั่งซื้อแยกเล่ม', /^PO-TNKN-/.test(r.po.poNo), true);
eq('  ระบบสร้างคลังของตัวแทนให้อัตโนมัติ', ctx.listWarehouses(TADMIN).data.map(w => [w.name, w.isDefault]), [['คลังของตัวแทน', true]]);
ok('  ส่งใบสั่งซื้อ', ctx.issuePurchaseOrder(TADMIN, { id: TPO }));
r = ctx.receiveGoods(TADMIN, { poId: TPO, receiveDate: '2026-09-25',
  items: [{ poItemId: ctx.getPurchaseOrder(TADMIN, { id: TPO }).po.items[0].id, qty: 20 }] });
ok('ตัวแทนรับของเข้าคลังตัวเองได้', r);
eq('  ใบรับของของตัวแทนไม่ลงบัญชีบริษัท (journal_id ว่าง)', r.journalId, '');
eq('  สต็อกของตัวแทนเพิ่มขึ้น 20 ม้วน @50', ctx.listWarehouseStock(TADMIN, {}).data.map(x => [x.productCode, x.qty, x.avgCost]), [['P-300', 20, 50]]);
eq('  สต็อกของบริษัทไม่ถูกแตะ', ctx.listWarehouseStock(FIN, {}).totalValue, ownerStockValue);
eq('  งบทดลองของบริษัทไม่ขยับ', ctx.getTrialBalance(FIN, {}).totalDebit, ownerTbBefore);
eq('  บริษัทไม่เห็นใบรับของ/สต็อกของตัวแทนในรายการตัวเอง',
   [ctx.listGoodsReceipts(FIN, {}).data.some(g => String(g.id) === String(r.grId)),
    ctx.listStockLedger(FIN, {}).data.some(l => String(l.productId) === '12')], [false, false]);
fails('  ตั้งหนี้เจ้าหนี้จากใบรับของของตัวแทนไม่ได้ (สมุดบัญชีเป็นของบริษัท)',
  ctx.createApBillFromGr(FIN, { grId: r.grId, billDate: '2026-09-25', vendorBillNo: 'X-1' }), /ตัวแทน/);
fails('  ตัวแทนยกเลิกใบสั่งซื้อของบริษัทไม่ได้', ctx.cancelPurchaseOrder(TADMIN, { id: PO1 }), /ไม่พบใบสั่งซื้อ/);

console.log('\n── สมุดบัญชีแยกเล่มต่อตัวแทน (ข้อมูลต้องไม่รั่วข้ามสมุด) ──');
/* เจ้าของระบบ 6 ต.ค. 2026: ตัวแทน "ซื้อขาด" ไปจากบริษัท รายได้จากการขายต่อเป็นของเขา
   → บัญชีต้องแยกเล่ม · ผังบัญชีใช้ชุดเดียวกัน (ข้อ 1) · ฝั่งบริษัทเปิดดูสมุดตัวแทนได้ (ข้อ 3)
   ★ หมวดนี้คือตัวกันของจริง: ถ้าลืมกรองที่ไหนสักที่ ทุกสมุดอยู่ชีตเดียวกันจึงรั่วทันทีแบบไม่มีอะไรฟ้อง */
const ownerBook = ctx.getTrialBalance(FIN, {});
const ownerJvCount = ctx.listJournals(FIN, {}).total;
const ownerBillCount = ctx.listApBills(FIN, {}).data.length;
const ownerArCount = ctx.listArInvoices(FIN, {}).data.length;
const ownerApAging = ctx.getApAging(FIN, { asOf: '2026-10-20' }).data.length;

r = ctx.postManualJournal(TADMIN, { date: '2026-10-01', memo: 'ตัวแทนตั้งเงินสดย่อย',
  lines: [{ accountCode: '1110', debit: 500, credit: 0 }, { accountCode: '1120', debit: 0, credit: 500 }] });
ok('ตัวแทนลงใบสำคัญในสมุดของตัวเองได้', r);
const TJV = r.journalId;
eq('  เลขใบสำคัญแยกเล่มของตัวแทน', /^JV-TNKN-\d{6}-0001$/.test(r.journalNo), true);
eq('  ใบนี้ถูกเก็บไว้ในสมุดของตัวแทน (tenant_id)',
   objs(sheets.gl_journals).find(j => String(j.record_id) === String(TJV)).tenant_id, TEN);

eq('  ตัวแทนเห็นแต่ใบของตัวเอง', ctx.listJournals(TADMIN, {}).data.map(j => j.id), [TJV]);
eq('  รายการใบสำคัญของบริษัทไม่มีใบของตัวแทนเพิ่มเข้ามา', ctx.listJournals(FIN, {}).total, ownerJvCount);
fails('  ตัวแทนเปิดใบสำคัญของบริษัทไม่ได้ (ตอบเหมือนไม่มี ไม่บอกว่ามีอยู่)',
  ctx.getJournal(TADMIN, { id: JV }), /ไม่พบใบสำคัญ/);
fails('  บริษัทเปิดใบสำคัญของตัวแทนตรงๆ ไม่ได้', ctx.getJournal(FIN, { id: TJV }), /ไม่พบใบสำคัญ/);
eq('  แต่ฝั่งบริษัทสวมสิทธิ์เข้าไปดูสมุดของตัวแทนได้ (กติกาข้อ 3)',
   ctx.getJournal(BOSS, { id: TJV, tenantId: TEN }).journal.journalNo.indexOf('JV-TNKN-'), 0);

const tenTb = ctx.getTrialBalance(TADMIN, {});
eq('  งบทดลองของตัวแทนมีแต่รายการของตัวเอง และสมดุล',
   [tenTb.totalDebit, tenTb.totalCredit, tenTb.data.find(x => x.code === '1110').balance], [500, 500, 500]);
eq('  งบทดลองของบริษัทไม่ขยับเลย',
   [ctx.getTrialBalance(FIN, {}).totalDebit, ctx.getTrialBalance(FIN, {}).data.find(x => x.code === '1110').balance],
   [ownerBook.totalDebit, ownerBook.data.find(x => x.code === '1110').balance]);
eq('  งบกำไรขาดทุน/งบดุลของตัวแทนไม่ได้หยิบรายได้ของบริษัทมา',
   [ctx.getIncomeStatement(TADMIN, {}).totalIncome, ctx.getBalanceSheet(TADMIN, { asOf: '2026-12-31' }).balanced], [0, true]);

/* ★ กลับรายการ: ใบใหม่ต้องลงสมุดเดียวกับใบเดิม ไม่ใช่สมุดของคนที่กดยกเลิก
   ถ้าพลาดข้อนี้ ใบเดิมหายจากสมุดตัวแทนแต่ผลตรงข้ามไปโผล่ในสมุดบริษัท = เละทั้งสองเล่มพร้อมกัน */
fails('  ตัวแทนกลับรายการใบของบริษัทไม่ได้', ctx.voidJournal(TADMIN, { id: JV, date: '2026-10-01' }), /ไม่พบใบสำคัญ/);
r = ctx.voidJournal(BOSS, { id: TJV, tenantId: TEN, date: '2026-10-02', reason: 'ลงผิดเล่ม' });
ok('  บริษัทกลับรายการใบของตัวแทนแทนได้', r);
eq('  ใบกลับรายการอยู่ในสมุดของตัวแทน ไม่ใช่สมุดบริษัท',
   [objs(sheets.gl_journals).find(j => String(j.record_id) === String(r.journalId)).tenant_id,
    ctx.getTrialBalance(FIN, {}).totalDebit, ctx.getTrialBalance(TADMIN, {}).data.find(x => x.code === '1110').balance],
   [TEN, ownerBook.totalDebit, 0]);

// เจ้าหนี้: ตัวแทนตั้งหนี้กับผู้ขายของตัวเองได้ · ข้ามสมุดไม่ได้ทั้งสองทาง
fails('  ตัวแทนตั้งหนี้กับผู้ขายของบริษัทไม่ได้',
  ctx.createApBillManual(TADMIN, { vendorId: VENDOR, billDate: '2026-10-01', subtotalExVat: 100 }), /ไม่พบผู้ขาย/);
r = ctx.createApBillManual(TADMIN, { vendorId: TVENDOR, billDate: '2026-10-01', subtotalExVat: 1000, note: 'ค่าขนส่งของตัวแทน' });
ok('  ตัวแทนตั้งหนี้ในสมุดของตัวเองได้', r);
const TBILL = r.billId;
eq('  เลขที่ตั้งหนี้แยกเล่ม', /^AP-TNKN-/.test(r.billNo), true);
eq('  บริษัทไม่เห็นใบตั้งหนี้ของตัวแทน · ตัวแทนไม่เห็นใบของบริษัท',
   [ctx.listApBills(FIN, {}).data.length, ctx.listApBills(TADMIN, {}).data.map(b => b.id)], [ownerBillCount, [TBILL]]);
fails('  ตัวแทนจ่ายหนี้ใบของบริษัทไม่ได้',
  ctx.payApBills(TADMIN, { vendorId: TVENDOR, allocations: [{ billId: BILL2, amount: 100 }] }), /ไม่พบใบแจ้งหนี้/);
fails('  บริษัทจ่ายหนี้ใบของตัวแทนไม่ได้ (ต้องสวมสิทธิ์เข้าไปก่อน)',
  ctx.payApBills(FIN, { vendorId: VENDOR, allocations: [{ billId: TBILL, amount: 100 }] }), /ไม่พบใบแจ้งหนี้/);
r = ctx.payApBills(TADMIN, { vendorId: TVENDOR, paymentDate: '2026-10-03', method: 'cash', allocations: [{ billId: TBILL, amount: 1070 }] });
ok('  ตัวแทนจ่ายหนี้ของตัวเองได้', r);
eq('  ใบสำคัญจ่ายของตัวแทนอยู่ในสมุดตัวเอง และงบบริษัทยังไม่ขยับ',
   [objs(sheets.ap_payments).find(p => String(p.record_id) === String(r.paymentId)).tenant_id,
    ctx.getTrialBalance(FIN, {}).totalDebit], [TEN, ownerBook.totalDebit]);
eq('  อายุหนี้: ของใครของมัน (ตัวแทนจ่ายครบแล้วจึงไม่มีค้าง)',
   [ctx.getApAging(TADMIN, { asOf: '2026-10-20' }).data.length,
    ctx.getApAging(FIN, { asOf: '2026-10-20' }).data.length], [0, ownerApAging]);

// ลูกหนี้: ยังไม่เปิดให้ตัวแทนตั้งลูกหนี้ (ข้อ 4 ของแผน) แต่ห้ามแตะใบของบริษัทได้แล้ววันนี้
eq('  ตัวแทนไม่เห็นใบแจ้งหนี้ลูกค้าของบริษัท',
   [ctx.listArInvoices(TADMIN, {}).data.length, ctx.listArInvoices(FIN, {}).data.length], [0, ownerArCount]);
fails('  ตัวแทนรับชำระใบแจ้งหนี้ของบริษัทไม่ได้',
  ctx.receiveArPayment(TADMIN, { customerId: 500, receiptDate: '2026-10-03',
    allocations: [{ invoiceId: ctx.listArInvoices(FIN, {}).data[0].id, amount: 10 }] }), /ไม่พบใบแจ้งหนี้/);
eq('  อายุลูกหนี้ของตัวแทนว่าง · ของบริษัทยังอยู่ครบ',
   [ctx.getArAging(TADMIN, { asOf: '2026-10-20' }).data.length,
    ctx.getArAging(FIN, { asOf: '2026-10-20' }).data.length], [0, 1]);

eq('lock ถูกปล่อยทุกครั้ง', lockHeld, false);

console.log('\n── รายงานการขาย (1.8.1 แยกพนักงาน / 1.8.2 แยกลูกค้า / 1.8.3 แยกสินค้า) ──');
// ข้อมูลของตัวเอง ไม่ยุ่งกับ sheets.products/customers ที่ใช้ไปแล้วด้านบน (report อ่านอย่างเดียว ไม่แตะอะไร แต่กันสับสนไว้ก่อน)
append(sheets.liff_users, { line_user_id: 'U_STAFF1', display_name: 'พนักงาน เอ', role: 'van_sales', tenant_id: 'T1', status: 'Yes' });
// last_sale_at ของ 500 ตั้งเองเลียนแบบสิ่งที่ touchCustomerLastSale (33_customers.gs) จะทำให้จริงตอนบันทึกบิล
// (ฮาร์เนสนี้ seed ตรงลง sales_orders ไม่ได้เดินผ่าน recordSale จริง จึงต้องตั้งมือให้ตรงกับบิลที่ seed ไว้ด้านล่าง)
// ★ ลูกค้า 500 มีอยู่แล้วจากตอนต้นไฟล์ (ร้านค้าเครดิต) — แก้ด้วย centralUpdate ไม่ใช่ append ซ้ำ ไม่งั้น record_id ชนกัน
ctx.centralUpdate('customers', 500, { status: 'active', last_sale_at: '2026-09-15' });
append(sheets.customers, { record_id: 501, customer_code: 'C-501', name: 'ร้านทดสอบสอง', tenant_id: 'T1', is_active: true, status: 'active', last_sale_at: '2026-09-10' });
append(sheets.customers, { record_id: 502, customer_code: 'C-502', name: 'ร้านที่หายไป', tenant_id: 'T1', is_active: true, status: 'active', last_sale_at: '2026-01-01' });
append(sheets.product_groups, { record_id: 900, name: 'วัสดุสิ้นเปลือง', description: '' });
append(sheets.products, { record_id: 22, product_code: 'P-500', name: 'ฟิล์มพันสินค้า', unit: 'ม้วน', group_id: 900, category: 'PACK', sub_category: 'ฟิล์ม', base_price: 0, is_active: true });

[
  { record_id: 9001, order_code: 'SO-9001', customer_id: 500, total: 1000, status: 'completed', sale_by: 'U_STAFF1', created_at: '2026-09-01 10:00:00' },
  { record_id: 9002, order_code: 'SO-9002', customer_id: 500, total: 500, status: 'completed', sale_by: 'U_STAFF1', created_at: '2026-09-15 10:00:00' },
  { record_id: 9003, order_code: 'SO-9003', customer_id: 501, total: 2000, status: 'completed', sale_by: 'admin:u1', created_at: '2026-09-10 10:00:00' },
  { record_id: 9004, order_code: 'SO-9004', customer_id: 500, total: 9999, status: 'cancelled', sale_by: 'U_STAFF1', created_at: '2026-09-05 10:00:00' },
  { record_id: 9005, order_code: 'SO-9005', customer_id: 500, total: 300, status: 'completed', sale_by: 'U_STAFF1', created_at: '2026-08-01 10:00:00' }   // นอกช่วงวันที่ที่จะดู
].forEach(o => append(tenantSheets.sales_orders, o));
[
  { record_id: 1, order_id: 9001, product_id: 10, base_qty: 20, line_total: 1000, is_free: 0 },
  { record_id: 2, order_id: 9002, product_id: 10, base_qty: 10, line_total: 500, is_free: 0 },
  { record_id: 3, order_id: 9002, product_id: 22, base_qty: 5, line_total: 0, is_free: 1 },
  { record_id: 4, order_id: 9003, product_id: 22, base_qty: 40, line_total: 2000, is_free: 0 },
  { record_id: 5, order_id: 9004, product_id: 10, base_qty: 999, line_total: 9999, is_free: 0 }   // อยู่ในบิลที่ยกเลิกแล้ว ต้องไม่ถูกนับ
].forEach(it => append(tenantSheets.order_items, it));

console.log('\n  -- 1.8.1 แยกพนักงาน --');
r = ctx.salesReportByStaff(MGR, { dateFrom: '2026-09-01', dateTo: '2026-09-16' });
eq('รวมยอดของ U_STAFF1 สองบิล (1,000+500=1,500) ไม่รวมบิลที่ยกเลิก/นอกช่วง', r.data.find(x => x.saleBy === 'U_STAFF1'),
  { saleBy: 'U_STAFF1', label: 'พนักงาน เอ', bills: 2, revenue: 1500, compareBills: null, compareRevenue: null, revenueChangePct: null });
eq('  ป้ายฝั่งแอดมินดึงชื่อจาก admin_users มาแสดง', r.data.find(x => x.saleBy === 'admin:u1').label, '[แอดมิน] ผู้จัดการฝ่ายจัดซื้อ');
eq('  เรียงจากยอดมากไปน้อย + ยอดรวมถูกต้อง', [r.data.map(x => x.saleBy), r.totalRevenue, r.totalBills], [['admin:u1', 'U_STAFF1'], 3500, 3]);
r = ctx.salesReportByStaff(MGR, { dateFrom: '2026-09-01', dateTo: '2026-09-16', compareDateFrom: '2026-09-01', compareDateTo: '2026-09-09' });
eq('เทียบช่วงเวลาได้ (ช่วงก่อน U_STAFF1 มีแค่บิลแรก 1,000)', r.data.find(x => x.saleBy === 'U_STAFF1'),
  { saleBy: 'U_STAFF1', label: 'พนักงาน เอ', bills: 2, revenue: 1500, compareBills: 1, compareRevenue: 1000, revenueChangePct: 50 });
fails('ไม่ระบุช่วงวันที่ → ปฏิเสธ', ctx.salesReportByStaff(MGR, {}), /ระบุช่วงวันที่/);
fails('วันที่กลับด้าน → ปฏิเสธ', ctx.salesReportByStaff(MGR, { dateFrom: '2026-09-30', dateTo: '2026-09-01' }), /ไม่มากกว่า/);

console.log('\n  -- 1.8.2 แยกลูกค้า + ร้านที่หายไป --');
r = ctx.salesReportByCustomer(MGR, { dateFrom: '2026-09-01', dateTo: '2026-09-16' });
eq('จัดอันดับร้าน 500 มาก่อน 501 (1,500 > 2,000? ไม่ — 501 มากกว่า จึงมาก่อน)', r.data.map(x => [x.customerId, x.revenue]), [['501', 2000], ['500', 1500]]);
// ★ อ้าง CLOCK ไม่ใช่วันจริง — ฝั่งโค้ดที่ทดสอบใช้นาฬิกาในกล่อง (FrozenDate) ถ้าที่นี่ใช้ `new Date()`
// ตัวจริง สองฝั่งจะคนละวันกันทุกวันที่ไม่ใช่ 23 ก.ย. 2026 (เจอ 1 ต.ค. 2026: คาด 273 ได้ 265)
const todayStr = CLOCK.toISOString().slice(0, 10);
r = ctx.salesReportByCustomer(MGR, { dateFrom: '2026-09-01', dateTo: '2026-09-16', lostDays: 60 });
eq('เฉพาะร้าน 502 (ซื้อครั้งสุดท้าย 2026-01-01) ติดร้านที่หายไป — 500/501 เพิ่งซื้อไม่เกิน 60 วัน ไม่ติด', r.lostCustomers.map(x => x.customerId), ['502']);
eq('  คำนวณจำนวนวันถูกต้อง', r.lostCustomers[0].daysSinceLastSale, ctx._daysBetween('2026-01-01', todayStr));
r = ctx.salesReportByCustomer(MGR, { dateFrom: '2026-09-01', dateTo: '2026-09-16', lostDays: 999999 });
eq('lostDays สูงมาก → ไม่มีใครติดร้านที่หายไปเลย', r.lostCustomerCount, 0);

console.log('\n  -- 1.8.3 แยกสินค้า/กลุ่มสินค้า --');
r = ctx.salesReportByProduct(MGR, { dateFrom: '2026-09-01', dateTo: '2026-09-16' });
eq('สินค้า 10 ขายรวม 20+10=30 หน่วยฐาน ยอด 1,500 (ไม่รวมบิลที่ยกเลิก)', r.products.find(x => x.productId === '10'),
  { productId: '10', productCode: 'P-100', productName: 'กล่องกระดาษ', groupId: '', groupName: '(ไม่มีกลุ่ม)', category: '', subCategory: '', qty: 30, freeQty: 0, revenue: 1500, bills: 2 });
eq('สินค้า 22 มีทั้งขายจริง (40, 2,000) และของแถม (5 หน่วย ไม่รวมยอด) พร้อมกลุ่มสินค้า — นับ 2 บิลเพราะแถมอยู่คนละบิลกับที่ขายจริง',
  r.products.find(x => x.productId === '22'),
  { productId: '22', productCode: 'P-500', productName: 'ฟิล์มพันสินค้า', groupId: '900', groupName: 'วัสดุสิ้นเปลือง', category: 'PACK', subCategory: 'ฟิล์ม', qty: 40, freeQty: 5, revenue: 2000, bills: 2 });
eq('สรุปตามกลุ่มสินค้า: วัสดุสิ้นเปลือง 2,000 / ไม่มีกลุ่ม 1,500', r.groups.map(g => [g.groupName, g.revenue]), [['วัสดุสิ้นเปลือง', 2000], ['(ไม่มีกลุ่ม)', 1500]]);
eq('สรุปตามหมวดหลัก (Category/subCategory): PACK/ฟิล์ม 2,000 · สินค้าที่ยังไม่มีหมวดรวมเป็น (ไม่มีหมวด) 1,500',
  r.categories.map(c => [c.category, c.subCategory, c.qty, c.freeQty, c.revenue]), [['PACK', 'ฟิล์ม', 40, 5, 2000], ['(ไม่มีหมวด)', '', 30, 0, 1500]]);
eq('ยอดรวมทั้งรายงาน = 3,500 (เท่ากับ 1.8.1)', r.totalRevenue, 3500);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
