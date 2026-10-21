/**
 * ===================== ของคงเหลือ: คลัง + บนรถ + รวม (หน่วยลัง) =====================
 * ตัวรวมยอดกลางที่ใช้ได้ทั้งบอท LINE (/inventory · 59_line_bot.gs) และหน้าจอแอดมิน
 * เจ้าของระบบสั่ง 21 ต.ค. 2026: "มีคอลัมน์คลังหลักและคอลัมน์ของรวมบนรถ ทั้งคู่ มีช่องรวม หน่วยเป็นลัง"
 *
 * ★★ ของอยู่สองที่ คนละไฟล์ คนละความหมาย — ห้ามรวมเป็นตัวเดียวแล้วเรียกว่า "สต็อก"
 *   `warehouse_stock` (Central Sheet · แยกด้วย `tenant_id`) = ของในคลัง — อ่านผ่าน `_scoped()` เท่านั้น
 *   `van_stock`       (ไฟล์ของตัวแทน · แยกด้วย `line_user_id`) = ของที่อยู่บนรถพนักงานแต่ละคน
 *   ★ ขอบเขตของบริษัทเจ้าของสินค้า: คลัง = `tenant_id` ว่าง (scope '') แต่รถ = ไฟล์ของตัวแทนบ้าน `TNKI`
 *     — คนละค่ากันโดยตั้งใจ ใส่ 'TNKI' ให้ `_scoped` จะได้ 0 แถวเสมอ (ดู `_purchaseScope`)
 *
 * ★★ ทุกตัวเลขในชีตเป็น **หน่วยฐาน (ชิ้น)** การแปลงเป็นลังทำที่นี่ที่เดียว จาก `product_units`
 *   สินค้าที่ยังไม่ยืนยันขนาดบรรจุ (factor ≤ 1) **ไม่หารมั่ว** — คืนจำนวนชิ้นตามจริงพร้อม
 *   `confirmed:false` ให้ฝั่งแสดงผลติดดอกจันไว้ ไม่งั้น "12 ลัง" ที่จริงเป็น 12 ชิ้นจะไม่มีใครจับได้
 *   (ตามงานค้างด้วย action `listUnconfirmedUnits` — 10_master_data.gs)
 */

/** productId → { factor, label, confirmed } ของหน่วย "ลัง" · ไม่มีหน่วยลัง = ไม่มีคีย์ */
function caseUnitIndex() {
  var out = {};
  centralObjects('product_units').forEach(function(u) {
    if (!isNotOff(u.is_active)) return;
    if (!isCaseUnit(u.unit_code)) return;
    var factor = parseFloat(u.unit_factor) || 0;
    var label = String(u.unit_label || '');
    out[String(u.product_id)] = {
      factor: factor,
      label: label,
      // ★ ขนาดบรรจุ 1 = ค่าที่ `ensureDefaultSalesUnit` ใส่ไว้ชั่วคราวตอนยังไม่รู้ของจริง (ชื่อหน่วยมีคำเตือนต่อท้าย)
      confirmed: factor > 1 && label.indexOf('ยังไม่ยืนยัน') === -1
    };
  });
  return out;
}

/** แปลงหน่วยฐาน → ลัง (ทศนิยม 2 ตำแหน่ง) · ยังไม่ยืนยันขนาดบรรจุ = คืนค่าเดิมเป็นชิ้น */
function _invCases(baseQty, unit) {
  var q = Number(baseQty) || 0;
  if (!unit || !unit.confirmed || !(unit.factor > 1)) return q;
  return Math.round((q / unit.factor) * 100) / 100;
}

/**
 * ภาพรวมของคงเหลือของตัวแทนรายหนึ่ง
 * @param tenantId รหัสตัวแทน · ว่าง หรือ 'TNKI' = บริษัทเจ้าของสินค้า
 * @param opts { nonZeroOnly (default true), limit (0 = ไม่จำกัด), search }
 * @return { success, tenantId, tenantName, rows, totals, products, vanStaff, vanAvailable, unconfirmed, asOf }
 */
function inventorySnapshot(tenantId, opts) {
  opts = opts || {};
  var tid = String(tenantId || '') || OWNER_TENANT_ID;
  var isOwnerScope = (tid === OWNER_TENANT_ID);
  var whScope = isOwnerScope ? '' : tid;      // ★ คลังของบริษัท = scope ว่าง (ดูหัวไฟล์)
  var vanTenant = tid;                        //    แต่รถของบริษัทอยู่ในไฟล์ของตัวแทนบ้าน

  var tenantName = tid;
  centralObjects('tenants').forEach(function(t) {
    if (String(t.tenant_id) === tid) tenantName = _autTenantLabel(tid, String(t.name || tid));
  });

  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });
  var units = caseUnitIndex();

  var acc = {};   // productId → { wh, van }
  function bucket(pid) {
    var k = String(pid);
    if (!acc[k]) acc[k] = { wh: 0, van: 0 };
    return acc[k];
  }
  _scoped('warehouse_stock', whScope).forEach(function(r) { bucket(r.product_id).wh += Number(r.qty) || 0; });

  /* ของบนรถ: รวมทุกคนในตัวแทนรายนั้นเป็นก้อนเดียว ("ของรวมบนรถ" ตามที่สั่ง)
     ★ ไฟล์ของตัวแทนอาจยังไม่ถูกสร้าง (ตัวแทนใหม่ที่ยังไม่เคยใช้งาน) — ไม่ใช่ข้อผิดพลาด
       แต่ต้องบอกว่าอ่านไม่ได้ ไม่ใช่รายงานเลข 0 ให้เข้าใจว่า "รถว่าง" */
  var vanAvailable = true, vanStaff = 0;
  try {
    var seenStaff = {};
    tenantObjectsIfExists(vanTenant, 'van_stock').forEach(function(r) {
      var qty = Number(r.qty) || 0;
      if (!String(r.product_id || '').trim()) return;
      bucket(r.product_id).van += qty;
      var who = String(r.line_user_id || '');
      if (who && qty !== 0 && !seenStaff[who]) { seenStaff[who] = 1; vanStaff++; }
    });
  } catch (e) {
    vanAvailable = false;
    Logger.log('inventorySnapshot: อ่าน van_stock ของ ' + vanTenant + ' ไม่ได้ (' + e.message + ')');
  }

  var search = String(opts.search || '').trim().toLowerCase();
  var rows = [];
  Object.keys(acc).forEach(function(pid) {
    var p = products[pid], u = units[pid];
    var wh = acc[pid].wh, van = acc[pid].van;
    var name = p ? String(p.name || '') : '(สินค้าถูกลบ)';
    var code = p ? String(p.product_code || '') : pid;
    if (search && (code + ' ' + name).toLowerCase().indexOf(search) === -1) return;
    rows.push({
      productId: pid, productCode: code, productName: name,
      unitLabel: (u && u.confirmed) ? 'ลัง' : (p ? String(p.unit || 'ชิ้น') : 'ชิ้น'),
      caseFactor: u ? u.factor : 0,
      confirmed: !!(u && u.confirmed),
      warehouseBase: wh, vanBase: van, totalBase: wh + van,
      warehouse: _invCases(wh, u), van: _invCases(van, u), total: _invCases(wh + van, u)
    });
  });

  if (opts.nonZeroOnly !== false) rows = rows.filter(function(r) { return r.totalBase !== 0; });
  /* เรียงตาม "ของรวม" มากไปน้อย — รายงานตัวนี้ถูกอ่านบนมือถือ บรรทัดแรกๆ ต้องเป็นของที่มีจริง
     ★ เทียบด้วย totalBase (ชิ้น) ไม่ใช่ total (ลัง) เพราะแถวที่ยังไม่ยืนยันขนาดบรรจุมีหน่วยคนละอย่าง
       เอามาเรียงปนกันจะได้ลำดับที่อธิบายไม่ได้ (12 ชิ้น ขึ้นก่อน 3 ลัง) */
  rows.sort(function(a, b) {
    if (b.totalBase !== a.totalBase) return b.totalBase - a.totalBase;
    return String(a.productCode).localeCompare(String(b.productCode));
  });

  var totals = { warehouse: 0, van: 0, total: 0, warehouseBase: 0, vanBase: 0, totalBase: 0 };
  var unconfirmed = 0;
  rows.forEach(function(r) {
    totals.warehouseBase += r.warehouseBase; totals.vanBase += r.vanBase; totals.totalBase += r.totalBase;
    // ★ ยอดรวม "ลัง" นับเฉพาะแถวที่ยืนยันขนาดบรรจุแล้ว — บวกชิ้นเข้าไปในลังคือตัวเลขที่ไม่มีความหมาย
    if (r.confirmed) { totals.warehouse += r.warehouse; totals.van += r.van; totals.total += r.total; }
    else unconfirmed++;
  });
  ['warehouse', 'van', 'total'].forEach(function(k) { totals[k] = Math.round(totals[k] * 100) / 100; });

  var all = rows.length;
  var limit = parseInt(opts.limit, 10) || 0;
  if (limit > 0 && rows.length > limit) rows = rows.slice(0, limit);

  return { success: true, tenantId: tid, tenantName: tenantName, isOwnerScope: isOwnerScope,
    rows: rows, shown: rows.length, products: all, totals: totals,
    vanAvailable: vanAvailable, vanStaff: vanStaff, unconfirmed: unconfirmed, asOf: nowStr() };
}

/**
 * action ของแอปแอดมิน — ใช้ตัวรวมยอดเดียวกับบอท จะได้ไม่มีวันเล่าตัวเลขคนละชุด
 * ★ ตรวจสองชั้น: สิทธิ์โมดูลคลัง + ต้องดูแลตัวแทนรายนั้นอยู่จริง (57_user_tenants.gs)
 */
function getInventorySnapshot(session, payload) {
  var err = _requirePermission(session, 'inventory', 'view'); if (err) return err;
  payload = payload || {};
  var tid = String(payload.tenantId || '').trim() || String(_effectiveTenantId(session, payload) || OWNER_TENANT_ID);
  if (!managesTenant(session, tid)) return { success: false, message: 'ไม่มีสิทธิ์ดูข้อมูลของตัวแทนรายนี้' };
  return inventorySnapshot(tid, { nonZeroOnly: payload.nonZeroOnly !== false, limit: payload.limit, search: payload.search });
}
