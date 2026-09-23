// รัน: node .dev/test-line-auth.js
// ทดสอบการยืนยัน LINE ID token (backend/27_line_auth.gs) ด้วย UrlFetchApp/CacheService จำลอง ไม่ยิงเน็ตจริง
// ประเด็นสำคัญ: ตัวตนต้องมาจาก sub ที่ LINE ตอบเท่านั้น · token ของแอปอื่น/หมดอายุ/ปลอม ต้องไม่ผ่าน
//               · ไม่มี token ต้องผ่านเฉพาะโหมดทดสอบที่ตั้งใจเปิดไว้
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

const NOW = 1790000000;                       // เวลาอ้างอิงคงที่ (วินาที)
const UID = 'U1234567890abcdef';
let props = {}, cache = {}, fetches = [], fetchImpl = null, logs = [];

const ctx = {
  console, JSON, Math, String, Number, Object, Array, Date, isFinite, parseInt, parseFloat, RegExp,
  Logger: { log: m => logs.push(String(m)) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props[k] === undefined ? null : props[k]) }) },
  CacheService: { getScriptCache: () => ({
    get: k => (cache[k] === undefined ? null : cache[k].v),
    put: (k, v, ttl) => { cache[k] = { v: v, ttl: ttl }; }
  }) },
  UrlFetchApp: { fetch: (url, opt) => { fetches.push({ url, opt }); return fetchImpl(url, opt); } },
  Utilities: {
    DigestAlgorithm: { MD5: 'MD5' },
    computeDigest: (alg, s) => {                 // พอให้ได้คีย์แคชที่ต่างกันตาม token (ไม่ต้องเป็น MD5 จริง)
      const out = [];
      for (let i = 0; i < 16; i++) { let h = i + 7; for (let j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) & 0xFF; out.push(h); }
      return out;
    }
  },
  SpreadsheetApp: {}, LockService: {}, Session: { getScriptTimeZone: () => 'Asia/Bangkok' }
};
vm.createContext(ctx);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });   // ต้องการ isFlagOn
// _envName() ตัวจริงอยู่ใน 24_drive_layout.gs (ไม่ได้โหลดในเทสต์นี้) — ตรรกะเดียวกัน: ไม่ตั้ง ENV_NAME = prod
ctx._envName = () => (String(props.ENV_NAME || '').trim().toLowerCase() === 'uat' ? 'uat' : 'prod');
vm.runInContext(B('27_line_auth.gs'), ctx, { filename: '27_line_auth.gs' });

const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
const okToken = (over) => Object.assign({ iss: 'https://access.line.me', sub: UID, aud: '1234567890', exp: NOW + 3600, name: 'พนักงานทดสอบ' }, over || {});
const reset = (p) => { props = Object.assign({ LINE_LOGIN_CHANNEL_ID: '1234567890' }, p || {}); cache = {}; fetches = []; logs = []; };
ctx.Date = class extends Date { static now() { return NOW * 1000; } };   // ให้ exp/เวลาปัจจุบันคงที่

console.log('── ยืนยัน ID token กับ LINE ──');
reset(); fetchImpl = () => resp(200, okToken());
let r = ctx.verifyLineIdToken('tok-good', '1234567890');
eq('token ถูกต้อง → ได้ lineUserId จาก sub', [r.ok, r.lineUserId, r.name], [true, UID, 'พนักงานทดสอบ']);
eq('  ส่ง id_token + client_id ไปที่ endpoint ของ LINE', [fetches[0].url, fetches[0].opt.payload.client_id, fetches[0].opt.payload.id_token],
   ['https://api.line.me/oauth2/v2.1/verify', '1234567890', 'tok-good']);

const before = fetches.length;
r = ctx.verifyLineIdToken('tok-good', '1234567890');
eq('เรียกซ้ำด้วย token เดิม → ใช้แคช ไม่ยิง LINE ซ้ำ', [r.ok, r.lineUserId, r.cached, fetches.length], [true, UID, true, before]);
eq('  อายุแคชไม่เกิน 30 นาที', Object.keys(cache).map(k => cache[k].ttl <= 1800 && cache[k].ttl >= 60), [true]);

reset(); fetchImpl = () => resp(200, okToken({ aud: '9999999999' }));
r = ctx.verifyLineIdToken('tok-other-app', '1234567890');
eq('token ของแอปอื่น (aud ไม่ตรง) → ไม่ผ่าน', [r.ok, /ไม่ได้ออกให้แอปนี้/.test(r.message)], [false, true]);

reset(); fetchImpl = () => resp(200, okToken({ exp: NOW - 10 }));
r = ctx.verifyLineIdToken('tok-expired', '1234567890');
eq('token หมดอายุ → ไม่ผ่าน', [r.ok, /หมดอายุ/.test(r.message)], [false, true]);

reset(); fetchImpl = () => resp(400, { error: 'invalid_request', error_description: 'invalid IdToken' });
r = ctx.verifyLineIdToken('tok-fake', '1234567890');
eq('token ปลอม (LINE ตอบ 400) → ไม่ผ่าน และไม่เก็บแคช', [r.ok, Object.keys(cache).length], [false, 0]);

reset(); fetchImpl = () => { throw new Error('timeout'); };
r = ctx.verifyLineIdToken('tok-good', '1234567890');
eq('ติดต่อ LINE ไม่ได้ → ไม่ผ่าน แต่ทำเครื่องหมายว่าเป็นปัญหาชั่วคราว', [r.ok, r.transient], [false, true]);

reset(); fetchImpl = () => resp(200, okToken());
eq('ไม่ได้ตั้ง channel id → ยืนยันไม่ได้', ctx.verifyLineIdToken('tok-good', '').ok, false);

console.log('\n── ตัวตนของคำขอหนึ่งๆ (resolveLineIdentity) ──');
reset(); fetchImpl = () => resp(200, okToken());
r = ctx.resolveLineIdentity({ idToken: 'tok-good', lineUserId: UID, payload: {} });
eq('มี token และตรงกับที่แจ้ง → ผ่าน (verified)', [r.ok, r.lineUserId, r.verified], [true, UID, true]);

reset(); fetchImpl = () => resp(200, okToken());
r = ctx.resolveLineIdentity({ idToken: 'tok-good', lineUserId: 'Uสวมรอยคนอื่น', payload: {} });
eq('token เป็นของคนหนึ่งแต่แจ้ง lineUserId อีกคน → ปฏิเสธ', [r.ok, r.authError, /ไม่ตรง/.test(r.message)], [false, true, true]);

reset(); fetchImpl = () => resp(200, okToken());
r = ctx.resolveLineIdentity({ idToken: 'tok-good', payload: {} });
eq('ไม่แจ้ง lineUserId มาเลย → ใช้ตัวตนจาก token', [r.ok, r.lineUserId], [true, UID]);

reset(); fetchImpl = () => resp(200, okToken({ sub: 'Uอีกคน' }));
r = ctx.resolveLineIdentity({ idToken: 'tok-good', payload: { lineUid: UID } });
eq('payload.lineUid (จอสมัคร/checkUser) ก็ต้องตรงกับ token', [r.ok, r.authError], [false, true]);

reset();
r = ctx.resolveLineIdentity({ lineUserId: UID, payload: {} });
eq('ตั้งค่าครบแล้วแต่ไม่ส่ง token → ปฏิเสธ และบอกให้เข้าสู่ระบบใหม่', [r.ok, r.needLogin, /แอป LINE/.test(r.message)], [false, true, true]);

reset({ ALLOW_UNVERIFIED_LINE_LOGIN: 'TRUE' });
r = ctx.resolveLineIdentity({ lineUserId: UID, payload: {} });
eq('เปิดโหมดทดสอบไว้ → ยอมรับแบบไม่ยืนยัน (verified=false)', [r.ok, r.lineUserId, r.verified], [true, UID, false]);

reset({ ENV_NAME: 'uat' });                       // ไม่ได้ตั้ง flag เลย
eq('UAT (ไม่ตั้ง flag) → เปิดเบราว์เซอร์ทดสอบได้', ctx.resolveLineIdentity({ lineUserId: UID }).ok, true);
reset({ ENV_NAME: 'uat', ALLOW_UNVERIFIED_LINE_LOGIN: 'FALSE' });
eq('  แต่ตั้ง flag เป็น FALSE แล้วก็เข้มได้', ctx.resolveLineIdentity({ lineUserId: UID }).ok, false);
reset();                                          // ไม่มี ENV_NAME = production
eq('production (ไม่ตั้ง ENV_NAME, ไม่ตั้ง flag) → เข้มเสมอ', ctx.resolveLineIdentity({ lineUserId: UID }).ok, false);

reset({ ALLOW_UNVERIFIED_LINE_LOGIN: 'true' });   // Sheets/คนตั้งค่าอาจพิมพ์ตัวเล็ก
eq('ค่า flag ตัวเล็กก็ถือว่าเปิด', ctx.resolveLineIdentity({ lineUserId: UID }).ok, true);

props = {}; cache = {}; logs = [];               // ยังไม่ได้ตั้ง channel id เลย
r = ctx.resolveLineIdentity({ lineUserId: UID, payload: {} });
eq('ยังไม่ได้ตั้ง channel id → ยอมรับแบบเดิมแต่เขียน log เตือน', [r.ok, r.verified, logs.length > 0], [true, false, true]);

reset();
r = ctx.resolveLineIdentity({ payload: {} });
eq('ไม่มีทั้ง token และ lineUserId → ปฏิเสธ', [r.ok, r.authError], [false, true]);

reset({ LINE_LOGIN_CHANNEL_ID: '', LINE_CHANNEL_ID: '555' }); fetchImpl = () => resp(200, okToken({ aud: '555' }));
r = ctx.resolveLineIdentity({ idToken: 'tok-good' });
eq('ไม่ได้ตั้ง LINE_LOGIN_CHANNEL_ID → ใช้ LINE_CHANNEL_ID เดิมแทน', [r.ok, r.lineUserId], [true, UID]);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
