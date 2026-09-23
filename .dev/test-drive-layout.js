// รัน: node .dev/test-drive-layout.js — ทดสอบการจัดโฟลเดอร์ไฟล์ฐานข้อมูล (24_drive_layout.gs) ด้วย DriveApp จำลอง
// ตรวจว่า: แยกโฟลเดอร์ตามสภาพแวดล้อม (db_uat/db_prod), ข้อมูลส่วนกลาง+บริษัทเจ้าของสินค้าอยู่ TNKI,
//          ตัวแทนแต่ละรายอยู่โฟลเดอร์ชื่อรหัสตัวแทนของตัวเอง, รันซ้ำแล้วไม่สร้างโฟลเดอร์ซ้ำ/ไม่ย้ายซ้ำ
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let nextId = 1;
class FakeFolder {
  constructor(name, parent) { this.id = 'F' + (nextId++); this.name = name; this.parent = parent; this.folders = []; this.files = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  getFoldersByName(n) { const hits = this.folders.filter(f => f.name === n); let i = 0; return { hasNext: () => i < hits.length, next: () => hits[i++] }; }
  createFolder(n) { const f = new FakeFolder(n, this); this.folders.push(f); return f; }
  getParents() { let done = !this.parent; return { hasNext: () => !done, next: () => { done = true; return this.parent; } }; }
}
class FakeFile {
  constructor(name, parent) { this.id = 'X' + (nextId++); this.name = name; this.parent = parent; this.moves = 0; if (parent) parent.files.push(this); }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return 'https://drive/' + this.id; }
  getParents() { let done = !this.parent; return { hasNext: () => !done, next: () => { done = true; return this.parent; } }; }
  moveTo(folder) { if (this.parent) this.parent.files = this.parent.files.filter(f => f !== this); this.parent = folder; folder.files.push(this); this.moves++; }
}
const root = new FakeFolder('salesranger-TOPSHOP', null);
const myDrive = new FakeFolder('My Drive', null);
const files = {};
const mkFile = (name, parent) => { const f = new FakeFile(name, parent); files[f.id] = f; return f; };

let props = { ENV_NAME: 'uat', CENTRAL_SHEET_FILEID: null, DB_ROOT_FOLDER_ID: root.getId() };
const tenants = [];
const ctx = {
  console, JSON, String, Number, Object, Array, Date, isFinite, parseInt, parseFloat, RegExp,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, setProperties: o => Object.assign(props, o) }) },
  DriveApp: {
    getFolderById: id => { const all = [root, myDrive]; const walk = f => { all.push(...f.folders); f.folders.forEach(walk); }; walk(root); walk(myDrive);
      const hit = all.find(f => f.getId() === id); if (!hit) throw new Error('ไม่พบโฟลเดอร์ ' + id); return hit; },
    getFileById: id => { if (!files[id]) throw new Error('File not found: ' + id); return files[id]; }
  },
  Logger: { log() {} },
  getConfig: () => ({ CENTRAL_SHEET_FILEID: props.CENTRAL_SHEET_FILEID }),
  centralObjects: n => (n === 'tenants' ? tenants : []),
  _requirePermission: (s, m, a) => (s && s.role_code ? null : { success: false, message: 'ไม่มีสิทธิ์' }),
  _isTrue: v => v === true || String(v) === 'TRUE' || String(v) === 'true',
  HOUSE_TENANT_ID: 'HOUSE'
};
vm.createContext(ctx);
vm.runInContext(B('24_drive_layout.gs'), ctx, { filename: '24_drive_layout.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const pathOf = f => { const parts = []; let p = f.parent; while (p) { parts.unshift(p.getName()); p = p.parent; } return parts.concat(f.getName()).join('/'); };
const SUPER = { role_code: 'super_admin', adminUserId: '1' };

// ── ไฟล์ทั้งหมดเริ่มต้นอยู่ My Drive (แบบที่ Apps Script สร้างไว้จริง) ──
const central = mkFile('TOPSHOP UAT — Central Sheet', myDrive);
props.CENTRAL_SHEET_FILEID = central.getId();
const house = mkFile('salesranger-TOPSHOP-HOUSE', myDrive);
const t1 = mkFile('salesranger-TOPSHOP-UATP705454', myDrive);
const t2 = mkFile('salesranger-TOPSHOP-UATP807100', myDrive);
tenants.push({ tenant_id: 'HOUSE', name: 'บริษัทเจ้าของสินค้า (ขายตรง)', sheet_file_id: house.getId(), is_house: 'TRUE' });
tenants.push({ tenant_id: 'UATP705454', name: 'ตัวแทนทดสอบราคา', sheet_file_id: t1.getId() });
tenants.push({ tenant_id: 'UATP807100', name: 'ตัวแทนอีกราย', sheet_file_id: t2.getId() });

console.log('\n── จัดระเบียบครั้งแรก (UAT) ──');
eq('ผู้ใช้ที่ไม่ใช่ super_admin → ปฏิเสธ', ctx.organizeDatabaseFiles({ role_code: 'owner_admin' }, {}).success, false);
let r = ctx.organizeDatabaseFiles(SUPER, {});
eq('จัดระเบียบสำเร็จ ย้าย 4 ไฟล์', [r.success, r.moved, r.failed], [true, 4, 0]);
eq('Central Sheet → db_uat/TNKI', pathOf(central), 'salesranger-TOPSHOP/db_uat/TNKI/TOPSHOP UAT — Central Sheet');
eq('ฐานข้อมูลบริษัท (HOUSE) → db_uat/TNKI ด้วย', pathOf(house), 'salesranger-TOPSHOP/db_uat/TNKI/salesranger-TOPSHOP-HOUSE');
eq('ตัวแทนแต่ละราย → db_uat/<รหัสตัวแทน>', [pathOf(t1), pathOf(t2)],
   ['salesranger-TOPSHOP/db_uat/UATP705454/salesranger-TOPSHOP-UATP705454', 'salesranger-TOPSHOP/db_uat/UATP807100/salesranger-TOPSHOP-UATP807100']);
eq('  โฟลเดอร์ใต้ db_uat = TNKI + 1 โฟลเดอร์ต่อตัวแทน', root.folders[0].folders.map(f => f.getName()).sort(), ['TNKI', 'UATP705454', 'UATP807100']);

console.log('\n── รันซ้ำ (idempotent) ──');
r = ctx.organizeDatabaseFiles(SUPER, {});
eq('รันซ้ำ ไม่ย้ายอะไรอีก', [r.success, r.moved], [true, 0]);
eq('  ไม่สร้างโฟลเดอร์ซ้ำ', root.folders.length, 1);
eq('  ทุกบรรทัดรายงานว่าอยู่ถูกที่แล้ว', r.report.every(x => x.status === 'อยู่ถูกที่แล้ว'), true);

console.log('\n── ตัวแทนใหม่หลังจัดระเบียบแล้ว ──');
const t3 = mkFile('salesranger-TOPSHOP-TNKN', myDrive);
tenants.push({ tenant_id: 'TNKN', name: 'ธนัทกร ภาคเหนือ', sheet_file_id: t3.getId() });
ctx._moveFileTo(t3.getId(), ctx._dbTenantFolder('TNKN'));
eq('ไฟล์ตัวแทนใหม่เข้าโฟลเดอร์รหัสตัวเอง', pathOf(t3), 'salesranger-TOPSHOP/db_uat/TNKN/salesranger-TOPSHOP-TNKN');

console.log('\n── คนละสภาพแวดล้อมต้องแยกกันสนิท ──');
props.ENV_NAME = 'prod';
const pCentral = mkFile('salesranger-TOPSHOP(prod) Central', myDrive);
props.CENTRAL_SHEET_FILEID = pCentral.getId();
const pt = mkFile('salesranger-TOPSHOP-TNKI-PROD', myDrive);
tenants.length = 0;
tenants.push({ tenant_id: 'HOUSE', name: 'บริษัทเจ้าของสินค้า', sheet_file_id: pt.getId(), is_house: 'TRUE' });
r = ctx.organizeDatabaseFiles(SUPER, {});
eq('prod ใช้ db_prod ไม่ปนกับ db_uat', [r.env, pathOf(pCentral)], ['prod', 'salesranger-TOPSHOP/db_prod/TNKI/salesranger-TOPSHOP(prod) Central']);
eq('  ไฟล์ของ UAT ไม่ถูกแตะ', pathOf(central), 'salesranger-TOPSHOP/db_uat/TNKI/TOPSHOP UAT — Central Sheet');
eq('  โฟลเดอร์ราก = db_uat + db_prod', root.folders.map(f => f.getName()).sort(), ['db_prod', 'db_uat']);
eq('ไม่ได้ตั้ง ENV_NAME → ถือว่าเป็น production', (() => { delete props.ENV_NAME; return ctx._envFolderName(); })(), 'db_prod');
props.ENV_NAME = 'uat';

console.log('\n── รายงานตำแหน่งไฟล์ ──');
props.CENTRAL_SHEET_FILEID = central.getId();
tenants.length = 0;
tenants.push({ tenant_id: 'HOUSE', name: 'บริษัท', sheet_file_id: house.getId(), is_house: 'TRUE' });
tenants.push({ tenant_id: 'UATP705454', name: 'ตัวแทนทดสอบราคา', sheet_file_id: t1.getId() });
const layout = ctx.getDatabaseLayout(SUPER);
eq('getDatabaseLayout บอกโฟลเดอร์ปัจจุบันของแต่ละไฟล์', layout.data.map(x => x.folder), ['db_uat/TNKI', 'db_uat/TNKI', 'db_uat/UATP705454']);
eq('  ไฟล์ที่เปิดไม่ได้ ไม่ทำให้ทั้งรายงานพัง', (() => {
  tenants.push({ tenant_id: 'GONE', name: 'ไฟล์หาย', sheet_file_id: 'XXX-not-exist' });
  const l = ctx.getDatabaseLayout(SUPER);
  return [l.success, /อ่านไม่ได้/.test(l.data[l.data.length - 1].folder)];
})(), [true, true]);

console.log('\n── ข้อความบอกวิธีแก้เมื่อสิทธิ์ไม่พอ ──');
ctx.DriveApp.getFolderById = () => { throw new Error('สิทธิ์ที่ระบุไว้ไม่เพียงพอที่จะเรียกใช้ DriveApp.getFolderById (https://www.googleapis.com/auth/drive)'); };
r = ctx.organizeDatabaseFiles(SUPER, {});
eq('สิทธิ์ OAuth ไม่พอ → บอกให้รัน authorizeDriveAccess()', [r.success, /authorizeDriveAccess/.test(r.message)], [false, true]);
ctx.DriveApp.getFolderById = () => { throw new Error('You do not have permission to access the requested document.'); };
eq('  ไม่มีสิทธิ์ในโฟลเดอร์ → บอกให้เช็คสิทธิ์บนไดรฟ์ที่แชร์', /ผู้จัดการเนื้อหา/.test(ctx.organizeDatabaseFiles(SUPER, {}).message), true);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
