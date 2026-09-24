/* ตั้งค่าตามสภาพแวดล้อม — แบบเดียวกับ frontend-admin/config.js (ไฟล์เดียวใช้ได้ทุก branch, merge UAT → main ไม่ชนกัน)
   ENV ตัดสินจาก URL ที่เปิด: /mobile-uat/ และ localhost = 'uat' (ห้ามแตะข้อมูลจริง), นอกนั้น = 'prod'
   BACKENDS ต้องตรงกับ frontend-admin/config.js — backend ตัวเดียวกัน (Mobile ใช้ action กลุ่ม ACTION_MAP ใน 05_router.gs)
   LIFF_IDS: สร้าง LIFF app แยกต่อสภาพแวดล้อมใน LINE Developers Console (Endpoint URL = .../mobile-uat/ กับ .../mobile/)
             ทั้งสอง env ใส่ครบแล้ว (24 ก.ย. 2026) · ทั้งคู่อยู่ใต้ LINE Login channel เดียวกัน 2010417493
             ต้องติ๊ก scope openid ของ LIFF ทั้งสองตัว ไม่งั้น liff.getIDToken() ว่างและ backend จะไม่ให้ผ่าน */
(function(){
  var BACKENDS = {
    /* salesranger-TOPSHOP-be(prod) — backend ตัวเดียวกับที่ /admin/ ใช้ */
    prod: 'https://script.google.com/macros/s/AKfycbxGSgR4oQLbS1kyy6c-JIj4g4ZaRUhk-bLnz3z_R2YQIu4guMsueyfxH3xK4eggRJorzQ/exec',
    uat:  'https://script.google.com/macros/s/AKfycbwsdgUjEe1RQFeuHQ3je92eok-ezYp2vVRL571eXNdRs1lfEAEXf1rSEIPFClb7GTYu7A/exec' /* TOPSHOP Backend UAT — ห้ามใส่ URL ของ production ตรงนี้ */
  };
  var LIFF_IDS = {
    prod: '2010417493-GXAqTbSu',   /* Endpoint URL: https://team-it-ranger.github.io/Ranger-TOPSALES/mobile/ (เปิดใช้ 24 ก.ย. 2026) */
    uat:  '2010417493-pYb6cS8e'   /* Endpoint URL: https://team-it-ranger.github.io/Ranger-TOPSALES/mobile-uat/ */
  };
  var h = location.hostname, p = location.pathname;
  var env = (p.indexOf('/mobile-uat/') !== -1 || h === 'localhost' || h === '127.0.0.1') ? 'uat' : 'prod';
  window.APP_CONFIG = { ENV: env, BACKEND_URL: BACKENDS[env], LIFF_ID: LIFF_IDS[env] };
})();
