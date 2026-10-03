/**
 * ปรับ "ขนาดหน่วยฐาน" ของสินค้า — งานครั้งเดียวที่รันจาก Apps Script editor (ไม่ต้อง Deploy)
 *
 * ที่มา (3 ต.ค. 2026): กาวดักแมลงวัน 10503/10504 เดิมระบบนับหน่วยฐานเป็น "แผ่น" (1 ลัง = 500) ตามชีต unitofitem
 * แต่ร้านค้าขายที่หน่วย "ซองเล็ก" = PC และ 1 ลัง = 10 ซองใหญ่ = 50 ซองเล็ก → หน่วยฐานต้องเล็กลงเป็น 1/10
 * ค่า factor ใน product_units / ชุดราคา แก้ผ่านหน้าจอ/API ปกติได้ แต่ "ตัวเลขที่เก็บเป็นหน่วยฐานไว้แล้ว" แก้ด้วย action ปกติไม่ได้ —
 * ถ้าแก้ factor อย่างเดียว สต็อก 5,000 (= 10 ลัง × 500) จะกลายเป็น 100 ลังทันทีโดยไม่มีอะไรฟ้อง
 *
 * สิ่งที่ปรับ (ตารางกลาง เฉพาะสินค้าที่ระบุ · หาร qty ด้วย divisor, คูณต้นทุนต่อหน่วยด้วย divisor → มูลค่าคงเดิม):
 *   warehouse_stock  qty ÷ d · avg_cost × d
 *   stock_ledger     change_qty, balance_after ÷ d · unit_cost × d
 *   stock_reservations qty ÷ d (ทุกสถานะ)
 *   gr_items         unit_factor ÷ d · base_qty ÷ d · unit_cost × d   (เฉพาะแถวที่ unit_factor = factor เดิมของหน่วยลัง)
 *   po_items         unit_factor ÷ d                                  (เหมือนกัน — ไม่แตะ qty/received_qty ซึ่งเป็นหน่วยลังอยู่แล้ว)
 * ไม่ได้ปรับ: van_stock / order_items / stock_movements ในไฟล์ของตัวแทน (ตรวจก่อนรันว่าไม่มีของสินค้านี้ — รายงานผลขายและ van ของ 10503/10504 ว่างตอนสั่งงาน)
 *
 * กันรันซ้ำ: บันทึกใน Script Property RESCALED_<รหัส…> — รันครั้งที่สองจะปฏิเสธ (การหารซ้ำทำให้ตัวเลขเพี้ยนอีก 10 เท่า)
 */
function rescaleProductBaseUnit(productCodes, oldCaseFactor, divisor, dryRun) {
  var codes = (productCodes || []).map(String);
  divisor = Number(divisor);
  oldCaseFactor = Number(oldCaseFactor);
  if (!codes.length || !(divisor > 0) || divisor === 1 || !(oldCaseFactor > 0)) throw new Error('พารามิเตอร์ไม่ถูกต้อง');
  var propKey = 'RESCALED_' + codes.slice().sort().join('_');
  var props = PropertiesService.getScriptProperties();
  if (!dryRun && props.getProperty(propKey)) throw new Error('เคยปรับสินค้าชุดนี้แล้วเมื่อ ' + props.getProperty(propKey) + ' — ห้ามรันซ้ำ');

  var ids = {};
  centralObjects('products').forEach(function(p) { if (codes.indexOf(String(p.product_code)) !== -1) ids[String(p.record_id)] = String(p.product_code); });
  if (Object.keys(ids).length !== codes.length) throw new Error('ไม่พบสินค้าครบ ' + codes.join(',') + ' (เจอ ' + Object.keys(ids).length + ')');
  var mine = function(r) { return ids[String(r.product_id)] !== undefined; };
  var n = function(v) { return Number(v) || 0; };
  var round = function(v) { return Math.round(v * 10000) / 10000; };
  var report = [];
  var apply = function(table, rows, build) {
    rows.forEach(function(r) {
      var fields = build(r);
      if (!fields) return;
      report.push(table + ' #' + r.record_id + ' สินค้า ' + ids[String(r.product_id)] + ' ' + JSON.stringify(fields));
      if (!dryRun) centralUpdate(table, r.record_id, fields);
    });
  };

  apply('warehouse_stock', centralObjects('warehouse_stock').filter(mine), function(r) {
    return { qty: round(n(r.qty) / divisor), avg_cost: round(n(r.avg_cost) * divisor) };
  });
  apply('stock_ledger', centralObjects('stock_ledger').filter(mine), function(r) {
    return { change_qty: round(n(r.change_qty) / divisor), balance_after: round(n(r.balance_after) / divisor), unit_cost: round(n(r.unit_cost) * divisor) };
  });
  apply('stock_reservations', centralObjects('stock_reservations').filter(mine), function(r) {
    return { qty: round(n(r.qty) / divisor) };
  });
  apply('gr_items', centralObjects('gr_items').filter(mine), function(r) {
    if (n(r.unit_factor) !== oldCaseFactor) return null;   // หน่วยอื่น (เช่น ชิ้น = 1) ไม่ต้องแก้
    return { unit_factor: round(n(r.unit_factor) / divisor), base_qty: round(n(r.base_qty) / divisor), unit_cost: round(n(r.unit_cost) * divisor) };
  });
  apply('po_items', centralObjects('po_items').filter(mine), function(r) {
    if (n(r.unit_factor) !== oldCaseFactor) return null;
    return { unit_factor: round(n(r.unit_factor) / divisor) };
  });

  if (!dryRun) props.setProperty(propKey, nowStr());
  return report;
}

function _runGlueRescale(dry) {
  var rep = rescaleProductBaseUnit(['10503', '10504'], 500, 10, dry);
  Logger.log((dry ? '[ดูอย่างเดียว ยังไม่เขียน] ' : '[เขียนจริงแล้ว] ') + 'แก้ ' + rep.length + ' แถว');
  rep.forEach(function(l) { Logger.log(l); });
}
/** 1) Run ตัวนี้ก่อน — แค่รายงานว่าจะแก้อะไร ไม่เขียน */
function runRescaleGlueUnitsDryRun() { _runGlueRescale(true); }
/** 2) ดูผลข้อ 1 แล้วถูกต้อง ค่อย Run ตัวนี้ — เขียนจริง รันได้ครั้งเดียวต่อ env (รันซ้ำถูกปฏิเสธ) */
function runRescaleGlueUnits() { _runGlueRescale(false); }
