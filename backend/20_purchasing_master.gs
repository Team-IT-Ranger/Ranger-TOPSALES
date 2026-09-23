/**
 * ===================== งานซื้อ: ข้อมูลตั้งต้น (ผู้ขาย / คลัง / สายอนุมัติ) =====================
 * ทั้งโมดูลงานซื้อเป็นข้อมูลฝั่ง "บริษัทเจ้าของสินค้า" เก็บใน Central Sheet (ตัวแทนจำหน่ายไม่ได้ซื้อของเอง)
 * ลำดับงาน: ใบขอซื้อ (PR, 21_purchase_requisition.gs) → อนุมัติตามสายอนุมัติ → ออกใบสั่งซื้อ (PO, 22_purchase_order.gs)
 *           → รับของเข้าคลัง (GR) → ตั้งหนี้เจ้าหนี้ (23_accounting.gs)
 * PO เปิดตรงโดยไม่ต้องมี PR ก็ได้ (ซื้อด่วน/ซื้อประจำ) — ดู createPurchaseOrder
 *
 * ใช้ตัวช่วยร่วมกับโมดูลอื่น: _isTrue/_validDate/_numOrBlank (17_pricing.gs), _requirePermission (14_permissions.gs)
 */

var PO_VAT_RATE = 0.07;                                  // VAT ไทยคงที่ 7% (เหมือนฝั่งขาย)
function _money(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function _int(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }
function _numOrNull(v) { if (v === null || v === undefined || String(v).trim() === '') return null; var n = Number(v); return isFinite(n) ? n : NaN; }

// ── ล็อกร่วมของงานซื้อ/บัญชี: ทุก action ที่เขียนเอกสารต้องผ่านอันนี้ (เลขที่เอกสาร/ยอดคงเหลือห้ามชนกัน) ──
function _withDocLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { success: false, message: 'ระบบกำลังบันทึกเอกสารอยู่ ลองใหม่อีกครั้ง' };
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * เลขที่เอกสารระดับบริษัท: <PREFIX>-<yyyyMM>-<running 4 หลัก> รีเซ็ตรายเดือน
 * (เอกสารของตัวแทนใช้ doc_number_series/doc_number_counters ใน tenant sheet — ดู 12_docnum.gs)
 * ต้องเรียกใต้ _withDocLock เท่านั้น เพราะขยับตัวนับ
 */
function _nextCentralDocNo(docType) {
  var period = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMM');
  var sh = centralSheet('central_doc_counters');
  var data = sh.getDataRange().getValues();
  var next = 1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(docType) && String(data[i][1]) === period) {
      next = (parseInt(data[i][2], 10) || 0) + 1;
      sh.getRange(i + 1, 3).setValue(next);
      return docType + '-' + period + '-' + _pad4(next);
    }
  }
  sh.appendRow([docType, period, 1]);
  return docType + '-' + period + '-' + _pad4(1);
}
function _pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

function _findById(sheetName, id) {
  var rows = centralObjects(sheetName);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].record_id) === String(id)) return rows[i];
  return null;
}
function _childrenOf(sheetName, fkField, parentId) {
  return centralObjects(sheetName).filter(function(r) { return String(r[fkField]) === String(parentId); });
}

/* ═══════════════ ผู้ขาย (vendors) ═══════════════ */

function _vendorDto(v) {
  return { id: v.record_id, code: v.vendor_code || '', name: v.name, taxId: v.tax_id || '', branchCode: v.branch_code || '',
    contactName: v.contact_name || '', phone: v.phone || '', email: v.email || '', address: v.address || '',
    paymentTermsDays: _int(v.payment_terms_days), creditLimit: Number(v.credit_limit) || 0,
    bankName: v.bank_name || '', bankAccountNo: v.bank_account_no || '', isActive: _isTrue(v.is_active), note: v.note || '' };
}

function listVendors(session, payload) {
  var err = _requirePermission(session, 'vendors', 'view'); if (err) return err;
  var rows = centralObjects('vendors').map(_vendorDto);
  if (payload && payload.activeOnly) rows = rows.filter(function(v) { return v.isActive; });
  rows.sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
  return { success: true, data: rows };
}

// payload: { id? (แก้ไข), code, name, taxId, branchCode, contactName, phone, email, address, paymentTermsDays, creditLimit, bankName, bankAccountNo, isActive, note }
function saveVendor(session, payload) {
  var err = _requirePermission(session, 'vendors', 'edit'); if (err) return err;
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'กรุณาระบุชื่อผู้ขาย' };
  var code = String(payload.code || '').trim();
  var terms = _int(payload.paymentTermsDays);
  if (terms < 0) return { success: false, message: 'เครดิตเทอม (วัน) ต้องไม่ติดลบ' };
  return _withDocLock(function() {
    var all = centralObjects('vendors');
    for (var i = 0; i < all.length; i++) {
      if (payload.id && String(all[i].record_id) === String(payload.id)) continue;
      if (code && String(all[i].vendor_code).trim().toLowerCase() === code.toLowerCase()) return { success: false, message: 'รหัสผู้ขาย "' + code + '" ซ้ำกับรายอื่น' };
    }
    var fields = { vendor_code: code, name: name, tax_id: String(payload.taxId || '').trim(), branch_code: String(payload.branchCode || '').trim(),
      contact_name: String(payload.contactName || '').trim(), phone: String(payload.phone || '').trim(), email: String(payload.email || '').trim(),
      address: String(payload.address || '').trim(), payment_terms_days: terms, credit_limit: _money(payload.creditLimit),
      bank_name: String(payload.bankName || '').trim(), bank_account_no: String(payload.bankAccountNo || '').trim(),
      is_active: payload.isActive === false ? 'FALSE' : 'TRUE', note: String(payload.note || '') };
    if (payload.id) {
      if (!centralUpdate('vendors', payload.id, fields)) return { success: false, message: 'ไม่พบผู้ขายรายนี้' };
      return { success: true, vendor: _vendorDto(_findById('vendors', payload.id)) };
    }
    fields.record_id = centralNextId('vendors');
    fields.created_at = nowStr();
    centralAppend('vendors', fields);
    return { success: true, vendor: _vendorDto(fields) };
  });
}

/* ═══════════════ คลังสินค้ากลาง (warehouses) ═══════════════ */

function _warehouseDto(w) {
  return { id: w.record_id, code: w.code || '', name: w.name, address: w.address || '', isActive: _isTrue(w.is_active), isDefault: _isTrue(w.is_default) };
}
function listWarehouses(session) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  return { success: true, data: centralObjects('warehouses').map(_warehouseDto) };
}
function saveWarehouse(session, payload) {
  var err = _requirePermission(session, 'inventory', 'edit'); if (err) return err;
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'กรุณาระบุชื่อคลัง' };
  return _withDocLock(function() {
    var fields = { code: String(payload.code || '').trim(), name: name, address: String(payload.address || '').trim(),
      is_active: payload.isActive === false ? 'FALSE' : 'TRUE', is_default: payload.isDefault ? 'TRUE' : 'FALSE' };
    // คลังหลักมีได้แห่งเดียว
    if (payload.isDefault) centralObjects('warehouses').forEach(function(w) {
      if (!payload.id || String(w.record_id) !== String(payload.id)) centralUpdate('warehouses', w.record_id, { is_default: 'FALSE' });
    });
    if (payload.id) {
      if (!centralUpdate('warehouses', payload.id, fields)) return { success: false, message: 'ไม่พบคลังนี้' };
      return { success: true, warehouse: _warehouseDto(_findById('warehouses', payload.id)) };
    }
    fields.record_id = centralNextId('warehouses');
    fields.created_at = nowStr();
    centralAppend('warehouses', fields);
    return { success: true, warehouse: _warehouseDto(fields) };
  });
}
function _defaultWarehouseId() {
  var ws = centralObjects('warehouses');
  for (var i = 0; i < ws.length; i++) if (_isTrue(ws[i].is_default)) return ws[i].record_id;
  return ws.length ? ws[0].record_id : null;
}

/* ═══════════════ สายอนุมัติ (approval flows) ═══════════════
 * 1 สาย = ประเภทเอกสาร × ช่วงวงเงิน · ในสายมีหลายขั้น (steps) · แต่ละขั้นกำหนดผู้อนุมัติและ "จำนวนคนที่ต้องอนุมัติ"
 * เลือกสายตอนส่งขออนุมัติ: สายที่ active, doc_type ตรง, และวงเงินเข้าช่วง — ถ้าเข้าหลายสายใช้ตัวที่ min_amount สูงสุด (เฉพาะเจาะจงกว่า)
 */

function _flowDto(f, steps) {
  return { id: f.record_id, docType: f.doc_type, name: f.name, minAmount: Number(f.min_amount) || 0,
    maxAmount: f.max_amount === '' || f.max_amount === null || f.max_amount === undefined ? null : Number(f.max_amount),
    isActive: _isTrue(f.is_active), note: f.note || '',
    steps: (steps || []).map(function(s) {
      return { id: s.record_id, stepNo: _int(s.step_no), name: s.name || '', approverType: s.approver_type || 'role',
        approverRef: String(s.approver_ref || ''), requiredApprovals: Math.max(1, _int(s.required_approvals) || 1) };
    }).sort(function(a, b) { return a.stepNo - b.stepNo; }) };
}

function listApprovalFlows(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  var stepsByFlow = {};
  centralObjects('approval_flow_steps').forEach(function(s) { (stepsByFlow[String(s.flow_id)] = stepsByFlow[String(s.flow_id)] || []).push(s); });
  var rows = centralObjects('approval_flows');
  if (payload && payload.docType) rows = rows.filter(function(f) { return String(f.doc_type) === String(payload.docType); });
  return { success: true, data: rows.map(function(f) { return _flowDto(f, stepsByFlow[String(f.record_id)]); }) };
}

/**
 * payload: { id?, docType('PR'), name, minAmount, maxAmount|null, isActive, note,
 *            steps:[{ name, approverType('role'|'user'), approverRef('owner_admin' หรือ '3,5'), requiredApprovals }] }
 * บันทึกทั้งสาย: ลบขั้นเดิมทั้งหมดแล้วเขียนใหม่ (ขั้นตอนเป็นชุดเดียวกัน แก้ทีละขั้นแล้วสับสนกว่า)
 */
function saveApprovalFlow(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'กรุณาตั้งชื่อสายอนุมัติ' };
  var docType = String(payload.docType || 'PR').trim().toUpperCase();
  var min = _numOrNull(payload.minAmount), max = _numOrNull(payload.maxAmount);
  if (min === null) min = 0;
  if (!(min >= 0)) return { success: false, message: 'วงเงินขั้นต่ำต้องเป็นตัวเลขไม่ติดลบ' };
  if (max !== null && !(max > min)) return { success: false, message: 'วงเงินสูงสุดต้องมากกว่าวงเงินขั้นต่ำ (เว้นว่าง = ไม่จำกัด)' };
  var steps = (payload.steps || []).map(function(s, i) {
    return { name: String(s.name || ('ขั้นที่ ' + (i + 1))).trim(), approverType: s.approverType === 'user' ? 'user' : 'role',
      approverRef: String(s.approverRef || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean).join(','),
      requiredApprovals: Math.max(1, _int(s.requiredApprovals) || 1) };
  });
  if (!steps.length) return { success: false, message: 'ต้องมีขั้นอนุมัติอย่างน้อย 1 ขั้น' };
  for (var i = 0; i < steps.length; i++) {
    if (!steps[i].approverRef) return { success: false, message: 'ขั้นที่ ' + (i + 1) + ': ยังไม่ได้ระบุผู้อนุมัติ' };
    var n = steps[i].approverRef.split(',').length;
    if (steps[i].approverType === 'user' && steps[i].requiredApprovals > n)
      return { success: false, message: 'ขั้นที่ ' + (i + 1) + ': ต้องอนุมัติ ' + steps[i].requiredApprovals + ' คน แต่ระบุผู้อนุมัติไว้ ' + n + ' คน' };
  }
  return _withDocLock(function() {
    var flowId = payload.id;
    var head = { doc_type: docType, name: name, min_amount: _money(min), max_amount: max === null ? '' : _money(max),
      is_active: payload.isActive === false ? 'FALSE' : 'TRUE', note: String(payload.note || '') };
    if (flowId) {
      if (!centralUpdate('approval_flows', flowId, head)) return { success: false, message: 'ไม่พบสายอนุมัตินี้' };
      _deleteRowsMatching(centralSheet('approval_flow_steps'), function(o) { return String(o.flow_id) === String(flowId); });
    } else {
      flowId = centralNextId('approval_flows');
      head.record_id = flowId; head.created_at = nowStr();
      centralAppend('approval_flows', head);
    }
    var stepId = centralNextId('approval_flow_steps');
    centralAppendMany('approval_flow_steps', steps.map(function(s, i) {
      return { record_id: stepId + i, flow_id: flowId, step_no: i + 1, name: s.name, approver_type: s.approverType,
        approver_ref: s.approverRef, required_approvals: s.requiredApprovals };
    }));
    return { success: true, flow: _flowDto(_findById('approval_flows', flowId), _childrenOf('approval_flow_steps', 'flow_id', flowId)) };
  });
}

function deleteApprovalFlow(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  return _withDocLock(function() {
    var flow = _findById('approval_flows', payload.id);
    if (!flow) return { success: false, message: 'ไม่พบสายอนุมัตินี้' };
    var inUse = centralObjects('purchase_requisitions').some(function(pr) {
      return String(pr.flow_id) === String(payload.id) && (pr.status === 'pending');
    });
    if (inUse) return { success: false, message: 'สายนี้มีใบขอซื้อที่กำลังรออนุมัติอยู่ — ปิดการใช้งาน (is_active) แทนการลบ' };
    deleteRowsWhere(centralSheet('approval_flow_steps'), 'flow_id', payload.id);
    deleteRowsWhere(centralSheet('approval_flows'), 'record_id', payload.id);
    return { success: true };
  });
}

// สายที่ใช้กับเอกสารวงเงินนี้ (null = ไม่มีสาย → เอกสารอนุมัติเองอัตโนมัติ ดู submitPurchaseRequisition)
function _resolveApprovalFlow(docType, amount) {
  var amt = Number(amount) || 0, best = null;
  centralObjects('approval_flows').forEach(function(f) {
    if (String(f.doc_type) !== String(docType) || !_isTrue(f.is_active)) return;
    var min = Number(f.min_amount) || 0;
    var max = (f.max_amount === '' || f.max_amount === null || f.max_amount === undefined) ? null : Number(f.max_amount);
    if (amt < min) return;
    if (max !== null && amt > max) return;
    if (!best || min > (Number(best.min_amount) || 0)) best = f;
  });
  if (!best) return null;
  var steps = _childrenOf('approval_flow_steps', 'flow_id', best.record_id).sort(function(a, b) { return _int(a.step_no) - _int(b.step_no); });
  return steps.length ? { flow: best, steps: steps } : null;
}

// ผู้ใช้คนนี้อนุมัติขั้นนี้ได้ไหม (ตาม role หรือรายชื่อ user) — super_admin อนุมัติแทนได้เสมอ (กันงานค้างเมื่อผู้อนุมัติไม่อยู่)
function _canApproveStep(session, step) {
  if (!step) return false;
  if (session.role_code === 'super_admin') return true;
  var refs = String(step.approver_ref || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean);
  if (String(step.approver_type) === 'user') return refs.indexOf(String(session.adminUserId)) !== -1;
  return refs.indexOf(String(session.role_code)) !== -1;
}
