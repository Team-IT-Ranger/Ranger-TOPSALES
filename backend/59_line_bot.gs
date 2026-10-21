/**
 * ===================== บอท LINE (Messaging API) =====================
 * พิมพ์ `/inventory` ในแชตแล้วได้ของคงเหลือเป็น Flex message (คลัง · บนรถ · รวม หน่วยลัง)
 * ดูแลตัวแทนมากกว่าหนึ่งราย = ได้เมนูให้เลือกก่อน (57_user_tenants.gs เป็นตัวตอบว่าใครดูแลใคร)
 *
 * ★★ webhook มาที่ **URL เดียวกับ API ของเรา** (Apps Script มี doPost ได้ตัวเดียว) จึงต้องดักที่
 *   `lineBotHandleWebhook()` ก่อนเส้นทางเดิมใน doPost — คำขอของ LINE ไม่มี `action` แต่มี `events`
 *   คืน null = ไม่ใช่ของ LINE ปล่อยให้ API เดิมทำงานต่อ · คืน output = จบที่นี่
 *
 * ★★ **Apps Script อ่าน HTTP header ของคำขอไม่ได้เลย** → ตรวจ `x-line-signature` ไม่ได้
 *   สิ่งที่กันไว้แทน:
 *     1. ตัวตนมาจาก `event.source.userId` เทียบกับ `admin_users.line_user_id` ของเราเท่านั้น
 *        (ข้อมูลใน payload ที่ส่งมาเองไม่มีผลกับการตัดสินสิทธิ์)
 *     2. คำตอบส่งออกทาง reply token ของ LINE เท่านั้น — คำขอปลอมจึงดึงข้อมูลออกไปไม่ได้
 *        (token ปลอมจะถูก LINE ปฏิเสธ ไม่มีอะไรหลุดไปหาคนส่ง)
 *     3. `LINE_BOT_WEBHOOK_KEY` (ถ้าตั้ง) = คำลับท้าย URL `?k=…` ไม่ตรง = ทิ้งเงียบ
 *   ★ อย่าเพิ่มคำสั่งที่ "เขียนข้อมูล" หรือ "push ไปหาคนอื่น" ลงบอทนี้โดยไม่คิดเรื่องข้อ 1-3 ให้จบก่อน
 *     คำสั่งอ่านอย่างเดียวปลอดภัยเพราะข้อ 2 แต่คำสั่งเขียนไม่ได้อาศัยข้อ 2 เลย
 *
 * ★ ตอบเฉพาะแชตส่วนตัว (`source.type === 'user'`) — ในกลุ่ม/ห้องจะบอกให้ไปคุยส่วนตัว
 *   ของคงเหลือเป็นข้อมูลภายใน คนในกลุ่มไม่ได้ผ่านการตรวจสิทธิ์รายคน
 */

var LINE_BOT_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
var BOT_EVENT_PREFIX = 'linebot_ev_';
var BOT_EVENT_TTL_SEC = 600;      // LINE retry ภายในไม่กี่นาที — 10 นาทีเหลือๆ
var BOT_MAX_EVENTS = 10;          // กันคำขอก้อนใหญ่ทำให้เกินเวลาที่ LINE รอ
var BOT_ROW_LIMIT = 15;           // แถวต่อหนึ่งใบ — มากกว่านี้ Flex ยาวเกินจอและเสี่ยงชนเพดานขนาดข้อความ

/** ตั้ง token แล้วหรือยัง — ไม่ตั้ง = บอทปิดเงียบ (ยังตอบ 200 ให้ LINE ไม่ให้ขึ้น error ในคอนโซล) */
function lineBotEnabled() { return !!getConfig().LINE_BOT_ACCESS_TOKEN; }

function _botOk() {
  return ContentService.createTextOutput('{}').setMimeType(ContentService.MimeType.JSON);
}

/**
 * ทางเข้าจาก doPost() — ต้องเรียกเป็นบรรทัดแรกก่อนแกะ body ของ API เดิม
 * @return null ถ้าไม่ใช่ webhook ของ LINE · ไม่งั้นคืน TextOutput ที่ตอบ LINE ไปแล้ว
 */
function lineBotHandleWebhook(e) {
  var raw = (e && e.postData && e.postData.contents) ? String(e.postData.contents) : '';
  if (!raw || raw.indexOf('"events"') === -1) return null;
  var body = null;
  try { body = JSON.parse(raw); } catch (err) { return null; }
  // มี action = คำขอของแอปเราเอง (เผื่อวันหน้ามี action ชื่อมีคำว่า events อยู่ใน payload)
  if (!body || body.action || !body.events || Object.prototype.toString.call(body.events) !== '[object Array]') return null;

  try {
    var cfg = getConfig();
    var key = String(cfg.LINE_BOT_WEBHOOK_KEY || '');
    if (key && String((e.parameter && e.parameter.k) || '') !== key) {
      Logger.log('lineBot: ทิ้งคำขอ — คำลับท้าย URL ไม่ตรง');
      return _botOk();
    }
    if (!cfg.LINE_BOT_ACCESS_TOKEN) {
      Logger.log('lineBot: ยังไม่ได้ตั้ง LINE_BOT_ACCESS_TOKEN — รับคำขอแล้วแต่ตอบไม่ได้');
      return _botOk();
    }
    if (body.events.length > BOT_MAX_EVENTS) {
      Logger.log('lineBot: ได้ ' + body.events.length + ' events ทำแค่ ' + BOT_MAX_EVENTS + ' รายการแรก');
    }
    body.events.slice(0, BOT_MAX_EVENTS).forEach(function(ev) {
      try { _botHandleEvent(ev); }
      catch (err) { Logger.log('lineBot event ล้มเหลว: ' + (err.stack || err.message)); }
    });
  } catch (err) {
    // ★ ล้มอย่างไรก็ต้องตอบ 200 — ตอบ error ให้ LINE = มันจะ retry ก้อนเดิมซ้ำๆ แล้วเราก็ล้มซ้ำๆ
    Logger.log('lineBot ล้มเหลว: ' + (err.stack || err.message));
  }
  return _botOk();
}

/** เคยทำ event นี้แล้วหรือยัง (LINE ส่งซ้ำเมื่อไม่ได้ 200 ทันเวลา)
 *  ★ ไม่ใช้ withIdempotency() เพราะตัวนั้นจับ script lock ทุกครั้ง — คำสั่งอ่านอย่างเดียว
 *    ไม่ควรทำให้คนอื่นที่พิมพ์พร้อมกันต้องรอคิว · ถ้าวันหนึ่งบอทมีคำสั่งที่เขียนข้อมูล
 *    คำสั่งนั้นต้องห่อด้วย withIdempotency() ของมันเอง */
function _botSeenEvent(eventId) {
  var id = String(eventId || '');
  if (!id) return false;
  var cache = CacheService.getScriptCache(), k = BOT_EVENT_PREFIX + id;
  try {
    if (cache.get(k)) return true;
    cache.put(k, '1', BOT_EVENT_TTL_SEC);
  } catch (err) {}
  return false;
}

function _botHandleEvent(ev) {
  if (!ev || !ev.type) return;
  if (_botSeenEvent(ev.webhookEventId)) { Logger.log('lineBot: ข้าม event ซ้ำ'); return; }

  var token = ev.replyToken;
  var uid = (ev.source && ev.source.userId) ? String(ev.source.userId) : '';
  var cmd = null;

  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    cmd = _botParseCommand(ev.message.text);
  } else if (ev.type === 'postback' && ev.postback) {
    cmd = _botParsePostback(ev.postback.data);
  } else if (ev.type === 'follow') {
    cmd = { name: 'help' };
  } else {
    return;   // สติกเกอร์/รูป/เข้าออกกลุ่ม ฯลฯ — เงียบไว้ ไม่ใช่งานของบอทนี้
  }
  if (!cmd || !token) return;

  // ★ ในกลุ่ม/ห้อง: ตอบสั้นๆ แล้วจบ ไม่ส่งข้อมูลภายในลงไป
  if (ev.source && ev.source.type && ev.source.type !== 'user') {
    _botReply(token, [{ type: 'text', text: 'ขอคุยกันในแชตส่วนตัวนะครับ — ของคงเหลือเป็นข้อมูลภายใน ต้องตรวจสิทธิ์รายคนก่อนส่ง' }]);
    return;
  }

  if (cmd.name === 'help') { _botReply(token, [{ type: 'text', text: _botHelpText() }]); return; }

  var id = _botIdentity(uid);
  if (!id.ok) { _botReply(token, [{ type: 'text', text: id.message }]); return; }

  if (cmd.name === 'inventory') {
    _botReply(token, _botInventoryMessages(id.user, cmd.arg));
    return;
  }
  _botReply(token, [{ type: 'text', text: 'ไม่รู้จักคำสั่งนี้\n\n' + _botHelpText() }]);
}

/* ═══════════════ คำสั่ง ═══════════════ */

// ★ คำสั่งเดียวแต่หลายคำเรียก — คนพิมพ์ "สต็อก" หรือ "/inv" แล้วไม่ได้อะไรจะเลิกใช้ไปเลย
var BOT_INV_WORDS = { 'inventory': 1, 'inv': 1, 'stock': 1, 'สต็อก': 1, 'สตอก': 1, 'คลัง': 1, 'ของคงเหลือ': 1 };
var BOT_HELP_WORDS = { 'help': 1, 'menu': 1, 'start': 1, 'ช่วย': 1, 'เมนู': 1, 'คำสั่ง': 1, 'ช่วยด้วย': 1 };

function _botParseCommand(text) {
  var s = String(text || '').trim();
  if (!s) return null;
  if (s.charAt(0) === '/') s = s.substring(1).trim();
  var sp = s.indexOf(' ');
  var head = (sp === -1 ? s : s.substring(0, sp)).toLowerCase();
  var arg = sp === -1 ? '' : s.substring(sp + 1).trim();
  if (BOT_INV_WORDS[head]) return { name: 'inventory', arg: arg };
  if (BOT_HELP_WORDS[head]) return { name: 'help' };
  return null;   // ข้อความคุยเล่นทั่วไป — ไม่ตอบ ดีกว่าตอบว่า "ไม่เข้าใจ" ทุกประโยค
}

/** data ของปุ่ม: `cmd=inv&t=<tenantId>` */
function _botParsePostback(data) {
  var s = String(data || '');
  if (!s) return null;
  var out = {};
  s.split('&').forEach(function(pair) {
    var i = pair.indexOf('=');
    if (i === -1) return;
    out[pair.substring(0, i)] = decodeURIComponent(pair.substring(i + 1).replace(/\+/g, ' '));
  });
  if (out.cmd === 'inv') return { name: 'inventory', arg: out.t || '' };
  return null;
}

function _botHelpText() {
  return 'คำสั่งที่ใช้ได้\n' +
    '• /inventory — ของคงเหลือ (คลัง · บนรถ · รวม หน่วยลัง)\n' +
    '• /inventory <รหัสตัวแทน> — ข้ามเมนูเลือก เช่น /inventory BDC\n' +
    '• /help — ดูคำสั่งทั้งหมด\n\n' +
    'ใช้ได้เฉพาะบัญชีที่ผูก LINE กับระบบไว้แล้ว (ผูกที่เมนู บัญชีผู้ใช้งาน ในแอปแอดมิน)';
}

/* ═══════════════ ตัวตน ═══════════════ */

/**
 * LINE user id → บัญชีแอดมิน · ใช้ด่านเดียวกับหน้าล็อกอิน (`_adminAccountGate`) จะได้ไม่มีทาง
 * ที่บัญชีซึ่งเข้าเว็บไม่ได้ (รออนุมัติ/ถูกระงับ) กลับถามข้อมูลผ่านแชตได้
 * ★ v1 รับเฉพาะ `admin_users` — พนักงานขายใน `liff_users` ยังไม่ได้เปิดให้ใช้บอท
 *   เพราะการให้เขาเห็น "ของทั้งคลังของตัวแทน" เป็นการเปิดข้อมูลใหม่ ไม่ใช่แค่ย้ายช่องทาง
 *   (ของบนรถของตัวเองเขาเห็นในแอปมือถืออยู่แล้ว) — เปิดเมื่อเจ้าของระบบสั่ง
 */
function _botIdentity(lineUserId) {
  var uid = String(lineUserId || '');
  if (!uid) return { ok: false, message: 'อ่านตัวตน LINE ไม่ได้ ลองส่งข้อความใหม่อีกครั้ง' };

  var found = null;
  centralObjects('admin_users').forEach(function(u) {
    if (String(u.line_user_id || '') === uid) found = u;
  });
  if (found) {
    var gate = _adminAccountGate(found);
    if (gate) return { ok: false, message: gate.message };
    return { ok: true, user: {
      adminUserId: String(found.record_id), record_id: String(found.record_id),
      username: found.username, displayName: found.display_name || found.username,
      role_code: found.role_code, tenant_id: found.tenant_id || ''
    } };
  }

  var staff = null;
  centralObjects('liff_users').forEach(function(u) {
    if (String(u.line_user_id || '') === uid) staff = u;
  });
  if (staff) {
    return { ok: false, message: 'บัญชีนี้เป็นพนักงานขาย — ของบนรถของคุณดูได้ในแอปมือถือ\n' +
      'ถ้าต้องการดูของคงเหลือทั้งคลังผ่านแชต ต้องให้ผู้ดูแลเปิดสิทธิ์แอดมินให้ก่อน' };
  }
  return { ok: false, message: 'ยังไม่พบบัญชีที่ผูกกับ LINE นี้\n' +
    'ให้ผู้ดูแลระบบผูก LINE ของคุณกับบัญชีแอดมินที่เมนู "บัญชีผู้ใช้งาน" ก่อน แล้วพิมพ์ /inventory อีกครั้ง' };
}

/* ═══════════════ /inventory ═══════════════ */

function _botInventoryMessages(user, arg) {
  if (!hasPermission(user, 'inventory', 'view')) {
    return [{ type: 'text', text: 'บัญชีนี้ยังไม่มีสิทธิ์ดูเมนูคลังสินค้า — ติดต่อผู้ดูแลระบบให้เปิดสิทธิ์ "คลังสินค้า" ให้บทบาทของคุณ' }];
  }
  var list = managedTenants(user);
  if (!list.length) {
    return [{ type: 'text', text: 'ยังไม่มีตัวแทนที่คุณดูแลอยู่ — ให้ผู้ดูแลระบบตั้งผู้รับผิดชอบให้ก่อน' }];
  }

  var want = String(arg || '').trim();
  if (want) {
    var hit = _botMatchTenant(list, want);
    if (!hit) {
      return [{ type: 'text', text: 'ไม่พบตัวแทน "' + want + '" ในรายการที่คุณดูแล\n\nรายที่ดูแลอยู่:\n' +
        list.map(function(t) { return '• ' + t.tenantId + ' — ' + t.name; }).join('\n') }];
    }
    return [_botInventoryMessage(hit.tenantId)];
  }

  if (list.length === 1) return [_botInventoryMessage(list[0].tenantId)];
  return [flexTenantPicker(list)];
}

/** เทียบรหัสก่อน (ตรงตัว ไม่สนตัวพิมพ์) แล้วค่อยเทียบชื่อแบบมีคำนั้นอยู่ — ชื่อซ้ำกันหลายรายถือว่าไม่ชัด */
function _botMatchTenant(list, want) {
  var w = want.toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].tenantId).toLowerCase() === w) return list[i];
  }
  var byName = list.filter(function(t) { return String(t.name).toLowerCase().indexOf(w) !== -1; });
  return byName.length === 1 ? byName[0] : null;
}

function _botInventoryMessage(tenantId) {
  var snap = inventorySnapshot(tenantId, { limit: BOT_ROW_LIMIT });
  if (!snap || !snap.success) return { type: 'text', text: 'ดึงข้อมูลของคงเหลือไม่สำเร็จ ลองใหม่อีกครั้ง' };
  var alt = 'ของคงเหลือ ' + snap.tenantName + ' — รวม ' + flexNum(snap.totals.total) + ' ลัง (คลัง ' +
    flexNum(snap.totals.warehouse) + ' · รถ ' + flexNum(snap.totals.van) + ')';
  return { type: 'flex', altText: alt, contents: flexInventory(snap) };
}

/* ═══════════════ ส่งคำตอบ ═══════════════ */

/** ตอบกลับด้วย reply token (ได้ไม่เกิน 5 ข้อความต่อครั้ง และ token ใช้ครั้งเดียว) */
function _botReply(replyToken, messages) {
  var token = String(replyToken || '');
  if (!token || !messages || !messages.length) return false;
  var cfg = getConfig();
  if (!cfg.LINE_BOT_ACCESS_TOKEN) return false;
  var res = UrlFetchApp.fetch(LINE_BOT_REPLY_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.LINE_BOT_ACCESS_TOKEN },
    payload: JSON.stringify({ replyToken: token, messages: messages.slice(0, 5) }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    // ★ LINE บอกเหตุผลมาใน body เสมอ (เช่น Flex ผิดรูป / token หมดอายุ) — ไม่ log ไว้จะหาสาเหตุไม่ได้เลย
    Logger.log('lineBot reply ล้มเหลว ' + code + ': ' + res.getContentText());
    return false;
  }
  return true;
}

/* ═══════════════ เครื่องมือตรวจ (รันจาก editor) ═══════════════ */

/**
 * ตรวจว่าตั้งค่าครบไหม + ของคงเหลือที่บอทจะตอบหน้าตาเป็นอย่างไร โดยไม่ต้องยิงผ่าน LINE
 * แก้ค่าที่หัวฟังก์ชันแล้ว Run ใน Apps Script editor (ไม่ต้อง deploy ใหม่ — editor รันโค้ดที่ HEAD)
 */
function diagnoseLineBot() {
  var CHECK_LINE_USER_ID = '';    // ใส่ LINE user id ที่จะทดสอบ (ว่าง = ข้ามการตรวจตัวตน)
  var cfg = getConfig();
  var out = {
    hasAccessToken: !!cfg.LINE_BOT_ACCESS_TOKEN,
    hasWebhookKey: !!cfg.LINE_BOT_WEBHOOK_KEY,
    webhookUrl: (cfg.ENDPOINT_URL || '(ยังไม่ได้ตั้ง ENDPOINT_URL)') +
      (cfg.LINE_BOT_WEBHOOK_KEY ? '?k=' + cfg.LINE_BOT_WEBHOOK_KEY : '')
  };
  if (CHECK_LINE_USER_ID) {
    var id = _botIdentity(CHECK_LINE_USER_ID);
    out.identity = id.ok ? { username: id.user.username, role: id.user.role_code, tenant: id.user.tenant_id || '(บริษัท)' }
                         : { ok: false, message: id.message };
    if (id.ok) {
      out.canViewInventory = hasPermission(id.user, 'inventory', 'view');
      out.managedTenants = managedTenants(id.user);
      if (out.managedTenants.length) {
        var snap = inventorySnapshot(out.managedTenants[0].tenantId, { limit: 5 });
        out.sample = { tenant: snap.tenantName, products: snap.products, totals: snap.totals,
          vanAvailable: snap.vanAvailable, unconfirmed: snap.unconfirmed, firstRows: snap.rows };
      }
    }
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
