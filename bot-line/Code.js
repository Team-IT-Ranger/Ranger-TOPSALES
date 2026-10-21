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
  if (event.type === 'follow') return handleFollow_(event);
  if (event.type === 'message' && event.message && event.message.type === 'text') return handleMessage_(event);
  // ขั้นต่อไป (ยังไม่ทำ): unfollow (ทำเครื่องหมายว่าเลิกติดตาม), ข้อความที่ไม่ใช่ text (สติกเกอร์/รูป)
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
    if (!me || String(me.status) !== 'Yes') {
      replyAndLog_(replyToken, lineUserId, displayName, rawText, 'บัญชีนี้ยังรอแอดมินอนุมัติอยู่ครับ อนุมัติแล้วถึงจะถามข้อมูลได้');
      return;
    }

    replyAndLog_(replyToken, lineUserId, displayName, rawText, answerQuestion_(text));
  } catch (err) {
    console.error('handleMessage_ error: ' + (err && err.stack || err));
    replyAndLog_(replyToken, lineUserId, displayName, rawText, 'ขอโทษครับ ระบบขัดข้องตอนตอบคำถามนี้ ลองใหม่อีกครั้ง หรือแจ้งแอดมิน');
  }
}

function replyAndLog_(replyToken, lineUserId, displayName, userMessage, responseText) {
  replyMessage_(replyToken, responseText);
  logChat_(lineUserId, displayName, userMessage, responseText);
}

// ── ตอบคำถาม (ชุดคำสั่งเริ่มต้น — เพิ่มเงื่อนไขใหม่ต่อท้ายได้เรื่อยๆ) ──
function answerQuestion_(text) {
  if (!text || /^(ช่วยเหลือ|help|เมนู|คำสั่ง)$/i.test(text)) return helpText_();
  if (/^ยอดขาย/i.test(text)) return answerTodaySales_();
  if (/^(สต็อก|stock)\s+/i.test(text)) return answerStock_(text.replace(/^(สต็อก|stock)\s+/i, '').trim());
  if (/^(ยอดค้างชำระ|ยอดค้าง)\s+/i.test(text)) return answerReceivable_(text.replace(/^(ยอดค้างชำระ|ยอดค้าง)\s+/i, '').trim());
  if (/^(สถานะบิล|บิลขาย)\s+/i.test(text)) return answerSalesOrders_(text.replace(/^(สถานะบิล|บิลขาย)\s+/i, '').trim());
  return 'ยังไม่เข้าใจคำถามนี้ครับ พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้ตอนนี้';
}

function helpText_() {
  return 'คำสั่งที่ใช้ได้ตอนนี้ครับ:\n' +
    '• ยอดขายวันนี้ — ยอดขายรวมวันนี้ (ทุกตัวแทน+บริษัท)\n' +
    '• สต็อก <รหัส/ชื่อสินค้า> — ของคงเหลือในคลังกลางบริษัท\n' +
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

  var tenantId = customer.tenant_id || 'HOUSE';
  var orders;
  try {
    orders = sheetObjects_(tenantSheet_(tenantId, 'sales_orders')).filter(function(o) {
      return String(o.customer_id) === String(customer.record_id);
    });
  } catch (err) {
    console.error('answerSalesOrders_ error: ' + err);
    return 'ดึงข้อมูลบิลขายของลูกค้า ' + customer.customer_code + ' ไม่สำเร็จครับ (ตัวแทน ' + tenantId + ')';
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
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { console.error('replyMessage_: ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN'); return; }
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: String(text).substring(0, 5000) }] }),
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
