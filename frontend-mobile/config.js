/* ตั้งค่าตามสภาพแวดล้อม — แบบเดียวกับ frontend-admin/config.js (ไฟล์เดียวใช้ได้ทุก branch, merge UAT → main ไม่ชนกัน)
   ENV ตัดสินจาก URL ที่เปิด: /mobile-uat/ และ localhost = 'uat' (ห้ามแตะข้อมูลจริง), นอกนั้น = 'prod'
   BACKENDS ต้องตรงกับ frontend-admin/config.js — backend ตัวเดียวกัน (Mobile ใช้ action กลุ่ม ACTION_MAP ใน 05_router.gs)
   LIFF_IDS: สร้าง LIFF app แยกต่อสภาพแวดล้อมใน LINE Developers Console (Endpoint URL = .../mobile-uat/ กับ .../mobile/)
             ยังว่าง = เปิดในเบราว์เซอร์ธรรมดาได้เฉพาะโหมดทดสอบบน UAT (?devLineUserId=...) — production ใช้งานไม่ได้จนกว่าจะใส่ */
(function(){
  var BACKENDS = {
    /* ว่างไว้จนกว่าจะมี Web App URL ของโปรเจกต์ prod (ตัวเดียวกับที่ /admin/ ใช้) */
    prod: '',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT — ห้ามใส่ URL ของ production ตรงนี้ */
  };
  var LIFF_IDS = {
    /* ยังว่าง: ต้องสร้าง LIFF app ของ production (Endpoint = .../mobile/) ใน LINE Developers Console ก่อน
       ว่างอยู่ = เปิด /mobile/ แล้วขึ้นข้อความว่ายังไม่ได้ตั้งค่า LIFF ID (ไม่พัง ไม่แตะข้อมูล) */
    prod: '',
    uat:  '2010417493-pYb6cS8e'   /* Endpoint URL: https://team-it-ranger.github.io/salesranger-TOPSHOP/mobile-uat/ */
  };
  var h = location.hostname, p = location.pathname;
  var env = (p.indexOf('/mobile-uat/') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env], LIFF_ID: LIFF_IDS[env] };
})();
