/**
 * ===================== รายงานการขาย (เมนู 1.8.1 / 1.8.2 / 1.8.3) =====================
 * ทั้งสามรายงานอ่านจากไฟล์ของ "ตัวแทนรายเดียว" เท่านั้น (_salesTenantId) — ห้ามวนเปิดไฟล์ทุกตัวแทน
 * แดชบอร์ดเคยทำแบบนั้นแล้ววัดได้ 16-18 วินาที (7 ตัวแทน) โตเป็นเส้นตรงตามจำนวนตัวแทน จึงย้ายไปใช้ sales_daily
 * แทน (ดู 31_sales_rollup.gs) — ถ้าจะทำสรุปข้ามตัวแทนของสามรายงานนี้ในอนาคต ต้องต่อยอดจากแนวทางเดียวกัน
 * ไม่ใช่วนเปิดทุกไฟล์ตรงๆ แบบนี้
 *
 * ไม่นับบิลที่ถูกยกเลิก (status='cancelled') ในทุกรายงาน — ยอดขายต้องเป็นยอดที่ยังยืนอยู่จริง ณ วันนี้
 */

function _salesReportOrders(tenantId, dateFrom, dateTo) {
  return tenantObjects(tenantId, 'sales_orders').filter(function(o) {
    if (String(o.status) === 'cancelled') return false;
    var d = _dOnly(o.created_at);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}

// ป้ายชื่อของ "ใครขาย" — sale_by เป็น LINE user id ของพนักงานขับรถ หรือ 'admin:<username>' ถ้าเปิดจากแอดมิน (19_sales_admin.gs)
function _saleByLabel(saleBy) {
  var s = String(saleBy || '');
  if (!s) return '(ไม่ระบุ)';
  if (s.indexOf('admin:') === 0) {
    var uname = s.substring(6), found = null;
    centralObjects('admin_users').forEach(function(u) { if (String(u.username) === uname) found = u; });
    return '[แอดมิน] ' + (found ? (found.display_name || uname) : uname);
  }
  var liff = null;
  centralObjects('liff_users').forEach(function(u) { if (String(u.line_user_id) === s) liff = u; });
  return liff ? (liff.display_name || s) : s;
}

function _validateReportDates(payload) {
  if (!payload.dateFrom || !payload.dateTo) return { success: false, message: 'กรุณาระบุช่วงวันที่' };
  if (!_validDate(payload.dateFrom) || !_validDate(payload.dateTo)) return { success: false, message: 'รูปแบบวันที่ต้องเป็น yyyy-mm-dd' };
  if (payload.dateFrom > payload.dateTo) return { success: false, message: 'วันที่เริ่มต้องไม่มากกว่าวันที่สิ้นสุด' };
  return null;
}

/**
 * 1.8.1 รายงานการขายแยกพนักงาน — "ยอดขายรายคน เทียบช่วงเวลา"
 * payload: { tenantId?, dateFrom, dateTo, compareDateFrom?, compareDateTo? }
 * ใส่ compareDateFrom/compareDateTo มาด้วย = เทียบสองช่วงเวลาให้ (เช่น เดือนนี้ vs เดือนก่อน) ไม่ใส่ = โชว์ช่วงเดียว
 */
function salesReportByStaff(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  payload = payload || {};
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var dateErr = _validateReportDates(payload); if (dateErr) return dateErr;

  function summarize(from, to) {
    var byStaff = {};
    _salesReportOrders(tenantId, from, to).forEach(function(o) {
      var key = String(o.sale_by || '');
      if (!byStaff[key]) byStaff[key] = { label: _saleByLabel(key), bills: 0, revenue: 0 };
      byStaff[key].bills++;
      byStaff[key].revenue = _money(byStaff[key].revenue + (parseFloat(o.total) || 0));
    });
    return byStaff;
  }
  var cur = summarize(payload.dateFrom, payload.dateTo);
  var hasCompare = !!(payload.compareDateFrom && payload.compareDateTo);
  if (hasCompare) {
    var cmpErr = _validateReportDates({ dateFrom: payload.compareDateFrom, dateTo: payload.compareDateTo });
    if (cmpErr) return cmpErr;
  }
  var prev = hasCompare ? summarize(payload.compareDateFrom, payload.compareDateTo) : {};

  var keys = {};
  Object.keys(cur).forEach(function(k) { keys[k] = true; });
  Object.keys(prev).forEach(function(k) { keys[k] = true; });
  var rows = Object.keys(keys).map(function(k) {
    var c = cur[k] || { label: _saleByLabel(k), bills: 0, revenue: 0 };
    var p = prev[k] || { bills: 0, revenue: 0 };
    return { saleBy: k, label: c.label, bills: c.bills, revenue: c.revenue,
      compareBills: hasCompare ? p.bills : null, compareRevenue: hasCompare ? p.revenue : null,
      revenueChangePct: (hasCompare && p.revenue > 0) ? _money((c.revenue - p.revenue) / p.revenue * 100) : null };
  });
  rows.sort(function(a, b) { return b.revenue - a.revenue; });

  return { success: true, tenantId: tenantId, dateFrom: payload.dateFrom, dateTo: payload.dateTo,
    compareDateFrom: payload.compareDateFrom || '', compareDateTo: payload.compareDateTo || '', data: rows,
    totalRevenue: _money(rows.reduce(function(s, r) { return s + r.revenue; }, 0)),
    totalBills: rows.reduce(function(s, r) { return s + r.bills; }, 0) };
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
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var dateErr = _validateReportDates(payload); if (dateErr) return dateErr;

  var custRows = centralObjects('customers').filter(function(c) { return String(c.tenant_id) === String(tenantId); });
  var custMap = {}; custRows.forEach(function(c) { custMap[String(c.record_id)] = c; });

  var byCust = {};
  _salesReportOrders(tenantId, payload.dateFrom, payload.dateTo).forEach(function(o) {
    var key = String(o.customer_id || '');
    if (!byCust[key]) {
      var c = custMap[key];
      byCust[key] = { customerId: key, customerCode: c ? (c.customer_code || '') : '', customerName: c ? customerFullName(c) : '(ลูกค้าทั่วไป)', bills: 0, revenue: 0 };
    }
    byCust[key].bills++;
    byCust[key].revenue = _money(byCust[key].revenue + (parseFloat(o.total) || 0));
  });
  var rows = Object.keys(byCust).map(function(k) { return byCust[k]; });
  rows.sort(function(a, b) { return b.revenue - a.revenue; });
  var limit = _int(payload.limit) || 200;
  rows = rows.slice(0, limit);

  // ร้านที่หายไป — เกณฑ์เดียวกับ customerSaleGate (status ว่าง = เดาจาก is_active) แต่ blocked ก็ยังนับ (ยังขายสดได้)
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
    lostCustomers: lost, lostCustomerCount: lost.length };
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
  var tenantId = _salesTenantId(session, payload);
  if (!tenantId) return { success: false, message: 'กรุณาระบุตัวแทนจำหน่าย' };
  var dateErr = _validateReportDates(payload); if (dateErr) return dateErr;

  var products = {}; centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var groups = {}; centralObjects('product_groups').forEach(function(g) { groups[String(g.record_id)] = g.name; });

  var orderIds = {};
  _salesReportOrders(tenantId, payload.dateFrom, payload.dateTo).forEach(function(o) { orderIds[String(o.record_id)] = true; });

  var byProduct = {}, byGroup = {};
  tenantObjects(tenantId, 'order_items').forEach(function(it) {
    if (!orderIds[String(it.order_id)]) return;
    var pid = String(it.product_id || '');
    var p = products[pid];
    var gid = p ? String(p.group_id || '') : '';
    var groupName = groups[gid] || '(ไม่มีกลุ่ม)';
    var isFree = isFlagOn(it.is_free);
    var qty = Number(it.base_qty) || 0, revenue = Number(it.line_total) || 0;

    if (!byProduct[pid]) byProduct[pid] = { productId: pid, productCode: p ? p.product_code : '', productName: p ? p.name : '(สินค้าถูกลบ)',
      groupId: gid, groupName: groupName, qty: 0, freeQty: 0, revenue: 0, bills: {} };
    var row = byProduct[pid];
    if (isFree) row.freeQty += qty; else { row.qty += qty; row.revenue = _money(row.revenue + revenue); }
    row.bills[String(it.order_id)] = true;

    if (!byGroup[gid]) byGroup[gid] = { groupId: gid, groupName: groupName, qty: 0, freeQty: 0, revenue: 0 };
    if (isFree) byGroup[gid].freeQty += qty; else { byGroup[gid].qty += qty; byGroup[gid].revenue = _money(byGroup[gid].revenue + revenue); }
  });

  var productRows = Object.keys(byProduct).map(function(k) {
    var r = byProduct[k];
    return { productId: r.productId, productCode: r.productCode, productName: r.productName, groupId: r.groupId, groupName: r.groupName,
      qty: r.qty, freeQty: r.freeQty, revenue: r.revenue, bills: Object.keys(r.bills).length };
  });
  productRows.sort(function(a, b) { return b.revenue - a.revenue; });
  var limit = _int(payload.limit) || 200;
  productRows = productRows.slice(0, limit);

  var groupRows = Object.keys(byGroup).map(function(k) { return byGroup[k]; });
  groupRows.sort(function(a, b) { return b.revenue - a.revenue; });

  return { success: true, tenantId: tenantId, dateFrom: payload.dateFrom, dateTo: payload.dateTo,
    products: productRows, groups: groupRows, totalRevenue: _money(productRows.reduce(function(s, r) { return s + r.revenue; }, 0)) };
}
