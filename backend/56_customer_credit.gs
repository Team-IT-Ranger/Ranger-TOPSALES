/**
 * ===================== วงเงินเครดิตและหนี้ค้างของลูกค้า =====================
 *
 * ★★ ทำไมต้องมี: `customers.credit_limit` มีคอลัมน์ · กรอกได้ · แสดงได้ มาตั้งแต่ต้น
 *   แต่ **ไม่มีโค้ดไหนอ่านมันเลยสักจุด** (grep ใน `recordSale` / `recordSaleAdmin` / `priceCart`
 *   เจอ 0 จุด) — ตั้งวงเงินไว้ 50,000 แล้วร้านซื้อเชื่อไป 300,000 ก็ไม่มีอะไรฟ้อง
 *   และพนักงานที่ไปหน้าร้าน **ไม่เห็นเลยว่าร้านนี้ค้างอยู่เท่าไหร่** จึงตามเก็บเงินไม่ได้
 *
 * ★ นิยาม "หนี้ค้าง" อยู่ที่ `customerOutstandingMap()` ที่เดียว — ทุกจุดที่พูดถึงหนี้ค้าง
 *   (แอปมือถือ · หน้าแอดมิน · ด่านกันเปิดบิล) ต้องอ่านจากตัวนี้ ห้ามคิดเอง
 *
 *   หนี้ค้างของร้านหนึ่ง = ยอดค้างของ**ใบแจ้งหนี้ทุกใบที่ยังไม่ยกเลิก**
 *                        + บิลขายเชื่อที่**ยังไม่ได้ออกใบแจ้งหนี้** (total − paid_amount)
 *
 *   - **ต้องนับบิลที่ยังไม่ออกใบแจ้งหนี้ด้วย** ของส่งไปแล้วคือหนี้แล้ว ถ้านับแต่ใบแจ้งหนี้
 *     ร้านจะซื้อเชื่อได้ไม่จำกัดตลอดช่วงที่ศูนย์ยังไม่ได้ออกใบ ซึ่งเป็นช่วงที่ยาวที่สุดของวงจรพอดี
 *   - **ห้ามบวกทั้งสองทางของบิลเดียวกัน** บิลที่มีใบแจ้งหนี้แล้วให้ยึดใบแจ้งหนี้อย่างเดียว
 *     (ใบแจ้งหนี้รู้เรื่องใบลดหนี้/เพิ่มหนี้/เงินที่รับผ่านบัญชี ซึ่งตัวบิลไม่รู้)
 *   - ใบร่าง (`draft`) และบิลที่ยกเลิกแล้วไม่นับ — ยังไม่มีผลผูกพัน
 *
 * ★★ จับคู่ใบแจ้งหนี้กับบิลด้วย **customer_id ก่อน แล้วค่อย sales_order_id**
 *   เพราะ `sales_order_id` เป็น record_id ของไฟล์ตัวแทน = **เลขซ้ำกันข้ามตัวแทนได้**
 *   (ตัวแทน A กับ B ต่างก็มีบิล id 5) ส่วน customer_id อยู่ในชีตกลาง ไม่ซ้ำทั้งระบบ
 *   จับด้วย sales_order_id ตรงๆ เมื่อไหร่ หนี้ของตัวแทนหนึ่งจะไปหักบิลของอีกตัวแทนเงียบๆ
 *
 * ★ ช่องว่างที่ต้องรู้: `receiveArPayment` เขียนเงินที่รับเข้า `ar_invoices` อย่างเดียว
 *   **ไม่ได้เขียนกลับไปที่บิลขาย** ดังนั้นบิลที่ยังไม่ออกใบแจ้งหนี้แต่เก็บเงินไปแล้ว
 *   ต้องกด "รับชำระ" ที่ตัวบิลด้วย ไม่งั้นยอดค้างจะค้างอยู่อย่างนั้น
 *
 * ★★★ ด่านกันเปิดบิล **ปิดไว้เป็นค่าเริ่มต้น** (`mode = 'off'`) — หลักเดียวกับสวิตช์ทางบัญชี
 *   เปิดให้เองตอน deploy = เช้าวันถัดมาพนักงานเปิดบิลไม่ได้ทั้งศูนย์โดยไม่มีใครสั่ง
 *   และวงเงินที่กรอกไว้แต่เดิมส่วนใหญ่ยังไม่เคยมีใครตรวจสอบว่าถูกต้อง
 */

var CREDIT_MODES = {
  off:   { label: 'ไม่ตรวจ', desc: 'ระบบแสดงหนี้ค้างให้ดูอย่างเดียว ไม่กั้นการเปิดบิล (ค่าเริ่มต้น)' },
  warn:  { label: 'เตือนแต่ขายได้', desc: 'เกินวงเงินแล้วยังเปิดบิลได้ แต่ขึ้นคำเตือนให้พนักงานและบันทึกไว้ในใบ' },
  block: { label: 'เกินวงเงินแล้วเปิดบิลเชื่อไม่ได้', desc: 'ปฏิเสธการเปิดบิลเชื่อทันที — ขายเงินสดยังได้ตามปกติ' }
};

/** ขอบเขตของค่าตั้ง = ตัวแทนที่กำลังขายอยู่ (ไม่ใช่สมุดบัญชี — คนละมิติกัน ดู blueprint แผ่น 03) */
function _creditScope(session, payload) {
  var t = _effectiveTenantId(session, payload || {});
  return t ? String(t) : '';
}

/** ค่าตั้งของขอบเขตหนึ่ง — ไม่มีแถว = ปิดอยู่ */
function _creditSettings(scope) {
  scope = String(scope || '');
  var row = null;
  centralObjects('credit_settings').forEach(function(r) {
    if (String(r.tenant_id || '') === scope) row = r;
  });
  return {
    recordId: row ? row.record_id : '',
    mode: row && CREDIT_MODES[String(row.mode)] ? String(row.mode) : 'off',
    /* ค้างเกินกำหนดกี่วันจึงถือว่า "เลยกำหนด" และกั้น — 0 = ไม่ตรวจเรื่องวันครบกำหนดเลย
       แยกจากวงเงินโดยตั้งใจ: ร้านที่ยังไม่เต็มวงเงินแต่ค้างมา 90 วันคือปัญหาคนละเรื่องกัน */
    overdueDays: row ? (parseInt(row.overdue_days, 10) || 0) : 0,
    updatedAt: row ? safeDateStr(row.updated_at) : '',
    updatedBy: row ? (row.updated_by || '') : ''
  };
}

function getCreditSettings(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  var scope = _creditScope(session, payload);
  return { success: true, scope: scope, settings: _creditSettings(scope),
    modes: Object.keys(CREDIT_MODES).map(function(k) {
      return { code: k, label: CREDIT_MODES[k].label, desc: CREDIT_MODES[k].desc }; }),
    /* บอกกติกาที่หน้าจอต้องอธิบายให้ผู้ใช้ — เขียนที่เดียว ไม่ต้องซ้ำในหน้าเว็บ */
    notes: [
      'วงเงิน 0 = ไม่กำหนดวงเงิน (ไม่ถูกกั้น) — ตั้งวงเงินรายร้านที่ทะเบียนลูกค้า',
      'การขายเงินสดไม่ถูกกั้นไม่ว่าตั้งค่าแบบไหน',
      'ร้านที่ถูกระงับเครดิต (สถานะ blocked) ขายเชื่อไม่ได้อยู่แล้ว เป็นคนละด่านกับวงเงิน'
    ] };
}

function saveCreditSettings(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var scope = _creditScope(session, payload);
  var mode = String(payload.mode || 'off');
  if (!CREDIT_MODES[mode]) return { success: false, message: 'รูปแบบการคุมวงเงินไม่ถูกต้อง' };
  var days = parseInt(payload.overdueDays, 10) || 0;
  if (days < 0 || days > 3650) return { success: false, message: 'จำนวนวันเลยกำหนดต้องอยู่ระหว่าง 0-3650' };

  var cur = _creditSettings(scope);
  var fields = { tenant_id: scope, mode: mode, overdue_days: days,
    updated_at: nowStr(), updated_by: session.adminUserId || '' };
  if (cur.recordId) centralUpdate('credit_settings', cur.recordId, fields);
  else {
    fields.record_id = centralNextId('credit_settings');
    centralAppend('credit_settings', fields);
  }
  return { success: true, settings: _creditSettings(scope),
    message: 'บันทึกการคุมวงเงินเครดิตแล้ว: ' + CREDIT_MODES[mode].label };
}

/* ── หนี้ค้าง ─────────────────────────────────────────────────────────────── */

/**
 * หนี้ค้างของลูกค้าทุกรายของตัวแทนหนึ่ง — อ่านชีตละครั้งเดียวแล้วคิดทั้งก้อน
 * (เรียกทีละรายในลูปจะเปิดไฟล์ตัวแทนซ้ำทุกรอบ ซึ่งแพงกว่าหลายสิบเท่า)
 *
 * คืน map: customerId -> { outstanding, overdue, oldestDueDate, docs, unbilled }
 *   outstanding  ยอดค้างรวม
 *   overdue      ส่วนที่เลยวันครบกำหนดมาแล้ว (ณ วันที่ asOf)
 *   oldestDueDate วันครบกำหนดที่เก่าที่สุดที่ยังค้าง — ใช้บอก "ค้างมากี่วัน"
 *   docs         จำนวนใบที่ยังค้าง
 *   unbilled     ส่วนที่ยังไม่ได้ออกใบแจ้งหนี้ (ไว้อธิบายเวลาตัวเลขไม่ตรงกับฝั่งบัญชี)
 */
function customerOutstandingMap(tenantId, asOf) {
  asOf = asOf || _todayStr();
  var out = {};
  var touch = function(cid) {
    var k = String(cid);
    if (!out[k]) out[k] = { outstanding: 0, overdue: 0, oldestDueDate: '', docs: 0, unbilled: 0 };
    return out[k];
  };
  var add = function(cid, amount, dueDate) {
    if (!(amount > 0.009)) return null;
    var e = touch(cid);
    e.outstanding = _money(e.outstanding + amount);
    e.docs++;
    if (dueDate && dueDate < asOf) {
      e.overdue = _money(e.overdue + amount);
      if (!e.oldestDueDate || dueDate < e.oldestDueDate) e.oldestDueDate = dueDate;
    }
    return e;
  };

  /* ★ map นี้มีลูกค้าของขอบเขตอื่นติดมาด้วย (ใบแจ้งหนี้อยู่ในชีตกลางรวมทุกตัวแทน)
     ไม่ได้กรองทิ้งโดยตั้งใจ — `ar_invoices.tenant_id` เชื่อถือไม่ได้เต็มร้อย (ใบที่กรอกเองจะติดสมุดของคนออกใบ)
     แต่คนเรียกใช้อ่านด้วย customer_id เสมอ และลูกค้าหนึ่งรายสังกัดตัวแทนเดียว จึงไม่มีทางหยิบของคนอื่นไปใช้ */
  /* 1) ใบแจ้งหนี้ — ของจริงฝั่งบัญชี รู้เรื่องใบลดหนี้/เพิ่มหนี้/เงินที่รับแล้วครบ
     เก็บคู่ (ลูกค้า, บิลต้นทาง) ไว้ด้วย เพื่อไม่ให้ขั้นที่ 2 นับบิลเดิมซ้ำ */
  var billedOrders = {};
  centralObjects('ar_invoices').forEach(function(iv) {
    if (String(iv.status) === 'void' || String(iv.status) === 'voided') return;
    if (iv.sales_order_id) billedOrders[String(iv.customer_id) + '#' + String(iv.sales_order_id)] = true;
    add(iv.customer_id, arInvoiceOutstanding(iv), _dOnly(iv.due_date));
  });

  /* 2) บิลขายเชื่อที่ยังไม่มีใบแจ้งหนี้ */
  var custTerms = {};
  centralObjects('customers').forEach(function(c) { custTerms[String(c.record_id)] = customerTermsDays(c, 0); });

  tenantObjectsIfExists(tenantId, 'sales_orders').forEach(function(o) {
    if (!isCreditPayment(o.payment_method)) return;
    var st = _soStatusOf(o);
    if (st === SO_CANCELLED || st === SO_DRAFT || st === SO_REJECTED) return;
    if (billedOrders[String(o.customer_id) + '#' + String(o.record_id)]) return;   // มีใบแจ้งหนี้แล้ว นับไปแล้วข้างบน
    var left = _money((Number(o.total) || 0) - (Number(o.paid_amount) || 0));
    if (!(left > 0.009)) return;
    var e = add(o.customer_id, left, _addDays(_dOnly(o.created_at), custTerms[String(o.customer_id)] || 0));
    if (e) e.unbilled = _money(e.unbilled + left);
  });

  return out;
}

/** หนี้ค้างของร้านเดียว — คิดจาก map ชุดเดียวกัน ไม่มีสูตรที่สอง */
function customerOutstandingOf(tenantId, customerId, asOf) {
  var m = customerOutstandingMap(tenantId, asOf);
  return m[String(customerId)] || { outstanding: 0, overdue: 0, oldestDueDate: '', docs: 0, unbilled: 0 };
}

/**
 * สถานะเครดิตของร้านหนึ่ง เทียบกับวงเงินที่ตั้งไว้
 * entry = ผลจาก customerOutstandingMap (ส่งมาเองได้เพื่อไม่ให้อ่านชีตซ้ำ)
 */
function customerCreditStatus(customer, entry, addAmount) {
  entry = entry || { outstanding: 0, overdue: 0, oldestDueDate: '', docs: 0, unbilled: 0 };
  var limit = Number(customer && customer.credit_limit) || 0;
  var used = _money(entry.outstanding + (Number(addAmount) || 0));
  return {
    limit: limit, outstanding: _money(entry.outstanding), overdue: _money(entry.overdue),
    oldestDueDate: entry.oldestDueDate || '', docs: entry.docs || 0, unbilled: _money(entry.unbilled || 0),
    /* วงเงิน 0 = ไม่กำหนด → ไม่มีคำว่า "เหลือ" และไม่มีทางเกิน */
    available: limit > 0 ? _money(limit - used) : null,
    over: limit > 0 && used > limit + 0.009 ? _money(used - limit) : 0,
    newTotal: used
  };
}

/**
 * ด่านกันเปิดบิลเชื่อ — เรียกจากทั้งแอปมือถือ (`recordSale`) และฝั่งแอดมิน (`recordSaleAdmin`)
 * คืน null = ผ่าน · { success:false } = ไม่ให้ผ่าน · { warning:'…' } = ผ่านแต่มีคำเตือน
 *
 * ★ แก้ใบเดิม (editOrderId) ต้องไม่นับยอดของตัวเองซ้ำ ไม่งั้นแก้บิลเดิมโดยไม่เพิ่มของก็ยังโดนกั้น
 */
function creditSaleGate(tenantId, customer, paymentType, newTotal, opts) {
  opts = opts || {};
  if (!customer) return null;
  if (!isCreditPayment(paymentType)) return null;            // เงินสดไม่เกี่ยวกับวงเงิน
  var set = opts.settings || _creditSettings(tenantId || '');
  if (set.mode === 'off') return null;

  var entry = opts.entry || customerOutstandingOf(tenantId, customer.record_id);
  if (opts.excludeAmount) entry = { outstanding: _money(entry.outstanding - opts.excludeAmount),
    overdue: entry.overdue, oldestDueDate: entry.oldestDueDate, docs: entry.docs, unbilled: entry.unbilled };

  var st = customerCreditStatus(customer, entry, newTotal);
  var name = customerFullName(customer);
  var reasons = [];
  if (st.over > 0) {
    reasons.push('เกินวงเงินเครดิต ' + _baht(st.limit) + ' บาท อยู่ ' + _baht(st.over) + ' บาท' +
      ' (ค้างอยู่ ' + _baht(st.outstanding) + ' + บิลนี้ ' + _baht(newTotal) + ')');
  }
  if (set.overdueDays > 0 && st.oldestDueDate) {
    var days = _daysBetween(st.oldestDueDate, _todayStr());
    if (days >= set.overdueDays) {
      reasons.push('มีหนี้เลยกำหนด ' + days + ' วัน (ตั้งไว้ไม่เกิน ' + set.overdueDays + ' วัน) ยอด ' + _baht(st.overdue) + ' บาท');
    }
  }
  if (!reasons.length) return null;

  var text = name + ': ' + reasons.join(' · ');
  if (set.mode === 'block') {
    return { success: false, message: text + ' — เปิดบิลเชื่อไม่ได้ ขายเงินสดหรือติดต่อศูนย์เพื่อปรับวงเงิน',
      creditBlocked: true, credit: st };
  }
  return { warning: text, credit: st };     // mode = warn
}

/* ── action สำหรับหน้าจอ ──────────────────────────────────────────────────── */

/** เครดิตของร้านเดียว — หน้าลูกค้า/หน้าเปิดบิลเรียกตอนเลือกร้าน */
function getCustomerCredit(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _creditScope(session, payload) || _salesTenantId(session, payload);
  var customer = null;
  centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(payload.customerId)) customer = c; });
  if (!customer) return { success: false, message: 'ไม่พบลูกค้ารายนี้' };

  var entry = customerOutstandingOf(tenantId, customer.record_id);
  return { success: true, settings: _creditSettings(_creditScope(session, payload)),
    customerId: customer.record_id, customerName: customerFullName(customer),
    termsDays: customerTermsDays(customer, 0),
    credit: customerCreditStatus(customer, entry, 0) };
}

/**
 * ตารางหนี้ค้างทั้งตัวแทน — หน้า "วงเงินเครดิตและหนี้ค้าง" (เมนู 1.4.7)
 * ส่งเฉพาะร้านที่ **มีหนี้ค้าง หรือ ตั้งวงเงินไว้** — ส่งทั้ง 2,039 ร้านที่ยอดเป็นศูนย์ไม่มีประโยชน์
 * และทำให้ payload โตฟรีๆ (กติกาข้อ 8 เรื่องส่งข้อมูลชุดเดียว)
 */
function listCustomerCredit(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  payload = payload || {};
  var scope = _creditScope(session, payload);
  var tenantId = scope || _salesTenantId(session, payload);
  var asOf = _validDate(payload.asOf) ? payload.asOf : _todayStr();
  var map = customerOutstandingMap(tenantId, asOf);
  var set = _creditSettings(scope);

  var rows = [];
  centralObjects('customers').forEach(function(c) {
    if (String(c.tenant_id || '') !== String(scope)) return;
    var entry = map[String(c.record_id)];
    var limit = Number(c.credit_limit) || 0;
    if (!entry && !limit) return;
    var st = customerCreditStatus(c, entry, 0);
    rows.push({ id: c.record_id, code: c.customer_code || '', name: customerFullName(c),
      status: String(c.status || '').toLowerCase(), termsDays: customerTermsDays(c, 0),
      limit: st.limit, outstanding: st.outstanding, overdue: st.overdue, unbilled: st.unbilled,
      available: st.available, over: st.over, docs: st.docs, oldestDueDate: st.oldestDueDate,
      overdueDays: st.oldestDueDate ? _daysBetween(st.oldestDueDate, asOf) : 0 });
  });
  rows.sort(function(a, b) { return (b.overdue - a.overdue) || (b.outstanding - a.outstanding); });

  var sum = rows.reduce(function(t, r) {
    t.outstanding = _money(t.outstanding + r.outstanding);
    t.overdue = _money(t.overdue + r.overdue);
    t.over = _money(t.over + r.over);
    return t; }, { outstanding: 0, overdue: 0, over: 0 });

  return { success: true, asOf: asOf, settings: set, rows: rows, totals: sum,
    overLimitCount: rows.filter(function(r) { return r.over > 0; }).length };
}

/* ── ตัวช่วยเล็กๆ ที่ใช้เฉพาะไฟล์นี้ ──────────────────────────────────────── */

function _baht(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* `_daysBetween()` ใช้ของ 23_accounting.gs — อย่านิยามซ้ำ (Apps Script รวมทุกไฟล์เป็น scope เดียว
   ตัวหลังทับตัวหน้าเงียบๆ ซึ่งเป็นบั๊กที่หาไม่เจอจนกว่าจะมีคนแก้ตัวใดตัวหนึ่ง) */
