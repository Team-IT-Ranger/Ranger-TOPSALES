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
// อัตราเดียวกับทั้งระบบ (ค่าตั้งของบริษัท) — ใบแจ้งหนี้ที่ออกจากบิลขายใช้อัตราที่บิลบันทึกไว้อยู่แล้ว
/* ═══════════ สมุดบัญชี: ของบริษัท หรือของตัวแทน ═══════════
   ตัวแทนซื้อขาดไปจากบริษัท รายได้จากการขายต่อเป็นของเขา ต้องลงสมุดของเขาเอง
   (เจ้าของระบบยืนยัน 6 ต.ค. 2026 · ดู docs/tenant-books-design.md)

   ★ `''` = สมุดบริษัทเจ้าของสินค้า — แถวเดิมทุกแถวมี tenant_id ว่าง จึงถูกต้องอยู่แล้ว ไม่ต้อง migrate
   ★ ฝั่งบริษัทเปิดดูสมุดของตัวแทนได้ (เจ้าของระบบสั่ง) ผ่านกลไกสวมสิทธิ์เดิม — เลือกตัวแทนแล้ว
     `_effectiveTenantId` คืนรหัสนั้นมาเอง · ตัวแทนข้ามไปดูสมุดตัวแทนอื่นยังไม่ได้เหมือนเดิม
   ★ ไม่มี "รวมทุกสมุด" โดยตั้งใจ — คนละนิติบุคคล งบรวมกันไม่มีความหมายทางบัญชี */
/**
 * ★★ "ตัวแทนบ้าน" คือสมุดบริษัท ไม่ใช่สมุดที่สาม
 * ยอดขายตรงของบริษัทเก็บผ่านตัวแทนบ้าน (`_ensureHouseTenant`) เอกสารจึงติด tenant_id = 'TNKI' มา
 * ขณะที่แถวบัญชีเดิมทั้งหมดมี tenant_id ว่าง — ถ้าไม่ยุบสองค่านี้ให้เป็นสมุดเดียวกัน
 * ใบแจ้งหนี้ขายตรงจะหายไปจากงบบริษัทโดยไม่มีอะไรฟ้อง
 */
function _normBook(tenantId) {
  var t = String(tenantId || '');
  if (!t) return '';
  if (typeof OWNER_TENANT_ID !== 'undefined' && t === OWNER_TENANT_ID) return '';
  if (typeof HOUSE_TENANT_ID !== 'undefined' && t === HOUSE_TENANT_ID) return '';
  var hit = null;
  centralObjects('tenants').forEach(function(x) { if (String(x.tenant_id) === t) hit = x; });
  return (hit && isFlagOn(hit.is_house)) ? '' : t;
}

function _bookScope(session, payload) {
  return _normBook(_effectiveTenantId(session, payload || {}));
}
/** แถวนี้อยู่ในสมุดที่กำลังดูอยู่ไหม — ทุกการอ่านต้องผ่านตัวนี้ตัวเดียว */
function _inBook(row, scope) {
  return _normBook(row && row.tenant_id) === _normBook(scope);
}

function _arVatRate() { return typeof currentVatRate === 'function' ? currentVatRate() : 0.07; }

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
  // เลขใบสำคัญแยกเล่มต่อสมุด — ตัวแทนมีเล่มของตัวเอง (JV-TNKN-202610-0001) ไม่ปนกับของบริษัท
  var book = _normBook(opts.tenantId);
  var jno = _nextCentralDocNo('JV', book || undefined);
  centralAppend('gl_journals', { record_id: jid, tenant_id: book, journal_no: jno, journal_date: opts.date, source: opts.source || 'GL',
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
      createdBy: session.adminUserId, tenantId: _bookScope(session, payload), lines: payload.lines || [] });
    if (!r.success) return r;
    return { success: true, journalId: r.journalId, journalNo: r.journalNo, message: 'ลงบัญชีใบสำคัญ ' + r.journalNo + ' แล้ว' };
  });
}

/* กลับรายการใบสำคัญจริง (ไม่ตรวจสิทธิ์ — ผู้เรียกต้องเช็คสิทธิ์ของตัวเองมาก่อนแล้ว) ใช้ร่วมกันทั้ง voidJournal (กดตรงๆ)
 * และเอกสารอื่นที่ต้อง "กลับรายการใบสำคัญของตัวเอง" ไปด้วยตอนยกเลิก เช่น cancelGoodsReceipt (22_purchase_order.gs)
 * — คนละสิทธิ์กับเอกสารต้นทาง (inventory ≠ accounting) จะได้ไม่ต้องมีทั้งสองสิทธิ์แค่จะยกเลิกใบรับของใบเดียว */
function _reverseJournalCore(session, journalId, reason, date) {
  var j = _findById('gl_journals', journalId);
  if (!j) return { success: false, message: 'ไม่พบใบสำคัญนี้' };
  if (j.status !== 'posted') return { success: false, message: 'ใบสำคัญนี้ถูกกลับรายการไปแล้ว' };
  var lines = _childrenOf('gl_journal_lines', 'journal_id', j.record_id);
  // ★ ใบกลับรายการต้องอยู่ "สมุดเดียวกับใบเดิม" ไม่ใช่สมุดของคนที่กดยกเลิก
  //   (ฝั่งบริษัทกลับรายการใบของตัวแทนแทนได้ ถ้าลงสมุดบริษัทจะเละทั้งสองสมุดพร้อมกัน)
  var r = _postJournal({ date: date || _todayStr(), source: j.source, refType: 'VOID', refId: j.record_id, tenantId: j.tenant_id,
    memo: 'กลับรายการใบสำคัญ ' + j.journal_no + (reason ? ' — ' + reason : ''), createdBy: session.adminUserId,
    lines: lines.map(function(l) { return { accountCode: l.account_code, description: 'กลับรายการ: ' + (l.description || ''),
      debit: Number(l.credit) || 0, credit: Number(l.debit) || 0, partyType: l.party_type, partyId: l.party_id }; }) });
  if (!r.success) return r;
  centralUpdate('gl_journals', j.record_id, { status: 'voided', voided_at: nowStr() });
  return { success: true, journalId: r.journalId, journalNo: r.journalNo, message: 'กลับรายการด้วยใบสำคัญ ' + r.journalNo };
}

// กลับรายการใบสำคัญ (ไม่ลบของเดิม) — เอกสารที่ผูกอยู่ต้องจัดการสถานะเองตามบริบท
function voidJournal(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  return _withDocLock(function() {
    var j0 = _findById('gl_journals', payload.id);
    if (!j0 || !_inBook(j0, _bookScope(session, payload))) return { success: false, message: 'ไม่พบใบสำคัญนี้' };
    return _reverseJournalCore(session, payload.id, payload.reason, payload.date);
  });
}

function listJournals(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var scope = _bookScope(session, payload);
  var rows = centralObjects('gl_journals').filter(function(j) { return _inBook(j, scope); });
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
  // ใบสำคัญของสมุดอื่น = ตอบเหมือนไม่มี ไม่บอกว่ามีอยู่แต่ดูไม่ได้ (เลขที่เอกสารเป็นข้อมูลทางธุรกิจ)
  if (!_inBook(j, _bookScope(session, payload))) return { success: false, message: 'ไม่พบใบสำคัญนี้' };
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
  var scope = _normBook(payload.bookScope !== undefined ? payload.bookScope : _effectiveTenantId(session, payload));
  /* บรรทัดใบสำคัญไม่ได้เก็บว่าอยู่สมุดไหน — สืบทอดจากหัวใบ จึงต้องทำดัชนีหัวใบก่อนแล้วค่อยกรองบรรทัด
     บรรทัดที่หาหัวใบไม่เจอถูกตัดทิ้ง (ข้อมูลเสีย ไม่ควรไหลเข้างบของใครทั้งนั้น) */
  var journalDate = {}, journalBook = {};
  centralObjects('gl_journals').forEach(function(j) {
    journalDate[String(j.record_id)] = _dOnly(j.journal_date);
    journalBook[String(j.record_id)] = _normBook(j.tenant_id);
  });
  var accounts = _accountMap(), agg = {};
  centralObjects('gl_journal_lines').forEach(function(l) {
    var jid = String(l.journal_id);
    if (journalBook[jid] === undefined || journalBook[jid] !== scope) return;   // journalBook ผ่าน _normBook มาแล้วตอนสร้างดัชนี
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
function _accountBalances(dateFrom, dateTo, scope) {
  // ส่ง bookScope ตรงๆ ไม่ให้ getTrialBalance ไปคิดเองจาก session ปลอมที่สร้างขึ้นมาตรงนี้
  var tb = getTrialBalance({ role_code: 'super_admin' }, { dateFrom: dateFrom, dateTo: dateTo, bookScope: scope || '' });
  var map = {};
  tb.data.forEach(function(a) { map[a.code] = a; });
  return { map: map, rows: tb.data };
}
function _sumType(rows, type) { return _money(rows.filter(function(a) { return a.acctType === type; }).reduce(function(s, a) { return s + a.balance; }, 0)); }

// งบกำไรขาดทุน (ตามงวดที่เลือก): รายได้ − ค่าใช้จ่าย
function getIncomeStatement(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  payload = payload || {};
  var b = _accountBalances(payload.dateFrom, payload.dateTo, _bookScope(session, payload));
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
  var b = _accountBalances('', asOf, _bookScope(session, payload));
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
  var _scope = _bookScope(session, payload || {});
  payload = payload || {};
  var vendors = {}, pos = {}, grs = {};
  centralObjects('vendors').forEach(function(v) { vendors[String(v.record_id)] = v.name; });
  centralObjects('purchase_orders').forEach(function(p) { pos[String(p.record_id)] = p.po_no; });
  centralObjects('goods_receipts').forEach(function(g) { grs[String(g.record_id)] = g.gr_no; });
  var rows = centralObjects('ap_bills').filter(function(b) { return _inBook(b, _scope); });
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
    var book = _bookScope(session, payload);
    var gr = _findById('goods_receipts', payload.grId);
    /* ตั้งหนี้ได้ทั้งของบริษัทและของตัวแทน แต่ "ลงสมุดของเจ้าของใบรับของ" เท่านั้น (6 ต.ค. 2026)
       ใบของสมุดอื่นตอบเหมือนไม่มี — ฝั่งบริษัทต้องสวมสิทธิ์เข้าไปในตัวแทนก่อนถึงจะตั้งหนี้ให้เขาได้ */
    if (!gr || !_inBook(gr, book)) return { success: false, message: 'ไม่พบใบรับของนี้' };
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
    if (vatType === 'included') { subtotal = _money(goods / (1 + _poVatRate())); vat = _money(goods - subtotal); }
    else if (vatType === 'none') { subtotal = goods; vat = 0; }
    else { subtotal = goods; vat = _money(goods * _poVatRate()); }
    var total = _money(subtotal + vat);
    var billDate = payload.billDate || _todayStr();
    if (!_validDate(billDate)) return { success: false, message: 'วันที่ใบแจ้งหนี้ต้องเป็น yyyy-mm-dd' };
    var dueDate = payload.dueDate || _addDays(billDate, _int(vendor.payment_terms_days));
    if (!_validDate(dueDate)) return { success: false, message: 'วันครบกำหนดต้องเป็น yyyy-mm-dd' };

    var billId = centralNextId('ap_bills');
    var billNo = _nextCentralDocNo('AP', book || undefined);
    var jr = _postJournal({ date: billDate, source: 'AP', refType: 'AP_BILL', refId: billId, tenantId: book,
      memo: 'ตั้งหนี้ ' + billNo + ' ' + vendor.name + (gr.gr_no ? ' (' + gr.gr_no + ')' : ''), createdBy: session.adminUserId,
      lines: [
        { accountCode: GL_ACCT.GRNI, description: 'ล้าง GR/NI จาก ' + gr.gr_no, debit: subtotal, credit: 0, partyType: 'vendor', partyId: vendor.record_id },
        { accountCode: GL_ACCT.VAT_INPUT, description: 'ภาษีซื้อ', debit: vat, credit: 0 },
        { accountCode: GL_ACCT.AP, description: 'เจ้าหนี้ ' + vendor.name, debit: 0, credit: total, partyType: 'vendor', partyId: vendor.record_id }
      ] });
    if (!jr.success) return jr;
    centralAppend('ap_bills', { record_id: billId, tenant_id: book, bill_no: billNo, vendor_invoice_no: String(payload.vendorInvoiceNo || ''),
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
  if (vat === null) vat = _money(subtotal * _poVatRate());
  if (!(vat >= 0)) return { success: false, message: 'ภาษีซื้อต้องไม่ติดลบ' };
  var billDate = payload.billDate || _todayStr();
  if (!_validDate(billDate)) return { success: false, message: 'วันที่ใบแจ้งหนี้ต้องเป็น yyyy-mm-dd' };
  return _withDocLock(function() {
    // ผู้ขายต้องเป็นของสมุดเดียวกับใบที่กำลังตั้ง — ตั้งหนี้กับผู้ขายของอีกบริษัทไม่ได้
    var book = _bookScope(session, payload);
    var vendor = _findScoped('vendors', vendorId, book);
    if (!vendor) return { success: false, message: 'ไม่พบผู้ขายรายนี้' };
    var expenseAcct = String(payload.expenseAccount || GL_ACCT.OTHER_EXPENSE);
    if (!_accountMap()[expenseAcct]) return { success: false, message: 'ไม่พบรหัสบัญชีค่าใช้จ่าย ' + expenseAcct };
    var dueDate = payload.dueDate || _addDays(billDate, _int(vendor.payment_terms_days));
    var total = _money(subtotal + vat);
    var billId = centralNextId('ap_bills');
    var billNo = _nextCentralDocNo('AP', book || undefined);
    var jr = _postJournal({ date: billDate, source: 'AP', refType: 'AP_BILL', refId: billId, tenantId: book,
      memo: 'ตั้งหนี้ ' + billNo + ' ' + vendor.name, createdBy: session.adminUserId, lines: [
        { accountCode: expenseAcct, description: String(payload.note || 'ค่าใช้จ่าย'), debit: _money(subtotal), credit: 0 },
        { accountCode: GL_ACCT.VAT_INPUT, description: 'ภาษีซื้อ', debit: _money(vat), credit: 0 },
        { accountCode: GL_ACCT.AP, description: 'เจ้าหนี้ ' + vendor.name, debit: 0, credit: total, partyType: 'vendor', partyId: vendor.record_id }
      ] });
    if (!jr.success) return jr;
    centralAppend('ap_bills', { record_id: billId, tenant_id: book, bill_no: billNo, vendor_invoice_no: String(payload.vendorInvoiceNo || ''),
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
    var book = _bookScope(session, payload);
    var vendor = _findScoped('vendors', payload.vendorId, book);
    if (!vendor) return { success: false, message: 'ไม่พบผู้ขายรายนี้' };
    var bills = [];
    for (var i = 0; i < allocs.length; i++) {
      var b = _findById('ap_bills', allocs[i].billId);
      // ใบของสมุดอื่น = ตอบเหมือนไม่มี (จ่ายหนี้ข้ามสมุดไม่ได้)
      if (!b || !_inBook(b, book)) return { success: false, message: 'ไม่พบใบแจ้งหนี้ id ' + allocs[i].billId };
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
    var payNo = _nextCentralDocNo('PV', book || undefined);
    var jr = _postJournal({ date: payDate, source: 'AP', refType: 'AP_PAYMENT', refId: payId, tenantId: book,
      memo: 'จ่ายเจ้าหนี้ ' + payNo + ' ' + vendor.name, createdBy: session.adminUserId, lines: [
        { accountCode: GL_ACCT.AP, description: 'ตัดเจ้าหนี้ ' + bills.map(function(b) { return b.bill.bill_no; }).join(', '), debit: amount, credit: 0, partyType: 'vendor', partyId: vendor.record_id },
        { accountCode: creditAcct, description: 'จ่ายโดย ' + method, debit: 0, credit: amount }
      ] });
    if (!jr.success) return jr;
    centralAppend('ap_payments', { record_id: payId, tenant_id: book, payment_no: payNo, vendor_id: vendor.record_id, payment_date: payDate,
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
  return { success: true, asOf: asOf, data: _aging(centralObjects('ap_bills').filter(function(b) { return _inBook(b, _bookScope(session, payload)) && (b.status === 'open' || b.status === 'partial'); })
    .map(function(b) {
      return { partyId: String(b.vendor_id), partyName: vendors[String(b.vendor_id)] || '', docNo: b.bill_no, dueDate: _dOnly(b.due_date),
        outstanding: _money((Number(b.total) || 0) - (Number(b.paid_amount) || 0)) };
    }), asOf) };
}

/* ═══════════════ ลูกหนี้ (AR) ═══════════════ */

function listArInvoices(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var _scope = _bookScope(session, payload || {});
  payload = payload || {};
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c.name; });
  var rows = centralObjects('ar_invoices').filter(function(iv) { return _inBook(iv, _scope); });
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
/**
 * ★ รายได้ของตัวแทนต้องลง "สมุดของตัวแทน" ไม่ใช่สมุดบริษัท — ตัวแทน **ซื้อขาด** ไปจากบริษัท
 * เอาเข้างบบริษัท = รับรู้รายได้ซ้ำ (บริษัทรับรู้ตอนขายให้ตัวแทนไปแล้วรอบหนึ่ง)
 *
 * เดิม (6 ต.ค. 2026 เช้า) ปฏิเสธบิลของตัวแทนทุกใบ เพราะยังไม่มีสมุดของเขาให้ลง · ตอนนี้มีแล้ว
 * หน้าที่ของตัวนี้จึงเปลี่ยนจาก "ห้าม" เป็น **"ตรวจว่ากำลังลงถูกเล่ม"**
 *   คืน null = ลงได้ · คืน object = ปฏิเสธพร้อมเหตุผล
 *
 * ★ สองข้อที่ห้ามหาย ไม่ว่าจะแก้ตัวนี้อีกกี่รอบ:
 *   1. **หาตัวแทนไม่เจอ = ปฏิเสธ ไม่ใช่ปล่อยผ่าน** — `centralObjects` คืนค่าว่างเป็นระยะได้จริง
 *      ในโปรเจกต์นี้ (Apps Script สะดุด) ปล่อยผ่านจังหวะนั้น = รายได้ไหลผิดเล่มเงียบๆ
 *      ปฏิเสธแล้วแค่กดใหม่ ซึ่งแก้ได้
 *   2. **ต้องสวมสิทธิ์เข้าไปในตัวแทนก่อน** ถึงจะออกใบแจ้งหนี้ให้เขาได้ — นั่งอยู่สมุดบริษัท
 *      แล้วออกใบให้ตัวแทนไม่ได้ ไม่งั้นพลาดทีเดียวรายได้เข้าผิดนิติบุคคล
 */
function _arBookGate(tenantId, book) {
  var tid = String(tenantId || '');
  if (!tid) return _normBook(book) ? { success: false, message: 'ใบนี้ไม่ได้ระบุตัวแทน แต่กำลังทำงานในสมุดของตัวแทนอยู่' } : null;
  var t = null;
  centralObjects('tenants').forEach(function(x) { if (String(x.tenant_id) === tid) t = x; });
  if (!t) return { success: false, message: 'ไม่พบตัวแทน ' + tid + ' ในระบบ — ตรวจสอบก่อนออกใบแจ้งหนี้' };
  if (_normBook(tid) !== _normBook(book))
    return { success: false, message: 'บิลนี้เป็นของ ' + (t.name || tid) + ' ซึ่งซื้อขาดไปจากบริษัท — รายได้เป็นของตัวแทน ' +
      'ต้องลงในสมุดของเขา · เลือกบริษัทให้เป็น "' + (t.name || tid) + '" ก่อนออกใบแจ้งหนี้' };
  return null;
}

function createArInvoice(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  return _withDocLock(function() { return _createArInvoiceCore(session, payload, _bookScope(session, payload)); });
}

/* ตัวจริงของการออกใบแจ้งหนี้ — **ไม่ตรวจสิทธิ์และไม่จับ lock เอง** ผู้เรียกต้องทำมาก่อนแล้ว
   หลักเดียวกับ `_reverseJournalCore`: เอกสารต้นทางกับการลงบัญชีเป็นคนละสิทธิ์กัน
   เส้นทางอัตโนมัติตอนบิลเข้าสถานะ "พร้อมจัดส่ง" (`34_sales_status.gs`) เรียกตัวนี้ตรงๆ เพราะ
   (ก) อยู่ใต้ lock ของ `updateSalesOrderStatus` อยู่แล้ว จับซ้ำ = ค้างตัวเอง
   (ข) คนกด "พร้อมจัดส่ง" คือฝ่ายคลัง/ขาย ไม่ควรต้องมีสิทธิ์บัญชีเพื่อจะส่งของ
   `book` ส่งเข้ามาจากผู้เรียก ไม่คิดเองจาก session — เส้นทางอัตโนมัติรู้เล่มจากตัวบิล ไม่ใช่จากคนกด */
function _createArInvoiceCore(session, payload, book) {
  var invDate = payload.invoiceDate || _todayStr();
  if (!_validDate(invDate)) return { success: false, message: 'วันที่ใบแจ้งหนี้ต้องเป็น yyyy-mm-dd' };
  return (function() {
    var customerId, tenantId = '', salesOrderId = '', subtotal, vat, note = String(payload.note || '');
    if (payload.salesOrderId) {
      tenantId = payload.tenantId || _salesTenantId(session, payload);
      if (!tenantId) return { success: false, message: 'ไม่ทราบตัวแทนของบิลขายนี้' };
      // ตรวจก่อนเปิดไฟล์ตัวแทน — ไม่มีเหตุต้องอ่านไฟล์ของคนที่กำลังจะปฏิเสธ (และเปิดไฟล์ตัวแทนแพง ~1.5 วิ)
      var blocked = _arBookGate(tenantId, book); if (blocked) return blocked;
      var order = null;
      tenantObjects(tenantId, 'sales_orders').forEach(function(o) { if (String(o.record_id) === String(payload.salesOrderId)) order = o; });
      if (!order) return { success: false, message: 'ไม่พบบิลขายนี้' };
      if (String(order.status) === 'cancelled') return { success: false, message: 'บิลขายนี้ถูกยกเลิกแล้ว' };
      var dupe = centralObjects('ar_invoices').filter(function(iv) {
        return String(iv.tenant_id) === String(tenantId) && String(iv.sales_order_id) === String(order.record_id) && iv.status !== 'void'; })[0];
      if (dupe) return { success: false, message: 'บิลขายนี้ออกใบแจ้งหนี้ไปแล้ว (' + dupe.invoice_no + ')' };
      customerId = order.customer_id;
      // ใช้ยอดแยกภาษีที่บิลบันทึกไว้ตอนขาย (_orderVat ใน 18_pricing_engine.gs) — ไม่ถอดเองซ้ำ
      // ถอดซ้ำคือช่องทางให้ตัวเลขบนกระดาษกับในบัญชีต่างกันทีละสตางค์ แล้วงบไม่ลงตัว
      var gross = Number(order.total) || 0;
      if (!(gross > 0)) return { success: false, message: 'บิลขายนี้ยอดเป็นศูนย์' };
      var ov = _orderVat(order);
      subtotal = _money(ov.exVat);
      vat = _money(ov.vat);
      salesOrderId = order.record_id;
      note = note || ('ออกจากบิลขาย ' + (order.order_code || order.record_id));
    } else {
      customerId = payload.customerId;
      subtotal = _numOrNull(payload.subtotalExVat);
      if (!(subtotal > 0)) return { success: false, message: 'ยอดก่อนภาษีต้องมากกว่า 0' };
      vat = _numOrNull(payload.vatAmount);
      if (vat === null) vat = _money(subtotal * _arVatRate());
      if (!(vat >= 0)) return { success: false, message: 'ภาษีขายต้องไม่ติดลบ' };
    }
    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(customerId)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
    // ออกใบแจ้งหนี้เองโดยเลือกลูกค้า ก็ต้องตรวจเหมือนกัน — ลูกค้าของตัวแทนคือลูกค้าของเขา ไม่ใช่ของบริษัท
    var cBlocked = _arBookGate(customer.tenant_id, book); if (cBlocked) return cBlocked;
    /* ★ ใบที่กรอกเอง (ไม่ผูกบิลขาย) ต้องติดเจ้าของสมุดลงแถวด้วย — ไม่งั้นใบสำคัญไปอยู่สมุดตัวแทน
       แต่ตัวใบแจ้งหนี้เองยังเป็นของบริษัท: บริษัทเห็นใบที่ไม่ใช่ของตัวเอง ตัวแทนรับชำระใบของตัวเองไม่ได้
       และงบทดลองกับรายการลูกหนี้จะบอกคนละเรื่องกัน (เทสต์จับได้ตอนเขียนเคสสวมสิทธิ์) */
    if (!tenantId) tenantId = String(customer.tenant_id || '');
    // วันครบกำหนด: ระบุมาเอง → ใช้ตามนั้น · ไม่ระบุ → เครดิตประจำร้าน (customers.payment_terms_days) · ไม่ได้ตั้งไว้ → 30 วัน
    var custTerms = customerTermsDays(customer, null);
    var dueDays = _int(payload.dueDays) || (custTerms === null ? 30 : custTerms);
    var dueDate = payload.dueDate || _addDays(invDate, dueDays);
    if (!_validDate(dueDate)) return { success: false, message: 'วันครบกำหนดต้องเป็น yyyy-mm-dd' };
    var total = _money(subtotal + vat);
    var invId = centralNextId('ar_invoices');
    var invNo = _nextCentralDocNo('INV', book || undefined);
    var jr = _postJournal({ date: invDate, source: 'AR', refType: 'AR_INVOICE', refId: invId, tenantId: book,
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
  })();
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
    var book = _bookScope(session, payload);
    var customer = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(payload.customerId)) customer = c; });
    if (!customer) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };
    var invs = [];
    for (var i = 0; i < allocs.length; i++) {
      var iv = _findById('ar_invoices', allocs[i].invoiceId);
      if (!iv || !_inBook(iv, book)) return { success: false, message: 'ไม่พบใบแจ้งหนี้ id ' + allocs[i].invoiceId };
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
    var rcpNo = _nextCentralDocNo('RV', book || undefined);
    var jr = _postJournal({ date: date, source: 'AR', refType: 'AR_RECEIPT', refId: rcpId, tenantId: book,
      memo: 'รับชำระ ' + rcpNo + ' ' + customerFullName(customer), createdBy: session.adminUserId, lines: [
        { accountCode: debitAcct, description: 'รับชำระโดย ' + method, debit: amount, credit: 0 },
        { accountCode: GL_ACCT.AR, description: 'ตัดลูกหนี้ ' + invs.map(function(x) { return x.inv.invoice_no; }).join(', '), debit: 0, credit: amount, partyType: 'customer', partyId: customer.record_id }
      ] });
    if (!jr.success) return jr;
    centralAppend('ar_receipts', { record_id: rcpId, tenant_id: book, receipt_no: rcpNo, customer_id: customer.record_id, receipt_date: date,
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
  return { success: true, asOf: asOf, data: _aging(centralObjects('ar_invoices').filter(function(iv) { return _inBook(iv, _bookScope(session, payload)) && (iv.status === 'open' || iv.status === 'partial'); })
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
/**
 * ★ เติมใบสำคัญย้อนหลังให้ใบรับของของ "ตัวแทน" ที่รับไว้ก่อนระบบจะลงบัญชีให้ (ก่อน 6 ต.ค. 2026)
 *
 * เจ้าของระบบ 7 ต.ค. 2026: **"ยอดยกมาของ BDC เริ่มนับวันแรกที่มีข้อมูล"**
 * = ไม่มีใบยอดยกมาแยกต่างหาก · สมุดของตัวแทนเริ่มนับจากเอกสารใบแรกที่มีอยู่จริง
 * จึงต้องเดินย้อนกลับไปลงบัญชีให้ครบ ไม่ใช่เริ่มนับจากวันที่เปิดใช้ระบบบัญชี
 *
 * ★★ แตะเฉพาะใบของตัวแทน (`tenant_id` ไม่ว่าง) — ใบของบริษัทลงบัญชีมาตั้งแต่ต้นแล้ว
 *    ใบของบริษัทที่ `journal_id` ว่างแปลว่ามีเหตุอื่น (เช่นยอดเป็นศูนย์) ลงย้อนหลังให้
 *    = ขยับงบของงวดที่ปิดไปแล้ว ซึ่งแย่กว่าปล่อยไว้
 *
 * payload { commit?, limit?, tenantId? } — **ไม่ส่ง `commit: true` = ดูอย่างเดียว ไม่เขียนอะไรเลย**
 * รันซ้ำได้ (ข้ามใบที่มี journal_id แล้ว) · ทำทีละ `limit` ใบ (ค่าเริ่มต้น 100) แล้วบอก `remaining`
 * เพราะ Apps Script มีเพดาน 6 นาที — ค้างกลางทางแล้วรันต่อได้ ไม่ต้องเริ่มใหม่
 */
function backfillGrJournals(session, payload) {
  if (String(session.role_code) !== 'super_admin') return { success: false, message: 'เฉพาะ super_admin' };
  payload = payload || {};
  var commit = payload.commit === true || String(payload.commit) === 'true';
  var limit = _int(payload.limit) || 100;
  var onlyTenant = String(payload.tenantId || '');

  return _withDocLock(function() {
    var pending = centralObjects('goods_receipts').filter(function(gr) {
      if (String(gr.status) !== 'posted') return false;          // ใบที่ยกเลิกแล้วไม่ต้องลง
      if (String(gr.journal_id || '').trim()) return false;      // ลงไปแล้ว
      if (!String(gr.tenant_id || '')) return false;             // ★ ของบริษัทไม่แตะ (ดูหมายเหตุหัวฟังก์ชัน)
      if (onlyTenant && String(gr.tenant_id) !== onlyTenant) return false;
      return true;
    });
    // เรียงตามวันที่รับของจริง — ลงบัญชีย้อนหลังต้องไล่จากใบเก่าสุดไปใหม่สุด ไม่ใช่ตามลำดับแถวในชีต
    pending.sort(function(a, b) { return String(_dOnly(a.receive_date)).localeCompare(String(_dOnly(b.receive_date))) || (a.record_id - b.record_id); });

    var done = [], skipped = [], byBook = {};
    for (var i = 0; i < pending.length && done.length < limit; i++) {
      var gr = pending[i];
      var date = _dOnly(gr.receive_date);
      if (!_validDate(date)) { skipped.push({ grNo: gr.gr_no, why: 'วันที่รับของไม่ถูกรูปแบบ (' + gr.receive_date + ')' }); continue; }
      var value = _money(_childrenOf('gr_items', 'gr_id', gr.record_id)
        .reduce(function(s, it) { return s + (Number(it.amount) || 0); }, 0));
      if (!(value > 0)) { skipped.push({ grNo: gr.gr_no, why: 'ยอดเป็นศูนย์' }); continue; }
      var book = _normBook(gr.tenant_id);
      byBook[book] = _money((byBook[book] || 0) + value);
      done.push({ grNo: gr.gr_no, date: date, book: book, amount: value });
      if (!commit) continue;
      var jr = _postJournal({ date: date, source: 'INV', refType: 'GR', refId: gr.record_id, tenantId: gr.tenant_id,
        memo: 'รับของเข้าคลัง ' + gr.gr_no + ' (ลงย้อนหลัง)', createdBy: session.adminUserId, lines: [
          { accountCode: GL_ACCT.INVENTORY, description: 'สินค้าคงเหลือเพิ่มจาก ' + gr.gr_no, debit: value, credit: 0 },
          { accountCode: GL_ACCT.GRNI, description: 'รอรับใบแจ้งหนี้จากผู้ขาย', debit: 0, credit: value, partyType: 'vendor', partyId: gr.vendor_id }
        ] });
      if (!jr.success) return jr;   // ล้มกลางทาง = หยุดทันที ใบที่ลงไปแล้วยังอยู่ รันซ้ำแล้วเดินต่อได้
      centralUpdate('goods_receipts', gr.record_id, { journal_id: jr.journalId });
    }
    var remaining = pending.length - done.length - skipped.length;
    return { success: true, commit: commit, posted: done.length, skipped: skipped, remaining: remaining < 0 ? 0 : remaining,
      byBook: byBook, data: done,
      message: (commit ? 'ลงบัญชีย้อนหลัง ' : 'ดูอย่างเดียว — จะลงบัญชีย้อนหลัง ') + done.length + ' ใบ' +
        (skipped.length ? ' · ข้าม ' + skipped.length + ' ใบ' : '') +
        (remaining > 0 ? ' · เหลืออีก ' + remaining + ' ใบ (รันซ้ำเพื่อทำต่อ)' : '') };
  });
}
