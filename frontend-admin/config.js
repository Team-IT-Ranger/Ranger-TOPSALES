/* ตั้งค่าตามสภาพแวดล้อม — ไฟล์เดียวใช้ได้ทุกที่ ไม่มีค่าที่ต่างกันตาม branch (merge UAT → main จึงไม่ชนกัน)
   ENV ตัดสินจาก **hostname** ที่เปิด (ไม่ใช่ path อีกต่อไป — ย้ายจาก GitHub Pages แบบ path-routed
   /admin/ กับ /admin-uat/ ไป Cloudflare Pages แบบคนละโดเมน/โปรเจกต์แล้ว 2026-09-29):
   hostname มีคำว่า "uat" (Cloudflare Pages ตั้งชื่อ branch alias ของกิ่ง UAT เป็น uat.<โปรเจกต์>.pages.dev
   ให้เองอัตโนมัติ ตัวพิมพ์เล็กเสมอ) หรือ localhost = 'uat' · นอกนั้น = 'prod'

   URL จริงหลังย้าย (2026-09-29): prod = https://ranger-topsales-admin.pages.dev/ (ยืนยันแล้วว่าโหลดถูกต้อง
   เข้าหน้า login ปกติ ไม่ขึ้นแบนเนอร์ "ยังไม่เปิดใช้งาน") · uat = https://uat.ranger-topsales-admin.pages.dev/
   (โปรเจกต์เพิ่งต่อ Cloudflare ครั้งแรก กิ่ง UAT ยังไม่ build ให้ตอนตรวจ — commit นี้ยิง push เพื่อกระตุ้น build ด้วย)

   สถานะ ณ 2026-09-24: **เปิด production แล้ว** — โปรเจกต์ prod 1XObaZXu… (เจ้าของ channarong@thanatkorn.com
   บัญชีเดียวกับ dev/uat และเป็นเจ้าของไฟล์ฐานข้อมูลทั้งหมด) มี Central Sheet + ผังบัญชีของตัวเองแยกจาก UAT
   - ห้ามเอา URL ของ dev หรือ uat มาใส่ช่อง prod เด็ดขาด (เคยพลาดมาแล้วตอนเข้าใจผิดว่า dev คือ production) */
(function(){
  var BACKENDS = {
    /* salesranger-TOPSHOP-be(prod) 1XObaZXu… — deployment แรก 24 ก.ย. 2026 */
    prod: 'https://script.google.com/macros/s/AKfycbxGSgR4oQLbS1kyy6c-JIj4g4ZaRUhk-bLnz3z_R2YQIu4guMsueyfxH3xK4eggRJorzQ/exec',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT */
  };
  var h = location.hostname;
  var env = (h.indexOf('uat') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env] };
})();
