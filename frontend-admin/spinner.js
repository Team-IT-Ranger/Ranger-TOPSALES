/* TNK spinner — concentric "orbit" rings (yellow → green → teal → blue), used for every waiting moment.
 *
 * Self-contained: this one file carries its own CSS and SVG, so it can be copied into any other app unchanged.
 *   <script src="spinner.js"></script>            (anywhere in <body>, before the code that uses it)
 *   <div data-tnk-spin="64"></div>                 static markup → filled automatically (number = size in px)
 *   tnkSpinner(48)                                 → SVG string, e.g. el.innerHTML = tnkSpinner(48)
 *   tnkWait(120, 'กำลังโหลด…')                     → centred spinner block (min-height px, optional caption)
 *   tnkBusy(button, true|false)                    → small spinner inside a button while it is working (also disables it)
 *   tnkNetBusy(+1 | -1)                            → floating corner spinner that shows after 350 ms of pending work
 */
(function () {
  'use strict';
  if (window.tnkSpinner) return;

  var uid = 0;

  var CSS =
    '.tnk-spin{display:inline-block;width:var(--s,64px);height:var(--s,64px);flex:0 0 auto;vertical-align:middle;overflow:visible}' +
    '.tnk-spin .tr{transform-origin:50px 50px;animation:tnkOrbit 3.4s linear infinite}' +
    '.tnk-spin .tr2{animation-duration:2.5s;animation-direction:reverse}' +
    '.tnk-spin .tr3{animation-duration:1.7s}' +
    '@keyframes tnkOrbit{to{transform:rotate(360deg)}}' +
    '.tnk-wait{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:100%;color:inherit;font-size:13px;opacity:.95}' +
    '.tnk-wait .tnk-cap{opacity:.75;font-weight:600}' +
    '.tnk-btn-spin{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;flex:0 0 auto;margin-right:2px;box-shadow:0 1px 4px rgba(0,0,0,.2)}' +
    '.tnk-net{position:fixed;right:16px;bottom:16px;z-index:900;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.94);' +
      'box-shadow:0 8px 24px -6px rgba(15,23,42,.45);opacity:0;transform:scale(.7);pointer-events:none;transition:opacity .2s,transform .2s}' +
    '.tnk-net.on{opacity:1;transform:scale(1)}' +
    '@media (prefers-reduced-motion:reduce){.tnk-spin .tr{animation-duration:9s}.tnk-spin .tr2{animation-duration:7s}.tnk-spin .tr3{animation-duration:5s}}';

  function addCss() {
    if (document.getElementById('tnkSpinCss')) return;
    var s = document.createElement('style'); s.id = 'tnkSpinCss'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  addCss();

  // Three open rings (outer / middle / inner), each ending in round dots, plus a few loose dots — drawn in a 100×100 box.
  function spinner(size) {
    var id = 'tnkg' + (++uid), f = 'url(#' + id + ')', px = (Number(size) > 0 ? Number(size) : 64) + 'px';
    function ring(cls, d, dots) {
      return '<g class="tr ' + cls + '"><path d="' + d + '" fill="none" stroke="' + f + '" stroke-width="3.3" stroke-linecap="round"/>' +
        dots.map(function (c) { return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="' + f + '"/>'; }).join('') + '</g>';
    }
    return '<svg class="tnk-spin" style="--s:' + px + '" viewBox="0 0 100 100" role="img" aria-label="กำลังโหลด">' +
      '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="8" y1="10" x2="92" y2="90">' +
      '<stop offset="0" stop-color="#FBBF24"/><stop offset=".33" stop-color="#7ED957"/><stop offset=".68" stop-color="#1FB5A5"/><stop offset="1" stop-color="#2D7FF0"/>' +
      '</linearGradient></defs>' +
      ring('tr1', 'M42.36 6.67A44 44 0 1 1 8.65 34.95', [[42.36, 6.67, 3.6], [8.65, 34.95, 3.6], [86, 24.8, 3.1], [21.7, 16.3, 2.8]]) +
      ring('tr2', 'M69.93 26.25A31 31 0 1 1 30.07 26.25', [[69.93, 26.25, 3.3], [30.07, 26.25, 3.3], [50, 19, 2.5]]) +
      ring('tr3', 'M65.97 44.18A17 17 0 1 1 55.81 34.03', [[65.97, 44.18, 3.2], [55.81, 34.03, 3.2]]) +
      '</svg>';
  }

  function fill(root) {
    (root || document).querySelectorAll('[data-tnk-spin]').forEach(function (el) {
      if (el.firstChild) return;
      el.innerHTML = spinner(el.getAttribute('data-tnk-spin'));
    });
  }

  function wait(minHeight, caption, size) {
    return '<div class="tnk-wait" style="min-height:' + (Number(minHeight) || 80) + 'px">' + spinner(size || 56) +
      (caption ? '<span class="tnk-cap">' + String(caption).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) + '</span>' : '') + '</div>';
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    var s = btn.querySelector('.tnk-btn-spin');
    if (on && !s) btn.insertAdjacentHTML('afterbegin', '<span class="tnk-btn-spin">' + spinner(18) + '</span>');
    else if (!on && s) s.remove();
  }

  // floating "something is loading" badge for background calls (favourite, review, refresh …)
  var pending = 0, netEl = null, netTimer = null;
  function netBusy(delta) {
    pending = Math.max(0, pending + delta);
    if (pending > 0) {
      if (netTimer || (netEl && netEl.classList.contains('on'))) return;
      netTimer = setTimeout(function () {
        netTimer = null; if (!pending || !document.body) return;
        if (!netEl) { netEl = document.createElement('div'); netEl.className = 'tnk-net'; netEl.setAttribute('aria-hidden', 'true'); netEl.innerHTML = spinner(36); document.body.appendChild(netEl); }
        netEl.classList.add('on');
      }, 350);
    } else {
      clearTimeout(netTimer); netTimer = null;
      if (netEl) netEl.classList.remove('on');
    }
  }

  window.tnkSpinner = spinner; window.tnkWait = wait; window.tnkBusy = busy; window.tnkNetBusy = netBusy; window.tnkSpinFill = fill;
  fill();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { fill(); });
})();
