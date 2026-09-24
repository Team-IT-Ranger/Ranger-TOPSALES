/* ตั้งค่าตามสภาพแวดล้อม — ไฟล์เดียวใช้ได้ทุกที่ ไม่มีค่าที่ต่างกันตาม branch (merge UAT → main จึงไม่ชนกัน)
   ENV ตัดสินจาก URL ที่เปิด: /admin-uat/ และ localhost = 'uat' · นอกนั้น (/admin/) = 'prod'

   สถานะ ณ 2026-09-24: **เปิด production แล้ว** — โปรเจกต์ prod 1XObaZXu… (เจ้าของ channarong@thanatkorn.com
   บัญชีเดียวกับ dev/uat และเป็นเจ้าของไฟล์ฐานข้อมูลทั้งหมด) มี Central Sheet + ผังบัญชีของตัวเองแยกจาก UAT
   - ห้ามเอา URL ของ dev หรือ uat มาใส่ช่อง prod เด็ดขาด (เคยพลาดมาแล้วตอนเข้าใจผิดว่า dev คือ production) */
(function(){
  var BACKENDS = {
    /* salesranger-TOPSHOP-be(prod) 1XObaZXu… — deployment แรก 24 ก.ย. 2026 */
    prod: 'https://script.google.com/macros/s/AKfycbxGSgR4oQLbS1kyy6c-JIj4g4ZaRUhk-bLnz3z_R2YQIu4guMsueyfxH3xK4eggRJorzQ/exec',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT */
  };
  var h = location.hostname, p = location.pathname;
  var env = (p.indexOf('/admin-uat/') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env] };
})();
