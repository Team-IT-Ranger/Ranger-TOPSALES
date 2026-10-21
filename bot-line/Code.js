/**
 * ===================== RangerBot-TOPSALES — LINE Messaging API webhook =====================
 * แอปแยกจาก backend หลักของ Ranger-TOPSALES โดยตั้งใจ (doPost ของ backend หลักเป็นทางเข้าเดียวของ action
 * router ทั้งหมด ผสม payload ของ LINE เข้าไปจะเสี่ยงกับแอปขายที่กำลังใช้งานจริง) เรียก Central Sheet ตรงๆ
 * ผ่าน Script Property ที่ชี้ไฟล์ ไม่มีโค้ดใช้ร่วมกับ backend หลัก
 *
 * ★ บอทนี้ไม่มีแนวคิด "สลับ env" แบบ backend หลัก — การอ่านข้อมูลทั้งหมด (ตอบคำถาม/หาข้อมูล) ใช้ **prod
 *   เป็นหลักเสมอ** ข้อยกเว้นเดียวคือตอนลงทะเบียนผู้ใช้ (`ensureLiffUser_`) ซึ่งเช็ค/เพิ่มแถวให้ **ทั้ง prod
 *   และ uat แยกอิสระต่อกัน** (มีในไฟล์ไหนอยู่แล้วก็ข้ามไฟล์นั้น ไม่ทับ) กันบัญชีไม่ตรงกันระหว่างสองฐาน
 *
 * ★ Log การสนทนา (`logChat_`) เขียนลงแท็บ `chatlog` ใน **UAT เท่านั้น** (ไม่ใช่ prod) — สร้างแท็บให้เองถ้ายังไม่มี
 *
 * ★ คนเพิ่มเพื่อนตอน webhook ยังใช้งานไม่ได้ (เช่นช่วงที่ deployment settings ยังผิด) จะไม่มีแถวใน liff_users เลย
 *   เพราะ LINE ไม่ส่ง follow event ซ้ำให้ถ้าเช็คแล้วว่าเป็นเพื่อนอยู่แล้ว (ต้อง unfriend แล้วเพิ่มใหม่ถึงจะยิงอีกรอบ)
 *   → รัน `backfillMissingFollowers_()` ครั้งเดียวจาก editor เพื่อไล่ดึงรายชื่อเพื่อนบอททั้งหมดจาก LINE มาเทียบ
 *   แล้วเติมแถวที่ขาดให้ (ใช้ ensureLiffUser_ ตัวเดียวกับ webhook จึงเติมทั้ง prod และ uat ให้ครบเหมือนกัน)
 *
 * Script Properties ที่ต้องตั้ง (Project Settings ของโปรเจกต์นี้):
 *   CENTRAL_SHEET_FILEID_PROD  Central Sheet ของ prod (ตั้งไว้แล้ว)
 *   CENTRAL_SHEET_FILEID_UAT   Central Sheet ของ UAT (ตั้งไว้แล้ว) — ใช้ตอน sync บัญชีผู้ใช้ + เก็บ chatlog
 *   LINE_CHANNEL_ACCESS_TOKEN  ใช้ตอบข้อความ (Reply API), ดึงชื่อผู้ใช้ (Get Profile API), ดึงรายชื่อเพื่อนบอท
 *                              (Get Follower IDs API สำหรับ backfillMissingFollowers_) — ตั้งไว้แล้ว
 *
 * ★ ยังไม่ตรวจลายเซ็น X-Line-Signature — Apps Script doPost(e) ไม่ให้เข้าถึง request header เลย (ข้อจำกัดของแพลตฟอร์ม)
 *   จึงพึ่ง URL ของ deployment ที่ยาว/สุ่มแทนการตรวจลายเซ็น ห้ามเผยแพร่ URL นี้นอกจากช่อง Webhook URL ของ LINE
 *   ★ สิ่งที่ทำให้คำขอปลอมดึงข้อมูลออกไปไม่ได้จริงๆ คือ **คำตอบออกทาง reply token ของ LINE เท่านั้น**
 *     (token ปลอมถูก LINE ปฏิเสธ) — คำสั่งอ่านอย่างเดียวจึงปลอดภัยอยู่ · **คำสั่งที่เขียนข้อมูลไม่ได้อาศัย
 *     ข้อนี้เลย ถ้าจะเพิ่มต้องคิดเรื่องตัวตน/ลายเซ็นใหม่ทั้งหมดก่อน**
 *
 * ★★ 21 ต.ค. 2026 — เจ้าของระบบเลือกให้ **โปรเจกต์นี้เป็นบอทตัวจริงตัวเดียว** (LINE channel หนึ่งตัวชี้ webhook
 *   ได้ URL เดียว และใช้ channel เดิมตัวเดียวกัน) · `/inventory` ที่เคยเขียนไว้ใน backend หลัก
 *   (`59_line_bot.gs` / `60_flex_inventory.gs`) จึงถูก**ถอดออกจาก backend แล้วย้ายมาอยู่ที่นี่**
 *   - ข้อแลกเปลี่ยนที่ยอมรับแล้ว: **สูตรรวมสต็อกและกติกา "ใครดูแลตัวแทนไหน" ถูกคัดลอกมาไว้ที่นี่**
 *     เพราะโปรเจกต์นี้อ่านชีตตรงๆ เรียกฟังก์ชันของ backend ไม่ได้
 *   - **★ แก้ที่ไหนต้องแก้อีกที่ด้วยเสมอ** — คู่ที่ต้องตรงกันคือ `botManagedTenantIds_()` ที่นี่ กับ
 *     `managedTenantIds()` ใน `backend/57_user_tenants.gs` (ตัวเดียวกันคนละภาษาของการอ่านชีต)
 *     และ `botInventorySnapshot_()` ที่นี่ กับการตัดสินใจเรื่องหน่วยลัง/ขอบเขตคลัง-รถ ใน CLAUDE.md
 */

function doPost(e) {
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    (body.events || []).forEach(handleLineEvent_);
  } catch (err) {
    console.error('doPost error: ' + (err && err.stack || err));
  }
  // LINE ต้องการ 200 เสมอ ไม่งั้นจะส่ง webhook เดิมซ้ำ — ความล้มเหลวข้างในถูกกลืนไว้ข้างบนแล้ว (log ไว้ใน Stackdriver)
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function handleLineEvent_(event) {
  // LINE ส่ง webhook เดิมซ้ำเมื่อไม่ได้ 200 ทันเวลา (เช่นตอบช้าเพราะเปิดชีตหลายไฟล์) — กันตอบสองรอบ
  if (seenEvent_(event && event.webhookEventId)) return;
  if (event.type === 'follow') return handleFollow_(event);
  if (event.type === 'message' && event.message && event.message.type === 'text') return handleMessage_(event);
  if (event.type === 'postback') return handlePostback_(event);
  // ขั้นต่อไป (ยังไม่ทำ): unfollow (ทำเครื่องหมายว่าเลิกติดตาม), ข้อความที่ไม่ใช่ text (สติกเกอร์/รูป)
}

// จำ webhookEventId ไว้ 10 นาที (LINE retry ภายในไม่กี่นาที) — ใช้ CacheService ไม่ใช้ LockService
// เพราะคำสั่งทั้งหมดเป็นการอ่าน คนสองคนพิมพ์พร้อมกันไม่ควรต้องรอคิวกัน
function seenEvent_(eventId) {
  var id = String(eventId || '');
  if (!id) return false;
  try {
    var cache = CacheService.getScriptCache(), key = 'botev_' + id;
    if (cache.get(key)) return true;
    cache.put(key, '1', 600);
  } catch (err) {}
  return false;
}

// ปุ่มเลือกตัวแทนจากเมนู /inventory — data รูปแบบ `cmd=inv&t=<tenantId>`
// ★ data ที่ส่งกลับมาเชื่อไม่ได้ (คำขอปลอมใส่ค่าอะไรก็ได้) → botInventoryMessages_ ตรวจสิทธิ์ใหม่ทุกครั้ง
function handlePostback_(event) {
  var lineUserId = event.source && event.source.userId;
  var replyToken = event.replyToken;
  if (!lineUserId || !replyToken) return;
  var data = String((event.postback && event.postback.data) || '');
  var parsed = {};
  data.split('&').forEach(function(pair) {
    var i = pair.indexOf('=');
    if (i !== -1) parsed[pair.substring(0, i)] = decodeURIComponent(pair.substring(i + 1).replace(/\+/g, ' '));
  });
  if (parsed.cmd !== 'inv') return;
  try {
    replyAndLog_(replyToken, lineUserId, '', '[ปุ่ม] ของคงเหลือ ' + (parsed.t || ''), botInventoryMessages_(lineUserId, parsed.t || ''));
  } catch (err) {
    console.error('handlePostback_ error: ' + (err && err.stack || err));
    replyAndLog_(replyToken, lineUserId, '', data, 'ขอโทษครับ ระบบขัดข้องตอนดึงของคงเหลือ ลองใหม่อีกครั้ง');
  }
}

// เพิ่มเพื่อนกับบอทครั้งแรก → จองตัวตนไว้ใน liff_users รอแอดมินอนุมัติ + ทักทายให้รู้ว่าคำขอเข้าไปแล้ว
// tenant_id ว่างโดยตั้งใจ: ทีมงานที่ใช้บอทนี้เป็นฝั่งบริษัท ไม่ใช่พนักงานตัวแทน จึงต้องให้แอดมินบริษัท/super_admin
// เป็นคนอนุมัติที่เมนู "พนักงานขาย" เท่านั้น (แอดมินตัวแทนกรองด้วย tenant_id จะไม่เห็นแถวนี้เลย ตามกติกาเดิมของระบบ)
function handleFollow_(event) {
  var lineUserId = event.source && event.source.userId;
  if (!lineUserId) return;
  var created = ensureLiffUser_(lineUserId);
  if (created && event.replyToken) {
    replyMessage_(event.replyToken,
      'ขอบคุณที่เพิ่มเพื่อนกับ RangerBot-TOPSALES ครับ 🙏\nคำขอเข้าใช้งานถูกบันทึกแล้ว รอแอดมินอนุมัติก่อนเริ่มถามข้อมูลได้นะครับ');
  }
}

// ข้อความเข้ามา → ต้องเป็นผู้ใช้ที่อนุมัติแล้ว (status='Yes' ใน liff_users ของ prod) ถึงจะตอบคำถามให้
// เช็คกับ prod เสมอ (ที่เดียวที่แอดมินจริงกดอนุมัติ) — ไม่เช็คกับ UAT เพราะ UAT เป็นแค่สำเนาสำรองตัวตน
function handleMessage_(event) {
  var lineUserId = event.source && event.source.userId;
  var replyToken = event.replyToken;
  if (!lineUserId || !replyToken) return;

  var rawText = String(event.message.text || '').trim(); // เก็บของดิบไว้ log — ตัวที่ใช้ตัดสินคำสั่งจะถูกตัด "/" ออกด้านล่าง
  var text = rawText;

  // แชทกลุ่ม/ห้อง: ต้องพิมพ์ "/" นำหน้าเสมอถึงจะถือว่าเป็นคำสั่งเรียกบอท กันบอทแทรกทุกข้อความที่คนคุยกันเฉยๆ ในกลุ่ม
  // แชทเดี่ยว (1:1): ไม่ต้องมี "/" ตอบได้ทุกข้อความตามปกติ
  var isGroupChat = event.source && (event.source.type === 'group' || event.source.type === 'room');
  if (isGroupChat) {
    if (text.charAt(0) !== '/') return; // ข้อความคุยกันเฉยๆ ในกลุ่ม ไม่ใช่การเรียกบอท — เงียบไว้ ไม่ตอบ ไม่ลงทะเบียน ไม่ log
    text = text.substring(1).trim();
  } else if (text.charAt(0) === '/') {
    /* ★ แชทเดี่ยวก็ยอมรับ "/" นำหน้า (21 ต.ค. 2026) — เดิมตัดทิ้งเฉพาะในกลุ่ม คนที่ชินกับการพิมพ์
       `/inventory` ในแชทเดี่ยวจึงได้คำตอบว่า "ยังไม่เข้าใจคำถามนี้" ทั้งที่พิมพ์คำสั่งถูกแล้ว
       (ไม่ได้บังคับให้ใส่ — แชทเดี่ยวพิมพ์เฉยๆ ก็ยังได้เหมือนเดิม) */
    text = text.substring(1).trim();
  }

  var displayName = '';

  // ★ ครอบทุกอย่างหลังจากนี้ด้วย try/catch แล้วตอบ error กลับไปในแชทเสมอ — ก่อนหน้านี้ exception ที่หลุดออกมา
  // (เช่น เขียน UAT พัง) ทำให้ doPost จบเงียบๆ โดยไม่มีอะไรตอบกลับเลย ผู้ใช้เห็นแค่ "อ่านแล้ว" แล้วไม่มีอะไรต่อ
  // debug ไม่ได้ถ้าไม่เปิด Executions เอง — ตอนนี้อย่างน้อยจะได้ข้อความบอกว่าเกิดอะไรขึ้นในแชทเลย
  try {
    // กันเคส follow event ตกหล่น (LINE ไม่การันตีลำดับ 100%) — เจอข้อความจากคนที่ยังไม่มีแถวเลยก็ลงทะเบียนให้ทันที
    ensureLiffUser_(lineUserId);

    var me = findLiffUser_(prodSheet_('liff_users'), lineUserId);
    displayName = (me && me.display_name) || '';
    /* ★ ผ่านด่านได้สองทาง: อนุมัติใน liff_users (ทางเดิมของบอท) **หรือ** มีบัญชีแอดมินที่ผูก LINE ไว้แล้ว
       — ไม่มีข้อหลัง แอดมินที่ผูก LINE เรียบร้อยจะติด "รออนุมัติ" ตลอดไป เพราะ ensureLiffUser_ เพิ่งสร้าง
       แถว status='No' ให้เขาเมื่อกี้ แล้วไม่มีใครไปกดอนุมัติแถวนั้น (บัญชีเขาอยู่คนละตาราง) */
    var admin = botAdminUser_(lineUserId);
    if (admin && !displayName) displayName = admin.display_name || '';
    if ((!me || String(me.status) !== 'Yes') && !admin) {
      replyAndLog_(replyToken, lineUserId, displayName, rawText, 'บัญชีนี้ยังรอแอดมินอนุมัติอยู่ครับ อนุมัติแล้วถึงจะถามข้อมูลได้');
      return;
    }

    replyAndLog_(replyToken, lineUserId, displayName, rawText, answerQuestion_(text, lineUserId));
  } catch (err) {
    console.error('handleMessage_ error: ' + (err && err.stack || err));
    replyAndLog_(replyToken, lineUserId, displayName, rawText, 'ขอโทษครับ ระบบขัดข้องตอนตอบคำถามนี้ ลองใหม่อีกครั้ง หรือแจ้งแอดมิน');
  }
}

/** response รับได้ทั้งสตริง (ข้อความล้วน) และ array ของ message object (Flex/quick reply) */
function replyAndLog_(replyToken, lineUserId, displayName, userMessage, response) {
  var messages = typeof response === 'string' ? [{ type: 'text', text: String(response).substring(0, 5000) }] : response;
  replyMessages_(replyToken, messages);
  // chatlog เก็บเป็นข้อความอ่านได้เสมอ — Flex เก็บ altText (ตัว JSON ยาวและอ่านไม่รู้เรื่องในชีต)
  logChat_(lineUserId, displayName, userMessage, messages.map(function(m) {
    return m.type === 'text' ? m.text : ('[' + m.type + '] ' + (m.altText || ''));
  }).join('\n'));
}

// ── ตอบคำถาม (ชุดคำสั่งเริ่มต้น — เพิ่มเงื่อนไขใหม่ต่อท้ายได้เรื่อยๆ) ──
// คืนสตริง = ข้อความล้วน · คืน array = message object ของ LINE (ใช้กับ Flex/ปุ่มเลือก)
function answerQuestion_(text, lineUserId) {
  if (!text || /^(ช่วยเหลือ|help|เมนู|คำสั่ง)$/i.test(text)) return helpText_();
  if (/^ยอดขาย/i.test(text)) return answerTodaySales_();
  // ★ ต้องอยู่ก่อน "สต็อก" เพราะคนละคำถาม: สต็อก = สินค้าตัวเดียวในคลังกลาง หน่วยฐาน + ยอดจอง
  //   ของคงเหลือ/inventory = ทุกสินค้าของตัวแทนรายหนึ่ง แยกคลัง/รถ หน่วยลัง
  if (/^(ของคงเหลือ|inventory|inv)(\s|$)/i.test(text)) {
    return botInventoryMessages_(lineUserId, text.replace(/^(ของคงเหลือ|inventory|inv)\s*/i, '').trim());
  }
  if (/^(สต็อก|stock)\s+/i.test(text)) return answerStock_(text.replace(/^(สต็อก|stock)\s+/i, '').trim());
  if (/^(ยอดค้างชำระ|ยอดค้าง)\s+/i.test(text)) return answerReceivable_(text.replace(/^(ยอดค้างชำระ|ยอดค้าง)\s+/i, '').trim());
  if (/^(สถานะบิล|บิลขาย)\s+/i.test(text)) return answerSalesOrders_(text.replace(/^(สถานะบิล|บิลขาย)\s+/i, '').trim());
  return 'ยังไม่เข้าใจคำถามนี้ครับ พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้ตอนนี้';
}

function helpText_() {
  return 'คำสั่งที่ใช้ได้ตอนนี้ครับ:\n' +
    '• ยอดขายวันนี้ — ยอดขายรวมวันนี้ (ทุกตัวแทน+บริษัท)\n' +
    '• ของคงเหลือ (หรือ inventory) — ของในคลังและบนรถ หน่วยลัง (เลือกตัวแทนได้ถ้าดูแลหลายราย)\n' +
    '• สต็อก <รหัส/ชื่อสินค้า> — สินค้าตัวเดียวในคลังกลางบริษัท หน่วยฐาน + ยอดจอง\n' +
    '• ยอดค้างชำระ <รหัส/ชื่อลูกค้า> — ใบแจ้งหนี้ที่ยังค้างของลูกค้ารายนั้น\n' +
    '• สถานะบิล <รหัส/ชื่อลูกค้า> — บิลขายล่าสุดของลูกค้ารายนั้น (สถานะส่งของ+การชำระเงิน)\n' +
    '(กำลังทยอยเพิ่มคำสั่งอื่นครับ)\n\n' +
    'ในแชทกลุ่ม ต้องพิมพ์ "/" นำหน้าเสมอ เช่น /ยอดขายวันนี้ — แชทเดี่ยวไม่ต้องใส่';
}

// sales_daily: record_id, tenant_id, sale_date, bills, revenue, updated_at (ดู backend/31_sales_rollup.gs)
// รวมทุก tenant_id ของวันนี้ — ไม่เปิดไฟล์ตัวแทนทีละไฟล์ (หลักเดียวกับแดชบอร์ดหลัก กันช้า)
function answerTodaySales_() {
  var today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var rows = sheetObjects_(prodSheet_('sales_daily')).filter(function(r) { return String(r.sale_date) === today; });
  var bills = 0, revenue = 0;
  rows.forEach(function(r) { bills += Number(r.bills) || 0; revenue += Number(r.revenue) || 0; });
  return 'ยอดขายวันนี้ (' + today + ')\nจำนวนบิล: ' + bills + ' ใบ\nยอดขายรวม: ' + formatMoney_(revenue) + ' บาท';
}

// สต็อกคลังกลางบริษัท (tenant_id ว่าง) เท่านั้น — ยังไม่รองรับถามสต็อกของตัวแทนรายใดรายหนึ่ง
function answerStock_(query) {
  if (!query) return 'พิมพ์รหัสหรือชื่อสินค้าต่อท้ายด้วยครับ เช่น "สต็อก 10143"';

  var products = sheetObjects_(prodSheet_('products'));
  var qLower = query.toLowerCase();
  var product = products.filter(function(p) { return String(p.product_code).toLowerCase() === qLower; })[0];

  if (!product) {
    var matches = products.filter(function(p) { return String(p.name || '').toLowerCase().indexOf(qLower) !== -1; });
    if (matches.length === 1) {
      product = matches[0];
    } else if (matches.length > 1) {
      return 'พบสินค้าหลายรายการที่ชื่อมีคำว่า "' + query + '":\n' +
        matches.slice(0, 8).map(function(p) { return '• ' + p.product_code + ' ' + p.name; }).join('\n') +
        (matches.length > 8 ? '\n… และอีก ' + (matches.length - 8) + ' รายการ' : '') +
        '\nพิมพ์รหัสสินค้าให้ตรงตัวเพื่อดูสต็อก';
    }
  }
  if (!product) return 'ไม่พบสินค้ารหัสหรือชื่อ "' + query + '" ในระบบครับ';

  var onHand = 0;
  sheetObjects_(prodSheet_('warehouse_stock')).forEach(function(s) {
    if (String(s.tenant_id || '') === '' && String(s.product_id) === String(product.record_id)) onHand += Number(s.qty) || 0;
  });

  var reserved = 0;
  sheetObjects_(prodSheet_('stock_reservations')).forEach(function(r) {
    if (String(r.tenant_id || '') === '' && String(r.product_id) === String(product.record_id) && String(r.status) === 'active') {
      reserved += Number(r.qty) || 0;
    }
  });

  return 'สต็อก ' + product.product_code + ' ' + product.name + ' (คลังกลางบริษัท หน่วยฐาน)\n' +
    'คงเหลือ: ' + onHand + '\n' +
    'ถูกจอง: ' + reserved + '\n' +
    'ขายได้จริง: ' + (onHand - reserved);
}

// หาลูกค้าจากรหัส (ตรงตัว) หรือชื่อ (มีคำนั้นอยู่) — ใช้ร่วมกันทั้งคำสั่งที่อ้างอิงลูกค้า
// คืน {customer} ถ้าเจอตัวเดียวชัดเจน, {multiMatch:ข้อความ} ถ้าชื่อซ้ำหลายราย ต้องให้ผู้ใช้พิมพ์รหัสแทน, null ถ้าไม่เจอเลย
function findCustomer_(query) {
  var customers = sheetObjects_(prodSheet_('customers'));
  var qLower = query.toLowerCase();
  var customer = customers.filter(function(c) { return String(c.customer_code).toLowerCase() === qLower; })[0];
  if (customer) return { customer: customer };

  var matches = customers.filter(function(c) { return String(c.name || '').toLowerCase().indexOf(qLower) !== -1; });
  if (matches.length === 1) return { customer: matches[0] };
  if (matches.length > 1) {
    return { multiMatch: 'พบลูกค้าหลายรายที่ชื่อมีคำว่า "' + query + '":\n' +
      matches.slice(0, 8).map(function(c) { return '• ' + c.customer_code + ' ' + c.name; }).join('\n') +
      (matches.length > 8 ? '\n… และอีก ' + (matches.length - 8) + ' ราย' : '') +
      '\nพิมพ์รหัสลูกค้าให้ตรงตัวเพื่อดูรายละเอียด' };
  }
  return null;
}

// ar_invoices: record_id, invoice_no, customer_id, tenant_id, sales_order_id, invoice_date, due_date,
//   subtotal_ex_vat, vat_amount, total, received_amount, status, ... (ดู backend/23_accounting.gs, backend/00_setup_sheets.gs)
// ค้าง = total - received_amount ของใบที่ status เป็น open/partial เท่านั้น (ตรงกับ getArAging ใน backend หลัก)
function answerReceivable_(query) {
  if (!query) return 'พิมพ์รหัสหรือชื่อลูกค้าต่อท้ายด้วยครับ เช่น "ยอดค้างชำระ C1001"';

  var found = findCustomer_(query);
  if (!found) return 'ไม่พบลูกค้ารหัสหรือชื่อ "' + query + '" ในระบบครับ';
  if (found.multiMatch) return found.multiMatch;
  var customer = found.customer;

  var today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var invoices = sheetObjects_(prodSheet_('ar_invoices')).filter(function(iv) {
    return String(iv.customer_id) === String(customer.record_id) && (iv.status === 'open' || iv.status === 'partial');
  }).map(function(iv) {
    return {
      invoiceNo: iv.invoice_no,
      dueDate: String(iv.due_date || '').substring(0, 10),
      outstanding: (Number(iv.total) || 0) - (Number(iv.received_amount) || 0)
    };
  }).filter(function(iv) { return iv.outstanding > 0.009; });

  if (!invoices.length) return 'ลูกค้า ' + customer.customer_code + ' ' + customer.name + ' ไม่มียอดค้างชำระครับ';

  var total = 0;
  var lines = invoices.map(function(iv) {
    total += iv.outstanding;
    var overdue = iv.dueDate && iv.dueDate < today ? ' (เลยกำหนด)' : '';
    return '• ' + iv.invoiceNo + ' ครบกำหนด ' + (iv.dueDate || '-') + ' ค้าง ' + formatMoney_(iv.outstanding) + overdue;
  });

  return 'ยอดค้างชำระ ' + customer.customer_code + ' ' + customer.name + '\n' +
    lines.join('\n') + '\nรวมค้างชำระ: ' + formatMoney_(total) + ' บาท';
}

// sales_orders อยู่ในไฟล์ Sheet ของ**ตัวแทนแต่ละราย** ไม่ใช่ central (ดู backend/13_tenants.gs) — ต้องหา
// tenant ของลูกค้าก่อนถึงจะรู้ว่าต้องเปิดไฟล์ไหน · ลูกค้าที่ขายตรงบริษัทเอง (ไม่ผ่านตัวแทน) มี tenant_id
// เป็น literal 'HOUSE' เสมอ (คนละแบบกับ warehouse_stock/stock_reservations ที่ใช้ '' แทนบริษัท — อย่าสับสน)
// SO_LABELS/PAY_LABELS ต้องตรงกับ frontend-admin/index.html (SO_LABELS/PAY_LABELS) และ backend/34_sales_status.gs
var SO_LABELS_ = { pending_delivery: 'รอสำนักงานจัดส่ง', delivering: 'กำลังจัดส่ง', completed: 'ส่งของแล้ว', cancelled: 'ยกเลิกแล้ว' };
var PAY_LABELS_ = { unpaid: 'ยังไม่ชำระ', partial: 'ชำระบางส่วน', paid: 'ชำระแล้ว' };

function answerSalesOrders_(query) {
  if (!query) return 'พิมพ์รหัสหรือชื่อลูกค้าต่อท้ายด้วยครับ เช่น "สถานะบิล C1001"';

  var found = findCustomer_(query);
  if (!found) return 'ไม่พบลูกค้ารหัสหรือชื่อ "' + query + '" ในระบบครับ';
  if (found.multiMatch) return found.multiMatch;
  var customer = found.customer;

  /* ★★ แก้ 21 ต.ค. 2026 — เดิมเขียน `customer.tenant_id || 'HOUSE'` แต่ **`HOUSE` เลิกใช้แล้ว กลายเป็น
     `TNKI`** (ดู CLAUDE.md หัวข้อ OWNER_TENANT_ID · migrate ด้วย `migrateOwnerTenantCode` ไปแล้ว)
     ลูกค้าขายตรงที่ `tenant_id` ยังว่างจึงไปหาแถว tenants ที่ไม่มีอยู่ แล้วตอบ "ดึงข้อมูลไม่สำเร็จ" ทุกครั้ง
     ★ ลองทั้งสองรหัสตามลำดับ (เหมือน `packageAllowedForTenant` ใน backend ที่ยอมรับทั้งคู่ไว้ชั่วคราว)
       เพราะข้อมูลเก่าบางไฟล์อาจยังเป็น HOUSE อยู่ และเราไม่อยากให้บอทพังเพราะลำดับ migrate */
  var candidates = customer.tenant_id ? [String(customer.tenant_id)] : ['TNKI', 'HOUSE'];
  var orders = null, lastErr = null, tenantId = candidates[0];
  for (var ci = 0; ci < candidates.length && orders === null; ci++) {
    try {
      tenantId = candidates[ci];
      orders = sheetObjects_(tenantSheet_(tenantId, 'sales_orders')).filter(function(o) {
        return String(o.customer_id) === String(customer.record_id);
      });
    } catch (err) { lastErr = err; }
  }
  if (orders === null) {
    console.error('answerSalesOrders_ error: ' + lastErr);
    return 'ดึงข้อมูลบิลขายของลูกค้า ' + customer.customer_code + ' ไม่สำเร็จครับ (ตัวแทน ' + candidates.join('/') + ')';
  }
  if (!orders.length) return 'ลูกค้า ' + customer.customer_code + ' ' + customer.name + ' ยังไม่มีบิลขายในระบบครับ';

  orders.sort(function(a, b) { return toDateSafe_(b.created_at) - toDateSafe_(a.created_at); });
  var recent = orders.slice(0, 5);

  var lines = recent.map(function(o) {
    var statusLabel = SO_LABELS_[o.status] || o.status || '-';
    var payLabel = PAY_LABELS_[o.payment_status] || o.payment_status || '-';
    return '• ' + o.order_code + ' (' + fmtDate_(o.created_at) + ') ' + formatMoney_(o.total) + ' บาท — ' + statusLabel + ' / ' + payLabel;
  });

  return 'บิลขายล่าสุดของ ' + customer.customer_code + ' ' + customer.name +
    (orders.length > recent.length ? ' (5 ใบล่าสุดจากทั้งหมด ' + orders.length + ' ใบ)' : '') + '\n' +
    lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * ของคงเหลือ: คลัง + บนรถ + รวม หน่วยลัง  (ย้ายมาจาก backend/58+59+60 เมื่อ 21 ต.ค. 2026)
 * เจ้าของระบบสั่ง: "มีคอลัมน์คลังหลักและคอลัมน์ของรวมบนรถ ทั้งคู่ มีช่องรวม หน่วยเป็นลัง"
 *
 * ★★ ของอยู่สองที่ คนละไฟล์ คนละความหมาย — ห้ามรวมเป็นตัวเดียวแล้วเรียกว่า "สต็อก"
 *   `warehouse_stock` (Central Sheet · แยกด้วย `tenant_id`) = ของในคลัง
 *   `van_stock`       (ไฟล์ของตัวแทน · แยกด้วย `line_user_id`) = ของบนรถพนักงาน รวมทุกคนเป็นก้อนเดียว
 *   ★ ขอบเขตของบริษัท: คลัง = `tenant_id` **ว่าง** แต่รถ = ไฟล์ของตัวแทนบ้าน **TNKI** — คนละค่ากันโดยตั้งใจ
 *
 * ★★ ทุกตัวเลขในชีตเป็นหน่วยฐาน (ชิ้น) · แปลงเป็นลังที่ `botCases_()` ที่เดียว จาก `product_units`
 *   สินค้าที่ยังไม่ยืนยันขนาดบรรจุ (factor ≤ 1 หรือชื่อหน่วยมีคำเตือน) **ไม่หารมั่ว** — คืนจำนวนชิ้น
 *   ติด `*` ในการ์ด และ **ไม่ถูกบวกเข้ายอดรวมลัง** (บวกชิ้นเข้าไปในลังคือตัวเลขที่ไม่มีความหมาย)
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

var BOT_INV_ROW_LIMIT = 15;     // แถวต่อการ์ด — มากกว่านี้การ์ดยาวเกินจอและเสี่ยงชนเพดานขนาดข้อความ
var BOT_QUICK_MAX = 13;         // เพดาน quick reply ของ LINE
var BOT_BUTTON_MAX = 12;        // ปุ่มในการ์ด (ใช้เมื่อตัวแทนเยอะเกิน quick reply)
var BOT_OWNER_TENANT = 'TNKI';  // = OWNER_TENANT_ID ใน backend/02_helpers.gs (เดิมคือ 'HOUSE')
var BOT_CASE_CODES = { CT: 1, CASE: 1, CS: 1, CTN: 1, 'หีบ': 1, 'ลัง': 1 };

/** ค่าในชีตเป็น boolean จริงก็ได้ สตริง 'TRUE' ก็ได้ — เทียบดิบๆ ไม่ได้ (บทเรียนเดิมของ backend) */
function botTrue_(v) {
  if (v === true) return true;
  var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y';
}

/** LINE user id → แถว admin_users (prod) ที่ใช้งานได้จริง · ไม่ผ่านด่าน = null */
function botAdminUser_(lineUserId) {
  var uid = String(lineUserId || '');
  if (!uid) return null;
  var found = null;
  sheetObjects_(prodSheet_('admin_users')).forEach(function(u) {
    if (String(u.line_user_id || '') === uid) found = u;
  });
  if (!found) return null;
  // ด่านเดียวกับหน้าล็อกอิน (_adminAccountGate ใน backend/30_admin_line_login.gs):
  // บัญชีที่เข้าเว็บไม่ได้ ต้องถามทางแชตไม่ได้ด้วย
  if (String(found.status) !== 'active') return null;
  if (!String(found.role_code || '').trim()) return null;
  return found;
}

/** สิทธิ์รายโมดูล — มิเรอร์ `hasPermission()` ใน backend/14_permissions.gs */
function botHasPermission_(admin, moduleCode, action) {
  if (!admin) return false;
  if (String(admin.role_code) === 'super_admin') return true;
  var rows = sheetObjects_(prodSheet_('role_permissions'));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].role_code) === String(admin.role_code) && String(rows[i].module_code) === String(moduleCode)) {
      return botTrue_(action === 'edit' ? rows[i].can_edit : rows[i].can_view);
    }
  }
  return false;
}

/** ตัวแทนที่ยังเปิดใช้งาน → { tenantId: ชื่อ } (รวมตัวแทนบ้านของบริษัทเอง ซึ่งก็มีคลังของตัวเอง) */
function botActiveTenants_() {
  var out = {};
  sheetObjects_(prodSheet_('tenants')).forEach(function(t) {
    if (botTrue_(t.is_active)) out[String(t.tenant_id)] = String(t.name || t.tenant_id);
  });
  return out;
}

/** ชื่อที่ควรแสดงของตัวแทนบ้าน = ชื่อบริษัท (ตรงกับที่แถบบนของแอปแอดมินแสดง) */
function botTenantLabel_(tenantId, name) {
  if (String(tenantId) !== BOT_OWNER_TENANT && String(tenantId) !== 'HOUSE') return name;
  try {
    var rows = sheetObjects_(prodSheet_('company_profile'));
    if (rows.length && String(rows[0].name || '').trim()) return String(rows[0].name).trim();
  } catch (err) {}
  return name || 'บริษัทเจ้าของสินค้า';
}

/**
 * ★★ มิเรอร์ของ `managedTenantIds()` ใน backend/57_user_tenants.gs — **แก้ที่นี่ต้องแก้ที่นั่นด้วย**
 * ลำดับตัดสิน: สังกัดตัวแทน → รายเดียวของตัวเองตลอด (ตาราง admin_user_tenants ไม่มีผลกับเขา) ·
 * super_admin → ทุกราย · ฝั่งบริษัทที่มีแถว → เฉพาะรายที่ระบุ · ฝั่งบริษัทที่ไม่มีแถว → ทุกราย
 * ★ ว่าง = "ทุกราย" ไม่ใช่ "ไม่มีใคร" — ตารางนี้เป็นตัวกรองรายการ ไม่ใช่การมอบสิทธิ์
 */
function botManagedTenantIds_(admin) {
  if (!admin) return [];
  var own = String(admin.tenant_id || '');
  if (own && own !== BOT_OWNER_TENANT && own !== 'HOUSE') return [own];

  var active = botActiveTenants_();
  var all = Object.keys(active);
  if (String(admin.role_code) === 'super_admin') return all;

  var id = String(admin.record_id || '');
  var rows = [];
  try { rows = sheetObjects_(prodSheet_('admin_user_tenants')); }
  catch (err) { return all; }   // ยังไม่มีแท็บนี้ (ยังไม่ได้ deploy backend ใหม่) = ยังไม่เคยตั้งค่า
  var seen = {}, mine = [];
  rows.forEach(function(r) {
    if (String(r.admin_user_id) !== id) return;
    var t = String(r.tenant_id);
    if (active[t] === undefined || seen[t]) return;    // ปิดใช้งานแล้ว/ซ้ำ ไม่ต้องโผล่
    seen[t] = 1; mine.push(t);
  });
  return mine.length ? mine : all;
}

function botManagedTenants_(admin) {
  var active = botActiveTenants_();
  var out = botManagedTenantIds_(admin).map(function(t) {
    var isOwner = (t === BOT_OWNER_TENANT || t === 'HOUSE');
    return { tenantId: t, name: botTenantLabel_(t, active[t] || t), isOwner: isOwner };
  });
  out.sort(function(a, b) {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'th');
  });
  return out;
}

/** productId → { factor, confirmed } ของหน่วย "ลัง" (รหัสเก่า CASE/หีบ ยังนับเป็นลัง) */
function botCaseUnits_() {
  var out = {};
  sheetObjects_(prodSheet_('product_units')).forEach(function(u) {
    if (!botTrue_(u.is_active)) return;
    // รหัสที่ถือว่าเป็น "ลัง" — ชุดเดียวกับ UNIT_ALIASES ฝั่ง CT ใน backend/28_units.gs
    // (ข้อมูลเก่ายังมี CASE/CS/CTN/หีบ/ลัง ปนอยู่ ก่อน migrateUnitCodes จะรันครบ)
    var code = String(u.unit_code || '').trim().toUpperCase();
    var label = String(u.unit_label || '');
    if (!BOT_CASE_CODES[code]) return;
    var factor = parseFloat(u.unit_factor) || 0;
    out[String(u.product_id)] = {
      factor: factor,
      // ขนาดบรรจุ 1 = ค่าที่ ensureDefaultSalesUnit ใส่ไว้ตอนยังไม่รู้ของจริง (ชื่อหน่วยมีคำเตือนต่อท้าย)
      confirmed: factor > 1 && label.indexOf('ยังไม่ยืนยัน') === -1
    };
  });
  return out;
}

function botCases_(baseQty, unit) {
  var q = Number(baseQty) || 0;
  if (!unit || !unit.confirmed || !(unit.factor > 1)) return q;
  return Math.round((q / unit.factor) * 100) / 100;
}

/** อ่าน van_stock ของตัวแทน (ตัวแทนบ้านลองทั้ง TNKI และ HOUSE เพราะข้อมูลเก่าบางไฟล์ยังเป็น HOUSE) */
function botVanRows_(tenantId) {
  var candidates = (tenantId === BOT_OWNER_TENANT || tenantId === 'HOUSE') ? [BOT_OWNER_TENANT, 'HOUSE'] : [tenantId];
  for (var i = 0; i < candidates.length; i++) {
    try { return sheetObjects_(tenantSheet_(candidates[i], 'van_stock')); }
    catch (err) { /* ลองรหัสถัดไป */ }
  }
  return null;   // อ่านไม่ได้จริงๆ — คนละเรื่องกับ "รถว่าง"
}

/**
 * ภาพรวมของคงเหลือของตัวแทนรายหนึ่ง (อ่าน prod เหมือนคำสั่งอื่นของบอท)
 * @param limit จำนวนแถวที่คืน · ไม่ส่ง = ตามเพดานของการ์ด (15) · **0 = ทุกแถว** (ใช้กับหน้ารายงานที่พิมพ์)
 */
function botInventorySnapshot_(tenantId, limit) {
  var tid = String(tenantId || '') || BOT_OWNER_TENANT;
  var isOwner = (tid === BOT_OWNER_TENANT || tid === 'HOUSE');
  var whScope = isOwner ? '' : tid;        // ★ คลังของบริษัท = tenant_id ว่าง

  var active = botActiveTenants_();
  var tenantName = botTenantLabel_(tid, active[tid] || tid);

  var products = {};
  sheetObjects_(prodSheet_('products')).forEach(function(p) { products[String(p.record_id)] = p; });
  var units = botCaseUnits_();

  var acc = {};
  function bucket(pid) {
    var k = String(pid);
    if (!acc[k]) acc[k] = { wh: 0, van: 0 };
    return acc[k];
  }
  sheetObjects_(prodSheet_('warehouse_stock')).forEach(function(r) {
    if (String(r.tenant_id || '') !== whScope) return;
    bucket(r.product_id).wh += Number(r.qty) || 0;
  });

  var vanRows = botVanRows_(tid), vanStaff = 0, seenStaff = {};
  (vanRows || []).forEach(function(r) {
    if (!String(r.product_id || '').trim()) return;
    var qty = Number(r.qty) || 0;
    bucket(r.product_id).van += qty;
    var who = String(r.line_user_id || '');
    if (who && qty !== 0 && !seenStaff[who]) { seenStaff[who] = 1; vanStaff++; }
  });

  var rows = [];
  Object.keys(acc).forEach(function(pid) {
    var p = products[pid], u = units[pid];
    var wh = acc[pid].wh, van = acc[pid].van;
    if (wh + van === 0) return;            // ของที่หมดทั้งคลังและรถ ไม่ต้องรายงาน
    rows.push({
      productCode: p ? String(p.product_code || '') : pid,
      productName: p ? String(p.name || '') : '(สินค้าถูกลบ)',
      confirmed: !!(u && u.confirmed),
      warehouseBase: wh, vanBase: van, totalBase: wh + van,
      warehouse: botCases_(wh, u), van: botCases_(van, u), total: botCases_(wh + van, u)
    });
  });
  // ★ เรียงด้วยหน่วยฐาน ไม่ใช่ลัง — แถวที่ยังไม่ยืนยันขนาดบรรจุมีหน่วยคนละอย่าง เอามาเรียงปนกันจะได้ลำดับที่อธิบายไม่ได้
  rows.sort(function(a, b) {
    if (b.totalBase !== a.totalBase) return b.totalBase - a.totalBase;
    return String(a.productCode).localeCompare(String(b.productCode));
  });

  var totals = { warehouse: 0, van: 0, total: 0 }, unconfirmed = 0;
  rows.forEach(function(r) {
    if (r.confirmed) { totals.warehouse += r.warehouse; totals.van += r.van; totals.total += r.total; }
    else unconfirmed++;
  });
  ['warehouse', 'van', 'total'].forEach(function(k) { totals[k] = Math.round(totals[k] * 100) / 100; });

  var all = rows.length;
  var cap = (limit === undefined) ? BOT_INV_ROW_LIMIT : (parseInt(limit, 10) || 0);
  if (cap > 0) rows = rows.slice(0, cap);
  return { tenantId: tid, tenantName: tenantName, rows: rows,
    shown: rows.length, products: all, totals: totals,
    vanAvailable: vanRows !== null, vanStaff: vanStaff, unconfirmed: unconfirmed,
    asOf: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm') };
}

/** คำสั่ง "ของคงเหลือ" — คืน array ของ message object (Flex หรือข้อความบอกเหตุ) */
function botInventoryMessages_(lineUserId, arg) {
  var admin = botAdminUser_(lineUserId);
  if (!admin) {
    return [{ type: 'text', text: 'คำสั่งนี้ต้องใช้บัญชีแอดมินที่ผูก LINE ไว้กับระบบครับ\n' +
      'ให้ผู้ดูแลผูก LINE ของคุณกับบัญชีแอดมินที่เมนู "บัญชีผู้ใช้งาน" ก่อน\n' +
      '(คำสั่งอื่นยังใช้ได้ปกติ — พิมพ์ "ช่วยเหลือ")' }];
  }
  if (!botHasPermission_(admin, 'inventory', 'view')) {
    return [{ type: 'text', text: 'บัญชีนี้ยังไม่มีสิทธิ์ดูเมนูคลังสินค้าครับ — ให้ผู้ดูแลเปิดสิทธิ์ "คลังสินค้า" ให้บทบาทของคุณก่อน' }];
  }

  var list = botManagedTenants_(admin);
  if (!list.length) return [{ type: 'text', text: 'ยังไม่มีตัวแทนที่คุณดูแลอยู่ครับ — ให้ผู้ดูแลระบบตั้งผู้รับผิดชอบให้ก่อน' }];

  var want = String(arg || '').trim();
  if (want) {
    var hit = botMatchTenant_(list, want);
    if (!hit) {
      return [{ type: 'text', text: 'ไม่พบตัวแทน "' + want + '" ในรายการที่คุณดูแลครับ\n\nรายที่ดูแลอยู่:\n' +
        list.map(function(t) { return '• ' + t.tenantId + ' — ' + t.name; }).join('\n') }];
    }
    return [botInventoryFlex_(hit.tenantId, lineUserId)];
  }
  if (list.length === 1) return [botInventoryFlex_(list[0].tenantId, lineUserId)];
  return [botTenantPicker_(list)];
}

/** เทียบรหัสก่อน (ไม่สนตัวพิมพ์) แล้วค่อยเทียบชื่อแบบมีคำนั้นอยู่ — ชื่อตรงหลายรายถือว่าไม่ชัด */
function botMatchTenant_(list, want) {
  var w = want.toLowerCase();
  for (var i = 0; i < list.length; i++) if (String(list[i].tenantId).toLowerCase() === w) return list[i];
  var byName = list.filter(function(t) { return String(t.name).toLowerCase().indexOf(w) !== -1; });
  return byName.length === 1 ? byName[0] : null;
}

function botInventoryFlex_(tenantId, lineUserId) {
  var snap = botInventorySnapshot_(tenantId);
  var alt = 'ของคงเหลือ ' + snap.tenantName + ' — รวม ' + botNum_(snap.totals.total) + ' ลัง (คลัง ' +
    botNum_(snap.totals.warehouse) + ' · รถ ' + botNum_(snap.totals.van) + ')';
  return { type: 'flex', altText: alt.substring(0, 400),
    contents: botFlexInventory_(snap, botReportLink_(tenantId, lineUserId)) };
}

/* ── Flex: การ์ดของคงเหลือ ──
   สีชุดเดียวกับแอปแอดมิน (frontend-admin/index.html): ฟ้า #2B63D9 · หมึก #0F1B2D · หมึกอ่อน #5B6B84 */
var BOT_INK = '#0F1B2D', BOT_INK_SOFT = '#5B6B84', BOT_BLUE = '#2B63D9', BOT_LINE_CLR = '#E4E9F1';

/** ตัวเลขอ่านง่าย: มีคอมมา · ทศนิยมเฉพาะเมื่อมีเศษ (13 · 13.5 · 12,840.25) */
function botNum_(n) {
  var v = Math.round((Number(n) || 0) * 100) / 100;
  var neg = v < 0; v = Math.abs(v);
  var whole = Math.floor(v), frac = Math.round((v - whole) * 100);
  var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac) {
    var f = frac < 10 ? ('0' + frac) : String(frac);
    if (f.charAt(1) === '0') f = f.charAt(0);     // .50 → .5
    s += '.' + f;
  }
  return (neg ? '-' : '') + s;
}

function botFlexText_(text, opts) {
  var t = { type: 'text', text: String(text === null || text === undefined ? '' : text) };
  Object.keys(opts || {}).forEach(function(k) { t[k] = opts[k]; });
  return t;
}

/* ★ แถวตาราง **2 ช่อง**: รหัสสินค้า | คลัง + รถ = รวม  (เจ้าของระบบสั่ง 21 ต.ค. 2026 หลังทดสอบจริง)
   เดิมเป็น 4 ช่อง (ชื่อสินค้า | คลัง | รถ | รวม) — บนจอมือถือชื่อสินค้ายาวกินที่จนตัวเลขเบียดกัน
   · รหัสสินค้าสั้นและเป็นตัวที่คนใช้สั่งของจริง · ตัวเลขสามตัวยุบมาอยู่ช่องเดียวโดย**ไม่ทิ้งข้อมูล**
     เขียนเป็น "คลัง + รถ = รวม" ซึ่งอ่านได้ในตัวเองว่าตัวไหนคืออะไร ไม่ต้องพึ่งหัวตาราง
   · ใช้ span ให้ยอดรวมเป็นสีฟ้าตัวหนา ส่วนตัวแยกเป็นสีอ่อน — ตาจับ "รวม" ได้ก่อน */
function botFlexRow_(code, nums, opts) {
  opts = opts || {};
  var size = opts.size || 'sm', color = opts.color || BOT_INK, weight = opts.bold ? 'bold' : 'regular';
  var right = { type: 'text', flex: 6, align: 'end', size: size, wrap: !!opts.wrap, color: color, weight: weight };
  if (!opts.wrap) right.maxLines = 1;
  if (typeof nums === 'string') right.text = nums;
  else right.contents = nums;          // span: [แยก, รวม]
  return { type: 'box', layout: 'horizontal', spacing: 'xs', contents: [
    botFlexText_(code, { size: size, color: color, weight: weight, flex: 4, wrap: false, maxLines: 1 }),
    right
  ] };
}

/** "10.5 + 3 = 13.5" แบบ span — ตัวแยกสีอ่อน ยอดรวมสีฟ้าตัวหนา */
function botFlexNums_(wh, van, total, opts) {
  opts = opts || {};
  return [
    { type: 'span', text: botNum_(wh) + ' + ' + botNum_(van) + ' = ', size: opts.size || 'sm', color: BOT_INK_SOFT },
    { type: 'span', text: botNum_(total), size: opts.size || 'sm', color: opts.totalColor || BOT_BLUE, weight: 'bold' }
  ];
}

function botFlexInventory_(snap, reportUrl) {
  var body = [
    botFlexRow_('รหัสสินค้า', 'คลัง + รถ = รวม', { size: 'xs', color: BOT_INK_SOFT, bold: true }),
    { type: 'separator', margin: 'sm', color: BOT_LINE_CLR }
  ];
  if (!snap.rows.length) {
    body.push(botFlexText_('ไม่มีของคงเหลือในคลังและบนรถ', { size: 'sm', color: BOT_INK_SOFT, margin: 'md', wrap: true }));
  } else {
    snap.rows.forEach(function(r) {
      // ★ ดอกจันนำหน้ารหัส = ยังไม่ยืนยันขนาดบรรจุ ตัวเลขแถวนั้นเป็น "ชิ้น" ไม่ใช่ "ลัง" (เชิงอรรถท้ายการ์ด)
      body.push(botFlexRow_((r.confirmed ? '' : '*') + r.productCode,
        botFlexNums_(r.warehouse, r.van, r.total)));
    });
  }

  var footer = [
    { type: 'separator', color: BOT_LINE_CLR },
    // ยอดรวมทุกแถวอาจยาวกว่าแถวข้อมูล → ให้ตัดบรรทัดได้ ดีกว่าถูกตัดท้ายทิ้ง
    botFlexRow_('รวมทั้งหมด (ลัง)', botFlexNums_(snap.totals.warehouse, snap.totals.van, snap.totals.total),
      { bold: true, wrap: true })
  ];
  var notes = [];
  if (snap.products > snap.shown) notes.push('แสดง ' + snap.shown + ' จาก ' + snap.products + ' รายการ (เรียงตามของรวมมากสุด)');
  if (snap.unconfirmed) notes.push('* ' + snap.unconfirmed + ' รายการยังไม่ยืนยันขนาดบรรจุ — ตัวเลขเป็นชิ้น ไม่ได้รวมในยอดลัง');
  if (!snap.vanAvailable) notes.push('อ่านของบนรถไม่ได้ (ยังไม่มีไฟล์ของตัวแทนรายนี้) — ช่องรถจึงเป็น 0');
  else if (snap.vanStaff) notes.push('ของบนรถรวมจากพนักงาน ' + snap.vanStaff + ' คน');
  notes.forEach(function(n) { footer.push(botFlexText_(n, { size: 'xxs', color: BOT_INK_SOFT, wrap: true, margin: 'sm' })); });

  /* ★ ปุ่มพิมพ์รายงาน (เจ้าของระบบสั่ง 21 ต.ค. 2026) — การ์ดในแชตโชว์ได้ 15 แถว แต่รายงานที่พิมพ์
     เอาทุกแถว + ชื่อสินค้า + แยกคอลัมน์ครบ · LINE ส่งไฟล์ให้บอทไม่ได้ (ไม่มีชนิดข้อความแบบไฟล์)
     จึงเป็นลิงก์เปิดหน้าเว็บที่ใช้ `DocPrint` ตัวเดียวกับแอปแอดมิน แล้วผู้ใช้กด "พิมพ์ → Save as PDF"
     ★ ป้ายปุ่มต้องไม่เกิน 20 ตัวอักษร (เพดานของ LINE) · ไม่มี URL = ไม่ใส่ปุ่ม ดีกว่าปุ่มที่กดแล้วพัง */
  if (reportUrl) {
    footer.push({ type: 'button', style: 'primary', color: BOT_BLUE, height: 'sm', margin: 'md',
      action: { type: 'uri', label: 'พิมพ์รายงาน (PDF)', uri: reportUrl } });
  }

  return {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: BOT_BLUE, paddingAll: '14px', spacing: 'xs', contents: [
      botFlexText_('ของคงเหลือ · หน่วยลัง', { size: 'xs', color: '#C9DAFB' }),
      botFlexText_(snap.tenantName || snap.tenantId, { size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true }),
      botFlexText_('ณ ' + snap.asOf, { size: 'xxs', color: '#C9DAFB' })
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: footer }
  };
}

/** เมนูเลือกตัวแทน — quick reply ถ้าไม่เกิน 13 ราย ไม่งั้นใช้ปุ่มในการ์ด */
function botTenantPicker_(tenants) {
  var head = 'เลือกตัวแทนที่ต้องการดูของคงเหลือ';
  if (tenants.length <= BOT_QUICK_MAX) {
    return { type: 'text', text: head, quickReply: { items: tenants.map(function(t) {
      return { type: 'action', action: { type: 'postback', label: botCut_(t.name, 20),
        data: 'cmd=inv&t=' + encodeURIComponent(t.tenantId), displayText: 'ของคงเหลือ: ' + t.name } };
    }) } };
  }
  var shown = tenants.slice(0, BOT_BUTTON_MAX);
  var contents = [botFlexText_(head, { size: 'sm', color: BOT_INK, wrap: true, weight: 'bold' })];
  shown.forEach(function(t) {
    contents.push({ type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
      action: { type: 'postback', label: botCut_(t.name, 20),
        data: 'cmd=inv&t=' + encodeURIComponent(t.tenantId), displayText: 'ของคงเหลือ: ' + t.name } });
  });
  contents.push(botFlexText_('อีก ' + (tenants.length - shown.length) + ' ราย — พิมพ์ "ของคงเหลือ <รหัสตัวแทน>"',
    { size: 'xxs', color: BOT_INK_SOFT, wrap: true, margin: 'md' }));
  return { type: 'flex', altText: head, contents: {
    type: 'bubble', size: 'mega', body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: contents } } };
}

/** ป้าย quick reply เกิน 20 ตัวอักษร LINE ปฏิเสธทั้งก้อน */
function botCut_(s, n) {
  var t = String(s || '');
  return t.length <= n ? t : (t.substring(0, n - 1) + '…');
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * หน้ารายงานสำหรับพิมพ์ — ปุ่ม "พิมพ์รายงาน (PDF)" ท้ายการ์ด (เจ้าของระบบสั่ง 21 ต.ค. 2026)
 *
 * ★★ ทำไมเป็น "ลิงก์หน้าเว็บ" ไม่ใช่ไฟล์ PDF แนบไปในแชต
 *   1. **LINE ไม่มีชนิดข้อความแบบไฟล์เอกสารสำหรับบอท** (มีแต่ text/image/video/audio/location/
 *      imagemap/template/flex) — บอทแนบ .pdf ส่งให้ไม่ได้เลย ไม่ว่าจะทำไฟล์ได้หรือไม่
 *   2. ทำ PDF ไว้บน Drive แล้วส่งลิงก์ก็ได้ แต่ติดนโยบายแชร์ลิงก์ของ Workspace (ถ้าองค์กรปิด
 *      "ทุกคนที่มีลิงก์" คนใน LINE จะเปิดไม่ได้เลย) · ต้องมีกติกาลบไฟล์เก่าทิ้ง · และสร้างไฟล์ช้าเกิน
 *      เวลาที่ตอบ reply ทัน ต้องตอบก่อนแล้ว push ลิงก์ตามทีหลัง (กินโควตาข้อความ)
 *   3. ทางนี้ไม่แตะ Drive ไม่กินโควตา และ **ใช้ตัวพิมพ์กลางตัวเดียวกับแอปแอดมิน**
 *      (`frontend-admin/doc-print.js` → `DocPrint.table`) จึงได้เอกสารหน้าตาชุดเดียวกับที่พิมพ์จากแอป
 *      ตรงกับกติกาในโปรเจกต์: "ห้ามเขียนตัวพิมพ์ใหม่ต่อหน้า ให้ส่งข้อมูลเข้าตัวกลางแทน"
 *
 * ★ ลิงก์พก token ที่เก็บใน CacheService **อายุ 30 นาที** — เปิดได้โดยไม่ต้องล็อกอิน เพราะคนใน LINE
 *   ไม่มีบัญชี Google ของบริษัท · **ใครได้ลิงก์ในช่วงนั้นก็เปิดได้** ซึ่งเท่ากับความเปิดของการ์ดเองอยู่แล้ว
 *   (ในแชทกลุ่ม ทั้งกลุ่มเห็นการ์ดและปุ่ม) · token ผูกกับตัวแทนรายที่ขอ จึงข้ามไปดูรายอื่นไม่ได้
 * ★ หน้านี้ดึงข้อมูล **สดตอนเปิด** ไม่ใช่ภาพนิ่งตอนกดปุ่ม — เวลาที่พิมพ์บนหัวรายงานจึงตรงกับของที่เห็น
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

var BOT_REPORT_TTL_SEC = 1800;          // 30 นาที
var BOT_REPORT_PREFIX = 'botrpt_';
/* ★ โหลดตัวพิมพ์กลางจากเว็บแอดมินฝั่ง prod (บอทอ่านข้อมูล prod) — **Cloudflare Pages ไม่ใช่ GitHub Pages**
   (github.io เหลือไว้เป็นหน้าแจ้งย้ายแล้ว ตอบ 404 ให้ไฟล์ — เช็คแล้ว 21 ต.ค. 2026)
   **แก้ doc-print.js แล้วต้องบัมป์ `?v=` ที่นี่ด้วย** ไม่งั้นเบราว์เซอร์เสิร์ฟของเก่า */
var BOT_DOCPRINT_URL = 'https://ranger-topsales-admin.pages.dev/doc-print.js?v=20261021';

/** URL ของ web app ตัวเอง · ตั้ง Script Property `BOT_WEB_URL` ทับได้ถ้า getUrl() ให้ค่าที่ไม่ต้องการ */
function botWebUrl_() {
  var p = PropertiesService.getScriptProperties().getProperty('BOT_WEB_URL');
  if (p) return String(p);
  try { return ScriptApp.getService().getUrl() || ''; }
  catch (err) { console.error('botWebUrl_: หา URL ของ web app ไม่ได้ (' + err + ')'); return ''; }
}

/** ออกลิงก์รายงานของตัวแทนรายหนึ่ง · คืน '' ถ้าออกให้ไม่ได้ (การ์ดจะไม่ใส่ปุ่มเลย ดีกว่าปุ่มที่กดแล้วพัง) */
function botReportLink_(tenantId, lineUserId) {
  var base = botWebUrl_();
  if (!base) return '';
  var token = Utilities.getUuid().replace(/-/g, '');
  try {
    CacheService.getScriptCache().put(BOT_REPORT_PREFIX + token,
      JSON.stringify({ t: String(tenantId), u: String(lineUserId || '') }), BOT_REPORT_TTL_SEC);
  } catch (err) {
    console.error('botReportLink_: เก็บ token ไม่ได้ (' + err + ')');
    return '';
  }
  // openExternalBrowser=1 = บอกเบราว์เซอร์ในแอป LINE ให้เปิดด้วยเบราว์เซอร์จริงของเครื่อง
  // (ในเบราว์เซอร์ของ LINE สั่งพิมพ์/บันทึก PDF ไม่ได้)
  return base + '?r=' + encodeURIComponent(token) + '&openExternalBrowser=1';
}

function doGet(e) {
  var token = (e && e.parameter && e.parameter.r) ? String(e.parameter.r) : '';
  if (!token) {
    return botSimplePage_('ต้องขอลิงก์จากบอท',
      'เปิดหน้านี้ได้จากปุ่ม "พิมพ์รายงาน (PDF)" ในแชตของบอทเท่านั้น');
  }
  var raw = null;
  try { raw = CacheService.getScriptCache().get(BOT_REPORT_PREFIX + token); } catch (err) {}
  if (!raw) {
    return botSimplePage_('ลิงก์หมดอายุแล้ว',
      'ลิงก์รายงานมีอายุ 30 นาที — พิมพ์ "ของคงเหลือ" ในแชตเพื่อขอลิงก์ใหม่ได้เลย');
  }
  try {
    var ref = JSON.parse(raw);
    var snap = botInventorySnapshot_(ref.t, 0);     // 0 = เอาทุกแถว ไม่ใช่ 15 แถวแบบในการ์ด
    return HtmlService.createHtmlOutput(botReportHtml_(snap))
      .setTitle('รายงานของคงเหลือ ' + snap.tenantName)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    console.error('doGet error: ' + (err && err.stack || err));
    return botSimplePage_('เปิดรายงานไม่สำเร็จ', 'ลองใหม่อีกครั้ง หรือแจ้งแอดมิน (' + err.message + ')');
  }
}

function botHtmlEsc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var BOT_PAGE_FONT = "'Sarabun',-apple-system,'Segoe UI',sans-serif";

function botSimplePage_(title, detail) {
  var html = '<!doctype html><meta charset="utf-8"><title>' + botHtmlEsc_(title) + '</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet">' +
    '<div style="font-family:' + BOT_PAGE_FONT + ';max-width:30em;margin:18vh auto;padding:0 20px;color:#0F1B2D">' +
    '<h1 style="font-size:20px;margin:0 0 10px">' + botHtmlEsc_(title) + '</h1>' +
    '<p style="margin:0;color:#5B6B84;line-height:1.7">' + botHtmlEsc_(detail) + '</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** spec ที่ส่งเข้า DocPrint.table — แยกออกมาเพื่อเทสต์ได้โดยไม่ต้องแกะ HTML */
function botReportSpec_(snap) {
  var notes = [];
  if (snap.unconfirmed) notes.push('* ' + snap.unconfirmed + ' รายการยังไม่ยืนยันขนาดบรรจุ — ตัวเลขเป็นชิ้น ไม่ได้รวมในยอดลัง');
  if (!snap.vanAvailable) notes.push('อ่านของบนรถไม่ได้ (ยังไม่มีไฟล์ของตัวแทนรายนี้) — ช่องบนรถจึงเป็น 0');
  else if (snap.vanStaff) notes.push('ของบนรถรวมจากพนักงาน ' + snap.vanStaff + ' คน');
  notes.push('คลัง = ของในคลังของตัวแทนรายนี้ · บนรถ = รวมของบนรถพนักงานทุกคน');

  return {
    title: 'รายงานของคงเหลือ',
    subtitle: snap.tenantName + ' · ณ ' + snap.asOf,
    issuerName: botTenantLabel_(BOT_OWNER_TENANT, ''),
    printedAt: snap.asOf,
    columns: [
      { label: 'รหัสสินค้า', key: 'code', width: 1.2 },
      { label: 'ชื่อสินค้า', key: 'name', width: 3.4 },
      { label: 'คลัง', key: 'wh', align: 'r', width: 1 },
      { label: 'บนรถ', key: 'van', align: 'r', width: 1 },
      { label: 'รวม', key: 'total', align: 'r', width: 1 },
      { label: 'หน่วย', key: 'unit', width: 0.8 }
    ],
    rows: snap.rows.map(function(r) {
      return {
        code: (r.confirmed ? '' : '*') + r.productCode,
        name: r.productName,
        wh: botNum_(r.warehouse), van: botNum_(r.van), total: botNum_(r.total),
        unit: r.confirmed ? 'ลัง' : 'ชิ้น'
      };
    }),
    // ยอดรวมนับเฉพาะแถวที่ยืนยันขนาดบรรจุแล้ว (บวกชิ้นเข้าไปในลังคือตัวเลขที่ไม่มีความหมาย)
    totals: [
      ['รวมในคลัง (ลัง)', botNum_(snap.totals.warehouse)],
      ['รวมบนรถ (ลัง)', botNum_(snap.totals.van)],
      ['รวมทั้งหมด (ลัง)', botNum_(snap.totals.total), 'grand']
    ],
    note: notes.join(' · '),
    landscape: false,
    filename: 'inventory-' + snap.tenantId + '-' + String(snap.asOf).substring(0, 10)
  };
}

function botReportHtml_(snap) {
  var spec = botReportSpec_(snap);
  // ★ กัน `</script>` ที่อาจหลุดมาจากชื่อสินค้าปิด block ก่อนเวลา
  var json = JSON.stringify(spec).replace(/</g, '\\u003c');
  var head = spec.columns.map(function(c) { return '<th>' + botHtmlEsc_(c.label) + '</th>'; }).join('');
  var body = spec.rows.map(function(r) {
    return '<tr>' + spec.columns.map(function(c) { return '<td>' + botHtmlEsc_(r[c.key]) + '</td>'; }).join('') + '</tr>';
  }).join('');

  /* ★ ตารางธรรมดาถูกเขียนลงหน้าไว้เสมอ แล้วให้ overlay ของ DocPrint ทับ —
     โหลดสคริปต์จาก GitHub Pages ไม่สำเร็จ (เน็ตผู้ใช้/Pages ล่ม) ก็ยังเห็นข้อมูลและสั่งพิมพ์ได้
     ไม่ใช่หน้าขาวที่อธิบายไม่ได้ */
  return '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + botHtmlEsc_(spec.title) + ' ' + botHtmlEsc_(snap.tenantName) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>' +
    ':root{--doc-fs:10px}' +
    'body{margin:0;background:#8891a3;font-family:' + BOT_PAGE_FONT + ';color:#0F1B2D}' +
    '#dp-close{display:none}' +            /* หน้านี้ไม่มีอะไรให้ย้อนกลับไป ปิดแล้วเหลือหน้าว่าง */
    '.fb{max-width:900px;margin:0 auto;padding:16px;background:#fff}' +
    '.fb h1{font-size:17px;margin:0 0 2px}.fb p{margin:0 0 12px;color:#5B6B84;font-size:12.5px}' +
    '.fb table{border-collapse:collapse;width:100%;font-size:12px}' +
    '.fb th,.fb td{border:1px solid #D7DEE8;padding:4px 6px;text-align:left}' +
    '.fb th{background:#F1F5FA}' +
    '.fb thead{display:table-header-group}' +            /* พิมพ์หลายหน้าให้หัวตารางซ้ำทุกหน้า */
    '@page{size:A4;margin:12mm}' +
    '</style>' +
    '<div class="fb"><h1>' + botHtmlEsc_(spec.title) + ' — ' + botHtmlEsc_(spec.subtitle) + '</h1>' +
    '<p>กำลังจัดหน้าเอกสาร… ถ้าหน้าจัดเสร็จ จะมีปุ่ม "พิมพ์" ขึ้นด้านบน (ถ้าไม่ขึ้น พิมพ์หน้านี้ได้เลย)</p>' +
    '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    '<script>var SPEC=' + json + ';<\/script>' +
    '<script src="' + BOT_DOCPRINT_URL + '"><\/script>' +
    '<script>window.addEventListener("load",function(){' +
    'if(window.DocPrint&&window.DocPrint.table){try{DocPrint.table(SPEC);}catch(e){}}});<\/script>';
}

function toDateSafe_(v) { return v instanceof Date ? v : new Date(v); }
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd') : String(v || '').substring(0, 10); }

function formatMoney_(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── liff_users: line_user_id, display_name, role, tenant_id, status, last_login (ต้องตรงกับ backend/00_setup_sheets.gs) ──
// เช็ค prod กับ uat แยกอิสระต่อกัน — ไฟล์ไหนมีแถวอยู่แล้วก็ข้ามไฟล์นั้น ไม่ทับสถานะที่แอดมินอนุมัติไว้แล้ว
// แยก try/catch ต่อไฟล์โดยตั้งใจ — UAT เป็นแค่สำเนาสำรองตัวตน ถ้าเขียนพัง (เช่น CENTRAL_SHEET_FILEID_UAT
// ผิด/เข้าไม่ถึง) ต้องไม่ทำให้การตอบผู้ใช้จริง (ซึ่งอ่าน/เขียนที่ prod) ล้มไปด้วย — เคยพลาดตรงนี้มาก่อน:
// รวมสองบรรทัดไว้โดยไม่ครอบ try/catch แยก ทำให้ exception จาก UAT ทำให้ทั้ง handleMessage_/handleFollow_
// จบก่อนถึง replyMessage_ เลย กลายเป็น "บอทอ่านแต่ไม่ตอบอะไรเลย" ทั้งที่ prod ใช้งานได้ปกติ
function ensureLiffUser_(lineUserId) {
  // เรียก Get Profile API แค่ตอนจะสร้างแถวใหม่จริงๆ (lazy + memoize กันยิงซ้ำถ้าต้องสร้างทั้ง prod และ uat)
  // ไม่งั้นทุกข้อความที่ผู้ใช้เดิมพิมพ์เข้ามาจะยิง Get Profile API ทิ้งเปล่าๆ ทั้งที่ไม่เคยใช้ผลลัพธ์เลย
  var cachedName = null, fetched = false;
  function getName() {
    if (!fetched) { cachedName = fetchLineDisplayName_(lineUserId); fetched = true; }
    return cachedName;
  }
  var createdProd = false, createdUat = false;
  try {
    createdProd = ensureLiffUserInSheet_(prodSheet_('liff_users'), lineUserId, getName);
  } catch (err) {
    console.error('ensureLiffUser_ (prod) error: ' + err);
  }
  try {
    createdUat = ensureLiffUserInSheet_(uatSheet_('liff_users'), lineUserId, getName);
  } catch (err) {
    console.error('ensureLiffUser_ (uat) error: ' + err);
  }
  return createdProd || createdUat;
}

function ensureLiffUserInSheet_(sh, lineUserId, getDisplayName) {
  if (findLiffUser_(sh, lineUserId)) return false;
  appendRowByHeader_(sh, {
    line_user_id: lineUserId,
    display_name: getDisplayName() || '',
    role: 'รออนุมัติ',
    tenant_id: '',
    status: 'No',
    last_login: new Date()
  });
  return true;
}

// รัน**เองครั้งเดียว**จาก editor (Run → runBackfillMissingFollowers) เมื่อสงสัยว่ามีคนเพิ่มเพื่อนแล้วแต่ไม่มีแถวใน
// liff_users — สาเหตุปกติคือ follow event หลุดไปตอน webhook ยังใช้งานไม่ได้ (เช่นตอน deployment settings ยังผิด)
// LINE จะไม่ส่ง follow event ซ้ำให้อีกตราบใดที่ยังเป็นเพื่อนกันอยู่ ต้องไล่ดึงจาก Get Follower IDs API มาเทียบเอง
//
// ★ ฟังก์ชันจริงลงท้ายด้วย "_" (ตั้งใจ — เป็น private helper ตามธรรมเนียมเดิม) แต่ Apps Script จะซ่อนฟังก์ชันที่
// ลงท้ายด้วย "_" ออกจาก dropdown "Select function to run" ในหน้า editor โดยอัตโนมัติ (กันฟังก์ชันภายในโผล่
// ปนกับของที่ตั้งใจให้เรียกได้ตอนใช้เป็น library) — runBackfillMissingFollowers() ด้านล่างจึงมีไว้เป็นทางเข้า
// สาธารณะทางเดียวสำหรับกดรันจาก editor เท่านั้น ตัวมันเองไม่มีเนื้อหาอะไร แค่เรียกของจริงต่อ
function runBackfillMissingFollowers() { backfillMissingFollowers_(); }

function backfillMissingFollowers_() {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { console.error('backfillMissingFollowers_: ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN'); return; }

  var ids = [];
  var start = '';
  do {
    var url = 'https://api.line.me/v2/bot/followers/ids?limit=300' + (start ? '&start=' + encodeURIComponent(start) : '');
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      console.error('backfillMissingFollowers_: followers/ids ตอบ ' + res.getResponseCode() + ': ' + res.getContentText());
      break;
    }
    var body = JSON.parse(res.getContentText());
    ids = ids.concat(body.userIds || []);
    start = body.next || '';
  } while (start);

  var createdCount = 0;
  ids.forEach(function(uid) { if (ensureLiffUser_(uid)) createdCount++; });
  console.log('backfillMissingFollowers_: เป็นเพื่อนกับบอทอยู่ ' + ids.length + ' คน — เพิ่มแถวที่ขาดไป ' + createdCount + ' คน');
}

/* ═══════════════ ตัวตรวจ — Run จาก editor (ไม่ต้อง deploy · อ่านอย่างเดียว ไม่เขียนอะไรเลย) ═══════════════
 * ตอบคำถามว่า "ถ้ามีคนพิมพ์คำสั่งตอนนี้ จะได้อะไร" โดยไม่ต้องยิงผ่าน LINE และไม่แตะ chatlog/liff_users
 * ★ ใช้ฟังก์ชันตัวจริงทุกตัว (botAdminUser_ / botManagedTenants_ / botInventorySnapshot_ / answerTodaySales_)
 *   จะได้ไม่ใช่การทดสอบโค้ดคนละชุดกับที่ผู้ใช้เจอ
 * วิธีใช้: Apps Script editor → เลือก diagnoseBot → Run → ดูที่ Execution log
 */
function diagnoseBot() {
  var out = [];
  function say(s) { out.push(s); }
  var props = PropertiesService.getScriptProperties();
  say('── ค่าตั้ง ──');
  ['CENTRAL_SHEET_FILEID_PROD', 'CENTRAL_SHEET_FILEID_UAT', 'LINE_CHANNEL_ACCESS_TOKEN'].forEach(function(k) {
    say('  ' + k + ': ' + (props.getProperty(k) ? 'ตั้งแล้ว' : '★ ยังไม่ได้ตั้ง'));
  });

  say('');
  say('── ตาราง admin_user_tenants (ผู้รับผิดชอบตัวแทน) ──');
  var autRows = null;
  try { autRows = sheetObjects_(prodSheet_('admin_user_tenants')); }
  catch (err) { say('  ยังไม่มีแท็บนี้ใน prod (ยังไม่ได้ deploy backend ใหม่) → ทุกคนฝั่งบริษัทเห็นทุกตัวแทน'); }
  if (autRows) say('  มี ' + autRows.length + ' แถว');

  say('');
  say('── ใครใช้คำสั่ง "ของคงเหลือ" ได้ตอนนี้ ──');
  var admins = sheetObjects_(prodSheet_('admin_users')).filter(function(u) { return String(u.line_user_id || '').trim(); });
  if (!admins.length) {
    say('  ★ ไม่มีบัญชีแอดมินที่ผูก LINE ไว้เลย — คำสั่งนี้จะตอบว่า "ต้องใช้บัญชีแอดมิน" กับทุกคน');
    say('    แก้: ผูก LINE ที่เมนู "บัญชีผู้ใช้งาน" ในแอปแอดมิน หรือ Run bindAdminLineId() ใน backend');
  }
  admins.forEach(function(u) {
    var admin = botAdminUser_(u.line_user_id);
    if (!admin) {
      say('  ✗ ' + u.username + ' (' + u.status + (String(u.role_code || '') ? '' : ' · ยังไม่มีบทบาท') + ') — ไม่ผ่านด่านบัญชี');
      return;
    }
    var canSee = botHasPermission_(admin, 'inventory', 'view');
    var tenants = botManagedTenants_(admin);
    say('  ' + (canSee ? '✓' : '✗') + ' ' + admin.username + ' · ' + admin.role_code +
        ' · สังกัด ' + (String(admin.tenant_id || '') || '(บริษัท)') +
        ' · สิทธิ์คลัง: ' + (canSee ? 'ดูได้' : '★ ยังไม่มี') +
        ' · ดูแล ' + tenants.length + ' ราย: ' + tenants.map(function(t) { return t.tenantId; }).join(', '));
  });
  var liffOk = sheetObjects_(prodSheet_('liff_users')).filter(function(u) { return String(u.status) === 'Yes'; });
  say('  (คำสั่งอื่นใช้ได้อีก ' + liffOk.length + ' คนจาก liff_users ที่อนุมัติแล้ว)');

  say('');
  say('── ยอดขายวันนี้ (คำสั่ง "ยอดขายวันนี้" จะตอบแบบนี้) ──');
  try { say('  ' + answerTodaySales_().split('\n').join(' · ')); }
  catch (err) { say('  ★ ล้มเหลว: ' + err.message); }

  say('');
  say('── ของคงเหลือ ──');
  var seen = {}, tested = 0;
  admins.forEach(function(u) {
    var admin = botAdminUser_(u.line_user_id);
    if (!admin || tested >= 3) return;
    botManagedTenants_(admin).forEach(function(t) {
      if (seen[t.tenantId] || tested >= 3) return;
      seen[t.tenantId] = 1; tested++;
      try {
        var snap = botInventorySnapshot_(t.tenantId);
        var flex = { type: 'flex', altText: 'x', contents: botFlexInventory_(snap) };
        say('  [' + t.tenantId + '] ' + snap.tenantName + ' — สินค้าที่มีของ ' + snap.products + ' รายการ · ' +
            'คลัง ' + botNum_(snap.totals.warehouse) + ' ลัง · รถ ' + botNum_(snap.totals.van) + ' ลัง · ' +
            'รวม ' + botNum_(snap.totals.total) + ' ลัง' +
            (snap.vanAvailable ? (' · พนักงานที่มีของบนรถ ' + snap.vanStaff + ' คน') : ' · ★ อ่านของบนรถไม่ได้') +
            (snap.unconfirmed ? (' · ★ ยังไม่ยืนยันขนาดบรรจุ ' + snap.unconfirmed + ' รายการ') : '') +
            ' · ขนาดการ์ด ' + JSON.stringify(flex).length + ' ตัวอักษร');
        snap.rows.slice(0, 3).forEach(function(r) {
          say('      ' + (r.confirmed ? '' : '*') + r.productCode + ' ' + r.productName +
              ' — คลัง ' + botNum_(r.warehouse) + ' · รถ ' + botNum_(r.van) + ' · รวม ' + botNum_(r.total));
        });
      } catch (err) {
        say('  [' + t.tenantId + '] ★ ล้มเหลว: ' + err.message);
      }
    });
  });
  if (!tested) say('  (ไม่มีใครใช้คำสั่งนี้ได้ จึงไม่ได้ลองดึงตัวเลข)');

  var text = out.join('\n');
  console.log(text);
  return text;
}

function findLiffUser_(sh, lineUserId) {
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(lineUserId)) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
      return obj;
    }
  }
  return null;
}

// ต่อท้ายแถวใหม่ตามชื่อหัวคอลัมน์จริงของชีต (ไม่ใช่ตำแหน่งคงที่) กันพังถ้าวันหน้ามีคนเพิ่ม/สลับคอลัมน์
function appendRowByHeader_(sh, obj) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}

// อ่านทั้งชีตเป็น array of object ตามหัวคอลัมน์ (ข้ามแถวว่างสนิทที่คอลัมน์แรกว่าง) — เทียบเท่า sheetObjectsOf ใน backend หลัก
function sheetObjects_(sh) {
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === '' || data[i][0] === null) continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = data[i][j];
    out.push(obj);
  }
  return out;
}

// ── การเข้าถึง Central Sheet ──
function prodSheet_(sheetName) { return sheetByName_(prodFileId_(), sheetName); }
function uatSheet_(sheetName) { return sheetByName_(uatFileId_(), sheetName); }

function sheetByName_(fileId, sheetName) {
  var ss = SpreadsheetApp.openById(fileId);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('ไม่พบ sheet ' + sheetName + ' (fileId: ' + fileId + ')');
  return sh;
}

function prodFileId_() {
  var id = PropertiesService.getScriptProperties().getProperty('CENTRAL_SHEET_FILEID_PROD');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า Script Property: CENTRAL_SHEET_FILEID_PROD');
  return id;
}
function uatFileId_() {
  var id = PropertiesService.getScriptProperties().getProperty('CENTRAL_SHEET_FILEID_UAT');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า Script Property: CENTRAL_SHEET_FILEID_UAT');
  return id;
}

// ไฟล์ Sheet ของตัวแทนแต่ละราย (รวม 'HOUSE') — เก็บ sheet_file_id ไว้ที่ตาราง tenants ของ prod เท่านั้น
function tenantFileId_(tenantId) {
  var t = sheetObjects_(prodSheet_('tenants')).filter(function(row) { return String(row.tenant_id) === String(tenantId); })[0];
  if (!t) throw new Error('ไม่พบตัวแทน (tenant_id): ' + tenantId);
  if (!t.sheet_file_id) throw new Error('ตัวแทน ' + tenantId + ' ยังไม่มี sheet_file_id');
  return t.sheet_file_id;
}
function tenantSheet_(tenantId, sheetName) { return sheetByName_(tenantFileId_(tenantId), sheetName); }

// ── บันทึกประวัติการสนทนา — เขียนลง UAT เท่านั้นโดยตั้งใจ (ไม่ใช่ prod) ──
// สร้างแท็บ chatlog เองถ้ายังไม่มี (เพิ่งเพิ่มฟีเจอร์นี้ ไฟล์ UAT เดิมยังไม่มีแท็บนี้แน่ๆ)
function chatLogSheet_() {
  var ss = SpreadsheetApp.openById(uatFileId_());
  var sh = ss.getSheetByName('chatlog');
  if (!sh) {
    sh = ss.insertSheet('chatlog');
    sh.appendRow(['timestamp', 'line_user_id', 'line_display_name', 'user_message', 'response_message']);
  }
  return sh;
}

// log ต้องไม่มีวันทำให้บอทตอบผู้ใช้ไม่ได้ — พังก็แค่ log ครั้งนั้นหาย ไม่ throw ต่อ
function logChat_(lineUserId, displayName, userMessage, responseMessage) {
  try {
    chatLogSheet_().appendRow([new Date(), lineUserId, displayName || '', userMessage, responseMessage]);
  } catch (err) {
    console.error('logChat_ error: ' + err);
  }
}

// ── LINE Messaging API ──
function replyMessage_(replyToken, text) {
  return replyMessages_(replyToken, [{ type: 'text', text: String(text).substring(0, 5000) }]);
}

/** ตอบได้ไม่เกิน 5 ข้อความต่อ reply token หนึ่งใบ (เพดานของ LINE) */
function replyMessages_(replyToken, messages) {
  if (!messages || !messages.length) return;
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { console.error('replyMessages_: ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN'); return; }
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: messages.slice(0, 5) }),
      muteHttpExceptions: true
    });
    // muteHttpExceptions ทำให้ 4xx/5xx ไม่โยน exception — ต้องเช็ค status เองไม่งั้นตอบไม่ได้แบบเงียบๆ
    // (สาเหตุที่พบได้บ่อย: LINE_CHANNEL_ACCESS_TOKEN ผิดตัว/หมดอายุ, หรือ replyToken ใช้ไปแล้ว/หมดอายุ)
    if (res.getResponseCode() !== 200) {
      console.error('replyMessage_ LINE API ตอบ ' + res.getResponseCode() + ': ' + res.getContentText());
    }
  } catch (err) {
    console.error('replyMessage_ error: ' + err);
  }
}

// ดึงชื่อผู้ใช้จาก LINE Get Profile API — best effort เท่านั้น ไม่มี token หรือเรียกไม่สำเร็จก็ไม่ทำให้ event ล้ม
function fetchLineDisplayName_(lineUserId) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return '';
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(lineUserId), {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return '';
    return JSON.parse(res.getContentText()).displayName || '';
  } catch (err) {
    console.error('fetchLineDisplayName_ error: ' + err);
    return '';
  }
}
