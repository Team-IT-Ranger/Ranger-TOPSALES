// รัน: node .dev/test-bot-line.js
// บอท LINE ตัวจริงของระบบ — `bot-line/Code.js` (โปรเจกต์ Apps Script แยก อ่าน Central Sheet ของ prod ตรงๆ)
// ครอบทั้งคำสั่งเดิม (ยอดขาย/สต็อก/ยอดค้างชำระ/สถานะบิล) และ "ของคงเหลือ" ที่ย้ายมาจาก backend 21 ต.ค. 2026
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'bot-line', 'Code.js'), 'utf8');

const PROD = 'file-prod', UAT = 'file-uat';
// ไฟล์ Sheet ของตัวแทน (sheet_file_id ในตาราง tenants ของ prod)
const F_TNKI = 'file-tnki', F_BDC = 'file-bdc';

// ชีตจำลองที่เป็นตาราง 2 มิติจริง — บอทอ่านด้วย getDataRange().getValues() ไม่ได้ใช้ helper ของ backend
function sheet(headers, rows) {
  const self = {
    __headers: headers, __rows: rows.slice(),
    getDataRange: () => ({ getValues: () => [headers.slice()].concat(self.__rows.map(r => headers.map(h => (r[h] === undefined ? '' : r[h])))) }),
    getLastColumn: () => headers.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => (row === 1 ? [headers.slice(col - 1, col - 1 + numCols)] : [])
    }),
    appendRow: arr => { const o = {}; headers.forEach((h, i) => { o[h] = arr[i]; }); self.__rows.push(o); },
    getName: () => 'fake'
  };
  return self;
}

let files;
const resetData = () => {
  files = {
    [PROD]: {
      tenants: sheet(['tenant_id', 'name', 'sheet_file_id', 'is_active', 'is_house'], [
        { tenant_id: 'TNKI', name: 'ตัวแทนบ้าน', sheet_file_id: F_TNKI, is_active: true, is_house: true },
        { tenant_id: 'BDC', name: 'บีดีซี ตะวันออก', sheet_file_id: F_BDC, is_active: 'TRUE' },
        { tenant_id: 'NKN', name: 'นครนายก', sheet_file_id: '', is_active: 'TRUE' },
        { tenant_id: 'OLD', name: 'เลิกใช้แล้ว', sheet_file_id: '', is_active: 'FALSE' }
      ]),
      company_profile: sheet(['record_id', 'name'], [{ record_id: 1, name: 'บริษัท ธนัทกร จำกัด' }]),
      admin_users: sheet(['record_id', 'username', 'display_name', 'role_code', 'tenant_id', 'status', 'line_user_id'], [
        { record_id: 1, username: 'ultra', display_name: 'อุลตร้า', role_code: 'super_admin', tenant_id: '', status: 'active', line_user_id: 'U1' },
        { record_id: 2, username: 'owner2', display_name: 'ผู้ดูแลบริษัท', role_code: 'owner_admin', tenant_id: '', status: 'active', line_user_id: 'U2' },
        { record_id: 3, username: 'bdcadm', display_name: 'แอดมิน BDC', role_code: 'tenant_admin', tenant_id: 'BDC', status: 'active', line_user_id: 'U3' },
        { record_id: 4, username: 'noperm', display_name: 'ไม่มีสิทธิ์คลัง', role_code: 'viewer', tenant_id: '', status: 'active', line_user_id: 'U4' },
        { record_id: 5, username: 'gone', display_name: 'ถูกระงับ', role_code: 'owner_admin', tenant_id: '', status: 'off', line_user_id: 'U5' },
        { record_id: 6, username: 'norole', display_name: 'ยังไม่ได้บทบาท', role_code: '', tenant_id: '', status: 'active', line_user_id: 'U6' }
      ]),
      role_permissions: sheet(['role_code', 'module_code', 'can_view', 'can_edit'], [
        { role_code: 'owner_admin', module_code: 'inventory', can_view: 'TRUE', can_edit: 'TRUE' },
        { role_code: 'tenant_admin', module_code: 'inventory', can_view: true, can_edit: 'FALSE' },
        { role_code: 'viewer', module_code: 'sales', can_view: 'TRUE', can_edit: 'FALSE' }
      ]),
      admin_user_tenants: sheet(['record_id', 'admin_user_id', 'tenant_id', 'created_at', 'created_by'], []),
      liff_users: sheet(['line_user_id', 'display_name', 'role', 'tenant_id', 'status', 'last_login'], [
        { line_user_id: 'U7', display_name: 'พนักงานที่อนุมัติแล้ว', role: 'sales', tenant_id: '', status: 'Yes' },
        { line_user_id: 'U8', display_name: 'ยังไม่อนุมัติ', role: 'รออนุมัติ', tenant_id: '', status: 'No' }
      ]),
      products: sheet(['record_id', 'product_code', 'name', 'unit'], [
        { record_id: 1, product_code: '10143', name: 'น้ำยาถูพื้น 900ml', unit: 'ชิ้น' },
        { record_id: 2, product_code: '10185', name: 'สเปรย์กันยุง', unit: 'ชิ้น' },
        { record_id: 3, product_code: '10505', name: 'กาวดักแมลงวัน', unit: 'แผ่น' },
        { record_id: 4, product_code: '10999', name: 'สินค้ายังไม่ยืนยันบรรจุ', unit: 'ชิ้น' },
        { record_id: 5, product_code: '10777', name: 'ของหมดทั้งคลังและรถ', unit: 'ชิ้น' }
      ]),
      product_units: sheet(['record_id', 'product_id', 'unit_code', 'unit_label', 'unit_factor', 'is_active'], [
        { record_id: 1, product_id: 1, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 12, is_active: 'TRUE' },
        { record_id: 2, product_id: 1, unit_code: 'PK', unit_label: 'แพ็ค', unit_factor: 4, is_active: 'TRUE' },
        { record_id: 3, product_id: 2, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 60, is_active: 'TRUE' },
        { record_id: 4, product_id: 3, unit_code: 'CASE', unit_label: 'หีบ', unit_factor: 100, is_active: 'TRUE' },
        { record_id: 5, product_id: 4, unit_code: 'CT', unit_label: 'ลัง (ยังไม่ยืนยันขนาดบรรจุ)', unit_factor: 1, is_active: 'TRUE' },
        { record_id: 6, product_id: 5, unit_code: 'CT', unit_label: 'ลัง', unit_factor: 10, is_active: 'TRUE' },
        { record_id: 7, product_id: 2, unit_code: 'CT', unit_label: 'ลังเก่า', unit_factor: 999, is_active: 'FALSE' }
      ]),
      warehouse_stock: sheet(['record_id', 'tenant_id', 'warehouse_id', 'product_id', 'qty'], [
        { record_id: 1, tenant_id: '', warehouse_id: 1, product_id: 1, qty: 120 },
        { record_id: 2, tenant_id: '', warehouse_id: 2, product_id: 1, qty: 6 },
        { record_id: 3, tenant_id: '', warehouse_id: 1, product_id: 2, qty: 90 },
        { record_id: 4, tenant_id: '', warehouse_id: 1, product_id: 4, qty: 7 },
        { record_id: 5, tenant_id: '', warehouse_id: 1, product_id: 5, qty: 0 },
        { record_id: 6, tenant_id: 'BDC', warehouse_id: 9, product_id: 1, qty: 24 },
        { record_id: 7, tenant_id: 'BDC', warehouse_id: 9, product_id: 3, qty: 250 },
        { record_id: 8, tenant_id: 'TNKI', warehouse_id: 1, product_id: 2, qty: 999999 }
      ]),
      stock_reservations: sheet(['record_id', 'tenant_id', 'product_id', 'qty', 'status'], [
        { record_id: 1, tenant_id: '', product_id: 1, qty: 12, status: 'active' }
      ]),
      sales_daily: sheet(['record_id', 'tenant_id', 'sale_date', 'bills', 'revenue'], [
        { record_id: 1, tenant_id: 'BDC', sale_date: '2026-10-21', bills: 3, revenue: 12000 },
        { record_id: 2, tenant_id: 'TNKI', sale_date: '2026-10-21', bills: 1, revenue: 2840.5 },
        { record_id: 3, tenant_id: 'BDC', sale_date: '2026-10-20', bills: 9, revenue: 99999 }
      ]),
      customers: sheet(['record_id', 'customer_code', 'name', 'tenant_id'], [
        { record_id: 11, customer_code: 'C1001', name: 'ร้านตัวอย่าง', tenant_id: 'BDC' },
        { record_id: 12, customer_code: 'C1002', name: 'ร้านขายตรงบริษัท', tenant_id: '' },
        { record_id: 13, customer_code: 'C1003', name: 'ร้านตัวอย่างสอง', tenant_id: 'BDC' }
      ]),
      ar_invoices: sheet(['record_id', 'invoice_no', 'customer_id', 'due_date', 'total', 'received_amount', 'status'], [
        { record_id: 1, invoice_no: 'INV-1', customer_id: 11, due_date: '2026-10-01', total: 1000, received_amount: 200, status: 'partial' },
        { record_id: 2, invoice_no: 'INV-2', customer_id: 11, due_date: '2026-11-30', total: 500, received_amount: 0, status: 'open' },
        { record_id: 3, invoice_no: 'INV-3', customer_id: 11, due_date: '2026-10-01', total: 300, received_amount: 300, status: 'paid' }
      ])
    },
    [UAT]: {
      liff_users: sheet(['line_user_id', 'display_name', 'role', 'tenant_id', 'status', 'last_login'], [])
    },
    [F_TNKI]: {
      van_stock: sheet(['line_user_id', 'product_id', 'qty'], [
        { line_user_id: 'V1', product_id: 1, qty: 24 },
        { line_user_id: 'V2', product_id: 1, qty: 12 },
        { line_user_id: 'V2', product_id: 3, qty: 50 },
        { line_user_id: 'V3', product_id: 5, qty: 0 },
        { line_user_id: 'V9', product_id: '', qty: 5 }
      ]),
      sales_orders: sheet(['record_id', 'order_code', 'customer_id', 'total', 'status', 'payment_status', 'created_at'], [
        { record_id: 1, order_code: 'SO-TNKI-1', customer_id: 12, total: 4280, status: 'completed', payment_status: 'paid', created_at: '2026-10-20 10:00:00' }
      ])
    },
    [F_BDC]: {
      van_stock: sheet(['line_user_id', 'product_id', 'qty'], [{ line_user_id: 'B1', product_id: 1, qty: 12 }]),
      sales_orders: sheet(['record_id', 'order_code', 'customer_id', 'total', 'status', 'payment_status', 'created_at'], [
        { record_id: 1, order_code: 'SO-BDC-1', customer_id: 11, total: 1070, status: 'pending_delivery', payment_status: 'unpaid', created_at: '2026-10-21 09:00:00' },
        { record_id: 2, order_code: 'SO-BDC-2', customer_id: 11, total: 2140, status: 'delivering', payment_status: 'partial', created_at: '2026-10-21 11:00:00' }
      ])
    }
  };
};
resetData();

const sent = [];
const CACHE = {};
const PROPS = { CENTRAL_SHEET_FILEID_PROD: PROD, CENTRAL_SHEET_FILEID_UAT: UAT, LINE_CHANNEL_ACCESS_TOKEN: 'tok-1' };
const NOW = new Date('2026-10-21T09:30:00+07:00');

const ctx = {
  console: { error: () => {}, log: () => {} },
  JSON, String, Number, Object, Array, Date, isNaN, isFinite, parseInt, parseFloat, RegExp, Math,
  encodeURIComponent, decodeURIComponent,
  Utilities: { formatDate: (d, tz, fmt) => {
    const p = n => String(n).padStart(2, '0');
    const dt = d instanceof Date ? d : new Date(d);
    const s = dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
    return fmt.indexOf('HH') === -1 ? s : s + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
  } },
  CacheService: { getScriptCache: () => ({
    get: k => (CACHE[k] === undefined ? null : CACHE[k]),
    put: (k, v) => { CACHE[k] = v; }, remove: k => { delete CACHE[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]) }) },
  SpreadsheetApp: { openById: id => {
    if (!files[id]) throw new Error('openById: ไม่พบไฟล์ ' + id);
    return {
      getSheetByName: n => files[id][n] || null,
      insertSheet: n => { files[id][n] = sheet(['timestamp', 'line_user_id', 'line_display_name', 'user_message', 'response_message'], []); return files[id][n]; }
    };
  } },
  ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: t => ({ __body: t, setMimeType() { return this; } }) },
  UrlFetchApp: { fetch: (url, opts) => {
    sent.push({ url, body: opts && opts.payload ? JSON.parse(opts.payload) : null });
    if (url.indexOf('/profile/') !== -1) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ displayName: 'ชื่อจาก LINE' }) };
    if (url.indexOf('followers/ids') !== -1) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ userIds: ['U7', 'U9'] }) };
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  } }
};
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext(SRC, ctx, { filename: 'bot-line/Code.js' });
// ตรึงเวลาไว้ให้ทดสอบ "วันนี้" ได้ (Date ตัวจริงยังใช้ได้กับการแปลงวันที่อื่น)
vm.runInContext('var __now = new Date("2026-10-21T09:30:00+07:00");', ctx);

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

// แถวการ์ดมี 2 ช่อง: รหัส | ตัวเลข (ช่องตัวเลขเป็น span เพื่อให้ยอดรวมเป็นสีฟ้าตัวหนา)
const cellText = c => (c.text !== undefined ? c.text : (c.contents || []).map(s => s.text).join(''));
const rowOf = box => box.contents.map(cellText);

let evSeq = 0;
const post = events => { sent.length = 0; return ctx.doPost({ postData: { contents: JSON.stringify({ destination: 'Ux', events }) } }); };
const msg = (uid, text, source) => ({ type: 'message', webhookEventId: 'ev' + (++evSeq), replyToken: 'rt' + evSeq,
  source: source || { type: 'user', userId: uid }, message: { type: 'text', text } });
const pb = (uid, data) => ({ type: 'postback', webhookEventId: 'ev' + (++evSeq), replyToken: 'rt' + evSeq,
  source: { type: 'user', userId: uid }, postback: { data } });
const replies = () => sent.filter(s => s.url.indexOf('/message/reply') !== -1);
const lastMsgs = () => { const r = replies(); return r.length ? r[r.length - 1].body.messages : []; };
const lastText = () => { const m = lastMsgs()[0]; return m ? (m.text || m.altText || '') : ''; };
const chatlog = () => (files[UAT].chatlog ? files[UAT].chatlog.__rows : []);

console.log('-- ด่านตัวตน --');
post([msg('U8', 'ยอดขายวันนี้')]);
ok('liff_users ที่ยังไม่อนุมัติ → บอกให้รออนุมัติ', /รอแอดมินอนุมัติ/.test(lastText()), lastText());
post([msg('U7', 'ยอดขายวันนี้')]);
ok('liff_users ที่อนุมัติแล้ว → ตอบได้ (ทางเดิมของบอท)', /ยอดขายวันนี้/.test(lastText()), lastText());
post([msg('U2', 'ยอดขายวันนี้')]);
ok('★ แอดมินที่ผูก LINE ไว้ → ผ่านด่านได้แม้ไม่มีแถว liff_users ที่อนุมัติ', /ยอดขายวันนี้/.test(lastText()), lastText());
eq('และถูกลงทะเบียนในชีตให้ (ผู้ใช้ใหม่)', files[PROD].liff_users.__rows.some(r => r.line_user_id === 'U2'), true);
post([msg('U5', 'ยอดขายวันนี้')]);
ok('บัญชีแอดมินที่ถูกระงับ → ไม่ผ่าน', /รอแอดมินอนุมัติ/.test(lastText()), lastText());

console.log('\n-- คำสั่งเดิมต้องไม่พังจากการแก้ --');
post([msg('U7', 'ยอดขายวันนี้')]);
ok('ยอดขายวันนี้: รวมทุกตัวแทนของวันนี้เท่านั้น (4 ใบ / 14,840.50)',
  /จำนวนบิล: 4 ใบ/.test(lastText()) && /14,840\.50/.test(lastText()), lastText());
post([msg('U7', 'สต็อก 10143')]);
ok('สต็อก: คงเหลือ 126 · จอง 12 · ขายได้จริง 114',
  /คงเหลือ: 126/.test(lastText()) && /ถูกจอง: 12/.test(lastText()) && /ขายได้จริง: 114/.test(lastText()), lastText());
post([msg('U7', 'ยอดค้างชำระ C1001')]);
ok('ยอดค้างชำระ: นับเฉพาะ open/partial และหักที่รับมาแล้ว (1,300.00)', /รวมค้างชำระ: 1,300\.00/.test(lastText()), lastText());
ok('ใบที่เลยกำหนดถูกทำเครื่องหมาย', /INV-1.*เลยกำหนด/.test(lastText()), lastText());
post([msg('U7', 'สถานะบิล C1001')]);
ok('สถานะบิล: อ่านจากไฟล์ของตัวแทน เรียงใหม่สุดก่อน', /SO-BDC-2/.test(lastText()), lastText());
ok('แปลงสถานะเป็นคำไทย', /กำลังจัดส่ง \/ ชำระบางส่วน/.test(lastText()), lastText());
post([msg('U7', 'สถานะบิล C1003')]);
ok('ลูกค้าที่ยังไม่มีบิล', /ยังไม่มีบิลขายในระบบ/.test(lastText()), lastText());
post([msg('U7', 'สถานะบิล ร้านตัวอย่าง')]);
ok('ชื่อซ้ำหลายราย → ให้พิมพ์รหัส', /พบลูกค้าหลายราย/.test(lastText()), lastText());

console.log('\n-- ★★ HOUSE → TNKI (บั๊กที่เจอตอนนำเข้า) --');
post([msg('U7', 'สถานะบิล C1002')]);
ok('★ ลูกค้าขายตรงที่ tenant_id ว่าง → อ่านไฟล์ TNKI ได้ (เดิม fallback เป็น HOUSE แล้วพัง)',
  /SO-TNKI-1/.test(lastText()), lastText());
ok('ไม่ใช่ข้อความ "ดึงข้อมูลไม่สำเร็จ"', !/ไม่สำเร็จ/.test(lastText()), lastText());

console.log('\n-- ของคงเหลือ: ด่านของคำสั่งนี้เข้มกว่าคำสั่งอื่น --');
post([msg('U7', 'ของคงเหลือ')]);
ok('★ liff_users ที่ไม่มีบัญชีแอดมิน → ปฏิเสธคำสั่งนี้ แต่บอกว่าคำสั่งอื่นยังใช้ได้',
  /ต้องใช้บัญชีแอดมิน/.test(lastText()) && /คำสั่งอื่นยังใช้ได้/.test(lastText()), lastText());
post([msg('U4', 'ของคงเหลือ')]);
ok('★ มีบัญชีแอดมินแต่บทบาทไม่มีสิทธิ์โมดูลคลัง → ปฏิเสธ', /ไม่มีสิทธิ์ดูเมนูคลัง/.test(lastText()), lastText());
post([msg('U6', 'ของคงเหลือ')]);
// ไม่มีบทบาท = botAdminUser_ คืน null และไม่มีแถว liff_users ที่อนุมัติ → ตกด่านแรกสุดของ handleMessage_
ok('บัญชีที่ยังไม่ได้กำหนดบทบาท → ไม่ผ่านตั้งแต่ด่านแรก', /รอแอดมินอนุมัติ/.test(lastText()), lastText());

console.log('\n-- ของคงเหลือ: ดูแลรายเดียว --');
post([msg('U3', 'ของคงเหลือ')]);
let m = lastMsgs()[0];
eq('แอดมินตัวแทน → ได้ Flex ทันที ไม่ต้องเลือก', m.type, 'flex');
eq('หัวการ์ด', m.contents.header.contents[1].text, 'บีดีซี ตะวันออก');
eq('★ หัวตาราง 2 ช่อง: รหัสสินค้า | คลัง + รถ = รวม (ของเดิม 4 ช่อง ตัวเลขเบียดกันบนมือถือ)',
  rowOf(m.contents.body.contents[0]), ['รหัสสินค้า', 'คลัง + รถ = รวม']);
// เรียงตามของรวมหน่วยฐานมากไปน้อย: กาว 250 ชิ้น มาก่อน น้ำยา 36 ชิ้น (ไม่ใช่เรียงตามลัง 2.5 vs 3)
eq('★ แถวแรกเป็นรหัสสินค้า ไม่ใช่ชื่อ · รหัสหน่วยเก่า CASE ยังนับเป็นลัง (250 ÷ 100 = 2.5)',
  rowOf(m.contents.body.contents[2]), ['10505', '2.5 + 0 = 2.5']);
eq('แถวถัดมา: คลัง 24 ชิ้น ÷ 12 = 2 ลัง · รถ 12 ชิ้น = 1 ลัง · รวม 3',
  rowOf(m.contents.body.contents[3]), ['10143', '2 + 1 = 3']);
eq('ท้ายการ์ดมีช่องรวม', rowOf(m.contents.footer.contents[1]), ['รวมทั้งหมด (ลัง)', '4.5 + 1 = 5.5']);
ok('★ ยอดรวมในช่องเดียวกันเป็น span สีฟ้าตัวหนา (ตาจับ "รวม" ได้ก่อนตัวแยก)',
  m.contents.body.contents[2].contents[1].contents[1].color === '#2B63D9' &&
  m.contents.body.contents[2].contents[1].contents[1].weight === 'bold',
  m.contents.body.contents[2].contents[1]);
ok('ของบริษัทไม่ปนมา (รหัส 10185 ต้องไม่อยู่ในการ์ด)', !JSON.stringify(m.contents).includes('10185'), 'leak');
ok('altText มีตัวเลขรวม', /รวม 5\.5 ลัง/.test(m.altText), m.altText);

console.log('\n-- ★ พิมพ์คำสั่งได้หลายแบบ --');
['ของคงเหลือ', 'inventory', 'INVENTORY', 'inv', '/ของคงเหลือ', '/inventory', '/inv'].forEach(w => {
  post([msg('U3', w)]);
  const got = lastMsgs()[0];
  ok('"' + w + '" ใช้ได้', got && got.type === 'flex', lastText());
});
post([msg('U3', '/inventory BDC')]);
ok('★ มี / นำหน้าพร้อมรหัสตัวแทนก็ยังได้ (แชทเดี่ยวเดิมตัด / ไม่ออก คำสั่งจึงไม่เข้าเงื่อนไข)',
  lastMsgs()[0].type === 'flex', lastText());
post([msg('U3', 'inventoryx')]);
ok('คำที่พิมพ์ติดกันไม่ใช่คำสั่ง', /ยังไม่เข้าใจ/.test(lastText()), lastText());

console.log('\n-- ของคงเหลือ: ขอบเขตของบริษัท --');
post([msg('U1', 'ของคงเหลือ TNKI')]);
m = lastMsgs()[0];
const rowsOf = flex => flex.contents.body.contents.filter(c => c.type === 'box').slice(1).map(rowOf);
const own = rowsOf(m);
eq('★ คลัง = แถว tenant_id ว่าง (126 ชิ้น = 10.5 ลัง) · แถว TNKI 999999 ไม่ถูกนับ',
  own[0], ['10143', '10.5 + 3 = 13.5']);
ok('★ สเปรย์กันยุง 90 ชิ้น ÷ 60 = 1.5 (หน่วยที่ปิดใช้งาน factor 999 ไม่ถูกหยิบ)',
  own.some(r => r[0] === '10185' && r[1] === '1.5 + 0 = 1.5'), own);
ok('★ สินค้ายังไม่ยืนยันขนาดบรรจุ: ดอกจันนำหน้ารหัส และไม่หาร (7 ชิ้น)',
  own.some(r => r[0] === '*10999' && r[1] === '7 + 0 = 7'), own);
eq('★ ยอดรวมลังไม่บวกชิ้นเข้าไป (10.5 + 1.5 = 12)',
  rowOf(m.contents.footer.contents[1]), ['รวมทั้งหมด (ลัง)', '12 + 3.5 = 15.5']);
ok('ยอดรวมท้ายการ์ดตัดบรรทัดได้ (ยาวกว่าแถวข้อมูล ไม่ควรถูกตัดท้ายทิ้ง)',
  m.contents.footer.contents[1].contents[1].wrap === true, m.contents.footer.contents[1].contents[1]);
ok('เชิงอรรถบอกเรื่องขนาดบรรจุ', JSON.stringify(m.contents.footer).includes('ยังไม่ยืนยันขนาดบรรจุ'), m.contents.footer);
ok('ของที่หมดทั้งคลังและรถไม่โผล่', !own.some(r => r[0] === '10777'), own);
ok('แถวขยะที่ไม่มีรหัสสินค้าไม่เข้ารายงาน', own.every(r => r[0] !== ''), own);
ok('บอกจำนวนพนักงานที่มีของบนรถ (2 คน — คนที่รถว่างไม่นับ)',
  JSON.stringify(m.contents.footer).includes('พนักงาน 2 คน'), m.contents.footer);

console.log('\n-- ของคงเหลือ: ตัวแทนที่ยังไม่มีไฟล์ --');
post([msg('U1', 'ของคงเหลือ NKN')]);
m = lastMsgs()[0];
ok('★ อ่านรถไม่ได้ต้องบอก ไม่ใช่รายงาน 0 ให้เข้าใจว่ารถว่าง',
  JSON.stringify(m.contents.footer).includes('อ่านของบนรถไม่ได้'), m.contents.footer);

console.log('\n-- ของคงเหลือ: เลือกตัวแทน --');
post([msg('U1', 'ของคงเหลือ')]);
m = lastMsgs()[0];
eq('★ ดูแลหลายราย → ถามก่อน ไม่เดา', m.type, 'text');
eq('quick reply ครบทุกรายที่ดูแล (TNKI/BDC/NKN — OLD ปิดใช้งานไม่นับ)', m.quickReply.items.length, 3);
eq('★ บริษัทเจ้าของสินค้าเป็นตัวเลือกแรก และใช้ชื่อบริษัทจริง', m.quickReply.items[0].action.label, 'บริษัท ธนัทกร จำกัด');
ok('ป้ายปุ่มไม่เกิน 20 ตัวอักษร', m.quickReply.items.every(i => i.action.label.length <= 20), m.quickReply.items.map(i => i.action.label));
eq('เป็น postback', m.quickReply.items[0].action.type, 'postback');
post([pb('U1', 'cmd=inv&t=BDC')]);
ok('กดปุ่มแล้วได้รายงานของรายนั้น', /บีดีซี/.test(lastMsgs()[0].altText), lastText());
post([pb('U3', 'cmd=inv&t=NKN')]);
ok('★ แอดมิน BDC ปลอม data ขอดู NKN → ปฏิเสธ (ตรวจสิทธิ์ใหม่ ไม่เชื่อ data)',
  /ไม่พบตัวแทน "NKN"/.test(lastText()), lastText());
post([pb('U1', 'cmd=zzz&t=BDC')]);
eq('postback ที่ไม่ใช่คำสั่งของเรา → ไม่ตอบ', replies().length, 0);
post([msg('U1', 'ของคงเหลือ นครนายก')]);
ok('พิมพ์ชื่อไทยก็ได้', /นครนายก/.test(lastMsgs()[0].altText), lastText());
post([msg('U1', 'ของคงเหลือ ไม่มีจริง')]);
ok('ไม่พบ → บอกรายการที่ดูแลอยู่', /ไม่พบตัวแทน/.test(lastText()) && /BDC/.test(lastText()), lastText());

console.log('\n-- ★★ กติกา "ใครดูแลใคร" ต้องตรงกับ backend/57_user_tenants.gs --');
const ids = uid => ctx.botManagedTenantIds_(ctx.botAdminUser_(uid)).slice().sort();
eq('ตารางว่าง + ฝั่งบริษัท = เห็นทุกราย (ไม่ใช่ไม่เห็นอะไรเลย)', ids('U2'), ['BDC', 'NKN', 'TNKI']);
eq('super_admin เห็นทุกราย', ids('U1'), ['BDC', 'NKN', 'TNKI']);
eq('สังกัดตัวแทน = รายเดียวของตัวเอง', ids('U3'), ['BDC']);
files[PROD].admin_user_tenants.__rows.push({ record_id: 1, admin_user_id: '2', tenant_id: 'BDC' });
eq('★ มีแถวระบุไว้ = เห็นเฉพาะรายนั้น', ids('U2'), ['BDC']);
files[PROD].admin_user_tenants.__rows.push({ record_id: 2, admin_user_id: '3', tenant_id: 'NKN' });
eq('★ ใส่แถวให้แอดมินตัวแทน = ยังข้ามไปรายอื่นไม่ได้', ids('U3'), ['BDC']);
files[PROD].admin_user_tenants.__rows.push({ record_id: 3, admin_user_id: '1', tenant_id: 'BDC' });
eq('★ super_admin ยังเห็นทุกรายแม้มีแถวระบุ', ids('U1'), ['BDC', 'NKN', 'TNKI']);
files[PROD].admin_user_tenants.__rows.push({ record_id: 4, admin_user_id: '2', tenant_id: 'OLD' });
eq('ตัวแทนที่ปิดใช้งานหลุดออกเอง', ids('U2'), ['BDC']);
const keep = files[PROD].admin_user_tenants;
delete files[PROD].admin_user_tenants;
eq('★ ยังไม่มีแท็บนี้ในชีต (ยังไม่ได้ deploy backend ใหม่) = เห็นทุกราย ไม่ใช่พังทั้งคำสั่ง', ids('U2'), ['BDC', 'NKN', 'TNKI']);
files[PROD].admin_user_tenants = keep;
files[PROD].admin_user_tenants.__rows.length = 0;

console.log('\n-- แชทกลุ่ม --');
post([msg('U7', 'ยอดขายวันนี้', { type: 'group', groupId: 'G1', userId: 'U7' })]);
eq('★ ในกลุ่ม ไม่มี "/" นำหน้า = ไม่ใช่การเรียกบอท ไม่ตอบ ไม่ log', replies().length, 0);
post([msg('U7', '/ยอดขายวันนี้', { type: 'group', groupId: 'G1', userId: 'U7' })]);
ok('ในกลุ่ม มี "/" = ตอบ', /ยอดขายวันนี้/.test(lastText()), lastText());

console.log('\n-- LINE ส่งซ้ำ --');
const dup = msg('U7', 'ยอดขายวันนี้');
post([dup]);
eq('ครั้งแรกตอบ', replies().length, 1);
post([dup]);
eq('★ webhookEventId เดิม → ไม่ตอบซ้ำ', replies().length, 0);

console.log('\n-- doPost ต้องตอบ 200 เสมอ --');
let out = post([]);
ok('ปุ่ม Verify ในคอนโซล (events ว่าง)', out && JSON.parse(out.__body).ok === true, out);
out = ctx.doPost({ postData: { contents: '{ไม่ใช่ json' } });
ok('body พัง → ยังตอบ 200 (ไม่งั้น LINE retry วนไม่จบ)', out && JSON.parse(out.__body).ok === true, out);
out = post([{ type: 'message', webhookEventId: 'evX', replyToken: 'rtX', source: { type: 'user', userId: 'U7' }, message: { type: 'sticker' } }]);
eq('สติกเกอร์ → ไม่ตอบ', replies().length, 0);

console.log('\n-- chatlog --');
post([msg('U7', 'ยอดขายวันนี้')]);
const last = chatlog()[chatlog().length - 1];
eq('เก็บข้อความผู้ใช้ตามที่พิมพ์มา', last.user_message, 'ยอดขายวันนี้');
ok('เก็บคำตอบเป็นข้อความ', /ยอดขายวันนี้/.test(String(last.response_message)), last);
post([msg('U3', 'ของคงเหลือ')]);
const flexLog = chatlog()[chatlog().length - 1];
ok('★ คำตอบที่เป็น Flex เก็บ altText ไม่ใช่ JSON ทั้งก้อน',
  /^\[flex\] ของคงเหลือ/.test(String(flexLog.response_message)), flexLog.response_message);

console.log('\n-- ช่วยเหลือ --');
post([msg('U7', 'ช่วยเหลือ')]);
ok('★ มีคำสั่งใหม่อยู่ในรายการ', /ของคงเหลือ/.test(lastText()), lastText());
ok('ยังมีคำสั่งเดิมครบ', /สต็อก/.test(lastText()) && /ยอดค้างชำระ/.test(lastText()) && /สถานะบิล/.test(lastText()), lastText());
post([msg('U7', 'สวัสดีครับ')]);
ok('ข้อความที่ไม่ใช่คำสั่ง → บอกวิธีดูคำสั่ง', /ยังไม่เข้าใจ/.test(lastText()), lastText());

console.log('\n-- รูปแบบตัวเลข --');
eq('จำนวนเต็ม', ctx.botNum_(13), '13');
eq('ครึ่งลังเขียน .5', ctx.botNum_(13.5), '13.5');
eq('เศษสองตำแหน่ง', ctx.botNum_(13.25), '13.25');
eq('หลักพันมีคอมมา', ctx.botNum_(12840.5), '12,840.5');
eq('ติดลบ', ctx.botNum_(-4.5), '-4.5');
eq('ไม่ใช่ตัวเลข = 0', [ctx.botNum_(null), ctx.botNum_('x')], ['0', '0']);

console.log('\n-- ผู้ติดตามที่ตกหล่น (backfill) --');
resetData();
ctx.runBackfillMissingFollowers();
ok('★ เพิ่มแถวให้คนที่ยังไม่มี (U9) และไม่ทับคนที่มีอยู่แล้ว (U7)',
  files[PROD].liff_users.__rows.filter(r => r.line_user_id === 'U9').length === 1 &&
  files[PROD].liff_users.__rows.filter(r => r.line_user_id === 'U7').length === 1,
  files[PROD].liff_users.__rows.map(r => r.line_user_id));
eq('แถวใหม่รออนุมัติ ไม่ใช่ใช้งานได้ทันที',
  files[PROD].liff_users.__rows.find(r => r.line_user_id === 'U9').status, 'No');
eq('และเติมให้ไฟล์ UAT ด้วย (สำเนาสำรองตัวตน)',
  files[UAT].liff_users.__rows.filter(r => r.line_user_id === 'U9').length, 1);

console.log(failed ? '\n' + failed + ' เทสต์ไม่ผ่าน' : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
