/* ═══════════════════════════════════════════════════════════════════════════
   กระดานลากการ์ด — เครื่องมือกลาง โหลดตอนจะใช้ครั้งแรกเท่านั้น (ไม่ถ่วงเวลาเปิดแอป)

   ★ ตัวนี้ "ไม่รู้จักบิลขาย" เลยสักนิด รู้แค่การ์ด คอลัมน์ และ "ย้ายแล้วเรียกอะไร"
     ตรรกะธุรกิจทั้งหมดอยู่ที่หน้าที่เรียกใช้ และคำตัดสินสุดท้ายอยู่ที่ backend เสมอ
     เอาไปใช้กับงานที่สอง (คิวตรวจรับใบนำเข้า · คำขอเปิดร้านใหม่) ต้องไม่ต้องแก้ไฟล์นี้เลยสักบรรทัด

   ★★ ใช้ Pointer Events ไม่ใช่ HTML5 `draggable` เพราะ
      1) `draggable` ไม่ทำงานบนจอสัมผัส — ศูนย์ฯ ใช้แท็บเล็ตคู่กับเมาส์ และแอปมือถือเป็น LIFF บนโทรศัพท์ล้วน
      2) ภาพที่ลากตาม (drag image) ของ HTML5 ปรับหน้าตาไม่ได้ และภาษาไทยเรนเดอร์เพี้ยนในบางเครื่อง
      Pointer Events ได้ทั้งเมาส์/นิ้ว/ปากกา จากโค้ดชุดเดียว

   ★★★ ย้ายการ์ดก่อน ยิง API ทีหลัง (optimistic) — Apps Script มีค่าคงที่ ~1.9 วินาทีต่อคำขอ
      รอผลก่อนขยับการ์ดจะช้าจนใช้ไม่ได้จริง · แลกมาด้วย "ทางถอยต้องเชื่อถือได้"
      ซึ่งเป็นหน้าที่ของผู้เรียกใน onMove (ย้ายกลับเองเมื่อ backend ปฏิเสธ)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CSS = [
    '.dgb{display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding-bottom:4px}',
    /* ★ ใช้ชื่อตัวแปรจริงของแอป (--ground/--surface/--border/--blue) ไม่ใช่ชื่อที่เดาเอง
       ของเดิมเขียน var(--bg) / var(--primary) ซึ่งไม่มีในธีมนี้ รอดมาเพราะค่า fallback เท่านั้น
       แปลว่าถ้าวันหนึ่งธีมเปลี่ยนสี กระดานจะไม่เปลี่ยนตามโดยไม่มีใครรู้ */
    '.dgb-col{flex:0 0 236px;background:var(--ground,#F6F8FC);border:1px solid var(--border,#E4E9F1);',
    '  border-radius:10px;display:flex;flex-direction:column;min-height:160px;overflow:hidden}',
    '.dgb-colh{padding:9px 12px;border-bottom:1px solid var(--border,#E4E9F1);display:flex;',
    '  justify-content:space-between;align-items:flex-start;gap:8px}',
    '.dgb-colh b{font-size:.86rem;font-weight:600;display:block}',
    '.dgb-sub{font-size:.76rem;opacity:.72;font-variant-numeric:tabular-nums;display:block;margin-top:1px}',
    '.dgb-ct{font-size:.78rem;opacity:.6;font-variant-numeric:tabular-nums;flex:0 0 auto;padding-top:1px}',
    '.dgb-colb{padding:10px;display:flex;flex-direction:column;gap:8px;flex:1}',
    /* ★ touch-action:none จำเป็น ไม่งั้นนิ้วที่ลากการ์ดจะเลื่อนหน้าแทน แล้วลากไม่ได้เลยบนมือถือ */
    '.dgb-card{background:var(--surface,#fff);border:1px solid var(--border,#E4E9F1);border-radius:8px;padding:9px 11px;',
    '  cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}',
    '.dgb-card:active{cursor:grabbing}',
    '.dgb-card:focus-visible{outline:2px solid var(--blue,#2B63D9);outline-offset:2px}',
    '.dgb-card.dgb-ghost{opacity:.3}',
    '.dgb-card.dgb-busy{opacity:.55}',
    '.dgb-fly{position:fixed;z-index:9999;width:214px;pointer-events:none;',
    '  box-shadow:0 12px 30px -8px rgba(27,36,52,.45);transform:rotate(-1.5deg)}',
    '.dgb-col.dgb-ok{outline:2px dashed var(--blue,#2B63D9);outline-offset:-4px}',
    '.dgb-col.dgb-no{opacity:.38}',
    '.dgb-empty{text-align:center;font-size:.82rem;opacity:.5;padding:12px 4px}',
    '@media (prefers-reduced-motion:reduce){.dgb-fly{transform:none}}'
  ].join('\n');

  var shellReady = false;
  function ensureShell() {
    if (shellReady) return;
    var st = document.createElement('style');
    st.id = 'dgb-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    shellReady = true;
  }

  var E = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  };

  /**
   * mount(el, spec)
   *   spec.columns  [{ key, label }]                 คอลัมน์เรียงซ้าย→ขวา
   *   spec.cards    [{ id, col, html, busy? }]       การ์ด (html คือเนื้อในการ์ด ผู้เรียกจัดเอง)
   *   spec.canMove  (card, toKey) → bool             ถามก่อนไฮไลต์/ก่อนปล่อย · ไม่ตอบ = ย้ายได้
   *   spec.confirmText (card, toKey) → string|null   คืนข้อความ = ต้องยืนยันก่อน
   *   spec.onMove   (card, fromKey, toKey)           ผู้เรียกเป็นคนย้ายข้อมูลจริงและยิง API
   *   spec.onOpen   (card)                           แตะการ์ดเฉยๆ (ไม่ได้ลาก)
   *   spec.emptyText                                 ข้อความตอนคอลัมน์ว่าง
   */
  function mount(el, spec) {
    ensureShell();
    el.className = 'dgb';
    el.innerHTML = spec.columns.map(function (c) {
      var mine = spec.cards.filter(function (x) { return String(x.col) === String(c.key); });
      /* c.tone = สีหัวคอลัมน์ (ผู้เรียกเป็นคนเลือก เครื่องมือไม่รู้ว่าสีไหนแปลว่าอะไร)
         c.sub  = บรรทัดรองใต้ชื่อ เช่น ยอดรวมเงินของคอลัมน์นั้น */
      var sub = typeof spec.columnSub === 'function' ? spec.columnSub(c, mine) : c.sub;
      return '<div class="dgb-col" data-col="' + E(c.key) + '">' +
        '<div class="dgb-colh"' + (c.tone ? ' style="background:' + E(c.tone) + '"' : '') + '>' +
          '<span><b>' + E(c.label) + '</b>' + (sub ? '<span class="dgb-sub">' + E(sub) + '</span>' : '') + '</span>' +
          '<span class="dgb-ct">' + mine.length + '</span></div>' +
        '<div class="dgb-colb">' +
          (mine.length ? mine.map(cardHtml).join('') : '<div class="dgb-empty">' + E(spec.emptyText || 'ว่าง') + '</div>') +
        '</div></div>';
    }).join('');
    if (!el.__dgb) bind(el, spec);
    el.__dgb = spec;          // ผูก spec ล่าสุดไว้ ให้ตัวจับ event ใช้ของรอบปัจจุบันเสมอ
  }

  function cardHtml(c) {
    return '<div class="dgb-card' + (c.busy ? ' dgb-busy' : '') + '" data-dgb-id="' + E(c.id) + '"' +
      ' data-dgb-col="' + E(c.col) + '" tabindex="0" role="button">' + (c.html || '') + '</div>';
  }

  function bind(el, _spec) {
    var drag = null;

    function spec() { return el.__dgb; }
    function cardOf(id) {
      var list = spec().cards;
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
      return null;
    }
    function allowed(card, to) {
      var s = spec();
      return typeof s.canMove === 'function' ? !!s.canMove(card, to) : true;
    }
    function colUnder(x, y) {
      var node = document.elementFromPoint(x, y);
      var col = node && node.closest ? node.closest('.dgb-col') : null;
      // เทียบว่าคอลัมน์นั้นอยู่ในกระดานนี้จริง — หน้าหนึ่งมีกระดานได้มากกว่าหนึ่งอัน
      return (col && el.contains(col)) ? col.getAttribute('data-col') : null;
    }
    function clearMarks() {
      [].forEach.call(el.querySelectorAll('.dgb-col'), function (c) { c.classList.remove('dgb-ok', 'dgb-no'); });
    }

    el.addEventListener('pointerdown', function (e) {
      var node = e.target.closest ? e.target.closest('[data-dgb-id]') : null;
      if (!node || (e.button !== undefined && e.button !== 0)) return;
      var card = cardOf(node.getAttribute('data-dgb-id'));
      if (!card || card.busy) return;
      try { node.setPointerCapture(e.pointerId); } catch (err) {}
      drag = { node: node, card: card, from: card.col, started: false, x: e.clientX, y: e.clientY, fly: null, dx: 0, dy: 0 };
    });

    el.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (!drag.started) {
        /* ★ ต้องเลื่อนเกิน 4px ก่อนถึงนับว่าลาก — ไม่งั้นนิ้วสั่นนิดเดียวกลายเป็นลาก
           แล้ว "แตะเพื่อเปิดใบ" จะใช้ไม่ได้เลยบนมือถือ */
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
        drag.started = true;
        var r = drag.node.getBoundingClientRect();
        drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
        var fly = drag.node.cloneNode(true);
        fly.className = 'dgb-card dgb-fly';
        fly.style.width = r.width + 'px';
        document.body.appendChild(fly);
        drag.fly = fly;
        drag.node.classList.add('dgb-ghost');
        [].forEach.call(el.querySelectorAll('.dgb-col'), function (c) {
          var k = c.getAttribute('data-col');
          if (k !== drag.from && !allowed(drag.card, k)) c.classList.add('dgb-no');
        });
      }
      drag.fly.style.left = (e.clientX - drag.dx) + 'px';
      drag.fly.style.top = (e.clientY - drag.dy) + 'px';
      var over = colUnder(e.clientX, e.clientY);
      [].forEach.call(el.querySelectorAll('.dgb-col'), function (c) {
        var k = c.getAttribute('data-col');
        c.classList.toggle('dgb-ok', !!over && k === over && k !== drag.from && allowed(drag.card, k));
      });
    });

    function finish(e, dropping) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.fly) d.fly.remove();
      d.node.classList.remove('dgb-ghost');
      clearMarks();
      var s = spec();
      if (!d.started) {                                   // แตะเฉยๆ ไม่ได้ลาก
        if (dropping && typeof s.onOpen === 'function') s.onOpen(d.card);
        return;
      }
      if (!dropping) return;
      var to = colUnder(e.clientX, e.clientY);
      if (!to || to === d.from || !allowed(d.card, to)) return;
      var ask = typeof s.confirmText === 'function' ? s.confirmText(d.card, to) : null;
      if (ask && !window.confirm(ask)) return;
      s.onMove(d.card, d.from, to);
    }
    el.addEventListener('pointerup', function (e) { finish(e, true); });
    /* ★ pointercancel ต้องเก็บกวาดเหมือน pointerup — ระบบยึด pointer คืนตอนมีสายเข้า/สลับแอป/เลื่อนจอ
       ลืมข้อนี้แล้วการ์ดจำลองจะค้างลอยกลางจอถาวร ผู้ใช้ต้องรีเฟรชหน้าทิ้ง */
    el.addEventListener('pointercancel', function (e) { finish(e, false); });

    /* ลากอย่างเดียวใช้ไม่ได้สำหรับทุกคน — โฟกัสการ์ดแล้วกดลูกศรซ้าย/ขวาย้ายได้ด้วย */
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var node = e.target.closest ? e.target.closest('[data-dgb-id]') : null;
      if (!node) return;
      var s = spec(), card = cardOf(node.getAttribute('data-dgb-id'));
      if (!card || card.busy) return;
      var keys = s.columns.map(function (c) { return String(c.key); });
      var i = keys.indexOf(String(card.col)) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i < 0 || i >= keys.length) return;
      var to = keys[i];
      if (!allowed(card, to)) return;
      e.preventDefault();
      var ask = typeof s.confirmText === 'function' ? s.confirmText(card, to) : null;
      if (ask && !window.confirm(ask)) return;
      s.onMove(card, card.col, to);
    });
  }

  window.DragBoard = { mount: mount };
})();
