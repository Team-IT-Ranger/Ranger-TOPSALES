/* ตัวอ่านไฟล์ "ใบรายการขาย" (Excel) ของบริษัท → โครงข้อมูลชุดราคา
   ใช้ได้ทั้งในเบราว์เซอร์ (SheetJS โหลดแบบ lazy) และ node (ทดสอบ) — ไม่แตะเครือข่าย ไม่แตะ backend

   กติกาที่ได้จากไฟล์จริง 4 ชุด (ก.ค.–ก.ย. 2569):
   - แถว/ชีตที่ผู้เตรียม "ซ่อน" คือแถวที่เลิกใช้ ต้องข้ามเสมอ (ไม่ใช่ราคาจริง)
   - ราคาสุทธิรวม VAT (เลขกลม) คือตัวตั้งที่คนพิมพ์ ส่วน % ส่วนลดเป็นสูตรที่คำนวณต่อ → เก็บราคาสุทธิเป็นหลัก
   - สินค้า 1 รายการ = แถวหัว (บรรจุ 1x12x5 หน่วย หีบ + ราคาตั้ง) → แถว "ซื้อ N - M หีบ" (ขั้นบันได) → แถว
     "(ขายเฉพาะหน่วยรถ) แพ็ค" (ราคาแพ็ค ขายเงินสดเฉพาะ Cash Van)
   - แถวหัวที่ 2 ที่ไม่มีบรรจุ (เช่น แซนดัลวูด/ลาเวนเดอร์) = สินค้าอีกตัวที่ใช้ชุดราคาเดียวกัน
   - เค้าโครงคอลัมน์ต่างกันตามชุด (ร้านค้า / ซุปเปอร์ชีป / ศูนย์) จึงหาคอลัมน์จากข้อความหัวตาราง ไม่ผูกตำแหน่งตายตัว */
(function (root) {
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ''); };
  var num = function (v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; };
  var round2 = function (n) { return Math.round(n * 100) / 100; };

  function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  function parseSheet(XLSX, ws, sheetName) {
    var ref = XLSX.utils.decode_range(ws['!ref']);
    var maxC = Math.min(ref.e.c, 40);                       // คอลัมน์เกิน AN เป็นขยะจากการจัดรูปแบบ
    var hiddenRows = ws['!rows'] || [], hiddenCols = ws['!cols'] || [];
    var val = function (r, c) { var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })]; return cell ? cell.v : null; };
    var text = function (r, c) { return norm(val(r, c)); };
    var isHiddenRow = function (r) { return !!(hiddenRows[r] && hiddenRows[r].hidden); };
    var isHiddenCol = function (c) { return !!(hiddenCols[c] && hiddenCols[c].hidden); };

    var warnings = [];
    // ── ข้อความหัวเรื่อง/งวด/กลุ่มร้าน (2 แถวแรก) ──
    var titleParts = [];
    for (var c0 = 0; c0 <= maxC; c0++) { var t = val(0, c0); if (t) titleParts.push(String(t).trim()); }
    var title = titleParts.join(' ');

    // ── หา block ราคาเงินสด / เครดิต จากแถวหัว (แถว 3-4) ──
    var blocks = [];                                         // {kind, start}
    for (var r0 = 2; r0 <= 4; r0++) for (var c = 0; c <= maxC; c++) {
      var h = text(r0, c);
      if (h === 'ราคาเงินสด') blocks.push({ kind: 'cash', start: c });
      else if (h === 'ราคาเครดิต') blocks.push({ kind: 'credit', start: c });
    }
    blocks.sort(function (a, b) { return a.start - b.start; });
    if (!blocks.length) return { sheet: sheetName, error: 'ไม่พบหัวตาราง "ราคาเงินสด/ราคาเครดิต"' };

    // หัวย่อยแถว 5-6: คอลัมน์ "(รวมVAT)" ในแต่ละ block = ราคาสุทธิรวม VAT
    var colsFound = { listEx: null, listIncl: null, pack: null, unit: null, code: null, name: null, suggested: null, retail: null };
    var headerRows = [3, 4, 5, 6];
    for (var hr = 0; hr < headerRows.length; hr++) for (var cc = 0; cc <= maxC; cc++) {
      var tx = text(headerRows[hr] - 1, cc);
      if (!tx) continue;
      if (tx.indexOf('รายการสินค้า') === 0) colsFound.name = cc;
      if (tx === 'รหัสสินค้า') colsFound.code = cc;
      if (tx.indexOf('(หีบxแพคxเดี่ยว)') === 0) colsFound.pack = cc;
      if (tx.indexOf('ราคาแนะนำขายต่อแพ็ค') === 0) colsFound.suggested = cc;
    }
    // ราคาตั้ง: ใต้หัว "ราคาตั้ง" แถว 6 มี (ไม่รวมVAT) แล้วตามด้วย (รวมVAT) ติดกัน ก่อนถึง block แรก
    var firstBlock = blocks[0].start;
    var listCols = [];
    for (var lc = 0; lc < firstBlock; lc++) { var lt = text(5, lc); if (lt === '(ไม่รวมVAT)') listCols.push({ k: 'ex', c: lc }); else if (lt === '(รวมVAT)') listCols.push({ k: 'incl', c: lc }); }
    listCols.forEach(function (x) { if (x.k === 'ex' && colsFound.listEx == null) colsFound.listEx = x.c; if (x.k === 'incl' && colsFound.listIncl == null) colsFound.listIncl = x.c; });
    // block ที่ขยายจนถึง block ถัดไป (block สุดท้ายขยายถึง maxC) แล้วหา (รวมVAT) = สุทธิรวม VAT
    blocks.forEach(function (b, i) {
      var end = i + 1 < blocks.length ? blocks[i + 1].start - 1 : maxC;
      b.netIncl = null;
      for (var k = b.start; k <= end; k++) if (text(5, k) === '(รวมVAT)') { b.netIncl = k; break; }
      if (b.netIncl == null) warnings.push('ไม่พบคอลัมน์ราคาสุทธิรวม VAT ของ ' + b.kind);
    });
    // ราคาปลีกต่อชิ้น: หัวแถว 6 = "ปลีก"
    for (var pc = 0; pc <= maxC; pc++) if (text(5, pc) === 'ปลีก') colsFound.retail = pc;
    if (colsFound.name == null || colsFound.pack == null || colsFound.listEx == null) return { sheet: sheetName, error: 'ไม่พบคอลัมน์รายการสินค้า/บรรจุ/ราคาตั้ง' };
    colsFound.unit = colsFound.pack + 1;                    // คอลัมน์ "หน่วยขาย" อยู่ติดขวาคอลัมน์บรรจุเสมอ ("ขาย" ในหัวราคาปลีกเป็นคนละอย่าง)

    var cashBlock = blocks.filter(function (b) { return b.kind === 'cash'; })[0] || null;
    var creditBlock = blocks.filter(function (b) { return b.kind === 'credit'; })[0] || null;
    var netCash = function (r) { return cashBlock && cashBlock.netIncl != null ? num(val(r, cashBlock.netIncl)) : null; };
    var netCredit = function (r) { return creditBlock && creditBlock.netIncl != null ? num(val(r, creditBlock.netIncl)) : null; };

    // ── ไล่แถวข้อมูล ──
    var items = [], cur = null, lastHeaderRow = -1;
    var parseTier = function (label) {
      var l = norm(label), nums = (l.match(/\d[\d,]*/g) || []).map(function (x) { return Number(x.replace(/,/g, '')); });
      if (!nums.length) return null;
      var open = l.indexOf('ขึ้นไป') !== -1;
      return { min: nums[0], max: open ? null : (nums.length > 1 ? nums[1] : nums[0]) };
    };
    for (var r = 6; r <= ref.e.r; r++) {
      if (isHiddenRow(r)) continue;
      var name = val(r, colsFound.name), nameTxt = norm(name);
      var packTxt = colsFound.pack != null ? String(val(r, colsFound.pack) == null ? '' : val(r, colsFound.pack)).trim() : '';
      var unitTxt = norm(val(r, colsFound.unit));
      var codeRaw = colsFound.code != null ? val(r, colsFound.code) : null;
      var codes = codeRaw == null ? [] : String(codeRaw).split('/').map(function (s) { return s.trim(); }).filter(Boolean);

      if (nameTxt.indexOf('รายการพิเศษ') === 0) break;      // ท้ายตาราง = โปรระดับบิล (อ่านแยกด้านล่าง)

      var isHeader = /^\d+x/i.test(packTxt) && unitTxt === 'หีบ';
      if (isHeader) {
        cur = { names: [String(name).trim()], codes: codes, pack: packTxt, unit: 'หีบ',
                listExVat: num(val(r, colsFound.listEx)), listInclVat: colsFound.listIncl != null ? num(val(r, colsFound.listIncl)) : null,
                tiers: [], packs: [], suggestedPack: null, retailPiece: null, row: r + 1 };
        var single = netCash(r);
        if (single != null) cur.tiers.push({ label: 'ราคาเดียว', min: 1, max: null, cashInclVat: single, creditInclVat: netCredit(r) });   // ไฟล์ศูนย์: ราคาเดียวต่อสินค้า
        items.push(cur); lastHeaderRow = r; continue;
      }
      if (!cur || !nameTxt) continue;

      if (nameTxt.indexOf('ซื้อ') === 0) {
        var range = parseTier(name); if (!range) continue;
        var cash = netCash(r), credit = netCredit(r);
        if (cash == null && credit == null) continue;
        cur.tiers.push({ label: String(name).trim(), min: range.min, max: range.max, cashInclVat: cash, creditInclVat: credit });
        if (colsFound.suggested != null && num(val(r, colsFound.suggested)) != null) cur.suggestedPack = num(val(r, colsFound.suggested));
        if (colsFound.retail != null && num(val(r, colsFound.retail)) != null) cur.retailPiece = num(val(r, colsFound.retail));
        continue;
      }
      if (nameTxt.indexOf('ขายเฉพาะหน่วยรถ') !== -1) {
        cur.packs.push({ unit: 'แพ็ค', pack: packTxt || null, listExVat: num(val(r, colsFound.listEx)),
                         listInclVat: colsFound.listIncl != null ? num(val(r, colsFound.listIncl)) : null,
                         cashInclVat: netCash(r), creditInclVat: netCredit(r), vanOnly: true, note: String(name).trim() });
        if (colsFound.retail != null && num(val(r, colsFound.retail)) != null && cur.retailPiece == null) cur.retailPiece = num(val(r, colsFound.retail));
        continue;
      }
      // แถวชื่อ+รหัสที่ไม่มีบรรจุ ติดกับแถวหัว = สินค้าอีกตัวที่ใช้ชุดราคาเดียวกัน (นับเฉพาะก่อนเจอแถวขั้นบันไดแรก)
      if (codes.length && !cur.tiers.length && !cur.packs.length) { cur.names.push(String(name).trim()); cur.codes = cur.codes.concat(codes); continue; }
      if (codes.length && r === lastHeaderRow + 1) { cur.names.push(String(name).trim()); cur.codes = cur.codes.concat(codes); }
    }

    // ── ตรวจเลขด้วยกฎของไฟล์เอง ──
    items.forEach(function (it) {
      if (it.listExVat != null && it.listInclVat != null && Math.abs(it.listExVat * 1.07 - it.listInclVat) > 0.06)
        warnings.push('แถว ' + it.row + ': ราคาตั้งไม่รวม/รวม VAT ไม่ตรงกัน (' + it.listExVat + ' → ' + it.listInclVat + ')');
      var prev = null;
      it.tiers.forEach(function (t) {
        if (prev && t.min <= prev.min) warnings.push('แถว ' + it.row + ': ขั้นบันไดซ้อน/ลำดับผิด (' + prev.label + ' → ' + t.label + ')');
        if (prev && prev.max != null && t.min !== prev.max + 1) warnings.push('แถว ' + it.row + ': ขั้นบันไดขาดช่วง (' + prev.label + ' → ' + t.label + ')');
        if (prev && prev.max == null) warnings.push('แถว ' + it.row + ': มีขั้นต่อจากขั้น "ขึ้นไป" (' + t.label + ')');
        if (t.cashInclVat != null && t.creditInclVat != null && round2(t.creditInclVat - t.cashInclVat) !== 15)
          warnings.push('แถว ' + it.row + ' ' + t.label + ': เครดิต−เงินสด = ' + round2(t.creditInclVat - t.cashInclVat) + ' (ปกติ +15)');
        prev = t;
      });
      if (!it.tiers.length && !it.packs.length) warnings.push('แถว ' + it.row + ': สินค้า ' + it.names[0] + ' ไม่มีราคา');
    });

    // ── โปรระดับบิล (ข้อความท้ายตาราง) ──
    var billPromos = [], scope = '';
    for (var pr = 0; pr <= ref.e.r; pr++) {
      if (isHiddenRow(pr)) continue;
      var pt = null;
      for (var pc2 = 0; pc2 <= 6; pc2++) { var v2 = val(pr, pc2); if (typeof v2 === 'string' && v2.trim()) { pt = v2.trim(); break; } }
      if (!pt) continue;
      var m = pt.match(/ครบ\s*([\d,]+)\s*บาท.*?ส่วนลดเพิ่ม\s*([\d.]+)\s*%/);
      if (m) billPromos.push({ minAmountExVat: Number(m[1].replace(/,/g, '')), percent: Number(m[2]), text: pt });
      if (/รายการพิเศษ/.test(pt)) scope = pt;
    }

    return {
      sheet: sheetName, title: title, scope: scope, hasCash: !!cashBlock, hasCredit: !!creditBlock,
      columns: colsFound, items: items, billPromos: billPromos, warnings: warnings
    };
  }

  // XLSX = SheetJS, data = ArrayBuffer/Buffer → ผลของชีตที่มองเห็นได้ชีตแรกที่พาร์สสำเร็จ (ชีตซ่อนข้าม)
  function parse(XLSX, data, opts) {
    var wb = XLSX.read(data, { type: (opts && opts.type) || 'array', cellStyles: true });
    var visible = wb.SheetNames.filter(function (n, i) { var s = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i]; return !(s && s.Hidden); });
    var results = [];
    visible.forEach(function (n) {
      var ws = wb.Sheets[n];
      if (!ws || !ws['!ref']) return;
      var r = parseSheet(XLSX, ws, n);
      if (!r.error) results.push(r);
    });
    return { sheets: results, skippedHiddenSheets: wb.SheetNames.length - visible.length };
  }

  var api = { parse: parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PricelistParser = api;
})(typeof window !== 'undefined' ? window : this);
