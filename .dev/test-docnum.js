// รัน: node .dev/test-docnum.js — รูปแบบเลขที่เอกสาร (12_docnum.gs) บนชีตจำลอง ไม่ยิงเน็ต
//
// ★ สิ่งที่ชุดนี้มีไว้กัน (มาจากของจริงที่เจ้าของระบบเจอ 1 ต.ค. 2026):
//   1) กดบันทึกแก้ไขรูปแบบเดิม แล้วได้แถวใหม่เพิ่มมาอีกอัน active ทั้งคู่ (BDC มี SO สองแถว)
//   2) พอ active ซ้ำกัน เลขที่เอกสารจะมาจาก "แถวแรกที่เจอ" = ขึ้นกับลำดับแถวในชีต เดาไม่ได้
//   3) ปิดรูปแบบเดิมแล้วต้อง **ไม่** รีเซ็ตตัวนับ ไม่งั้นเลขรันซ้ำกับเอกสารที่ออกไปแล้วในงวดเดียวกัน
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) console.log('   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual));
  ok ? pass++ : fail++;
};

// ชีตของตัวแทน: เก็บเป็น array ของ object ตรงๆ (helper ที่ใช้ในไฟล์นี้อ่าน/เขียนผ่าน tenant* ทั้งหมด)
let series = [], counters = [];
const SESSION = { role_code: 'tenant_admin', tenant_id: 'BDC' };

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, Math,
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Logger: { log: () => {} },
  // วันที่ตรึงไว้ ไม่ให้เทสต์พังตอนขึ้นวันใหม่ (บทเรียนจาก test-purchasing-accounting 1 ต.ค. 2026)
  Utilities: { formatDate: (d, tz, fmt) =>
    ({ yyyyMMdd: '20261001', yyyyMM: '202610', yyyy: '2026', yyMM: '2610' })[fmt] || fmt },
  tenantObjects: (t, n) => (n === 'doc_number_series' ? series : counters).map(o => Object.assign({}, o)),
  tenantAppend: (t, n, o) => { (n === 'doc_number_series' ? series : counters).push(Object.assign({}, o)); },
  tenantUpdate: (t, n, id, patch) => {
    const arr = n === 'doc_number_series' ? series : counters;
    const row = arr.find(r => String(r.record_id) === String(id));
    if (row) Object.assign(row, patch);
    return !!row;
  },
  tenantNextId: () => series.reduce((m, o) => Math.max(m, parseInt(o.record_id, 10) || 0), 0) + 1,
  /* ★ ชีตตัวนับต้องเป็น "ตาราง 2 มิติจริง" — `getNextDocNumber`/`setDocCounter` เขียนผ่าน
     getRange/appendRow ไม่ใช่ tenantUpdate เพราะแถวตัวนับไม่มี record_id ตามสคีมา
     ถ้า mock เป็น array ของ object เฉยๆ โค้ดส่วนที่ขยับตัวนับจะไม่เคยถูกรันเลยในเทสต์ */
  tenantSheet: (t, n) => {
    const hdr = ['doc_type', 'period_key', 'last_number'];
    return {
      getDataRange: () => ({ getValues: () => [hdr].concat(counters.map(c => hdr.map(h => c[h]))) }),
      getRange: (row, col) => ({ setValue: v => { counters[row - 2][hdr[col - 1]] = v; } }),
      appendRow: r => { const o = {}; hdr.forEach((h, i) => { o[h] = r[i]; }); counters.push(o); }
    };
  },
  /* ★ ตัวนับของหมวดงานซื้อ/บัญชี (central: true) อยู่ในชีตกลาง คนละที่กับหมวดงานขาย
     ของจริงอยู่ใน 20_purchasing_master.gs / 23_accounting.gs ซึ่งไฟล์นี้ไม่ได้โหลด จึงดักไว้
     — ต้องมี ไม่งั้นเทสต์จะไม่เคยแตะเส้นทางที่ "ตั้งเลขแล้วไม่มีผล" ซึ่งเป็นบั๊กที่เพิ่งเจอ (7 ต.ค. 2026) */
  centralCounters: [],
  _normBook: t => (String(t || '') === 'TNKI' || String(t || '') === 'HOUSE' ? '' : String(t || '')),
  _centralDocConfig: (docType, scope) => ctx._docSeriesConfig(scope || 'TNKI', docType),
  centralObjects: n => ctx.centralCounters.map(o => Object.assign({}, o)),
  centralSheet: n => {
    const hdr = ['doc_type', 'period_key', 'last_number'];
    return {
      getDataRange: () => ({ getValues: () => [hdr].concat(ctx.centralCounters.map(c => hdr.map(h => c[h]))) }),
      getRange: (row, col) => ({ setValue: v => { ctx.centralCounters[row - 2][hdr[col - 1]] = v; } }),
      appendRow: r => { const o = {}; hdr.forEach((h, i) => { o[h] = r[i]; }); ctx.centralCounters.push(o); }
    };
  },
  _requirePermission: () => null,
  _salesTenantId: () => 'BDC',
};
// ★ ต้องเก็บ stub ไว้ "ก่อน" โหลด 02_helpers.gs ซึ่งประกาศ tenantSheet ตัวจริงทับ
const _tenantSheetStub = ctx.tenantSheet, _centralSheetStub = ctx.centralSheet,
      _centralObjectsStub = ctx.centralObjects;
vm.createContext(ctx);
['02_helpers.gs', '12_docnum.gs'].forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
// 02_helpers.gs ประกาศ tenant* ตัวจริงทับ mock — ต้องคืน mock หลังโหลด (แพทเทิร์นเดียวกับ test-owner-tenant.js)
Object.assign(ctx, {
  tenantSheet: _tenantSheetStub, centralSheet: _centralSheetStub, centralObjects: _centralObjectsStub,
  tenantObjects: (t, n) => (n === 'doc_number_series' ? series : counters).map(o => Object.assign({}, o)),
  tenantAppend: (t, n, o) => { (n === 'doc_number_series' ? series : counters).push(Object.assign({}, o)); },
  tenantUpdate: (t, n, id, patch) => {
    const arr = n === 'doc_number_series' ? series : counters;
    const row = arr.find(r => String(r.record_id) === String(id));
    if (row) Object.assign(row, patch);
    return !!row;
  },
  tenantNextId: () => series.reduce((m, o) => Math.max(m, parseInt(o.record_id, 10) || 0), 0) + 1,
  _requirePermission: () => null,
  _salesTenantId: () => 'BDC'
});

const actives = () => series.filter(s => s.doc_type === 'SO' && String(s.is_active) === 'TRUE');

console.log('\n-- บันทึกครั้งแรก --');
let r = ctx.saveDocSeries(SESSION, { docType: 'so', prefix: 'SO', dateFormat: 'yyyyMMdd', runningDigits: 4, resetCycle: 'daily', separator: '-' });
eq('บันทึกสำเร็จ', r.success, true);
eq('  ยังไม่มีของเดิมให้ปิด', r.superseded, 0);
eq('  ประเภทถูกทำเป็นตัวพิมพ์ใหญ่', series[0].doc_type, 'SO');
eq('  มีรูปแบบที่ใช้งานอยู่ 1 รายการ', actives().length, 1);

console.log('\n-- แก้ไขรูปแบบเดิม = ออกเวอร์ชันใหม่ ปิดของเก่า (อาการที่เจ้าของระบบแจ้ง) --');
r = ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'SONEW', dateFormat: 'yyMM', runningDigits: 5, resetCycle: 'monthly', separator: '/' });
eq('บันทึกสำเร็จ', r.success, true);
eq('  ปิดของเดิมไป 1 รายการ', r.superseded, 1);
eq('  ★ เหลือใช้งานอยู่ตัวเดียว (เดิมได้ 2)', actives().length, 1);
eq('  ตัวที่ใช้งานอยู่คือเวอร์ชันใหม่', actives()[0].prefix, 'SONEW');
eq('  แถวเก่ายังอยู่เป็นประวัติ ไม่ได้ลบ', series.length, 2);
eq('  แถวเก่าถูกปิด', series[0].is_active, 'FALSE');
eq('  เลขที่เอกสารใช้รูปแบบใหม่', ctx.previewNextDocNumber('BDC', 'SO'), 'SONEW/2610/00001');

console.log('\n-- ตัวนับต้องไม่ถูกรีเซ็ตเพราะเปลี่ยนรูปแบบ --');
counters.push({ doc_type: 'SO', period_key: '202610', last_number: 42 });
eq('เลขถัดไปนับต่อจากของเดิม ไม่ย้อนกลับไป 1', ctx.previewNextDocNumber('BDC', 'SO'), 'SONEW/2610/00043');
r = ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'SO3', dateFormat: 'yyMM', runningDigits: 5, resetCycle: 'monthly', separator: '/' });
eq('  บันทึกอีกเวอร์ชันแล้วตัวนับยังอยู่ที่เดิม', ctx.previewNextDocNumber('BDC', 'SO'), 'SO3/2610/00043');

console.log('\n-- ข้อมูลเก่าที่ active ซ้ำกันอยู่แล้ว --');
series = [
  { record_id: 1, doc_type: 'SO', prefix: 'OLD', date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-', is_active: 'TRUE' },
  { record_id: 2, doc_type: 'SO', prefix: 'NEW', date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-', is_active: 'TRUE' }
];
counters = [];
eq('★ ซ้ำกันอยู่ → ใช้เวอร์ชันใหม่สุด ไม่ใช่แถวแรกในชีต', ctx.previewNextDocNumber('BDC', 'SO'), 'NEW-20261001-0001');
r = ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'FIX', dateFormat: 'yyyyMMdd', runningDigits: 4, resetCycle: 'daily', separator: '-' });
eq('  กดบันทึกครั้งเดียว ปิดของซ้ำให้หมด (self-heal)', r.superseded, 2);
eq('  เหลือใช้งานอยู่ตัวเดียว', actives().length, 1);
eq('  คือตัวที่เพิ่งบันทึก', actives()[0].prefix, 'FIX');

console.log('\n-- ประเภทอื่นไม่ถูกแตะ --');
series.push({ record_id: 9, doc_type: 'INV', prefix: 'INV', date_format: '', running_digits: 3, reset_cycle: 'none', separator: '-', is_active: 'TRUE' });
r = ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'SO9', dateFormat: '', runningDigits: 3, resetCycle: 'none', separator: '-' });
eq('ปิดเฉพาะ SO ไม่ยุ่งกับ INV', series.find(s => s.doc_type === 'INV').is_active, 'TRUE');
/* ★ 7 ต.ค. 2026 — preview ของหมวดงานซื้อ/บัญชีมี "รหัสบริษัทคั่น" แล้ว ให้ตรงกับเลขที่ออกจริง
   ของเดิมโชว์ INV-001 แต่เลขจริงที่ _nextCentralDocNo ออกให้คือ INV-BDC-001 — preview โกหกมาตลอด */
eq('  INV ยังออกเลขได้ตามรูปแบบตัวเอง (มีรหัสบริษัทคั่นเหมือนเลขจริง)',
   ctx.previewNextDocNumber('BDC', 'INV'), 'INV-BDC-001');

console.log('\n-- กันพลาด --');
eq('ไม่ระบุประเภท → ปฏิเสธ', ctx.saveDocSeries(SESSION, { prefix: 'X' }).success, false);
eq('  ประเภทเว้นวรรคล้วน → ปฏิเสธ', ctx.saveDocSeries(SESSION, { docType: '   ' }).success, false);
// PO ยังไม่ได้ตั้ง → ใช้ค่าเริ่มต้นประจำหมวด (รายเดือน ไม่ใช่รายวันแบบ SO)
eq('ไม่มีรูปแบบเลย → ใช้ค่าเริ่มต้นประจำหมวด (และมีรหัสบริษัทคั่น)',
   ctx.previewNextDocNumber('BDC', 'PO'), 'PO-BDC-202610-0001');
eq('รายการเรียงใหม่สุดขึ้นก่อน', ctx.listDocSeries(SESSION, {}).data[0].record_id,
  series.reduce((m, o) => Math.max(m, o.record_id), 0));

/* ── ประเภทเอกสารต้องเลือกจากของที่มีจริง (1 ต.ค. 2026) ──
   ช่องนี้เคยเป็นช่องพิมพ์อิสระ พิมพ์ PO ลงไปก็บันทึกผ่าน แล้วได้แถวที่ไม่มีโค้ดไหนอ่าน
   "บันทึกสำเร็จแต่ไม่มีผล" แย่กว่าปฏิเสธ เพราะคนตั้งค่าไม่มีทางรู้ */
console.log('\n-- ประเภทเอกสารที่ตั้งได้ --');
series = [];
// DO = ใบส่งสินค้า (6 ต.ค. 2026) — ใช้ตัวนับของตัวแทนเหมือน SO จึงอยู่ติดกัน ไม่ใช่กลุ่มตัวนับกลาง
eq('ครบทุกหมวดที่ต้องมีเลขกำกับ', ctx.listDocSeries(SESSION, {}).types.map(t => t.code),
  ['SO', 'DO', 'PICK', 'RC', 'TAX-IV', 'PR', 'PO', 'GR', 'AP', 'PV', 'INV', 'RV', 'JV']);
eq('  หมวดที่ใช้ตัวนับกลางถูกติดธงไว้', ctx.listDocSeries(SESSION, {}).types.filter(t => t.central).map(t => t.code),
  ['PR', 'PO', 'GR', 'AP', 'PV', 'INV', 'RV', 'JV']);
r = ctx.saveDocSeries(SESSION, { docType: 'PO', prefix: 'PO' });
eq('★ ตั้ง PO ได้แล้ว (เดิมฮาร์ดโค้ด แก้ไม่ได้)', r.success, true);
series = [];
r = ctx.saveDocSeries(SESSION, { docType: 'ZZZ', prefix: 'Z' });
eq('★ ตั้งประเภทมั่วไม่ได้', r.success, false);
eq('  บอกว่าตั้งได้เฉพาะอะไร', /SO/.test(r.message), true);
eq('  ไม่มีแถวไหนถูกเขียนลงไป', series.length, 0);

console.log('\n-- ของเก่าที่เคยพิมพ์มือไว้ ต้องยังแก้/ปิดได้ --');
series = [{ record_id: 1, doc_type: 'QT', prefix: 'QT', date_format: '', running_digits: 4, reset_cycle: 'none', separator: '-', is_active: 'TRUE' }];
eq('ประเภทที่มีในข้อมูลแล้วโผล่ต่อท้ายลิสต์มาตรฐาน',
  ctx.listDocSeries(SESSION, {}).types.map(t => t.code).slice(-1), ['QT']);
eq('  ติดธงว่าเป็นของเดิม', ctx.listDocSeries(SESSION, {}).types.find(t => t.code === 'QT').legacy, true);
r = ctx.saveDocSeries(SESSION, { docType: 'QT', prefix: 'QT2' });
eq('  แก้ของเดิมได้ (ไม่งั้นค้างถาวร แก้ไม่ได้ ปิดไม่ได้)', r.success, true);
eq('  และยังปิดแถวเดิมตามกติกา', series.filter(s => s.doc_type === 'QT' && String(s.is_active) === 'TRUE').length, 1);

/* ── ★ ค่าเริ่มต้นของทุกหมวดต้องให้ผล "เหมือนที่ระบบเคยออก" เป๊ะ (1 ต.ค. 2026) ──
   ตอนนี้เลขเอกสารกลางอ่านรูปแบบจากค่าตั้งแล้ว ถ้า default เพี้ยนแม้ตัวอักษรเดียว
   เลขเอกสารทั้งระบบจะเปลี่ยนหน้าตาเองวันที่ deploy โดยไม่มีใครสั่ง */
console.log('\n-- ค่าเริ่มต้นต้องเหมือนของเดิมทุกหมวด --');
series = [];
eq('SO (ตัวนับในไฟล์ตัวแทน) — รายวัน', ctx.previewNextDocNumber('BDC', 'SO'), 'SO-20261001-0001');
const centralDefaults = { PR: 'PR', PO: 'PO', GR: 'GR', AP: 'AP', PV: 'PV', INV: 'INV', RV: 'RV', JV: 'JV' };
Object.keys(centralDefaults).forEach(code => {
  const cfg = ctx._docSeriesConfig('BDC', code);
  eq('  ' + code + ' — ค่าเริ่มต้น <รหัส>-yyyyMM-0000 รีเซ็ตรายเดือน',
    [cfg.prefix, cfg.date_format, cfg.running_digits, cfg.reset_cycle, cfg.separator],
    [centralDefaults[code], 'yyyyMM', 4, 'monthly', '-']);
});

/* ── รูปแบบวันที่ต้องละเอียดพอกับรอบรีเซ็ต ไม่งั้นเลขซ้ำ ── */
console.log('\n-- กันเลขซ้ำ: วันที่ต้องแยกงวดได้ --');
eq('รีเซ็ตรายเดือน + วันที่ yyyy → ปฏิเสธ (พ.ย. จะได้เลขซ้ำ ต.ค.)',
  ctx.saveDocSeries(SESSION, { docType: 'SO', dateFormat: 'yyyy', resetCycle: 'monthly' }).success, false);
eq('รีเซ็ตรายวัน + วันที่ yyMM → ปฏิเสธ', ctx.saveDocSeries(SESSION, { docType: 'SO', dateFormat: 'yyMM', resetCycle: 'daily' }).success, false);
eq('รีเซ็ตรายเดือน + ไม่ใส่วันที่ → ปฏิเสธ', ctx.saveDocSeries(SESSION, { docType: 'SO', dateFormat: '', resetCycle: 'monthly' }).success, false);
eq('  ข้อความบอกว่าต้องมีอะไร', /ปีและเดือน/.test(ctx.saveDocSeries(SESSION, { docType: 'SO', dateFormat: 'yyyy', resetCycle: 'monthly' }).message), true);
eq('ไม่รีเซ็ตเลย + ไม่ใส่วันที่ → ผ่าน (เลขรันไม่ซ้ำอยู่แล้ว)',
  ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'SO', dateFormat: '', resetCycle: 'none' }).success, true);
eq('รีเซ็ตรายเดือน + yyyyMM → ผ่าน', ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'SO', dateFormat: 'yyyyMM', resetCycle: 'monthly' }).success, true);
eq('รีเซ็ตรายวัน + yyyyMMdd → ผ่าน', ctx.saveDocSeries(SESSION, { docType: 'SO', prefix: 'SO', dateFormat: 'yyyyMMdd', resetCycle: 'daily' }).success, true);

console.log('\n-- ตั้งค่าแล้วมีผลจริงกับหมวดกลาง --');
series = [];
ctx.saveDocSeries(SESSION, { docType: 'PO', prefix: 'ใบสั่งซื้อ', dateFormat: 'yyyy', runningDigits: 5, resetCycle: 'yearly', separator: '/' });
let cfg = ctx._docSeriesConfig('BDC', 'PO');
eq('รูปแบบที่ตั้งถูกอ่านกลับมาใช้', [cfg.prefix, cfg.date_format, cfg.running_digits, cfg.reset_cycle, cfg.separator],
  ['ใบสั่งซื้อ', 'yyyy', 5, 'yearly', '/']);
eq('  หมวดอื่นยังเป็นค่าเริ่มต้น', ctx._docSeriesConfig('BDC', 'GR').prefix, 'GR');

console.log('\n── ★ ตั้งเลขถัดไปตอนย้ายเล่มจากระบบเดิม (เจ้าของระบบสั่ง 7 ต.ค. 2026) ──');
/* ย้ายจากระบบเดิมมาแล้วต้องนับต่อจากเล่มเก่า ไม่ใช่เริ่ม 0001 ใหม่
   ★ ข้อที่สำคัญที่สุดคือ "ลดตัวนับไม่ได้" — ลดแล้วระบบจะออกเลขที่มีเอกสารจริงถืออยู่แล้วซ้ำอีกใบ
     ใบกำกับภาษีซ้ำเลขเป็นปัญหากับสรรพากร และแก้ย้อนหลังไม่ได้เลย
     (ตั้งเกินไปโดยพลาดยังเดินหน้าต่อได้ ยอมเลขกระโดด ดีกว่าเลขซ้ำ) */
{
  const bad = (label, r, re) => {
    const good = r && r.success === false && (!re || re.test(r.message || ''));
    console.log((good ? 'PASS ' : 'FAIL ') + label + (good ? '' : '\n   got ' + JSON.stringify(r)));
    good ? pass++ : fail++;
  };

  eq('ใบแรกของเล่มใหม่เริ่มที่ 0001', ctx.getNextDocNumber('BDC', 'TAX-IV'), 'TAX-IV-20261001-0001');

  bad('ตั้งย้อนหลังต่ำกว่าที่ออกไปแล้ว → ปฏิเสธ (ไม่มีทางลัด)',
    ctx.setDocCounter(SESSION, { docType: 'TAX-IV', nextNumber: 1 }), /ออกเลขซ้ำ|ตั้งได้ตั้งแต่/);
  bad('ตั้งเป็น 0 → ปฏิเสธ', ctx.setDocCounter(SESSION, { docType: 'TAX-IV', nextNumber: 0 }), /ตั้งแต่ 1/);
  bad('ประเภทที่ไม่รู้จัก → ปฏิเสธ', ctx.setDocCounter(SESSION, { docType: 'ZZZ', nextNumber: 5 }), /ไม่รู้จัก/);

  const r = ctx.setDocCounter(SESSION, { docType: 'TAX-IV', nextNumber: 1251 });
  eq('ตั้งเลขถัดไป = 1251 (เล่มเดิมเดินถึง 1250)',
    [r.success, r.previousLast, r.sample], [true, 1, 'TAX-IV-20261001-1251']);
  eq('  ★ ใบถัดไปได้เลขนั้นจริง ไม่ใช่แค่ตอบว่าสำเร็จ', ctx.getNextDocNumber('BDC', 'TAX-IV'), 'TAX-IV-20261001-1251');
  eq('  แล้วเดินต่อตามปกติ', ctx.getNextDocNumber('BDC', 'TAX-IV'), 'TAX-IV-20261001-1252');
  eq('  ★ ไม่ไปกระทบเล่มของเอกสารประเภทอื่น', ctx.getNextDocNumber('BDC', 'RC'), 'RC-20261001-0001');
  eq('  ตั้งเท่าเลขถัดไปที่จะได้อยู่แล้ว (ไม่ถอยหลัง) → ยอม',
    ctx.setDocCounter(SESSION, { docType: 'TAX-IV', nextNumber: 1253 }).success, true);
}

console.log('\n── ★★ หมวดงานซื้อ/บัญชีใช้ตัวนับคนละที่ — preview และตั้งเลขต้องไปที่ถูกที่ (7 ต.ค. 2026) ──');
/* บั๊กที่เพิ่งเจอ: previewNextDocNumber กับ setDocCounter ดูแต่ตัวนับในไฟล์บริษัท
   หมวดงานซื้อ/บัญชี (central: true) จึง preview เลขผิด และ "ตั้งเลขแล้วไม่มีผลเลย"
   โดยหน้าจอตอบว่าสำเร็จ — อาการที่แย่ที่สุด (บันทึกได้แต่ไม่มีผล)
   ★ และเลขของหมวดกลางมีรหัสบริษัทคั่นหลัง prefix ซึ่ง _formatDocNumber เดิมไม่ได้ใส่ให้ */
{
  const bad2 = (label, r, re) => {
    const good = r && r.success === false && (!re || re.test(r.message || ''));
    console.log((good ? 'PASS ' : 'FAIL ') + label + (good ? '' : '\n   got ' + JSON.stringify(r)));
    good ? pass++ : fail++;
  };
  ctx.centralCounters.length = 0;
  ctx.centralCounters.push({ doc_type: 'AP@BDC', period_key: '202610', last_number: 7 });

  eq('preview ของหมวดกลางอ่านจากตัวนับกลาง + มีรหัสบริษัทคั่น',
    ctx.previewNextDocNumber('BDC', 'AP'), 'AP-BDC-202610-0008');
  eq('  ★ สมุดของบริษัทเองใช้คีย์เปล่า ไม่มีรหัสคั่น (ยังไม่เคยออก → 0001)',
    ctx.previewNextDocNumber('TNKI', 'AP'), 'AP-202610-0001');

  bad2('ตั้งต่ำกว่าที่ออกไปแล้ว → ปฏิเสธ (อ่านเลขล่าสุดจากตัวนับกลางได้ถูก)',
    ctx.setDocCounter(SESSION, { docType: 'AP', nextNumber: 5 }), /ออกถึงเลข 7/);

  const r2 = ctx.setDocCounter(SESSION, { docType: 'AP', nextNumber: 501 });
  eq('ตั้งเลขถัดไปของหมวดกลางได้ และตัวอย่างเลขถูกรูป',
    [r2.success, r2.sample], [true, 'AP-BDC-202610-0501']);
  eq('  ★★ เขียนลง "ตัวนับกลาง" จริง ไม่ใช่ไฟล์บริษัท (ข้อที่เคยพลาด)',
    ctx.centralCounters.find(c => c.doc_type === 'AP@BDC').last_number, 500);
  eq('  preview หลังตั้งตรงกับที่ตั้งไว้', ctx.previewNextDocNumber('BDC', 'AP'), 'AP-BDC-202610-0501');
}

console.log('\n── ★ listDocSeries ส่ง "เลขที่เอกสารถัดไป" มาให้ตารางด้วย (เจ้าของระบบสั่ง 7 ต.ค. 2026) ──');
/* คิดฝั่ง backend ในคำขอเดียว ไม่ให้หน้าเว็บยิง previewDocNumber ทีละแถว
   (Apps Script มีค่าคงที่ ~1.9 วินาทีต่อคำขอ 13 แถวก็เกือบครึ่งนาที) */
{
  const d = ctx.listDocSeries(SESSION, {}).data;
  const act = d.filter(r => String(r.is_active) === 'TRUE');
  eq('ทุกแถวที่ใช้งานอยู่มีเลขถัดไปครบ ไม่มีช่องว่าง',
    act.length > 0 && act.every(r => !!r.next_number), true);
  /* ★ ต้องเป็นเลขที่ "ประกอบเสร็จแล้ว" ไม่ใช่เลขรันเปล่าๆ — คนอ่านต้องเห็นหน้าตาเลขจริง
     และหมวดงานซื้อ/บัญชีต้องมีรหัสบริษัทคั่นเหมือนเลขที่ออกจริง */
  /* ★ สร้างแถวเองแทนการ "ถ้าเจอค่อยเช็ค" — เงื่อนไข if ทำให้เทสต์ข้ามเงียบๆ แล้วขึ้นเขียวหลอกตา
     (เพิ่งโดนมาเมื่อครู่: สองข้อนี้ไม่เคยรันเลยตอนเขียนครั้งแรก) */
  ctx.saveDocSeries(SESSION, { docType: 'AP', prefix: 'AP', dateFormat: 'yyyyMM', runningDigits: 4,
    resetCycle: 'monthly', separator: '-' });
  const d2 = ctx.listDocSeries(SESSION, {}).data;
  const ap = d2.find(r => r.doc_type === 'AP' && String(r.is_active) === 'TRUE');
  eq('  หมวดกลางมีรหัสบริษัทคั่น ตรงกับเลขที่ออกจริง', !!ap && /^AP-BDC-/.test(ap.next_number), true);
  const inact = d.filter(r => String(r.is_active) !== 'TRUE');
  eq('  ★ แถวที่ปิดไปแล้วไม่โชว์เลข (เป็นประวัติของรูปแบบเก่า เลขไม่ได้ออกจากแถวนั้น)',
    inact.every(r => !r.next_number), true);
  // เทียบกับตัว preview ตรงๆ — ถ้าวันหนึ่งมีใครไปประกอบเลขในตารางด้วยสูตรที่สอง จะจับได้ตรงนี้
  eq('  ตรงกับ previewNextDocNumber ของหมวดเดียวกัน (ไม่ได้ประกอบคนละสูตร)',
    ap && ap.next_number, ctx.previewNextDocNumber('BDC', 'AP'));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'ALL PASSED'));
process.exit(fail ? 1 : 0);
