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

/* ═══ ทะเบียนกลางของ "เอกสารทุกหมวดที่ต้องมีเลขกำกับ" (เจ้าของระบบสั่ง 1 ต.ค. 2026) ═══
   เดิมมีแค่ SO ที่ตั้งรูปแบบได้ อีก 8 หมวดฮาร์ดโค้ดรูปแบบไว้ในโค้ด แก้ไม่ได้เลย
   ตอนนี้ **ทุกหมวดดึง prefix/รูปแบบจากแถวที่ active เสมอ** ถ้าไม่เคยตั้งก็ใช้ `defaults` ด้านล่าง

   ★ `defaults` ของแต่ละหมวดต้องให้ผล **เหมือนที่ระบบออกมาแต่ไหนแต่ไร** เป๊ะทุกตัวอักษร
     ไม่งั้นวันที่ deploy เลขเอกสารจะเปลี่ยนหน้าตาเองทั้งระบบโดยไม่มีใครสั่ง (มีเทสต์ไล่ทีละหมวด)
   ★ `central: true` = ออกเลขจากตัวนับกลาง (`_nextCentralDocNo` ใน 20_purchasing_master.gs)
     และ **แทรกรหัสตัวแทนต่อท้าย prefix** เมื่อเป็นเอกสารของตัวแทน เช่น `PO-TNKN-202610-0001`
     ส่วน SO ใช้ตัวนับในไฟล์ของตัวแทนเอง จึงไม่ต้องแทรกรหัส

   **เพิ่มเอกสารที่ต้องมีเลขกำกับเมื่อไหร่ ต้องมาเพิ่มที่นี่ด้วย** ไม่งั้นตั้งค่าไม่ได้และ `saveDocSeries` ปฏิเสธ */
var DOC_SERIES_TYPES = [
  { code: 'SO',  label: 'ใบขาย / ใบสั่งขาย', note: 'ใช้กับบิลขายทั้งจากแอปมือถือและแอดมิน',
    defaults: { prefix: 'SO',  date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily',   separator: '-' } },
  /* ★ ใบส่งสินค้ามีเลขของตัวเอง ไม่ใช้เลขใบสั่งขาย (แอดมินขอ 6 ต.ค. 2026)
     ใช้ตัวนับ "ในไฟล์ของตัวแทน" เหมือน SO ไม่ใช่ตัวนับกลาง เพราะใบส่งของออกในนามตัวแทนที่ส่งของ
     ออกเลขอัตโนมัติตอนบิลเข้าสถานะ "พร้อมจัดส่ง" (34_sales_status.gs) */
  { code: 'DO',  label: 'ใบส่งสินค้า', note: 'ออกเลขอัตโนมัติเมื่อบิลขายเข้าสถานะ "พร้อมจัดส่ง"',
    defaults: { prefix: 'DO',  date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily',   separator: '-' } },
  /* ★ 7 ต.ค. 2026 — เอกสารขายทุกชนิดมีเลขของตัวเอง (แอดมินขอ) ใช้ตัวนับในไฟล์ของตัวแทนเหมือน SO/DO
     เพราะออกในนามตัวแทนที่ขาย · **จุดที่ออกเลขอยู่ใน SALE_DOC_FIELDS (34_sales_status.gs) ที่เดียว** */
  { code: 'PICK', label: 'ใบจัดของ', note: 'ออกเลขอัตโนมัติพร้อมใบส่งสินค้า เมื่อบิลเข้าสถานะ "พร้อมจัดส่ง"',
    defaults: { prefix: 'PICK', date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-' } },
  { code: 'RC',  label: 'ใบเสร็จรับเงิน', note: 'ออกเลขอัตโนมัติเมื่อรับชำระครั้งแรก (ขายสดจากรถออกตั้งแต่เปิดบิล)',
    defaults: { prefix: 'RC',  date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-' } },
  { code: 'TAX', label: 'ใบกำกับภาษี', note: 'ออกเลขอัตโนมัติตอนส่งมอบสินค้า ("พร้อมจัดส่ง" · ขายสดจากรถออกตั้งแต่เปิดบิล)',
    defaults: { prefix: 'TAX', date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-' } },
  { code: 'PR',  label: 'ใบขอซื้อ',          central: true },
  { code: 'PO',  label: 'ใบสั่งซื้อ',         central: true },
  { code: 'GR',  label: 'ใบรับของ',           central: true },
  { code: 'AP',  label: 'ตั้งหนี้เจ้าหนี้',      central: true },
  { code: 'PV',  label: 'ใบสำคัญจ่าย',        central: true },
  { code: 'INV', label: 'ใบแจ้งหนี้ลูกค้า',     central: true },
  { code: 'RV',  label: 'ใบสำคัญรับ',         central: true },
  { code: 'JV',  label: 'ใบสำคัญทั่วไป',       central: true }
].map(function(t) {
  // หมวดที่ใช้ตัวนับกลางมีค่าเริ่มต้นชุดเดียวกันหมด: <รหัส>-<yyyyMM>-<รัน 4 หลัก> รีเซ็ตรายเดือน
  if (!t.defaults) t.defaults = { prefix: t.code, date_format: 'yyyyMM', running_digits: 4, reset_cycle: 'monthly', separator: '-' };
  return t;
});

function _docTypeMeta(docType) {
  for (var i = 0; i < DOC_SERIES_TYPES.length; i++) if (DOC_SERIES_TYPES[i].code === String(docType)) return DOC_SERIES_TYPES[i];
  return null;
}

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
  // ไม่มีตั้งค่าไว้ → ใช้ค่าเริ่มต้นประจำหมวดนั้น (ดู DOC_SERIES_TYPES — ต้องให้ผลเหมือนของเดิมเป๊ะ)
  var meta = _docTypeMeta(docType);
  var d = meta ? meta.defaults : { prefix: docType, date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-' };
  return { doc_type: docType, prefix: d.prefix, date_format: d.date_format,
    running_digits: d.running_digits, reset_cycle: d.reset_cycle, separator: d.separator };
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

/**
 * ★ ตั้ง "เลขถัดไป" ของเอกสารประเภทหนึ่ง (เจ้าของระบบสั่ง 7 ต.ค. 2026)
 *
 * ใช้ตอนย้ายเล่มจากระบบเดิมมาระบบนี้ — เล่มเดิมเดินถึงเลขไหนแล้ว ต้องนับต่อจากนั้น
 * ไม่ใช่เริ่ม 0001 ใหม่ ไม่งั้นเลขซ้ำกับเอกสารที่ออกไปแล้วจริง (ใบกำกับภาษีซ้ำเลข = ปัญหากับสรรพากร)
 *
 * payload { docType, nextNumber }
 *
 * ★★ เดินหน้าได้อย่างเดียว — ตั้งต่ำกว่าเลขที่ออกไปแล้วถูกปฏิเสธเสมอ ไม่มีทางลัด
 *   ลดตัวนับ = ระบบจะออกเลขที่มีเอกสารจริงถืออยู่แล้วซ้ำอีกใบ ซึ่งแก้ย้อนหลังไม่ได้เลย
 *   (ถ้าตั้งเกินไปโดยพลาด ให้เดินหน้าต่อ ยอมเลขกระโดด ดีกว่าเลขซ้ำ)
 * ★ มีผลกับ "งวดปัจจุบัน" เท่านั้น — ตัวนับผูกกับ period_key ตามรอบรีเซ็ต พอขึ้นงวดใหม่ก็เริ่มนับใหม่
 *   ตามรูปแบบที่ตั้งไว้ ซึ่งเป็นพฤติกรรมที่ตั้งใจ (ตั้งค่านี้ไว้แก้ "ย้ายเล่มกลางคัน" ไม่ใช่ตั้งถาวร)
 */
function setDocCounter(session, payload) {
  var err = _requirePermission(session, 'docnum', 'edit'); if (err) return err;
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาเลือกตัวแทนจำหน่ายก่อน' };
  payload = payload || {};
  var docType = String(payload.docType || '').trim().toUpperCase();
  if (!docType) return { success: false, message: 'กรุณาระบุประเภทเอกสาร' };
  if (!_docTypeMeta(docType)) return { success: false, message: 'ไม่รู้จักเอกสารประเภท ' + docType };

  var next = parseInt(payload.nextNumber, 10);
  if (!(next >= 1)) return { success: false, message: 'เลขถัดไปต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' };

  var cfg = _docSeriesConfig(tenantId, docType);
  var periodKey = _periodKey(cfg.reset_cycle);
  var sh = tenantSheet(tenantId, 'doc_number_counters');
  var values = sh.getDataRange().getValues();
  var head = values[0], cType = head.indexOf('doc_type'), cKey = head.indexOf('period_key'), cNum = head.indexOf('last_number');
  var last = 0, rowNo = 0;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][cType]) === docType && String(values[i][cKey]) === periodKey) {
      last = parseInt(values[i][cNum], 10) || 0; rowNo = i + 1; break;
    }
  }
  if (next - 1 < last) {
    return { success: false, message: 'ตอนนี้ออกถึงเลข ' + last + ' แล้ว (งวด ' + periodKey + ') — ' +
      'ตั้งเลขถัดไปเป็น ' + next + ' จะทำให้ออกเลขซ้ำกับเอกสารที่ออกไปแล้ว ' +
      'ตั้งได้ตั้งแต่ ' + (last + 1) + ' ขึ้นไปเท่านั้น' };
  }
  if (rowNo) sh.getRange(rowNo, cNum + 1).setValue(next - 1);
  else sh.appendRow([docType, periodKey, next - 1]);

  var sample = _formatDocNumber(cfg, periodKey, next);
  return { success: true, docType: docType, periodKey: periodKey, previousLast: last, nextNumber: next, sample: sample,
    message: 'ตั้งเลขถัดไปของ ' + docType + ' เป็น ' + next + ' แล้ว — ใบถัดไปจะเป็น ' + sample +
      (last ? ' (เดิมออกถึง ' + last + ')' : '') };
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
  return { success: true, data: rows, types: types };
}

/* ★ รูปแบบวันที่ต้องละเอียดพอๆ กับรอบรีเซ็ต ไม่งั้น **เลขซ้ำ**
   เลขรันไม่ซ้ำกันเฉพาะภายใน (ตัวนับ + งวด) เท่านั้น · ถ้าตัวเลขที่พิมพ์ออกมาแยกงวดไม่ได้
   พองวดใหม่ตัวนับกลับไป 1 ก็จะได้สตริงเดิมซ้ำกับเอกสารที่ออกไปแล้ว
   เช่น รีเซ็ตรายเดือน + วันที่ `yyyy` → ต.ค. ได้ PO-2026-0003 แล้ว พ.ย. กลับมา PO-2026-0001 ซ้ำของเดือนก่อน
   กันตั้งแต่ตอนบันทึก เพราะถ้าปล่อยผ่านจะไปโผล่เป็นเลขซ้ำบนเอกสารจริงอีกเป็นเดือน โดยไม่มีอะไรฟ้อง */
function _dateFormatCoversCycle(dateFormat, resetCycle) {
  var f = String(dateFormat || '');
  if (resetCycle === 'none') return true;                       // ไม่รีเซ็ต = เลขรันไม่ซ้ำอยู่แล้ว
  var hasYear = /y/.test(f), hasMonth = /M/.test(f), hasDay = /d/.test(f);
  if (resetCycle === 'yearly')  return hasYear;
  if (resetCycle === 'monthly') return hasYear && hasMonth;
  if (resetCycle === 'daily')   return hasYear && hasMonth && hasDay;
  return true;
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
     (ของเก่าที่เคยพิมพ์มือไว้ — ต้องแก้/ปิดได้ ไม่งั้นค้างถาวร) */
  var allowed = {};
  DOC_SERIES_TYPES.forEach(function(t) { allowed[t.code] = 1; });
  rows.forEach(function(r) { var c = String(r.doc_type || '').trim(); if (c) allowed[c] = 1; });
  if (!allowed[docType]) {
    return { success: false, message: 'ยังไม่มีเอกสารประเภท ' + docType + ' ในระบบ — ตั้งรูปแบบไว้ก็จะไม่มีผล ' +
      '(ตั้งได้เฉพาะ: ' + DOC_SERIES_TYPES.map(function(t) { return t.code; }).join(', ') + ')' };
  }

  var meta = _docTypeMeta(docType);
  var dflt = meta ? meta.defaults : { prefix: docType, date_format: 'yyyyMMdd', running_digits: 4, reset_cycle: 'daily', separator: '-' };
  var dateFormat = payload.dateFormat === undefined || payload.dateFormat === null ? dflt.date_format : String(payload.dateFormat);
  var resetCycle = payload.resetCycle || dflt.reset_cycle;
  if (!_dateFormatCoversCycle(dateFormat, resetCycle)) {
    var need = { yearly: 'ปี', monthly: 'ปีและเดือน', daily: 'ปี เดือน และวัน' }[resetCycle] || '';
    return { success: false, message: 'รูปแบบวันที่' + (dateFormat ? ' "' + dateFormat + '" ' : 'ที่ว่างไว้ ') +
      'ละเอียดไม่พอกับรอบรีเซ็ตที่เลือก — รีเซ็ตแบบนี้ต้องมี' + need + 'อยู่ในเลขที่เอกสาร ' +
      'ไม่งั้นพอขึ้นงวดใหม่ตัวนับกลับไป 1 แล้วเลขจะซ้ำกับเอกสารที่ออกไปแล้ว' };
  }

  var superseded = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].doc_type) !== docType || !isFlagOn(rows[i].is_active)) continue;
    tenantUpdate(tenantId, 'doc_number_series', rows[i].record_id, { is_active: 'FALSE' });
    superseded++;
  }
  tenantAppend(tenantId, 'doc_number_series', {
    record_id: tenantNextId(tenantId, 'doc_number_series'),
    doc_type: docType, prefix: payload.prefix || dflt.prefix,
    date_format: dateFormat, running_digits: payload.runningDigits || dflt.running_digits,
    reset_cycle: resetCycle, separator: payload.separator || dflt.separator, is_active: 'TRUE'
  });
  /* ★ ไม่แตะ `doc_number_counters` — ตัวนับผูกกับ doc_type + period_key ไม่ได้ผูกกับแถวรูปแบบ
     รีเซ็ตตัวนับตอนเปลี่ยนรูปแบบ = เลขรันซ้ำกับเอกสารที่ออกไปแล้วในงวดเดียวกัน */
  return { success: true, superseded: superseded,
    message: superseded ? 'บันทึกเป็นเวอร์ชันใหม่แล้ว · ปิดใช้งานรูปแบบเดิม ' + superseded + ' รายการ'
                        : 'บันทึกรูปแบบใหม่แล้ว' };
}
