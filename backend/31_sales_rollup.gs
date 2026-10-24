/**
 * ===================== สรุปยอดขายรายวัน (rollup) =====================
 * ทำไมต้องมี: แดชบอร์ดฝั่งบริษัทเคยเปิดไฟล์ Sheet ของ **ทุกตัวแทน** แล้วอ่าน sales_orders ทั้งชีต
 * เพื่อกรองเฉพาะวันนี้ — วัดจริง 2026-09-24 ได้ 16–18 วินาที (7 ตัวแทน) และโตเป็นเส้นตรงตามจำนวนตัวแทน
 * ตอนนี้ทุกครั้งที่บันทึก/ยกเลิกบิล ระบบจะบวก-ลบยอดลงตาราง `sales_daily` ในชีตกลางแทน
 * แดชบอร์ดจึงอ่านชีตเดียวจบ (O(1) ไม่ขึ้นกับจำนวนตัวแทน)
 *
 * ตาราง `sales_daily`: 1 แถว = 1 ตัวแทน × 1 วัน
 *   (record_id, tenant_id, sale_date, bills, revenue, revenue_ex_vat, updated_at)
 * ตัวเลขนี้เป็น "ยอดสุทธิที่ยังไม่ถูกยกเลิก" — ยกเลิกบิลแล้วหักออกทันที
 *
 * ★★★ **เก็บสองยอด**: `revenue` = ยอดรวมภาษี (ยอดบนเอกสาร ที่ต้องไปเก็บเงิน) ·
 *   `revenue_ex_vat` = ยอดขายก่อน VAT ซึ่งเป็นตัวที่แดชบอร์ดแสดงเป็น "ยอดขาย" (กติกาเจ้าของระบบ
 *   24 ต.ค. 2026 — คำอธิบายอยู่ที่ `orderExVat` ใน 18_pricing_engine.gs)
 *   **ถอดกลับทีหลังไม่ได้** จึงต้องเก็บทั้งคู่: บิลที่มีสินค้ายกเว้นภาษีปนอยู่ หาร 1.07 ย้อนหลังได้เลขผิด
 *   และบิลเก่าอาจใช้อัตราภาษีคนละตัวกับวันนี้ · แถวเก่าที่ยังไม่มีคอลัมน์นี้ = 0 ซ่อมด้วย rebuildSalesDaily
 *
 * กติกา: ทุกจุดที่เขียน sales_orders ต้องเรียก bumpSalesDaily() ด้วยเสมอ (ดู 07_sales.gs, 19_sales_admin.gs)
 * ถ้าตัวเลขเพี้ยน (เช่น แก้ชีตด้วยมือ) ซ่อมได้ด้วย rebuildSalesDaily('yyyy-mm-dd') ใน 99_dev_tools.gs
 */

function _salesDailyKey(tenantId, dateStr) { return String(tenantId) + '|' + String(dateStr); }

/**
 * บวก/ลบยอดของตัวแทน 1 รายในวันหนึ่ง (billsDelta ติดลบได้ตอนยกเลิกบิล)
 * ★ `exVatDelta` ไม่ส่งมา = ถือว่ายอดก่อนภาษีขยับเท่ากับยอดรวม (บิลที่ไม่คิด VAT) —
 *   **อย่าเดาด้วยการหาร** ให้ผู้เรียกคิดจาก `orderExVat` มาแล้วส่งมา จุดเรียกเท่านั้นที่รู้ภาพนิ่งภาษีของบิล
 */
function bumpSalesDaily(tenantId, dateStr, billsDelta, revenueDelta, exVatDelta) {
  if (!tenantId || !dateStr) return;
  if (exVatDelta === undefined || exVatDelta === null) exVatDelta = revenueDelta;
  try {
    var sh = centralSheet('sales_daily');
    centralEnsureColumns('sales_daily');          // แถวเก่ายังไม่มีคอลัมน์ revenue_ex_vat
    var data = sh.getDataRange().getValues();
    var hdr = data[0];
    var cT = hdr.indexOf('tenant_id'), cD = hdr.indexOf('sale_date'), cB = hdr.indexOf('bills'),
        cR = hdr.indexOf('revenue'), cX = hdr.indexOf('revenue_ex_vat'), cU = hdr.indexOf('updated_at');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cT]) === String(tenantId) && _dOnly(data[i][cD]) === String(dateStr)) {
        sh.getRange(i + 1, cB + 1).setValue(Math.max(0, (Number(data[i][cB]) || 0) + (Number(billsDelta) || 0)));
        sh.getRange(i + 1, cR + 1).setValue(Math.max(0, Math.round(((Number(data[i][cR]) || 0) + (Number(revenueDelta) || 0)) * 100) / 100));
        if (cX !== -1) sh.getRange(i + 1, cX + 1).setValue(Math.max(0, Math.round(((Number(data[i][cX]) || 0) + (Number(exVatDelta) || 0)) * 100) / 100));
        sh.getRange(i + 1, cU + 1).setValue(nowStr());
        centralInvalidate('sales_daily');
        return;
      }
    }
    centralAppend('sales_daily', { record_id: centralNextId('sales_daily'), tenant_id: tenantId, sale_date: dateStr,
      bills: Math.max(0, Number(billsDelta) || 0), revenue: Math.max(0, Number(revenueDelta) || 0),
      revenue_ex_vat: Math.max(0, Number(exVatDelta) || 0), updated_at: nowStr() });
  } catch (e) {
    // ยอดสรุปพังไม่ควรทำให้ "บันทึกบิล" พังตาม — ซ่อมด้วย rebuildSalesDaily ทีหลังได้
    Logger.log('bumpSalesDaily ล้มเหลว (' + tenantId + ' ' + dateStr + '): ' + e.message);
  }
}

/**
 * ยอดของทุกตัวแทนในวันที่ระบุ → { tenantId: { bills, revenue, revenueInclVat } }
 * ★★ `revenue` = **ยอดก่อน VAT** ตามกติกา "ตัวเลขยอดขายแสดงก่อนภาษี" (24 ต.ค. 2026)
 *   ยอดรวมภาษีคือ `revenueInclVat` · ชื่อ `revenue` ให้ความหมายเดียวกันทุกที่ในระบบ
 *   (รายงานใน 41_sales_reports.gs ก็ใช้ชื่อนี้กับยอดก่อนภาษีเหมือนกัน) จะได้ไม่ต้องจำว่าที่ไหนรวมภาษี
 * ★ แถวเก่าที่บันทึกก่อนมีคอลัมน์ revenue_ex_vat จะได้ 0 — ตกไปใช้ยอดรวมภาษีไว้ก่อน
 *   ดีกว่าโชว์ศูนย์ให้คนตกใจ และซ่อมให้ตรงได้ด้วย rebuildSalesDaily ของวันนั้น
 */
function salesDailyMap(dateStr) {
  var out = {};
  try {
    centralObjects('sales_daily').forEach(function(r) {
      if (_dOnly(r.sale_date) !== String(dateStr)) return;
      var incl = Number(r.revenue) || 0, ex = Number(r.revenue_ex_vat) || 0;
      out[String(r.tenant_id)] = { bills: Number(r.bills) || 0, revenue: ex || incl, revenueInclVat: incl };
    });
  } catch (e) { Logger.log('salesDailyMap: ' + e.message); }
  return out;
}

/**
 * สร้างยอดสรุปของวันหนึ่งใหม่จากข้อมูลจริงในชีตของตัวแทน (ช้า — เปิดไฟล์ทุกตัวแทน)
 * ใช้ตอนเริ่มใช้ระบบ rollup ครั้งแรก หรือเมื่อสงสัยว่าตัวเลขเพี้ยน
 */
function rebuildSalesDaily(dateStr) {
  var date = String(dateStr || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  var sh = centralSheet('sales_daily');
  deleteRowsWhere(sh, 'sale_date', date);
  var rows = [];
  centralObjects('tenants').forEach(function(t) {
    try {
      // นิยาม "นับเป็นยอดขาย" ต้องตรงกับ bumpSalesDaily ทุกจุด ไม่งั้นซ่อมแล้วได้เลขคนละชุด
      var orders = tenantObjects(t.tenant_id, 'sales_orders').filter(function(o) {
        return _dOnly(o.created_at) === date && saleCountsInDaily(o.status);
      });
      if (!orders.length) return;
      rows.push({ tenant_id: t.tenant_id, sale_date: date, bills: orders.length,
        revenue: Math.round(orders.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0) * 100) / 100,
        // ยอดก่อนภาษีอ่านจากภาพนิ่งที่บิลเก็บไว้ ไม่ได้หารย้อนหลัง (ดู orderExVat)
        revenue_ex_vat: Math.round(orders.reduce(function(s, o) { return s + orderExVat(o); }, 0) * 100) / 100,
        updated_at: nowStr() });
    } catch (e) { Logger.log('rebuildSalesDaily ข้าม ' + t.tenant_id + ': ' + e.message); }
  });
  var nextId = centralNextId('sales_daily');
  rows.forEach(function(r, i) { r.record_id = nextId + i; });
  if (rows.length) centralAppendMany('sales_daily', rows);
  centralInvalidate('sales_daily');
  Logger.log('rebuildSalesDaily ' + date + ': ' + rows.length + ' ตัวแทน');
  return { success: true, date: date, tenants: rows.length, rows: rows };
}
