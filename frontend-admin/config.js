/* ตั้งค่าตามสภาพแวดล้อม — ไฟล์เดียวใช้ได้ทุกที่ ไม่มีค่าที่ต่างกันตาม branch (merge UAT → main จึงไม่ชนกัน)
   ENV ตัดสินจาก URL ที่เปิด: /admin-uat/ และ localhost = 'uat' (ห้ามแตะข้อมูลจริง), นอกนั้น = 'prod'
   UAT ใช้ backend คนละโปรเจกต์ Apps Script + คนละ Central Sheet กับ production โดยสิ้นเชิง */
(function(){
  var BACKENDS = {
    prod: 'https://script.google.com/macros/s/AKfycbzDLcX5Qd4MMdBpcwr4MWoYJdP0JCiMMgMAnFmcC9t5zS2zoOfkfttXXcj0Ettza56gIA/exec',
    uat:  '' /* ← ใส่ Web App URL ของ "TOPSHOP Backend UAT" หลัง Deploy (ว่างไว้ = UAT ใช้งานไม่ได้ ไม่ตกไปชี้ production) */
  };
  var h = location.hostname, p = location.pathname;
  var env = (p.indexOf('/admin-uat/') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env] };
})();
