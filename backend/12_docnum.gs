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

/* ประเภทเอกสารที่ "ตั้งรูปแบบได้จริง" จากหน้าจอนี้ (1 ต.ค. 2026)
   ★ ต้องตรงกับของที่เรียก `getNextDocNumber()` จริงๆ เท่านั้น — เจ้าของระบบถามว่า "จะรู้ได้ยังไงว่า
     ระบบมีประเภทอะไรให้ตั้ง" เพราะช่องนี้เคยเป็น**ช่องพิมพ์อิสระ** พิมพ์ PO ลงไปก็บันทึกได้
     แล้วได้แถวที่ไม่มีโค้ดไหนอ่านเลย ไม่มีอะไรฟ้อง — เงียบจนกว่าจะมีคนสงสัยว่าทำไมตั้งแล้วไม่เปลี่ยน
   **เพิ่มเอกสารที่ออกเลขด้วย `getNextDocNumber()` เมื่อไหร่ ต้องมาเพิ่มที่นี่ด้วย** ไม่งั้นตั้งค่าไม่ได้ */
var DOC_SERIES_TYPES = [
  { code: 'SO', label: 'ใบขาย / ใบสั่งขาย', note: 'ใช้กับบิลขายทั้งจากแอปมือถือและแอดมิน' }
];

/* เอกสารที่ออกเลขจาก **ชุดเลขกลาง** (`_nextCentralDocNo` ใน 20_purchasing_master.gs) — รูปแบบตายตัว
   `<PREFIX>-<yyyyMM>-<รัน 4 หลัก>` (ของตัวแทนแทรกรหัสตัวแทนด้วย เช่น PO-TNKN-202610-0001) รีเซ็ตรายเดือน
   ตั้งค่าจากหน้านี้ไม่ได้ แต่ต้อง**บอกให้ผู้ใช้รู้ว่ามีอยู่** ไม่งั้นจะนั่งหาว่าทำไมตั้งเลขใบสั่งซื้อไม่ได้ */
var DOC_FIXED_TYPES = [
  { code: 'PR',  label: 'ใบขอซื้อ' },        { code: 'PO',  label: 'ใบสั่งซื้อ' },
  { code: 'GR',  label: 'ใบรับของ' },        { code: 'AP',  label: 'ตั้งหนี้เจ้าหนี้' },
  { code: 'PV',  label: 'ใบสำคัญจ่าย' },     { code: 'INV', label: 'ใบแจ้งหนี้ลูกค้า' },
  { code: 'RV',  label: 'ใบสำคัญรับ' },      { code: 'JV',  label: 'ใบสำคัญทั่วไป' }
];

/* รูปแบบที่ "ใช้อยู่จริง" ของเอกสารประเภทนี้
   ★ 1 ต.ค. 2026 — ต้องเลือก **เวอร์ชันใหม่สุด** ไม่ใช่แถวแรกที่เจอ
   ของเดิมคืนแถวแรกที่ active ซึ่งแปลว่า "ขึ้นกับลำดับแถวในชีต" · ถ้ามี SO สองแถว active พร้อมกัน
   (เกิดขึ้นจริงกับ BDC เพราะปุ่มบันทึกเคย append ใหม่ทุกครั้ง) เลขที่เอกสารจะมาจากแถวไหนก็เดาไม่ได้
   และอาจสลับไปมาระหว่างคำขอ — บั๊กแบบเดียวกับที่เคยเจอในกฎสิทธิ์ชุดราคา (ดู 36_price_rules.gs)
   ตอนนี้ `saveDocSeries` ปิดของเก่าให้เหลือ active ตัวเดียวอยู่แล้ว ตัวนี้เป็นกันชนอีกชั้น
   สำหรับข้อมูลเก่าที่ยังซ้ำอยู่และยังไม่มีใครกดบันทึกทับ */
function _docSeriesConfig(tenantId, docType) {
  var rows = tenantObjects(tenantId, 'doc_number_series');
  var best = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].doc_type) !== String(docType) || !isFlagOn(rows[i].is_active)) continue;
    if (!best || (parseInt(rows[i].record_id, 10) || 0) > (parseInt(best.record_id, 10) || 0)) best = rows[i];
  }
  if (best) return best;
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
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  return { success: true, docNumber: previewNextDocNumber(tenantId, payload.docType) };
}

/* ── Admin CRUD: จัดการรูปแบบเลขที่เอกสารของ "สมุดที่กำลังทำงานอยู่" ──
   ★ 1 ต.ค. 2026 เปลี่ยนจาก `_effectiveTenantId` เป็น `_salesTenantId` ทั้งไฟล์
   ของเดิมฝั่งบริษัทได้ null เสมอ แล้วตอบ "กรุณาเลือกตัวแทนจำหน่ายก่อน" — ทั้งที่
   `docnum` อยู่ใน `OWNER_MODULES` เพราะ**บริษัทออกบิลขายตรงเองจึงต้องตั้งเลขที่ได้**
   (เจ้าของระบบแจ้ง 1 ต.ค. 2026: "แอพรู้อยู่แล้วว่าอยู่ตัวแทนไหน ไม่ควรต้องถาม")
   ตอนนี้: สังกัดตัวแทน → สมุดของตัวแทนตัวเอง · ฝั่งบริษัท → สมุดของบริษัท (ตัวแทนบ้าน)
   · ฝั่งบริษัทที่สวมสิทธิ์ตัวแทนอยู่ → สมุดของตัวแทนรายนั้น — ไม่มีเส้นทางไหนต้องให้เลือกเอง */
// แถวใหม่สุดขึ้นก่อน — เวอร์ชันที่ใช้อยู่จริงของแต่ละประเภทจะอยู่บนสุดเสมอ
function listDocSeries(session, payload) {
  var err = _requirePermission(session, 'docnum', 'view'); if (err) return err;
  var tenantId = _salesTenantId(session, payload || {});
  if (!tenantId) return { success: false, message: 'กรุณาเลือกตัวแทนจำหน่ายก่อน' };
  var rows = tenantObjects(tenantId, 'doc_number_series').slice();
  rows.sort(function(a, b) { return (parseInt(b.record_id, 10) || 0) - (parseInt(a.record_id, 10) || 0); });
  /* ส่งรายการประเภทที่ตั้งได้ไปด้วย เพื่อให้หน้าจอทำเป็นตัวเลือก ไม่ใช่ช่องพิมพ์อิสระ
     ★ แถมประเภทที่ "มีอยู่ในข้อมูลแล้วแต่ไม่อยู่ในลิสต์" เข้าไปด้วย (เช่นของที่เคยพิมพ์มือไว้ก่อนหน้านี้)
       ไม่งั้นแถวนั้นจะแก้ไม่ได้อีกเลยเพราะเลือกประเภทของมันไม่ได้ */
  var known = {};
  var types = DOC_SERIES_TYPES.map(function(t) { known[t.code] = 1; return t; });
  rows.forEach(function(r) {
    var c = String(r.doc_type || '').trim();
    if (!c || known[c]) return;
    known[c] = 1;
    types.push({ code: c, label: c, legacy: true, note: 'ตั้งไว้เดิม — ยังไม่มีเอกสารไหนในระบบใช้รูปแบบนี้' });
  });
  return { success: true, data: rows, types: types, fixedTypes: DOC_FIXED_TYPES };
}

/* บันทึกรูปแบบเลขที่เอกสาร = **ออกเวอร์ชันใหม่ แล้วปิดของเดิม** (เจ้าของระบบสั่ง 1 ต.ค. 2026)
   อาการเดิม: BDC มี SO อยู่แล้ว กดแก้ไข → ได้ SO เพิ่มมาอีกแถว active ทั้งคู่ เพราะ `addDocSeries`
   append อย่างเดียวไม่เคยดูของเดิมเลย (ปุ่มเดียวในหน้าจอเรียก action ชื่อ "add" ทั้งที่ข้อความใต้หัวข้อ
   เขียนว่า "พิมพ์ประเภทเดิม → อัปเดตของเดิม" — โค้ดไม่เคยทำตามคำโฆษณานั้น)

   ★ ทำไมไม่ทับแถวเดิมไปเลย: เอกสารที่ออกไปแล้วใช้รูปแบบเก่า แถวเก่าจึงเป็น**บันทึกว่าช่วงนั้นเลขหน้าตาแบบไหน**
     ทับทิ้ง = อธิบายเลขเก่าไม่ได้อีกเลย · เก็บไว้แต่ `is_active = FALSE` แล้วให้หน้าจอซ่อนเป็นค่าเริ่มต้น
   ★ ปิด "ทุกแถว" ของประเภทนั้น ไม่ใช่แค่แถวล่าสุด — ข้อมูลที่ซ้ำอยู่แล้วจะได้หายเองเมื่อกดบันทึกครั้งถัดไป
     (self-heal) ไม่ต้องมีสคริปต์ล้างแยก */
function saveDocSeries(session, payload) {
  var err = _requirePermission(session, 'docnum', 'edit'); if (err) return err;
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาเลือกตัวแทนจำหน่ายก่อน' };
  payload = payload || {};
  var docType = String(payload.docType || '').trim().toUpperCase();
  if (!docType) return { success: false, message: 'กรุณาระบุประเภทเอกสาร' };

  var rows = tenantObjects(tenantId, 'doc_number_series');
  /* ★ ปฏิเสธประเภทที่ไม่มีโค้ดไหนอ่าน — บันทึกได้แต่ไม่มีผลคือสิ่งที่แย่ที่สุด เพราะดูเหมือนสำเร็จ
     ยอมเฉพาะ: ประเภทที่ระบบออกเลขให้จริง (DOC_SERIES_TYPES) หรือประเภทที่มีอยู่ในข้อมูลแล้ว
     (ของเก่าที่เคยพิมพ์มือไว้ — ต้องแก้/ปิดได้ ไม่งั้นค้างถาวร)
     ตัวที่ใช้ชุดเลขกลาง (PO/PR/GR/…) บอกให้ชัดว่าทำไมตั้งไม่ได้ ไม่ใช่แค่ "ไม่รู้จัก" */
  var allowed = {};
  DOC_SERIES_TYPES.forEach(function(t) { allowed[t.code] = 1; });
  rows.forEach(function(r) { var c = String(r.doc_type || '').trim(); if (c) allowed[c] = 1; });
  if (!allowed[docType]) {
    var fixed = null;
    DOC_FIXED_TYPES.forEach(function(t) { if (t.code === docType) fixed = t; });
    if (fixed) {
      return { success: false, message: 'เอกสาร "' + fixed.label + '" (' + docType + ') ใช้เลขที่ของส่วนกลาง ' +
        'รูปแบบตายตัว ' + docType + '-ปีเดือน-เลขรัน ตั้งค่าที่นี่ไม่ได้' };
    }
    return { success: false, message: 'ยังไม่มีเอกสารประเภท ' + docType + ' ในระบบ — ตั้งรูปแบบไว้ก็จะไม่มีผล ' +
      '(ตั้งได้เฉพาะ: ' + DOC_SERIES_TYPES.map(function(t) { return t.code; }).join(', ') + ')' };
  }
  var superseded = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].doc_type) !== docType || !isFlagOn(rows[i].is_active)) continue;
    tenantUpdate(tenantId, 'doc_number_series', rows[i].record_id, { is_active: 'FALSE' });
    superseded++;
  }
  tenantAppend(tenantId, 'doc_number_series', {
    record_id: tenantNextId(tenantId, 'doc_number_series'),
    doc_type: docType, prefix: payload.prefix || docType,
    date_format: payload.dateFormat || 'yyyyMMdd', running_digits: payload.runningDigits || 4,
    reset_cycle: payload.resetCycle || 'daily', separator: payload.separator || '-', is_active: 'TRUE'
  });
  /* ★ ไม่แตะ `doc_number_counters` — ตัวนับผูกกับ doc_type + period_key ไม่ได้ผูกกับแถวรูปแบบ
     รีเซ็ตตัวนับตอนเปลี่ยนรูปแบบ = เลขรันซ้ำกับเอกสารที่ออกไปแล้วในงวดเดียวกัน */
  return { success: true, superseded: superseded,
    message: superseded ? 'บันทึกเป็นเวอร์ชันใหม่แล้ว · ปิดใช้งานรูปแบบเดิม ' + superseded + ' รายการ'
                        : 'บันทึกรูปแบบใหม่แล้ว' };
}
