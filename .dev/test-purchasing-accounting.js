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
/* ★★ หัวคอลัมน์ของชีตตัวแทนต้องมาจาก `TENANT_SHEET_TABS` ของจริง เหมือนที่ทำกับ CENTRAL_SHEETS
   เดิมก๊อปมาเขียนไว้เอง แล้ว **เงียบ**: `append()` เขียนเฉพาะคอลัมน์ที่มีในหัว ฟิลด์ที่ลิสต์นี้
   ไม่มี (tax_invoice_no, vat_amount, ship_round_no, …) จึงถูกทิ้งไปโดยไม่มีอะไรฟ้อง
   เทสต์ที่พึ่งฟิลด์พวกนั้นเลยผ่านด้วยค่า fallback แทนค่าจริง (เจอ 16 ต.ค. 2026 ตอนทำรายงานภาษี)
   ★ `doc_number_series` ยังต้องไม่มีแถวข้อมูล (คนละเรื่องกับไม่มีคอลัมน์) — ทดสอบว่า
     "ไม่เคยตั้งค่า → เลขออกมาเหมือนเดิมทุกตัวอักษร" ซึ่งห้ามพังเด็ดขาด */
const TENANT_COLS = (() => {
  const c = { Utilities: {}, Session: {}, PropertiesService: {}, LockService: {}, SpreadsheetApp: {},
    DriveApp: {}, CacheService: {}, Logger: { log() {} },
    // 13_tenants.gs อ้างค่าคงที่จาก 02_helpers.gs ตอนโหลด — ใส่ให้พอให้ไฟล์ประเมินผ่าน
    // (เราต้องการแค่ TENANT_SHEET_TABS ซึ่งเป็นข้อมูลล้วน)
    OWNER_TENANT_ID: 'HOUSE' };
  vm.createContext(c);
  vm.runInContext(B('13_tenants.gs') + '\nthis.__T = TENANT_SHEET_TABS;', c);
  return c.__T;
})();
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
  // ตัวจริงใน 02_helpers.gs ไปเปิดไฟล์บน Drive ผ่าน CacheService — กล่องทดสอบใช้ชีตจำลองแทน
  // (★ คืน [] ถ้าไม่มีชีตนั้น เหมือนของจริง — ไฟล์ตัวแทนเก่าอาจยังไม่มีแท็บใหม่)
  tenantObjectsIfExists: (t, n) => (tenantSheets[n] ? objs(tenantSheets[n]) : []),
  // ของจริงอ่านเฉพาะแถวที่ต้องการแล้ว (02_helpers.gs) — ตัวจำลองต้องให้ผลเหมือนการกรองจากทั้งแท็บ
  tenantRowById: (t, n, id) => objs(tenantSheets[n]).filter(o => String(o.record_id) === String(id)).pop() || null,
  tenantRowsWhere: (t, n, col, val) => objs(tenantSheets[n]).filter(o => String(o[col]) === String(val)),
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
  deleteRowsWhere: ctx.deleteRowsWhere, tenantObjects: ctx.tenantObjects, tenantObjectsIfExists: ctx.tenantObjectsIfExists, nowStr: ctx.nowStr, safeDateStr: ctx.safeDateStr,
  tenantRowById: ctx.tenantRowById, tenantRowsWhere: ctx.tenantRowsWhere };
ctx.SpreadsheetApp = { openById: () => { throw new Error('should not be called'); } };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '' }) };
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', '02_helpers.gs'), 'utf8'), ctx, { filename: '02_helpers.gs' });
Object.keys(_fakes).forEach(k => { if (_fakes[k]) ctx[k] = _fakes[k]; });
// 34_sales_status.gs โหลดมาเพื่อ _reservedQty()/getAvailableQty() ที่ listWarehouseStock (22_purchase_order.gs) เรียกใช้
// (ยอดจอง — guide ข้อ 1.3) ไม่ได้ทดสอบสถานะบิลขายจากไฟล์นี้โดยตรง (ดู .dev/test-sales-status.js)
// 41_sales_reports.gs โหลดมาเพื่อทดสอบรายงานการขาย 1.8.1/1.8.2/1.8.3 (ต่อท้ายไฟล์นี้ — อ่านอย่างเดียว ไม่แตะสถานะอื่น)
// 12_docnum.gs ถูกโหลดด้วยเพราะ _nextCentralDocNo อ่านรูปแบบผ่าน _docSeriesConfig/_periodKey ของไฟล์นั้น
['00_setup_sheets.gs', '12_docnum.gs', '17_pricing.gs', '18_pricing_engine.gs', '20_purchasing_master.gs', '21_purchase_requisition.gs', '22_purchase_order.gs', '33_customers.gs', '23_accounting.gs', '34_sales_status.gs', '41_sales_reports.gs', '48_delivery_rounds.gs', '49_credit_notes.gs', '50_cogs.gs', '51_tax_reports.gs', '52_cash_sales_gl.gs', '53_billing_notes.gs', '54_goods_returns.gs']
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
/* ★ ของบริษัทต้อง "ไม่" ตั้งหนี้ให้อัตโนมัติ — ต่างจากของตัวแทนโดยตั้งใจ ไม่ใช่ลืม
   บริษัทซื้อจากผู้ขายภายนอก ต้องรอใบแจ้งหนี้จริงของผู้ขายก่อน (เลขที่ใบ/ยอด/VAT อาจไม่ตรงกับใบรับของ)
   นั่นคือเหตุผลที่บัญชี 2150 GR-NI มีอยู่ตั้งแต่แรก */
eq('  ★ ไม่ตั้งหนี้ให้อัตโนมัติ (รอใบแจ้งหนี้จริงของผู้ขายก่อน)',
   [r.billNo === undefined, objs(sheets.ap_bills).some(b => String(b.gr_id) === String(GR1))], [true, false]);
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
/* เดิมฝั่งขายไม่เคยกั้นเลย — ตั้งลูกหนี้จากบิลของตัวแทนได้ และ _postJournal ลงสมุดบริษัทให้ทุกใบ
   = รับรู้รายได้ซ้ำ (บริษัทรับรู้ตอนขายให้ตัวแทนไปแล้วรอบหนึ่ง)
   ★ ตอนนี้ไม่ได้ "ห้าม" แล้ว แต่ "บังคับให้ลงถูกเล่ม": นั่งอยู่สมุดบริษัทแล้วออกใบให้ตัวแทนไม่ได้
   ต้องสวมสิทธิ์เข้าไปในตัวแทนก่อน แล้วใบนั้นจะไปอยู่ในสมุดของเขา ไม่ใช่ของบริษัท */
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

/* ★ อีกครึ่งของกติกาเดียวกัน: สวมสิทธิ์เข้าไปแล้ว "ต้องออกให้ได้" และต้องไปอยู่ในสมุดของตัวแทน
   ถ้าเทสต์มีแต่ฝั่ง "ปฏิเสธ" ใครมาปิดทางทั้งหมดทีหลังก็ยังเขียว ทั้งที่ตัวแทนทำบัญชีไม่ได้เลย */
const ownerTbBeforeAr = ctx.getTrialBalance(FIN, {}).totalDebit;
r = ctx.createArInvoice(BOSS, { tenantId: 'T9', customerId: 509, invoiceDate: '2026-08-01', subtotalExVat: 1000 });
ok('สวมสิทธิ์เข้าไปในตัวแทนแล้ว ออกใบแจ้งหนี้ให้ลูกค้าของเขาได้', r);
const T9INV = r.invoiceId;
eq('  ใบนี้อยู่ในสมุดของตัวแทน · เลขที่แยกเล่ม · งบบริษัทไม่ขยับเลย',
   [objs(sheets.ar_invoices).find(iv => String(iv.record_id) === String(T9INV)).tenant_id,
    /^INV-/.test(r.invoiceNo), ctx.getTrialBalance(FIN, {}).totalDebit], ['T9', true, ownerTbBeforeAr]);
eq('  รายได้เข้างบกำไรขาดทุนของตัวแทน ไม่ใช่ของบริษัท',
   [ctx.getIncomeStatement(BOSS, { tenantId: 'T9' }).totalIncome,
    ctx.getIncomeStatement(FIN, {}).totalIncome], [1000, 12000]);
eq('  บริษัทไม่เห็นใบนี้ในรายการลูกหนี้ของตัวเอง',
   ctx.listArInvoices(FIN, {}).data.some(iv => String(iv.id) === String(T9INV)), false);
fails('  รับชำระใบของตัวแทนจากสมุดบริษัทไม่ได้',
  ctx.receiveArPayment(FIN, { customerId: 509, receiptDate: '2026-08-10', allocations: [{ invoiceId: T9INV, amount: 100 }] }),
  /ไม่พบใบแจ้งหนี้/);
r = ctx.receiveArPayment(BOSS, { tenantId: 'T9', customerId: 509, receiptDate: '2026-08-10', method: 'cash',
  allocations: [{ invoiceId: T9INV, amount: 1070 }] });
ok('  รับชำระในสมุดของตัวแทนได้', r);
eq('  ใบสำคัญรับอยู่ในสมุดตัวแทน · ลูกหนี้ของเขาถูกตัดจนหมด · งบบริษัทยังไม่ขยับ',
   [objs(sheets.ar_receipts).find(x => String(x.record_id) === String(r.receiptId)).tenant_id,
    ctx.getTrialBalance(BOSS, { tenantId: 'T9' }).data.find(x => x.code === '1200').balance,
    ctx.getTrialBalance(FIN, {}).totalDebit], ['T9', 0, ownerTbBeforeAr]);

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
/* ★ 7 ต.ค. 2026 เลิกแทรกรหัสบริษัทในเลขแล้ว (เจ้าของระบบ: ไม่ได้ใส่ไว้ใน prefix แต่มันโผล่มาเอง)
   สิ่งที่ต้องจริงคือ **ตัวนับแยกเล่ม** ไม่ใช่รูปร่างข้อความ — ตัวแทนเพิ่งเปิดใบแรกจึงต้องได้ 0001
   ทั้งที่ฝั่งบริษัทออก PR ไปหลายใบแล้ว ถ้าใช้ตัวนับร่วมกันจะไม่ใช่ 0001 */
eq('  ตัวนับแยกเล่มของตัวแทน (ใบแรกของเขาต้องเป็น 0001 แม้บริษัทออกไปหลายใบแล้ว)',
   /^PR-\d{6}-0001$/.test(r.pr.prNo), true);
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
eq('  ใบสั่งซื้อก็เดินเล่มของตัวเอง (0001 ทั้งที่บริษัทออกไปหลายใบแล้ว)',
   /^PO-\d{6}-0001$/.test(r.po.poNo), true);
eq('  ระบบสร้างคลังของตัวแทนให้อัตโนมัติ', ctx.listWarehouses(TADMIN).data.map(w => [w.name, w.isDefault]), [['คลังของตัวแทน', true]]);
ok('  ส่งใบสั่งซื้อ', ctx.issuePurchaseOrder(TADMIN, { id: TPO }));
r = ctx.receiveGoods(TADMIN, { poId: TPO, receiveDate: '2026-09-25',
  items: [{ poItemId: ctx.getPurchaseOrder(TADMIN, { id: TPO }).po.items[0].id, qty: 20 }] });
ok('ตัวแทนรับของเข้าคลังตัวเองได้', r);
/* ★ 6 ต.ค. 2026 เปลี่ยนกติกา: เดิมใบรับของของตัวแทน "ไม่ลงบัญชีเลย" (journal_id ว่าง)
   ตอนนี้ลง **สมุดของตัวแทนเอง** — ตัวแทนซื้อขาดไปจากบริษัท สินค้าในคลังเขาเป็นสินทรัพย์ของเขา
   สิ่งที่ต้องไม่เปลี่ยนคือ "ไม่แตะสมุดบริษัท" ซึ่งยังคุมอยู่ด้วยสองบรรทัดถัดไป */
const TGRJV = r.journalId;
eq('  ใบรับของของตัวแทนลงบัญชีในสมุดของตัวแทน ไม่ใช่สมุดบริษัท',
   [!!TGRJV, objs(sheets.gl_journals).find(j => String(j.record_id) === String(TGRJV)).tenant_id], [true, TEN]);
eq('  สต็อกของตัวแทนเพิ่มขึ้น 20 ม้วน @50', ctx.listWarehouseStock(TADMIN, {}).data.map(x => [x.productCode, x.qty, x.avgCost]), [['P-300', 20, 50]]);
eq('  สต็อกของบริษัทไม่ถูกแตะ', ctx.listWarehouseStock(FIN, {}).totalValue, ownerStockValue);
eq('  งบทดลองของบริษัทไม่ขยับ', ctx.getTrialBalance(FIN, {}).totalDebit, ownerTbBefore);
eq('  บริษัทไม่เห็นใบรับของ/สต็อกของตัวแทนในรายการตัวเอง',
   [ctx.listGoodsReceipts(FIN, {}).data.some(g => String(g.id) === String(r.grId)),
    ctx.listStockLedger(FIN, {}).data.some(l => String(l.productId) === '12')], [false, false]);
const TGR = r.grId;
/* ★ 7 ต.ค. 2026 เปลี่ยนกติกา: ตัวแทนรับของ = ระบบตั้งหนี้ให้เลย ไม่ต้องกดเอง
   (ซื้อขาดจากบริษัท ของมาถึงพร้อมเอกสารขายของบริษัท ยอดรู้แน่ตั้งแต่วินาทีที่รับ ไม่มีอะไรให้รอ)
   สิ่งที่ยังต้องจริงเหมือนเดิม: ลงสมุดของเขา · เลขที่แยกเล่ม · งบบริษัทไม่ขยับ */
eq('  ★ ตั้งหนี้ให้อัตโนมัติตั้งแต่ตอนรับของ — ไม่ต้องกดเอง', /^AP-\d{6}-\d{4}$/.test(r.billNo || ''), true);
const TAUTOBILL = objs(sheets.ap_bills).find(b => String(b.gr_id) === String(TGR));
eq('  ใบตั้งหนี้อยู่ในสมุดของตัวแทน · งบบริษัทไม่ขยับ',
   [TAUTOBILL.tenant_id, ctx.getTrialBalance(FIN, {}).totalDebit], [TEN, ownerTbBefore]);
eq('  ล้าง GR-NI ของตัวแทนหมดพอดี (รับของ 1,000 → ตั้งหนี้ 1,000)',
   ctx.getTrialBalance(TADMIN, {}).data.find(x => x.code === '2150').balance, 0);
fails('  กดตั้งหนี้ซ้ำจากใบเดิมไม่ได้ (ระบบตั้งให้ไปแล้ว)',
  ctx.createApBillFromGr(BOSS, { grId: TGR, tenantId: TEN }), /ตั้งหนี้ไปแล้ว/);
fails('  บริษัทแตะใบรับของของตัวแทนตรงๆ ไม่ได้ (ต้องสวมสิทธิ์เข้าไปก่อน)',
  ctx.createApBillFromGr(FIN, { grId: TGR, billDate: '2026-09-25' }), /ไม่พบใบรับของ/);
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
eq('  เลขใบสำคัญเดินเล่มของตัวแทนเอง', /^JV-\d{6}-\d{4}$/.test(r.journalNo), true);
eq('  ใบนี้ถูกเก็บไว้ในสมุดของตัวแทน (tenant_id)',
   objs(sheets.gl_journals).find(j => String(j.record_id) === String(TJV)).tenant_id, TEN);

const tenJournalIds = ctx.listJournals(TADMIN, {}).data.map(j => String(j.id));
eq('  ตัวแทนเห็นใบของตัวเองครบ (รวมใบที่ระบบลงให้จากงานซื้อ) และไม่มีใบของบริษัทปนเลย',
   [tenJournalIds.indexOf(String(TJV)) >= 0,
    ctx.listJournals(TADMIN, {}).data.every(j =>
      objs(sheets.gl_journals).find(x => String(x.record_id) === String(j.id)).tenant_id === TEN)], [true, true]);
eq('  รายการใบสำคัญของบริษัทไม่มีใบของตัวแทนเพิ่มเข้ามา', ctx.listJournals(FIN, {}).total, ownerJvCount);
fails('  ตัวแทนเปิดใบสำคัญของบริษัทไม่ได้ (ตอบเหมือนไม่มี ไม่บอกว่ามีอยู่)',
  ctx.getJournal(TADMIN, { id: JV }), /ไม่พบใบสำคัญ/);
fails('  บริษัทเปิดใบสำคัญของตัวแทนตรงๆ ไม่ได้', ctx.getJournal(FIN, { id: TJV }), /ไม่พบใบสำคัญ/);
eq('  แต่ฝั่งบริษัทสวมสิทธิ์เข้าไปดูสมุดของตัวแทนได้ (กติกาข้อ 3)',
   ctx.getJournal(BOSS, { id: TJV, tenantId: TEN }).journal.journalNo, r.journalNo);

const tenTb = ctx.getTrialBalance(TADMIN, {});
eq('  งบทดลองของตัวแทนสมดุล และมีแต่รายการของตัวเอง (สินค้าคงเหลือ 1,000 จากงานซื้อ + เงินสด 500 จากใบสำคัญนี้)',
   [tenTb.totalDebit === tenTb.totalCredit, tenTb.data.find(x => x.code === '1110').balance,
    tenTb.data.find(x => x.code === '1300').balance], [true, 500, 1000]);
eq('  สินค้าคงเหลือในบัญชีของตัวแทน = มูลค่าสต็อกจริงในคลังของเขา',
   tenTb.data.find(x => x.code === '1300').balance, ctx.listWarehouseStock(TADMIN, {}).totalValue);
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
eq('  เลขที่ตั้งหนี้เดินเล่มของตัวแทนเอง', /^AP-\d{6}-\d{4}$/.test(r.billNo), true);
/* ตัวแทนมี 2 ใบแล้ว: ใบที่ตั้งจากใบรับของ (ระบบลงให้) + ใบค่าใช้จ่ายที่เพิ่งตั้งเอง
   เช็คด้วย "ทุกใบที่เห็นเป็นของสมุดตัวเอง" แทนการนับจำนวนตายตัว — เพิ่มเคสทีหลังแล้วไม่ต้องตามแก้เลข */
eq('  บริษัทไม่เห็นใบตั้งหนี้ของตัวแทน · ทุกใบที่ตัวแทนเห็นเป็นของสมุดตัวเอง',
   [ctx.listApBills(FIN, {}).data.length,
    ctx.listApBills(TADMIN, {}).data.map(b => b.id).indexOf(TBILL) >= 0,
    ctx.listApBills(TADMIN, {}).data.every(b =>
      objs(sheets.ap_bills).find(x => String(x.record_id) === String(b.id)).tenant_id === TEN)],
   [ownerBillCount, true, true]);
fails('  ตัวแทนจ่ายหนี้ใบของบริษัทไม่ได้',
  ctx.payApBills(TADMIN, { vendorId: TVENDOR, allocations: [{ billId: BILL2, amount: 100 }] }), /ไม่พบใบแจ้งหนี้/);
fails('  บริษัทจ่ายหนี้ใบของตัวแทนไม่ได้ (ต้องสวมสิทธิ์เข้าไปก่อน)',
  ctx.payApBills(FIN, { vendorId: VENDOR, allocations: [{ billId: TBILL, amount: 100 }] }), /ไม่พบใบแจ้งหนี้/);
r = ctx.payApBills(TADMIN, { vendorId: TVENDOR, paymentDate: '2026-10-03', method: 'cash', allocations: [{ billId: TBILL, amount: 1070 }] });
ok('  ตัวแทนจ่ายหนี้ของตัวเองได้', r);
eq('  ใบสำคัญจ่ายของตัวแทนอยู่ในสมุดตัวเอง และงบบริษัทยังไม่ขยับ',
   [objs(sheets.ap_payments).find(p => String(p.record_id) === String(r.paymentId)).tenant_id,
    ctx.getTrialBalance(FIN, {}).totalDebit], [TEN, ownerBook.totalDebit]);
/* ตัวแทนจ่ายใบค่าใช้จ่ายครบแล้ว เหลือค้างแต่ใบที่ตั้งจากใบรับของ — และต้องเป็นของผู้ขายของเขาเอง
   ไม่ใช่ผู้ขายของบริษัท (ชื่อผู้ขายคนละชุดกันคนละสมุด) */
const tenAging = ctx.getApAging(TADMIN, { asOf: '2026-10-20' }).data;
eq('  อายุหนี้: ของใครของมัน',
   [tenAging.length, tenAging[0].partyName,
    ctx.getApAging(FIN, { asOf: '2026-10-20' }).data.length], [1, 'ร้านค้าส่งเชียงใหม่', ownerApAging]);

// ลูกหนี้: ยังไม่เปิดให้ตัวแทนตั้งลูกหนี้ (ข้อ 4 ของแผน) แต่ห้ามแตะใบของบริษัทได้แล้ววันนี้
eq('  ตัวแทนไม่เห็นใบแจ้งหนี้ลูกค้าของบริษัท',
   [ctx.listArInvoices(TADMIN, {}).data.length, ctx.listArInvoices(FIN, {}).data.length], [0, ownerArCount]);
fails('  ตัวแทนรับชำระใบแจ้งหนี้ของบริษัทไม่ได้',
  ctx.receiveArPayment(TADMIN, { customerId: 500, receiptDate: '2026-10-03',
    allocations: [{ invoiceId: ctx.listArInvoices(FIN, {}).data[0].id, amount: 10 }] }), /ไม่พบใบแจ้งหนี้/);
eq('  อายุลูกหนี้ของตัวแทนว่าง · ของบริษัทยังอยู่ครบ',
   [ctx.getArAging(TADMIN, { asOf: '2026-10-20' }).data.length,
    ctx.getArAging(FIN, { asOf: '2026-10-20' }).data.length], [0, 1]);

console.log('\n── ลงบัญชีย้อนหลังให้ใบรับของเก่าของตัวแทน (เจ้าของระบบ 7 ต.ค. 2026) ──');
/* "ยอดยกมาของ BDC เริ่มนับวันแรกที่มีข้อมูล" = ไม่มีใบยอดยกมาแยก สมุดเริ่มนับจากเอกสารใบแรกที่มีจริง
   จึงต้องเดินย้อนไปลงให้ครบ · ★ และต้องไม่แตะใบของบริษัท ซึ่งลงบัญชีมาตั้งแต่ต้นแล้ว */
{
  // จำลองใบรับของยุคก่อนมีสมุดตัวแทน: posted แต่ journal_id ว่าง
  const oldGrId = ctx.centralNextId('goods_receipts');
  append(sheets.goods_receipts, { record_id: oldGrId, tenant_id: TEN, gr_no: 'GR-OLD-1', po_id: '', vendor_id: TVENDOR,
    warehouse_id: 1, receive_date: '2026-08-15', status: 'posted', journal_id: '', created_at: '2026-08-15 09:00:00' });
  append(sheets.gr_items, { record_id: ctx.centralNextId('gr_items'), gr_id: oldGrId, product_id: 12,
    qty: 10, unit_code: 'ม้วน', unit_factor: 1, base_qty: 10, unit_cost: 40, amount: 400 });
  // ใบของบริษัทที่ยอดเป็นศูนย์ (journal_id ว่างด้วยเหตุอื่น) — ห้ามแตะ
  const ownerGrId = ctx.centralNextId('goods_receipts');
  append(sheets.goods_receipts, { record_id: ownerGrId, tenant_id: '', gr_no: 'GR-OWNER-0', po_id: '', vendor_id: VENDOR,
    warehouse_id: 1, receive_date: '2026-08-15', status: 'posted', journal_id: '', created_at: '2026-08-15 09:00:00' });

  fails('ไม่ใช่ super_admin → ปฏิเสธ', ctx.backfillGrJournals(FIN, {}), /super_admin/);

  const tbBefore = ctx.getTrialBalance(TADMIN, {}).data.find(x => x.code === '1300').balance;
  let r = ctx.backfillGrJournals(SUPER, {});
  eq('ดูอย่างเดียว (ไม่ส่ง commit) → บอกว่าจะลงกี่ใบ แต่ยังไม่เขียนอะไรเลย',
    [r.success, r.commit, r.posted, objs(sheets.goods_receipts).find(g => g.record_id === oldGrId).journal_id,
     ctx.getTrialBalance(TADMIN, {}).data.find(x => x.code === '1300').balance], [true, false, 1, '', tbBefore]);
  eq('  ★ ใบของบริษัทไม่อยู่ในรายการที่จะลงให้', r.data.every(x => x.grNo !== 'GR-OWNER-0'), true);

  r = ctx.backfillGrJournals(SUPER, { commit: true });
  const oldGr = objs(sheets.goods_receipts).find(g => g.record_id === oldGrId);
  eq('ลงจริง → ใบได้ journal_id และยอดเข้าสมุดของตัวแทน',
    [r.posted, !!oldGr.journal_id,
     objs(sheets.gl_journals).find(j => String(j.record_id) === String(oldGr.journal_id)).tenant_id,
     ctx.getTrialBalance(TADMIN, {}).data.find(x => x.code === '1300').balance], [1, true, TEN, tbBefore + 400]);
  eq('  ★ ลงตามวันที่รับของจริง ไม่ใช่วันที่รัน (ไม่งั้นยอดไปโผล่ผิดงวด)',
    objs(sheets.gl_journals).find(j => String(j.record_id) === String(oldGr.journal_id)).journal_date, '2026-08-15');
  eq('  ใบของบริษัทไม่ถูกแตะ', objs(sheets.goods_receipts).find(g => g.record_id === ownerGrId).journal_id, '');

  const jvCount = sheets.gl_journals.rows.length;
  r = ctx.backfillGrJournals(SUPER, { commit: true });
  eq('รันซ้ำไม่ลงซ้ำ (ใบที่มี journal_id แล้วถูกข้าม)', [r.posted, sheets.gl_journals.rows.length], [0, jvCount]);
}

console.log('\n── ตัวแทนลงบัญชีของตัวเองได้ทุกอย่าง (เจ้าของระบบ 7 ต.ค. 2026) ──');
/* เดิมตัวแทนไม่มีโมดูล accounting เลย ฝั่งบริษัทต้องทำแทนให้ · ตอนนี้ทำเองได้ทั้งหมด
   แต่ยังเป็น "ของตัวเอง" เท่านั้น — การกรองด้วย _inBook เป็นตัวกั้น ไม่ใช่การไม่มีสิทธิ์ */
{
  const before = ctx.getTrialBalance(FIN, {}).totalDebit;
  let r = ctx.postManualJournal(TADMIN, { date: '2026-10-05', memo: 'ตัวแทนปรับปรุงยอดเอง',
    lines: [{ accountCode: '1110', debit: 200, credit: 0 }, { accountCode: '1120', debit: 0, credit: 200 }] });
  ok('ตัวแทนลงใบสำคัญเองได้', r);
  eq('  ลงในสมุดของตัวเอง และงบบริษัทไม่ขยับ',
    [objs(sheets.gl_journals).find(j => String(j.record_id) === String(r.journalId)).tenant_id,
     ctx.getTrialBalance(FIN, {}).totalDebit], [TEN, before]);
  ok('  ตัวแทนกลับรายการใบของตัวเองได้', ctx.voidJournal(TADMIN, { id: r.journalId, date: '2026-10-05', reason: 'ลงผิด' }));
  ok('  ตัวแทนเปิดงบการเงินของตัวเองได้', ctx.getBalanceSheet(TADMIN, { asOf: '2026-12-31' }));
}

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

/* ══════════ ใบลดหนี้ (49_credit_notes.gs · 15 ต.ค. 2026) ══════════
   เกิดจากช่องว่างจริง: ยกเลิกบิลที่ออกใบกำกับภาษีไปแล้ว ระบบไม่มีอะไรให้ทำต่อ ต้องไปกลับรายการบัญชีเอง
   ★ ใบลดหนี้เป็นเอกสารภาษี (ม.86/10) ต้องอ้างใบกำกับเดิมและเหตุผลเสมอ
   ★★ ของที่ต้องยืนยัน: ลงบัญชีกลับทางพอดี · ยอดค้างลดลงจริงทุกที่ที่มีการคิดยอดค้าง · ลดเกินไม่ได้ */
ctx.HOUSE_TENANT_ID = ctx.HOUSE_TENANT_ID || 'HOUSE';   // 13_tenants.gs ไม่ได้โหลดในชุดนี้ แต่ _saleStockScope ต้องใช้ตอนคืนของ
console.log('\n── ใบลดหนี้ (Credit Note) ──');
{
  append(tenantSheets.sales_orders, { record_id: 91, order_code: 'SO-CN-01', customer_id: 500, subtotal: 10700,
    discount: 0, total: 10700, payment_method: 'credit_term', status: 'completed', created_at: '2026-10-15 09:00:00',
    apply_vat: 'TRUE', vat_type: 'inclusive', vat_rate: 0.07, subtotal_ex_vat: 10000, vat_amount: 700, exempt_amount: 0 });
  append(tenantSheets.order_items, { record_id: 9101, order_id: 91, product_id: '20', unit_code: 'CT', unit_factor: 10,
    qty: 10, base_qty: 100, price: 1070, line_total: 10700, line_discount: 0, is_free: 0, tax_status: 'vat' });

  let cr = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 91, invoiceDate: '2026-10-15', dueDays: 30 });
  ok('ตั้งลูกหนี้จากบิลที่จะใช้ทดสอบใบลดหนี้', cr);
  const IV = cr.invoiceId;
  const invRow = () => ctx.listArInvoices(FIN, {}).data.find(x => x.id === IV);

  let d = ctx.getArCreditNoteDraft(FIN, { invoiceId: IV });
  eq('ร่างใบลดหนี้: ดึงรายการจากบิลขายมาให้ พร้อมยอดที่ลดได้',
    [d.success, d.lines.length, d.lines[0].qty, d.lines[0].unitPrice, d.invoice.creditable], [true, 1, 10, 1070, 10700]);

  fails('ไม่ระบุเหตุผล → ปฏิเสธ (กฎหมายบังคับให้แสดงบนใบ)',
    ctx.createArCreditNote(FIN, { invoiceId: IV, lines: [{ productId: '20', qty: 1, unitPrice: 1070 }] }), /เหตุผล/);
  fails('ไม่มีรายการ → ปฏิเสธ',
    ctx.createArCreditNote(FIN, { invoiceId: IV, reasonCode: 'return', lines: [] }), /อย่างน้อย 1 รายการ/);
  fails('ลดเกินยอดใบ → ปฏิเสธ',
    ctx.createArCreditNote(FIN, { invoiceId: IV, reasonCode: 'return', lines: [{ productId: '20', qty: 20, unitPrice: 1070, taxStatus: 'vat' }] }),
    /ไม่เกิน/);

  /* ★ ของกลับเข้า "คลังของเจ้าของบิล" — บิลใบนี้เป็นของตัวแทน T1 ของจึงกลับเข้าคลัง T1
     ไม่ใช่คลังกลางของบริษัท (ซึ่งเป็นคนละ scope กัน) · เทสต์จึงต้องดูที่ scope เดียวกับที่บิลตัดของออกไป */
  const stockOfT1 = () => (ctx._scoped('warehouse_stock', 'T1').find(w => String(w.product_id) === '20') || { qty: 0 }).qty;
  const stockBefore = stockOfT1();
  let r1 = ctx.createArCreditNote(FIN, { invoiceId: IV, reasonCode: 'return', creditDate: '2026-10-16', returnStock: true,
    vatRate: 0.07, lines: [{ itemId: 9101, productId: '20', unitCode: 'CT', unitFactor: 10, qty: 3, unitPrice: 1070, taxStatus: 'vat' }] });
  ok('ออกใบลดหนี้บางส่วน (คืนของ 3 ลัง)', r1);
  eq('  เลขที่ขึ้นต้นด้วย CN · ยอด 3,210', [/^CN-/.test(r1.creditNoteNo || ''), r1.total], [true, 3210]);

  let j2 = ctx.getJournal(FIN, { id: ctx.listArCreditNotes(FIN, {}).data[0].journalId }).journal;
  eq('  ★ ลงบัญชีกลับทางกับใบแจ้งหนี้พอดี: Dr รายได้ 3,000 + Dr ภาษีขาย 210 / Cr ลูกหนี้ 3,210',
    j2.lines.map(l => [l.accountCode, l.debit, l.credit]), [['4100', 3000, 0], ['2200', 210, 0], ['1200', 0, 3210]]);
  eq('  ยอดค้างของใบแจ้งหนี้ลดลงจริง (10,700 − 3,210)', [invRow().outstanding, invRow().creditedAmount], [7490, 3210]);
  eq('  ★ ของกลับเข้าคลังของเจ้าของบิลตามหน่วยฐาน (3 ลัง × 10 = 30 ชิ้น)', (stockOfT1() - stockBefore), 30);

  fails('รับชำระเกินยอดที่เหลือหลังลดหนี้ → ปฏิเสธ',
    ctx.receiveArPayment(FIN, { customerId: 500, allocations: [{ invoiceId: IV, amount: 10700 }] }), /ค้าง 7490/);
  let p = ctx.receiveArPayment(FIN, { customerId: 500, receiptDate: '2026-10-20', method: 'transfer',
    allocations: [{ invoiceId: IV, amount: 7490 }] });
  eq('จ่ายส่วนที่เหลือครบ → ใบปิดเป็น paid ทั้งที่ได้เงินไม่เต็มยอดใบ',
    [p.success, invRow().status, invRow().outstanding], [true, 'paid', 0]);

  console.log('  -- ใบที่ลดหนี้เต็มจำนวน (ยกเลิกการขายหลังออกใบกำกับ) --');
  append(tenantSheets.sales_orders, { record_id: 92, order_code: 'SO-CN-02', customer_id: 500, subtotal: 1070,
    discount: 0, total: 1070, payment_method: 'credit_term', status: 'completed', created_at: '2026-10-15 10:00:00',
    apply_vat: 'TRUE', vat_type: 'inclusive', vat_rate: 0.07, subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0 });
  append(tenantSheets.order_items, { record_id: 9201, order_id: 92, product_id: '20', unit_code: 'CT', unit_factor: 10,
    qty: 1, base_qty: 10, price: 1070, line_total: 1070, line_discount: 0, is_free: 0, tax_status: 'vat' });
  cr = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 92, invoiceDate: '2026-10-15', dueDays: 30 });
  const IV2 = cr.invoiceId;
  const agingBefore = ctx.getArAging(FIN, {}).data.rows ? ctx.getArAging(FIN, {}).data.rows.length : JSON.stringify(ctx.getArAging(FIN, {}).data).length;
  r1 = ctx.createArCreditNote(FIN, { invoiceId: IV2, reasonCode: 'cancel', creditDate: '2026-10-16', returnStock: false,
    vatRate: 0.07, lines: [{ itemId: 9201, productId: '20', unitCode: 'CT', unitFactor: 10, qty: 1, unitPrice: 1070, taxStatus: 'vat' }] });
  ok('ลดหนี้เต็มจำนวน (ไม่คืนของ — ของเสียหาย/ทิ้งไปแล้ว)', r1);
  const iv2 = ctx.listArInvoices(FIN, {}).data.find(x => x.id === IV2);
  eq('  ใบปิดด้วยสถานะ credited (ไม่ใช่ paid — ลูกค้าไม่ได้จ่ายเงิน) · ค้าง 0', [iv2.status, iv2.outstanding], ['credited', 0]);
  eq('  ไม่โผล่ในรายงานอายุหนี้อีก', JSON.stringify(ctx.getArAging(FIN, {}).data).indexOf(iv2.invoiceNo), -1);
  fails('  ลดซ้ำอีกไม่ได้ ลดไปเต็มจำนวนแล้ว',
    ctx.createArCreditNote(FIN, { invoiceId: IV2, reasonCode: 'cancel', lines: [{ productId: '20', qty: 1, unitPrice: 1070, taxStatus: 'vat' }] }),
    /ไม่เกิน/);

  const cns = ctx.listArCreditNotes(FIN, {}).data;
  eq('รายการใบลดหนี้: สองใบ พร้อมเลขใบกำกับ/ใบแจ้งหนี้ที่อ้างถึง และธงคืนของ',
    cns.map(c => [/^CN-/.test(c.creditNoteNo), c.total, c.stockReturned]).sort(), [[true, 1070, false], [true, 3210, true]].sort());
}

console.log('\n── ใบเพิ่มหนี้ (Debit Note) ──');
{
  /* ★ คู่แฝดของใบลดหนี้ — ทางเดินโค้ดเดียวกัน ต่างแค่ทิศทางบัญชี/สต็อก และ "ไม่มีเพดาน"
     ที่ต้องยืนยันคือ: ลูกหนี้เพิ่มจริง · ใบที่ปิดไปแล้วกลับมาค้างได้ · ของออกจากคลังเมื่อสั่ง */
  append(tenantSheets.sales_orders, { record_id: 93, order_code: 'SO-DN-01', customer_id: 500, subtotal: 1070,
    discount: 0, total: 1070, payment_method: 'credit_term', status: 'completed', created_at: '2026-10-15 11:00:00',
    apply_vat: 'TRUE', vat_type: 'inclusive', vat_rate: 0.07, subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0 });
  append(tenantSheets.order_items, { record_id: 9301, order_id: 93, product_id: '20', unit_code: 'CT', unit_factor: 10,
    qty: 1, base_qty: 10, price: 1070, line_total: 1070, line_discount: 0, is_free: 0, tax_status: 'vat' });
  let cr3 = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 93, invoiceDate: '2026-10-15', dueDays: 30 });
  const IV3 = cr3.invoiceId;
  const iv3 = () => ctx.listArInvoices(FIN, {}).data.find(x => x.id === IV3);

  // จ่ายครบก่อน แล้วค่อยพบว่าคิดเงินขาด
  ctx.receiveArPayment(FIN, { customerId: 500, receiptDate: '2026-10-18', method: 'cash',
    allocations: [{ invoiceId: IV3, amount: 1070 }] });
  eq('ตั้งต้น: ใบนี้จ่ายครบแล้ว', [iv3().status, iv3().outstanding], ['paid', 0]);

  const stockT1 = () => (ctx._scoped('warehouse_stock', 'T1').find(w => String(w.product_id) === '20') || { qty: 0 }).qty;
  const before = stockT1();
  let dn = ctx.createArDebitNote(FIN, { invoiceId: IV3, reasonCode: 'extra', creditDate: '2026-10-19', moveStock: true,
    vatRate: 0.07, lines: [{ itemId: 9301, productId: '20', unitCode: 'CT', unitFactor: 10, qty: 2, unitPrice: 1070, taxStatus: 'vat' }] });
  ok('ออกใบเพิ่มหนี้ (ส่งของเพิ่ม 2 ลัง)', dn);
  eq('  เลขขึ้นต้นด้วย DN · ยอด 2,140', [/^DN-/.test(dn.noteNo || ''), dn.total], [true, 2140]);

  let j3 = ctx.getJournal(FIN, { id: ctx.listArDebitNotes(FIN, {}).data[0].journalId }).journal;
  eq('  ★ ลงบัญชีทางเดียวกับใบแจ้งหนี้: Dr ลูกหนี้ 2,140 / Cr รายได้ 2,000 + Cr ภาษีขาย 140',
    j3.lines.map(l => [l.accountCode, l.debit, l.credit]), [['1200', 2140, 0], ['4100', 0, 2000], ['2200', 0, 140]]);
  eq('  ★ ใบที่ปิดไปแล้วกลับมาค้างอีกครั้ง ตามยอดที่เพิ่ม', [iv3().status, iv3().outstanding, iv3().debitedAmount], ['partial', 2140, 2140]);
  eq('  ★ ของออกจากคลัง (ตรงข้ามกับใบลดหนี้): 2 ลัง × 10 = −20 ชิ้น', (stockT1() - before), -20);

  dn = ctx.createArDebitNote(FIN, { invoiceId: IV3, reasonCode: 'freight', creditDate: '2026-10-19',
    vatRate: 0.07, lines: [{ productId: '', unitCode: '', qty: 1, unitPrice: 500, taxStatus: 'vat' }] });
  eq('เพิ่มหนี้ได้เกินยอดใบเดิม (ไม่มีเพดาน — คิดเงินขาดเท่าไรก็เพิ่มได้เท่านั้น)',
    [dn.success, iv3().outstanding], [true, 2640]);
  fails('ไม่ระบุเหตุผล → ปฏิเสธ (กฎหมายบังคับเหมือนใบลดหนี้)',
    ctx.createArDebitNote(FIN, { invoiceId: IV3, lines: [{ productId: '', qty: 1, unitPrice: 100 }] }), /เหตุผล/);

  let p3 = ctx.receiveArPayment(FIN, { customerId: 500, receiptDate: '2026-10-25', method: 'transfer',
    allocations: [{ invoiceId: IV3, amount: 2640 }] });
  eq('จ่ายส่วนที่เพิ่มครบ → ใบปิดอีกครั้ง', [p3.success, iv3().status, iv3().outstanding], [true, 'paid', 0]);
}

/* ══════════ ต้นทุนขาย COGS (50_cogs.gs · 16 ต.ค. 2026) ══════════
   ★ ก่อนมีตัวนี้ การตัดสต็อกไม่ลงบัญชีเลย งบกำไรขาดทุนจึงไม่มีต้นทุนขายสักบาท
     และบัญชี 1300 สินค้าคงเหลือโตขึ้นเรื่อยๆ ไม่เคยลด
   ★★ สิ่งที่ต้องคุมให้แน่น 3 ข้อ:
     1. ปิดไว้เป็นค่าเริ่มต้น — deploy แล้วต้องไม่มีใบสำคัญงอกเองในสมุดที่ปิดงวดไปแล้ว
     2. ขาไปกับขากลับต้องหักล้างกันสนิท แม้ต้นทุนเฉลี่ยจะขยับไปแล้วระหว่างนั้น
     3. ไม่ย้อนหลังก่อนวันที่เริ่มตัด (งวดที่ยื่นภาษีไปแล้วห้ามขยับ) */
console.log('\n── ต้นทุนขาย (COGS) ──');
{
  /* ★★ บิลทดสอบเป็นของตัวแทน T1 → ของต้องอยู่ใน **คลังของ T1** ไม่ใช่คลังกลาง
     (`_saleStockScope` เป็นตัวตัดสิน) · เคยพลาดตรงนี้มาแล้วตอนเทสต์ใบลดหนี้ 15 ต.ค.
     ใส่ของผิดคลังแล้วอาการคือ "ของในคลังไม่พอ" ซึ่งดูเหมือนโค้ดผลิตพัง ทั้งที่เทสต์ผิดเอง */
  const SC = ctx._saleStockScope('T1');
  const WH = ctx._ensureScopeWarehouse(SC);
  const bal = code => {
    let d = 0, c = 0;
    ctx.centralObjects('gl_journal_lines').forEach(l => {
      if (String(l.account_code) !== code) return;
      d += Number(l.debit) || 0; c += Number(l.credit) || 0;
    });
    return { dr: Math.round(d * 100) / 100, cr: Math.round(c * 100) / 100 };
  };
  const cogs0 = bal('5100'), inv0 = bal('1300');

  // รับของเข้าคลังสองล็อตคนละราคา เพื่อให้ average กับ FIFO ให้คำตอบต่างกันจริง
  ctx._applyStockIn(SC, WH, '70', 100, 10, 'receipt', 'TEST', 'L1', 'ล็อต 1 @10', 'tester');
  ctx._applyStockIn(SC, WH, '70', 100, 20, 'receipt', 'TEST', 'L2', 'ล็อต 2 @20', 'tester');
  const avgNow = ctx._scoped('warehouse_stock', SC).filter(r => String(r.product_id) === '70')[0].avg_cost;
  eq('ตั้งต้น: รับ 100@10 + 100@20 → ต้นทุนเฉลี่ย 15', avgNow, 15);

  const mkOrder = (id, code) => {
    append(tenantSheets.sales_orders, { record_id: id, order_code: code, customer_id: 500, subtotal: 5000,
      discount: 0, total: 5000, payment_method: 'credit_term', fulfillment_type: 'office_delivery',
      status: 'accepted', created_at: '2026-10-16 09:00:00' });
    append(tenantSheets.order_items, { record_id: id * 100, order_id: id, product_id: '70', unit_code: 'CT',
      unit_factor: 10, qty: 4, base_qty: 40, price: 1250, line_total: 5000, line_discount: 0, is_free: 0, tax_status: 'vat' });
    return ctx.tenantRowById('T1', 'sales_orders', id);
  };

  // ── 1. ปิดอยู่เป็นค่าเริ่มต้น ──
  eq('ค่าเริ่มต้น = ไม่ตัดต้นทุนอัตโนมัติ', ctx.getAccountingSettings(FIN, {}).settings.costMethod, 'none');
  /* ★★ ค่าตั้งเป็นของ "สมุด" ไม่ใช่ของทั้งระบบ — บิลนี้เป็นของตัวแทน T1 ต้นทุนจึงลงสมุด T1
     และต้องอ่านค่าตั้งของ T1 · ตัวแทนเป็นคนละนิติบุคคล จะใช้วิธีคิดต้นทุนคนละแบบกับบริษัทก็ได้ */
  let o = mkOrder(95, 'SO-COGS-OFF');
  let r = ctx.applySaleWarehouseStock('T1', o, -1, 'ตัดของ', 'tester');
  eq('★ ปิดอยู่ → ตัดสต็อกได้ตามปกติ แต่ไม่ลงบัญชีต้นทุน',
    [r.success, r.cogs.posted, bal('5100').dr], [true, false, cogs0.dr]);

  // ── 2. เปิดแบบต้นทุนเฉลี่ย ──
  ok('เปิดใช้ในสมุดของ T1: ต้นทุนเฉลี่ยถ่วงน้ำหนัก เริ่ม 16 ต.ค.',
    ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'average', cogsFrom: '2026-10-16' }));
  eq('  ต้องระบุวันที่เริ่มเสมอเมื่อเปิดใช้',
    ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'average' }).success, false);
  /* ★ T1 = "ตัวแทนบ้าน" ซึ่ง `_normBook` ยุบเข้าสมุดบริษัท — ตั้งของ T1 = ตั้งของบริษัท (ถูกแล้ว)
     การแยกสมุดจริงต้องวัดกับตัวแทนจริง (T9) ซึ่งเป็นคนละนิติบุคคล */
  eq('ตั้งของตัวแทนบ้าน = ตั้งของสมุดบริษัท (ยุบเป็นสมุดเดียวกันตามกติกาทั้งโมดูล)',
    ctx.getAccountingSettings(FIN, {}).settings.costMethod, 'average');
  /* ★ วัดที่ `_acctSettings` ตรงๆ ไม่ผ่าน session — การสวมสิทธิ์ข้ามสมุดเป็นคนละเรื่อง
     ที่มีเทสต์ของตัวเองอยู่แล้ว (หมวดแยกข้อมูลตัวแทน) ที่ต้องการพิสูจน์ตรงนี้คือ
     **แถวค่าตั้งของสมุดหนึ่งต้องไม่ถูกอ่านเป็นของอีกสมุด** ซึ่งเป็นเรื่องของตัวอ่านเอง */
  eq('★★ สมุดของตัวแทนจริง (T9) ต้องยังปิดอยู่ — ค่าตั้งไม่รั่วข้ามนิติบุคคล',
    ctx._acctSettings('T9').costMethod, 'none');
  eq('  และสมุดบริษัทอ่านได้ค่าที่ตั้งไว้จริง', ctx._acctSettings('').costMethod, 'average');

  o = mkOrder(96, 'SO-COGS-AVG');
  r = ctx.applySaleWarehouseStock('T1', o, -1, 'ตัดของ', 'tester');
  eq('★ ตัด 40 ชิ้น @เฉลี่ย 15 → ลงต้นทุน 600', [r.cogs.posted, r.cogs.amount], [true, 600]);
  eq('  Dr 5100 ต้นทุนขาย 600 / Cr 1300 สินค้าคงเหลือ 600',
    [bal('5100').dr - cogs0.dr, bal('1300').cr - inv0.cr], [600, 600]);

  // ── 3. กลับรายการต้องหักล้างด้วยยอดเดิม แม้ต้นทุนเฉลี่ยขยับไปแล้ว ──
  ctx._applyStockIn(SC, WH, '70', 200, 90, 'receipt', 'TEST', 'L3', 'ล็อตแพง', 'tester');
  const avgAfter = ctx._scoped('warehouse_stock', SC).filter(r2 => String(r2.product_id) === '70')[0].avg_cost;
  eq('  รับของแพงเข้ามาอีก ต้นทุนเฉลี่ยขยับขึ้นจริง', avgAfter > 15, true);
  r = ctx.applySaleWarehouseStock('T1', o, 1, 'ยกเลิกบิล', 'tester');
  eq('★★ กลับรายการใช้ "ยอดเดิมที่เคยลง" ไม่ใช่ต้นทุนใหม่ → 600 เท่าเดิม', r.cogs.amount, 600);
  eq('★★ ขาไป-ขากลับหักล้างกันสนิท ทั้งสองบัญชี',
    [bal('5100').dr - bal('5100').cr - (cogs0.dr - cogs0.cr),
     bal('1300').cr - bal('1300').dr - (inv0.cr - inv0.dr)], [0, 0]);

  // ── 4. ไม่ย้อนหลังก่อนวันที่เริ่มตัด ──
  append(tenantSheets.sales_orders, { record_id: 97, order_code: 'SO-COGS-OLD', customer_id: 500, subtotal: 100,
    discount: 0, total: 100, payment_method: 'credit_term', fulfillment_type: 'office_delivery',
    status: 'accepted', created_at: '2026-09-30 09:00:00' });
  append(tenantSheets.order_items, { record_id: 9700, order_id: 97, product_id: '70', unit_code: 'CT',
    unit_factor: 10, qty: 1, base_qty: 10, price: 100, line_total: 100, line_discount: 0, is_free: 0, tax_status: 'vat' });
  r = ctx.applySaleWarehouseStock('T1', ctx.tenantRowById('T1', 'sales_orders', 97), -1, 'ตัดของ', 'tester');
  eq('★ บิลลงวันที่ก่อนวันเริ่มตัด → ไม่ลงต้นทุน (งวดที่ยื่นภาษีไปแล้วห้ามขยับ)',
    [r.success, r.cogs.posted], [true, false]);

  // ── 5. FIFO ให้คำตอบต่างจากเฉลี่ย และตรงกับล็อตจริง ──
  ok('สลับเป็น FIFO', ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'fifo', cogsFrom: '2026-10-16' }));
  ctx._applyStockIn(SC, WH, '71', 10, 10, 'receipt', 'TEST', 'F1', 'ล็อต 10@10', 'tester');
  ctx._applyStockIn(SC, WH, '71', 10, 30, 'receipt', 'TEST', 'F2', 'ล็อต 10@30', 'tester');
  append(tenantSheets.sales_orders, { record_id: 98, order_code: 'SO-COGS-FIFO', customer_id: 500, subtotal: 900,
    discount: 0, total: 900, payment_method: 'credit_term', fulfillment_type: 'office_delivery',
    status: 'accepted', created_at: '2026-10-16 09:00:00' });
  append(tenantSheets.order_items, { record_id: 9800, order_id: 98, product_id: '71', unit_code: 'CT',
    unit_factor: 5, qty: 3, base_qty: 15, price: 300, line_total: 900, line_discount: 0, is_free: 0, tax_status: 'vat' });
  r = ctx.applySaleWarehouseStock('T1', ctx.tenantRowById('T1', 'sales_orders', 98), -1, 'ตัดของ', 'tester');
  eq('★ FIFO: ขาย 15 ชิ้น = 10@10 + 5@30 = 250 (ถ้าใช้เฉลี่ย 20 จะได้ 300 ซึ่งคนละตัวเลข)',
    r.cogs.amount, 250);

  // ── 6. ต้นทุนมาตรฐานอ่านจากช่อง "ราคาทุน" ที่มีอยู่แล้ว ──
  append(sheets.products, { record_id: '72', product_code: 'P72', name: 'สินค้าต้นทุนคงที่', cost_price: 7, is_active: 'TRUE' });
  ctx._applyStockIn(SC, WH, '72', 50, 99, 'receipt', 'TEST', 'S1', 'รับแพงแต่ไม่ใช้', 'tester');
  ok('สลับเป็นต้นทุนมาตรฐาน', ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'standard', cogsFrom: '2026-10-16' }));
  append(tenantSheets.sales_orders, { record_id: 99, order_code: 'SO-COGS-STD', customer_id: 500, subtotal: 500,
    discount: 0, total: 500, payment_method: 'credit_term', fulfillment_type: 'office_delivery',
    status: 'accepted', created_at: '2026-10-16 09:00:00' });
  append(tenantSheets.order_items, { record_id: 9900, order_id: 99, product_id: '72', unit_code: 'CT',
    unit_factor: 10, qty: 2, base_qty: 20, price: 250, line_total: 500, line_discount: 0, is_free: 0, tax_status: 'vat' });
  r = ctx.applySaleWarehouseStock('T1', ctx.tenantRowById('T1', 'sales_orders', 99), -1, 'ตัดของ', 'tester');
  eq('★ ต้นทุนมาตรฐาน: 20 ชิ้น × ราคาทุน 7 = 140 (ไม่สนราคาที่รับเข้าจริง 99)', r.cogs.amount, 140);

  // ── 7. ลงซ้ำไม่ได้ ──
  r = ctx.applySaleWarehouseStock('T1', ctx.tenantRowById('T1', 'sales_orders', 99), -1, 'ตัดซ้ำ', 'tester');
  eq('★ ตัดรอบเดิมซ้ำ → ไม่ลงต้นทุนซ้ำ', r.cogs.posted, false);

  // ── 8. งบกำไรขาดทุนเห็นต้นทุนขายแล้ว ──
  const pl = ctx.getIncomeStatement(FIN, { tenantId: 'T1' });
  const cogsRow = (pl.expense || []).find(a => String(a.code) === '5100');
  /* ยอดคงเหลือ = เดบิต 990 (600 เฉลี่ย + 250 FIFO + 140 มาตรฐาน) − เครดิต 600 (ใบที่กลับรายการ) = 390
     ★ ผูกตัวเลขไว้เลย ไม่ใช่แค่ "> 0" — ถ้าวันหนึ่งมีใครทำให้ลงซ้ำหรือกลับรายการไม่ครบ
       เทสต์ที่เช็คแค่ "มากกว่าศูนย์" จะยังผ่านอยู่ทั้งที่งบเพี้ยนไปแล้ว */
  eq('★★ งบกำไรขาดทุนมีบรรทัดต้นทุนขายแล้ว (ก่อนหน้านี้ไม่มีเลย) · ยอด 990 − 600 = 390',
    [!!cogsRow, cogsRow && cogsRow.debit, cogsRow && cogsRow.credit, cogsRow && cogsRow.balance],
    [true, 990, 600, 390]);
}

/* ══════════ รายงานภาษีขาย/ภาษีซื้อ (51_tax_reports.gs · 16 ต.ค. 2026) ══════════
   ★★ ฐานของรายงานคือ **เอกสารภาษีที่ออกจริง ไม่ใช่ใบสำคัญบัญชี** — ภ.พ.30 รายงานใบกำกับภาษี
     ซึ่งเป็นคนละสิ่งกับรายการที่ลงบัญชีแล้ว · สร้างจากบัญชีเมื่อไหร่จะยื่นขาดทุกครั้งที่มีเอกสาร
     ที่ยังไม่ได้ลงบัญชี ซึ่งในระบบนี้มีจริง (ขายสดไม่เคยลงบัญชีเลย)
   ★ สิ่งที่ต้องคุม: นับใบกำกับครบทุกทาง (บิลเดี่ยว · รายรอบ · ใบลด/เพิ่มหนี้) ไม่นับซ้ำ
     ไม่นับใบที่ยกเลิก และ **ช่องเทียบกับบัญชีต้องชี้ส่วนต่างให้เห็น ไม่ใช่กลบ** */
console.log('\n── รายงานภาษีขาย / ภาษีซื้อ ──');
{
  const M = '2026-10';
  // บิลขายสด: ออกใบกำกับภาษีจริง แต่ไม่มีใบแจ้งหนี้ = ไม่เคยลงบัญชี
  append(tenantSheets.sales_orders, { record_id: 120, order_code: 'SO-VAT-CASH', customer_id: 500,
    subtotal: 1070, discount: 0, total: 1070, payment_method: 'cash', status: 'completed',
    created_at: '2026-10-05 09:00:00', tax_invoice_no: 'TAX-IV-202610-0100', tax_invoice_at: '2026-10-05 09:00:00',
    apply_vat: 'TRUE', vat_type: 'inclusive', vat_rate: 0.07, subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0 });
  // บิลที่ยกเลิกแล้ว ต้องไม่เข้ารายงาน
  append(tenantSheets.sales_orders, { record_id: 121, order_code: 'SO-VAT-CANCEL', customer_id: 500,
    subtotal: 5350, discount: 0, total: 5350, payment_method: 'cash', status: 'cancelled',
    created_at: '2026-10-06 09:00:00', tax_invoice_no: 'TAX-IV-202610-0101', tax_invoice_at: '2026-10-06 09:00:00',
    apply_vat: 'TRUE', vat_rate: 0.07, subtotal_ex_vat: 5000, vat_amount: 350, exempt_amount: 0 });
  // บิลเดือนก่อน ต้องไม่เข้าเดือนนี้
  append(tenantSheets.sales_orders, { record_id: 122, order_code: 'SO-VAT-SEP', customer_id: 500,
    subtotal: 2140, discount: 0, total: 2140, payment_method: 'cash', status: 'completed',
    created_at: '2026-09-20 09:00:00', tax_invoice_no: 'TAX-IV-202609-0099', tax_invoice_at: '2026-09-20 09:00:00',
    apply_vat: 'TRUE', vat_rate: 0.07, subtotal_ex_vat: 2000, vat_amount: 140, exempt_amount: 0 });

  const rep = ctx.getVatSalesReport(FIN, { month: M });
  const docs = (rep.rows || []).map(r => r.docNo);
  eq('★ นับเฉพาะใบกำกับของเดือนนั้น ไม่นับใบที่ยกเลิก',
    [docs.indexOf('TAX-IV-202610-0100') !== -1, docs.indexOf('TAX-IV-202610-0101'), docs.indexOf('TAX-IV-202609-0099')],
    [true, -1, -1]);
  const cash = (rep.rows || []).find(r => r.docNo === 'TAX-IV-202610-0100');
  eq('  แถวใบกำกับมีเลขผู้เสียภาษีของลูกค้า + มูลค่า/ภาษีแยกช่อง',
    [cash.exVat, cash.vat, cash.kind, cash.note], [1000, 70, 'ใบกำกับภาษี', 'ขายสด']);

  // ใบลดหนี้/ใบเพิ่มหนี้ของเดือนนั้นต้องเข้ารายงานด้วย (ลดหนี้ติดลบ)
  const cn = (rep.rows || []).filter(r => r.kind === 'ใบลดหนี้');
  const dn = (rep.rows || []).filter(r => r.kind === 'ใบเพิ่มหนี้');
  eq('★ ใบลดหนี้เข้ารายงานแบบติดลบ · ใบเพิ่มหนี้เป็นบวก',
    [cn.length > 0, cn.length ? cn[0].vat < 0 : null, dn.length > 0, dn.length ? dn[0].vat > 0 : null],
    [true, true, true, true]);

  eq('  ยอดรวมภาษี = ผลรวมทุกแถวเป๊ะ',
    rep.totals.vat, Math.round(rep.rows.reduce((s, r) => s + r.vat, 0) * 100) / 100);

  /* ★★ หัวใจของรายงาน: เอกสารกับบัญชีต้องตรงกัน ไม่ตรง = มีเอกสารที่ยังไม่ได้ลงบัญชี */
  eq('★★ ขายสดถูกนับว่า "ยังไม่ได้ลงบัญชี" และรายงานชี้ส่วนต่างให้เห็น',
    [rep.unposted.bills >= 1, rep.unposted.vat >= 70, Math.abs(rep.ledger.diff) > 0.009], [true, true, true]);

  const pur = ctx.getVatPurchaseReport(FIN, { month: M });
  eq('รายงานภาษีซื้ออ่านจากใบตั้งหนี้ผู้ขาย', pur.success, true);
  eq('  ยอดรวม = ผลรวมทุกแถว',
    pur.totals.vat, Math.round(pur.rows.reduce((s, r) => s + r.vat, 0) * 100) / 100);

  const sum = ctx.getVatSummary(FIN, { month: M });
  eq('★ สรุป: ภาษีขาย − ภาษีซื้อ = ยอดที่ต้องชำระ/ขอคืน',
    [sum.success, sum.net], [true, Math.round((rep.totals.vat - pur.totals.vat) * 100) / 100]);
  eq('  ป้ายบอกทิศทางถูกต้อง', sum.net >= 0 ? sum.netLabel === 'ภาษีที่ต้องชำระ' : /ขอคืน/.test(sum.netLabel), true);
  eq('★★ สรุปเตือนเรื่องเอกสารที่ยังไม่ได้ลงบัญชี (ไม่ปล่อยให้ยื่นด้วยยอดที่ขาด)',
    (sum.warnings || []).some(w => /ยังไม่ได้ลงบัญชี/.test(w)), true);

  eq('เดือนผิดรูป → ปฏิเสธ', ctx.getVatSalesReport(FIN, { month: '2026/10' }).success, false);
}

/* ══════════ ลงบัญชีขายสด (52_cash_sales_gl.gs · 16 ต.ค. 2026) ══════════
   ★★ ช่องว่างที่ปิด: รายได้กับภาษีขายเคยเข้าบัญชีผ่าน createArInvoice ทางเดียว ซึ่งเรียกเฉพาะ
     บิลเครดิต — ขายสดออกใบกำกับภาษีให้ลูกค้าจริงแต่ไม่มีรายการในสมุดสักบรรทัด
   ★ สิ่งที่ต้องคุม: ปิดไว้เป็นค่าเริ่มต้น · เดบิต = เครดิตเสมอ · ลงซ้ำไม่ได้ ·
     กลับรายการตอนยกเลิกด้วยยอดเดิม · บิลเครดิตต้องไม่ถูกลงซ้ำทางนี้ */
console.log('\n── ลงบัญชีขายสด ──');
{
  const bal = code => {
    let d = 0, c = 0;
    ctx.centralObjects('gl_journal_lines').forEach(l => {
      if (String(l.account_code) !== code) return;
      d += Number(l.debit) || 0; c += Number(l.credit) || 0;
    });
    return { dr: Math.round(d * 100) / 100, cr: Math.round(c * 100) / 100 };
  };
  const mkCash = (id, code, method, total, exVat, vat, taxNo) => {
    append(tenantSheets.sales_orders, { record_id: id, order_code: code, customer_id: 500,
      subtotal: total, discount: 0, total: total, payment_method: method, fulfillment_type: 'immediate',
      status: 'completed', created_at: '2026-10-16 09:00:00',
      tax_invoice_no: taxNo, tax_invoice_at: '2026-10-16 09:00:00',
      apply_vat: 'TRUE', vat_type: 'inclusive', vat_rate: 0.07,
      subtotal_ex_vat: exVat, vat_amount: vat, exempt_amount: 0 });
    return ctx.tenantRowById('T1', 'sales_orders', id);
  };

  // ── ปิดไว้เป็นค่าเริ่มต้น ──
  ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'none', cashSales: 'off' });
  let o = mkCash(140, 'SO-CASH-OFF', 'cash', 1070, 1000, 70, 'TAX-IV-900');
  let r = ctx.postCashSaleGl('T1', o, 'tester');
  eq('★ ปิดอยู่ → ไม่ลงบัญชี', [r.posted, /ยังไม่ได้เปิด/.test(r.skipped)], [false, true]);

  // ── เปิดใช้ ──
  r = ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'none', cashSales: 'on' });
  eq('เปิดแล้วไม่ระบุวันที่เริ่ม → ปฏิเสธ', r.success, false);
  ok('เปิดลงบัญชีขายสด เริ่ม 16 ต.ค.',
    ctx.saveAccountingSettings(FIN, { tenantId: 'T1', costMethod: 'none', cashSales: 'on', cashFrom: '2026-10-16' }));

  const cash0 = bal('1110'), sales0 = bal('4100'), vat0 = bal('2200');
  o = mkCash(141, 'SO-CASH-1', 'cash', 1070, 1000, 70, 'TAX-IV-901');
  r = ctx.postCashSaleGl('T1', o, 'tester');
  eq('★ ลงบัญชีขายสดได้ ยอด 1,070', [r.posted, r.amount, r.vat, r.revenue], [true, 1070, 70, 1000]);
  eq('★★ Dr 1110 เงินสด 1,070 / Cr 4100 รายได้ 1,000 + Cr 2200 ภาษีขาย 70',
    [bal('1110').dr - cash0.dr, bal('4100').cr - sales0.cr, bal('2200').cr - vat0.cr], [1070, 1000, 70]);

  // ── ลงซ้ำไม่ได้ ──
  r = ctx.postCashSaleGl('T1', o, 'tester');
  eq('★ เรียกซ้ำ → ไม่ลงใบที่สอง', [r.posted, /ไปแล้ว/.test(r.skipped)], [false, true]);

  // ── โอนเงินเข้าแบงก์ ──
  const bank0 = bal('1120');
  o = mkCash(142, 'SO-CASH-TRANSFER', 'transfer', 2140, 2000, 140, 'TAX-IV-902');
  r = ctx.postCashSaleGl('T1', o, 'tester');
  eq('★ จ่ายแบบโอน → เดบิตเงินฝากธนาคาร (1120) ไม่ใช่เงินสด', [r.posted, bal('1120').dr - bank0.dr], [true, 2140]);

  // ── บิลเครดิตต้องไม่เข้าทางนี้ (ลงผ่านใบแจ้งหนี้ลูกหนี้อยู่แล้ว) ──
  append(tenantSheets.sales_orders, { record_id: 143, order_code: 'SO-CREDIT', customer_id: 500,
    subtotal: 1070, discount: 0, total: 1070, payment_method: 'credit_term', fulfillment_type: 'office_delivery',
    status: 'completed', created_at: '2026-10-16 09:00:00', tax_invoice_no: 'TAX-IV-903',
    apply_vat: 'TRUE', vat_rate: 0.07, subtotal_ex_vat: 1000, vat_amount: 70, exempt_amount: 0 });
  r = ctx.postCashSaleGl('T1', ctx.tenantRowById('T1', 'sales_orders', 143), 'tester');
  eq('★★ บิลเครดิตไม่ลงทางนี้ (กันลงซ้ำกับใบแจ้งหนี้ลูกหนี้)', r.posted, false);

  // ── ยังไม่ออกใบกำกับ = ภาระภาษียังไม่เกิด ──
  append(tenantSheets.sales_orders, { record_id: 144, order_code: 'SO-NOTAX', customer_id: 500,
    subtotal: 500, discount: 0, total: 500, payment_method: 'cash', fulfillment_type: 'office_delivery',
    status: 'accepted', created_at: '2026-10-16 09:00:00', tax_invoice_no: '' });
  eq('★ ยังไม่ออกใบกำกับภาษี → ยังไม่ลงบัญชี',
    ctx.postCashSaleGl('T1', ctx.tenantRowById('T1', 'sales_orders', 144), 'tester').posted, false);

  // ── ไม่ย้อนหลัง ──
  append(tenantSheets.sales_orders, { record_id: 145, order_code: 'SO-CASH-OLD', customer_id: 500,
    subtotal: 100, discount: 0, total: 100, payment_method: 'cash', fulfillment_type: 'immediate',
    status: 'completed', created_at: '2026-09-30 09:00:00', tax_invoice_no: 'TAX-IV-904',
    tax_invoice_at: '2026-09-30 09:00:00', apply_vat: 'TRUE', vat_rate: 0.07, subtotal_ex_vat: 93.46, vat_amount: 6.54 });
  eq('★ บิลก่อนวันเริ่ม → ไม่ลง (ผู้ทำบัญชีอาจบันทึกด้วยมือไว้แล้ว ลงทับ = นับซ้ำ)',
    ctx.postCashSaleGl('T1', ctx.tenantRowById('T1', 'sales_orders', 145), 'tester').posted, false);

  // ── กลับรายการตอนยกเลิก ──
  const c1 = bal('1110'), s1 = bal('4100'), v1 = bal('2200');
  const o141 = ctx.tenantRowById('T1', 'sales_orders', 141);
  r = ctx.reverseCashSaleGl('T1', o141, 'tester', 'ยกเลิกบิล');
  eq('★ กลับรายการได้ ยอดเท่าเดิม', [r.posted, r.amount], [true, 1070]);
  /* ★ เทียบกับยอด "หลังลงบัญชีแล้ว" การกลับรายการจึงต้องหักออกเท่ายอดเดิมพอดีทั้งสามบัญชี
     (เทียบกับยอดก่อนลงไม่ได้ เพราะมีบิลใบอื่นลงคั่นอยู่ระหว่างนั้น) */
  eq('★★ กลับรายการหักออกเท่ายอดเดิมเป๊ะทั้งสามบัญชี',
    [bal('1110').dr - bal('1110').cr - (c1.dr - c1.cr),
     bal('4100').cr - bal('4100').dr - (s1.cr - s1.dr),
     bal('2200').cr - bal('2200').dr - (v1.cr - v1.dr)], [-1070, -1000, -70]);
  eq('  กลับซ้ำอีกไม่ได้', ctx.reverseCashSaleGl('T1', o141, 'tester', 'ซ้ำ').posted, false);

  /* ── รายงานภาษีต้องเลิกนับใบที่ลงบัญชีแล้วว่า "ยังไม่ลง" ──
     ★★ ตอนแรกรายงานดูแค่ "มีใบแจ้งหนี้ลูกหนี้ไหม" ซึ่งขายสดไม่มีวันมี → นับว่ายังไม่ลงตลอดไป
       แม้จะลงบัญชีไปแล้วจริง · แก้ให้ดูใบสำคัญ SALES_CASH ด้วย (เทสต์ข้อนี้คือตัวจับ) */
  const rep = ctx.getVatSalesReport(FIN, { month: '2026-10' });
  const unpostedDocs = (rep.rows || []).filter(r => r.kind === 'ใบกำกับภาษี').length;
  eq('★★ ขายสดที่ลงบัญชีแล้ว ต้องไม่ถูกนับว่า "ยังไม่ได้ลงบัญชี" อีก',
    rep.unposted.bills < unpostedDocs, true);
  eq('  และใบที่ยังไม่ได้ลงจริง (142 ที่ไม่ได้เดินผ่าน GL) ยังถูกนับอยู่', rep.unposted.bills >= 1, true);
}

/* ══════════ ใบวางบิล (53_billing_notes.gs · 16 ต.ค. 2026) ══════════
   ★★ ใบวางบิล **ไม่ใช่เอกสารภาษีและไม่ลงบัญชี** — เป็นแค่ "ซองรวมใบแจ้งหนี้" ภาระหนี้เกิดที่
     ใบแจ้งหนี้ไปแล้ว · เผลอลงบัญชีเมื่อไหร่ ลูกหนี้โตเป็นสองเท่าทันที (เทสต์ข้อแรกคุมเรื่องนี้)
   ★ สิ่งที่ต้องคุม: ใบเดียวกันวางบิลซ้ำไม่ได้ · ข้ามลูกค้าไม่ได้ · ใบที่เก็บครบแล้วไม่ต้องวาง ·
     ยอดในเอกสารเป็นภาพนิ่ง แต่ยอดคงค้างที่รายงานต้องเป็นของวันนี้ */
console.log('\n── ใบวางบิล ──');
{
  const jCount = () => ctx.centralObjects('gl_journals').length;
  const mkInv = (orderId, code, total) => {
    append(tenantSheets.sales_orders, { record_id: orderId, order_code: code, customer_id: 500,
      subtotal: total, discount: 0, total: total, payment_method: 'credit_term', status: 'completed',
      created_at: '2026-10-16 09:00:00', apply_vat: 'TRUE', vat_rate: 0.07,
      subtotal_ex_vat: Math.round((total / 1.07) * 100) / 100,
      vat_amount: Math.round((total - total / 1.07) * 100) / 100, exempt_amount: 0 });
    append(tenantSheets.order_items, { record_id: orderId * 10, order_id: orderId, product_id: '20',
      unit_code: 'CT', unit_factor: 10, qty: 1, base_qty: 10, price: total, line_total: total, tax_status: 'vat' });
    const r = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: orderId, invoiceDate: '2026-10-16', dueDays: 30 });
    return r.invoiceId;
  };

  const IV1 = mkInv(160, 'SO-BN-1', 1070), IV2 = mkInv(161, 'SO-BN-2', 2140), IV3 = mkInv(162, 'SO-BN-3', 3210);

  let r = ctx.listBillableInvoices(FIN, { customerId: 500 });
  const ids = (r.data || []).map(x => String(x.id));
  eq('ใบที่ยังค้างอยู่ขึ้นในรายการที่วางบิลได้',
    [ids.indexOf(String(IV1)) !== -1, ids.indexOf(String(IV2)) !== -1], [true, true]);

  const before = jCount();
  r = ctx.createBillingNote(FIN, { customerId: 500, invoiceIds: [IV1, IV2], noteDate: '2026-10-20', dueDate: '2026-11-05' });
  eq('★ ออกใบวางบิลได้ รวม 2 ใบ ยอด 3,210', [r.success, r.count, r.total], [true, 2, 3210]);
  eq('  เลขที่ขึ้นต้นด้วย BN', /^BN-/.test(r.noteNo), true);
  eq('★★ ไม่ลงบัญชีเลยสักใบ (ลงเมื่อไหร่ลูกหนี้โตเป็นสองเท่า)', jCount(), before);
  const BN = r.noteId;

  // ── ใบเดิมวางบิลซ้ำไม่ได้ ──
  r = ctx.createBillingNote(FIN, { customerId: 500, invoiceIds: [IV1], noteDate: '2026-10-20' });
  eq('★ ใบที่วางบิลไปแล้ว วางซ้ำไม่ได้', [r.success, /วางบิลไปแล้ว/.test(r.message || '')], [false, true]);
  eq('  และหายจากรายการที่วางบิลได้',
    (ctx.listBillableInvoices(FIN, { customerId: 500 }).data || []).map(x => String(x.id)).indexOf(String(IV1)), -1);

  // ── ข้ามลูกค้าไม่ได้ ──
  append(sheets.customers, { record_id: 501, name: 'ร้านอีกราย', tenant_id: 'T1', is_active: true });
  append(tenantSheets.sales_orders, { record_id: 163, order_code: 'SO-BN-X', customer_id: 501,
    subtotal: 500, discount: 0, total: 500, payment_method: 'credit_term', status: 'completed',
    created_at: '2026-10-16 09:00:00', apply_vat: 'TRUE', vat_rate: 0.07, subtotal_ex_vat: 467.29, vat_amount: 32.71 });
  append(tenantSheets.order_items, { record_id: 1630, order_id: 163, product_id: '20', unit_code: 'CT',
    unit_factor: 10, qty: 1, base_qty: 10, price: 500, line_total: 500, tax_status: 'vat' });
  const IVX = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 163, invoiceDate: '2026-10-16', dueDays: 30 }).invoiceId;
  r = ctx.createBillingNote(FIN, { customerId: 500, invoiceIds: [IV3, IVX], noteDate: '2026-10-20' });
  eq('★★ วางบิลข้ามลูกค้าไม่ได้ (พนักงานเก็บเงินจะถือไปผิดร้าน)',
    [r.success, /ลูกค้ารายอื่น/.test(r.message || '')], [false, true]);

  // ── เก็บเงินแล้ว ยอดคงค้างของใบวางบิลต้องลดตาม แต่ยอดในเอกสารคงเดิม ──
  ctx.receiveArPayment(FIN, { customerId: 500, receiptDate: '2026-10-25', method: 'transfer',
    allocations: [{ invoiceId: IV1, amount: 1070 }] });
  const note = (ctx.listBillingNotes(FIN, {}).data || []).find(x => x.id === BN);
  eq('★★ ยอดในเอกสารเป็นภาพนิ่ง (3,210) แต่ยอดคงค้างเป็นของวันนี้ (2,140)',
    [note.total, note.outstanding, note.collected], [3210, 2140, 1070]);

  const d = ctx.getBillingNote(FIN, { id: BN });
  const l1 = (d.items || []).find(x => String(x.invoiceId) === String(IV1));
  eq('  รายละเอียดบอกทั้งยอดตอนวางบิลและยอดค้างตอนนี้ของแต่ละใบ',
    [d.success, d.items.length, l1.amount, l1.outstandingNow], [true, 2, 1070, 0]);

  // ── ยกเลิกแล้วใบแจ้งหนี้กลับมาวางบิลใหม่ได้ ──
  r = ctx.cancelBillingNote(FIN, { id: BN, reason: 'ร้านขอใบใหม่' });
  eq('ยกเลิกใบวางบิลได้', r.success, true);
  /* ★ เช็คแบบ "มี/ไม่มี" ไม่ใช่เท่ากันทั้งชุด — ลูกค้า 500 มีใบแจ้งหนี้จากหมวดอื่นค้างอยู่ด้วย
     ผูกกับชุดเต็มเมื่อไหร่ เทสต์จะพังทุกครั้งที่มีคนเพิ่มหมวดใหม่ที่ใช้ลูกค้ารายเดียวกัน */
  {
    const back = (ctx.listBillableInvoices(FIN, { customerId: 500 }).data || []).map(x => String(x.id));
    eq('★ ใบแจ้งหนี้ที่ยังค้างกลับมาวางบิลใหม่ได้ (ใบที่เก็บครบแล้วไม่กลับมา)',
      [back.indexOf(String(IV2)) !== -1, back.indexOf(String(IV3)) !== -1, back.indexOf(String(IV1))],
      [true, true, -1]);
  }
  eq('  แต่แถวเดิมยังอยู่เป็นประวัติ (ร้านอาจถือสำเนาอยู่)',
    (ctx.listBillingNotes(FIN, {}).data || []).find(x => x.id === BN).status, 'cancelled');
  eq('  ยกเลิกซ้ำไม่ได้', ctx.cancelBillingNote(FIN, { id: BN }).success, false);

  eq('ไม่เลือกใบเลย → ปฏิเสธ', ctx.createBillingNote(FIN, { customerId: 500, invoiceIds: [] }).success, false);
}

/* ══════════ ใบรับคืนสินค้า (54_goods_returns.gs · 16 ต.ค. 2026) ══════════
   ★★ สองข้อที่ต้องไม่พลาดเด็ดขาด:
     1. **ของเสียต้องไม่เข้าคลังขาย** ไม่งั้นมันถูกหยิบไปขายอีกรอบ
     2. **ใบรับคืนเป็นตัวที่ขยับสต็อก ใบลดหนี้ที่ออกจากมันต้องไม่ขยับซ้ำ**
        สองที่ขยับของชิ้นเดียวกัน = สต็อกงอกเป็นสองเท่าโดยไม่มีใครเห็น */
console.log('\n── ใบรับคืนสินค้า ──');
{
  /* ★ นับสต็อกรวมทุกคลังของสินค้านั้น ไม่ผูกกับ scope — กล่องทดสอบกับโค้ดคิด scope ไม่ตรงกัน
     (`_effectiveTenantId` ในกล่องนี้ไม่คืน 'T1' ตาม payload) และสิ่งที่เทสต์นี้อยากพิสูจน์คือ
     **ของขยับกี่ชิ้น** ไม่ใช่ขยับที่คลังไหน ซึ่งมีเทสต์ของมันเองอยู่แล้วในหมวดแยกข้อมูลตัวแทน */
  const stockOf = pid => ctx.centralObjects('warehouse_stock')
    .filter(r => String(r.product_id) === String(pid))
    .reduce((s, r) => s + (Number(r.qty) || 0), 0);

  const SC2 = ctx._saleStockScope('T1'), WH2 = ctx._ensureScopeWarehouse(SC2);
  ctx._applyStockIn(SC2, WH2, '80', 100, 5, 'receipt', 'TEST', 'R0', 'ตั้งต้น', 'tester');
  append(tenantSheets.sales_orders, { record_id: 180, order_code: 'SO-RET-1', customer_id: 500,
    subtotal: 10700, discount: 0, total: 10700, payment_method: 'credit_term', fulfillment_type: 'office_delivery',
    status: 'completed', created_at: '2026-10-16 09:00:00', tax_invoice_no: 'TAX-IV-980',
    apply_vat: 'TRUE', vat_rate: 0.07, subtotal_ex_vat: 10000, vat_amount: 700, exempt_amount: 0 });
  append(tenantSheets.order_items, { record_id: 18001, order_id: 180, product_id: '80', unit_code: 'CT',
    unit_factor: 10, qty: 10, base_qty: 100, price: 1070, line_total: 10700, line_discount: 0, is_free: 0, tax_status: 'vat' });

  let d = ctx.getGoodsReturnDraft(FIN, { tenantId: 'T1', orderId: 180 });
  eq('ร่างใบรับคืน: บอกจำนวนที่รับคืนได้ของแต่ละรายการ',
    [d.success, d.lines.length, d.lines[0].returnable, d.lines[0].unitPrice], [true, 1, 10, 1070]);

  eq('ไม่ระบุเหตุผล → ปฏิเสธ',
    ctx.createGoodsReturn(FIN, { tenantId: 'T1', orderId: 180, lines: [{ itemId: 18001, qty: 1, condition: 'good' }] }).success, false);
  eq('★ รับคืนเกินที่ส่งไป → ปฏิเสธทั้งใบ (ไม่ตัดให้พอดีเงียบๆ)',
    ctx.createGoodsReturn(FIN, { tenantId: 'T1', orderId: 180, reasonCode: 'damaged',
      lines: [{ itemId: 18001, qty: 99, condition: 'good' }] }).success, false);

  const before = stockOf('80');
  let r = ctx.createGoodsReturn(FIN, { tenantId: 'T1', orderId: 180, reasonCode: 'damaged',
    returnDate: '2026-10-18', note: 'ลูกค้าแจ้งกล่องบุบ',
    lines: [{ itemId: 18001, qty: 2, condition: 'good' }, { itemId: 18001, qty: 1, condition: 'damaged' }] });
  eq('★ รับคืน 2 ลังสภาพดี + 1 ลังชำรุด', [r.success, /^GRN-/.test(r.returnNo || '')], [true, true]);
  eq('★★ เข้าคลังเฉพาะของสภาพดี (2 ลัง × 10 = 20 ชิ้น) ของเสียไม่เข้า',
    [stockOf('80') - before, r.restocked, r.scrapQty], [20, 1, 10]);

  // ── รับคืนซ้ำต้องนับของที่คืนไปแล้ว ──
  d = ctx.getGoodsReturnDraft(FIN, { tenantId: 'T1', orderId: 180 });
  eq('★ ร่างรอบถัดไปหักของที่คืนไปแล้ว (10 − 3 = 7)',
    [d.lines[0].returned, d.lines[0].returnable], [3, 7]);

  // ── ออกใบลดหนี้จากใบรับคืน: ต้องไม่ขยับสต็อกซ้ำ ──
  let cr = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 180, invoiceDate: '2026-10-16', dueDays: 30 });
  ok('ตั้งลูกหนี้ของบิลที่รับคืน', cr);
  const stockBeforeCn = stockOf('80');
  const grn = (ctx.listGoodsReturns(FIN, { tenantId: 'T1' }).data || [])[0];
  r = ctx.createCreditNoteFromReturn(FIN, { tenantId: 'T1', returnId: grn.id, creditDate: '2026-10-18' });
  eq('★ ออกใบลดหนี้จากใบรับคืนได้', [r.success, /^CN-/.test(r.creditNoteNo || '')], [true, true]);
  eq('★★★ สต็อกต้องไม่ขยับซ้ำ (ของเข้าคลังไปแล้วตอนรับคืน)', stockOf('80'), stockBeforeCn);
  eq('  ออกใบลดหนี้ซ้ำจากใบรับคืนเดิมไม่ได้',
    ctx.createCreditNoteFromReturn(FIN, { tenantId: 'T1', returnId: grn.id }).success, false);

  // ── ยกเลิก ──
  eq('★ ออกใบลดหนี้แล้ว ยกเลิกใบรับคืนไม่ได้',
    ctx.cancelGoodsReturn(FIN, { tenantId: 'T1', id: grn.id }).success, false);

  r = ctx.createGoodsReturn(FIN, { tenantId: 'T1', orderId: 180, reasonCode: 'wrong_item',
    returnDate: '2026-10-19', lines: [{ itemId: 18001, qty: 1, condition: 'good' }] });
  ok('รับคืนอีกใบ (ยังไม่ออกใบลดหนี้)', r);
  const s2 = stockOf('80');
  const r2id = r.returnId;
  r = ctx.cancelGoodsReturn(FIN, { tenantId: 'T1', id: r2id, reason: 'คีย์ผิด' });
  eq('★ ยกเลิกใบที่ยังไม่ออกใบลดหนี้ได้ และหักของออกจากคลังคืน',
    [r.success, stockOf('80') - s2], [true, -10]);
  eq('  และของกลับมารับคืนได้ใหม่',
    ctx.getGoodsReturnDraft(FIN, { tenantId: 'T1', orderId: 180 }).lines[0].returnable, 7);

  const g = ctx.getGoodsReturn(FIN, { tenantId: 'T1', id: grn.id });
  eq('รายละเอียดใบรับคืน: มีสภาพของแต่ละรายการและธงเข้าคลัง',
    [g.success, g.items.length, g.items[0].restock, g.items[1].restock], [true, 2, true, false]);
}

/* ══════════ ยกเลิกใบลดหนี้ / ใบเพิ่มหนี้ (49_credit_notes.gs · 16 ต.ค. 2026) ══════════
   ★★ "ยกเลิก" = กลับรายการ ไม่ลบของเดิม — แถวใบยังอยู่ (voided) เพราะเป็นเอกสารภาษีที่ส่ง
     ลูกค้าไปแล้ว และเลขที่ใบต้องไม่ถูกนำกลับมาใช้ซ้ำ
   ★ สามอย่างต้องย้อนพร้อมกัน: ใบสำคัญบัญชี · ยอดสะสมบนใบแจ้งหนี้ · สต็อก (เฉพาะใบที่เคยขยับจริง) */
console.log('\n── ยกเลิกใบลดหนี้ / ใบเพิ่มหนี้ ──');
{
  const stockOf = pid => ctx.centralObjects('warehouse_stock')
    .filter(r => String(r.product_id) === String(pid)).reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const SCV = ctx._saleStockScope('T1'), WHV = ctx._ensureScopeWarehouse(SCV);
  ctx._applyStockIn(SCV, WHV, '90', 100, 10, 'receipt', 'TEST', 'V0', 'ตั้งต้น', 'tester');

  append(tenantSheets.sales_orders, { record_id: 200, order_code: 'SO-VOID-1', customer_id: 500,
    subtotal: 10700, discount: 0, total: 10700, payment_method: 'credit_term', status: 'completed',
    created_at: '2026-10-16 09:00:00', apply_vat: 'TRUE', vat_rate: 0.07,
    subtotal_ex_vat: 10000, vat_amount: 700, exempt_amount: 0 });
  append(tenantSheets.order_items, { record_id: 20001, order_id: 200, product_id: '90', unit_code: 'CT',
    unit_factor: 10, qty: 10, base_qty: 100, price: 1070, line_total: 10700, line_discount: 0, is_free: 0, tax_status: 'vat' });
  const IVV = ctx.createArInvoice(FIN, { tenantId: 'T1', salesOrderId: 200, invoiceDate: '2026-10-16', dueDays: 30 }).invoiceId;
  const ivRow = () => ctx.listArInvoices(FIN, {}).data.find(x => x.id === IVV);

  // ── ใบลดหนี้ที่คืนของเข้าคลัง ──
  const s0 = stockOf('90');
  let r = ctx.createArCreditNote(FIN, { invoiceId: IVV, reasonCode: 'return', reason: 'คืนของ',
    creditDate: '2026-10-18', returnStock: true,
    lines: [{ itemId: 20001, productId: '90', unitCode: 'CT', unitFactor: 10, qty: 3, unitPrice: 1070, taxStatus: 'vat' }] });
  ok('ออกใบลดหนี้ที่คืนของเข้าคลัง', r);
  const CN = r.noteId;
  eq('  ของเข้าคลังแล้ว 30 ชิ้น · ยอดค้างลดลง', [stockOf('90') - s0, ivRow().outstanding], [30, 10700 - 3210]);

  eq('ไม่ระบุเหตุผล → ปฏิเสธ (เป็นเอกสารภาษี ต้องอธิบายได้)',
    ctx.voidArAdjustNote(FIN, { id: CN, kind: 'credit' }).success, false);

  r = ctx.voidArAdjustNote(FIN, { id: CN, kind: 'credit', reason: 'ออกผิดใบ' });
  eq('★ ยกเลิกใบลดหนี้ได้ พร้อมกลับรายการบัญชี', [r.success, !!r.journalNo, r.stockMoved], [true, true, 1]);
  eq('★★ ยอดค้างกลับมาเท่าเดิม', ivRow().outstanding, 10700);
  eq('★★ ของที่เคยรับคืนถูกตัดออกจากคลังคืน', stockOf('90'), s0);
  eq('  แถวใบเดิมยังอยู่ สถานะ voided (เอกสารภาษี ลบไม่ได้)',
    ctx.centralObjects('ar_credit_notes').filter(x => String(x.record_id) === String(CN))[0].status, 'voided');
  eq('  ยกเลิกซ้ำไม่ได้', ctx.voidArAdjustNote(FIN, { id: CN, kind: 'credit', reason: 'ซ้ำ' }).success, false);
  eq('★ ยกเลิกแล้วลดหนี้ใหม่ได้เต็มยอด',
    ctx.getArCreditNoteDraft(FIN, { invoiceId: IVV }).invoice.creditable, 10700);

  // ── ★ ใบลดหนี้ที่ "ไม่ได้คืนของ" ต้องไม่ย้อนสต็อก (ของไม่เคยขยับ) ──
  const s1 = stockOf('90');
  r = ctx.createArCreditNote(FIN, { invoiceId: IVV, reasonCode: 'overcharge', reason: 'คิดราคาผิด',
    creditDate: '2026-10-18', returnStock: false,
    lines: [{ itemId: 20001, productId: '90', unitCode: 'CT', unitFactor: 10, qty: 1, unitPrice: 1070, taxStatus: 'vat' }] });
  ok('ออกใบลดหนี้แบบไม่คืนของ (คิดราคาผิด)', r);
  eq('  ของไม่ขยับตอนออกใบ', stockOf('90'), s1);
  r = ctx.voidArAdjustNote(FIN, { id: r.noteId, kind: 'credit', reason: 'ยกเลิก' });
  eq('★★ ยกเลิกแล้วของก็ต้องไม่ขยับ (ไม่งั้นของงอกจากอากาศ)',
    [r.success, r.stockMoved, stockOf('90')], [true, 0, s1]);

  // ── ใบเพิ่มหนี้ ──
  const s2 = stockOf('90');
  r = ctx.createArDebitNote(FIN, { invoiceId: IVV, reasonCode: 'extra', reason: 'ส่งของเพิ่ม',
    creditDate: '2026-10-18', moveStock: true,
    lines: [{ itemId: 20001, productId: '90', unitCode: 'CT', unitFactor: 10, qty: 2, unitPrice: 1070, taxStatus: 'vat' }] });
  ok('ออกใบเพิ่มหนี้ที่ตัดของออกจากคลัง', r);
  eq('  ของออกจากคลัง 20 ชิ้น · ยอดค้างเพิ่ม', [stockOf('90') - s2, ivRow().outstanding], [-20, 10700 + 2140]);
  r = ctx.voidArAdjustNote(FIN, { id: r.noteId, kind: 'debit', reason: 'ออกผิดยอด' });
  eq('★ ยกเลิกใบเพิ่มหนี้: ยอดค้างกลับเดิม · ของกลับเข้าคลัง',
    [r.success, ivRow().outstanding, stockOf('90')], [true, 10700, s2]);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
