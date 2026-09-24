/* ตั้งค่าตามสภาพแวดล้อม — ไฟล์เดียวใช้ได้ทุกที่ ไม่มีค่าที่ต่างกันตาม branch (merge UAT → main จึงไม่ชนกัน)
   ENV ตัดสินจาก URL ที่เปิด: /admin-uat/ และ localhost = 'uat' · นอกนั้น (/admin/) = 'prod'

   สถานะ ณ 2026-09-24: production กำลังตั้งขึ้น — เจ้าของระบบตัดสินใจให้โปรเจกต์ prod อยู่กับบัญชี
   channarong@thanatkorn.com (บัญชีเดียวกับ dev/uat และเป็นเจ้าของไฟล์ฐานข้อมูลทั้งหมด)
   - รอ script id + Web App URL ของโปรเจกต์นั้น แล้วค่อยเติมช่อง prod ด้านล่าง
   - ห้ามเอา URL ของ dev หรือ uat มาใส่ช่อง prod เด็ดขาด (เคยพลาดมาแล้วตอนเข้าใจผิดว่า dev คือ production) */
(function(){
  var BACKENDS = {
    /* ว่างไว้จนกว่าจะมี Web App URL ของโปรเจกต์ prod ที่เจ้าของระบบสร้าง (ดูหมายเหตุด้านบน)
       ว่างอยู่ = เปิด /admin/ แล้วล็อกอินไม่ได้ + ขึ้นแถบแจ้งว่ายังไม่เปิดใช้งาน (ปลอดภัยไว้ก่อน) */
    prod: '',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT */
  };
  var h = location.hostname, p = location.pathname;
  var env = (p.indexOf('/admin-uat/') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env] };
})();
