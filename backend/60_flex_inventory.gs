/**
 * ===================== Flex message: ของคงเหลือ + เมนูเลือกตัวแทน =====================
 * **เทมเพลตเท่านั้น ห้ามมีตรรกะธุรกิจในไฟล์นี้** — ตัวเลขทุกตัวมาจาก `inventorySnapshot()`
 * (58_inventory_report.gs) แล้วที่นี่แค่จัดหน้าให้อ่านบนมือถือ · แยกไฟล์เพื่อให้แก้หน้าตา
 * ได้โดยไม่ต้องอ่านโค้ด webhook และกลับกัน
 *
 * สีชุดเดียวกับแอปแอดมิน (frontend-admin/index.html): ฟ้า #2B63D9 · หมึก #0F1B2D ·
 * หมึกอ่อน #5B6B84 · เส้น #E4E9F1 — ของที่ผู้ใช้เห็นในแชตควรเป็นระบบเดียวกับที่เห็นบนเว็บ
 */

var FLEX_INK = '#0F1B2D', FLEX_INK_SOFT = '#5B6B84', FLEX_BLUE = '#2B63D9', FLEX_LINE = '#E4E9F1';

/** ตัวเลขแบบอ่านง่าย: มีคอมมา · ทศนิยมเฉพาะเมื่อมีเศษ (12 · 12.5 · 1,240.25) */
function flexNum(n) {
  var v = Math.round((Number(n) || 0) * 100) / 100;
  var neg = v < 0; v = Math.abs(v);
  var whole = Math.floor(v);
  var frac = Math.round((v - whole) * 100);
  var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac) {
    var f = frac < 10 ? ('0' + frac) : String(frac);
    if (f.charAt(1) === '0') f = f.charAt(0);     // .50 → .5
    s += '.' + f;
  }
  return (neg ? '-' : '') + s;
}

function _flexText(text, opts) {
  var t = { type: 'text', text: String(text === null || text === undefined ? '' : text) };
  Object.keys(opts || {}).forEach(function(k) { t[k] = opts[k]; });
  return t;
}

/** แถวตาราง 4 ช่อง: ชื่อสินค้า | คลัง | รถ | รวม */
function _flexStockRow(label, wh, van, total, opts) {
  opts = opts || {};
  var size = opts.size || 'sm';
  var color = opts.color || FLEX_INK;
  var weight = opts.bold ? 'bold' : 'regular';
  return {
    type: 'box', layout: 'horizontal', spacing: 'xs',
    contents: [
      _flexText(label, { size: size, color: color, weight: weight, flex: 5, wrap: false, maxLines: 1 }),
      _flexText(wh,    { size: size, color: color, weight: weight, flex: 3, align: 'end' }),
      _flexText(van,   { size: size, color: color, weight: weight, flex: 3, align: 'end' }),
      _flexText(total, { size: size, color: opts.totalColor || color, weight: 'bold', flex: 3, align: 'end' })
    ]
  };
}

function _flexSep(margin) { return { type: 'separator', margin: margin || 'sm', color: FLEX_LINE }; }

/**
 * ของคงเหลือหนึ่งใบ (bubble เดียว) จากผลของ inventorySnapshot()
 * ★ หน่วยเขียนไว้ที่หัวตารางครั้งเดียว ("ลัง") ไม่เขียนต่อท้ายทุกบรรทัด — บนจอมือถือ
 *   คำว่า "ลัง" 15 ครั้งกินที่มากกว่าตัวเลขที่มันกำกับ
 */
function flexInventory(snap) {
  var rows = snap.rows || [];
  var body = [
    _flexStockRow('สินค้า', 'คลัง', 'รถ', 'รวม', { size: 'xs', color: FLEX_INK_SOFT, bold: true }),
    _flexSep('sm')
  ];

  if (!rows.length) {
    body.push(_flexText('ไม่มีของคงเหลือในคลังและบนรถ', { size: 'sm', color: FLEX_INK_SOFT, margin: 'md', wrap: true }));
  } else {
    rows.forEach(function(r) {
      // ★ ดอกจัน = ยังไม่ยืนยันขนาดบรรจุ ตัวเลขแถวนั้นจึงเป็น "ชิ้น" ไม่ใช่ "ลัง" (เชิงอรรถอยู่ท้ายใบ)
      var name = (r.confirmed ? '' : '*') + (r.productName || r.productCode);
      body.push(_flexStockRow(name, flexNum(r.warehouse), flexNum(r.van), flexNum(r.total),
        { size: 'sm', totalColor: FLEX_BLUE }));
    });
  }

  var totals = snap.totals || { warehouse: 0, van: 0, total: 0 };
  var footer = [
    _flexSep('none'),
    _flexStockRow('รวมทั้งหมด (ลัง)', flexNum(totals.warehouse), flexNum(totals.van), flexNum(totals.total),
      { size: 'sm', bold: true, totalColor: FLEX_BLUE })
  ];

  var notes = [];
  if (snap.products > snap.shown) notes.push('แสดง ' + snap.shown + ' จาก ' + snap.products + ' รายการ (เรียงตามของรวมมากสุด)');
  if (snap.unconfirmed) notes.push('* ' + snap.unconfirmed + ' รายการยังไม่ยืนยันขนาดบรรจุ — ตัวเลขเป็นชิ้น ไม่ได้รวมในยอดลัง');
  if (!snap.vanAvailable) notes.push('อ่านของบนรถไม่ได้ (ยังไม่มีไฟล์ของตัวแทนรายนี้) — ช่องรถจึงเป็น 0');
  else if (snap.vanStaff) notes.push('ของบนรถรวมจากพนักงาน ' + snap.vanStaff + ' คน');
  notes.forEach(function(n) {
    footer.push(_flexText(n, { size: 'xxs', color: FLEX_INK_SOFT, wrap: true, margin: 'sm' }));
  });

  return {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: FLEX_BLUE, paddingAll: '14px', spacing: 'xs',
      contents: [
        _flexText('ของคงเหลือ · หน่วยลัง', { size: 'xs', color: '#C9DAFB' }),
        _flexText(snap.tenantName || snap.tenantId, { size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true }),
        _flexText('ณ ' + (snap.asOf || ''), { size: 'xxs', color: '#C9DAFB' })
      ]
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: footer }
  };
}

/**
 * เมนูเลือกตัวแทน — ใช้ quick reply เมื่อรายการไม่เกิน 13 (เพดานของ LINE)
 * มากกว่านั้นใช้ปุ่มใน Flex แทน (ปุ่มกินที่มากกว่า จึงตัดที่ 12 แล้วบอกวิธีพิมพ์รหัสเอง)
 * ★ ส่งเป็น postback ไม่ใช่ message — ผู้ใช้กดแล้วไม่ต้องเห็นคำสั่งดิบในห้องแชตของตัวเอง
 */
var FLEX_QUICK_MAX = 13, FLEX_BUTTON_MAX = 12;

function flexTenantPicker(tenants, prompt) {
  var head = prompt || 'เลือกตัวแทนที่ต้องการดูของคงเหลือ';
  if (tenants.length <= FLEX_QUICK_MAX) {
    return {
      type: 'text', text: head,
      quickReply: {
        items: tenants.map(function(t) {
          return { type: 'action', action: { type: 'postback',
            label: _flexCut(t.name, 20), data: 'cmd=inv&t=' + encodeURIComponent(t.tenantId),
            displayText: 'ของคงเหลือ: ' + t.name } };
        })
      }
    };
  }
  var shown = tenants.slice(0, FLEX_BUTTON_MAX);
  var contents = [ _flexText(head, { size: 'sm', color: FLEX_INK, wrap: true, weight: 'bold' }) ];
  shown.forEach(function(t) {
    contents.push({ type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
      action: { type: 'postback', label: _flexCut(t.name, 20),
        data: 'cmd=inv&t=' + encodeURIComponent(t.tenantId), displayText: 'ของคงเหลือ: ' + t.name } });
  });
  contents.push(_flexText('อีก ' + (tenants.length - shown.length) + ' ราย — พิมพ์ /inventory <รหัสตัวแทน>',
    { size: 'xxs', color: FLEX_INK_SOFT, wrap: true, margin: 'md' }));
  return { type: 'flex', altText: head, contents: {
    type: 'bubble', size: 'mega',
    body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: contents } } };
}

/** ตัดข้อความให้พอดีป้ายปุ่ม (LINE จำกัดป้าย quick reply ไว้ 20 ตัวอักษร — เกินแล้วคำขอถูกปฏิเสธทั้งก้อน) */
function _flexCut(s, n) {
  var t = String(s || '');
  return t.length <= n ? t : (t.substring(0, n - 1) + '…');
}
