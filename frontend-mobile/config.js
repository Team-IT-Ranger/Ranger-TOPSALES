/* ตั้งค่าตามสภาพแวดล้อม — แบบเดียวกับ frontend-admin/config.js (ไฟล์เดียวใช้ได้ทุก branch, merge UAT → main ไม่ชนกัน)
   ENV ตัดสินจาก **hostname** ที่เปิด (ไม่ใช่ path อีกต่อไป — ย้ายจาก GitHub Pages แบบ path-routed
   /mobile/ กับ /mobile-uat/ ไป Cloudflare Pages แบบคนละโดเมน/โปรเจกต์แล้ว 2026-09-29):
   hostname มีคำว่า "uat" (Cloudflare Pages ตั้งชื่อ branch alias ของกิ่ง UAT เป็น uat.<โปรเจกต์>.pages.dev
   ให้เองอัตโนมัติ ตัวพิมพ์เล็กเสมอ) หรือ localhost = 'uat' (ห้ามแตะข้อมูลจริง), นอกนั้น = 'prod'
   BACKENDS ต้องตรงกับ frontend-admin/config.js — backend ตัวเดียวกัน (Mobile ใช้ action กลุ่ม ACTION_MAP ใน 05_router.gs)
   LIFF_IDS: สร้าง LIFF app แยกต่อสภาพแวดล้อมใน LINE Developers Console — Endpoint URL ต้องอัปเดตให้ตรงกับ
             URL ของ Cloudflare Pages โปรเจกต์ mobile ทั้งสอง env (ดู CLAUDE.md หัวข้อ deploy สำหรับ URL ปัจจุบัน)
             ทั้งคู่อยู่ใต้ LINE Login channel เดียวกัน 2010417493 · ต้องติ๊ก scope openid ของ LIFF ทั้งสองตัว
             ไม่งั้น liff.getIDToken() ว่างและ backend จะไม่ให้ผ่าน */
(function(){
  var BACKENDS = {
    /* salesranger-TOPSHOP-be(prod) — backend ตัวเดียวกับที่แอดมินฝั่ง prod ใช้ */
    prod: 'https://script.google.com/macros/s/AKfycbxGSgR4oQLbS1kyy6c-JIj4g4ZaRUhk-bLnz3z_R2YQIu4guMsueyfxH3xK4eggRJorzQ/exec',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT — ห้ามใส่ URL ของ production ตรงนี้ */
  };
  var LIFF_IDS = {
    /* Endpoint URL ต้องอัปเดตใน LINE Developers Console ให้ตรงกับ URL ใหม่นี้เป๊ะ ไม่งั้น LIFF เปิดไม่ขึ้น */
    prod: '2010417493-GXAqTbSu',   /* Endpoint URL ใหม่: https://ranger-topsales-mobile.pages.dev/ */
    uat:  '2010417493-pYb6cS8e'   /* Endpoint URL ใหม่: https://uat.ranger-topsales-mobile.pages.dev/ */
  };
  var h = location.hostname;
  var env = (h.indexOf('uat') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env], LIFF_ID: LIFF_IDS[env] };
})();
