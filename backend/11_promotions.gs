/**
 * ===================== PROMOTION ENGINE =====================
 * discount_rules (Central Sheet) — บริษัทเจ้าของสินค้าคุมจากศูนย์กลาง ใช้ได้กับทุกตัวแทน
 *   record_id, name, scope, product_group_id, product_id, trigger_group_ids,
 *   customer_group_id, min_qty, min_amount, type, value,
 *   free_product_id, free_qty, priority, stackable, date_start, date_end, is_active
 *
 *   type: 'percent' | 'baht_flat' | 'baht_per_unit' | 'free_goods'
 *   trigger_group_ids: comma-separated product_group_id หลายกลุ่ม สำหรับโปรที่ "คละกลุ่มสินค้าได้"
 *                       (เว้นว่าง = ใช้ product_group_id/product_id เดี่ยวตามปกติ)
 *   priority: เลขน้อยตรวจก่อน · stackable=FALSE ในกลุ่มเดียวกันจะเลือกได้แค่ตัวที่ลดมากสุด
 *
 * ฟังก์ชันนี้เป็น "ความจริงสุดท้าย" ของราคา/ส่วนลด — ห้าม trust ตัวเลขจาก client เด็ดขาด
 * ฝั่ง mobile app คำนวณซ้ำที่ client (runDiscounts ใน main.html) ไว้แค่โชว์ preview เร็วๆ เท่านั้น
 * ตอนบันทึกขายจริงต้องเรียกฟังก์ชันนี้ซ้ำเสมอ (ดู 07_sales.gs)
 */

function _activeRules() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return centralObjects('discount_rules')
    .filter(function(r) {
      if (!isFlagOn(r.is_active)) return false;
      if (r.date_start && String(r.date_start) > today) return false;
      if (r.date_end && String(r.date_end) < today) return false;
      return true;
    })
    .map(function(r) { return {
      id: parseInt(r.record_id),
      name: r.name,
      productGroupId: parseInt(r.product_group_id) || 0,
      productId: parseInt(r.product_id) || 0,
      triggerGroupIds: String(r.trigger_group_ids || '').split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return n > 0; }),
      triggerProductIds: String(r.trigger_product_ids || '').split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return n > 0; }),
      customerGroupId: parseInt(r.customer_group_id) || 0,
      minQty: parseFloat(r.min_qty) || 0,
      minAmount: parseFloat(r.min_amount) || 0,
      type: r.type,
      value: parseFloat(r.value) || 0,
      freeProductId: parseInt(r.free_product_id) || 0,
      freeQty: parseFloat(r.free_qty) || 0,
      priority: parseInt(r.priority) || 100,
      stackable: isFlagOn(r.stackable)
    }; })
    .sort(function(a, b) { return a.priority - b.priority; });
}

function _customerGroupId(customerId) {
  if (!customerId) return 0;
  var customers = centralObjects('customers');
  for (var i = 0; i < customers.length; i++) {
    if (String(customers[i].record_id) === String(customerId)) return parseInt(customers[i].group_id) || 0;
  }
  return 0;
}

// items: [{ productId, qty, price, groupId }]  (ราคาต่อหน่วยตาม unit ที่ขาย — ไม่แปลงหน่วยข้ามชิ้น/แพ็ค/ลัง ใน phase นี้)
/**
 * โปรโมชั่นที่ "ร้านรายนี้มีสิทธิ์ใช้" — ผ่านสองชั้นเหมือนชุดราคา
 *   ชั้น A  บริษัทจ่ายโปรนี้ให้ตัวแทนของร้านแล้วหรือยัง (38_package_distribution.gs)
 *   ชั้น B  ร้านเข้าเงื่อนไขไหม — กฎสิทธิ์ถ้ามี (36_price_rules.gs) ไม่งั้นใช้ customer_group_id แบบเดิม
 * customer = แถวลูกค้าดิบ (null = คิดโปรแบบไม่ผูกร้าน ใช้กับหน้าทดลองคิดราคา)
 */
function promosForCustomer(customer) {
  var rules = _activeRules();
  if (!customer) return rules;
  var pkgIdx = packageTenantIndex();
  var rulesByTarget = typeof plrRulesByTarget === 'function' ? plrRulesByTarget(PLR_TARGET_PROMO) : {};
  var custGroupId = parseInt(customer.group_id) || 0;
  return rules.filter(function(r) {
    if (!packageAllowedForTenant(pkgIdx, PKG_PROMO, r.id, customer.tenant_id)) return false;
    var own = rulesByTarget[String(r.id)] || [];
    if (own.length) {
      for (var i = 0; i < own.length; i++) {
        if (plrRuleMatches(customer, own[i].rule, own[i].conditions)) return true;
      }
      return false;   // ตั้งกฎไว้แล้วไม่เข้าสักข้อ = ไม่ได้ (กฎมีไว้จำกัด ไม่ใช่มีไว้เฉยๆ)
    }
    return r.customerGroupId === 0 || r.customerGroupId === custGroupId;
  });
}

/**
 * แกนการคิดส่วนลดจากโปรโมชั่น — แยกออกมาเพื่อให้เส้นทาง "มีชุดราคา" (18_pricing_engine.gs)
 * กับเส้นทางเดิม (ไม่มีชุดราคา) ใช้ตรรกะตัวเดียวกัน ไม่ใช่เขียนสองชุดแล้วค่อยๆ เพี้ยนออกจากกัน
 * items: [{ productId, qty, price, groupId }] · rules: ผลจาก promosForCustomer()
 * skipFreeGoods: เส้นทางชุดราคายังไม่คิดของแถม (เจ้าของระบบสั่งพักเรื่องของแถมไว้)
 */
function computePromoDiscount(items, rules, skipFreeGoods) {
  var subtotal = items.reduce(function(s, it) { return s + it.price * it.qty; }, 0);
  var freeGoods = [];
  var appliedRules = [];
  var discount = 0;
  var bestNonStackable = null;

  rules.forEach(function(r) {

    // เลือกรายการที่เข้าเงื่อนไข trigger: ถ้ามี triggerGroupIds ให้คละหลายกลุ่มได้,
    // ไม่งั้น fallback ไป productId/productGroupId เดี่ยว
    var matched = items.filter(function(it) {
      // เรียงจากแคบไปกว้าง: รายการสินค้าที่ระบุ → กลุ่มที่ระบุหลายกลุ่ม → สินค้าเดี่ยว → กลุ่มเดียว
      var pids = r.triggerProductIds || [], gids = r.triggerGroupIds || [];
      if (pids.length) return pids.indexOf(Number(it.productId)) !== -1;
      if (gids.length) return gids.indexOf(it.groupId) !== -1;
      if (r.productId) return it.productId === r.productId;
      if (r.productGroupId) return it.groupId === r.productGroupId;
      return false; // กันโปรที่ไม่ระบุเงื่อนไขอะไรเลยโดนใช้มั่ว
    });
    if (!matched.length) return;

    var matchedQty = matched.reduce(function(s, it) { return s + it.qty; }, 0);
    var matchedAmount = matched.reduce(function(s, it) { return s + it.price * it.qty; }, 0);
    if (r.minQty > 0 && matchedQty < r.minQty) return;
    if (r.minAmount > 0 && matchedAmount < r.minAmount) return;

    if (r.type === 'free_goods') {
      if (skipFreeGoods) return;
      var times = r.minQty > 0 ? Math.floor(matchedQty / r.minQty) : 1;
      if (times > 0 && r.freeProductId > 0) {
        // qty ของเส้นทางเดิมเป็น "หน่วยฐาน" อยู่แล้ว — เติม unitCode/baseQty ให้รูปร่างตรงกับของแถมจากชุดแถม
        // ปลายทาง (ตัดสต็อก/เขียนบรรทัดบิล) จะได้อ่านฟิลด์ชุดเดียวไม่ต้องแยกกรณี
        freeGoods.push({ ruleId: r.id, ruleName: r.name, productId: r.freeProductId,
          qty: times * r.freeQty, unitCode: UNIT_PC, baseQty: times * r.freeQty, applied: true });
      }
      return;
    }

    var dv = 0;
    if (r.type === 'percent') dv = matchedAmount * r.value / 100;
    else if (r.type === 'baht_flat') dv = r.value;
    else if (r.type === 'baht_per_unit') dv = r.value * matchedQty;
    if (dv <= 0) return;

    if (r.stackable) {
      discount += dv;
      appliedRules.push({ ruleId: r.id, ruleName: r.name, type: r.type, value: dv });
    } else if (!bestNonStackable || dv > bestNonStackable.value) {
      bestNonStackable = { ruleId: r.id, ruleName: r.name, type: r.type, value: dv };
    }
  });

  if (bestNonStackable) { discount += bestNonStackable.value; appliedRules.push(bestNonStackable); }
  if (discount > subtotal) discount = subtotal; // กันส่วนลดเกินยอดขาย

  return { subtotal: subtotal, discount: discount, total: subtotal - discount, appliedRules: appliedRules, freeGoods: freeGoods };
}

/** เส้นทางเดิม: ร้านที่กลุ่มไม่มีชุดราคาใช้งานอยู่ — ราคามาจาก products แล้วหักโปรโมชั่น */
function applyPromotions(items, customerId) {
  var customer = typeof plrCustomerRow === 'function' ? plrCustomerRow(customerId) : null;
  return computePromoDiscount(items, promosForCustomer(customer), false);
}

// ── Admin CRUD (ฝั่งบริษัทเจ้าของสินค้าเท่านั้น) ──
function listPromotions(session) {
  var err = _requirePermission(session, 'promotions', 'view'); if (err) return err;
  var idx = packageTenantIndex();
  return { success: true, data: centralObjects('discount_rules').filter(function(r) { return _pkgVisible(session, PKG_PROMO, r.record_id, idx); }) };
}

function addPromotion(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  var id = centralNextId('discount_rules');
  centralAppend('discount_rules', {
    record_id: id,
    name: payload.name, scope: payload.scope || '',
    product_group_id: payload.productGroupId || 0, product_id: payload.productId || 0,
    trigger_group_ids: (payload.triggerGroupIds || []).join(','),
    trigger_product_ids: (payload.triggerProductIds || []).join(','),
    customer_group_id: payload.customerGroupId || 0,
    min_qty: payload.minQty || 0, min_amount: payload.minAmount || 0,
    type: payload.type, value: payload.value || 0,
    free_product_id: payload.freeProductId || 0, free_qty: payload.freeQty || 0,
    priority: payload.priority || 100, stackable: !!payload.stackable,
    date_start: payload.dateStart || '', date_end: payload.dateEnd || '',
    is_active: payload.isActive === false ? 'FALSE' : 'TRUE'
  });
  return { success: true, promotionId: id };
}

function updatePromotion(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  centralUpdate('discount_rules', payload.id, {
    name: payload.name, product_group_id: payload.productGroupId, product_id: payload.productId,
    trigger_group_ids: (payload.triggerGroupIds || []).join(','), customer_group_id: payload.customerGroupId,
    min_qty: payload.minQty, min_amount: payload.minAmount, type: payload.type, value: payload.value,
    free_product_id: payload.freeProductId, free_qty: payload.freeQty, priority: payload.priority,
    stackable: !!payload.stackable, date_start: payload.dateStart, date_end: payload.dateEnd,
    is_active: payload.isActive
  });
  return { success: true };
}

function deactivatePromotion(session, payload) {
  var err = _requirePermission(session, 'promotions', 'edit'); if (err) return err;
  centralUpdate('discount_rules', payload.id, { is_active: 'FALSE' });
  return { success: true };
}
