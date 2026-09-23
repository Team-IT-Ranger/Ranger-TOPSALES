/* ตั้งค่าตามสภาพแวดล้อม — ไฟล์เดียวใช้ได้ทุกที่ ไม่มีค่าที่ต่างกันตาม branch (merge UAT → main จึงไม่ชนกัน)
   ENV ตัดสินจาก URL ที่เปิด: /admin-uat/ และ localhost = 'uat' · นอกนั้น (/admin/) = 'prod'

   สถานะจริง ณ 2026-09-23: **ยังไม่มีสภาพแวดล้อม production**
   - มีแค่ 2 โปรเจกต์ Apps Script: dev (1iVJDVuc…) ที่เจ้าของระบบใช้เอง และ uat (1SDBJgSN…) ที่แอปนี้ใช้ทดสอบ
   - BACKENDS.prod จึงเว้นว่างไว้โดยเจตนา = เปิด /admin/ แล้วล็อกอินไม่ได้ + ขึ้นแถบแจ้งว่ายังไม่เปิดใช้งาน
     (เคยตั้งผิดเป็น URL ของโปรเจกต์ dev อยู่ช่วงหนึ่ง ทำให้เว็บ "ตัวจริง" คุยกับ dev — ห้ามใส่กลับมาอีก)
   - เมื่อสร้างโปรเจกต์ production จริงแล้ว ค่อยเอา Web App URL ของโปรเจกต์นั้นมาใส่ช่อง prod ช่องเดียว */
(function(){
  var BACKENDS = {
    /* ว่างไว้จนกว่าจะมีโปรเจกต์ production จริง — ห้ามใส่ URL ของ dev หรือ uat ตรงนี้เด็ดขาด */
    prod: '',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT */
  };
  var h = location.hostname, p = location.pathname;
  var env = (p.indexOf('/admin-uat/') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env] };
})();
