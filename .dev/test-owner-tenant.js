// รัน: node .dev/test-owner-tenant.js
// รหัสบริษัทเจ้าของสินค้า = TNKI (เจ้าของระบบสั่ง 30 ก.ย. 2026 — เดิมเป็น HOUSE)
// รหัสเดียวทำสองหน้าที่: เป็น "สังกัด" ของพนักงานฝั่งบริษัท และเป็น "สมุดขายตรง" ของบริษัท
//
// ★ กับดักที่เทสต์ชุดนี้มีไว้กัน (เจอจริงตอนเขียน — test-price-rules พังทันทีที่เปลี่ยนค่าคงที่):
//   1) คนสังกัด TNKI ต้องยังมองข้ามตัวแทนได้ ไม่ใช่ถูกหุบให้เหลือแค่ข้อมูลของ TNKI
//   2) แถวเก่าที่ยังเขียนว่า 'HOUSE' ต้องใช้งานได้อยู่จนกว่าจะ migrate — ไม่งั้นทันทีที่ deploy
//      ลูกค้าขายตรงทุกรายจะหาชุดราคาไม่เจอ = เปิดบิลไม่ได้ทั้งหมด โดยไม่มีอะไรฟ้อง
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) console.log('   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual));
  ok ? pass++ : fail++;
};

const sheets = {
  tenants: [
    { tenant_id: 'HOUSE', name: 'บริษัทเจ้าของสินค้า', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี', is_active: 'TRUE' }
  ],
  package_tenants: [
    { record_id: 1, package_type: 'price_list', package_id: 10, tenant_id: 'HOUSE' },   // แถวเก่า ยังไม่ migrate
    { record_id: 2, package_type: 'price_list', package_id: 11, tenant_id: 'BDC' }
  ],
  admin_users: [
    { record_id: 1, username: 'owner', tenant_id: 'HOUSE', role_code: 'owner_admin' },
    { record_id: 2, username: 'bdcadm', tenant_id: 'BDC', role_code: 'tenant_admin' }
  ],
  customers: [{ record_id: 1, customer_code: 'C1', tenant_id: 'HOUSE' }],
  central_doc_counters: [{ doc_type: 'PO@HOUSE', period_key: '202609', last_number: 7 }]
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-09-30' },
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
};

/* ★ ชั้นข้อมูลจำลอง — ต้องทับ "หลัง" โหลดไฟล์ backend เสมอ
   02_helpers.gs ประกาศ centralObjects / centralSheet / updateColumnsWhere ตัวจริงไว้ที่ระดับบนสุด
   ซึ่งจะเขียนทับ property เดิมของ context · ถ้าตั้ง mock ไว้ก่อนอย่างเดียว เทสต์จะไปรันโค้ดจริงที่
   ต่อ Google Sheets ไม่ได้ แล้ว "เงียบ" — ดัชนีออกมาว่าง เทสต์กลับผ่านเพราะ guard ปล่อยผ่านตอนยังไม่ตั้งค่า
   (เสียเวลาไล่หาอยู่พักหนึ่ง จึงเขียนเตือนไว้) */
const MOCKS = {
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralInvalidate: () => {},
  nowStr: () => '2026-09-30 10:00:00',
  // เขียนทีละคอลัมน์บนชีตจำลอง — คืนรูปเดียวกับของจริง {matched, changed, columns}
  updateColumnsWhere: (sh, matchFn, setObj) => {
    let matched = 0, changed = 0;
    sheetOf(sh.__name).forEach(row => {
      if (!matchFn(row)) return;
      matched++;
      Object.keys(setObj).forEach(k => {
        const v = typeof setObj[k] === 'function' ? setObj[k](row) : setObj[k];
        if (v === undefined || String(row[k]) === String(v)) return;
        row[k] = v; changed++;
      });
    });
    return { matched, changed, columns: Object.keys(setObj).length };
  }
};
Object.assign(ctx, MOCKS);
ctx.CENTRAL_SHEETS = { package_tenants: ['record_id', 'tenant_id'], admin_users: ['record_id', 'tenant_id'],
  customers: ['record_id', 'tenant_id'], tenants: ['tenant_id'], price_lists: ['record_id'] };
vm.createContext(ctx);
/* โหลดทั้งไฟล์ ไม่ตัดเอาเฉพาะฟังก์ชันด้วย regex — ลองแล้วมันตัดไม่ครบแบบเงียบๆ
   แล้ว packageTenantIndex() คืนดัชนีพิการ ทำให้ idx.any เป็น false และ packageAllowedForTenant
   ตอบ true ให้ทุกคน = เทสต์ "ผ่าน" ทั้งที่ตรรกะไม่เคยถูกรันเลย ซึ่งอันตรายกว่าเทสต์ที่ fail */
['02_helpers.gs', '14_permissions.gs', '38_package_distribution.gs', '13_tenants.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
Object.assign(ctx, MOCKS);   // ★ ทับ mock อีกรอบหลังโหลด (เหตุผลอยู่ที่นิยาม MOCKS)
/* บน Apps Script ทุกไฟล์ .gs อยู่ scope เดียวกัน `_isTrue` (นิยามใน 17_pricing.gs) จึงเรียกได้จากทุกที่
   เทสต์ชุดนี้โหลดแค่ 4 ไฟล์ ต้องต่อนามแฝงให้เองไม่งั้น _ensureHouseTenant() ล้มด้วย ReferenceError */
ctx._isTrue = ctx.isFlagOn;

console.log('\n-- รหัสบริษัทต้องไม่ถูกมองเป็นตัวแทนรายหนึ่ง --');
eq('สังกัด TNKI = ฝั่งบริษัท (มองข้ามตัวแทนได้)', ctx._effectiveTenantId({ tenant_id: 'TNKI' }, {}), null);
eq('สังกัดว่าง = ฝั่งบริษัทเหมือนเดิม', ctx._effectiveTenantId({ tenant_id: '' }, {}), null);
eq('สังกัด BDC = ตัวแทนจริง ถูกหุบตามเดิม', ctx._effectiveTenantId({ tenant_id: 'BDC' }, {}), 'BDC');
eq('บริษัทสวมสิทธิ์ตัวแทนได้ตามเดิม', ctx._effectiveTenantId({ tenant_id: '' }, { tenantId: 'BDC' }), 'BDC');
/* ★★ เคสที่ "ขาดไป" จนปล่อยบั๊กใหญ่หลุดไปถึงมือเจ้าของระบบ (1 ต.ค. 2026)
   เทสต์เดิมมีแต่ `tenant_id: ''` คู่กับ payload — ซึ่งเป็นสภาพ **ก่อน** migrate เป็น TNKI
   แต่หลัง migrate แอดมินบริษัททุกคนมี `tenant_id: 'TNKI'` ซึ่ง truthy นิพจน์เดิมจึงข้าม payload ทิ้ง
   ผล: ฝั่งบริษัท "เข้าไปดูแลตัวแทน" ไม่ได้เลยทั้งระบบ และไม่มีเทสต์ไหนจับได้
   บทเรียน: **เปลี่ยนค่าที่เคยเป็นค่าว่างให้มีค่า ต้องไล่เทสต์ทุกจุดที่เคยพึ่ง "ความว่าง" นั้น** */
eq('★ บริษัท (สังกัด TNKI) สวมสิทธิ์ตัวแทนได้ — เคสจริงหลัง migrate',
  ctx._effectiveTenantId({ tenant_id: 'TNKI' }, { tenantId: 'BDC' }), 'BDC');
eq('★ และ _salesTenantId ก็ต้องตามไปที่สมุดของตัวแทนนั้น',
  ctx._salesTenantId({ tenant_id: 'TNKI', role_code: 'super_admin' }, { tenantId: 'BDC' }), 'BDC');
eq('บัญชีที่สังกัดตัวแทน ส่ง payload ของรายอื่นมา → ยังถูกล็อกที่ของตัวเอง',
  ctx._effectiveTenantId({ tenant_id: 'BDC' }, { tenantId: 'XYZ' }), 'BDC');
eq('สวมสิทธิ์เป็น TNKI = กลับเป็นบริษัท ไม่ใช่ตัวแทน', ctx._effectiveTenantId({ tenant_id: '' }, { tenantId: 'TNKI' }), null);

console.log('\n-- _isCompanySide: ดู session อย่างเดียว ไม่สนการสวมสิทธิ์ --');
eq('สังกัดว่าง', ctx._isCompanySide({ tenant_id: '' }), true);
eq('สังกัด TNKI', ctx._isCompanySide({ tenant_id: 'TNKI' }), true);
eq('สังกัด BDC', ctx._isCompanySide({ tenant_id: 'BDC' }), false);
eq('บริษัทที่กำลังสวมสิทธิ์ BDC ก็ยังเป็นฝั่งบริษัท', ctx._isCompanySide({ tenant_id: '' }), true);

console.log('\n-- ★ แถวเก่าที่ยังเขียน HOUSE ต้องใช้งานได้จนกว่าจะ migrate --');
const idx = ctx.packageTenantIndex();
eq('ลูกค้าขายตรง (สังกัดว่าง) ยังได้ชุดที่จ่ายไว้ในชื่อ HOUSE', ctx.packageAllowedForTenant(idx, 'price_list', 10, ''), true);
eq('ระบุ TNKI ตรงๆ ก็ได้ชุดเดียวกัน', ctx.packageAllowedForTenant(idx, 'price_list', 10, 'TNKI'), true);
eq('ตัวแทนอื่นไม่ได้ชุดของบริษัท', ctx.packageAllowedForTenant(idx, 'price_list', 10, 'BDC'), false);
eq('ชุดของตัวแทนยังทำงานปกติ', ctx.packageAllowedForTenant(idx, 'price_list', 11, 'BDC'), true);
eq('บริษัทไม่ได้ชุดที่จ่ายให้ตัวแทนอย่างเดียว', ctx.packageAllowedForTenant(idx, 'price_list', 11, 'TNKI'), false);

console.log('\n-- ย้ายรหัส HOUSE → TNKI --');
const r1 = ctx.migrateOwnerTenantCode({ role_code: 'super_admin' });
eq('ย้ายสำเร็จ', r1.success, true);
eq('package_tenants ย้ายแล้ว', sheets.package_tenants[0].tenant_id, 'TNKI');
eq('admin_users ย้ายแล้ว', sheets.admin_users[0].tenant_id, 'TNKI');
eq('customers ย้ายแล้ว', sheets.customers[0].tenant_id, 'TNKI');
eq('tenants ย้ายแล้ว', sheets.tenants[0].tenant_id, 'TNKI');
eq('ตัวแทนจริงไม่ถูกแตะ', sheets.admin_users[1].tenant_id, 'BDC');
eq('ตัวนับเลขที่เอกสารย้ายด้วย', sheets.central_doc_counters[0].doc_type, 'PO@TNKI');
const r2 = ctx.migrateOwnerTenantCode({ role_code: 'super_admin' });
eq('รันซ้ำแล้วไม่มีอะไรเปลี่ยนอีก', r2.moved, 0);
eq('คนที่ไม่ใช่ Ultra Admin รันไม่ได้', ctx.migrateOwnerTenantCode({ role_code: 'owner_admin' }).success, false);

/* ── สมุดที่ทำงานอยู่: ไม่มีเส้นทางไหนที่ต้องให้ผู้ใช้เลือกตัวแทนเอง (1 ต.ค. 2026) ──
   เจ้าของระบบแจ้ง: เปิดหน้า "เลขที่เอกสาร" แล้วเจอ "กรุณาเลือกตัวแทนจำหน่ายก่อน" ทั้งที่แอปรู้อยู่แล้ว
   ว่าอยู่ตัวแทนไหน · `_salesTenantId()` คือตัวที่ตอบคำถาม "คำขอนี้ทำงานบนสมุดของใคร"
   ★ ของเดิมเช็ค **ชื่อบทบาท** (super_admin/owner_admin) ซึ่งพังทันทีที่บริษัทสร้างบทบาทเอง (26_roles.gs) */
// ☝ หมวดนี้รัน **หลัง** migrateOwnerTenantCode ข้างบน แถวสมุดของบริษัทจึงเป็น 'TNKI' แล้ว (เดิม 'HOUSE')
// ตั้งใจวางไว้ท้ายสุดเพื่อให้ทดสอบบนสภาพ "หลัง migrate" ซึ่งเป็นสภาพจริงของทุก env ตั้งแต่ 30 ก.ย. 2026
console.log('\n-- สมุดที่ทำงานอยู่ (_salesTenantId) --');
const BOOK = 'TNKI';   // สมุดขายตรงของบริษัท หลัง migrate
eq('สังกัดตัวแทน → สมุดของตัวแทนตัวเอง', ctx._salesTenantId({ tenant_id: 'BDC', role_code: 'tenant_admin' }, {}), 'BDC');
eq('Ultra Admin ไม่ได้สวมสิทธิ์ใคร → สมุดของบริษัท', ctx._salesTenantId({ tenant_id: '', role_code: 'super_admin' }, {}), BOOK);
eq('owner_admin → สมุดของบริษัท', ctx._salesTenantId({ tenant_id: '', role_code: 'owner_admin' }, {}), BOOK);
eq('★ บทบาทที่บริษัทสร้างเอง → สมุดของบริษัท (เดิมได้ null แล้วหน้าจอฟ้องให้เลือกตัวแทน)',
  ctx._salesTenantId({ tenant_id: '', role_code: 'acct_staff' }, {}), BOOK);
eq('★ บทบาทที่บริษัทสร้างเอง + สังกัด TNKI → สมุดของบริษัทเหมือนกัน',
  ctx._salesTenantId({ tenant_id: 'TNKI', role_code: 'acct_staff' }, {}), BOOK);
eq('บริษัทสวมสิทธิ์ตัวแทน → สมุดของตัวแทนรายนั้น',
  ctx._salesTenantId({ tenant_id: '', role_code: 'super_admin' }, { tenantId: 'BDC' }), 'BDC');
eq('สวมสิทธิ์เป็น TNKI → ยังเป็นสมุดของบริษัท ไม่ใช่ตัวแทนชื่อ TNKI',
  ctx._salesTenantId({ tenant_id: '', role_code: 'super_admin' }, { tenantId: 'TNKI' }), BOOK);
eq('บัญชีของตัวแทนส่ง tenantId ของคนอื่นมา → ยังถูกล็อกที่ของตัวเอง (กันข้ามตัวแทน)',
  ctx._salesTenantId({ tenant_id: 'BDC', role_code: 'tenant_admin' }, { tenantId: 'TNKI' }), 'BDC');

console.log('\n' + (fail ? fail + ' FAILED' : 'ALL PASSED'));
process.exit(fail ? 1 : 0);
