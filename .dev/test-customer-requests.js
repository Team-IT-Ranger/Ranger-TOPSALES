// รัน: node .dev/test-customer-requests.js
// คำขอเปิดร้านใหม่จากแอปมือถือ (46_customer_requests.gs) — เซลส์ขอ → แอดมินอนุมัติ → ระบบสร้างร้าน
//
// ★ โหลด 36_price_rules.gs + 38_package_distribution.gs ของจริง ไม่ mock `resolvePriceListForCustomer`
//   เพราะจุดที่เสี่ยงที่สุดของฟีเจอร์นี้คือ "แถวลูกค้าที่ยังไม่ได้เขียน" ที่ส่งเข้าตัวตรวจชุดราคา —
//   ถ้ารูปแถวไม่ตรงกับที่ตัวตรวจคาด มันจะคืน null เงียบๆ แล้วอนุมัติไม่ผ่านทั้งที่ควรผ่าน (หรือกลับกัน)
//   mock ตัวตรวจทิ้ง = เทสต์ผ่านสวยแต่ของจริงพัง ซึ่งเป็นกับดักที่ repo นี้โดนมาหลายรอบแล้ว
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let sheets, cacheCleared;
function reset() {
  sheets = {
    customer_requests: [],
    customers: [],
    shop_types: [
      { record_id: 1, code: 'MINIMART', name: 'มินิมาร์ท', is_active: 'TRUE' },
      { record_id: 2, code: 'GROCERY', name: 'โชห่วย', is_active: 'TRUE' },
      { record_id: 3, code: 'WHOLESALE', name: 'ค้าส่ง', is_active: 'FALSE' }   // ปิดใช้งาน — ต้องไม่โผล่ในตัวเลือก
    ],
    customer_groups: [{ record_id: 7, name: 'ร้านค้า ตะวันออก' }, { record_id: 9, name: 'กลุ่มไม่มีชุดราคา' }],
    // ชุดราคาที่ใช้งานอยู่ ผูกกับกลุ่ม 7 แบบเดิม (ไม่มีกฎสิทธิ์ = ใช้ customer_group_id ลำดับ 0)
    price_lists: [{ record_id: 50, name: 'Q4 ตะวันออก', status: 'active', valid_from: '2026-10-01', valid_to: '2026-12-31', customer_group_id: 7 }],
    price_list_rules: [], price_list_rule_conditions: [],
    // ชั้น A: บริษัทจ่ายชุด 50 ให้ตัวแทน T1 แล้ว (ไม่จ่าย = ตัวแทนนั้นหาชุดราคาไม่เจอ)
    package_tenants: [{ record_id: 1, package_type: 'price_list', package_id: 50, tenant_id: 'T1' }],
    customer_lists: [], customer_list_members: []
  };
  cacheCleared = [];
}
reset();

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Logger: { log: () => {} },
  OWNER_TENANT_ID: 'TNKI',   // 02_helpers.gs — ไม่โหลดทั้งไฟล์ (ลาก Drive/Cache มาด้วย) mock เฉพาะที่ใช้
  Utilities: { formatDate: () => '2026-10-15' },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  centralObjects: n => (sheets[n] || []).map(r => Object.assign({}, r)),
  centralAppend: (n, row) => { (sheets[n] = sheets[n] || []).push(Object.assign({}, row)); },
  centralUpdate: (n, id, patch) => {
    const r = (sheets[n] || []).find(x => String(x.record_id) === String(id));
    if (r) Object.assign(r, patch);
    return !!r;
  },
  centralNextId: n => (sheets[n] || []).reduce((m, o) => Math.max(m, parseInt(o.record_id) || 0), 0) + 1,
  nowStr: () => '2026-10-15 09:00:00',
  cacheClear: (k, id) => cacheCleared.push(k + ':' + id),
  _withDocLock: fn => fn(),
  isNotOff: v => !(String(v).toUpperCase() === 'FALSE' || v === false),
  isFlagOn: v => String(v).toUpperCase() === 'TRUE' || v === true,
  // สิทธิ์/ขอบเขต — คุมแยกไว้แล้วใน test-roles.js ที่นี่ให้ผ่านตลอด แล้วสลับเป็นปฏิเสธเฉพาะเคสที่ทดสอบ
  _requirePermission: () => null,
  _effectiveTenantId: (s, p) => (s && s.tenant_id) || (p && p.tenantId) || null,
  _salesTenantId: (s, p) => (s && s.tenant_id) || (p && p.tenantId) || null,
  customerListsOf: () => []
};
vm.createContext(ctx);
for (const f of ['17_pricing.gs', '33_customers.gs', '36_price_rules.gs', '38_package_distribution.gs', '46_customer_requests.gs']) {
  vm.runInContext(B(f), ctx, { filename: f });
}

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

const SALES = { lineUserId: 'U-sales', tenantId: 'T1', name: 'สมชาย', role: 'van_sales' };
const ADMIN = { adminUserId: 9, displayName: 'แอดมินศูนย์', tenant_id: 'T1' };
const GOOD = { name: 'ร้านป้าแดง', address: '12 ถนนสุขุมวิท ชลบุรี', taxId: '1234567890123',
  contactName: 'ป้าแดง', phone: '0812345678', paymentType: 'cash', shopTypeId: '1', lat: '13.1', lng: '101.2' };

console.log('── ส่งคำขอจากมือถือ ──');

let r = ctx.submitCustomerRequest(SALES, GOOD);
eq('ส่งคำขอได้ และได้เลขอ้างอิง', [r.success, r.requestNo], [true, 'CR-00001']);
eq('  คำขอเข้าคิวสถานะ "รออนุมัติ" ผูกกับตัวแทนและคนขอ',
  [sheets.customer_requests[0].status, sheets.customer_requests[0].tenant_id, sheets.customer_requests[0].requested_by],
  ['pending', 'T1', 'U-sales']);
eq('  ★ ยังไม่สร้างแถวในทะเบียนลูกค้า (คำขอที่ยังไม่อนุมัติต้องไม่โผล่ให้เปิดบิลใส่ได้)',
  sheets.customers.length, 0);

r = ctx.submitCustomerRequest(SALES, Object.assign({}, GOOD, { name: '' }));
eq('ไม่กรอกชื่อร้าน = ปฏิเสธ', [r.success, r.message], [false, 'กรุณาระบุชื่อร้าน']);

r = ctx.submitCustomerRequest(SALES, Object.assign({}, GOOD, { taxId: '12345' }));
eq('เลขผู้เสียภาษีไม่ครบ 13 หลัก = ปฏิเสธ (ใช้ตัวตรวจเดียวกับทะเบียนลูกค้า)', r.success, false);

r = ctx.submitCustomerRequest(SALES, Object.assign({}, GOOD, { taxId: '' }));
eq('ไม่กรอกเลขผู้เสียภาษีเลย = ผ่านได้ (ร้านโชห่วยหลายร้านไม่มี)', r.success, true);

r = ctx.submitCustomerRequest(SALES, Object.assign({}, GOOD, { paymentType: 'credit', creditLimit: 0 }));
eq('★ ขอเป็นร้านเครดิตแต่ไม่บอกวงเงิน = ปฏิเสธ (แอดมินตัดสินใจไม่ได้ ต้องโทรกลับมาถาม)', r.success, false);

r = ctx.submitCustomerRequest(SALES, Object.assign({}, GOOD, { paymentType: 'credit', creditLimit: 30000 }));
eq('ขอเครดิตพร้อมวงเงิน = ผ่าน', r.success, true);

r = ctx.submitCustomerRequest(SALES, Object.assign({}, GOOD, { shopTypeId: '99' }));
eq('ประเภทร้านที่ไม่มีจริง = ปฏิเสธ', r.success, false);

eq('ตัวเลือกประเภทร้านมีเฉพาะที่เปิดใช้งาน (ค้าส่งถูกปิดไว้)',
  ctx.listShopTypesMobile(SALES, {}).shopTypes.map(t => t.name), ['มินิมาร์ท', 'โชห่วย']);

console.log('\n── แอดมินอนุมัติ ──');
reset();
ctx.submitCustomerRequest(SALES, GOOD);

r = ctx.approveCustomerRequest(ADMIN, { requestId: 1 });
eq('★★ ไม่เลือกกลุ่มราคา = อนุมัติไม่ได้ (ร้านไม่มีกลุ่ม = เปิดบิลไม่ได้ แต่ดูเหมือนแถวปกติ)', r.success, false);
eq('  และต้องยังไม่สร้างลูกค้า', sheets.customers.length, 0);

r = ctx.approveCustomerRequest(ADMIN, { requestId: 1, groupId: 9 });
eq('★★ เลือกกลุ่มที่ไม่มีชุดราคาที่ใช้งานอยู่ = อนุมัติไม่ได้ พร้อมบอกเหตุผล',
  [r.success, !!r.needsPriceList], [false, true]);
eq('  ★ สำคัญ: ล้มแล้วต้องไม่ทิ้งแถวลูกค้าค้างไว้ (ตรวจก่อนเขียนเสมอ)', sheets.customers.length, 0);
eq('  คำขอยังอยู่ในคิว รออนุมัติเหมือนเดิม', sheets.customer_requests[0].status, 'pending');

r = ctx.approveCustomerRequest(ADMIN, { requestId: 1, groupId: 7 });
eq('อนุมัติด้วยกลุ่มที่มีชุดราคาจริง = ผ่าน และได้รหัสร้าน', [r.success, !!r.customerCode], [true, true]);
eq('  สร้างลูกค้า 1 แถว ผูกตัวแทน กลุ่มราคา และประเภทร้านครบ',
  [sheets.customers.length, sheets.customers[0].tenant_id, String(sheets.customers[0].group_id), String(sheets.customers[0].shop_type_id)],
  [1, 'T1', '7', '1']);
eq('  ★ ร้านที่สร้างต้องหาชุดราคาเจอจริง (ไม่ใช่แค่ผ่านตอนตรวจ)',
  !!ctx.resolvePriceListForCustomer(sheets.customers[0]), true);
eq('  ข้อมูลที่เซลส์กรอกถูกยกมาครบ (ผู้ติดต่อ/เบอร์/ที่อยู่/เลขภาษี)',
  [sheets.customers[0].contact_name, sheets.customers[0].phone, sheets.customers[0].tax_id],
  ['ป้าแดง', '0812345678', '1234567890123']);
eq('  คำขอถูกปิดเป็น "อนุมัติแล้ว" พร้อมผูกรหัสร้านกลับเข้าคำขอ',
  [sheets.customer_requests[0].status, !!sheets.customer_requests[0].customer_code], ['approved', true]);
eq('  ★ ล้างแคช bootstrap ของเซลส์คนที่ขอ (ไม่งั้นเปิดแอปแล้วยังไม่เห็นร้านใหม่)',
  cacheCleared.indexOf('bootstrap:U-sales') !== -1, true);

r = ctx.approveCustomerRequest(ADMIN, { requestId: 1, groupId: 7 });
eq('อนุมัติซ้ำใบเดิม = ปฏิเสธ (กันร้านซ้ำสองรหัส)', r.success, false);
eq('  และยังมีลูกค้าแค่แถวเดียว', sheets.customers.length, 1);

console.log('\n── ★★ กลุ่มที่ให้เลือก ต้องมีแต่กลุ่มที่มีชุดราคาจริง (บั๊กจริง 5 ต.ค. 2026) ──');
// UAT มีสองกลุ่มชื่อแทบเหมือนกัน ต่างแค่ / กับ ,  — [8] ไม่มีชุดราคา · [12] มี
// รอบแรกส่งกลุ่มทั้งหมดไปให้เลือก แอดมินเลือก [8] แล้วระบบตอบว่า "ไม่มีชุดราคา" ทั้งที่ของมีจริง
reset();
sheets.customer_groups = [
  { record_id: 8, name: 'ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้' },   // ขยะจากการนำเข้ารอบเก่า ไม่มีชุดราคา
  { record_id: 7, name: 'ร้านค้า ตะวันออก' },                    // มีชุดราคา 50 (active, จ่ายให้ T1 แล้ว)
  { record_id: 9, name: 'กลุ่มไม่มีชุดราคา' }
];
ctx.submitCustomerRequest(SALES, GOOD);
{
  const r1 = ctx.listCustomerRequests(ADMIN, {});
  eq('เสนอเฉพาะกลุ่มที่มีชุดราคาใช้งานอยู่ — กลุ่มชื่อคล้ายที่ไม่มีชุดราคาต้องไม่โผล่',
    r1.requests[0].groupChoices.map(g => g.id), ['7']);
  eq('  บอกด้วยว่ากลุ่มนั้นจะได้ชุดราคาไหน (กันเลือกผิดซ้ำ)',
    r1.requests[0].groupChoices[0].listName, 'Q4 ตะวันออก');
  eq('  ส่งจำนวนกลุ่มทั้งหมดไปด้วย ให้หน้าจอบอกได้ว่าซ่อนไปกี่กลุ่ม', r1.groupTotal, 3);

  // ★ รายการที่ให้เลือก ต้องตรงกับด่านตอนอนุมัติเสมอ — ทุกตัวที่เสนอต้องอนุมัติผ่านจริง
  const okGroup = ctx.approveCustomerRequest(ADMIN, { requestId: 1, groupId: Number(r1.requests[0].groupChoices[0].id) });
  eq('★ ทุกกลุ่มที่เสนอให้เลือก ต้องอนุมัติผ่านจริง (รายการกับด่านใช้ตัวตัดสินเดียวกัน)', okGroup.success, true);
}
{
  /* ชั้น A: ชุดถูกจ่ายให้ "ตัวแทนรายอื่น" → ตัวแทนของคำขอนี้ต้องไม่มีกลุ่มให้เลือกเลย
     ไม่ใช่เสนอไปแล้วไปตายตอนกดอนุมัติ
     ★ ต้องมีแถวจ่ายชุดอยู่ในระบบอย่างน้อยหนึ่งแถว — ตารางว่างทั้งตารางแปลว่า "ยังไม่ได้เริ่มใช้เรื่องนี้"
       ซึ่ง packageAllowedForTenant จงใจไม่กั้น (ไม่งั้นช่วงก่อนรัน migrate ทุกร้านจะเปิดบิลไม่ได้พร้อมกัน) */
  reset();
  sheets.package_tenants = [{ record_id: 1, package_type: 'price_list', package_id: 50, tenant_id: 'T9' }];
  ctx.submitCustomerRequest(SALES, GOOD);
  const r2 = ctx.listCustomerRequests(ADMIN, {});
  eq('ชุดราคาถูกจ่ายให้ตัวแทนรายอื่น = ตัวแทนนี้ไม่มีกลุ่มให้เลือกเลย', r2.requests[0].groupChoices.length, 0);
  eq('  และกดอนุมัติก็ต้องไม่ผ่าน (ด่านกับรายการตรงกัน)',
    ctx.approveCustomerRequest(ADMIN, { requestId: 1, groupId: 7 }).success, false);
}

console.log('\n── ไม่อนุมัติ / ขอบเขตตัวแทน ──');
reset();
ctx.submitCustomerRequest(SALES, GOOD);

r = ctx.rejectCustomerRequest(ADMIN, { requestId: 1 });
eq('ตีกลับโดยไม่บอกเหตุผล = ปฏิเสธ (เซลส์ต้องรู้ว่าต้องแก้อะไร)', r.success, false);

r = ctx.rejectCustomerRequest(ADMIN, { requestId: 1, reason: 'เลขผู้เสียภาษีไม่ตรงกับชื่อร้าน' });
eq('ตีกลับพร้อมเหตุผล = ผ่าน', [r.success, sheets.customer_requests[0].status], [true, 'rejected']);
eq('  เหตุผลถูกเก็บไว้ให้เซลส์อ่าน', sheets.customer_requests[0].reject_reason, 'เลขผู้เสียภาษีไม่ตรงกับชื่อร้าน');
eq('  ไม่สร้างลูกค้า', sheets.customers.length, 0);

const OTHER_ADMIN = { adminUserId: 10, displayName: 'แอดมินตัวแทนอื่น', tenant_id: 'T2' };
reset();
ctx.submitCustomerRequest(SALES, GOOD);
r = ctx.approveCustomerRequest(OTHER_ADMIN, { requestId: 1, groupId: 7 });
eq('★ แอดมินของตัวแทนอื่นอนุมัติคำขอของ T1 ไม่ได้', r.success, false);
eq('  คิวของตัวแทนอื่นมองไม่เห็นคำขอนี้ด้วย',
  ctx.listCustomerRequests(OTHER_ADMIN, {}).requests.length, 0);
eq('  แต่แอดมินของ T1 เห็น', ctx.listCustomerRequests(ADMIN, {}).requests.length, 1);

console.log('\n── แจ้งผลกลับไปที่มือถือ ──');
reset();
ctx.submitCustomerRequest(SALES, GOOD);

let my = ctx.listMyCustomerRequests(SALES, {});
eq('ระหว่างรอ: ไม่มีอะไรต้องแจ้ง', [my.pendingCount, my.unseenDecided.length], [1, 0]);

ctx.approveCustomerRequest(ADMIN, { requestId: 1, groupId: 7 });
my = ctx.listMyCustomerRequests(SALES, {});
eq('★ อนุมัติแล้ว: มีผลที่เซลส์ยังไม่รับทราบ → แอปขึ้นแถบแจ้ง', my.unseenDecided.length, 1);
eq('  และบอกรหัสร้านที่เปิดให้ไปด้วย', !!my.unseenDecided[0].customerCode, true);

ctx.markCustomerRequestSeen(SALES, { requestIds: [1] });
my = ctx.listMyCustomerRequests(SALES, {});
eq('กดรับทราบแล้ว แถบแจ้งหายไป (เก็บฝั่งเซิร์ฟเวอร์ เปลี่ยนเครื่องแล้วไม่เด้งซ้ำ)', my.unseenDecided.length, 0);

r = ctx.markCustomerRequestSeen({ lineUserId: 'U-other', tenantId: 'T1' }, { requestIds: [1] });
eq('★ รับทราบแทนคนอื่นไม่ได้', r.marked, 0);

my = ctx.listMyCustomerRequests({ lineUserId: 'U-other', tenantId: 'T1' }, {});
eq('เซลส์เห็นเฉพาะคำขอของตัวเอง', my.requests.length, 0);

console.log('\n── ตารางประเภทร้านว่าง (env เดิมที่ตั้งไว้ก่อนมีฟีเจอร์นี้) ──');
// _seedShopTypes() ถูกเรียกจาก setup ครั้งแรกเท่านั้น — UAT/prod ที่ตั้งไว้แล้วจะได้ชีตเปล่า
// ถ้าไม่เติมให้เอง ช่อง "ประเภทร้าน" จะว่างทั้งสองแอปโดยไม่มีอะไรฟ้อง
reset();
sheets.shop_types = [];
let seedCalls = 0;
ctx._seedShopTypes = () => { seedCalls++; sheets.shop_types = [
  { record_id: 1, code: 'MINIMART', name: 'มินิมาร์ท', is_active: 'TRUE' },
  { record_id: 2, code: 'GROCERY', name: 'โชห่วย', is_active: 'TRUE' },
  { record_id: 3, code: 'WHOLESALE', name: 'ค้าส่ง', is_active: 'TRUE' }]; };
ctx.centralInvalidate = () => {};
eq('★ ตารางว่าง → เติมค่าตั้งต้นให้เองครั้งแรกที่ใช้ (ไม่ต้องไปรันมือที่ editor)',
  ctx._crShopTypes().map(t => t.name), ['มินิมาร์ท', 'โชห่วย', 'ค้าส่ง']);
eq('  เรียกซ้ำไม่ seed ซ้ำ', (ctx._crShopTypes(), seedCalls), 1);

console.log('\n── action เดิมที่ปิดไปแล้ว ──');
vm.runInContext(B('10_master_data.gs'), ctx, { filename: '10_master_data.gs' });
r = ctx.addCustomer(SALES, GOOD);
eq('★ addCustomer เดิม (สร้างทันทีไม่ต้องอนุมัติ) ต้องไม่สร้างร้านอีกแล้ว', [r.success, !!r.needsRefresh], [false, true]);
eq('  และต้องไม่มีลูกค้าเพิ่ม', sheets.customers.length, 0);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
