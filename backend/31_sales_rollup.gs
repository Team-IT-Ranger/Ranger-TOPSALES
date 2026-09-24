/**
 * ===================== สรุปยอดขายรายวัน (rollup) =====================
 * ทำไมต้องมี: แดชบอร์ดฝั่งบริษัทเคยเปิดไฟล์ Sheet ของ **ทุกตัวแทน** แล้วอ่าน sales_orders ทั้งชีต
 * เพื่อกรองเฉพาะวันนี้ — วัดจริง 2026-09-24 ได้ 16–18 วินาที (7 ตัวแทน) และโตเป็นเส้นตรงตามจำนวนตัวแทน
 * ตอนนี้ทุกครั้งที่บันทึก/ยกเลิกบิล ระบบจะบวก-ลบยอดลงตาราง `sales_daily` ในชีตกลางแทน
 * แดชบอร์ดจึงอ่านชีตเดียวจบ (O(1) ไม่ขึ้นกับจำนวนตัวแทน)
 *
 * ตาราง `sales_daily`: 1 แถว = 1 ตัวแทน × 1 วัน (record_id, tenant_id, sale_date, bills, revenue, updated_at)
 * ตัวเลขนี้เป็น "ยอดสุทธิที่ยังไม่ถูกยกเลิก" — ยกเลิกบิลแล้วหักออกทันที
 *
 * กติกา: ทุกจุดที่เขียน sales_orders ต้องเรียก bumpSalesDaily() ด้วยเสมอ (ดู 07_sales.gs, 19_sales_admin.gs)
 * ถ้าตัวเลขเพี้ยน (เช่น แก้ชีตด้วยมือ) ซ่อมได้ด้วย rebuildSalesDaily('yyyy-mm-dd') ใน 99_dev_tools.gs
 */

function _salesDailyKey(tenantId, dateStr) { return String(tenantId) + '|' + String(dateStr); }

/** บวก/ลบยอดของตัวแทน 1 รายในวันหนึ่ง (billsDelta ติดลบได้ตอนยกเลิกบิล) */
function bumpSalesDaily(tenantId, dateStr, billsDelta, revenueDelta) {
  if (!tenantId || !dateStr) return;
  try {
    var sh = centralSheet('sales_daily');
    var data = sh.getDataRange().getValues();
    var hdr = data[0];
    var cT = hdr.indexOf('tenant_id'), cD = hdr.indexOf('sale_date'), cB = hdr.indexOf('bills'),
        cR = hdr.indexOf('revenue'), cU = hdr.indexOf('updated_at');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cT]) === String(tenantId) && _dOnly(data[i][cD]) === String(dateStr)) {
        sh.getRange(i + 1, cB + 1).setValue(Math.max(0, (Number(data[i][cB]) || 0) + (Number(billsDelta) || 0)));
        sh.getRange(i + 1, cR + 1).setValue(Math.max(0, Math.round(((Number(data[i][cR]) || 0) + (Number(revenueDelta) || 0)) * 100) / 100));
        sh.getRange(i + 1, cU + 1).setValue(nowStr());
        centralInvalidate('sales_daily');
        return;
      }
    }
    centralAppend('sales_daily', { record_id: centralNextId('sales_daily'), tenant_id: tenantId, sale_date: dateStr,
      bills: Math.max(0, Number(billsDelta) || 0), revenue: Math.max(0, Number(revenueDelta) || 0), updated_at: nowStr() });
  } catch (e) {
    // ยอดสรุปพังไม่ควรทำให้ "บันทึกบิล" พังตาม — ซ่อมด้วย rebuildSalesDaily ทีหลังได้
    Logger.log('bumpSalesDaily ล้มเหลว (' + tenantId + ' ' + dateStr + '): ' + e.message);
  }
}

/** ยอดของทุกตัวแทนในวันที่ระบุ → { tenantId: { bills, revenue } } */
function salesDailyMap(dateStr) {
  var out = {};
  try {
    centralObjects('sales_daily').forEach(function(r) {
      if (_dOnly(r.sale_date) !== String(dateStr)) return;
      out[String(r.tenant_id)] = { bills: Number(r.bills) || 0, revenue: Number(r.revenue) || 0 };
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
      var orders = tenantObjects(t.tenant_id, 'sales_orders').filter(function(o) {
        return _dOnly(o.created_at) === date && String(o.status) !== 'cancelled';
      });
      if (!orders.length) return;
      rows.push({ tenant_id: t.tenant_id, sale_date: date, bills: orders.length,
        revenue: Math.round(orders.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0) * 100) / 100,
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
