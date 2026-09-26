/* ═══════════════════════════════════════════════════════════════════════════
   เครื่องพิมพ์เอกสารกลาง — โหลดตอนจะพิมพ์ครั้งแรกเท่านั้น (ไม่ถ่วงเวลาเปิดแอป)
   ถอดหลักการจาก inventory-app-blueprint.md หัวข้อ 6 (Hippo Village):

   1) มีเครื่องพิมพ์กลาง "สองตัว" ไม่ใช่เขียนใหม่ทุกหน้า
        DocPrint.doc(spec)    — เอกสารตัวจริงทีละใบ (ใบส่งของ/ใบกำกับภาษี/ใบเสร็จ/ใบจัดของ)
        DocPrint.table(spec)  — รายงานตารางยาวๆ (รายการบิลขาย ฯลฯ)
        DocPrint.xlsx(spec)   — ส่งออก Excel จากชุดข้อมูลเดียวกับที่พิมพ์
   2) แบ่งหน้าด้วยการ "วัดความสูงจริง" ห้ามเดาจำนวนแถวต่อหน้า — ชื่อสินค้ายาวไม่เท่ากัน
      บางใบมีคอลัมน์มากกว่า และขนาดตัวอักษรปรับได้ เลขตายตัวจะผิดเสมอสักกรณี
      กระดาษเป็นกล่อง overflow:hidden → เดาพลาดทางมาก = ข้อมูลหายเงียบๆ
   3) หน้าสุดท้ายต้องมีที่พอสำหรับยอดรวม + ช่องลงชื่อ ไม่พอให้ผลักแถวไปหน้าใหม่
   4) ห้ามเรียก window.open() ใน callback ของ API (ถูกบล็อกเป็นป๊อปอัพ) —
      กางเป็นแผ่นพรีวิวทับแอป แล้วให้ผู้ใช้กดปุ่มพิมพ์เอง · ทางสำรองเป็นลิงก์ <a href> ที่ผู้ใช้คลิกเอง
   5) CSS ทุกกฎ scope ใต้ .docsheet เพราะแผ่นนี้อยู่ในหน้าแอปจริง ชื่อคลาสสั้นๆ จะชนของแอปทันที
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CSS = [
    '.doc-ov{position:fixed;inset:0;background:rgba(15,27,45,.55);z-index:90;overflow:auto;padding:0 0 40px;display:none}',
    '.doc-ov.show{display:block}',
    '.doc-bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;',
    '  padding:10px 16px;background:#fff;border-bottom:1px solid #E4E9F1;box-shadow:0 2px 10px rgba(15,27,45,.12)}',
    '.doc-bar .doc-ttl{font-weight:700;margin-right:auto;font-size:14px}',
    '.doc-bar button,.doc-bar a.doc-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:1px solid #D7DEE9;',
    '  background:#fff;color:#243244;cursor:pointer;text-decoration:none;display:inline-block}',
    '.doc-bar .doc-primary{background:#2B63D9;border-color:#2B63D9;color:#fff}',
    '.doc-pages{padding:18px 12px 0}',
    /* ★ height ไม่ใช่ min-height — หนึ่ง .docsheet = หนึ่งหน้า A4 เป๊ะ ห้ามยืด */
    '.docsheet{width:210mm;height:297mm;padding:13mm 12mm;overflow:hidden;background:#fff;color:#111;',
    '  display:flex;flex-direction:column;font-size:var(--doc-fs,10px);line-height:1.45;margin:0 auto 14px;',
    '  box-shadow:0 8px 28px rgba(0,0,0,.25);font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;position:relative}',
    '.docsheet *{box-sizing:border-box}',
    '.docsheet .dp-measure{position:absolute;left:-10000px;top:0;visibility:hidden}',
    /* หัวเอกสาร */
    '.docsheet .dp-head{display:flex;justify-content:space-between;gap:2em;border-bottom:.2em solid #111;padding-bottom:.7em}',
    '.docsheet .dp-issuer{font-size:.95em;max-width:62%}',
    '.docsheet .dp-issuer .dp-name{font-size:1.5em;font-weight:700;line-height:1.25}',
    '.docsheet .dp-docbox{text-align:right;min-width:30%}',
    '.docsheet .dp-doctitle{font-size:1.7em;font-weight:700;letter-spacing:.02em}',
    '.docsheet .dp-sub{font-size:.95em;color:#444}',
    '.docsheet .dp-meta{margin-top:.5em;font-size:.95em}',
    '.docsheet .dp-meta div{display:flex;justify-content:flex-end;gap:.8em}',
    '.docsheet .dp-meta span:first-child{color:#555}',
    '.docsheet .dp-meta span:last-child{font-weight:600;min-width:9em;text-align:left}',
    /* คู่ค้า */
    '.docsheet .dp-party{display:flex;gap:1.4em;margin-top:.9em;font-size:.98em}',
    '.docsheet .dp-party .dp-col{flex:1;border:1px solid #CFD6E0;border-radius:.4em;padding:.6em .8em}',
    '.docsheet .dp-party .dp-lbl{color:#555;font-size:.88em}',
    '.docsheet .dp-party b{font-size:1.06em}',
    /* ตารางรายการ */
    '.docsheet .dp-tbl{width:100%;border-collapse:collapse;margin-top:.9em;font-size:.98em}',
    '.docsheet .dp-tbl th{background:#EEF2F8;border:1px solid #B9C3D2;padding:.45em .5em;font-weight:700;text-align:center}',
    '.docsheet .dp-tbl td{border:1px solid #CFD6E0;padding:.4em .5em;vertical-align:top}',
    '.docsheet .dp-tbl td.r,.docsheet .dp-tbl th.r{text-align:right}',
    '.docsheet .dp-tbl td.c,.docsheet .dp-tbl th.c{text-align:center}',
    '.docsheet .dp-tbl tr.dp-bold td{font-weight:700;background:#F6F8FC}',
    '.docsheet .dp-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.95em}',
    '.docsheet .dp-free{background:#F2F7FF}',
    /* ท้ายเอกสาร */
    '.docsheet .dp-foot{margin-top:auto;padding-top:.8em}',
    '.docsheet .dp-sumwrap{display:flex;justify-content:space-between;gap:1.4em;align-items:flex-start}',
    '.docsheet .dp-note{flex:1;font-size:.95em;white-space:pre-wrap}',
    '.docsheet .dp-sum{min-width:40%}',
    '.docsheet .dp-sum table{width:100%;border-collapse:collapse}',
    '.docsheet .dp-sum td{padding:.28em .5em;font-size:1em}',
    '.docsheet .dp-sum td:last-child{text-align:right;font-weight:600;white-space:nowrap}',
    '.docsheet .dp-sum tr.dp-grand td{border-top:.14em solid #111;border-bottom:.14em double #111;font-size:1.18em;font-weight:700}',
    '.docsheet .dp-bank{margin-top:.6em;font-size:.92em;color:#333}',
    '.docsheet .dp-sign{display:flex;gap:1.2em;margin-top:2.2em}',
    '.docsheet .dp-sign div{flex:1;text-align:center;font-size:.95em}',
    '.docsheet .dp-sign .dp-line{border-top:1px dotted #555;margin:0 .4em .35em;height:2.6em}',
    '.docsheet .dp-pg{text-align:right;font-size:.85em;color:#666;margin-top:.5em}',
    '.docsheet .dp-carry{display:flex;justify-content:space-between;border-top:1px solid #B9C3D2;',
    '  padding:.35em .5em;font-weight:600;background:#F6F8FC;font-size:.98em}',
    /* ── สติกเกอร์ปะหน้าพัสดุ 100x150 มม. — กระดาษคนละขนาดกับ A4 ใช้แผ่นเดียวกันแต่ย่อ padding และขยายตัวอักษร ── */
    '.docsheet.dp-label{width:100mm;height:150mm;padding:5mm;font-size:var(--doc-label-fs,12px);line-height:1.35}',
    '.docsheet.dp-label .dp-lb-from{border-bottom:1px solid #111;padding-bottom:.5em;font-size:.95em}',
    '.docsheet.dp-label .dp-lb-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.5em;font-weight:700;',
    '  text-align:center;border:2px solid #111;border-radius:.3em;padding:.25em;margin:.5em 0}',
    '.docsheet.dp-label .dp-lb-to{border:2px solid #111;border-radius:.3em;padding:.6em;flex:1}',
    '.docsheet.dp-label .dp-lb-to .dp-lb-lbl{font-size:.85em;color:#444}',
    '.docsheet.dp-label .dp-lb-to .dp-lb-name{font-size:1.6em;font-weight:700;line-height:1.25;margin:.15em 0}',
    '.docsheet.dp-label .dp-lb-to .dp-lb-addr{font-size:1.15em}',
    '.docsheet.dp-label .dp-lb-to .dp-lb-tel{font-size:1.3em;font-weight:700;margin-top:.4em}',
    '.docsheet.dp-label .dp-lb-foot{display:flex;justify-content:space-between;gap:.6em;margin-top:.5em;font-size:.95em}',
    '.docsheet .dp-wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}',
    '.docsheet .dp-wm span{font-size:9em;font-weight:800;color:rgba(200,30,30,.13);transform:rotate(-24deg);letter-spacing:.1em}',
    /* ตอนสั่งพิมพ์: เหลือแค่กระดาษ */
    '@media print{',
    '  body>*{display:none !important}',
    '  body>.doc-ov.show{display:block !important;position:static;background:#fff;padding:0;overflow:visible}',
    '  .doc-bar{display:none !important}',
    '  .doc-pages{padding:0}',
    /* ★ สั่งตัด "ก่อน" แผ่นที่สองเป็นต้นไป ไม่ใช่ตัด "หลัง" ทุกแผ่น — ตัดหลังแผ่นสุดท้ายด้วย = ได้กระดาษเปล่าเพิ่มทุกครั้ง */
    '  .docsheet{box-shadow:none;margin:0}',
    '  .docsheet + .docsheet{page-break-before:always;break-before:page}',
    /* ขนาดกระดาษไม่ได้อยู่ตรงนี้ — setPaper() ฉีด @page ให้ตรงกับชนิดเอกสารตอนแสดง (A4 หรือสติกเกอร์) */
    '}'
  ].join('\n');

  var E = function (s) { return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var money = function (n) { return (parseFloat(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  var ov = null, pagesEl = null, blobUrl = null;

  /** ขนาดตัวอักษรฐานที่แอปตั้งไว้จริง (ตั้งค่าต่อบริษัทได้) — ต้องยกไปใส่ในไฟล์ที่เปิดแท็บใหม่ด้วย */
  function docBaseFontSize() {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue('--doc-fs');
      return (v || '').trim();
    } catch (e) { return ''; }
  }

  function ensureShell() {
    if (ov) return;
    var st = document.createElement('style');
    st.id = 'doc-print-css';
    st.textContent = CSS;
    document.head.appendChild(st);

    ov = document.createElement('div');
    ov.className = 'doc-ov';
    ov.id = 'doc-print-overlay';
    ov.innerHTML =
      '<div class="doc-bar">' +
        '<span class="doc-ttl" id="dp-title"></span>' +
        '<span id="dp-count" style="font-size:12px;color:#5A6B82"></span>' +
        '<a class="doc-btn" id="dp-newtab" target="_blank" rel="noopener">เปิดในแท็บใหม่</a>' +
        '<button class="doc-btn" id="dp-xlsx" style="display:none">บันทึกเป็น Excel</button>' +
        '<button class="doc-btn doc-primary" id="dp-print">พิมพ์</button>' +
        '<button class="doc-btn" id="dp-close">ปิด</button>' +
      '</div><div class="doc-pages" id="dp-pages"></div>';
    document.body.appendChild(ov);
    pagesEl = ov.querySelector('#dp-pages');
    // พิมพ์เกิดจากการคลิกจริงของผู้ใช้เสมอ — ไม่ใช่จาก callback ของ API (โดนบล็อก)
    ov.querySelector('#dp-print').onclick = function () { window.print(); };
    ov.querySelector('#dp-close').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('show')) close(); });
  }

  function close() {
    if (!ov) return;
    ov.classList.remove('show');
    pagesEl.innerHTML = '';
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  }

  /* ── แบ่งหน้าโดยวัดความสูงจริง ───────────────────────────────────────────
     render(rowsHtml, withFooter) ต้องคืน HTML ของ "หนึ่งแผ่น" ที่สมบูรณ์
     เราเติมแถวทีละแถวลงแผ่นวัด (อยู่ใน DOM จริง แต่ซ่อนด้วย visibility — display:none วัดได้ 0 เสมอ) */
  function paginate(rows, render) {
    var measure = document.createElement('div');
    measure.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden';
    document.body.appendChild(measure);

    var fits = function (html) {
      measure.innerHTML = html;
      var sheet = measure.firstElementChild;
      return sheet.scrollHeight <= sheet.clientHeight + 1;
    };

    var pages = [], i = 0, guard = 0;
    while (guard++ < 400) {
      var rest = rows.length - i;
      var take = 0, lastPage = false;

      // ลองให้เป็นหน้าสุดท้าย (มียอดรวม+ช่องลงชื่อ) ก่อน — ถ้าที่เหลือทั้งหมดใส่ลงได้ก็จบที่หน้านี้
      if (fits(render(rows.slice(i), true, i))) { take = rest; lastPage = true; }
      else {
        // ไม่พอ → หน้านี้เป็นหน้ากลาง ไล่เติมแถวจนเริ่มล้นแล้วถอยกลับหนึ่งแถว
        var lo = 0, hi = rest;
        while (lo < hi) {                       // ค้นหาแบบแบ่งครึ่ง เร็วกว่าไล่ทีละแถวมากเมื่อรายการยาว
          var mid = Math.ceil((lo + hi) / 2);
          if (fits(render(rows.slice(i, i + mid), false, i))) lo = mid; else hi = mid - 1;
        }
        take = lo;
        if (take === 0) take = 1;               // แถวเดียวยังไม่พอ = ข้อมูลแถวนั้นยาวผิดปกติ ปล่อยให้ล้นดีกว่าวนไม่จบ
      }
      pages.push({ rows: rows.slice(i, i + take), last: lastPage });
      i += take;
      if (lastPage || i >= rows.length) { if (!lastPage) pages[pages.length - 1].last = true; break; }
    }
    if (!pages.length) pages.push({ rows: [], last: true });
    document.body.removeChild(measure);
    return pages;
  }

  /* @page เปลี่ยนตามชนิดกระดาษไม่ได้ด้วยคลาส (ไม่ใช่ selector ของ element) — ต้องฉีด <style> ตอนแสดงเอกสาร */
  function setPaper(paper) {
    var st = document.getElementById('dp-page-size');
    if (!st) { st = document.createElement('style'); st.id = 'dp-page-size'; document.head.appendChild(st); }
    st.textContent = paper === 'label100x150'
      ? '@media print{@page{size:100mm 150mm;margin:0}}'
      : '@media print{@page{size:A4;margin:0}}';
    return paper === 'label100x150' ? '@page{size:100mm 150mm;margin:0}' : '@page{size:A4;margin:0}';
  }

  function show(title, pagesHtml, opts) {
    ensureShell();
    opts = opts || {};
    var pageRule = setPaper(opts.paper);
    ov.querySelector('#dp-title').textContent = title;
    ov.querySelector('#dp-count').textContent = pagesHtml.length + ' หน้า';
    pagesEl.innerHTML = pagesHtml.join('');

    // ทางออกสำรอง: ลิงก์จริงที่ผู้ใช้คลิกเอง (คลิกลิงก์นับเป็น user activation) — ไฟล์ต้องพก CSS ไปเอง
    var html = '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>' + E(title) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">' +
      // ★ ไฟล์นี้ไม่ได้โหลด :root ของแอป — ต้องประกาศตัวแปรที่ .docsheet ใช้ซ้ำที่นี่เอง
      '<style>:root{--doc-fs:' + (docBaseFontSize() || '10px') + '}body{margin:0;background:#8891a3}' +
      CSS + '\n' + pageRule + '</style></head>' +
      '<body>' + pagesHtml.join('') + '<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>';
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    var a = ov.querySelector('#dp-newtab');
    a.href = blobUrl;
    a.download = '';

    var xbtn = ov.querySelector('#dp-xlsx');
    if (opts.xlsx) { xbtn.style.display = ''; xbtn.onclick = function () { DocPrint.xlsx(opts.xlsx); }; }
    else xbtn.style.display = 'none';

    ov.classList.add('show');
    ov.scrollTop = 0;
  }

  /* ── เอกสารตัวจริง ──────────────────────────────────────────────────────── */
  function docHead(spec, pageNo, pageCount) {
    var iss = spec.issuer || {};
    var meta = (spec.metaRight || []).slice();
    var branch = iss.branchCode ? (iss.branchCode === '00000' ? ' (สำนักงานใหญ่)' : ' (สาขา ' + iss.branchCode + ')') : '';
    return '<div class="dp-head">' +
        '<div class="dp-issuer"><div class="dp-name">' + E(iss.name || '') + '</div>' +
          (iss.address ? '<div>' + E(iss.address) + '</div>' : '') +
          (iss.taxId ? '<div>เลขประจำตัวผู้เสียภาษี ' + E(iss.taxId) + E(branch) + '</div>' : '') +
          (iss.phone ? '<div>โทร. ' + E(iss.phone) + (iss.email ? ' · ' + E(iss.email) : '') + '</div>' : '') +
        '</div>' +
        '<div class="dp-docbox"><div class="dp-doctitle">' + E(spec.title || '') + '</div>' +
          (spec.subLabel ? '<div class="dp-sub">' + E(spec.subLabel) + '</div>' : '') +
          '<div class="dp-meta">' + meta.map(function (m) {
            return '<div><span>' + E(m[0]) + '</span><span>' + E(m[1]) + '</span></div>';
          }).join('') +
          (pageCount > 1 ? '<div><span>หน้า</span><span>' + pageNo + ' / ' + pageCount + '</span></div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function docParty(spec) {
    var cols = (spec.parties || []).map(function (p) {
      var branch = p.branchCode ? (p.branchCode === '00000' ? ' (สำนักงานใหญ่)' : ' (สาขา ' + p.branchCode + ')') : '';
      return '<div class="dp-col"><div class="dp-lbl">' + E(p.label || '') + '</div>' +
        '<b>' + E(p.name || '-') + '</b>' +
        (p.code ? ' <span class="dp-code">[' + E(p.code) + ']</span>' : '') +
        (p.address ? '<div>' + E(p.address) + '</div>' : '') +
        (p.taxId ? '<div>เลขผู้เสียภาษี ' + E(p.taxId) + E(branch) + '</div>' : '') +
        (p.phone ? '<div>โทร. ' + E(p.phone) + '</div>' : '') +
        '</div>';
    }).join('');
    return cols ? '<div class="dp-party">' + cols + '</div>' : '';
  }

  /* 2.3 หน้ากลางต้องบอกยอดยกไป และหน้าถัดไปรับยอดยกมา — ไม่งั้นคนอ่านรวมเลขเองไม่ได้
     และไม่รู้ว่าได้กระดาษครบหรือเปล่า (เอกสารไม่มีราคาไม่ต้องมี) */
  function carryRow(label, amount) {
    return '<div class="dp-carry"><span>' + E(label) + '</span><span>' + E(money(amount)) + '</span></div>';
  }

  function docFoot(spec) {
    var totals = (spec.totals || []).map(function (t) {
      return '<tr' + (t[2] === 'grand' ? ' class="dp-grand"' : '') + '><td>' + E(t[0]) + '</td><td>' + E(t[1]) + '</td></tr>';
    }).join('');
    var iss = spec.issuer || {};
    var bank = (spec.showBank && iss.bankAccountNo)
      ? '<div class="dp-bank">ชำระเงินโอนเข้าบัญชี ' + E(iss.bankName || '') + ' เลขที่ ' + E(iss.bankAccountNo) +
        (iss.bankAccountName ? ' ชื่อบัญชี ' + E(iss.bankAccountName) : '') + '</div>' : '';
    var signers = (spec.signers || []).map(function (s) {
      return '<div><div class="dp-line"></div>' + E(s) + '<div style="color:#666">วันที่ ______/______/______</div></div>';
    }).join('');
    return '<div class="dp-foot">' +
        '<div class="dp-sumwrap">' +
          '<div class="dp-note">' + (spec.note ? E(spec.note) : '') + bank + '</div>' +
          (totals ? '<div class="dp-sum"><table>' + totals + '</table></div>' : '') +
        '</div>' +
        (signers ? '<div class="dp-sign">' + signers + '</div>' : '') +
      '</div>';
  }

  function docRowHtml(spec, line, idx) {
    return '<tr' + (line._free ? ' class="dp-free"' : '') + '>' +
      spec.columns.map(function (c) {
        var v = typeof c.value === 'function' ? c.value(line, idx) : (line[c.key] === undefined ? '' : line[c.key]);
        return '<td class="' + (c.align || '') + (c.code ? ' dp-code' : '') + '">' + (c.html ? v : E(v)) + '</td>';
      }).join('') + '</tr>';
  }

  function docPrintDoc(spec) {
    ensureShell();
    var colgroup = '<colgroup>' + spec.columns.map(function (c) {
      return '<col' + (c.width ? ' style="width:' + c.width + '"' : '') + '>'; }).join('') + '</colgroup>';
    var thead = '<thead><tr>' + spec.columns.map(function (c) {
      return '<th class="' + (c.align || '') + '">' + E(c.label) + '</th>'; }).join('') + '</tr></thead>';
    var wm = spec.watermark ? '<div class="dp-wm"><span>' + E(spec.watermark) + '</span></div>' : '';

    var rowsHtml = spec.lines.map(function (l, i) { return docRowHtml(spec, l, i); });
    // ยอดของแต่ละบรรทัด ใช้คิดยอดยกไป/ยกมา (เอกสารที่ไม่พิมพ์ราคาไม่ต้องมี)
    var amounts = spec.carry === false ? null : spec.lines.map(function (l) { return (l._free ? 0 : (parseFloat(l.lineTotal) || 0)); });
    var render = function (rows, withFooter, pageNo, pageCount, carryIn, carryOut) {
      return '<div class="docsheet">' + wm +
        docHead(spec, pageNo || 1, pageCount || 1) + docParty(spec) +
        (carryIn !== null && carryIn !== undefined ? carryRow('ยอดยกมาจากหน้าที่แล้ว', carryIn) : '') +
        '<table class="dp-tbl">' + colgroup + thead + '<tbody>' + rows.join('') + '</tbody></table>' +
        (withFooter ? docFoot(spec)
          : (carryOut !== null && carryOut !== undefined ? carryRow('ยอดยกไปหน้าถัดไป', carryOut) : '') +
            '<div class="dp-foot"><div class="dp-pg">มีต่อหน้าถัดไป →</div></div>') +
        '</div>';
    };
    // ตอนวัดความสูงต้องใส่แถบยอดยกไป/ยกมาเข้าไปด้วย ไม่งั้นสูงไม่ตรงกับของจริงแล้วหน้าสุดท้ายจะล้น
    var pages = paginate(rowsHtml, function (rows, withFooter, startIndex) {
      var cIn = (amounts && startIndex > 0) ? 0 : null;
      var cOut = (amounts && !withFooter) ? 0 : null;
      return render(rows, withFooter, 1, 2, cIn, cOut);
    });
    var running = 0, at = 0;
    var html = pages.map(function (p, i) {
      var cIn = (amounts && i > 0) ? running : null;
      for (var k = 0; k < p.rows.length; k++) running += amounts ? amounts[at + k] : 0;
      at += p.rows.length;
      var cOut = (amounts && !p.last) ? running : null;
      return render(p.rows, p.last, i + 1, pages.length, cIn, cOut);
    });
    show((spec.title || 'เอกสาร') + (spec.docNo ? ' ' + spec.docNo : ''), html, { xlsx: spec.xlsx });
  }

  /* ── ใบปะหน้าพัสดุ (สติกเกอร์) ──────────────────────────────────────────────
     ไม่มีตารางรายการ = ไม่ต้องแบ่งหน้า · ตัวอักษรใหญ่พอให้อ่านจากระยะแขน และห้ามมีราคาเด็ดขาด
     (เอกสารใบนี้ติดอยู่บนกล่องตลอดทาง คนเห็นระหว่างทางเยอะที่สุดในบรรดาเอกสารทั้งหมด) */
  function docPrintLabel(spec) {
    ensureShell();
    var to = spec.to || {}, from = spec.from || {};
    var sheets = [];
    var count = Math.max(1, parseInt(spec.boxes, 10) || 1);
    for (var b = 1; b <= count; b++) {
      sheets.push('<div class="docsheet dp-label">' +
        '<div class="dp-lb-from"><b>ผู้ส่ง</b> ' + E(from.name || '') +
          (from.phone ? ' · โทร. ' + E(from.phone) : '') +
          (from.address ? '<div>' + E(from.address) + '</div>' : '') + '</div>' +
        '<div class="dp-lb-code">' + E(spec.docNo || '') + (count > 1 ? '  (' + b + '/' + count + ')' : '') + '</div>' +
        '<div class="dp-lb-to">' +
          '<div class="dp-lb-lbl">ผู้รับ</div>' +
          '<div class="dp-lb-name">' + E(to.name || '') + '</div>' +
          '<div class="dp-lb-addr">' + E(to.address || '') + '</div>' +
          (to.phone ? '<div class="dp-lb-tel">โทร. ' + E(to.phone) + '</div>' : '') +
        '</div>' +
        '<div class="dp-lb-foot"><span>' + E(spec.dateStr || '') + '</span>' +
          '<span>' + E(spec.summary || '') + '</span></div>' +
        (spec.note ? '<div style="font-size:.9em;margin-top:.3em">' + E(spec.note) + '</div>' : '') +
        '</div>');
    }
    show('ใบปะหน้าพัสดุ ' + (spec.docNo || ''), sheets, { paper: 'label100x150' });
  }

  /* ── รายงานตาราง ────────────────────────────────────────────────────────── */
  function docPrintTable(spec) {
    ensureShell();
    var weights = spec.weights || spec.headers.map(function () { return 1; });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    var colgroup = '<colgroup>' + weights.map(function (w) {
      return '<col style="width:' + (w / sum * 100).toFixed(2) + '%">'; }).join('') + '</colgroup>';
    var thead = '<thead><tr>' + spec.headers.map(function (h, i) {
      return '<th class="' + ((spec.align && spec.align[i]) || '') + '">' + E(h) + '</th>'; }).join('') + '</tr></thead>';
    var rowsHtml = spec.rows.map(function (r, ri) {
      return '<tr' + ((spec.boldRows || []).indexOf(ri) >= 0 ? ' class="dp-bold"' : '') + '>' +
        r.map(function (c, ci) { return '<td class="' + ((spec.align && spec.align[ci]) || '') + '">' + E(c) + '</td>'; }).join('') + '</tr>';
    });
    var render = function (rows, withFooter, pageNo, pageCount) {
      return '<div class="docsheet">' +
        '<div class="dp-head"><div class="dp-issuer"><div class="dp-name">' + E(spec.title) + '</div>' +
          (spec.subtitle ? '<div>' + E(spec.subtitle) + '</div>' : '') + '</div>' +
          '<div class="dp-docbox"><div class="dp-meta">' +
            (spec.issuerName ? '<div><span>ผู้ออกรายงาน</span><span>' + E(spec.issuerName) + '</span></div>' : '') +
            '<div><span>พิมพ์เมื่อ</span><span>' + E(spec.printedAt || new Date().toLocaleString('th-TH')) + '</span></div>' +
            (pageCount > 1 ? '<div><span>หน้า</span><span>' + pageNo + ' / ' + pageCount + '</span></div>' : '') +
          '</div></div></div>' +
        '<table class="dp-tbl">' + colgroup + thead + '<tbody>' + rows.join('') + '</tbody></table>' +
        (withFooter ? '<div class="dp-foot">' + (spec.note ? '<div class="dp-note">' + E(spec.note) + '</div>' : '') +
            '<div class="dp-pg">รวม ' + spec.rows.length + ' รายการ</div></div>'
          : '<div class="dp-foot"><div class="dp-pg">มีต่อหน้าถัดไป →</div></div>') +
        '</div>';
    };
    var pages = paginate(rowsHtml, function (rows, withFooter) { return render(rows, withFooter, 1, 2); });
    var html = pages.map(function (p, i) { return render(p.rows, p.last, i + 1, pages.length); });
    show(spec.title, html, { xlsx: { filename: spec.filename || spec.title, headers: spec.headers, rows: spec.rows, note: spec.note } });
  }

  /* ── ส่งออก Excel จริง (ไม่ใช่ CSV: Excel ตัดศูนย์นำหน้าทิ้ง และไทยเพี้ยนถ้าลืม BOM) ── */
  function docPrintXlsx(spec) {
    var go = function (XLSX) {
      var aoa = [spec.headers].concat(spec.rows.map(function (r) { return r.map(function (c) { return String(c === null || c === undefined ? '' : c); }); }));
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      Object.keys(ws).forEach(function (k) { if (k[0] !== '!' && ws[k]) ws[k].t = 's'; });   // บังคับทุกช่องเป็นข้อความ
      ws['!cols'] = spec.headers.map(function (h, i) {
        var w = String(h).length;
        spec.rows.forEach(function (r) { w = Math.max(w, String(r[i] === undefined ? '' : r[i]).length); });
        return { wch: Math.min(48, Math.max(8, w + 2)) };
      });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'ข้อมูล');
      XLSX.writeFile(wb, String(spec.filename || 'export').replace(/[\\/:*?"<>|]/g, '_') + '.xlsx');
    };
    if (window.XLSX) return go(window.XLSX);
    if (typeof loadSheetJS === 'function') return loadSheetJS().then(go);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = function () { go(window.XLSX); };
    document.head.appendChild(s);
  }

  window.DocPrint = { doc: docPrintDoc, table: docPrintTable, label: docPrintLabel, xlsx: docPrintXlsx,
    close: close, money: money, esc: E };
})();
