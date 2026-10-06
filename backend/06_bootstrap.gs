/**
 * ===================== BOOTSTRAP / DASHBOARD (Mobile App) =====================
 * user: { lineUserId, tenantId, role, name } — ดู resolveUser() ใน 05_router.gs
 */

function getBootstrap(user) {
  var cached = cacheGet('bootstrap', user.lineUserId);
  if (cached) return cached;

  var allStock = tenantObjects(user.tenantId, 'van_stock');
  var myStock = {};
  allStock.filter(function(s) { return String(s.line_user_id) === String(user.lineUserId); })
    .forEach(function(s) { myStock[String(s.product_id)] = parseInt(s.qty) || 0; });

  var unitsByProduct = {};
  centralObjects('product_units')
    .filter(function(u) { return isNotOff(u.is_active); })
    .forEach(function(u) {
      var pid = String(u.product_id);
      if (!unitsByProduct[pid]) unitsByProduct[pid] = [];
      unitsByProduct[pid].push({ unitCode: u.unit_code, unitLabel: u.unit_label, unitFactor: parseFloat(u.unit_factor) || 1, price: parseFloat(u.price) || 0 });
    });

  var products = centralObjects('products')
    .filter(function(p) { return isNotOff(p.is_active); })
    .sort(_productCodeCmp)   // เรียงตามรหัสสินค้า (ลำดับตั้งต้นของรายการเลือกสินค้าในแอปมือถือ)
    .map(function(p) { return {
      id: String(p.record_id), code: String(p.product_code || ''), name: p.name, price: parseFloat(p.base_price) || 0,
      unit: p.unit || 'ชิ้น', groupId: parseInt(p.group_id) || 0,
      vanStock: myStock[String(p.record_id)] || 0,
      // หน่วยขายเพิ่มเติม (แพ็ค/ลัง ฯลฯ) — หน่วยฐาน (unit/price ด้านบน) มี factor=1 เสมอ ไม่ต้องใส่ในลิสต์นี้
      units: unitsByProduct[String(p.record_id)] || []
    }; });

  var customers = centralObjects('customers')
    .filter(function(c) { return String(c.tenant_id) === String(user.tenantId) && isNotOff(c.is_active); })
    .map(function(c) { return {
      id: parseInt(c.record_id), code: c.customer_code || '', name: customerFullName(c), groupId: parseInt(c.group_id) || 0,
      phone: c.phone || '', address: c.address || '',
      lat: parseFloat(c.lat) || 0, lng: parseFloat(c.lng) || 0,
      // เครดิตประจำร้าน + สถานะ: แอปมือถือใช้ตั้งค่าเริ่มต้นช่องชำระเงิน และกันการเปิดบิลเชื่อให้ร้านที่ถูกระงับ
      paymentType: c.payment_type || 'cash', termsDays: parseInt(c.payment_terms_days) || 0,
      creditBlocked: String(c.status || '').toLowerCase() === CUSTOMER_STATUS_BLOCKED
    }; });

  var rules = _activeRules();

  /* คำขอเปิดร้านใหม่ของเซลส์คนนี้ + ประเภทร้านให้เลือกตอนกรอก (46_customer_requests.gs)
     ★ ยัดมากับ bootstrap ตามกติกาข้อ 1 ("หน้าแรกยิงคำขอเดียว") แทนที่จะให้แอปยิงเพิ่มอีกสองคำขอตอนเปิด —
     ค่าคงที่ของ Apps Script ~2 วิ/คำขอ แค่ป้ายแจ้งเตือนไม่คุ้มที่จะจ่ายเพิ่มขนาดนั้น
     แคช bootstrap ถูกล้างตอนแอดมินอนุมัติอยู่แล้ว ผลจึงมาถึงเซลส์ในรอบถัดไปที่เปิดแอป */
  var myReq = listMyCustomerRequests(user, {});

  var result = { success: true, products: products, customers: customers, rules: rules,
    shopTypes: _crShopTypes(),
    customerRequests: myReq.requests || [],
    customerRequestAlerts: myReq.unseenDecided || [] };
  cachePut('bootstrap', user.lineUserId, result, CACHE_TTL);
  return result;
}

function getDashboard(user) {
  var cached = cacheGet('dashboard', user.lineUserId);
  if (cached) return cached;

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var orders = tenantObjects(user.tenantId, 'sales_orders')
    .filter(function(o) { return String(o.sale_by) === String(user.lineUserId) && String(o.created_at).indexOf(today) === 0; });

  var bills = orders.length;
  var revenue = orders.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0);

  var visits = tenantObjects(user.tenantId, 'visits')
    .filter(function(v) { return String(v.line_user_id) === String(user.lineUserId) && String(v.check_in_at).indexOf(today) === 0; }).length;

  var orderIds = {};
  orders.forEach(function(o) { orderIds[String(o.record_id)] = true; });
  var items = tenantObjects(user.tenantId, 'order_items')
    .filter(function(it) { return orderIds[String(it.order_id)] && String(it.is_free) !== '1'; });

  var soldMap = {};
  items.forEach(function(it) {
    var pid = String(it.product_id);
    soldMap[pid] = (soldMap[pid] || 0) + (parseInt(it.qty) || 0);
  });

  var allProducts = centralObjects('products');
  var topProducts = Object.keys(soldMap)
    .map(function(pid) { return [pid, soldMap[pid]]; })
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5)
    .map(function(e) {
      var p = allProducts.filter(function(x) { return String(x.record_id) === e[0]; })[0];
      return { name: p ? p.name : e[0], sold: e[1] };
    });

  var result = { success: true, bills: bills, revenue: revenue, visits: visits, topProducts: topProducts };
  cachePut('dashboard', user.lineUserId, result, CACHE_TTL_DASHBOARD);
  return result;
}

/**
 * ===================== ADMIN DASHBOARD (Admin App) =====================
 * tenant จริง หรือ Ultra Admin ที่สวมสิทธิ์ตัวแทน → สรุปของตัวแทนนั้นรายเดียว
 * บริษัทเจ้าของสินค้า (ไม่ได้สวมสิทธิ์ตัวแทนไหน) → สรุปรวมทุกตัวแทนที่ active
 */
/* จำนวนคำขอเปิดร้านใหม่ที่ยังรออนุมัติ (46_customer_requests.gs) — ขึ้นเป็นการ์ดบนหน้าภาพรวม
   นับที่นี่แทนที่จะให้หน้าเว็บยิงคำขอเพิ่ม เพราะหน้าแรกยิงคำขอเดียวตามกติกาความเร็วข้อ 1
   scope ว่าง (ฝั่งบริษัทที่ไม่ได้สวมสิทธิ์ตัวแทน) = เห็นของทุกตัวแทน */
function _dashPendingCustomerRequests(scope) {
  return centralObjects('customer_requests').filter(function(r) {
    if (scope && String(r.tenant_id) !== String(scope)) return false;
    return String(r.status || 'pending') === 'pending';
  }).length;
}

function getAdminDashboard(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var effTenantId = _effectiveTenantId(session, payload || {});

  if (effTenantId) {
    // ฝั่งตัวแทนเปิดไฟล์ของตัวเองไฟล์เดียวอยู่แล้ว (ต้องใช้รายการบิลล่าสุดด้วย) จึงไม่ต้องพึ่ง rollup
    var orders = tenantObjects(effTenantId, 'sales_orders')
      .filter(function(o) { return _dOnly(o.created_at) === today && String(o.status) !== 'cancelled'; });
    var pendingSO = orders.filter(function(o) { return o.status === 'pending_delivery'; });

    var staff = centralObjects('liff_users').filter(function(u) { return String(u.tenant_id) === String(effTenantId); });
    var custName = {};
    centralObjects('customers').forEach(function(c) { custName[String(c.record_id)] = c.name; });

    var recentOrders = orders
      .sort(function(a, b) { return safeDateStr(b.created_at).localeCompare(safeDateStr(a.created_at)); })
      .slice(0, 6)
      .map(function(o) { return {
        code: o.order_code, customer: custName[String(o.customer_id)] || 'ลูกค้าทั่วไป',
        total: parseFloat(o.total) || 0, time: safeDateStr(o.created_at).substring(11, 16)
      }; });

    return {
      success: true, scope: 'tenant',
      bills: orders.length,
      revenue: orders.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0),
      activeStaff: staff.filter(function(u) { return String(u.status) === 'Yes'; }).length,
      pendingStaff: staff.filter(function(u) { return String(u.status) !== 'Yes'; }).length,
      pendingDeliveryCount: pendingSO.length,
      pendingDeliveryValue: pendingSO.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0),
      pendingCustomerRequests: _dashPendingCustomerRequests(effTenantId),
      recentOrders: recentOrders
    };
  }

  // ── owner_admin / super_admin: รวมทุกตัวแทนที่ active ──
  // อ่านจากยอดสรุปรายวัน (sales_daily) ชีตเดียว — เดิมเปิดไฟล์ของทุกตัวแทน ใช้เวลา 16–18 วิ (ดู 31_sales_rollup.gs)
  var tenants = centralObjects('tenants').filter(function(t) { return isFlagOn(t.is_active); });
  var daily = salesDailyMap(today);
  var totalBills = 0, totalRevenue = 0, perTenant = [];
  tenants.forEach(function(t) {
    var d = daily[String(t.tenant_id)] || { bills: 0, revenue: 0 };
    totalBills += d.bills; totalRevenue += d.revenue;
    perTenant.push({ tenantId: t.tenant_id, name: t.name, bills: d.bills, revenue: d.revenue });
  });

  return {
    success: true, scope: 'owner',
    tenantCount: tenants.length,
    bills: totalBills, revenue: totalRevenue,
    productCount: centralObjects('products').filter(function(p) { return isNotOff(p.is_active); }).length,
    activePromoCount: centralObjects('discount_rules').filter(function(r) { return isFlagOn(r.is_active); }).length,
    pendingCustomerRequests: _dashPendingCustomerRequests(null),
    perTenant: perTenant
  };
}

function getRecentSales(user, payload) {
  var limit = parseInt(payload.limit) || 20;
  var customers = centralObjects('customers');
  var custName = {};
  customers.forEach(function(c) { custName[String(c.record_id)] = c.name; });

  var orders = tenantObjects(user.tenantId, 'sales_orders')
    .filter(function(o) { return String(o.sale_by) === String(user.lineUserId); })
    .sort(function(a, b) { return safeDateStr(b.created_at).localeCompare(safeDateStr(a.created_at)); })
    .slice(0, limit)
    .map(function(o) { return {
      code: o.order_code,
      customer: custName[String(o.customer_id)] || 'ลูกค้าทั่วไป',
      payment: o.payment_method,
      total: parseFloat(o.total) || 0,
      time: safeDateStr(o.created_at).substring(11, 16),
      // สถานะไปแสดงในรายการบิลล่าสุดบนมือถือ (เจ้าของระบบสั่ง 1 ต.ค. 2026) — ป้ายมาจาก 34_sales_status.gs ชุดเดียว
      status: _soStatusOf(o), statusLabel: SO_STATUS_LABELS[_soStatusOf(o)] || '',
      /* ★ ธง "ศูนย์แก้ไขแล้ว" ต้องมากับ "รายการ" ไม่ใช่เฉพาะตอนเปิดใบ (6 ต.ค. 2026)
         หน้ารายละเอียดมีแถบเตือนอยู่แล้ว แต่เซลส์ไม่มีเหตุให้เปิดใบที่เขาคิดว่ารู้แล้วว่ามีอะไร
         — ธงที่ต้องเปิดเข้าไปดูถึงจะเห็น ไม่ได้เตือนใครเลย เพราะเขาถือใบที่พิมพ์ไปแล้วอยู่ในมือ */
      centerEditedAt: safeDateStr(o.center_edited_at)
    }; });

  return { success: true, data: orders };
}

// รายละเอียดบิลใบเดียว (ดูซ้ำ/พิมพ์ซ้ำจากแอปมือถือ) — payload: { orderCode }
// ★ กันดูบิลของคนอื่น: กรอง sale_by === user.lineUserId เหมือน getRecentSales ด้านบน — คนขับเห็นได้แค่บิลตัวเอง
// (ไม่ใช้ getSalesOrderAdmin ของ 19_sales_admin.gs เพราะตัวนั้นตรวจสิทธิ์แบบ session/token ของแอดมิน
// คนละระบบยืนยันตัวตนกับมือถือที่ใช้ lineUserId — ดูรายละเอียดครบเอกสารทางการ (ผู้ออกบิล ฯลฯ) ยังต้องเปิดแอดมิน)
function getSaleDetail(user, payload) {
  var order = null;
  tenantObjects(user.tenantId, 'sales_orders').forEach(function(o) {
    if (String(o.order_code) === String(payload.orderCode) && String(o.sale_by) === String(user.lineUserId)) order = o;
  });
  if (!order) return { success: false, message: 'ไม่พบบิลนี้ หรือไม่ใช่บิลของท่าน' };

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var customers = {};
  centralObjects('customers').forEach(function(c) { customers[String(c.record_id)] = c; });
  var cust = customers[String(order.customer_id)];

  var vat = _orderVat(order);   // อ่านภาพนิ่งภาษีที่บันทึกไว้ตอนขาย ไม่คำนวณใหม่ (guide VAT ข้อ 4)
  var items = tenantObjects(user.tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id); })
    .map(function(it) { var p = products[String(it.product_id)]; var taxStatus = String(it.tax_status || '') || productTaxStatus(p);
      var lineTotal = parseFloat(it.line_total) || 0; return {
      productId: it.product_id, code: p ? String(p.product_code || '') : '', name: p ? p.name : '(สินค้าถูกลบ)',
      unitCode: it.unit_code, qty: parseFloat(it.qty) || 0, price: parseFloat(it.price) || 0,
      lineTotal: lineTotal, isFree: String(it.is_free) === '1',
      // ส่วนลดต่อบรรทัด (2026-09-30) — บิลเก่าก่อนมีคอลัมน์นี้อ่านเป็น '' → parseFloat ได้ NaN → || 0 ดักไว้
      unitDiscount: parseFloat(it.unit_discount) || 0, lineDiscount: parseFloat(it.line_discount) || 0,
      netTotal: lineTotal - (parseFloat(it.line_discount) || 0),
      // ★ (2) ราคาตั้งก่อนภาษี — บิลเก่าก่อนมีคอลัมน์นี้ list_price_ex_vat ว่าง → listBreakdown เป็น null (ซ่อนคอลัมน์เอง)
      listBreakdown: _lineListBreakdown(it.list_price_ex_vat, it.qty, lineTotal, taxStatus === TAX_VAT, vat.rate)
    }; });
  // ★ (2) ราคารวมหลังหักส่วนลดสินค้า (ก่อนโปร/ส่วนลดท้ายบิล) ไม่รวมภาษี — ส่วนลดท้ายบิลเป็นเศษที่เหลือ กันปัดเศษไม่ตรงกัน
  var preDiscountExVat = 0;
  tenantObjects(user.tenantId, 'order_items').filter(function(it) { return String(it.order_id) === String(order.record_id); })
    .forEach(function(it) { var p = products[String(it.product_id)]; var taxStatus = String(it.tax_status || '') || productTaxStatus(p);
      var lt = parseFloat(it.line_total) || 0; preDiscountExVat += taxStatus === TAX_VAT ? lt / (1 + vat.rate) : lt; });
  preDiscountExVat = _round2(preDiscountExVat);
  return { success: true,
    order: {
      code: order.order_code, customer: cust ? customerFullName(cust) : 'ลูกค้าทั่วไป', customerPhone: cust ? cust.phone : '',
      /* สถานะ + สิทธิ์ของพนักงานกับใบนี้ (1 ต.ค. 2026) — ให้หน้าจอรู้ว่าจะโชว์ปุ่มยืนยัน/ยกเลิกไหม
         ตัดสินจากค่าคงที่ฝั่ง backend (34_sales_status.gs) ไม่ให้หน้าจอตั้งกติกาชุดที่สองขึ้นมาเอง */
      customerId: order.customer_id,   // ใช้ตอน "แก้ไขร่าง" เพื่อเลือกร้านเดิมกลับให้ในหน้าขาย
      requestedDeliveryDate: safeDateStr(order.requested_delivery_date).substring(0, 10),
      // ศูนย์แก้ไขรายการในใบนี้หลังรับงาน (editSalesOrderAdmin) — มือถือแจ้งพนักงานให้ตรวจกับลูกค้า
      centerEditedAt: safeDateStr(order.center_edited_at), centerEditedBy: order.center_edited_by || '',
      deliveryOrderNo: order.delivery_order_no || '',
      customerAddress: cust ? (cust.address || '') : '',   // พิมพ์ลงใบที่ให้ลูกค้าถือไว้
      statusLabel: SO_STATUS_LABELS[_soStatusOf(order)] || '',
      canConfirm: _soStatusOf(order) === SO_DRAFT,
      canCancel: String(order.fulfillment_type) !== 'immediate' && SO_MOBILE_CANCELLABLE.indexOf(_soStatusOf(order)) !== -1,
      subtotal: parseFloat(order.subtotal) || 0, discount: parseFloat(order.discount) || 0, total: parseFloat(order.total) || 0,
      applyVat: vat.applyVat && vat.vat > 0, vatRate: vat.rate, vatAmount: vat.vat,
      subtotalExVat: vat.exVat, exemptAmount: vat.exemptAmount, taxableExVat: vat.taxableExVat, vatMixed: vat.mixed,
      // ★ (2) ราคาก่อนภาษีเป็นตัวตั้งต้น — ยอดสรุปบิลฝั่งไม่รวม VAT ก่อนบวก VAT ทีเดียวตอนท้าย
      subtotalAfterProductDiscountExVat: preDiscountExVat, billDiscountExVat: _round2(preDiscountExVat - vat.exVat),
      // ★ ผ่าน _soStatusOf() เพื่อกันค่าแปลกปลอม/ว่างในบิลเก่า (คืนค่าที่รู้จักเสมอ)
      //   ชื่อเดิม `pending_delivery` ยังส่งไปตามจริง — หน้าจอรู้จักทั้งสองชื่อและแปลเป็นป้ายเดียวกันอยู่แล้ว
      paymentMethod: order.payment_method, fulfillmentType: order.fulfillment_type, status: _soStatusOf(order),
      createdAt: safeDateStr(order.created_at)
    },
    items: items
  };
}
