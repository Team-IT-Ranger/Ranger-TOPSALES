/**
 * ===================== บัญชี: แยกประเภท (GL) / เจ้าหนี้ (AP) / ลูกหนี้ (AR) =====================
 * หลักการ:
 *  - ทุกความเคลื่อนไหวทางบัญชีลงเป็น "ใบสำคัญ" (gl_journals + gl_journal_lines) เดบิตต้องเท่าเครดิตเสมอ (_postJournal บังคับ)
 *  - เอกสารที่ระบบสร้างให้อัตโนมัติผูก journal_id ไว้เสมอ ย้อนรอยจากเอกสาร → ใบสำคัญ → บัญชีแยกประเภทได้
 *  - ยกเลิกใบสำคัญใช้วิธี "กลับรายการ" (void = ออกใบสำคัญกลับข้าง) ไม่ลบของเดิม
 * ผังบัญชีที่ระบบอ้างอิงเองอยู่ใน GL_ACCT ข้างล่าง (seed ครั้งแรกใน 00_setup_sheets.gs) — เปลี่ยนรหัสต้องแก้ที่นี่ด้วย
 *
 * วงจรเจ้าหนี้:  รับของ (GR) → Dr สินค้าคงเหลือ / Cr GR-NI  →  ตั้งหนี้จากใบรับของ → Dr GR-NI + Dr ภาษีซื้อ / Cr เจ้าหนี้
 *                → จ่ายเงิน → Dr เจ้าหนี้ / Cr ธนาคาร (ตัดได้หลายใบใน 1 การจ่าย)
 * วงจรลูกหนี้:  ออกใบแจ้งหนี้ (จากบิลขายเครดิต หรือกรอกเอง) → Dr ลูกหนี้ / Cr รายได้ + Cr ภาษีขาย
 *                → รับชำระ → Dr ธนาคาร / Cr ลูกหนี้
 */

var GL_ACCT = {
  CASH: '1110', BANK: '1120', AR: '1200', INVENTORY: '1300', VAT_INPUT: '1400',
  AP: '2100', GRNI: '2150', VAT_OUTPUT: '2200',
  SALES: '4100', COGS: '5100', OTHER_EXPENSE: '5900'
};
var AR_VAT_RATE = 0.07;

/* ═══════════════ ผังบัญชี ═══════════════ */

function listGlAccounts(session) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var rows = centralObjects('gl_accounts').map(function(a) {
    return { code: String(a.code), name: a.name, acctType: a.acct_type, parentCode: a.parent_code || '', isActive: _isTrue(a.is_active), note: a.note || '' };
  });
  rows.sort(function(a, b) { return String(a.code).localeCompare(String(b.code)); });
  return { success: true, data: rows };
}

// payload: { code, name, acctType, parentCode?, isActive?, note? } — code เป็นกุญแจ (มีอยู่แล้ว = แก้ไข)
function saveGlAccount(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  var code = String(payload.code || '').trim();
  var name = String(payload.name || '').trim();
  if (!code) return { success: false, message: 'กรุณาระบุรหัสบัญชี' };
  if (!name) return { success: false, message: 'กรุณาระบุชื่อบัญชี' };
  if (['asset', 'liability', 'equity', 'income', 'expense'].indexOf(payload.acctType) === -1)
    return { success: false, message: 'ประเภทบัญชีไม่ถูกต้อง (asset/liability/equity/income/expense)' };
  return _withDocLock(function() {
    var sh = centralSheet('gl_accounts');
    var data = sh.getDataRange().getValues(), headers = data[0];
    var col = function(f) { return headers.indexOf(f); };
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][col('code')]) === code) {
        sh.getRange(i + 1, col('name') + 1).setValue(name);
        sh.getRange(i + 1, col('acct_type') + 1).setValue(payload.acctType);
        sh.getRange(i + 1, col('parent_code') + 1).setValue(String(payload.parentCode || ''));
        sh.getRange(i + 1, col('is_active') + 1).setValue(payload.isActive === false ? 'FALSE' : 'TRUE');
        sh.getRange(i + 1, col('note') + 1).setValue(String(payload.note || ''));
        return { success: true, updated: true };
      }
    }
    centralAppend('gl_accounts', { code: code, name: name, acct_type: payload.acctType, parent_code: String(payload.parentCode || ''),
      is_active: payload.isActive === false ? 'FALSE' : 'TRUE', note: String(payload.note || '') });
    return { success: true, created: true };
  });
}

function _accountMap() {
  var map = {};
  centralObjects('gl_accounts').forEach(function(a) { map[String(a.code)] = a; });
  return map;
}

/* ═══════════════ สมุดรายวัน (ใบสำคัญ) ═══════════════ */

/**
 * opts: { date, source('GL'|'AP'|'AR'|'INV'), refType, refId, memo, createdBy, lines:[{accountCode, description, debit, credit, partyType, partyId}] }
 * คืน { success, journalId, journalNo } — ต้องเรียกใต้ _withDocLock (ผู้เรียกทุกตัวทำอยู่แล้ว)
 */
function _postJournal(opts) {
  var lines = (opts.lines || []).map(function(l, i) {
    return { lineNo: i + 1, accountCode: String(l.accountCode || '').trim(), description: String(l.description || ''),
      debit: _money(l.debit), credit: _money(l.credit), partyType: l.partyType || '', partyId: l.partyId == null ? '' : String(l.partyId) };
  }).filter(function(l) { return l.debit !== 0 || l.credit !== 0; });
  if (!lines.length) return { success: false, message: 'ใบสำคัญต้องมีรายการอย่างน้อย 1 บรรทัด' };
  if (!_validDate(opts.date)) return { success: false, message: 'วันที่ใบสำคัญต้องเป็น yyyy-mm-dd' };
  var accounts = _accountMap();
  for (var i = 0; i < lines.length; i++) {
    if (!accounts[lines[i].accountCode]) return { success: false, message: 'ไม่พบรหัสบัญชี ' + lines[i].accountCode + ' ในผังบัญชี' };
    if (lines[i].debit < 0 || lines[i].credit < 0) return { success: false, message: 'ยอดเดบิต/เครดิตต้องไม่ติดลบ' };
    if (lines[i].debit > 0 && lines[i].credit > 0) return { success: false, message: 'บรรทัดเดียวกันใส่ได้ทั้งเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง' };
  }
  var totalDebit = _money(lines.reduce(function(s, l) { return s + l.debit; }, 0));
  var totalCredit = _money(lines.reduce(function(s, l) { return s + l.credit; }, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.009)
    return { success: false, message: 'เดบิตไม่เท่าเครดิต (เดบิต ' + totalDebit + ' / เครดิต ' + totalCredit + ')' };

  var jid = centralNextId('gl_journals');
  var jno = _nextCentralDocNo('JV');
  centralAppend('gl_journals', { record_id: jid, journal_no: jno, journal_date: opts.date, source: opts.source || 'GL',
    ref_type: opts.refType || '', ref_id: opts.refId == null ? '' : String(opts.refId), memo: String(opts.memo || ''),
    status: 'posted', total_debit: totalDebit, total_credit: totalCredit, created_by: opts.createdBy || '', created_at: nowStr(), voided_at: '' });
  var lid = centralNextId('gl_journal_lines');
  centralAppendMany('gl_journal_lines', lines.map(function(l, i) {
    return { record_id: lid + i, journal_id: jid, line_no: l.lineNo, account_code: l.accountCode, description: l.description,
      debit: l.debit, credit: l.credit, party_type: l.partyType, party_id: l.partyId };
  }));
  return { success: true, journalId: jid, journalNo: jno, totalDebit: totalDebit };
}

// payload: { date, memo, lines:[...] } — ลงใบสำคัญเอง (รายการปรับปรุง/ตั้งต้นงวด)
function postManualJournal(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  return _withDocLock(function() {
    var r = _postJournal({ date: payload.date || _todayStr(), source: 'GL', refType: 'MANUAL', refId: '', memo: payload.memo,
      createdBy: session.adminUserId, lines: payload.lines || [] });
    if (!r.success) return r;
    return { success: true, journalId: r.journalId, journalNo: r.journalNo, message: 'ลงบัญชีใบสำคัญ ' + r.journalNo + ' แล้ว' };
  });
}

// กลับรายการใบสำคัญ (ไม่ลบของเดิม) — เอกสารที่ผูกอยู่ต้องจัดการสถานะเองตามบริบท
function voidJournal(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  return _withDocLock(function() {
    var j = _findById('gl_journals', payload.id);
    if (!j) return { success: false, message: 'ไม่พบใบสำคัญนี้' };
    if (j.status !== 'posted') return { success: false, message: 'ใบสำคัญนี้ถูกกลับรายการไปแล้ว' };
    var lines = _childrenOf('gl_journal_lines', 'journal_id', j.record_id);
    var r = _postJournal({ date: payload.date || _todayStr(), source: j.source, refType: 'VOID', refId: j.record_id,
      memo: 'กลับรายการใบสำคัญ ' + j.journal_no + (payload.reason ? ' — ' + payload.reason : ''), createdBy: session.adminUserId,
      lines: lines.map(function(l) { return { accountCode: l.account_code, description: 'กลับรายการ: ' + (l.description || ''),
        debit: Number(l.credit) || 0, credit: Number(l.debit) || 0, partyType: l.party_type, partyId: l.party_id }; }) });
    if (!r.success) return r;
    centralUpdate('gl_journals', j.record_id, { status: 'voided', voided_at: nowStr() });
    return { success: true, journalId: r.journalId, journalNo: r.journalNo, message: 'กลับรายการด้วยใบสำคัญ ' + r.journalNo };
  });
}

function listJournals(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var rows = centralObjects('gl_journals');
  if (payload.source) rows = rows.filter(function(j) { return String(j.source) === String(payload.source); });
  if (payload.dateFrom) rows = rows.filter(function(j) { return _dOnly(j.journal_date) >= payload.dateFrom; });
  if (payload.dateTo) rows = rows.filter(function(j) { return _dOnly(j.journal_date) <= payload.dateTo; });
  var out = rows.map(function(j) {
    return { id: j.record_id, journalNo: j.journal_no, journalDate: _dOnly(j.journal_date), source: j.source, refType: j.ref_type || '',
      refId: j.ref_id || '', memo: j.memo || '', status: j.status, totalDebit: Number(j.total_debit) || 0, createdAt: safeDateStr(j.created_at) };
  });
  out.sort(function(a, b) { return String(b.journalDate).localeCompare(String(a.journalDate)) || (b.id - a.id); });
  var limit = _int(payload.limit) || 200;
  return { success: true, data: out.slice(0, limit), total: out.length };
}

function getJournal(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var j = _findById('gl_journals', payload.id);
  if (!j) return { success: false, message: 'ไม่พบใบสำคัญนี้' };
  var accounts = _accountMap();
  return { success: true, journal: {
    id: j.record_id, journalNo: j.journal_no, journalDate: _dOnly(j.journal_date), source: j.source, refType: j.ref_type || '',
    refId: j.ref_id || '', memo: j.memo || '', status: j.status, totalDebit: Number(j.total_debit) || 0, totalCredit: Number(j.total_credit) || 0,
    createdAt: safeDateStr(j.created_at),
    lines: _childrenOf('gl_journal_lines', 'journal_id', j.record_id).map(function(l) {
      return { lineNo: _int(l.line_no), accountCode: String(l.account_code), accountName: accounts[String(l.account_code)] ? accounts[String(l.account_code)].name : '',
        description: l.description || '', debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
        partyType: l.party_type || '', partyId: l.party_id || '' };
    }).sort(function(a, b) { return a.lineNo - b.lineNo; }) } };
}

// งบทดลอง: ยอดเดบิต/เครดิตรวมต่อบัญชี (ข้ามใบที่ voided) — ใช้ดูภาพรวมและตรวจว่างบสมดุล
function getTrialBalance(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  // นับ "ทุก" ใบสำคัญรวมทั้งใบที่ถูกกลับรายการ — เพราะการกลับรายการออกเป็นใบใหม่ที่ตรงข้ามกัน
  // (ถ้าตัดใบเดิมออกแล้วยังนับใบกลับรายการ ยอดจะถูกหักซ้ำสองเท่า)
  var journalDate = {};
  centralObjects('gl_journals').forEach(function(j) { journalDate[String(j.record_id)] = _dOnly(j.journal_date); });
  var accounts = _accountMap(), agg = {};
  centralObjects('gl_journal_lines').forEach(function(l) {
    var jid = String(l.journal_id);
    var d = journalDate[jid] || '';
    if (payload.dateFrom && d < payload.dateFrom) return;
    if (payload.dateTo && d > payload.dateTo) return;
    var code = String(l.account_code);
    var a = agg[code] = agg[code] || { code: code, name: accounts[code] ? accounts[code].name : '(ไม่อยู่ในผังบัญชี)',
      acctType: accounts[code] ? accounts[code].acct_type : '', debit: 0, credit: 0 };
    a.debit += Number(l.debit) || 0;
    a.credit += Number(l.credit) || 0;
  });
  var rows = Object.keys(agg).map(function(code) {
    var a = agg[code];
    a.debit = _money(a.debit); a.credit = _money(a.credit);
    var net = _money(a.debit - a.credit);
    // ด้านปกติของบัญชี: สินทรัพย์/ค่าใช้จ่าย = เดบิต, หนี้สิน/ทุน/รายได้ = เครดิต
    a.balance = (a.acctType === 'asset' || a.acctType === 'expense') ? net : _money(-net);
    return a;
  }).sort(function(a, b) { return String(a.code).localeCompare(String(b.code)); });
  return { success: true, data: rows,
    totalDebit: _money(rows.reduce(function(s, r) { return s + r.debit; }, 0)),
    totalCredit: _money(rows.reduce(function(s, r) { return s + r.credit; }, 0)) };
}

// ยอดคงเหลือต่อบัญชี (ด้านปกติของบัญชีเป็นบวก) ในช่วงวันที่ — ใช้ร่วมกันทั้งงบทดลอง/งบกำไรขาดทุน/งบดุล
function _accountBalances(dateFrom, dateTo) {
  var tb = getTrialBalance({ role_code: 'super_admin' }, { dateFrom: dateFrom, dateTo: dateTo });
  var map = {};
  tb.data.forEach(function(a) { map[a.code] = a; });
  return { map: map, rows: tb.data };
}
function _sumType(rows, type) { return _money(rows.filter(function(a) { return a.acctType === type; }).reduce(function(s, a) { return s + a.balance; }, 0)); }

// งบกำไรขาดทุน (ตามงวดที่เลือก): รายได้ − ค่าใช้จ่าย
function getIncomeStatement(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var b = _accountBalances(payload.dateFrom, payload.dateTo);
  var income = b.rows.filter(function(a) { return a.acctType === 'income'; });
  var expense = b.rows.filter(function(a) { return a.acctType === 'expense'; });
  var totalIncome = _sumType(b.rows, 'income'), totalExpense = _sumType(b.rows, 'expense');
  return { success: true, dateFrom: payload.dateFrom || '', dateTo: payload.dateTo || '',
    income: income, expense: expense, totalIncome: totalIncome, totalExpense: totalExpense,
    netProfit: _money(totalIncome - totalExpense) };
}

// งบแสดงฐานะการเงิน ณ วันที่: สินทรัพย์ = หนี้สิน + ทุน + กำไรสะสมงวดนี้
function getBalanceSheet(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var asOf = payload.asOf || _todayStr();
  var b = _accountBalances('', asOf);
  var assets = b.rows.filter(function(a) { return a.acctType === 'asset'; });
  var liabilities = b.rows.filter(function(a) { return a.acctType === 'liability'; });
  var equity = b.rows.filter(function(a) { return a.acctType === 'equity'; });
  var totalAssets = _sumType(b.rows, 'asset'), totalLiabilities = _sumType(b.rows, 'liability'), totalEquity = _sumType(b.rows, 'equity');
  var profit = _money(_sumType(b.rows, 'income') - _sumType(b.rows, 'expense'));   // กำไรสะสมที่ยังไม่ได้ปิดเข้าทุน
  return { success: true, asOf: asOf, assets: assets, liabilities: liabilities, equity: equity,
    totalAssets: totalAssets, totalLiabilities: totalLiabilities, totalEquity: totalEquity, netProfit: profit,
    totalLiabilitiesAndEquity: _money(totalLiabilities + totalEquity + profit),
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + profit)) < 0.01 };
}

/* ═══════════════ เจ้าหนี้ (AP) ═══════════════ */

function _apBillDto(b, extra) {
  extra = extra || {};
  var total = Number(b.total) || 0, paid = Number(b.paid_amount) || 0;
  return { id: b.record_id, billNo: b.bill_no, vendorInvoiceNo: b.vendor_invoice_no || '', vendorId: b.vendor_id,
    vendorName: extra.vendorName || '', poId: b.po_id || '', poNo: extra.poNo || '', grId: b.gr_id || '', grNo: extra.grNo || '',
    billDate: _dOnly(b.bill_date), dueDate: _dOnly(b.due_date), subtotalExVat: Number(b.subtotal_ex_vat) || 0,
    vatAmount: Number(b.vat_amount) || 0, total: total, paidAmount: paid, outstanding: _money(total - paid),
    status: b.status, journalId: b.journal_id || '', note: b.note || '', createdAt: safeDateStr(b.created_at) };
}

function listApBills(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var vendors = {}, pos = {}, grs = {};
  centralObjects('vendors').forEach(function(v) { vendors[String(v.record_id)] = v.name; });
  centralObjects('purchase_orders').forEach(function(p) { pos[String(p.record_id)] = p.po_no; });
  centralObjects('goods_receipts').forEach(function(g) { grs[String(g.record_id)] = g.gr_no; });
  var rows = centralObjects('ap_bills');
  if (payload.vendorId) rows = rows.filter(function(b) { return String(b.vendor_id) === String(payload.vendorId); });
  if (payload.openOnly) rows = rows.filter(function(b) { return b.status === 'open' || b.status === 'partial'; });
  var out = rows.map(function(b) {
    return _apBillDto(b, { vendorName: vendors[String(b.vendor_id)], poNo: pos[String(b.po_id)], grNo: grs[String(b.gr_id)] });
  });
  out.sort(function(a, b) { return String(b.billDate).localeCompare(String(a.billDate)) || (b.id - a.id); });
  return { success: true, data: out };
}

/**
 * ตั้งหนี้จากใบรับของ: payload { grId, vendorInvoiceNo?, billDate?, dueDate?, note? }
 * ยอดมาจากใบรับของจริง (ไม่ให้พิมพ์เอง) — Dr GR-NI + Dr ภาษีซื้อ / Cr เจ้าหนี้
 */
function createApBillFromGr(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  return _withDocLock(function() {
    var gr = _findById('goods_receipts', payload.grId);
    if (!gr) return { success: false, message: 'ไม่พบใบรับของนี้' };
    // สมุดบัญชีเป็นของบริษัทเจ้าของสินค้าเท่านั้น — ใบรับของของตัวแทน (มี tenant_id) ตั้งหนี้ในระบบนี้ไม่ได้
    if (String(gr.tenant_id || '')) return { success: false, message: 'ใบรับของนี้เป็นของตัวแทนจำหน่าย — ระบบบัญชีนี้เป็นสมุดของบริษัทเจ้าของสินค้าเท่านั้น' };
    if (gr.status !== 'posted') return { success: false, message: 'ใบรับของนี้ถูกยกเลิกแล้ว' };
    var dup = centralObjects('ap_bills').filter(function(b) { return String(b.gr_id) === String(gr.record_id) && b.status !== 'void'; })[0];
    if (dup) return { success: false, message: 'ใบรับของนี้ตั้งหนี้ไปแล้ว (' + dup.bill_no + ')' };
    var po = gr.po_id ? _findById('purchase_orders', gr.po_id) : null;
    var vendor = gr.vendor_id ? _findById('vendors', gr.vendor_id) : null;
    if (!vendor) return { success: false, message: 'ใบรับของนี้ไม่มีผู้ขาย' };
    var items = _childrenOf('gr_items', 'gr_id', gr.record_id);
    var goods = _money(items.reduce(function(s, it) { return s + (Number(it.amount) || 0); }, 0));
    if (!(goods > 0)) return { success: false, message: 'ใบรับของนี้ยอดเป็นศูนย์ ตั้งหนี้ไม่ได้' };
    var vatType = po ? (po.vat_type || 'excluded') : 'excluded';
    var subtotal, vat;
    if (vatType === 'included') { subtotal = _money(goods / (1 + PO_VAT_RATE)); vat = _money(goods - subtotal); }
    else if (vatType === 'none') { subtotal = goods; vat = 0; }
    else { subtotal = goods; vat = _money(goods * PO_VAT_RATE); }
    var total = _money(subtotal + vat);
    var billDate = payload.billDate || _todayStr();
    if (!_validDate(billDate)) return { success: false, message: 'วันที่ใบแจ้งหนี้ต้องเป็น yyyy-mm-dd' };
    var dueDate = payload.dueDate || _addDays(billDate, _int(vendor.payment_terms_days));
    if (!_validDate(dueDate)) return { success: false, message: 'วันครบกำหนดต้องเป็น yyyy-mm-dd' };

    var billId = centralNextId('ap_bills');
    var billNo = _nextCentralDocNo('AP');
    var jr = _postJournal({ date: billDate, source: 'AP', refType: 'AP_BILL', refId: billId,
      memo: 'ตั้งหนี้ ' + billNo + ' ' + vendor.name + (gr.gr_no ? ' (' + gr.gr_no + ')' : ''), createdBy: session.adminUserId,
      lines: [
        { accountCode: GL_ACCT.GRNI, description: 'ล้าง GR/NI จาก ' + gr.gr_no, debit: subtotal, credit: 0, partyType: 'vendor', partyId: vendor.record_id },
        { accountCode: GL_ACCT.VAT_INPUT, description: 'ภาษีซื้อ', debit: vat, credit: 0 },
        { accountCode: GL_ACCT.AP, description: 'เจ้าหนี้ ' + vendor.name, debit: 0, credit: total, partyType: 'vendor', partyId: vendor.record_id }
      ] });
    if (!jr.success) return jr;
    centralAppend('ap_bills', { record_id: billId, bill_no: billNo, vendor_invoice_no: String(payload.vendorInvoiceNo || ''),
      vendor_id: vendor.record_id, po_id: gr.po_id || '', gr_id: gr.record_id, bill_date: billDate, due_date: dueDate,
      subtotal_ex_vat: subtotal, vat_amount: vat, total: total, paid_amount: 0, status: 'open', journal_id: jr.journalId,
      note: String(payload.note || ''), created_by: session.adminUserId, created_at: nowStr() });
    return { success: true, billId: billId, billNo: billNo, total: total, journalNo: jr.journalNo,
      message: 'ตั้งหนี้ ' + billNo + ' ยอด ' + total.toLocaleString() + ' บาท (ครบกำหนด ' + dueDate + ')' };
  });
}

/**
 * ใบแจ้งหนี้ที่ไม่ได้มาจากการซื้อสินค้า (ค่าใช้จ่ายทั่วไป): payload { vendorId, vendorInvoiceNo?, billDate, dueDate?, subtotalExVat, vatAmount?, expenseAccount?, note? }
 */
function createApBillManual(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  var vendorId = payload.vendorId;
  var subtotal = _numOrNull(payload.subtotalExVat);
  if (!(subtotal > 0)) return { success: false, message: 'ยอดก่อนภาษีต้องมากกว่า 0' };
  var vat = _numOrNull(payload.vatAmount);
  if (vat === null) vat = _money(subtotal * PO_VAT_RATE);
  if (!(vat >= 0)) return { success: false, message: 'ภาษีซื้อต้องไม่ติดลบ' };
  var billDate = payload.billDate || _todayStr();
  if (!_validDate(billDate)) return { success: false, message: 'วันที่ใบแจ้งหนี้ต้องเป็น yyyy-mm-dd' };
  return _withDocLock(function() {
    var vendor = _findScoped('vendors', vendorId, '');   // บัญชีเป็นสมุดของบริษัท ใช้ได้เฉพาะผู้ขายของบริษัท
    if (!vendor) return { success: false, message: 'ไม่พบผู้ขายรายนี้' };
    var expenseAcct = String(payload.expenseAccount || GL_ACCT.OTHER_EXPENSE);
    if (!_accountMap()[expenseAcct]) return { success: false, message: 'ไม่พบรหัสบัญชีค่าใช้จ่าย ' + expenseAcct };
    var dueDate = payload.dueDate || _addDays(billDate, _int(vendor.payment_terms_days));
    var total = _money(subtotal + vat);
    var billId = centralNextId('ap_bills');
    var billNo = _nextCentralDocNo('AP');
    var jr = _postJournal({ date: billDate, source: 'AP', refType: 'AP_BILL', refId: billId, memo: 'ตั้งหนี้ ' + billNo + ' ' + vendor.name,
      createdBy: session.adminUserId, lines: [
        { accountCode: expenseAcct, description: String(payload.note || 'ค่าใช้จ่าย'), debit: _money(subtotal), credit: 0 },
        { accountCode: GL_ACCT.VAT_INPUT, description: 'ภาษีซื้อ', debit: _money(vat), credit: 0 },
        { accountCode: GL_ACCT.AP, description: 'เจ้าหนี้ ' + vendor.name, debit: 0, credit: total, partyType: 'vendor', partyId: vendor.record_id }
      ] });
    if (!jr.success) return jr;
    centralAppend('ap_bills', { record_id: billId, bill_no: billNo, vendor_invoice_no: String(payload.vendorInvoiceNo || ''),
      vendor_id: vendor.record_id, po_id: '', gr_id: '', bill_date: billDate, due_date: dueDate,
      subtotal_ex_vat: _money(subtotal), vat_amount: _money(vat), total: total, paid_amount: 0, status: 'open',
      journal_id: jr.journalId, note: String(payload.note || ''), created_by: session.adminUserId, created_at: nowStr() });
    return { success: true, billId: billId, billNo: billNo, total: total, message: 'ตั้งหนี้ ' + billNo + ' แล้ว' };
  });
}

/**
 * จ่ายเงินเจ้าหนี้: payload { vendorId, paymentDate?, method('transfer'|'cash'|'cheque'), bankAccount?, note?,
 *                           allocations:[{ billId, amount }] }
 * ตัดได้หลายใบใน 1 การจ่าย · จ่ายเกินยอดค้างของใบไหนไม่ได้
 */
function payApBills(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  var allocs = (payload.allocations || []).map(function(a) { return { billId: String(a.billId || ''), amount: _numOrNull(a.amount) }; })
    .filter(function(a) { return a.billId && a.amount !== null && a.amount !== 0; });
  if (!allocs.length) return { success: false, message: 'ยังไม่ได้เลือกใบแจ้งหนี้ที่จะจ่าย' };
  var payDate = payload.paymentDate || _todayStr();
  if (!_validDate(payDate)) return { success: false, message: 'วันที่จ่ายต้องเป็น yyyy-mm-dd' };
  return _withDocLock(function() {
    var vendor = _findScoped('vendors', payload.vendorId, '');
    if (!vendor) return { success: false, message: 'ไม่พบผู้ขายรายนี้' };
    var bills = [];
    for (var i = 0; i < allocs.length; i++) {
      var b = _findById('ap_bills', allocs[i].billId);
      if (!b) return { success: false, message: 'ไม่พบใบแจ้งหนี้ id ' + allocs[i].billId };
      if (String(b.vendor_id) !== String(vendor.record_id)) return { success: false, message: 'ใบ ' + b.bill_no + ' ไม่ใช่ของผู้ขายรายนี้' };
      if (b.status === 'void') return { success: false, message: 'ใบ ' + b.bill_no + ' ถูกยกเลิกแล้ว' };
      var outstanding = _money((Number(b.total) || 0) - (Number(b.paid_amount) || 0));
      if (!(allocs[i].amount > 0)) return { success: false, message: 'ใบ ' + b.bill_no + ': ยอดจ่ายต้องมากกว่า 0' };
      if (allocs[i].amount > outstanding + 0.009) return { success: false, message: 'ใบ ' + b.bill_no + ': ยอดค้าง ' + outstanding + ' แต่จ่ายมา ' + allocs[i].amount };
      bills.push({ bill: b, amount: _money(allocs[i].amount), outstanding: outstanding });
    }
    var amount = _money(bills.reduce(function(s, b) { return s + b.amount; }, 0));
    var method = ['transfer', 'cash', 'cheque'].indexOf(payload.method) !== -1 ? payload.method : 'transfer';
    var creditAcct = method === 'cash' ? GL_ACCT.CASH : GL_ACCT.BANK;
    var payId = centralNextId('ap_payments');
    var payNo = _nextCentralDocNo('PV');
    var jr = _postJournal({ date: payDate, source: 'AP', refType: 'AP_PAYMENT', refId: payId,
      memo: 'จ่ายเจ้าหนี้ ' + payNo + ' ' + vendor.name, createdBy: session.adminUserId, lines: [
        { accountCode: GL_ACCT.AP, description: 'ตัดเจ้าหนี้ ' + bills.map(function(b) { return b.bill.bill_no; }).join(', '), debit: amount, credit: 0, partyType: 'vendor', partyId: vendor.record_id },
        { accountCode: creditAcct, description: 'จ่ายโดย ' + method, debit: 0, credit: amount }
      ] });
    if (!jr.success) return jr;
    centralAppend('ap_payments', { record_id: payId, payment_no: payNo, vendor_id: vendor.record_id, payment_date: payDate,
      amount: amount, method: method, bank_account: String(payload.bankAccount || ''), note: String(payload.note || ''),
      status: 'posted', journal_id: jr.journalId, created_by: session.adminUserId, created_at: nowStr() });
    var allocId = centralNextId('ap_payment_allocations');
    centralAppendMany('ap_payment_allocations', bills.map(function(b, i) {
      return { record_id: allocId + i, payment_id: payId, bill_id: b.bill.record_id, amount: b.amount };
    }));
    bills.forEach(function(b) {
      var paid = _money((Number(b.bill.paid_amount) || 0) + b.amount);
      var total = Number(b.bill.total) || 0;
      centralUpdate('ap_bills', b.bill.record_id, { paid_amount: paid, status: paid >= total - 0.009 ? 'paid' : 'partial' });
    });
    return { success: true, paymentId: payId, paymentNo: payNo, amount: amount, journalNo: jr.journalNo,
      message: 'บันทึกการจ่าย ' + payNo + ' ยอด ' + amount.toLocaleString() + ' บาท (' + bills.length + ' ใบ)' };
  });
}

// อายุหนี้เจ้าหนี้ ณ วันที่ (ค่าเริ่มต้น = วันนี้): ยังไม่ถึงกำหนด / 1-30 / 31-60 / 61-90 / 90+
function getApAging(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var asOf = (payload && payload.asOf) || _todayStr();
  var vendors = {};
  centralObjects('vendors').forEach(function(v) { vendors[String(v.record_id)] = v.name; });
  return { success: true, asOf: asOf, data: _aging(centralObjects('ap_bills').filter(function(b) { return b.status === 'open' || b.status === 'partial'; })
    .map(function(b) {
      return { partyId: String(b.vendor_id), partyName: vendors[String(b.vendor_id)] || '', docNo: b.bill_no, dueDate: _dOnly(b.due_date),
        outstanding: _money((Number(b.total) || 0) - (Number(b.paid_amount) || 0)) };
    }), asOf) };
}

/* ═══════════════ ลูกหนี้ (AR) ═══════════════ */

function listArInvoices(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c.name; });
  var rows = centralObjects('ar_invoices');
  if (payload.customerId) rows = rows.filter(function(iv) { return String(iv.customer_id) === String(payload.customerId); });
  if (payload.openOnly) rows = rows.filter(function(iv) { return iv.status === 'open' || iv.status === 'partial'; });
  var out = rows.map(function(iv) {
    var total = Number(iv.total) || 0, recv = Number(iv.received_amount) || 0;
    return { id: iv.record_id, invoiceNo: iv.invoice_no, customerId: iv.customer_id, customerName: customers[String(iv.customer_id)] || '',
      tenantId: iv.tenant_id || '', salesOrderId: iv.sales_order_id || '', invoiceDate: _dOnly(iv.invoice_date), dueDate: _dOnly(iv.due_date),
      subtotalExVat: Number(iv.subtotal_ex_vat) || 0, vatAmount: Number(iv.vat_amount) || 0, total: total, receivedAmount: recv,
      outstanding: _money(total - recv), status: iv.status, journalId: iv.journal_id || '', note: iv.note || '' };
  });
  out.sort(function(a, b) { return String(b.invoiceDate).localeCompare(String(a.invoiceDate)) || (b.id - a.id); });
  return { success: true, data: out };
}

/**
 * ออกใบแจ้งหนี้ลูกค้า:
 *   จากบิลขายเครดิต — payload { tenantId, salesOrderId, invoiceDate?, dueDays? }  (ยอดมาจากบิลจริง)
 *   หรือกรอกเอง     — payload { customerId, invoiceDate?, dueDate?, subtotalExVat, vatAmount?, note? }
 * ลงบัญชี: Dr ลูกหนี้ / Cr รายได้ + Cr ภาษีขาย
 */
function createArInvoice(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  var invDate = payload.invoiceDate || _todayStr();
  if (!_validDate(invDate)) return { success: false, message: 'วันที่ใบแจ้งหนี้ต้องเป็น yyyy-mm-dd' };
  return _withDocLock(function() {
    var customerId, tenantId = '', salesOrderId = '', subtotal, vat, note = String(payload.note || '');
    if (payload.salesOrderId) {
      tenantId = payload.tenantId || _salesTenantId(session, payload);
      if (!tenantId) return { success: false, message: 'ไม่ทราบตัวแทนของบิลขายนี้' };
      var order = null;
      tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.salesOrderId)) order = o; });
      if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
      if (String(order.status) === 'cancelled') return { success: false, message: 'บิลขายนี้ถูกยกเลิกแล้ว' };
      var dupe = centralObjects('ar_invoices').filter(function(iv) {
        return String(iv.tenant_id) === String(tenantId) && String(iv.sales_order_id) === String(order.record_id) && iv.status !== 'void'; })[0];
      if (dupe) return { success: false, message: 'บิลขายนี้ออกใบแจ้งหนี้ไปแล้ว (' + dupe.invoice_no + ')' };
      customerId = order.customer_id;
      // บิลขายเก็บยอด "รวม VAT" ไว้แล้ว (ราคาขายรวมภาษี) → ถอด VAT ออกมาแยกบรรทัดบัญชี
      var gross = Number(order.total) || 0;
      if (!(gross > 0)) return { success: false, message: 'บิลขายนี้ยอดเป็นศูนย์' };
      subtotal = _money(gross / (1 + AR_VAT_RATE));
      vat = _money(gross - subtotal);
      salesOrderId = order.record_id;
      note = note || ('ออกจากบิลขาย ' + (order.order_code || order.record_id));
    } else {
      customerId = payload.customerId;
      subtotal = _numOrNull(payload.subtotalExVat);
      if (!(subtotal > 0)) return { success: false, message: 'ยอดก่อนภาษีต้องมากกว่า 0' };
      vat = _numOrNull(payload.vatAmount);
      if (vat === null) vat = _money(subtotal * AR_VAT_RATE);
      if (!(vat >= 0)) return { success: false, message: 'ภาษีขายต้องไม่ติดลบ' };
    }
    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(customerId)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
    // วันครบกำหนด: ระบุมาเอง → ใช้ตามนั้น · ไม่ระบุ → เครดิตประจำร้าน (customers.payment_terms_days) · ไม่ได้ตั้งไว้ → 30 วัน
    var custTerms = customerTermsDays(customer, null);
    var dueDays = _int(payload.dueDays) || (custTerms === null ? 30 : custTerms);
    var dueDate = payload.dueDate || _addDays(invDate, dueDays);
    if (!_validDate(dueDate)) return { success: false, message: 'วันครบกำหนดต้องเป็น yyyy-mm-dd' };
    var total = _money(subtotal + vat);
    var invId = centralNextId('ar_invoices');
    var invNo = _nextCentralDocNo('INV');
    var jr = _postJournal({ date: invDate, source: 'AR', refType: 'AR_INVOICE', refId: invId,
      memo: 'ใบแจ้งหนี้ ' + invNo + ' ' + customerFullName(customer), createdBy: session.adminUserId, lines: [
        { accountCode: GL_ACCT.AR, description: 'ลูกหนี้ ' + customerFullName(customer), debit: total, credit: 0, partyType: 'customer', partyId: customer.record_id },
        { accountCode: GL_ACCT.SALES, description: note || 'รายได้จากการขาย', debit: 0, credit: _money(subtotal) },
        { accountCode: GL_ACCT.VAT_OUTPUT, description: 'ภาษีขาย', debit: 0, credit: _money(vat) }
      ] });
    if (!jr.success) return jr;
    centralAppend('ar_invoices', { record_id: invId, invoice_no: invNo, customer_id: customer.record_id, tenant_id: tenantId,
      sales_order_id: salesOrderId, invoice_date: invDate, due_date: dueDate, subtotal_ex_vat: _money(subtotal), vat_amount: _money(vat),
      total: total, received_amount: 0, status: 'open', journal_id: jr.journalId, note: note, created_by: session.adminUserId, created_at: nowStr() });
    return { success: true, invoiceId: invId, invoiceNo: invNo, total: total, journalNo: jr.journalNo,
      message: 'ออกใบแจ้งหนี้ ' + invNo + ' ยอด ' + total.toLocaleString() + ' บาท' };
  });
}

// รับชำระจากลูกค้า: payload { customerId, receiptDate?, method, bankAccount?, note?, allocations:[{invoiceId, amount}] }
function receiveArPayment(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  var allocs = (payload.allocations || []).map(function(a) { return { invoiceId: String(a.invoiceId || ''), amount: _numOrNull(a.amount) }; })
    .filter(function(a) { return a.invoiceId && a.amount !== null && a.amount !== 0; });
  if (!allocs.length) return { success: false, message: 'ยังไม่ได้เลือกใบแจ้งหนี้ที่รับชำระ' };
  var date = payload.receiptDate || _todayStr();
  if (!_validDate(date)) return { success: false, message: 'วันที่รับชำระต้องเป็น yyyy-mm-dd' };
  return _withDocLock(function() {
    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(payload.customerId)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
    var invs = [];
    for (var i = 0; i < allocs.length; i++) {
      var iv = _findById('ar_invoices', allocs[i].invoiceId);
      if (!iv) return { success: false, message: 'ไม่พบใบแจ้งหนี้ id ' + allocs[i].invoiceId };
      if (String(iv.customer_id) !== String(customer.record_id)) return { success: false, message: 'ใบ ' + iv.invoice_no + ' ไม่ใช่ของลูกค้ารายนี้' };
      if (iv.status === 'void') return { success: false, message: 'ใบ ' + iv.invoice_no + ' ถูกยกเลิกแล้ว' };
      var outstanding = _money((Number(iv.total) || 0) - (Number(iv.received_amount) || 0));
      if (!(allocs[i].amount > 0)) return { success: false, message: 'ใบ ' + iv.invoice_no + ': ยอดรับต้องมากกว่า 0' };
      if (allocs[i].amount > outstanding + 0.009) return { success: false, message: 'ใบ ' + iv.invoice_no + ': ค้าง ' + outstanding + ' แต่รับมา ' + allocs[i].amount };
      invs.push({ inv: iv, amount: _money(allocs[i].amount) });
    }
    var amount = _money(invs.reduce(function(s, x) { return s + x.amount; }, 0));
    var method = ['transfer', 'cash', 'cheque'].indexOf(payload.method) !== -1 ? payload.method : 'transfer';
    var debitAcct = method === 'cash' ? GL_ACCT.CASH : GL_ACCT.BANK;
    var rcpId = centralNextId('ar_receipts');
    var rcpNo = _nextCentralDocNo('RV');
    var jr = _postJournal({ date: date, source: 'AR', refType: 'AR_RECEIPT', refId: rcpId,
      memo: 'รับชำระ ' + rcpNo + ' ' + customerFullName(customer), createdBy: session.adminUserId, lines: [
        { accountCode: debitAcct, description: 'รับชำระโดย ' + method, debit: amount, credit: 0 },
        { accountCode: GL_ACCT.AR, description: 'ตัดลูกหนี้ ' + invs.map(function(x) { return x.inv.invoice_no; }).join(', '), debit: 0, credit: amount, partyType: 'customer', partyId: customer.record_id }
      ] });
    if (!jr.success) return jr;
    centralAppend('ar_receipts', { record_id: rcpId, receipt_no: rcpNo, customer_id: customer.record_id, receipt_date: date,
      amount: amount, method: method, bank_account: String(payload.bankAccount || ''), note: String(payload.note || ''),
      status: 'posted', journal_id: jr.journalId, created_by: session.adminUserId, created_at: nowStr() });
    var allocId = centralNextId('ar_receipt_allocations');
    centralAppendMany('ar_receipt_allocations', invs.map(function(x, i) {
      return { record_id: allocId + i, receipt_id: rcpId, invoice_id: x.inv.record_id, amount: x.amount };
    }));
    invs.forEach(function(x) {
      var recv = _money((Number(x.inv.received_amount) || 0) + x.amount);
      var total = Number(x.inv.total) || 0;
      centralUpdate('ar_invoices', x.inv.record_id, { received_amount: recv, status: recv >= total - 0.009 ? 'paid' : 'partial' });
    });
    return { success: true, receiptId: rcpId, receiptNo: rcpNo, amount: amount, journalNo: jr.journalNo,
      message: 'รับชำระ ' + rcpNo + ' ยอด ' + amount.toLocaleString() + ' บาท (' + invs.length + ' ใบ)' };
  });
}

function getArAging(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var asOf = (payload && payload.asOf) || _todayStr();
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c.name; });
  return { success: true, asOf: asOf, data: _aging(centralObjects('ar_invoices').filter(function(iv) { return iv.status === 'open' || iv.status === 'partial'; })
    .map(function(iv) {
      return { partyId: String(iv.customer_id), partyName: customers[String(iv.customer_id)] || '', docNo: iv.invoice_no,
        dueDate: _dOnly(iv.due_date), outstanding: _money((Number(iv.total) || 0) - (Number(iv.received_amount) || 0)) };
    }), asOf) };
}

// รวมยอดค้างเป็นช่วงอายุหนี้ต่อคู่ค้า
function _aging(docs, asOf) {
  var byParty = {};
  docs.forEach(function(d) {
    if (!(d.outstanding > 0)) return;
    var p = byParty[d.partyId] = byParty[d.partyId] || { partyId: d.partyId, partyName: d.partyName, notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0, docs: [] };
    var days = d.dueDate ? _daysBetween(d.dueDate, asOf) : 0;
    if (days <= 0) p.notDue += d.outstanding;
    else if (days <= 30) p.d1_30 += d.outstanding;
    else if (days <= 60) p.d31_60 += d.outstanding;
    else if (days <= 90) p.d61_90 += d.outstanding;
    else p.d90plus += d.outstanding;
    p.total += d.outstanding;
    p.docs.push({ docNo: d.docNo, dueDate: d.dueDate, overdueDays: Math.max(0, days), outstanding: d.outstanding });
  });
  return Object.keys(byParty).map(function(k) {
    var p = byParty[k];
    ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus', 'total'].forEach(function(f) { p[f] = _money(p[f]); });
    return p;
  }).sort(function(a, b) { return b.total - a.total; });
}

function _addDays(dateStr, days) {
  var p = String(dateStr).split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  d.setUTCDate(d.getUTCDate() + (parseInt(days, 10) || 0));
  return d.toISOString().slice(0, 10);
}
function _daysBetween(fromDateStr, toDateStr) {
  var a = String(fromDateStr).split('-'), b = String(toDateStr).split('-');
  var da = Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  var db = Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  return Math.round((db - da) / 86400000);
}

// บิลขายเครดิตที่ยังไม่ได้ออกใบแจ้งหนี้ (ของตัวแทนที่ระบุ) — ใช้เป็นตัวเลือกตอนออกใบแจ้งหนี้ลูกหนี้
function listUninvoicedSalesOrders(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var tenantId = (payload && payload.tenantId) || _salesTenantId(session, payload || {});
  if (!tenantId) return { success: false, message: 'ไม่ทราบตัวแทนที่ต้องการดู' };
  var invoiced = {};
  centralObjects('ar_invoices').forEach(function(iv) {
    if (iv.status !== 'void' && String(iv.tenant_id) === String(tenantId)) invoiced[String(iv.sales_order_id)] = iv.invoice_no;
  });
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c.name; });
  var out = [];
  tenantObjects(tenantId, 'sales_orders').forEach(function(o) {
    if (String(o.status) === 'cancelled') return;
    if (!isCreditPayment(o.payment_method)) return;           // เงินสดเก็บเงินหน้าร้านแล้ว ไม่ต้องตั้งลูกหนี้
    if (invoiced[String(o.record_id)]) return;
    out.push({ id: o.record_id, orderCode: o.order_code, customerId: o.customer_id, customerName: customers[String(o.customer_id)] || '',
      total: Number(o.total) || 0, createdAt: safeDateStr(o.created_at), tenantId: tenantId });
  });
  out.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return { success: true, data: out, tenantId: tenantId };
}
