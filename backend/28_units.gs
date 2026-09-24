/**
 * ===================== หน่วยนับมาตรฐานของระบบ =====================
 * เจ้าของระบบกำหนด (2026-09-24): ทั้งระบบใช้ **3 หน่วยเท่านั้น**
 *   CT = ลัง   — หน่วยใหญ่ที่ใช้ตั้งขั้นราคา (เดิมเรียก "หีบ" รหัส CASE — เลิกใช้แล้ว)
 *   PK = แพ็ค  — ขายได้เฉพาะ Cash Van + เงินสด (ดู priceCart ใน 18_pricing_engine.gs)
 *   PC = ชิ้น  — หน่วยฐานที่เก็บสต็อกและคิดต้นทุนทุกอย่าง
 *
 * ข้อมูลเก่ายังมีรหัส CASE/PACK/pcs/SHEET ปนอยู่ได้ (ก่อน migrateUnitCodes() ใน 99_dev_tools.gs จะรัน)
 * และแอปมือถือรุ่นเก่าที่ค้างในเครื่องพนักงานก็อาจส่งรหัสเก่ามา — ทุกจุดที่เทียบรหัสหน่วยจึงต้องผ่าน
 * normUnitCode() เสมอ ห้ามเทียบสตริงดิบ (เช่น `x.unit_code === 'CT'`) ไม่งั้นบิลจากรหัสเก่าจะหาไม่เจอ
 */
var UNIT_CT = 'CT', UNIT_PK = 'PK', UNIT_PC = 'PC';
var UNIT_LABELS = { CT: 'ลัง', PK: 'แพ็ค', PC: 'ชิ้น' };

// รหัส/คำเรียกทั้งหมดที่เคยใช้ → รหัสมาตรฐาน (คีย์ตัวพิมพ์ใหญ่ ยกเว้นคำไทยที่เทียบตรงๆ)
var UNIT_ALIASES = {
  CT: UNIT_CT, CASE: UNIT_CT, CS: UNIT_CT, CTN: UNIT_CT, 'หีบ': UNIT_CT, 'ลัง': UNIT_CT,
  PK: UNIT_PK, PACK: UNIT_PK, PCK: UNIT_PK, 'แพ็ค': UNIT_PK, 'แพค': UNIT_PK, 'แพ็คเกจ': UNIT_PK,
  PC: UNIT_PC, PCS: UNIT_PC, PIECE: UNIT_PC, SHEET: UNIT_PC, EA: UNIT_PC,
  'ชิ้น': UNIT_PC, 'แผ่น': UNIT_PC, 'ซอง': UNIT_PC, 'อัน': UNIT_PC
};

/** รหัสหน่วยมาตรฐานของค่าที่รับมา — ว่าง = คืน dflt (ปกติคือหน่วยฐาน PC) · ไม่รู้จัก = คืนตัวพิมพ์ใหญ่ตามเดิม */
function normUnitCode(code, dflt) {
  var s = String(code === null || code === undefined ? '' : code).trim();
  if (!s) return dflt === undefined ? '' : dflt;
  var hit = UNIT_ALIASES[s];
  if (hit) return hit;
  hit = UNIT_ALIASES[s.toUpperCase()];
  return hit || s.toUpperCase();
}
/** ชื่อไทยของหน่วย (ไม่รู้จัก = คืนค่าที่ส่งมา เพื่อไม่ให้ข้อมูลเก่าหายไปจากจอ) */
function unitLabelOf(code) {
  var c = normUnitCode(code);
  return UNIT_LABELS[c] || String(code || '');
}
function isCaseUnit(code) { return normUnitCode(code) === UNIT_CT; }
function isPackUnit(code) { return normUnitCode(code) === UNIT_PK; }
function isBaseUnit(code) { return normUnitCode(code, UNIT_PC) === UNIT_PC; }

/* ═══════════════ แปลงข้อมูลเก่าให้เป็นรหัสมาตรฐาน ═══════════════
 * รันครั้งเดียวต่อสภาพแวดล้อม (action migrateUnitCodes — super_admin เท่านั้น หรือเรียกจาก editor)
 * แตะเฉพาะ "หน่วยขาย" ที่โค้ดเอาไปเทียบรหัส: products / product_units / price_list_items / order_items ของตัวแทน
 * ไม่แตะหน่วยในเอกสารจัดซื้อ (pr_items/po_items/gr_items) เพราะเป็นข้อความหน่วยของผู้ขาย ไม่ได้ถูกเทียบกับรหัสใด
 * รันซ้ำได้ ไม่ทำอะไรกับแถวที่เป็นรหัสมาตรฐานอยู่แล้ว
 */
function _migrateUnitColumn(sh, colName, dflt, labelCol) {
  if (!sh) return 0;
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return 0;
  var head = data[0].map(function(h) { return String(h); });
  var c = head.indexOf(colName); if (c === -1) return 0;
  var lc = labelCol ? head.indexOf(labelCol) : -1;
  var codes = [], labels = [], changed = 0;
  for (var i = 1; i < data.length; i++) {
    var oldCode = data[i][c], oldLabel = lc === -1 ? '' : data[i][lc];
    // แถวว่าง (ไม่มี record_id) และแถวที่ปล่อยหน่วยว่างไว้โดยตั้งใจ (ของแถม/หน่วยฐานในแอปมือถือ) — ไม่แตะ
    var keep = String(data[i][0] || '').trim() === '' || String(oldCode || '').trim() === '';
    var newCode = keep ? oldCode : normUnitCode(oldCode, dflt);
    codes.push([newCode]);
    if (lc !== -1) labels.push([keep ? oldLabel : (UNIT_LABELS[newCode] || oldLabel)]);
    if (String(newCode) !== String(oldCode)) changed++;
  }
  if (!changed) return 0;
  try { centralInvalidate(sh.getName()); } catch (e) {}   // เขียนทั้งคอลัมน์แบบดิบ
  sh.getRange(2, c + 1, codes.length, 1).setValues(codes);
  if (lc !== -1) sh.getRange(2, lc + 1, labels.length, 1).setValues(labels);
  return changed;
}

function migrateUnitCodes(session) {
  if (session && session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะ super_admin เท่านั้น' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { success: false, message: 'ระบบกำลังบันทึกข้อมูลอยู่ ลองใหม่อีกครั้ง' };
  try {
    var report = {};
    report.products     = _migrateUnitColumn(centralSheet('products'), 'unit_code', UNIT_PC, 'unit');
    report.product_units = _migrateUnitColumn(centralSheet('product_units'), 'unit_code', UNIT_PC, 'unit_label');
    report.price_list_items = _migrateUnitColumn(centralSheet('price_list_items'), 'unit_code', UNIT_CT);
    report.tenants = {};
    centralObjects('tenants').forEach(function(t) {
      try { report.tenants[t.tenant_id] = _migrateUnitColumn(tenantSheet(t.tenant_id, 'order_items'), 'unit_code', UNIT_PC); }
      catch (e) { report.tenants[t.tenant_id] = 'ผิดพลาด: ' + e.message; }
    });
    Logger.log('migrateUnitCodes: ' + JSON.stringify(report));
    return { success: true, message: 'แปลงรหัสหน่วยเป็น CT/PK/PC แล้ว', report: report };
  } finally { lock.releaseLock(); }
}
