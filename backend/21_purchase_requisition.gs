/**
 * ===================== ใบขอซื้อ (Purchase Requisition) =====================
 * วงจร: draft → (ส่งขออนุมัติ) pending → approved | rejected → (ออก PO แล้วครบ) closed   · ยกเลิกได้ที่ draft/pending/approved ที่ยังไม่ออก PO
 * การอนุมัติใช้สายอนุมัติจาก 20_purchasing_master.gs: เลือกสายตามวงเงินรวม (ไม่รวม VAT) ของใบนั้น
 *   - แต่ละขั้นกำหนด "จำนวนผู้อนุมัติที่ต้องผ่าน" (required_approvals) — ครบแล้วเลื่อนไปขั้นถัดไปเอง
 *   - ใครปฏิเสธคนเดียว = ใบนั้น rejected ทันที (แก้แล้วส่งใหม่ได้ ระบบจะเริ่มนับขั้นใหม่)
 *   - ไม่มีสายอนุมัติที่เข้าเงื่อนไข = อนุมัติอัตโนมัติ (บริษัทเล็ก/ยังไม่ตั้งค่า) และบันทึกไว้ในประวัติว่าเป็นระบบอนุมัติให้
 * แก้ไขรายการได้เฉพาะสถานะ draft/rejected เท่านั้น — ใบที่กำลังรออนุมัติหรืออนุมัติแล้วห้ามแก้ (ผู้อนุมัติเห็นอะไรต้องได้อย่างนั้น)
 */

var PR_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'cancelled', 'closed'];

function _prDto(pr, items, approvals, extra) {
  extra = extra || {};
  return {
    id: pr.record_id, prNo: pr.pr_no, requesterUserId: pr.requester_user_id, requesterName: extra.requesterName || '',
    department: pr.department || '', needByDate: _dOnly(pr.need_by_date), note: pr.note || '', status: pr.status,
    flowId: pr.flow_id || '', flowName: extra.flowName || '', currentStep: _int(pr.current_step),
    totalExVat: Number(pr.total_ex_vat) || 0, createdAt: safeDateStr(pr.created_at), submittedAt: safeDateStr(pr.submitted_at),
    decidedAt: safeDateStr(pr.decided_at), closedAt: safeDateStr(pr.closed_at),
    itemCount: (items || []).length,
    items: (items || []).map(function(it) {
      return { id: it.record_id, lineNo: _int(it.line_no), productId: it.product_id || '', description: it.description || '',
        qty: Number(it.qty) || 0, unitCode: it.unit_code || '', unitPrice: Number(it.unit_price) || 0,
        amount: Number(it.amount) || 0, poQty: Number(it.po_qty) || 0, note: it.note || '' };
    }).sort(function(a, b) { return a.lineNo - b.lineNo; }),
    approvals: (approvals || []).map(function(a) {
      return { stepNo: _int(a.step_no), approverUserId: a.approver_user_id, approverName: extra.names ? (extra.names[String(a.approver_user_id)] || '') : '',
        decision: a.decision, comment: a.comment || '', decidedAt: safeDateStr(a.decided_at) };
    }),
    steps: extra.steps || []
  };
}

function _adminNames() {
  var map = {};
  centralObjects('admin_users').forEach(function(u) { map[String(u.record_id)] = u.display_name || u.username; });
  return map;
}

function listPurchaseRequisitions(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  payload = payload || {};
  var names = _adminNames(), flows = {};
  centralObjects('approval_flows').forEach(function(f) { flows[String(f.record_id)] = f.name; });
  var itemsByPr = {};
  centralObjects('pr_items').forEach(function(it) { (itemsByPr[String(it.pr_id)] = itemsByPr[String(it.pr_id)] || []).push(it); });
  var rows = _scoped('purchase_requisitions', _purchaseScope(session, payload));
  if (payload.status) rows = rows.filter(function(pr) { return String(pr.status) === String(payload.status); });
  // "รออนุมัติโดยฉัน" — ใบที่ค้างอยู่ขั้นที่ผู้ใช้คนนี้มีสิทธิ์กด และยังไม่เคยกดในขั้นนั้น
  if (payload.waitingForMe) rows = rows.filter(function(pr) { return _pendingForUser(pr, session); });
  var out = rows.map(function(pr) {
    return _prDto(pr, itemsByPr[String(pr.record_id)], null, { requesterName: names[String(pr.requester_user_id)] || '', flowName: flows[String(pr.flow_id)] || '' });
  });
  out.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)) || (b.id - a.id); });
  return { success: true, data: out };
}

function _pendingForUser(pr, session) {
  if (String(pr.status) !== 'pending') return false;
  var flowSteps = _childrenOf('approval_flow_steps', 'flow_id', pr.flow_id).sort(function(a, b) { return _int(a.step_no) - _int(b.step_no); });
  var step = flowSteps.filter(function(s) { return _int(s.step_no) === _int(pr.current_step); })[0];
  if (!_canApproveStep(session, step)) return false;
  var already = _childrenOf('pr_approvals', 'pr_id', pr.record_id).some(function(a) {
    return _int(a.step_no) === _int(pr.current_step) && String(a.approver_user_id) === String(session.adminUserId);
  });
  return !already;
}

function getPurchaseRequisition(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  var pr = _findScoped('purchase_requisitions', payload.id, _purchaseScope(session, payload));
  if (!pr) return { success: false, message: 'ไม่พบใบขอซื้อนี้' };
  var names = _adminNames();
  var flow = pr.flow_id ? _findById('approval_flows', pr.flow_id) : null;
  var steps = pr.flow_id ? _childrenOf('approval_flow_steps', 'flow_id', pr.flow_id).sort(function(a, b) { return _int(a.step_no) - _int(b.step_no); })
    .map(function(s) { return { stepNo: _int(s.step_no), name: s.name || '', approverType: s.approver_type, approverRef: String(s.approver_ref || ''),
      requiredApprovals: Math.max(1, _int(s.required_approvals) || 1),
      approverNames: String(s.approver_ref || '').split(',').filter(Boolean).map(function(r) { return String(s.approver_type) === 'user' ? (names[r.trim()] || r.trim()) : r.trim(); }) }; }) : [];
  var dto = _prDto(pr, _childrenOf('pr_items', 'pr_id', pr.record_id), _childrenOf('pr_approvals', 'pr_id', pr.record_id),
    { requesterName: names[String(pr.requester_user_id)] || '', flowName: flow ? flow.name : '', names: names, steps: steps });
  dto.canApprove = _pendingForUser(pr, session);
  dto.canEdit = (pr.status === 'draft' || pr.status === 'rejected');
  return { success: true, pr: dto };
}

/**
 * payload: { id?, department, needByDate, note, items:[{ productId?, description, qty, unitCode, unitPrice, note }] }
 * สร้าง/แก้ใบขอซื้อ (สถานะ draft) — แก้ได้เฉพาะ draft/rejected
 */
function savePurchaseRequisition(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var items = (payload.items || []).map(function(it, i) {
    return { lineNo: i + 1, productId: it.productId == null ? '' : String(it.productId), description: String(it.description || '').trim(),
      qty: _numOrNull(it.qty), unitCode: String(it.unitCode || '').trim(), unitPrice: _numOrNull(it.unitPrice), note: String(it.note || '') };
  });
  if (!items.length) return { success: false, message: 'ต้องมีรายการขอซื้ออย่างน้อย 1 รายการ' };
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  for (var i = 0; i < items.length; i++) {
    var it = items[i], no = 'รายการที่ ' + (i + 1) + ': ';
    if (it.productId && !products[it.productId]) return { success: false, message: no + 'ไม่พบสินค้า id ' + it.productId };
    if (!it.productId && !it.description) return { success: false, message: no + 'ต้องเลือกสินค้า หรือกรอกรายละเอียดสิ่งที่ขอซื้อ' };
    if (!(it.qty > 0)) return { success: false, message: no + 'จำนวนต้องมากกว่า 0' };
    if (it.unitPrice === null || !(it.unitPrice >= 0)) return { success: false, message: no + 'ราคาต่อหน่วยต้องเป็นตัวเลขไม่ติดลบ' };
    if (it.productId && !it.description) it.description = products[it.productId].name;
  }
  if (payload.needByDate && !_validDate(payload.needByDate)) return { success: false, message: 'วันที่ต้องการใช้ต้องเป็น yyyy-mm-dd' };
  var total = _money(items.reduce(function(s, it) { return s + it.qty * it.unitPrice; }, 0));

  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var prId = payload.id, existing = null;
    if (prId) {
      existing = _findScoped('purchase_requisitions', prId, scope);
      if (!existing) return { success: false, message: 'ไม่พบใบขอซื้อนี้' };
      if (existing.status !== 'draft' && existing.status !== 'rejected')
        return { success: false, message: 'แก้ได้เฉพาะใบร่างหรือใบที่ถูกตีกลับ — ใบที่รออนุมัติ/อนุมัติแล้วห้ามแก้ (ผู้อนุมัติต้องเห็นตรงกับที่ตัดสินใจ)' };
    }
    var head = { department: String(payload.department || '').trim(), need_by_date: payload.needByDate || '', note: String(payload.note || ''),
      total_ex_vat: total };
    if (prId) {
      centralUpdate('purchase_requisitions', prId, head);
      _deleteRowsMatching(centralSheet('pr_items'), function(o) { return String(o.pr_id) === String(prId); });
    } else {
      prId = centralNextId('purchase_requisitions');
      head.record_id = prId;
      head.tenant_id = scope;
      head.pr_no = _nextCentralDocNo('PR', scope);
      head.requester_user_id = session.adminUserId;
      head.status = 'draft'; head.flow_id = ''; head.current_step = 0;
      head.created_at = nowStr(); head.submitted_at = ''; head.decided_at = ''; head.closed_at = '';
      centralAppend('purchase_requisitions', head);
    }
    var itemId = centralNextId('pr_items');
    centralAppendMany('pr_items', items.map(function(it, i) {
      return { record_id: itemId + i, pr_id: prId, line_no: it.lineNo, product_id: it.productId, description: it.description,
        qty: it.qty, unit_code: it.unitCode, unit_price: _money(it.unitPrice), amount: _money(it.qty * it.unitPrice), po_qty: 0, note: it.note };
    }));
    return getPurchaseRequisition(session, { id: prId, tenantId: scope });
  });
}

// payload: { id } — ส่งขออนุมัติ: หาสายตามวงเงิน แล้วตั้งสถานะ pending ที่ขั้น 1 (ไม่มีสาย = อนุมัติอัตโนมัติ)
function submitPurchaseRequisition(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var pr = _findScoped('purchase_requisitions', payload.id, scope);
    if (!pr) return { success: false, message: 'ไม่พบใบขอซื้อนี้' };
    if (pr.status !== 'draft' && pr.status !== 'rejected') return { success: false, message: 'ส่งขออนุมัติได้เฉพาะใบร่างหรือใบที่ถูกตีกลับ' };
    if (!_childrenOf('pr_items', 'pr_id', pr.record_id).length) return { success: false, message: 'ใบขอซื้อนี้ยังไม่มีรายการ' };
    var resolved = _resolveApprovalFlow('PR', pr.total_ex_vat, scope);
    // ส่งใหม่หลังถูกตีกลับ: ล้างประวัติเดิมออกก่อน ให้การนับ "จำนวนผู้อนุมัติ" ของรอบใหม่เริ่มจากศูนย์
    _deleteRowsMatching(centralSheet('pr_approvals'), function(o) { return String(o.pr_id) === String(pr.record_id); });
    if (!resolved) {
      centralUpdate('purchase_requisitions', pr.record_id, { status: 'approved', flow_id: '', current_step: 0, submitted_at: nowStr(), decided_at: nowStr() });
      centralAppend('pr_approvals', { record_id: centralNextId('pr_approvals'), pr_id: pr.record_id, step_no: 0,
        approver_user_id: session.adminUserId, decision: 'approved', comment: 'ไม่มีสายอนุมัติที่เข้าเงื่อนไขวงเงินนี้ — ระบบอนุมัติอัตโนมัติ', decided_at: nowStr() });
      return _withPrResult(session, pr.record_id, 'ไม่มีสายอนุมัติที่เข้าเงื่อนไข — อนุมัติอัตโนมัติแล้ว', scope);
    }
    centralUpdate('purchase_requisitions', pr.record_id, { status: 'pending', flow_id: resolved.flow.record_id, current_step: 1,
      submitted_at: nowStr(), decided_at: '' });
    return _withPrResult(session, pr.record_id, 'ส่งขออนุมัติแล้ว (สาย "' + resolved.flow.name + '")', scope);
  });
}

function _withPrResult(session, prId, message, scope) {
  var r = getPurchaseRequisition(session, { id: prId, tenantId: scope || '' });
  if (r.success) r.message = message;
  return r;
}

/**
 * payload: { id, decision('approve'|'reject'), comment? }
 * บันทึกการตัดสินใจ 1 คนในขั้นปัจจุบัน — ครบจำนวนที่กำหนดแล้วเลื่อนขั้น/อนุมัติทั้งใบ
 */
function decidePurchaseRequisition(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var decision = payload.decision === 'reject' ? 'rejected' : (payload.decision === 'approve' ? 'approved' : null);
  if (!decision) return { success: false, message: 'ระบุการตัดสินใจไม่ถูกต้อง' };
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var pr = _findScoped('purchase_requisitions', payload.id, scope);
    if (!pr) return { success: false, message: 'ไม่พบใบขอซื้อนี้' };
    if (pr.status !== 'pending') return { success: false, message: 'ใบนี้ไม่ได้อยู่ระหว่างรออนุมัติ' };
    var steps = _childrenOf('approval_flow_steps', 'flow_id', pr.flow_id).sort(function(a, b) { return _int(a.step_no) - _int(b.step_no); });
    var step = steps.filter(function(s) { return _int(s.step_no) === _int(pr.current_step); })[0];
    if (!step) return { success: false, message: 'สายอนุมัติถูกแก้ไขจนไม่มีขั้นนี้แล้ว — ให้ผู้ขอส่งใบใหม่' };
    if (!_canApproveStep(session, step)) return { success: false, message: 'คุณไม่ใช่ผู้อนุมัติของขั้นนี้' };
    var mine = _childrenOf('pr_approvals', 'pr_id', pr.record_id).filter(function(a) { return _int(a.step_no) === _int(pr.current_step); });
    if (mine.some(function(a) { return String(a.approver_user_id) === String(session.adminUserId); }))
      return { success: false, message: 'คุณกดตัดสินใจในขั้นนี้ไปแล้ว' };

    centralAppend('pr_approvals', { record_id: centralNextId('pr_approvals'), pr_id: pr.record_id, step_no: _int(pr.current_step),
      approver_user_id: session.adminUserId, decision: decision, comment: String(payload.comment || ''), decided_at: nowStr() });

    if (decision === 'rejected') {
      centralUpdate('purchase_requisitions', pr.record_id, { status: 'rejected', decided_at: nowStr() });
      return _withPrResult(session, pr.record_id, 'ตีกลับใบขอซื้อแล้ว', scope);
    }
    var approvedCount = mine.filter(function(a) { return a.decision === 'approved'; }).length + 1;
    var need = Math.max(1, _int(step.required_approvals) || 1);
    if (approvedCount < need) return _withPrResult(session, pr.record_id, 'อนุมัติแล้ว ' + approvedCount + '/' + need + ' คนในขั้นนี้', scope);
    var nextStep = steps.filter(function(s) { return _int(s.step_no) > _int(pr.current_step); })[0];
    if (nextStep) {
      centralUpdate('purchase_requisitions', pr.record_id, { current_step: _int(nextStep.step_no) });
      return _withPrResult(session, pr.record_id, 'ผ่านขั้นนี้แล้ว → ส่งต่อขั้น ' + _int(nextStep.step_no) + ' (' + (nextStep.name || '') + ')', scope);
    }
    centralUpdate('purchase_requisitions', pr.record_id, { status: 'approved', decided_at: nowStr() });
    return _withPrResult(session, pr.record_id, 'อนุมัติครบทุกขั้นแล้ว — ออกใบสั่งซื้อได้', scope);
  });
}

// payload: { id, reason? } — ยกเลิกใบ (ที่ยังไม่ออก PO)
function cancelPurchaseRequisition(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'edit'); if (err) return err;
  var scope = _purchaseScope(session, payload);
  return _withDocLock(function() {
    var pr = _findScoped('purchase_requisitions', payload.id, scope);
    if (!pr) return { success: false, message: 'ไม่พบใบขอซื้อนี้' };
    if (pr.status === 'cancelled') return { success: false, message: 'ใบนี้ถูกยกเลิกไปแล้ว' };
    if (pr.status === 'closed') return { success: false, message: 'ใบนี้ออกใบสั่งซื้อครบแล้ว ยกเลิกไม่ได้' };
    var released = _childrenOf('pr_items', 'pr_id', pr.record_id).some(function(it) { return (Number(it.po_qty) || 0) > 0; });
    if (released) return { success: false, message: 'ใบนี้ออกใบสั่งซื้อไปบางส่วนแล้ว ยกเลิกไม่ได้ — ให้ยกเลิกที่ใบสั่งซื้อแทน' };
    centralUpdate('purchase_requisitions', pr.record_id, { status: 'cancelled', decided_at: nowStr(),
      note: String(pr.note || '') + (payload.reason ? ('\nยกเลิก: ' + payload.reason) : '') });
    return _withPrResult(session, pr.record_id, 'ยกเลิกใบขอซื้อแล้ว', scope);
  });
}

// ใบขอซื้อที่อนุมัติแล้วและยังมีของค้างไม่ได้ออก PO — ใช้เป็นตัวเลือกตอนเปิดใบสั่งซื้อ
function listApprovedPrLines(session, payload) {
  var err = _requirePermission(session, 'purchasing', 'view'); if (err) return err;
  var prs = {};
  _scoped('purchase_requisitions', _purchaseScope(session, payload)).forEach(function(pr) { if (pr.status === 'approved') prs[String(pr.record_id)] = pr; });
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var out = [];
  centralObjects('pr_items').forEach(function(it) {
    var pr = prs[String(it.pr_id)]; if (!pr) return;
    var remain = (Number(it.qty) || 0) - (Number(it.po_qty) || 0);
    if (remain <= 0) return;
    var p = it.product_id ? products[String(it.product_id)] : null;
    out.push({ prId: pr.record_id, prNo: pr.pr_no, prItemId: it.record_id, productId: it.product_id || '',
      productCode: p ? p.product_code : '', description: it.description || (p ? p.name : ''), unitCode: it.unit_code || '',
      qty: Number(it.qty) || 0, poQty: Number(it.po_qty) || 0, remainQty: remain, unitPrice: Number(it.unit_price) || 0,
      needByDate: _dOnly(pr.need_by_date) });
  });
  return { success: true, data: out };
}
