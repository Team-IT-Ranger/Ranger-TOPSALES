/**
 * ===================== เชื่อมสต็อกรถกับคลังกลาง + ต้นทุนขายของการขายจากรถ =====================
 * เปิดใช้ที่เมนู 5.9.1 (ค่าตั้ง `van_issue`) · เทสต์หมวด "สต็อกรถเชื่อมคลัง"
 *
 * ★★ ปัญหาที่ปิด: `van_stock` อยู่ในไฟล์ของตัวแทนและ **ไม่เคยเชื่อมกับ `warehouse_stock` เลย**
 *   `restockVan` เดิมแค่บวกเลขขึ้นรถ ไม่ลดคลังกลาง → ของบนรถไม่มีฐานต้นทุนอยู่ในระบบ
 *   จึงตัดต้นทุนขายให้การขายจากรถไม่ได้ (ดูขอบเขตที่เขียนไว้ใน 50_cogs.gs)
 *   และของชิ้นเดียวกันถูกนับสองรอบ: อยู่ในคลังกลางด้วย อยู่บนรถด้วย
 *
 * ★ โมเดลที่ใช้ — **เบิกขึ้นรถ = ย้ายคลัง ไม่ใช่การขาย**
 *     คลังกลาง ──(เบิกขึ้นรถ)──▶ รถ ──(ขายหน้าร้าน)──▶ ลูกค้า
 *       ลดคลังกลาง                                   ลงบัญชี Dr 5100 / Cr 1300
 *       **ไม่ลงบัญชี**                                 (ของออกจากกิจการตรงนี้)
 *   ของยังเป็นสินค้าคงเหลือของกิจการตลอดเวลาที่อยู่บนรถ บัญชี 1300 จึงต้องไม่ขยับตอนเบิก
 *   ★★ ลงบัญชีตอนเบิกเมื่อไหร่ = ตัดต้นทุนให้ของที่ยังขายไม่ออก กำไรเดือนนั้นหายไปเฉยๆ
 *
 * ★ **รถพกต้นทุนติดตัวมาตั้งแต่ตอนเบิก** (`van_stock.avg_cost`) ไม่ใช่ไปอ่านต้นทุนคลังตอนขาย
 *   ต้นทุนเฉลี่ยของคลังขยับทุกครั้งที่รับของเข้า — อ่านตอนขายจะได้ต้นทุนของล็อตที่รถไม่ได้เอาไป
 *   และวิธีคิดต้นทุน (เฉลี่ย/FIFO/มาตรฐาน) ถูกใช้ **ตอนของออกจากคลัง** ซึ่งคือตอนเบิก
 *
 * ★★★ ปิดไว้เป็นค่าเริ่มต้น เพราะ **เปิดแล้วการเบิกของขึ้นรถจะถูกปฏิเสธถ้าคลังกลางมีของไม่พอ**
 *   ตัวแทนที่ยังไม่เคยทำใบรับของเข้าคลังเลย คลังจะเป็นศูนย์ทั้งที่รถวิ่งขายอยู่จริงทุกวัน
 *   → เปิดได้ก็ต่อเมื่อข้อมูลคลังกลางตรงกับของจริงแล้วเท่านั้น (หน้าตั้งค่าเขียนเตือนไว้)
 */

/** เปิดใช้การเชื่อมสต็อกรถกับคลังกลางหรือยัง (ต่อสมุด) */
function vanIssueOn(scope) {
  var st = _acctSettings(_cogsBook(scope));
  return st.vanIssue === 'on';
}

/** ต้นทุนต่อหน่วยที่ควรใช้ "ตอนของออกจากคลัง" ตามวิธีที่ตั้งไว้ */
function _vanIssueUnitCost(scope, warehouseId, productId, baseQty, avgCost) {
  var st = _acctSettings(_cogsBook(scope));
  /* ปิดการตัดต้นทุนอยู่ ก็ยังต้องพกต้นทุนขึ้นรถไว้ (เผื่อเปิดทีหลัง) — ใช้ต้นทุนเฉลี่ยคลัง */
  var method = st.costMethod === 'none' ? 'average' : st.costMethod;
  var total = _cogsAmount(scope, warehouseId, productId, baseQty, method, avgCost);
  return baseQty > 0 ? _money(total / baseQty) : 0;
}

/**
 * เบิกของขึ้นรถ: ตัดจากคลังกลางจริง แล้วคืนต้นทุนต่อหน่วยของแต่ละสินค้าไปให้ผู้เรียกเขียนลง van_stock
 * @param items [{ productId, qty }] — qty เป็น **หน่วยฐาน** (เหมือนที่ van_stock เก็บ)
 * @return { success, cost:{pid:unitCost}, message? }
 */
function issueVanStockFromWarehouse(tenantId, items, userId, refNo) {
  var scope = _saleStockScope(tenantId);
  if (!vanIssueOn(scope)) return { success: true, cost: null, skipped: 'ยังไม่ได้เปิดการเชื่อมสต็อกรถกับคลังกลาง' };

  var warehouseId = _ensureScopeWarehouse(scope);
  var stock = {}, avg = {};
  _scoped('warehouse_stock', scope).forEach(function(r) {
    if (String(r.warehouse_id) !== String(warehouseId)) return;
    stock[String(r.product_id)] = Number(r.qty) || 0;
    avg[String(r.product_id)] = Number(r.avg_cost) || 0;
  });

  /* ★ ของไม่พอ = ปฏิเสธทั้งใบ ไม่เบิกครึ่งๆ กลางๆ (หลักเดียวกับการตัดสต็อกตอนขาย)
     เบิกบางส่วนแล้วไม่บอก = พนักงานขับรถออกไปโดยคิดว่ามีของครบ */
  var names = {};
  centralObjects('products').forEach(function(p) { names[String(p.record_id)] = p.name; });
  var short = [];
  var need = {};
  (items || []).forEach(function(it) {
    var q = parseFloat(it.qty) || 0;
    if (q > 0) need[String(it.productId)] = (need[String(it.productId)] || 0) + q;
  });
  Object.keys(need).forEach(function(pid) {
    var have = stock[pid] || 0;
    if (have < need[pid]) short.push((names[pid] || ('สินค้า ' + pid)) + ' (คลังมี ' + have + ' ต้องเบิก ' + need[pid] + ')');
  });
  if (short.length) return { success: false, message: 'ของในคลังกลางไม่พอให้เบิก: ' + short.join(' · ') };

  var cost = {};
  Object.keys(need).forEach(function(pid) {
    cost[pid] = _vanIssueUnitCost(scope, warehouseId, pid, need[pid], avg[pid] || 0);
    /* ★ `van_issue` เป็น move type ของตัวเอง ไม่ใช่ `sale_out` — รายงานเคลื่อนไหวสินค้าต้องแยกออกได้
       ว่าของออกจากคลังเพราะ "ขายไปแล้ว" หรือ "ย้ายขึ้นรถแต่ยังไม่ขาย" */
    _applyStockIn(scope, warehouseId, pid, -need[pid], cost[pid], 'van_issue', 'VAN_RESTOCK',
      refNo || '', 'เบิกขึ้นรถ', userId);
  });
  return { success: true, cost: cost };
}

/** ต้นทุนเฉลี่ยของของบนรถคันหนึ่ง (ต่อพนักงาน + สินค้า) */
function vanStockCost(tenantId, lineUserId) {
  var out = {};
  tenantObjectsIfExists(tenantId, 'van_stock').forEach(function(r) {
    if (String(r.line_user_id) !== String(lineUserId)) return;
    out[String(r.product_id)] = { qty: Number(r.qty) || 0, cost: Number(r.avg_cost) || 0 };
  });
  return out;
}

/**
 * อัปเดตต้นทุนเฉลี่ยบนรถหลังเบิกของขึ้นไป — ถ่วงน้ำหนักแบบเดียวกับคลัง
 * ★ ของออกจากรถ (ขาย/คืน) ไม่เปลี่ยนต้นทุนเฉลี่ย เหมือนกติกาของ `_applyStockIn`
 */
function bumpVanAvgCost(tenantId, lineUserId, pid, addQty, unitCost) {
  var sh = tenantSheet(tenantId, 'van_stock');
  var data = sh.getDataRange().getValues();
  var hdr = data[0];
  var uidCol = hdr.indexOf('line_user_id'), pidCol = hdr.indexOf('product_id'),
      qtyCol = hdr.indexOf('qty'), costCol = hdr.indexOf('avg_cost');
  if (costCol === -1) return;                       // ชีตยังไม่มีคอลัมน์ (ensureTenantSheetsCurrent จะเติมให้)
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][uidCol]) !== String(lineUserId) || String(data[i][pidCol]) !== String(pid)) continue;
    var newQty = Number(data[i][qtyCol]) || 0;      // แถวถูกบวกจำนวนใหม่ไปแล้วก่อนเรียกตัวนี้
    var oldQty = newQty - addQty, oldCost = Number(data[i][costCol]) || 0;
    var blended = newQty > 0 ? _money((Math.max(0, oldQty) * oldCost + addQty * unitCost) / newQty) : unitCost;
    sh.getRange(i + 1, costCol + 1).setValue(blended);
    return;
  }
}

/* ═══════════ ต้นทุนขายของการขายจากรถ ═══════════ */
function _vanCogsRefId(order) { return 'VAN#' + String(order.record_id); }

/**
 * ลงต้นทุนขายของบิลที่ขายจากรถ — ใช้ต้นทุนที่รถพกมา ไม่ใช่ต้นทุนคลัง ณ ตอนขาย
 * @param need { productId: baseQty } ชุดเดียวกับที่ตัดสต็อกรถ
 */
function postVanSaleCogs(tenantId, order, need, userId) {
  try {
    var scope = _saleStockScope(tenantId);
    if (!vanIssueOn(scope)) return { posted: false, skipped: 'ยังไม่ได้เปิดการเชื่อมสต็อกรถกับคลังกลาง' };

    var book = _cogsBook(scope);
    var st = _acctSettings(book);
    if (st.costMethod === 'none') return { posted: false, skipped: 'ปิดการตัดต้นทุนอัตโนมัติ' };

    var when = _dOnly(order.created_at) || _todayStr();
    if (st.cogsFrom && when < st.cogsFrom) return { posted: false, skipped: 'บิลลงวันที่ก่อนวันเริ่มตัดต้นทุน' };

    var refId = _vanCogsRefId(order);
    if (_findCogsJournal(book, refId)) return { posted: false, skipped: 'ลงต้นทุนบิลนี้ไปแล้ว' };

    var onVan = vanStockCost(tenantId, order.sale_by);
    var total = 0;
    Object.keys(need || {}).forEach(function(pid) {
      var c = (onVan[String(pid)] || {}).cost || 0;
      total += (Number(need[pid]) || 0) * c;
    });
    total = _money(total);
    if (!(total > 0)) return { posted: false, skipped: 'ต้นทุนรวมเป็น 0 — ของบนรถยังไม่มีราคาทุน' };

    var jr = _postJournal({ date: when, source: 'SALES', refType: 'SALES_COGS', refId: refId, tenantId: book,
      memo: 'ต้นทุนขาย (ขายจากรถ) ' + (order.order_code || ''), createdBy: userId, lines: [
        { accountCode: GL_ACCT.COGS, description: 'ต้นทุนขายจากรถ ' + (order.order_code || ''), debit: total, credit: 0 },
        { accountCode: GL_ACCT.INVENTORY, description: 'ตัดสินค้าคงเหลือ (ของบนรถ)', debit: 0, credit: total }
      ] });
    if (!jr.success) return { posted: false, skipped: jr.message || 'ลงบัญชีไม่สำเร็จ' };
    return { posted: true, amount: total, journalNo: jr.journalNo };
  } catch (e) {
    Logger.log('postVanSaleCogs ล้มเหลว: ' + (e.stack || e.message));
    return { posted: false, skipped: 'ผิดพลาด: ' + e.message };
  }
}

/** กลับรายการต้นทุนขายจากรถ (ยกเลิกบิล) — ยอดเดิมเสมอ เหตุผลเดียวกับ reverseSaleCogs */
function reverseVanSaleCogs(tenantId, order, userId, reason) {
  try {
    var book = _cogsBook(_saleStockScope(tenantId));
    var j = _findCogsJournal(book, _vanCogsRefId(order));
    if (!j) return { posted: false, skipped: 'ไม่เคยลงต้นทุนบิลนี้' };
    var total = Number(j.total_debit) || 0;
    if (!(total > 0)) return { posted: false, skipped: 'ใบเดิมยอดเป็น 0' };
    var jr = _postJournal({ date: _todayStr(), source: 'SALES', refType: 'SALES_COGS_REV',
      refId: _vanCogsRefId(order), tenantId: book,
      memo: 'กลับรายการต้นทุนขายจากรถ ' + (order.order_code || '') + (reason ? ' — ' + reason : ''),
      createdBy: userId, lines: [
        { accountCode: GL_ACCT.INVENTORY, description: 'รับของกลับขึ้นรถ ' + (order.order_code || ''), debit: total, credit: 0 },
        { accountCode: GL_ACCT.COGS, description: 'กลับต้นทุนขายจากรถ', debit: 0, credit: total }
      ] });
    if (!jr.success) return { posted: false, skipped: jr.message || 'ลงบัญชีไม่สำเร็จ' };
    centralUpdate('gl_journals', j.record_id, { status: 'voided' });
    return { posted: true, amount: total, journalNo: jr.journalNo };
  } catch (e) {
    Logger.log('reverseVanSaleCogs ล้มเหลว: ' + (e.stack || e.message));
    return { posted: false, skipped: 'ผิดพลาด: ' + e.message };
  }
}
