// รัน: node .dev/test-line-bot.js
// บอท LINE (59_line_bot.gs) + Flex message (60_flex_inventory.gs)
// โหลดของจริงทั้งสาย (ตัวตน → สิทธิ์ → ผู้รับผิดชอบ → รวมยอด → Flex) ต่อ webhook จำลองหนึ่งก้อน
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const sheets = {
  tenants: [
    { tenant_id: 'TNKI', name: 'ตัวแทนบ้าน', is_active: 'TRUE', is_house: 'TRUE' },
    { tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', is_active: 'TRUE' },
    { tenant_id: 'NKN', name: 'นครนายก', is_active: 'TRUE' }
  ],
  company_profile: [{ record_id: 1, name: 'บริษัท ธนัทกร จำกัด' }],
  admin_users: [
    { record_id: 1, username: 'ultra', display_name: 'อุลตร้า', role_code: 'super_admin', tenant_id: '', status: 'active', line_user_id: 'U' + '1'.repeat(32) },
    { record_id: 2, username: 'bdcadmin', display_name: 'แอดมิน BDC', role_code: 'tenant_admin', tenant_id: 'BDC', status: 'active', line_user_id: 'U' + '2'.repeat(32) },
    { record_id: 3, username: 'noperm', display_name: 'ไม่มีสิทธิ์คลัง', role_code: 'viewer', tenant_id: 'BDC', status: 'active', line_user_id: 'U' + '3'.repeat(32) },
    { record_id: 4, username: 'waiting', display_name: 'รออนุมัติ', role_code: '', tenant_id: 'BDC', status: 'pending', line_user_id: 'U' + '4'.repeat(32) },
    { record_id: 5, username: 'suspended', display_name: 'ถูกระงับ', role_code: 'tenant_admin', tenant_id: 'BDC', status: 'off', line_user_id: 'U' + '5'.repeat(32) }
  ],
  liff_users: [{ line_user_id: 'U' + '6'.repeat(32), display_name: 'พนักงานขาย', tenant_id: 'BDC', status: 'Yes' }],
  roles: [{ role_code: 'tenant_admin' }, { role_code: 'viewer' }],
  role_permissions: [
    { role_code: 'tenant_admin', module_code: 'inventory', can_view: 'TRUE', can_edit: 'TRUE' },
    { role_code: 'viewer', module_code: 'sales', can_view: 'TRUE', can_edit: 'FALSE' }
  ],
  admin_user_tenants: [],
  products: [
    { record_id: 1, product_code: '10143', name: 'น้ำยาถูพื้น 900ml ขนาดครอบครัว สูตรเข้มข้น', unit: 'ชิ้น' },
    { record_id: 2, product_code: '10185', name: 'สเปรย์กันยุง', unit: 'ชิ้น' }
  ],
  product_units: [
    { record_id: 1, product_id: 1, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 12, is_active: 'TRUE' },
    { record_id: 2, product_id: 2, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 60, is_active: 'TRUE' }
  ],
  warehouse_stock: [
    { record_id: 1, tenant_id: 'BDC', warehouse_id: 9, product_id: 1, qty: 126 },
    { record_id: 2, tenant_id: '', warehouse_id: 1, product_id: 2, qty: 120 }
  ],
  van: { BDC: [{ line_user_id: 'B1', product_id: 1, qty: 36 }], TNKI: [], NKN: [] }
};
const sheetOf = n => { if (!sheets[n]) sheets[n] = []; return sheets[n]; };

const sent = [];            // ทุกคำขอที่ถูกยิงออกไปหา LINE
const CACHE = {};
let CONFIG = { LINE_BOT_ACCESS_TOKEN: 'tok-123', LINE_BOT_WEBHOOK_KEY: '', ENDPOINT_URL: 'https://script.google.com/x/exec', ADMIN_SESSION_TTL_SEC: 28800 };

const ctx = {
  console, JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  encodeURIComponent, decodeURIComponent,
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '2026-10-21', getUuid: () => 'uuid-1',
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' } },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  CacheService: { getScriptCache: () => ({
    get: k => (CACHE[k] === undefined ? null : CACHE[k]),
    put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty: () => {} }) },
  SpreadsheetApp: { openById: () => { throw new Error('no'); } },
  ContentService: { MimeType: { JSON: 'application/json' },
    createTextOutput: t => ({ __body: t, setMimeType() { return this; } }) },
  UrlFetchApp: { fetch: (url, opts) => {
    sent.push({ url: url, body: JSON.parse(opts.payload), auth: opts.headers.Authorization });
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  } },
  getConfig: () => CONFIG,
  centralObjects: n => sheetOf(n).map(o => Object.assign({}, o)),
  centralSheet: n => ({ __name: n }),
  centralAppend: () => {}, centralAppendMany: () => {}, centralNextId: () => 1, centralInvalidate: () => {},
  deleteRowsWhere: () => {},
  nowStr: () => '2026-10-21 09:00:00',
  ensureSchemaCurrent: () => false,
  _requirePermission: () => null,
  _scoped: (name, scope) => sheetOf(name).filter(r => String(r.tenant_id || '') === String(scope || '')),
  tenantObjectsIfExists: (tid, name) => {
    if (name !== 'van_stock') return [];
    if (!sheets.van[tid]) throw new Error('ไม่พบไฟล์ของตัวแทน ' + tid);
    return sheets.van[tid].map(o => Object.assign({}, o));
  }
};
vm.createContext(ctx);
const fakes = {};
['centralObjects', 'centralSheet', 'centralAppend', 'centralAppendMany', 'centralNextId', 'centralInvalidate',
 'deleteRowsWhere', 'nowStr', 'tenantObjectsIfExists', 'getConfig', 'ensureSchemaCurrent']
  .forEach(k => fakes[k] = ctx[k]);
vm.runInContext(B('02_helpers.gs'), ctx, { filename: '02_helpers.gs' });
['28_units.gs', '14_permissions.gs', '29_admin_signup.gs', '30_admin_line_login.gs',
 '57_user_tenants.gs', '58_inventory_report.gs', '60_flex_inventory.gs', '59_line_bot.gs']
  .forEach(f => vm.runInContext(B(f), ctx, { filename: f }));
Object.keys(fakes).forEach(k => { ctx[k] = fakes[k]; });   // ของจริงใน 02/30 ทับ stub ไว้ — เอา stub คืน

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '\n   got ' + JSON.stringify(extra)));
  if (!cond) failed++;
};
const UID = n => 'U' + String(n).repeat(32);
let evSeq = 0;
// e ที่ Apps Script ส่งเข้า doPost
const webhook = (events, params) => ({ postData: { contents: JSON.stringify({ destination: 'Uxxx', events: events }) }, parameter: params || {} });
const textEvent = (uid, text, opts) => Object.assign({
  type: 'message', webhookEventId: 'ev' + (++evSeq), replyToken: 'rt' + evSeq,
  source: { type: 'user', userId: uid }, message: { type: 'text', text: text }
}, opts || {});
const postbackEvent = (uid, data) => ({
  type: 'postback', webhookEventId: 'ev' + (++evSeq), replyToken: 'rt' + evSeq,
  source: { type: 'user', userId: uid }, postback: { data: data }
});
const fire = (events, params) => { sent.length = 0; const out = ctx.lineBotHandleWebhook(webhook(events, params)); return out; };
const lastMsg = () => (sent.length ? sent[sent.length - 1].body.messages[0] : null);
const lastText = () => { const m = lastMsg(); return m ? (m.text || m.altText || '') : ''; };

console.log('-- ★★ ต้องไม่กลืนคำขอของ API เดิม (doPost มีตัวเดียว) --');
eq('คำขอปกติของแอปแอดมิน → คืน null ให้ไปต่อ',
  ctx.lineBotHandleWebhook({ postData: { contents: JSON.stringify({ action: 'getAdminBootstrap', payload: {} }) }, parameter: {} }), null);
eq('★ คำขอที่มีคำว่า events อยู่ใน payload แต่มี action → ยังเป็นของ API เดิม',
  ctx.lineBotHandleWebhook({ postData: { contents: JSON.stringify({ action: 'saveX', payload: { events: [1, 2] } }) }, parameter: {} }), null);
eq('body ว่าง', ctx.lineBotHandleWebhook({ postData: { contents: '' }, parameter: {} }), null);
eq('JSON พัง แต่มีคำว่า events', ctx.lineBotHandleWebhook({ postData: { contents: '{"events":' }, parameter: {} }), null);
eq('ไม่มี postData เลย (doGet/คำขอแปลกๆ)', ctx.lineBotHandleWebhook({ parameter: {} }), null);

console.log('\n-- webhook ของ LINE: ตอบ 200 ทุกกรณี --');
const verify = fire([]);
ok('ปุ่ม Verify ในคอนโซล (events ว่าง) → ตอบ 200', verify && verify.__body === '{}', verify);
eq('ไม่ยิงข้อความอะไรออกไป', sent.length, 0);

console.log('\n-- ตัวตน --');
fire([textEvent(UID(9), '/inventory')]);
ok('★ LINE ที่ไม่ได้ผูกกับบัญชีไหน → บอกวิธีผูก ไม่ใช่เงียบ', /ยังไม่พบบัญชี/.test(lastText()), lastText());
fire([textEvent(UID(6), '/inventory')]);
ok('★ พนักงานขายในแอปมือถือ → บอกตรงๆ ว่ายังไม่เปิดให้ใช้ทางแชต', /พนักงานขาย/.test(lastText()), lastText());
fire([textEvent(UID(4), '/inventory')]);
ok('บัญชีรออนุมัติ → ใช้ข้อความชุดเดียวกับหน้าล็อกอิน', /รอผู้ดูแลระบบอนุมัติ/.test(lastText()), lastText());
fire([textEvent(UID(5), '/inventory')]);
ok('บัญชีถูกระงับ', /ระงับ/.test(lastText()), lastText());
fire([textEvent(UID(3), '/inventory')]);
ok('★ มีบัญชีแต่บทบาทไม่มีสิทธิ์โมดูลคลัง → ปฏิเสธ', /ไม่มีสิทธิ์ดูเมนูคลัง/.test(lastText()), lastText());

console.log('\n-- ดูแลรายเดียว: ตอบเลย ไม่ต้องถาม --');
fire([textEvent(UID(2), '/inventory')]);
let m = lastMsg();
eq('ได้ Flex', m.type, 'flex');
eq('การ์ดเดียว', m.contents.type, 'bubble');
ok('★ altText (ที่โผล่ใน notification) มีตัวเลขรวมติดไปด้วย', /รวม 13\.5 ลัง/.test(m.altText), m.altText);
ok('altText บอกทั้งคลังและรถ', /คลัง 10\.5 · รถ 3/.test(m.altText), m.altText);
eq('หัวการ์ดเป็นชื่อตัวแทน', m.contents.header.contents[1].text, 'บีดีซี ตะวันออก');
const headRow = m.contents.body.contents[0].contents.map(c => c.text);
eq('★ หัวตารางสี่ช่อง: สินค้า | คลัง | รถ | รวม', headRow, ['สินค้า', 'คลัง', 'รถ', 'รวม']);
const dataRow = m.contents.body.contents[2].contents.map(c => c.text);
eq('แถวข้อมูล: ชื่อ + สามตัวเลข', dataRow, ['น้ำยาถูพื้น 900ml ขนาดครอบครัว สูตรเข้มข้น', '10.5', '3', '13.5']);
eq('ชื่อสินค้ายาวไม่ตัดบรรทัด (ตารางจะเบี้ยว)', m.contents.body.contents[2].contents[0].maxLines, 1);
const footRow = m.contents.footer.contents[1].contents.map(c => c.text);
eq('★ ท้ายการ์ดมีช่องรวม', footRow, ['รวมทั้งหมด (ลัง)', '10.5', '3', '13.5']);
ok('บอกจำนวนพนักงานที่มีของบนรถ', m.contents.footer.contents.some(c => /พนักงาน 1 คน/.test(c.text || '')), m.contents.footer.contents);
ok('ของบริษัท (สเปรย์กันยุง) ไม่ปนเข้ามา', !JSON.stringify(m.contents).includes('สเปรย์'), 'leak');

console.log('\n-- ดูแลหลายราย: ต้องถามก่อน --');
fire([textEvent(UID(1), '/inventory')]);
m = lastMsg();
eq('★ เป็นข้อความ + quick reply ไม่ใช่รายงานของรายใดรายหนึ่ง', m.type, 'text');
eq('จำนวนตัวเลือกเท่าจำนวนตัวแทนที่ดูแล', m.quickReply.items.length, 3);
eq('ตัวเลือกเป็น postback (ไม่ยัดคำสั่งดิบลงห้องแชต)', m.quickReply.items[0].action.type, 'postback');
eq('★ บริษัทเจ้าของสินค้าเป็นตัวเลือกแรก', m.quickReply.items[0].action.label, 'บริษัท ธนัทกร จำกัด');
ok('ป้ายปุ่มไม่เกิน 20 ตัวอักษร (เกินแล้ว LINE ปฏิเสธทั้งก้อน)',
  m.quickReply.items.every(i => i.action.label.length <= 20), m.quickReply.items.map(i => i.action.label));
ok('data พก tenantId ไปด้วย', /cmd=inv&t=BDC/.test(JSON.stringify(m.quickReply.items.map(i => i.action.data))), m.quickReply.items);

console.log('\n-- กดปุ่มเลือกตัวแทน --');
fire([postbackEvent(UID(1), 'cmd=inv&t=BDC')]);
ok('ได้รายงานของรายที่กด', /บีดีซี/.test(lastMsg().altText), lastText());
fire([postbackEvent(UID(2), 'cmd=inv&t=NKN')]);
ok('★ แอดมิน BDC ส่ง postback ขอดู NKN (ปลอม data ได้) → ปฏิเสธ', /ไม่พบตัวแทน "NKN"/.test(lastText()), lastText());
ok('และบอกว่าตัวเองดูแลรายไหนอยู่', /BDC/.test(lastText()), lastText());
fire([postbackEvent(UID(1), 'cmd=other&t=BDC')]);
ok('postback ที่ไม่ใช่คำสั่งของเรา → ไม่ตอบอะไร', sent.length === 0, lastText());

console.log('\n-- พิมพ์รหัสตัวแทนมาตรงๆ --');
fire([textEvent(UID(1), '/inventory BDC')]);
ok('ข้ามเมนูได้', /บีดีซี/.test(lastMsg().altText), lastText());
fire([textEvent(UID(1), '/inventory bdc')]);
ok('ไม่สนตัวพิมพ์เล็กใหญ่', /บีดีซี/.test(lastMsg().altText), lastText());
fire([textEvent(UID(1), '/inventory นครนายก')]);
ok('ใช้ชื่อไทยก็ได้', /นครนายก/.test(lastMsg().altText), lastText());
fire([textEvent(UID(1), '/inventory ไม่มีจริง')]);
ok('ไม่พบ → บอกรายการที่ดูแลอยู่', /ไม่พบตัวแทน/.test(lastText()), lastText());

console.log('\n-- คำเรียกอื่นและคำสั่งช่วยเหลือ --');
['/inv', 'สต็อก', 'คลัง', '/INVENTORY', 'inventory'].forEach(w => {
  fire([textEvent(UID(2), w)]);
  ok('"' + w + '" ใช้ได้', lastMsg() && lastMsg().type === 'flex', lastText());
});
fire([textEvent(UID(2), '/help')]);
ok('/help บอกคำสั่งทั้งหมด', /\/inventory/.test(lastText()), lastText());
fire([{ type: 'follow', webhookEventId: 'evf', replyToken: 'rtf', source: { type: 'user', userId: UID(2) } }]);
ok('★ เพิ่มเพื่อนครั้งแรก → ทักทายด้วยคำสั่งที่ใช้ได้ (ไม่ต้องเดา)', /\/inventory/.test(lastText()), lastText());
fire([textEvent(UID(2), 'สวัสดีครับพี่')]);
eq('★ ข้อความคุยเล่น → ไม่ตอบ (ดีกว่าตอบ "ไม่เข้าใจ" ทุกประโยค)', sent.length, 0);
fire([{ type: 'message', webhookEventId: 'evs', replyToken: 'rts', source: { type: 'user', userId: UID(2) }, message: { type: 'sticker' } }]);
eq('สติกเกอร์ → ไม่ตอบ', sent.length, 0);

console.log('\n-- ความปลอดภัย --');
fire([textEvent(UID(2), '/inventory', { source: { type: 'group', groupId: 'G1', userId: UID(2) } })]);
ok('★ ในกลุ่ม → ไม่ส่งข้อมูลภายใน บอกให้คุยส่วนตัว', /แชตส่วนตัว/.test(lastText()), lastText());
ok('และไม่มีตัวเลขของคงเหลือหลุดไป', !/ลัง/.test(JSON.stringify(sent)), sent);
CONFIG = Object.assign({}, CONFIG, { LINE_BOT_WEBHOOK_KEY: 'ssh' });
fire([textEvent(UID(2), '/inventory')]);
eq('★ ตั้งคำลับไว้ แต่คำขอไม่มี ?k= → ทิ้งเงียบ', sent.length, 0);
fire([textEvent(UID(2), '/inventory')], { k: 'ผิด' });
eq('คำลับผิด → ทิ้งเงียบ', sent.length, 0);
fire([textEvent(UID(2), '/inventory')], { k: 'ssh' });
eq('คำลับถูก → ทำงาน', sent.length, 1);
CONFIG = Object.assign({}, CONFIG, { LINE_BOT_WEBHOOK_KEY: '' });
const noTok = Object.assign({}, CONFIG, { LINE_BOT_ACCESS_TOKEN: '' });
CONFIG = noTok;
const out2 = fire([textEvent(UID(2), '/inventory')]);
eq('★ ยังไม่ได้ตั้ง token → ไม่ยิงอะไรออกไป', sent.length, 0);
ok('แต่ยังตอบ 200 (ไม่ให้คอนโซล LINE ขึ้น error)', out2 && out2.__body === '{}', out2);
CONFIG = Object.assign({}, CONFIG, { LINE_BOT_ACCESS_TOKEN: 'tok-123' });
eq('บอทเปิดใช้งานแล้ว', ctx.lineBotEnabled(), true);
fire([textEvent(UID(2), '/inventory')]);
eq('ยิงไปที่ reply endpoint ของ LINE', sent[0].url, 'https://api.line.me/v2/bot/message/reply');
eq('แนบ token เป็น Bearer', sent[0].auth, 'Bearer tok-123');

console.log('\n-- LINE ส่งซ้ำ (retry) --');
const dup = textEvent(UID(2), '/inventory');
fire([dup]);
eq('ครั้งแรกตอบ', sent.length, 1);
fire([dup]);
eq('★ event id เดิมเข้ามาอีก → ไม่ตอบซ้ำ', sent.length, 0);
fire([textEvent(UID(2), '/inventory')]);
eq('event ใหม่ยังตอบปกติ', sent.length, 1);

console.log('\n-- ก้อนใหญ่ --');
sent.length = 0;
ctx.lineBotHandleWebhook(webhook(Array.from({ length: 14 }, () => textEvent(UID(2), '/inventory'))));
eq('★ ทำแค่ 10 รายการแรก (กันเกินเวลาที่ LINE รอ)', sent.length, 10);

console.log('\n-- รูปแบบตัวเลขและป้ายปุ่ม --');
eq('จำนวนเต็มไม่มีทศนิยมห้อย', ctx.flexNum(13), '13');
eq('ครึ่งลังเขียน .5 ไม่ใช่ .50', ctx.flexNum(13.5), '13.5');
eq('เศษสองตำแหน่ง', ctx.flexNum(13.25), '13.25');
eq('หลักพันมีคอมมา', ctx.flexNum(12840.5), '12,840.5');
eq('ติดลบยังอ่านออก (สต็อกติดลบมีจริงเวลาคนคีย์ผิด)', ctx.flexNum(-4.5), '-4.5');
eq('ค่าว่าง/ไม่ใช่ตัวเลข = 0', [ctx.flexNum(null), ctx.flexNum('x')], ['0', '0']);
eq('ปัดสองตำแหน่ง', ctx.flexNum(1 / 3), '0.33');

console.log('\n-- ตัวแทนเยอะเกินเพดาน quick reply (13) --');
for (let i = 0; i < 15; i++) sheets.tenants.push({ tenant_id: 'T' + i, name: 'ตัวแทนที่ชื่อยาวมากจนต้องตัดป้าย ' + i, is_active: 'TRUE' });
fire([textEvent(UID(1), '/inventory')]);
m = lastMsg();
eq('★ เกิน 13 ราย → เปลี่ยนไปใช้ปุ่มใน Flex', m.type, 'flex');
const buttons = m.contents.body.contents.filter(c => c.type === 'button');
eq('แสดง 12 ปุ่ม', buttons.length, 12);
ok('ป้ายปุ่มถูกตัดให้ไม่เกิน 20 ตัว', buttons.every(b => b.action.label.length <= 20), buttons.map(b => b.action.label));
ok('★ บอกว่ายังมีอีกกี่ราย + วิธีพิมพ์เอง', /อีก 6 ราย/.test(JSON.stringify(m.contents)), m.contents);

console.log('\n-- แถวเยอะเกินหนึ่งใบ --');
for (let i = 10; i < 30; i++) {
  sheets.products.push({ record_id: i, product_code: 'P' + i, name: 'สินค้า ' + i, unit: 'ชิ้น' });
  sheets.product_units.push({ record_id: 100 + i, product_id: i, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 12, is_active: 'TRUE' });
  sheets.warehouse_stock.push({ record_id: 100 + i, tenant_id: 'BDC', warehouse_id: 9, product_id: i, qty: 12 * (30 - i) });
}
fire([textEvent(UID(2), '/inventory')]);
m = lastMsg();
const rows = m.contents.body.contents.filter(c => c.type === 'box');
eq('★ ตัดที่ 15 แถว (หัวตาราง 1 + ข้อมูล 15)', rows.length, 16);
ok('★ บอกว่าแสดงกี่จากกี่รายการ', /แสดง 15 จาก 21 รายการ/.test(JSON.stringify(m.contents.footer)), m.contents.footer);
ok('ยอดรวมท้ายใบยังเป็นของทั้งหมด ไม่ใช่แค่ 15 แถว',
  m.contents.footer.contents[1].contents[3].text !== '13.5', m.contents.footer.contents[1]);

console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
