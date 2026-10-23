/**
 * ===================== ต้นทุนขาย (COGS) =====================
 * ลงบัญชี Dr 5100 ต้นทุนขาย / Cr 1300 สินค้าคงเหลือ ตอนของออกจากคลังเพราะการขาย
 *
 * ★★ ทำไมต้องมี: ก่อนหน้านี้การตัดสต็อกเขียนแค่ `warehouse_stock` + `stock_ledger` ไม่ลงบัญชีเลย
 *   ผลคือ **งบกำไรขาดทุนไม่มีต้นทุนขายสักบาท** (กำไรที่โชว์ ≈ ยอดขายทั้งก้อน) และ
 *   **บัญชี 1300 สินค้าคงเหลือโตขึ้นเรื่อยๆ ไม่เคยลด** — ผิดแบบที่ดูจากหน้าจอไม่ออก
 *   เพราะตัวเลขออกมาสวยกว่าความจริง จะรู้ตอนเอางบไปเทียบของจริงแล้วไม่ตรง
 *
 * ★ ปิดไว้เป็นค่าเริ่มต้น (`cost_method = 'none'`) — เปิดใช้ต้องตั้งใจเลือกเองที่
 *   เมนู 5.9.1 วิธีตัดต้นทุนขาย · ถ้าเปิดให้เองตอน deploy สมุดที่ปิดงวดไปแล้วจะมีใบสำคัญ
 *   งอกขึ้นมาโดยไม่มีใครสั่ง ซึ่งผู้ทำบัญชีจะหาสาเหตุไม่เจอ
 *
 * ★ `cogs_from` = เริ่มตัดตั้งแต่บิลลงวันที่นี้เป็นต้นไป **ไม่ย้อนหลัง** งวดที่ยื่นภาษี/ปิดไปแล้ว
 *   ต้องไม่ขยับ (หลักเดียวกับใบลดหนี้ที่ลงงวดของวันที่ออกใบ ไม่ย้อนไปแก้งวดเดิม)
 *
 * ★★★ ขอบเขตที่ยังไม่ครอบคลุม — **ขายจากรถ (Cash Van) ยังไม่ตัดต้นทุน**
 *   `van_stock` อยู่ในไฟล์ของตัวแทนและ **ไม่เชื่อมกับ `warehouse_stock` เลย** (`restockVan`
 *   ไม่ลดคลังกลาง) ของบนรถจึงไม่มีฐานต้นทุนอยู่ในระบบ จะตัดต้นทุนให้ก็ต้องเดาราคาเอา
 *   และจะไปลดบัญชี 1300 ที่ไม่เคยรับของก้อนนั้นเข้ามา = ผิดซ้ำสองทาง
 *   **แก้ที่ต้นเหตุคือทำให้การเบิกของขึ้นรถเป็นการย้ายคลังจริง** (คลังกลาง → คลังรถ)
 *   ซึ่งเป็นงานคนละชิ้น · ระหว่างนี้หน้าตั้งค่าบอกไว้ชัดเจนว่าครอบคลุมแค่ไหน
 */

var COGS_METHODS = {
  none:     { label: 'ไม่ตัดต้นทุนอัตโนมัติ', desc: 'ระบบไม่ลงบัญชีต้นทุนขายให้ ผู้ทำบัญชีลงเองนอกระบบ (ค่าเริ่มต้น)' },
  average:  { label: 'ต้นทุนเฉลี่ยถ่วงน้ำหนัก', desc: 'ใช้ต้นทุนเฉลี่ยของสินค้าในคลัง ณ วันที่ตัดของ — ระบบคิดให้อยู่แล้วทุกครั้งที่รับของ' },
  fifo:     { label: 'เข้าก่อน-ออกก่อน (FIFO)', desc: 'ไล่ต้นทุนจากล็อตที่รับเข้าก่อน คิดจากประวัติเคลื่อนไหวจริงใน stock_ledger' },
  /* ★ ใช้ `products.cost_price` (ช่อง "ราคาทุน" ที่มีอยู่แล้วในฟอร์มสินค้า) ไม่เพิ่มคอลัมน์ใหม่
     — มันคือความหมายเดียวกันเป๊ะ และก่อนหน้านี้ไม่มีโค้ดไหนคำนวณด้วยเลย เก็บไว้เฉยๆ
     ตั้งคอลัมน์ที่สองที่แปลว่าเหมือนกันเมื่อไหร่ วันหนึ่งจะมีคนกรอกคนละช่องแล้วงงว่าทำไมไม่ตรง */
  standard: { label: 'ต้นทุนมาตรฐาน', desc: 'ใช้ช่อง "ราคาทุน" ที่ตั้งไว้ในทะเบียนสินค้า ไม่ขึ้นกับราคาซื้อจริง' }
};

/** ค่าตั้งทางบัญชีของสมุดหนึ่ง — ไม่มีแถว = ค่าเริ่มต้น (ปิดอยู่) */
function _acctSettings(book) {
  /* ★★ ต้องกรองด้วย `_inBook` ไม่ใช่ `_scoped` — สองตัวนี้เป็นคนละมิติกัน (ดู blueprint แผ่น 03)
     `_scoped` เป็นมิติ "ขอบเขตงานซื้อ/คลัง" ซึ่ง scope ว่างแปลว่า **ไม่กรอง** = เห็นของทุกสมุด
     ส่วน `_inBook` เป็นมิติ "สมุดบัญชี" ซึ่งค่าว่างแปลว่า **สมุดบริษัท** เท่านั้น
     ใช้ผิดตัวแล้วค่าตั้งของตัวแทนรั่วมาเป็นค่าตั้งของบริษัท (เทสต์จับได้ 16 ต.ค. 2026) */
  var row = null;
  centralObjects('accounting_settings').forEach(function(r) { if (_inBook(r, book)) row = r; });
  return {
    recordId: row ? row.record_id : '',
    costMethod: row && COGS_METHODS[String(row.cost_method)] ? String(row.cost_method) : 'none',
    cogsFrom: row ? _dOnly(row.cogs_from) : '',
    /* ★★ ลงบัญชีขายสด (52_cash_sales_gl.gs) — **เปิดเป็นค่าเริ่มต้น** (เจ้าของระบบสั่ง 23 ต.ค. 2026
       "ระบบควรลงบัญชีอัตโนมัติ") · มีแต่การตั้งเป็น `'off'` ชัดเจนเท่านั้นที่ปิด
       ★ เดิมปิดไว้เพราะกลัวนับซ้ำกับที่ผู้ทำบัญชีลงมือไว้นอกระบบ — ความกลัวนั้นใช้กับ **การลงย้อนหลัง**
         ซึ่งไม่เคยมีในโค้ดนี้: `postCashSaleGl` ถูกเรียก ณ จังหวะที่ออกใบกำกับเท่านั้น ไม่มีตัวไล่ลงให้บิลเก่า
         บิลที่ออกใบไปก่อนหน้านี้จึงไม่ถูกแตะ เว้นแต่จะสั่ง `backfillCashSaleGl` เอง
       ★ ของที่ยังปิดไว้เป็นค่าเริ่มต้นคือ **ต้นทุนขาย** กับ **เบิกของขึ้นรถ** ซึ่งคนละเรื่องกัน */
    cashSales: row && String(row.cash_sales) === 'off' ? 'off' : 'on',
    cashFrom: row ? _dOnly(row.cash_from) : '',
    /* เบิกของขึ้นรถ = ตัดจากคลังกลางจริง (55_van_stock_link.gs) — เปิดแล้วการขายจากรถตัดต้นทุนได้
       ★ ปิดไว้เป็นค่าเริ่มต้นเพราะเปิดแล้ว **เบิกของไม่ได้ถ้าคลังกลางมีของไม่พอ** */
    vanIssue: row && String(row.van_issue) === 'on' ? 'on' : 'off',
    updatedAt: row ? safeDateStr(row.updated_at) : '',
    updatedBy: row ? (row.updated_by || '') : ''
  };
}

function getAccountingSettings(session, payload) {
  var err = _requirePermission(session, 'accounting', 'view'); if (err) return err;
  var book = _bookScope(session, payload || {});
  var s = _acctSettings(book);
  return { success: true, settings: s, book: book || '',
    methods: Object.keys(COGS_METHODS).map(function(k) {
      return { code: k, label: COGS_METHODS[k].label, desc: COGS_METHODS[k].desc };
    }),
    /* บอกไปด้วยว่าครอบคลุมแค่ไหน — หน้าจอเอาไปแสดงตรงๆ ไม่ต้องเขียนข้อความซ้ำสองที่ */
    cashSalesNote: 'ลง Dr เงินสด/ธนาคาร / Cr รายได้ + Cr ภาษีขาย ตอนออกใบกำกับภาษีของบิลขายสด' +
      ' — บิลเครดิตลงผ่านใบแจ้งหนี้ลูกหนี้อยู่แล้ว ไม่เกี่ยวกับช่องนี้',
    /* ★ ขอบเขตไม่ใช่ค่าตายตัวอีกแล้ว — ขายจากรถตัดต้นทุนได้เมื่อเปิดการเชื่อมสต็อกรถกับคลังกลาง */
    coverage: { warehouse: true, van: s.vanIssue === 'on',
      note: s.vanIssue === 'on'
        ? 'ตัดต้นทุนทั้งการขายที่ส่งจากคลังและการขายจากรถ — ของบนรถพกต้นทุนมาตั้งแต่ตอนเบิก'
        : 'ตัดต้นทุนเฉพาะการขายที่ตัดของจากคลัง (สำนักงานจัดส่ง) · ขายจากรถยังไม่ตัด ' +
          'เพราะสต็อกบนรถยังไม่ได้เชื่อมกับคลังกลาง จึงไม่มีฐานต้นทุนให้คิด' } };
}

function saveAccountingSettings(session, payload) {
  var err = _requirePermission(session, 'accounting', 'edit'); if (err) return err;
  payload = payload || {};
  var book = _bookScope(session, payload);
  var method = String(payload.costMethod || 'none');
  if (!COGS_METHODS[method]) return { success: false, message: 'วิธีคิดต้นทุนไม่ถูกต้อง' };

  var from = String(payload.cogsFrom || '').trim();
  if (method !== 'none') {
    if (!from) return { success: false, message: 'ต้องระบุวันที่เริ่มตัดต้นทุน' };
    if (!_validDate(from)) return { success: false, message: 'วันที่เริ่มตัดต้นทุนต้องเป็น yyyy-MM-dd' };
  }

  /* ★ ค่าเริ่มต้นของช่องนี้คือ 'on' แล้ว (ดู _acctSettings) — ต้องส่ง 'off' มาชัดเจนถึงจะปิด
     ★ **ไม่บังคับวันที่เริ่มอีกแล้ว** ว่าง = ลงให้ทุกใบที่ออกใบกำกับตั้งแต่นี้ไป ซึ่งเป็นพฤติกรรมจริง
       ของโค้ดอยู่แล้ว (ไม่มีการลงย้อนหลัง) · ใส่วันที่ได้ถ้าอยากกันบิลที่ลงวันที่ย้อนหลัง */
  var cash = String(payload.cashSales || 'on') === 'off' ? 'off' : 'on';
  var cashFrom = String(payload.cashFrom || '').trim();
  if (cash === 'on' && cashFrom && !_validDate(cashFrom))
    return { success: false, message: 'วันที่เริ่มลงบัญชีขายสดต้องเป็น yyyy-MM-dd' };

  var vanIssue = String(payload.vanIssue || 'off') === 'on' ? 'on' : 'off';

  var cur = _acctSettings(book);
  var row = { tenant_id: book || '', cost_method: method, cogs_from: method === 'none' ? '' : from,
    cash_sales: cash, cash_from: cash === 'on' ? cashFrom : '', van_issue: vanIssue,
    updated_at: nowStr(), updated_by: session.adminUserId };
  if (cur.recordId) centralUpdate('accounting_settings', cur.recordId, row);
  else { row.record_id = centralNextId('accounting_settings'); centralAppend('accounting_settings', row); }

  var msg = [method === 'none' ? 'ปิดการตัดต้นทุนอัตโนมัติ'
      : 'ต้นทุน: ' + COGS_METHODS[method].label + ' เริ่ม ' + from,
    cash === 'on' ? ('ลงบัญชีขายสด' + (cashFrom ? ' เริ่ม ' + cashFrom : ' ทุกใบตั้งแต่นี้ไป')) : 'ไม่ลงบัญชีขายสด',
    vanIssue === 'on' ? 'เบิกของขึ้นรถตัดจากคลังกลาง' : 'เบิกของขึ้นรถไม่ตัดคลังกลาง'].join(' · ');
  return { success: true, settings: _acctSettings(book), message: 'บันทึกแล้ว — ' + msg };
}

/* ═══════════ คิดต้นทุนต่อหน่วย ═══════════
   ★ ทั้งสามวิธีคืน "ต้นทุนรวมของจำนวนที่ขาย" ไม่ใช่ต้นทุนต่อหน่วย เพราะ FIFO กินหลายล็อต
     ที่ราคาต่างกัน การคืนค่าเฉลี่ยแล้วให้ผู้เรียกคูณเองจะปัดเศษเพี้ยน */
function _cogsAmount(scope, warehouseId, productId, baseQty, method, avgCost) {
  if (!(baseQty > 0)) return 0;
  if (method === 'standard') {
    var p = _findById('products', productId) || {};
    return _money((Number(p.cost_price) || 0) * baseQty);
  }
  if (method === 'fifo') return _fifoCost(scope, warehouseId, productId, baseQty);
  return _money((Number(avgCost) || 0) * baseQty);          // average
}

/* FIFO จากประวัติจริงใน stock_ledger — ไม่เก็บตาราง "ล็อตคงเหลือ" แยกต่างหาก
   ★ เหตุผล: ตารางล็อตที่เก็บแยกจะเพี้ยนทันทีที่มีใครแก้สต็อกด้วยวิธีอื่น (ปรับยอด/นับสต็อก/
     ย้ายคลัง) แล้วไม่มีอะไรฟ้อง · ledger เป็นบันทึกเดียวที่ทุกเส้นทางเขียนลงอยู่แล้ว
   ★ แลกด้วยความเร็ว: ต้องอ่าน ledger ของสินค้านั้นทั้งหมด — ยอมรับได้เพราะจุดนี้ทำงาน
     ตอนกด "พร้อมจัดส่ง" ซึ่งเป็นจังหวะที่คนรออยู่แล้วและเกิดไม่บ่อยเท่าการอ่านรายการ */
function _fifoCost(scope, warehouseId, productId, wantQty) {
  var moves = [];
  _scoped('stock_ledger', scope).forEach(function(r) {
    if (String(r.warehouse_id) !== String(warehouseId)) return;
    if (String(r.product_id) !== String(productId)) return;
    moves.push({ id: Number(r.record_id) || 0, qty: Number(r.change_qty) || 0, cost: Number(r.unit_cost) || 0 });
  });
  moves.sort(function(a, b) { return a.id - b.id; });       // เรียงตามลำดับที่เกิดจริง

  // สร้างกองล็อตจากของเข้า แล้วให้ของออกในอดีตกินไปก่อน — เหลือเท่าไรคือล็อตที่ยังอยู่
  var layers = [];
  moves.forEach(function(m) {
    if (m.qty > 0) { layers.push({ qty: m.qty, cost: m.cost }); return; }
    var out = -m.qty;
    while (out > 0 && layers.length) {
      var take = Math.min(out, layers[0].qty);
      layers[0].qty -= take; out -= take;
      if (layers[0].qty <= 0.0000001) layers.shift();
    }
  });

  var left = wantQty, total = 0, lastCost = 0;
  for (var i = 0; i < layers.length && left > 0; i++) {
    var t = Math.min(left, layers[i].qty);
    total += t * layers[i].cost; left -= t; lastCost = layers[i].cost;
  }
  /* ★ ของที่จะตัดมากกว่าล็อตที่เหลือในบันทึก (ของเข้ามาก่อนระบบเริ่มเก็บ ledger หรือมีคน
     ปรับยอดโดยไม่ผ่าน _applyStockIn) — ใช้ราคาล็อตสุดท้ายเติมให้ครบ ดีกว่าลงบัญชีขาด
     แล้วงบไม่ลงตัวโดยไม่มีใครรู้ว่าหายไปตรงไหน */
  if (left > 0) total += left * lastCost;
  return _money(total);
}

/* ═══════════ ลงบัญชีต้นทุนขาย ═══════════
   `roundNo` ทำให้บิลที่แยกรอบจัดส่งลงต้นทุนแยกรอบ และกันลงซ้ำรอบเดิมได้ด้วยคีย์เดียวกัน */
function _cogsRefId(order, roundNo) {
  return String(order.record_id) + (roundNo ? ('#' + roundNo) : '');
}

/** มีใบสำคัญต้นทุนของ (บิล, รอบ) นี้อยู่แล้วหรือยัง — คืนใบที่เจอ */
function _findCogsJournal(book, refId) {
  var found = null;
  centralObjects('gl_journals').forEach(function(j) {
    if (String(j.ref_type) !== 'SALES_COGS') return;
    if (String(j.ref_id) !== String(refId)) return;
    if (!_inBook(j, book)) return;
    if (String(j.status) === 'voided') return;
    found = j;
  });
  return found;
}

/**
 * คิดต้นทุนของรอบนี้ — **ต้องเรียกก่อน `_applyStockIn` ตัดของออก**
 * ★★ FIFO ไล่ล็อตจาก `stock_ledger` ซึ่ง `_applyStockIn` เขียนแถวของการขายรอบนี้ลงไปด้วย
 *   เรียกทีหลังจะได้ล็อตที่ "ถูกกินไปแล้ว" แล้วไปหยิบล็อตถัดไปซึ่งแพงกว่า
 *   (เทสต์จับได้ 16 ต.ค. 2026: ขาย 15 ชิ้นจาก 10@10 + 10@30 ได้ 450 แทนที่จะเป็น 250)
 *   ของสองวิธีที่เหลือไม่สนลำดับ แต่เรียกจุดเดียวกันหมดจะได้ไม่ต้องจำว่าวิธีไหนเรียกตอนไหน
 * @return { method, amount, skipped }  — `amount` null = ไม่ต้องลง
 */
function prepareSaleCogs(scope, warehouseId, order, need, cost) {
  try {
    var book = _cogsBook(scope);
    var st = _acctSettings(book);
    if (st.costMethod === 'none') return { amount: null, skipped: 'ปิดการตัดต้นทุนอัตโนมัติ' };

    var when = _dOnly(order.created_at) || _todayStr();
    if (st.cogsFrom && when < st.cogsFrom) return { amount: null, skipped: 'บิลลงวันที่ก่อนวันเริ่มตัดต้นทุน' };
    if (_findCogsJournal(book, _cogsRefId(order, order.ship_round_no)))
      return { amount: null, skipped: 'ลงต้นทุนของรอบนี้ไปแล้ว' };

    var total = 0;
    Object.keys(need || {}).forEach(function(pid) {
      var amt = _cogsAmount(scope, warehouseId, pid, need[pid], st.costMethod, (cost || {})[pid]);
      if (amt > 0) total += amt;
    });
    return { method: st.costMethod, amount: _money(total) };
  } catch (e) {
    Logger.log('prepareSaleCogs ล้มเหลว: ' + (e.stack || e.message));
    return { amount: null, skipped: 'ผิดพลาด: ' + e.message };
  }
}

/**
 * ลงบัญชีต้นทุนขายจากยอดที่ `prepareSaleCogs` คิดไว้ก่อนตัดของ
 * @return { posted, amount, skipped } — ไม่โยน error ออกไป การลงบัญชีล้มไม่ควรทำให้ของที่ตัดไปแล้วย้อนกลับ
 */
function postSaleCogs(scope, order, prepared, userId) {
  try {
    prepared = prepared || {};
    if (prepared.amount === null || prepared.amount === undefined)
      return { posted: false, skipped: prepared.skipped || 'ไม่มียอดต้นทุนให้ลง' };

    var book = _cogsBook(scope);
    var when = _dOnly(order.created_at) || _todayStr();
    var refId = _cogsRefId(order, order.ship_round_no);
    var st = { costMethod: prepared.method };
    var total = _money(prepared.amount), lines;
    /* ต้นทุน 0 = สินค้ายังไม่เคยมีราคาทุน (เพิ่งเริ่มใช้ระบบ / รับเข้าโดยไม่ใส่ราคา)
       ไม่ออกใบสำคัญเปล่าที่เดบิต=เครดิต=0 ให้รกสมุด แต่บอกเหตุผลไว้ให้ไล่ย้อนได้ */
    if (!(total > 0)) return { posted: false, skipped: 'ต้นทุนรวมเป็น 0 — สินค้ายังไม่มีราคาทุนในระบบ' };

    lines = [
      { accountCode: GL_ACCT.COGS, description: 'ต้นทุนขาย ' + (order.order_code || ''), debit: total, credit: 0 },
      { accountCode: GL_ACCT.INVENTORY, description: 'ตัดสินค้าคงเหลือ ' + (order.order_code || ''), debit: 0, credit: total }
    ];
    var jr = _postJournal({ date: when, source: 'SALES', refType: 'SALES_COGS', refId: refId, tenantId: book,
      memo: 'ต้นทุนขาย ' + (order.order_code || '') + (order.ship_round_no ? ' รอบที่ ' + order.ship_round_no : '') +
            ' (' + COGS_METHODS[st.costMethod].label + ')',
      createdBy: userId, lines: lines });
    if (!jr.success) return { posted: false, skipped: jr.message || 'ลงบัญชีไม่สำเร็จ' };
    return { posted: true, amount: total, journalNo: jr.journalNo, method: st.costMethod };
  } catch (e) {
    Logger.log('postSaleCogs ล้มเหลว: ' + (e.stack || e.message));
    return { posted: false, skipped: 'ผิดพลาด: ' + e.message };
  }
}

/**
 * กลับรายการต้นทุนขาย (ยกเลิกบิล / ถอยสถานะจนของกลับเข้าคลัง)
 * ★★ ต้องกลับด้วย **ยอดเดิมที่เคยลงไว้** ไม่ใช่คิดต้นทุนใหม่ ณ ตอนนี้ — ต้นทุนเฉลี่ยขยับทุกครั้ง
 *   ที่รับของเข้า ถ้าคิดใหม่ ขาไปกับขากลับจะไม่หักล้างกัน แล้วเหลือเศษค้างในบัญชี 1300/5100
 *   ตลอดไปโดยไม่มีใครเห็น (หลักเดียวกับ "ยกเลิกใบสำคัญ = ออกใบกลับรายการ" ของทั้งระบบ)
 */
function reverseSaleCogs(scope, order, userId, reason) {
  try {
    var book = _cogsBook(scope);
    var refId = _cogsRefId(order, order.ship_round_no);
    var j = _findCogsJournal(book, refId);
    if (!j) return { posted: false, skipped: 'ไม่เคยลงต้นทุนของรอบนี้' };

    var total = Number(j.total_debit) || 0;
    if (!(total > 0)) return { posted: false, skipped: 'ใบเดิมยอดเป็น 0' };

    var jr = _postJournal({ date: _todayStr(), source: 'SALES', refType: 'SALES_COGS_REV', refId: refId, tenantId: book,
      memo: 'กลับรายการต้นทุนขาย ' + (order.order_code || '') + (reason ? ' — ' + reason : ''),
      createdBy: userId, lines: [
        { accountCode: GL_ACCT.INVENTORY, description: 'รับสินค้ากลับเข้าคลัง ' + (order.order_code || ''), debit: total, credit: 0 },
        { accountCode: GL_ACCT.COGS, description: 'กลับต้นทุนขาย ' + (order.order_code || ''), debit: 0, credit: total }
      ] });
    if (!jr.success) return { posted: false, skipped: jr.message || 'ลงบัญชีไม่สำเร็จ' };
    // ใบเดิมถูกทำเครื่องหมายว่ากลับรายการแล้ว เพื่อไม่ให้ _findCogsJournal เจออีกถ้าตัดของใหม่รอบหน้า
    centralUpdate('gl_journals', j.record_id, { status: 'voided' });
    return { posted: true, amount: total, journalNo: jr.journalNo };
  } catch (e) {
    Logger.log('reverseSaleCogs ล้มเหลว: ' + (e.stack || e.message));
    return { posted: false, skipped: 'ผิดพลาด: ' + e.message };
  }
}

/* สมุดที่ใบสำคัญต้นทุนจะไปลง — ใช้กติกาเดียวกับทั้งโมดูลบัญชี (ตัวแทนบ้าน = สมุดบริษัท)
   ★ ไม่เรียก _bookScope เพราะที่นี่ไม่มี session (ถูกเรียกจากกลางเส้นทางตัดสต็อก) */
function _cogsBook(scope) {
  var s = String(scope || '');
  return (!s || s === HOUSE_TENANT_ID) ? '' : s;
}
