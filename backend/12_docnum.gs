/**
 * ===================== DOCUMENT NUMBER CONTROL (ต่อตัวแทน) =====================
 * แต่ละตัวแทนกำหนดรูปแบบเลขเอกสารเองได้ (2.1 — สิทธิ์ฝั่งตัวแทน) เก็บใน tenant sheet
 * doc_number_series : record_id, doc_type, prefix, date_format, running_digits, reset_cycle, separator, is_active
 *   - reset_cycle: 'none' | 'yearly' | 'monthly' | 'daily'
 *   - date_format: รูปแบบวันที่แทรกในเลขเอกสาร เช่น 'yyyyMMdd', 'yyMM', '' (ไม่ใส่)
 * doc_number_counters : doc_type, period_key, last_number  (period_key ขึ้นกับ reset_cycle)
 *
 * ใช้ getNextDocNumber() เฉพาะตอน "กำลังจะสร้างเอกสารจริง" เท่านั้น (มันขยับตัวนับ)
 * ถ้าแค่โชว์ preview ใน UI ให้ใช้ previewNextDocNumber() แทน (ไม่ขยับตัวนับ)
 */

function _docSeriesConfig(tenantId, docType) {
  var rows = tenantObjects(tenantId, 'doc_number_series');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].doc_type) === String(docType) && isFlagOn(rows[i].is_active)) return rows[i];
  }
  // ไม่มีตั้งค่าไว้ → ใช้ค่า default กลาง
  return { doc_type: docType, prefix: docType, date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-' };
}

function _periodKey(resetCycle) {
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  if (resetCycle === 'yearly')  return Utilities.formatDate(now, tz, 'yyyy');
  if (resetCycle === 'monthly') return Utilities.formatDate(now, tz, 'yyyyMM');
  if (resetCycle === 'daily')   return Utilities.formatDate(now, tz, 'yyyyMMdd');
  return 'ALL';
}

function _formatDocNumber(cfg, periodKey, runningNo) {
  var tz = Session.getScriptTimeZone();
  var parts = [cfg.prefix];
  if (cfg.date_format) parts.push(Utilities.formatDate(new Date(), tz, cfg.date_format));
  var digits = parseInt(cfg.running_digits) || 4;
  var padded = String(runningNo);
  while (padded.length < digits) padded = '0' + padded;
  parts.push(padded);
  return parts.join(cfg.separator || '-');
}

// ใช้ตอนสร้างเอกสารจริงเท่านั้น — ขยับตัวนับ
function getNextDocNumber(tenantId, docType) {
  var cfg = _docSeriesConfig(tenantId, docType);
  var periodKey = _periodKey(cfg.reset_cycle);

  var sh = tenantSheet(tenantId, 'doc_number_counters');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(docType) && String(data[i][1]) === periodKey) {
      var next = (parseInt(data[i][2]) || 0) + 1;
      sh.getRange(i + 1, 3).setValue(next);
      return _formatDocNumber(cfg, periodKey, next);
    }
  }
  sh.appendRow([docType, periodKey, 1]);
  return _formatDocNumber(cfg, periodKey, 1);
}

// preview เฉยๆ ไม่ขยับตัวนับ — ใช้โชว์ล่วงหน้าใน UI
function previewNextDocNumber(tenantId, docType) {
  var cfg = _docSeriesConfig(tenantId, docType);
  var periodKey = _periodKey(cfg.reset_cycle);
  var rows = tenantObjects(tenantId, 'doc_number_counters');
  var last = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].doc_type) === String(docType) && String(rows[i].period_key) === periodKey) { last = parseInt(rows[i].last_number) || 0; break; }
  }
  return _formatDocNumber(cfg, periodKey, last + 1);
}

// preview เลขเอกสารถัดไปให้ Admin App โชว์ก่อนสร้างเอกสารจริง
function previewDocNumberAdmin(session, payload) {
  var err = _requirePermission(session, 'docnum', 'view'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  return { success: true, docNumber: previewNextDocNumber(tenantId, payload.docType) };
}

// ── Admin CRUD (ตัวแทน หรือ Ultra Admin ที่สวมสิทธิ์ตัวแทน จัดการรูปแบบเลขเอกสาร) ──
function listDocSeries(session, payload) {
  var err = _requirePermission(session, 'docnum', 'view'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload || {});
  if (!tenantId) return { success: false, message: 'กรุณาเลือกตัวแทนจำหน่ายก่อน' };
  return { success: true, data: tenantObjects(tenantId, 'doc_number_series') };
}

function addDocSeries(session, payload) {
  var err = _requirePermission(session, 'docnum', 'edit'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาเลือกตัวแทนจำหน่ายก่อน' };
  tenantAppend(tenantId, 'doc_number_series', {
    record_id: tenantNextId(tenantId, 'doc_number_series'),
    doc_type: payload.docType, prefix: payload.prefix || payload.docType,
    date_format: payload.dateFormat || 'yyyyMMdd', running_digits: payload.runningDigits || 4,
    reset_cycle: payload.resetCycle || 'daily', separator: payload.separator || '-', is_active: 'TRUE'
  });
  return { success: true };
}

function updateDocSeries(session, payload) {
  var err = _requirePermission(session, 'docnum', 'edit'); if (err) return err;
  var tenantId = _effectiveTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาเลือกตัวแทนจำหน่ายก่อน' };
  tenantUpdate(tenantId, 'doc_number_series', payload.id, {
    prefix: payload.prefix, date_format: payload.dateFormat, running_digits: payload.runningDigits,
    reset_cycle: payload.resetCycle, separator: payload.separator, is_active: payload.isActive
  });
  return { success: true };
}
