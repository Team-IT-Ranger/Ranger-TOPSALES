/**
 * ===================== รายงานการขาย (เมนู 1.8.1 / 1.8.2 / 1.8.3) =====================
 * ทั้งสามรายงานอ่านจากไฟล์ของ "ตัวแทนรายเดียว" เท่านั้น (_salesTenantId) — ห้ามวนเปิดไฟล์ทุกตัวแทน
 * แดชบอร์ดเคยทำแบบนั้นแล้ววัดได้ 16-18 วินาที (7 ตัวแทน) โตเป็นเส้นตรงตามจำนวนตัวแทน จึงย้ายไปใช้ sales_daily
 * แทน (ดู 31_sales_rollup.gs) — ถ้าจะทำสรุปข้ามตัวแทนของสามรายงานนี้ในอนาคต ต้องต่อยอดจากแนวทางเดียวกัน
 * ไม่ใช่วนเปิดทุกไฟล์ตรงๆ แบบนี้
 *
 * ไม่นับบิลที่ถูกยกเลิก (status='cancelled') ในทุกรายงาน — ยอดขายต้องเป็นยอดที่ยังยืนอยู่จริง ณ วันนี้
 */

/**
 * บิลที่ "ออกใบแจ้งหนี้หรือใบกำกับภาษีแล้ว" — นิยามของคำว่า **ยอดขาย** ที่เจ้าของระบบสั่ง 17 ต.ค. 2026
 *
 * ★★ ทำไมไม่ใช่สถานะการส่งของ: ศูนย์ไม่ได้กดสถานะไปถึง "จัดส่งสำเร็จ" ทุกใบ ยอดขายจึงขึ้นศูนย์
 *   ทั้งที่ขายไปแล้วจริง · **เอกสารที่ออกไปแล้วเป็นหลักฐานที่ตรงกว่า** และเป็นตัวเดียวกับที่ใช้ยื่นภาษี
 *
 * ★ ใบหนึ่งถือว่าออกเอกสารแล้วเมื่อเข้าข้อใดข้อหนึ่ง (ทั้งสามทางเกิดขึ้นจริงในระบบนี้):
 *   1. `sales_orders.tax_invoice_no` มีเลข — ขายสดจากรถออกใบกำกับภาษีตั้งแต่กดบันทึก (07_sales.gs)
 *   2. มีแถวใน `ar_invoices` ที่อ้างบิลนี้และยังไม่ถูกยกเลิก — บิลเครดิตตั้งลูกหนี้ตอนเข้าขั้น "พร้อมจัดส่ง"
 *   3. มีรอบจัดส่งของบิลนี้ที่ออกใบแล้ว (`delivery_rounds.tax_invoice_no` / `ar_invoice_no`)
 *      — ใบที่แยกส่งหลายรอบออกใบตามรอบ ตัวบิลแม่จะไม่มีเลขใบกำกับของตัวเอง (15 ต.ค. 2026)
 *      **ข้อนี้ลืมไม่ได้** ไม่งั้นบิลที่แยกรอบจะหายจากยอดขายทั้งที่ออกใบไปแล้ว
 *
 * ★★ คีย์ของ ar_invoices ต้องเป็น `customer_id + '#' + sales_order_id` — `sales_order_id`
 *   เป็น record_id ของไฟล์ตัวแทน **ซ้ำกันข้ามตัวแทนได้** (หลักเดียวกับ 56_customer_credit.gs)
 */
function _invoicedOrderSet(tenantId) {
  var byOrder = {};                       // key: customer#order (ใบแจ้งหนี้) / 'r#' + orderId (รอบ)
  centralObjects('ar_invoices').forEach(function(iv) {
    var st = String(iv.status || '');
    if (st === 'void' || st === 'voided') return;
    if (iv.sales_order_id) byOrder[String(iv.customer_id) + '#' + String(iv.sales_order_id)] = true;
  });
  tenantObjectsIfExists(tenantId, 'delivery_rounds').forEach(function(rd) {
    if (String(rd.tax_invoice_no || '').trim() || String(rd.ar_invoice_no || '').trim()) {
      byOrder['r#' + String(rd.order_id)] = true;
    }
  });
  return byOrder;
}
function _orderIsInvoiced(o, set) {
  if (String(o.tax_invoice_no || '').trim()) return true;
  if (set[String(o.customer_id) + '#' + String(o.record_id)]) return true;
  return !!set['r#' + String(o.record_id)];
}

/**
 * บิลที่เข้ารายงาน — ตัวกรองกลางของทุกรายงานในไฟล์นี้
 * opts: { statuses:[..], saleBy, customerId, invoiced:'yes'|'no' }  (ไม่ส่งมา = ไม่กรองชั้นนั้น)
 *
 * ★ `statuses` มีไว้เพราะคำถาม "ยอดขายเดือนนี้เท่าไหร่" กับ "มีบิลเดินอยู่เท่าไหร่" เป็นคนละคำถาม
 *   เจ้าของระบบนับ **เฉพาะใบที่จัดส่งสำเร็จ** เป็นยอดขาย (17 ต.ค. 2026) — ใบที่ยังไม่ถึงปลายทาง
 *   ยังไม่ใช่ยอดขายที่เกิดขึ้นจริง · ไม่ส่ง statuses มา = เหมือนเดิมทุกประการ (ทุกใบที่ไม่ถูกยกเลิก)
 * ★ ยกเลิกแล้วไม่นับเสมอ ไม่ว่าจะส่ง statuses อะไรมา — กันคนเผลอขอ ['cancelled'] แล้วได้ยอดขายปลอม
 */
function _salesReportOrders(tenantId, dateFrom, dateTo, opts) {
  opts = opts || {};
  var only = null;
  if (opts.statuses && opts.statuses.length) {
    only = {};
    opts.statuses.forEach(function(st) {
      var k = String(st || '').toLowerCase();
      if (k && k !== 'cancelled') only[k] = true;
    });
    /* ★★ ขอมาแล้วไม่เหลือสถานะที่ใช้ได้เลย (เช่นขอ ['cancelled'] ล้วน) = **ต้องไม่คืนอะไรเลย**
       ห้ามตกกลับไปเป็น "ไม่กรอง" ซึ่งจะคืนยอดขายทั้งเดือนให้คนที่ขอดูบิลที่ยกเลิก
       (เทสต์จับได้ตอนเขียนครั้งแรก 17 ต.ค. 2026 — คืนมา 5 ใบ 4,400 แทนที่จะเป็นศูนย์) */
    if (!Object.keys(only).length) only = { '\u0000none': true };
  }
  var saleBy = opts.saleBy === undefined || opts.saleBy === null ? '' : String(opts.saleBy);
  var custId = opts.customerId === undefined || opts.customerId === null ? '' : String(opts.customerId);
  var inv = String(opts.invoiced || '');
  var invSet = inv ? _invoicedOrderSet(tenantId) : null;   // อ่านชีตเพิ่มเฉพาะตอนที่ถามถึงจริงๆ
  return tenantObjects(tenantId, 'sales_orders').filter(function(o) {
    var st = String(o.status || '').toLowerCase();
    if (st === 'cancelled') return false;
    /* บิลเก่าที่ยังเป็น pending_delivery คือ confirmed ตัวเดียวกัน (soStatusKey ฝั่งหน้าเว็บ)
       ถ้าไม่แปลงตรงนี้ คนกรอง "รออนุมัติ" จะไม่เห็นบิลเก่าเลยโดยไม่มีอะไรบอก */
    if (st === 'pending_delivery') st = 'confirmed';
    if (only && !only[st]) return false;
    if (saleBy && String(o.sale_by || '') !== saleBy) return false;
    if (custId && String(o.customer_id || '') !== custId) return false;
    if (inv) {
      var isInv = _orderIsInvoiced(o, invSet);
      if (inv === 'yes' && !isInv) return false;
      if (inv === 'no' && isInv) return false;
    }
    var d = _dOnly(o.created_at);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}

/** อ่านตัวกรองจาก payload ให้เป็นรูปเดียวกันทุก action */
function _salesReportOpts(payload) {
  var st = payload.statuses;
  if (typeof st === 'string') st = st ? [st] : null;
  return { statuses: st && st.length ? st : null,
    saleBy: payload.saleBy || '', customerId: payload.customerId || '',
    invoiced: payload.invoiced === 'yes' || payload.invoiced === 'no' ? payload.invoiced : '' };
}

/* ดัชนีชื่อคนขาย — ทำครั้งเดียวต่อคำขอแล้วใช้ซ้ำ
   ★ เดิม `_saleByLabel` ไล่ forEach ทั้งตาราง liff_users/admin_users ใหม่ทุกครั้งที่เรียก ซึ่งไม่เป็นไร
   ตอนใช้ในรายงาน (เรียกต่อ "พนักงาน") แต่พอเอามาใช้ในรายการบิลขายซึ่งเรียกต่อ "บิล" จะกลายเป็น
   O(จำนวนบิล × จำนวนพนักงาน) — บิล 300 ใบ × พนักงาน 100 คน = 30,000 รอบต่อการเปิดหน้าหนึ่งครั้ง
   (centralObjects แคชตัวข้อมูลให้แล้ว แต่ไม่ได้แคชการไล่หา) */
/* ★★ 15 ต.ค. 2026 — แคช **แผนที่ชื่อ** ไว้ 5 นาที (ไม่ใช่ตัวตาราง liff_users/admin_users)
   กติกา "ห้ามแคช liff_users/admin_users" มีไว้เพราะ **สถานะและสิทธิ์** ต้องสดเสมอ — ถ้าแคชแล้วคนที่เพิ่ง
   ถูกระงับจะยังใช้งานได้ต่อ · แต่สิ่งที่เก็บตรงนี้คือ "id → ชื่อที่แสดง" ล้วนๆ ไม่มีการตัดสินใจอะไรอิงมัน
   อย่างแย่ที่สุดคือคนเพิ่งเปลี่ยนชื่อแล้วรายการบิลยังขึ้นชื่อเดิมไม่เกิน 5 นาที
   ★ ที่ต้องแคชเพราะสองตารางนี้ **ไม่อยู่ใน SHEET_CACHE_TABLES** จึงอ่านชีตจริงทุกคำขอ (วัดได้ ~0.8 วิ
     ของเวลาเปิดหน้ารายการบิลขาย) ทั้งที่รายการบิลต้องการแค่ชื่อคนขาย */
var _saleByIdxMemo = null;
var SALEBY_CACHE_KEY = 'salebyidx_v1', SALEBY_CACHE_TTL = 300;
function _saleByIndex() {
  if (_saleByIdxMemo) return _saleByIdxMemo;
  try {
    var hit = CacheService.getScriptCache().get(SALEBY_CACHE_KEY);
    if (hit) { _saleByIdxMemo = JSON.parse(hit); return _saleByIdxMemo; }
  } catch (e) {}
  var idx = { liff: {}, admin: {} };
  centralObjects('liff_users').forEach(function(u) { idx.liff[String(u.line_user_id)] = u.display_name || ''; });
  centralObjects('admin_users').forEach(function(u) { idx.admin[String(u.username)] = u.display_name || ''; });
  _saleByIdxMemo = idx;
  try { CacheService.getScriptCache().put(SALEBY_CACHE_KEY, JSON.stringify(idx), SALEBY_CACHE_TTL); } catch (e) {}
  return idx;
}

// ป้ายชื่อของ "ใครขาย" — sale_by เป็น LINE user id ของพนักงานขับรถ หรือ 'admin:<username>' ถ้าเปิดจากแอดมิน (19_sales_admin.gs)
function _saleByLabel(saleBy) {
  var s = String(saleBy || '');
  if (!s) return '(ไม่ระบุ)';
  var idx = _saleByIndex();
  if (s.indexOf('admin:') === 0) {
    var uname = s.substring(6);
    return '[แอดมิน] ' + (idx.admin[uname] || uname);
  }
  // ไม่เจอในทะเบียนพนักงาน (ลาออกแล้ว/ข้อมูลเก่า) = คืน id ดิบไว้ ดีกว่าโชว์ว่าง แล้วตามตัวไม่ได้
  return idx.liff[s] || s;
}

function _validateReportDates(payload) {
  if (!payload.dateFrom || !payload.dateTo) return { success: false, message: 'กรุณาระบุช่วงวันที่' };
  if (!_validDate(payload.dateFrom) || !_validDate(payload.dateTo)) return { success: false, message: 'รูปแบบวันที่ต้องเป็น yyyy-mm-dd' };
  if (payload.dateFrom > payload.dateTo) return { success: false, message: 'วันที่เริ่มต้องไม่มากกว่าวันที่สิ้นสุด' };
  return null;
}

/* ══════════════ รายงานยอดขาย 1.8.x — ใช้ฐานเดียวกับฝั่งการเงิน ══════════════
   ★★★ เจ้าของระบบสั่ง 25 ต.ค. 2026: "ทำให้รายงานขายในเมนูกลุ่ม 1.8 ตรงกันกับรายงานทางการเงิน"
   ทั้งสามรายงานอ่านจาก `salesFactRows()` (60_sales_facts.gs) ตัวเดียวกับไฟล์ Dashboard และ 5.3.1
   จึงนับ **เฉพาะใบที่ออกใบกำกับภาษีแล้ว · หักใบลดหนี้ · ตามวันที่บนเอกสาร · ยอดก่อนภาษี**

   ★★ ของเดิมนับ "ทุกบิลที่ไม่ถูกยกเลิก" ตามวันที่เปิดบิล ซึ่งทำให้ 1.8.1 ได้ 1,622,380.91
   ขณะที่ฝั่งการเงินได้ 1,388,895.56 แล้วไม่มีใครบอกได้ว่าอันไหนถูก (ผู้ใช้เจอ 25 ต.ค. 2026)
   ★ `_salesReportOrders()` ยังอยู่ ใช้กับ 1.8.4 รายงานรายใบ ซึ่งเป็นรายงาน "งานค้าง" ไม่ใช่ยอดขาย
     — ที่นั่นต้องดูใบที่ยังไม่ออกเอกสารได้ด้วย จึงใช้ฐานคนละตัวโดยตั้งใจ */

/** ยอดขายของสมุดนี้ในช่วงวันที่ — คืน facts พร้อมใช้ หรือ error ที่ส่งกลับได้เลย */
function _sfForReport(session, payload) {
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var dateErr = _validateReportDates(payload); if (dateErr) return dateErr;
  var r = salesFactRows(_normBook(tenantId), { dateFrom: payload.dateFrom, dateTo: payload.dateTo });
  if (!r.success) return r;
  r.tenantId = tenantId;
  return r;
}

/** นับ "จำนวนบิล" = จำนวนเอกสารที่ไม่ซ้ำ ไม่ใช่จำนวนบรรทัด */
function _sfCountDocs(seen, f) {
  var k = String(f.docNo);
  if (seen[k]) return 0;
  seen[k] = 1; return 1;
}

/**
 * 1.8.1 รายงานการขายแยกพนักงาน — "ยอดขายรายคน เทียบช่วงเวลา"
 * payload: { tenantId?, dateFrom, dateTo, compareDateFrom?, compareDateTo? }
 * ใส่ compareDateFrom/compareDateTo มาด้วย = เทียบสองช่วงเวลาให้ (เช่น เดือนนี้ vs เดือนก่อน) ไม่ใส่ = โชว์ช่วงเดียว
 */
function salesReportByStaff(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  payload = payload || {};
  var cur = _sfForReport(session, payload);
  if (!cur.success) return cur;

  function summarize(facts) {
    var by = {}, seen = {};
    facts.forEach(function(f) {
      var key = String(f.saleBy || '');
      if (!by[key]) { by[key] = { label: f.saleByName || _saleByLabel(key), bills: 0, revenue: 0 }; seen[key] = {}; }
      by[key].bills += _sfCountDocs(seen[key], f);
      by[key].revenue = _money(by[key].revenue + f.netEx);
    });
    return by;
  }

  var hasCompare = !!(payload.compareDateFrom && payload.compareDateTo);
  var prev = {};
  if (hasCompare) {
    var cmp = _sfForReport(session, { tenantId: payload.tenantId,
      dateFrom: payload.compareDateFrom, dateTo: payload.compareDateTo });
    if (!cmp.success) return cmp;
    prev = summarize(cmp.facts);
  }
  var now = summarize(cur.facts);

  var keys = {};
  Object.keys(now).forEach(function(k) { keys[k] = true; });
  Object.keys(prev).forEach(function(k) { keys[k] = true; });
  var rows = Object.keys(keys).map(function(k) {
    var c = now[k] || { label: _saleByLabel(k), bills: 0, revenue: 0 };
    var p = prev[k] || { bills: 0, revenue: 0 };
    return { saleBy: k, label: c.label, bills: c.bills, revenue: c.revenue,
      compareBills: hasCompare ? p.bills : null, compareRevenue: hasCompare ? p.revenue : null,
      revenueChangePct: (hasCompare && p.revenue > 0) ? _money((c.revenue - p.revenue) / p.revenue * 100) : null };
  });
  rows.sort(function(a, b) { return b.revenue - a.revenue; });

  return { success: true, tenantId: cur.tenantId, dateFrom: payload.dateFrom, dateTo: payload.dateTo,
    compareDateFrom: payload.compareDateFrom || '', compareDateTo: payload.compareDateTo || '', data: rows,
    totalRevenue: _money(rows.reduce(function(s, r) { return s + r.revenue; }, 0)),
    totalBills: rows.reduce(function(s, r) { return s + r.bills; }, 0),
    mismatches: cur.mismatches || [] };
}

/**
 * 1.8.2 รายงานการขายแยกลูกค้า — "ยอดซื้อรายร้าน จัดอันดับ ร้านที่หายไป"
 * payload: { tenantId?, dateFrom, dateTo, lostDays? (default 60), limit? }
 * ร้านที่หายไป = ลูกค้าที่ยังไม่ปิดกิจการของตัวแทนนี้ ซื้อครั้งสุดท้ายนานเกิน lostDays วัน (หรือไม่เคยซื้อเลย)
 * — ไม่ผูกกับช่วงวันที่ที่เลือกดูรายงาน เป็นภาพรวม ณ วันนี้เสมอ จะได้ไม่ต้องเปลี่ยนช่วงวันที่ไปมาเพื่อหาร้านหาย
 */
function salesReportByCustomer(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  payload = payload || {};
  var cur = _sfForReport(session, payload);
  if (!cur.success) return cur;
  var tenantId = cur.tenantId;

  var byCust = {}, seen = {};
  cur.facts.forEach(function(f) {
    var key = String(f.customerId || '');
    if (!byCust[key]) {
      byCust[key] = { customerId: key, customerCode: f.customerCode || '',
        customerName: f.customerName || '(ลูกค้าทั่วไป)', bills: 0, revenue: 0 };
      seen[key] = {};
    }
    byCust[key].bills += _sfCountDocs(seen[key], f);
    byCust[key].revenue = _money(byCust[key].revenue + f.netEx);
  });
  var rows = Object.keys(byCust).map(function(k) { return byCust[k]; });
  rows.sort(function(a, b) { return b.revenue - a.revenue; });
  var limit = _int(payload.limit) || 200;
  rows = rows.slice(0, limit);

  /* ร้านที่หายไป — เกณฑ์เดียวกับ customerSaleGate (status ว่าง = เดาจาก is_active) แต่ blocked ก็ยังนับ
     ★ ไม่ผูกกับช่วงวันที่ที่เลือกดูรายงาน เป็นภาพรวม ณ วันนี้เสมอ */
  var custRows = centralObjects('customers').filter(function(c) { return String(c.tenant_id) === String(tenantId); });
  var lostDays = _int(payload.lostDays) || 60;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var lost = custRows.filter(function(c) {
    var st = String(c.status || '').toLowerCase() || (isNotOff(c.is_active) ? CUSTOMER_STATUS_ACTIVE : CUSTOMER_STATUS_INACTIVE);
    return st !== CUSTOMER_STATUS_INACTIVE;
  }).map(function(c) {
    var last = _dOnly(c.last_sale_at);
    var days = last ? _daysBetween(last, today) : null;
    return { customerId: String(c.record_id), customerCode: c.customer_code || '', customerName: customerFullName(c), lastSaleAt: last, daysSinceLastSale: days };
  }).filter(function(x) { return x.daysSinceLastSale === null || x.daysSinceLastSale >= lostDays; });
  lost.sort(function(a, b) { return (b.daysSinceLastSale === null ? 999999 : b.daysSinceLastSale) - (a.daysSinceLastSale === null ? 999999 : a.daysSinceLastSale); });

  return { success: true, tenantId: tenantId, dateFrom: payload.dateFrom, dateTo: payload.dateTo, lostDays: lostDays,
    data: rows, totalRevenue: _money(rows.reduce(function(s, r) { return s + r.revenue; }, 0)),
    lostCustomers: lost, lostCustomerCount: lost.length, mismatches: cur.mismatches || [] };
}

/**
 * 1.8.3 รายงานการขายแยกสินค้า — "ยอดขายรายสินค้า/กลุ่มสินค้า"
 * payload: { tenantId?, dateFrom, dateTo, limit? }
 * นับจำนวนเป็นหน่วยฐานเสมอ (base_qty) เพราะหน่วยขายต่อบรรทัดไม่เท่ากัน (ลัง/แพ็ค/ชิ้นปนกัน) รวมกันตรงๆ ไม่ได้
 * ของแถม (is_free) แยกนับต่างหาก (freeQty) ไม่รวมเข้ายอดขาย/รายได้
 */
function salesReportByProduct(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  payload = payload || {};
  var cur = _sfForReport(session, payload);
  if (!cur.success) return cur;

  var groups = {}; centralObjects('product_groups').forEach(function(g) { groups[String(g.record_id)] = g.name; });

  var byProduct = {}, byGroup = {}, byCategory = {};
  cur.facts.forEach(function(f) {
    var groupName = groups[f.groupId] || '(ไม่มีกลุ่ม)';
    var pid = String(f.productId || '');
    if (!byProduct[pid]) byProduct[pid] = { productId: pid, productCode: f.productCode, productName: f.productName,
      groupId: f.groupId, groupName: groupName, category: f.category, subCategory: f.subCategory,
      qty: 0, freeQty: 0, revenue: 0, bills: {} };
    var row = byProduct[pid];
    /* ★ ของแถมนับจำนวนแยก ไม่เข้ายอดขาย (มูลค่า 0 อยู่แล้ว แต่จำนวนต้องไม่ไปปนกับของที่ขายจริง) */
    if (f.isFree) row.freeQty += f.baseQty; else { row.qty += f.baseQty; row.revenue = _money(row.revenue + f.netEx); }
    row.bills[String(f.docNo)] = true;

    var catName = f.category || '(ไม่มีหมวด)', catKey = catName + '\u0001' + (f.subCategory || '');
    if (!byCategory[catKey]) byCategory[catKey] = { category: catName, subCategory: f.subCategory || '', qty: 0, freeQty: 0, revenue: 0 };
    if (f.isFree) byCategory[catKey].freeQty += f.baseQty;
    else { byCategory[catKey].qty += f.baseQty; byCategory[catKey].revenue = _money(byCategory[catKey].revenue + f.netEx); }

    if (!byGroup[f.groupId]) byGroup[f.groupId] = { groupId: f.groupId, groupName: groupName, qty: 0, freeQty: 0, revenue: 0 };
    if (f.isFree) byGroup[f.groupId].freeQty += f.baseQty;
    else { byGroup[f.groupId].qty += f.baseQty; byGroup[f.groupId].revenue = _money(byGroup[f.groupId].revenue + f.netEx); }
  });

  var productRows = Object.keys(byProduct).map(function(k) {
    var r = byProduct[k];
    return { productId: r.productId, productCode: r.productCode, productName: r.productName, groupId: r.groupId,
      groupName: r.groupName, category: r.category, subCategory: r.subCategory, qty: _round2(r.qty),
      freeQty: _round2(r.freeQty), revenue: r.revenue, bills: Object.keys(r.bills).length };
  });
  productRows.sort(function(a, b) { return b.revenue - a.revenue; });
  var limit = _int(payload.limit) || 200;
  productRows = productRows.slice(0, limit);

  var groupRows = Object.keys(byGroup).map(function(k) { return byGroup[k]; });
  groupRows.sort(function(a, b) { return b.revenue - a.revenue; });
  var categoryRows = Object.keys(byCategory).map(function(k) { return byCategory[k]; });
  categoryRows.sort(function(a, b) { return b.revenue - a.revenue; });

  return { success: true, tenantId: cur.tenantId, dateFrom: payload.dateFrom, dateTo: payload.dateTo,
    products: productRows, groups: groupRows, categories: categoryRows,
    totalRevenue: _money(productRows.reduce(function(s, r) { return s + r.revenue; }, 0)),
    mismatches: cur.mismatches || [] };
}


/**
 * รายงานยอดขายรายใบ — หน้าต่างที่เปิดจากการ์ด "ยอดขายเดือนนี้" บนหน้าบิลขาย (17 ต.ค. 2026)
 * payload: { tenantId?, dateFrom, dateTo, statuses?, saleBy?, customerId?, limit? }
 *
 * ★ ใช้ตัวกรองตัวเดียวกับรายงานอีกสามตัว (`_salesReportOrders`) — ตัวเลขบนการ์ดกับในหน้าต่าง
 *   จึงมาจากที่เดียวกันเสมอ · ถ้าเขียนตัวกรองชุดที่สองตรงนี้ วันหนึ่งสองที่จะไม่ตรงกัน
 *   แล้วไม่มีใครรู้ว่าอันไหนถูก (บทเรียนเดียวกับ computePromoDiscount / splitVat)
 * ★ คืน "ตัวเลือกตัวกรอง" (พนักงาน/ร้าน ที่มีบิลจริงในช่วงนั้น) มาด้วย หน้าเว็บจะได้ไม่ต้องยิงเพิ่ม
 *   และไม่ต้องโชว์ร้านทั้ง 2,039 ร้านในกล่องเลือกทั้งที่เดือนนี้มีบิลไม่กี่ร้าน
 */
function salesReportBills(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var dateErr = _validateReportDates(payload); if (dateErr) return dateErr;
  var fopts = _salesReportOpts(payload);

  var custName = {}, custCode = {};
  centralObjects('customers').forEach(function(c) {
    custName[String(c.record_id)] = customerFullName(c);
    custCode[String(c.record_id)] = c.customer_code || '';
  });

  /* ตัวเลือกตัวกรองคิดจากช่วงวันที่ **โดยไม่สนตัวกรองพนักงาน/ร้านที่เลือกอยู่**
     ไม่งั้นพอเลือกพนักงานคนหนึ่งแล้ว รายชื่อจะเหลือคนเดียว เปลี่ยนไปคนอื่นไม่ได้อีกเลย */
  var staffOpts = {}, custOpts = {};
  _salesReportOrders(tenantId, payload.dateFrom, payload.dateTo, { statuses: fopts.statuses })
    .forEach(function(o) {
      staffOpts[String(o.sale_by || '')] = true;
      if (o.customer_id) custOpts[String(o.customer_id)] = true;
    });

  /* เลขเอกสารของแต่ละใบ — ต้องโชว์ให้เห็น ไม่งั้นคนอ่านรายงานตรวจไม่ได้ว่าทำไมใบนี้ถึงถูกนับ */
  var arNoOf = {};
  centralObjects('ar_invoices').forEach(function(iv) {
    var st = String(iv.status || '');
    if (st === 'void' || st === 'voided' || !iv.sales_order_id) return;
    arNoOf[String(iv.customer_id) + '#' + String(iv.sales_order_id)] = iv.invoice_no || '';
  });
  var roundNoOf = {};
  tenantObjectsIfExists(tenantId, 'delivery_rounds').forEach(function(rd) {
    var no = String(rd.tax_invoice_no || '').trim() || String(rd.ar_invoice_no || '').trim();
    if (no && !roundNoOf[String(rd.order_id)]) roundNoOf[String(rd.order_id)] = no;
  });

  var rows = _salesReportOrders(tenantId, payload.dateFrom, payload.dateTo, fopts).map(function(o) {
    return { id: o.record_id, code: o.order_code, date: _dOnly(o.created_at),
      taxInvoiceNo: String(o.tax_invoice_no || '').trim(),
      invoiceNo: arNoOf[String(o.customer_id) + '#' + String(o.record_id)]
        || roundNoOf[String(o.record_id)] || '',
      customerId: o.customer_id || '', customer: custName[String(o.customer_id)] || '(ไม่ระบุร้าน)',
      customerCode: custCode[String(o.customer_id)] || '',
      saleBy: o.sale_by || '', saleByName: _saleByLabel(o.sale_by),
      status: String(o.status || '').toLowerCase(), paymentMethod: o.payment_method || '',
      /* ★★ รายงานนี้เป็น "รายใบ" จึงต้องมีทั้งสองตัว: `revenue` = ยอดขายก่อน VAT (ตัวที่นับเป็นผลงาน)
         · `total` = ยอดบนหน้าเอกสาร ที่ลูกค้าต้องจ่ายจริง (ตัวที่คนเก็บเงินใช้) */
      paymentStatus: orderPaymentStatus(o), revenue: orderExVat(o), total: _money(parseFloat(o.total) || 0) };
  });
  rows.sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.id - a.id); });

  var limit = parseInt(payload.limit, 10) || 0;
  var shown = limit > 0 ? rows.slice(0, limit) : rows;

  return { success: true, tenantId: tenantId, dateFrom: payload.dateFrom, dateTo: payload.dateTo,
    statuses: fopts.statuses || [], saleBy: fopts.saleBy, customerId: fopts.customerId, invoiced: fopts.invoiced,
    data: shown, truncated: shown.length < rows.length,
    totalBills: rows.length,
    totalRevenue: _money(rows.reduce(function(sum, r) { return sum + r.revenue; }, 0)),
    totalRevenueInclVat: _money(rows.reduce(function(sum, r) { return sum + r.total; }, 0)),
    staffOptions: Object.keys(staffOpts).map(function(k) { return { saleBy: k, label: _saleByLabel(k) }; })
      .sort(function(a, b) { return a.label < b.label ? -1 : 1; }),
    customerOptions: Object.keys(custOpts).map(function(k) {
      return { id: k, label: (custCode[k] ? custCode[k] + ' ' : '') + (custName[k] || k) }; })
      .sort(function(a, b) { return a.label < b.label ? -1 : 1; }) };
}
