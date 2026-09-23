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
    .map(function(p) { return {
      id: String(p.record_id), name: p.name, price: parseFloat(p.base_price) || 0,
      unit: p.unit || 'ชิ้น', groupId: parseInt(p.group_id) || 0,
      vanStock: myStock[String(p.record_id)] || 0,
      // หน่วยขายเพิ่มเติม (แพ็ค/ลัง ฯลฯ) — หน่วยฐาน (unit/price ด้านบน) มี factor=1 เสมอ ไม่ต้องใส่ในลิสต์นี้
      units: unitsByProduct[String(p.record_id)] || []
    }; });

  var customers = centralObjects('customers')
    .filter(function(c) { return String(c.tenant_id) === String(user.tenantId) && isNotOff(c.is_active); })
    .map(function(c) { return {
      id: parseInt(c.record_id), name: c.name, groupId: parseInt(c.group_id) || 0,
      phone: c.phone || '', address: c.address || '',
      lat: parseFloat(c.lat) || 0, lng: parseFloat(c.lng) || 0
    }; });

  var rules = _activeRules();

  var result = { success: true, products: products, customers: customers, rules: rules };
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
function getAdminDashboard(session, payload) {
  var err = _requirePermission(session, 'sales_report', 'view'); if (err) return err;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var effTenantId = _effectiveTenantId(session, payload || {});

  if (effTenantId) {
    var orders = tenantObjects(effTenantId, 'sales_orders')
      .filter(function(o) { return String(o.created_at).indexOf(today) === 0; });
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
      recentOrders: recentOrders
    };
  }

  // ── owner_admin / super_admin: รวมทุกตัวแทนที่ active ──
  var tenants = centralObjects('tenants').filter(function(t) { return isFlagOn(t.is_active); });
  var totalBills = 0, totalRevenue = 0, perTenant = [];
  tenants.forEach(function(t) {
    try {
      var tOrders = tenantObjects(t.tenant_id, 'sales_orders').filter(function(o) { return String(o.created_at).indexOf(today) === 0; });
      var rev = tOrders.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0);
      totalBills += tOrders.length; totalRevenue += rev;
      perTenant.push({ tenantId: t.tenant_id, name: t.name, bills: tOrders.length, revenue: rev });
    } catch (e) { /* ตัวแทนที่ sheet ยังไม่พร้อม ข้ามไปไม่ให้ dashboard พังทั้งหน้า */ }
  });

  return {
    success: true, scope: 'owner',
    tenantCount: tenants.length,
    bills: totalBills, revenue: totalRevenue,
    productCount: centralObjects('products').filter(function(p) { return isNotOff(p.is_active); }).length,
    activePromoCount: centralObjects('discount_rules').filter(function(r) { return isFlagOn(r.is_active); }).length,
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
      time: safeDateStr(o.created_at).substring(11, 16)
    }; });

  return { success: true, data: orders };
}
