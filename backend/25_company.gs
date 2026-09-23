/**
 * ===================== ข้อมูลบริษัทเจ้าของสินค้า (ตั้งค่าระบบ) =====================
 * เก็บแถวเดียวในชีต company_profile (record_id = 1) — ชื่อ/ที่อยู่/เลขประจำตัวผู้เสียภาษี ฯลฯ ของบริษัทเราเอง
 *
 * ใช้ที่ไหนบ้าง:
 *  - ชื่อบริษัทในตัวเลือก "เลือกบริษัทที่ต้องการใช้งาน" และป้ายบอกบริบทมุมซ้ายบนของแอดมิน
 *  - หัวเอกสารในอนาคต (ใบสั่งซื้อ/ใบกำกับภาษี) ที่ต้องมีชื่อ-ที่อยู่-เลขผู้เสียภาษีของบริษัท
 * คนละชุดกับ tenants (ข้อมูลตัวแทนจำหน่ายแต่ละราย) — ห้ามเอาไปปนกัน
 */

var COMPANY_PROFILE_ID = 1;

function _companyRow() {
  var rows = centralObjects('company_profile');
  for (var i = 0; i < rows.length; i++) if (String(rows[i].record_id) === String(COMPANY_PROFILE_ID)) return rows[i];
  return rows.length ? rows[0] : null;
}

function _companyDto(r) {
  r = r || {};
  return {
    name: r.name || 'บริษัทเจ้าของสินค้า', legalName: r.legal_name || '', taxId: r.tax_id || '', branchCode: r.branch_code || '',
    address: r.address || '', phone: r.phone || '', email: r.email || '', website: r.website || '', logoUrl: r.logo_url || '',
    bankName: r.bank_name || '', bankAccountNo: r.bank_account_no || '', bankAccountName: r.bank_account_name || '',
    note: r.note || '', updatedAt: safeDateStr(r.updated_at)
  };
}

// ทุกคนที่ล็อกอินอ่านได้ (แค่ชื่อบริษัทสำหรับแสดงผล ไม่ใช่ความลับ) — แก้ได้เฉพาะสิทธิ์ settings
function getCompanyProfile(session) {
  if (!session) return { success: false, message: 'ไม่ได้เข้าสู่ระบบ' };
  var dto = _companyDto(_companyRow());
  dto.canEdit = hasPermission(session, 'settings', 'edit');
  return { success: true, company: dto };
}

/**
 * payload: { name, legalName, taxId, branchCode, address, phone, email, website, logoUrl, bankName, bankAccountNo, bankAccountName, note }
 * ส่งมาเฉพาะช่องที่จะแก้ก็ได้ (ช่องที่ไม่ส่งมาจะคงค่าเดิม)
 */
function saveCompanyProfile(session, payload) {
  var err = _requirePermission(session, 'settings', 'edit'); if (err) return err;
  payload = payload || {};
  if (payload.name !== undefined && !String(payload.name).trim()) return { success: false, message: 'กรุณาระบุชื่อบริษัท' };
  var taxId = payload.taxId === undefined ? null : String(payload.taxId).replace(/[^0-9]/g, '');
  if (taxId && taxId.length !== 13) return { success: false, message: 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก (กรอกเฉพาะตัวเลข)' };
  if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(payload.email).trim())) return { success: false, message: 'รูปแบบอีเมลไม่ถูกต้อง' };

  return _withDocLock(function() {
    var map = { name: 'name', legalName: 'legal_name', branchCode: 'branch_code', address: 'address', phone: 'phone',
      email: 'email', website: 'website', logoUrl: 'logo_url', bankName: 'bank_name', bankAccountNo: 'bank_account_no',
      bankAccountName: 'bank_account_name', note: 'note' };
    var fields = {};
    Object.keys(map).forEach(function(k) { if (payload[k] !== undefined) fields[map[k]] = String(payload[k]).trim(); });
    if (taxId !== null) fields.tax_id = taxId;
    fields.updated_at = nowStr();
    fields.updated_by = session.adminUserId || '';

    var row = _companyRow();
    if (row) centralUpdate('company_profile', row.record_id, fields);
    else {
      fields.record_id = COMPANY_PROFILE_ID;
      if (!fields.name) fields.name = 'บริษัทเจ้าของสินค้า';
      centralAppend('company_profile', fields);
    }
    var res = getCompanyProfile(session);
    res.message = 'บันทึกข้อมูลบริษัทแล้ว';
    return res;
  });
}

// ชื่อบริษัทสั้น ๆ ไว้ใช้ภายใน (หัวเอกสาร/ป้ายบริบท) — ไม่เช็คสิทธิ์ ใช้จาก backend ด้วยกันเท่านั้น
function _companyName() {
  var r = _companyRow();
  return (r && r.name) ? String(r.name) : 'บริษัทเจ้าของสินค้า';
}
