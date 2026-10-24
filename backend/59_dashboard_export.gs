/**
 * ============ ส่งยอดขายออกเป็นไฟล์กลางของ Dashboard บริษัท (CSV ต่อตัวแทน) ============
 * เจ้าของระบบสั่ง 24 ต.ค. 2026 · ให้ GAS trigger เป็นตัวรัน
 *
 * ★★★ นิยาม "ยอดขาย" ของไฟล์นี้ = **ใบที่ออกใบกำกับภาษีไปแล้วเท่านั้น** (เจ้าของระบบสั่ง)
 *   ใช้ `taxInvoiceRows()` ของ `58_tax_invoices.gs` **ตัวเดียวกับหน้าจอ 5.3.1** ไม่เขียนเกณฑ์ชุดที่สอง
 *   — ถ้ามีสองชุด วันหนึ่งเลขในไฟล์ที่ส่งให้ผู้บริหารกับเลขบนหน้าจอจะไม่ตรงกัน
 *     แล้วไม่มีใครบอกได้ว่าอันไหนถูก (บทเรียนเดียวกับ computePromoDiscount / splitVat)
 *
 * ★★ ตัวเลขยอดขายในไฟล์เป็น **ยอดก่อนภาษี** ตามกติกา 24 ต.ค. 2026 (ดู orderExVat ใน 18_pricing_engine.gs)
 *   และมียอดรวมภาษีอยู่คนละคอลัมน์ให้ฝั่งเก็บเงิน/ภาษีใช้ — อย่าเอาสองตัวนี้ไปรวมกัน
 *
 * โครงไฟล์: **1 ตัวแทน = 1 ไฟล์ `<รหัสย่อ>.csv`** (เช่น `BDC.csv` · ขายตรงในนามบริษัท = `HOUSE.csv`)
 *   · **1 แถว = 1 บรรทัดบิล (transaction line)** — เจ้าของระบบใช้ถึงระดับสินค้า
 *   · คอลัมน์เอกสารซ้ำทุกบรรทัดของใบเดียวกัน Dashboard จึง group เอายอดระดับใบได้เอง
 *
 * ★★★ เปลี่ยนจาก .xlsx มาเป็น .csv (เจ้าของระบบสั่ง 24 ต.ค. 2026) — ที่เร็วขึ้นไม่ใช่เพราะรูปแบบไฟล์
 *   แต่เพราะ **ไม่ต้องแตะ Google Sheets เลย**: เดิมต้องเขียนลงชีต → สั่ง export → อัปโหลดทับ
 *   (ยิงเน็ต 2 รอบ + เขียนชีตทั้งก้อน) · ตอนนี้ต่อสตริงในหน่วยความจำแล้วอัปโหลดรอบเดียวจบ
 *   และไม่ชนเพดาน 10 ล้านเซลล์ของชีต Google เมื่อข้อมูลโตขึ้น
 *
 * ★★ ราคาที่จ่ายไปกับการใช้ CSV — **รู้ตัวตั้งแต่ต้น ไม่ใช่เจอทีหลัง**:
 *   1. **CSV ไม่มีชีต** จึงต้องแยกไฟล์ต่อตัวแทน (ซึ่งคือสิ่งที่สั่งมา)
 *   2. **เลขที่มีศูนย์นำหน้าไม่มีอะไรปกป้อง** — `เลขผู้เสียภาษี` 0105... และ `สาขา` 00000
 *      ถ้าเปิดด้วย Excel ด้วยการดับเบิลคลิก ศูนย์หน้าจะหาย · ฝั่งที่อ่านไฟล์ต้องกำหนดชนิดคอลัมน์
 *      เป็นข้อความเอง (ปลายทางเป็นโปรแกรมอ่าน จึงยอมรับข้อนี้ได้)
 *   3. วันที่/ตัวเลขเป็นข้อความล้วน — เขียนวันที่เป็น `yyyy-mm-dd` (ISO) ซึ่งไม่กำกวมทุกภาษา
 */

var DASH_PROP_FILE_IDS = 'DASHBOARD_CSV_FILEIDS';   // {รหัสตัวแทน: fileId} — คงไฟล์เดิมไว้ ลิงก์จะได้ไม่ตาย
var DASH_PROP_FOLDER   = 'DASHBOARD_FOLDER_ID';     // โฟลเดอร์ปลายทาง (ไม่ตั้ง = โฟลเดอร์ db ของ env)

/* กันไฟล์บวมจนรันไม่จบใน 6 นาที — เกินเท่านี้ให้ไปตั้งช่วงวันที่แทนการดึงทั้งหมด */
var DASH_MAX_ROWS = 20000;

/* ★★ ระดับ **บรรทัดบิล** (transaction line) ตามที่เจ้าของระบบสั่ง 24 ต.ค. 2026
   คอลัมน์เอกสาร (วันที่/เลขที่ใบกำกับ/ลูกค้า/…) ซ้ำอยู่ทุกบรรทัดของใบเดียวกัน เพื่อให้ Dashboard
   **group เอายอดระดับใบได้เอง** — จึงมีชีตเดียวต่อตัวแทน ไม่ต้องมีชีตระดับใบให้รวมผิดชีต */
var DASH_HEADERS = [
  /* ★ `datasource` = ระบบต้นทางของแถวนี้ — Dashboard รวมข้อมูลจากหลายระบบไว้ด้วยกัน
     ต้องแยกออกได้ว่าแถวไหนมาจากที่ไหน · ค่าคงที่ `RTS` = Ranger TOPSALES */
  'datasource', 'วันที่', 'เลขที่ใบกำกับภาษี', 'เลขที่บิล', 'รอบจัดส่ง', 'รหัสตัวแทน',
  'รหัสลูกค้า', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี', 'สาขา', 'พนักงานขาย', 'วิธีชำระ',
  'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนที่ขาย', 'หน่วยขาย', 'ราคาขายต่อหน่วย',
  'ยอดเงินตามราคาขาย', 'ส่วนลดรายบรรทัด', 'ส่วนลดท้ายบิล (เฉลี่ย)',
  'ยอดขายลบส่วนลดแล้ว', 'ยอดขายก่อนภาษี', 'ของแถม',
  /* ★★ ใบลดหนี้/ใบเพิ่มหนี้อยู่ชีตเดียวกันเป็น **แถวติดลบ/บวก** (เจ้าของระบบสั่ง 24 ต.ค. 2026)
     Dashboard บวกคอลัมน์เดียวได้ยอดสุทธิเลย ไม่ต้องไปลบจากอีกชีต (ซึ่งมีวันลืม)
     ★ `ประเภทรายการ` ไว้ให้กรองแยกเมื่ออยากดูเฉพาะยอดขายดิบ · `เอกสารอ้างอิง` = ใบกำกับที่ถูกปรับ */
  'ประเภทรายการ', 'เอกสารอ้างอิง'
];
var DASH_SOURCE = 'RTS';        // ระบบต้นทาง — ค่าคงที่ของทุกแถวที่ออกจากที่นี่
var DASH_KIND_SALE = 'ขาย', DASH_KIND_CREDIT = 'ลดหนี้', DASH_KIND_DEBIT = 'เพิ่มหนี้';

/** แถวของตัวแทนรายหนึ่ง — คืน array of array พร้อมเขียนลงชีต (1 แถว = 1 บรรทัดบิล) */
function _dashRowsFor(tenantId, opts) {
  opts = opts || {};
  var book = _normBook(tenantId);
  var docs = taxInvoiceRows(book, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, limit: DASH_MAX_ROWS + 1 });
  if (!docs.success) return { success: false, message: docs.message || 'อ่านใบกำกับภาษีไม่สำเร็จ' };

  var salesTenant = _bookSalesTenant(book);
  var products = {};
  centralObjects('products').forEach(function(p) { products[String(p.record_id)] = p; });

  // บรรทัดบิลทั้งหมดของตัวแทนนี้ จัดกลุ่มตามใบ — อ่านทีเดียว ไม่เปิดชีตซ้ำต่อใบ
  var itemsByOrder = {};
  tenantObjectsIfExists(salesTenant, 'order_items').forEach(function(it) {
    (itemsByOrder[String(it.order_id)] = itemsByOrder[String(it.order_id)] || []).push(it);
  });
  // ของที่ส่งจริงในแต่ละรอบ (บิลที่แยกรอบ ใบกำกับออกตามของที่ส่งรอบนั้น)
  var roundItems = {};
  tenantObjectsIfExists(salesTenant, 'delivery_round_items').forEach(function(ri) {
    (roundItems[String(ri.round_id)] = roundItems[String(ri.round_id)] || []).push(ri);
  });
  var orderById = {};
  tenantObjectsIfExists(salesTenant, 'sales_orders').forEach(function(o) { orderById[String(o.record_id)] = o; });

  var out = [];
  (docs.data || []).forEach(function(r) {
    /* ★ บิลที่ยกเลิกไม่เข้าไฟล์ — Dashboard บวกคอลัมน์ยอดขายตรงๆ ใส่ไปแล้วยอดจะเกิน
       (ของจริงที่ขายแล้วคืนของ ต้องเป็น "ใบลดหนี้" ไม่ใช่การยกเลิกบิล — ดูหมายเหตุท้ายไฟล์) */
    if (r.cancelled) return;
    var order = orderById[String(r.orderId)];
    if (!order) return;
    var items = itemsByOrder[String(r.orderId)] || [];
    /* ★★ "ขายได้เท่าไรจริง" ต่อบรรทัด ใช้ `soldNetByItem` ตัวเดียวกับใบลดหนี้ (18_pricing_engine.gs)
       ซึ่งเฉลี่ยส่วนลดท้ายบิลลงบรรทัดให้แล้ว — คิดเองที่นี่อีกชุดเมื่อไหร่ ยอดในไฟล์กับยอดที่ลดหนี้
       จะคนละตัวทันที */
    var netOf = soldNetByItem(order, items);

    /* รอบจัดส่ง: คิดตามสัดส่วนของที่ส่งจริงในรอบ (share = จำนวนในรอบ ÷ จำนวนที่สั่ง)
       ★ สูตรเดียวกับ `deliveryRoundAmounts` ใน 48_delivery_rounds.gs ที่ใช้ออกใบกำกับของรอบ
         ผลรวมรายบรรทัดจึงตรงกับยอดบนใบกำกับใบนั้น */
    var qtyInRound = null;
    if (r.roundId) {
      qtyInRound = {};
      (roundItems[String(r.roundId)] || []).forEach(function(ri) {
        qtyInRound[String(ri.item_id)] = (qtyInRound[String(ri.item_id)] || 0) + (parseFloat(ri.qty) || 0);
      });
    }

    items.forEach(function(it) {
      var ordered = parseFloat(it.qty) || 0;
      var qty = ordered, share = 1;
      if (qtyInRound) {
        qty = qtyInRound[String(it.record_id)] || 0;
        if (!qty || !ordered) return;                       // บรรทัดนี้ไม่ได้ส่งในรอบนี้
        share = qty / ordered;
      }
      var gross = _round2((parseFloat(it.line_total) || 0) * share);
      var net   = _round2((netOf[String(it.record_id)] || 0) * share);
      /* ★★ แยกส่วนลดสองชั้นให้เห็นคนละคอลัมน์ (เจ้าของระบบสั่ง 24 ต.ค. 2026)
         - `ส่วนลดรายบรรทัด` = ส่วนลดที่ผูกกับบรรทัดนั้นตั้งแต่ตอนขาย
         - `ส่วนลดท้ายบิล (เฉลี่ย)` = ส่วนลดที่ให้ทั้งบิล **กระจายลงบรรทัดตามน้ำหนักยอดขาย**
           (soldNetByItem เฉลี่ยตามสัดส่วน `line_total` และให้บรรทัดสุดท้ายรับเศษ
            ผลรวมจึงเท่ากับส่วนลดท้ายบิลเป๊ะ ไม่ขาดไม่เกินทีละสตางค์)
         ★ คิดเป็น "ส่วนที่เหลือ" จาก gross − net แทนที่จะคำนวณการเฉลี่ยซ้ำเองอีกชุด —
           ตัวเลขจึงบวกกลับได้เท่ากับยอดสุทธิเสมอ ไม่ว่าสูตรเฉลี่ยจะเปลี่ยนไปอย่างไรในอนาคต */
      var lineDisc = _round2((parseFloat(it.line_discount) || 0) * share);
      var billDisc = _round2(gross - net - lineDisc);
      var p = products[String(it.product_id)] || {};
      var free = isFlagOn(it.is_free) || String(it.is_free) === '1';

      out.push([
        DASH_SOURCE, _dashDate(r.docDate), r.docNo, r.orderCode || '', r.roundNo || '', tenantId,
        r.customerCode || '', r.customerName || '', r.taxId || '', r.branchCode || '',
        r.saleByName || '', r.paymentLabel || '',
        p.product_code || String(it.product_id || ''), p.name || '(สินค้าถูกลบ)',
        qty, it.unit_code || '', _round2(parseFloat(it.price) || 0),
        // ยอดขายลบส่วนลดแล้ว = ยอดตามราคาขาย − ส่วนลดรายบรรทัด − ส่วนลดท้ายบิลที่เฉลี่ยมา
        gross, lineDisc, billDisc, net,
        // ยอดขายก่อนภาษีของบรรทัด — ใช้ภาพนิ่งภาษีรายบรรทัด (กติกา 24 ต.ค. 2026)
        lineExVat(order, { line_total: net, tax_status: it.tax_status }),
        free ? 'ใช่' : '', DASH_KIND_SALE, ''
      ]);
    });
  });

  _dashAppendNotes(out, tenantId, book, salesTenant, opts, products, orderById);
  /* เรียงตามวันที่แล้วเลขเอกสาร — แถวใบลดหนี้ถูกต่อท้ายมา ถ้าไม่เรียง คนเปิดไฟล์จะเห็นมันกองอยู่ท้ายสุด
     (Dashboard ไม่สน แต่คนที่เปิดไฟล์ดูด้วยตาสนแน่ๆ) */
  out.sort(function(a, b) {
    // ★ ตำแหน่งผูกกับ DASH_HEADERS: [0]=datasource · [1]=วันที่ · [2]=เลขที่เอกสาร
    var da = a[1] instanceof Date ? a[1].getTime() : 0, db = b[1] instanceof Date ? b[1].getTime() : 0;
    return da - db || String(a[2]).localeCompare(String(b[2]));
  });
  return { success: true, rows: out, truncated: !!docs.truncated };
}

/**
 * ต่อท้ายด้วยแถวของ **ใบลดหนี้ (ติดลบ)** และ **ใบเพิ่มหนี้ (เป็นบวก)**
 *
 * ★★★ ทำไมต้องมีทั้งสองใบ ไม่ใช่เฉพาะใบลดหนี้: ทั้งคู่คือการปรับยอดหลังออกใบกำกับไปแล้ว
 *   (ม.86/10 กับ ม.86/9) · ใส่แต่ใบลดหนี้ = ยอดขายในไฟล์ **ต่ำกว่าความจริง** เท่าใบเพิ่มหนี้
 *   ซึ่งผิดคนละทางกับที่กลัวตอนแรก และเงียบเหมือนกัน
 *
 * ★★ ผูกกับ **พนักงานขายของบิลต้นทาง** ไม่ใช่คนที่กดออกใบลดหนี้ (ซึ่งเป็นแอดมินบัญชี) —
 *   ไม่งั้นยอดที่หักออกไปตกไปอยู่กับคนทำบัญชี แล้วยอดรายคนของพนักงานขายไม่เคยถูกหักเลย
 */
function _dashAppendNotes(out, tenantId, book, salesTenant, opts, products, orderById) {
  var cust = {};
  centralObjects('customers').forEach(function(c) { cust[String(c.record_id)] = c; });
  var roundNo = {};
  tenantObjectsIfExists(salesTenant, 'delivery_rounds').forEach(function(rd) {
    roundNo[String(rd.record_id)] = _int(rd.round_no);
  });

  var dFrom = String(opts.dateFrom || '').trim(), dTo = String(opts.dateTo || '').trim();

  [{ table: 'ar_credit_notes', items: 'ar_credit_note_items', noField: 'credit_note_no',
     kind: DASH_KIND_CREDIT, sign: -1 },
   { table: 'ar_debit_notes', items: 'ar_debit_note_items', noField: 'debit_note_no',
     kind: DASH_KIND_DEBIT, sign: 1 }].forEach(function(K) {

    var linesByNote = {};
    centralObjects(K.items).forEach(function(l) {
      (linesByNote[String(l.note_id)] = linesByNote[String(l.note_id)] || []).push(l);
    });

    centralObjects(K.table).forEach(function(n) {
      if (!_inBook(n, book)) return;
      var st = String(n.status || '');
      if (st === 'void' || st === 'voided') return;        // ใบที่ถูกยกเลิกแล้ว ไม่ปรับยอดอะไรทั้งนั้น
      var date = _dOnly(n.credit_date);
      if (dFrom && date < dFrom) return;
      if (dTo && date > dTo) return;

      var c = cust[String(n.customer_id)] || {};
      var order = orderById[String(n.sales_order_id)] || null;
      /* ภาพนิ่งภาษีของใบนี้เอง — ใบลดหนี้เก็บอัตราไว้ในตัว ใช้อัตราปัจจุบันไม่ได้
         (ลดหนี้ใบเก่าหลังรัฐเปลี่ยนอัตรา จะถอดภาษีผิดทันที) */
      var noteVat = { apply_vat: 'TRUE', vat_rate: n.vat_rate,
        subtotal_ex_vat: n.subtotal_ex_vat, vat_amount: n.vat_amount, exempt_amount: 0 };

      (linesByNote[String(n.record_id)] || []).forEach(function(l) {
        var qty = (parseFloat(l.qty) || 0) * K.sign;
        var amt = _round2((parseFloat(l.amount) || 0) * K.sign);
        var p = products[String(l.product_id)] || {};
        out.push([
          DASH_SOURCE, _dashDate(date), n[K.noField] || '', order ? (order.order_code || '') : '',
          n.delivery_round_id ? (roundNo[String(n.delivery_round_id)] || '') : '', tenantId,
          c.customer_code || '', customerFullName(c), c.tax_id || '', c.tax_branch_code || '',
          order ? _saleByLabel(order.sale_by) : '',
          order ? (isCreditPayment(order.payment_method) ? 'เครดิต' : 'เงินสด') : '',
          p.product_code || String(l.product_id || ''), p.name || '(สินค้าถูกลบ)',
          qty, l.unit_code || '', _round2(parseFloat(l.unit_price) || 0),
          /* ★ ราคาที่ลดหนี้คือ "ราคาที่ขายไปจริง" อยู่แล้ว (49_credit_notes.gs กันไม่ให้เกิน)
             จึงไม่มีส่วนลดให้แยกอีกชั้น — ยอดตามราคาขายกับยอดหลังหักส่วนลดเท่ากัน */
          amt, 0, 0, amt,
          lineExVat(noteVat, { line_total: amt, tax_status: l.tax_status }),
          '', K.kind, n.invoice_no || ''
        ]);
      });
    });
  });
}

/** 'yyyy-mm-dd' → Date จริง เพื่อให้ Excel ได้คอลัมน์วันที่ ไม่ใช่ข้อความ (กราฟแกนเวลาถึงจะทำงาน) */
function _dashDate(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** โฟลเดอร์ปลายทาง — ไม่ตั้ง `DASHBOARD_FOLDER_ID` = โฟลเดอร์ฐานข้อมูลของ env นั้น */
function _dashFolder() {
  var fid = PropertiesService.getScriptProperties().getProperty(DASH_PROP_FOLDER);
  if (fid) return DriveApp.getFolderById(fid);
  return _dbEnvFolder();
}

/**
 * แถวข้อมูล → ข้อความ CSV
 * ★ ตามมาตรฐาน RFC 4180: คั่นด้วย `,` · ขึ้นบรรทัดใหม่ด้วย CRLF · ค่าที่มี `,` `"` หรือขึ้นบรรทัด
 *   ต้องครอบด้วย `"` และ `"` ข้างในต้องเขียนซ้อนสองตัว
 * ★★ **เว้นวรรคหน้า/หลังก็ต้องครอบด้วย** ไม่งั้นตัวอ่านบางตัวตัดทิ้งเงียบๆ (ชื่อร้านที่มีเว้นวรรคท้าย
 *   เป็นเรื่องปกติในข้อมูลที่ย้ายมาจากระบบเดิม)
 */
function _dashCsvText(rows) {
  var esc = function(v) {
    if (v === null || v === undefined) return '';
    if (Object.prototype.toString.call(v) === '[object Date]') return _dashIsoDate(v);
    if (typeof v === 'number') return String(v);
    var t = String(v);
    if (/[",\r\n]/.test(t) || t !== t.trim()) return '"' + t.replace(/"/g, '""') + '"';
    return t;
  };
  var lines = [DASH_HEADERS.map(esc).join(',')];
  rows.forEach(function(r) { lines.push(r.map(esc).join(',')); });
  return lines.join('\r\n') + '\r\n';
}

/** Date → 'yyyy-mm-dd' (ISO) — รูปแบบเดียวที่ไม่กำกวมว่าวันหรือเดือนมาก่อน */
function _dashIsoDate(d) {
  var p = function(n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * เขียนไฟล์ CSV หนึ่งไฟล์ **ทับไฟล์เดิม โดยคง file id เดิมไว้** ลิงก์ที่ Dashboard ใช้จึงไม่ตายทุกวัน
 *
 * ★★ ใส่ BOM (\uFEFF) นำหน้า — ถ้าไม่ใส่ Excel บน Windows เปิดไฟล์แล้วภาษาไทยเพี้ยนทั้งไฟล์
 *   ตัวอ่านฝั่งโปรแกรมข้าม BOM ให้เองอยู่แล้ว (Python ใช้ `utf-8-sig`, Power BI/pandas จัดการให้)
 * ★ หา id ตามลำดับ: property → ชื่อไฟล์ในโฟลเดอร์ → สร้างใหม่ · ลำดับนี้ทำให้ย้าย/ลบไฟล์ด้วยมือแล้ว
 *   รอบถัดไปยังทำงานต่อได้เอง ไม่ต้องมาแก้ property
 */
function _dashWriteCsv(name, text) {
  var props = PropertiesService.getScriptProperties();
  var map = {};
  try { map = JSON.parse(props.getProperty(DASH_PROP_FILE_IDS) || '{}'); } catch (e) { map = {}; }
  var fileName = name + '.csv';
  var blob = Utilities.newBlob('\uFEFF' + text, 'text/csv', fileName);

  var id = map[name];
  if (!id) {                                   // ยังไม่เคยจำ — ดูว่ามีไฟล์ชื่อนี้อยู่ก่อนแล้วไหม
    var it = _dashFolder().getFilesByName(fileName);
    if (it.hasNext()) id = it.next().getId();
  }
  if (id) {
    try {
      var up = UrlFetchApp.fetch(
        'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media&supportsAllDrives=true',
        { method: 'patch', contentType: 'text/csv', payload: blob.getBytes(),
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (up.getResponseCode() === 200) { map[name] = id; props.setProperty(DASH_PROP_FILE_IDS, JSON.stringify(map)); return id; }
      // ไฟล์ถูกลบไปแล้ว → ตกลงไปสร้างใหม่ข้างล่าง
    } catch (e) { /* เหมือนกัน */ }
  }
  var created = _dashFolder().createFile(blob);
  map[name] = created.getId();
  props.setProperty(DASH_PROP_FILE_IDS, JSON.stringify(map));
  return created.getId();
}

/**
 * ชีตที่ต้องเขียนในรอบนี้ — คืนรหัสตัวแทน · `''` = สมุดของบริษัท
 * ★★ แยกออกมาเพื่อให้เทสต์จับได้ว่า **ยอดขายตรงในนามบริษัทไม่ตกหล่น** — ตัวแทน HOUSE ไม่ใช่
 *   ตัวแทนจริง ถ้าวนแค่ตาราง tenants แล้วข้าม is_house ยอดขายตรงของบริษัทจะหายทั้งก้อน
 *   โดย Dashboard ไม่มีทางรู้ว่าขาด (ตัวเลขดูปกติ แค่น้อยกว่าความจริง)
 */
function _dashTargets(opts) {
  opts = opts || {};
  if (opts.tenantIds && opts.tenantIds.length) return opts.tenantIds.slice();
  var out = [];
  centralObjects('tenants').forEach(function(t) {
    if (!isFlagOn(t.is_active)) return;
    if (isFlagOn(t.is_house)) return;          // บริษัทเอง เขียนเป็นชีต HOUSE ข้างล่าง
    out.push(String(t.tenant_id));
  });
  out.push('');                                 // '' = สมุดของบริษัท (ขายตรงในนามบริษัท)
  return out;
}

/**
 * ตัวจริง — ไล่ทุกตัวแทนที่ใช้งานอยู่ + บริษัท แล้วเขียนไฟล์ละตัวแทน
 * opts: { dateFrom?, dateTo?, tenantIds? }  (ไม่ส่ง = ทั้งหมดเท่าที่มี)
 */
function exportSalesDashboardFiles(opts) {
  opts = opts || {};
  var report = [], total = 0;

  _dashTargets(opts).forEach(function(tid) {
    var name = tid || 'HOUSE';                  // ขายตรงในนามบริษัท = HOUSE.csv (ชื่อไฟล์ว่างไม่ได้)
    var r = _dashRowsFor(tid, opts);
    if (!r.success) { report.push({ tenantId: name, error: r.message }); return; }
    /* ★ ไม่มีแถวก็ยังเขียนไฟล์ (เหลือแต่หัวคอลัมน์) — ไฟล์ค้างของเก่าไว้เฉยๆ อันตรายกว่า
       เพราะ Dashboard จะอ่านยอดเดือนที่แล้วมาแสดงเป็นเดือนนี้โดยไม่มีอะไรฟ้อง */
    var fileId = _dashWriteCsv(name, _dashCsvText(r.rows));
    report.push({ tenantId: name, rows: r.rows.length, truncated: r.truncated,
      fileId: fileId, url: 'https://drive.google.com/file/d/' + fileId + '/view' });
    total += r.rows.length;
  });

  return { success: true, rows: total, files: report, at: nowStr() };
}

/* ═══════════════ ตัวที่ trigger เรียก ═══════════════
   ★ ฟังก์ชันที่ trigger เรียกต้อง **ไม่รับอาร์กิวเมนต์** และห้าม throw ออกไป
     ไม่งั้น Apps Script ส่งอีเมลแจ้ง error ทุกชั่วโมงจนคนเลิกอ่าน แล้วของพังจริงก็ไม่มีใครเห็น */
function runDashboardExport() {
  try {
    var r = exportSalesDashboardFiles({});
    Logger.log('ส่งออก Dashboard สำเร็จ: ' + r.rows + ' แถว · ' +
      r.files.map(function(f) { return f.tenantId + '=' + (f.error || f.rows); }).join(' · '));
    return r;
  } catch (e) {
    Logger.log('ส่งออก Dashboard ล้มเหลว: ' + e.message);
    return { success: false, message: e.message };
  }
}

/** ตั้ง trigger รายวัน (เรียกจาก editor ครั้งเดียว) — ลบตัวเดิมก่อนเสมอ กันตั้งซ้อนจนรันวันละหลายรอบ */
function installDashboardExportTrigger(hour) {
  removeDashboardExportTrigger();
  ScriptApp.newTrigger('runDashboardExport').timeBased().atHour(hour === undefined ? 1 : hour).everyDays(1).create();
  Logger.log('ตั้ง trigger ส่งออก Dashboard ทุกวันตอน ' + (hour === undefined ? 1 : hour) + ' นาฬิกาแล้ว');
}

function removeDashboardExportTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'runDashboardExport') { ScriptApp.deleteTrigger(t); n++; }
  });
  if (n) Logger.log('ลบ trigger เดิม ' + n + ' ตัว');
}

/** สั่งส่งออกเดี๋ยวนี้จากหน้าแอดมิน (super_admin เท่านั้น — เขียนไฟล์ที่คนทั้งบริษัทใช้) */
function exportSalesDashboard(session, payload) {
  if (!session || !session.isSuperAdmin) return { success: false, message: 'เฉพาะ Ultra Admin เท่านั้น' };
  payload = payload || {};
  try {
    return exportSalesDashboardFiles({ dateFrom: payload.dateFrom, dateTo: payload.dateTo });
  } catch (e) {
    return { success: false, message: 'ส่งออกไม่สำเร็จ: ' + e.message };
  }
}

/* ═══════════════ ยังไม่ได้ทำ (ตั้งใจ) ═══════════════
 * - ยังไม่รวม "ของที่รับคืนโดยยังไม่ออกใบลดหนี้" — ตราบใดที่ยังไม่ออกใบลดหนี้ ยอดขายยังไม่ถูกปรับ
 *   ซึ่งถูกตามหลักภาษี แต่ถ้าคลังรับของคืนไว้นานก่อนออกใบ ยอดในไฟล์จะสูงกว่าของจริงชั่วคราว
 */
