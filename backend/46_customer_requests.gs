/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  คำขอเปิดร้านค้าใหม่จากแอปมือถือ — เซลส์ขอ → แอดมินอนุมัติ → ระบบสร้างร้านให้
 *  (เจ้าของระบบสั่ง 5 ต.ค. 2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ★ ของเดิมคือ `addCustomer` (10_master_data.gs) ซึ่ง **สร้างร้านเข้าระบบทันทีโดยไม่มีการอนุมัติ**
 *   เซลส์กรอกแค่ ชื่อ/เบอร์/เลขภาษี/ที่อยู่ แล้วร้านนั้นขายได้เลย — ไม่มีใครตรวจเครดิต ไม่มีใครตั้งกลุ่มราคา
 *   ตอนนี้ปิดทางนั้นแล้ว (ดูหมายเหตุใน `addCustomer`) ทุกร้านใหม่จากมือถือต้องผ่านคิวนี้
 *
 * ★★ กติกาที่สำคัญที่สุดของไฟล์นี้: **อนุมัติแล้วต้องขายได้จริง**
 *   ร้านที่ไม่มี `group_id` จะหาชุดราคาไม่เจอ → เปิดบิลไม่ได้ → แต่ในตารางลูกค้ามันดูเหมือนแถวปกติทุกอย่าง
 *   (อาการนี้มีจริงมาแล้ว ดู CLAUDE.md หัวข้อ "จัดกลุ่มลูกค้าเป็นชุด")
 *   ถ้าปล่อยให้อนุมัติโดยไม่ตั้งกลุ่ม ระบบจะส่งข้อความไปบอกเซลส์ว่า "เปิดร้านให้แล้ว ขายได้เลย"
 *   แล้วเซลส์ไปถึงหน้าร้านจริงถึงจะรู้ว่าเปิดบิลไม่ได้ — คำโกหกที่แพงที่สุดที่ระบบนี้จะพูดได้
 *   → `approveCustomerRequest` จึง **บังคับเลือกกลุ่มราคา** และ **ลองหาชุดราคาให้ดูก่อนสร้างจริง**
 *     (`resolvePriceListForCustomer` กับแถวลูกค้าที่ยังไม่ได้เขียนลงชีต) ไม่เจอ = ปฏิเสธการอนุมัติ
 *     พร้อมบอกเหตุผล ไม่สร้างแถวค้างไว้ให้ไปตามเก็บทีหลัง
 */

var CR_PENDING  = 'pending';
var CR_APPROVED = 'approved';
var CR_REJECTED = 'rejected';

var CR_STATUS_LABELS = {
  pending:  'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ'
};

/** เลขอ้างอิงคำขอ — ไว้พูดกันทางโทรศัพท์ ไม่ใช่เอกสารตามกฎหมาย จึงไม่ต้องผ่านระบบเลขที่เอกสาร (12_docnum.gs) */
function _crRequestNo(recordId) {
  var s = String(recordId);
  while (s.length < 5) s = '0' + s;
  return 'CR-' + s;
}

function _crStr(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function _crNum(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

/**
 * ประเภทร้านที่เปิดใช้งานอยู่ — ใช้ทั้งฝั่งมือถือ (ตอนกรอก) และฝั่งแอดมิน (ตอนตรวจ)
 * ★ เติมค่าตั้งต้นให้เองถ้าตารางยังว่าง — `_seedShopTypes()` ถูกเรียกจาก setup ครั้งแรกเท่านั้น
 *   env ที่ตั้งไว้ก่อนหน้านี้ (UAT/prod) จะได้ชีตเปล่าแล้วช่องประเภทร้านว่างโดยไม่มีอะไรฟ้อง
 *   ทำแบบเดียวกับ `_ensureHouseTenant()` / `_ensureScopeWarehouse()` ที่สร้างของให้ครั้งแรกที่ใช้
 *   (seed ตัวนั้นเช็ค getLastRow() อยู่แล้ว เรียกซ้ำไม่เกิดแถวซ้ำ)
 */
function _crShopTypes() {
  var rows = centralObjects('shop_types');
  if (!rows.length) {
    try { _seedShopTypes(); centralInvalidate('shop_types'); } catch (e) { Logger.log('seed shop_types: ' + e); }
    rows = centralObjects('shop_types');
  }
  return rows
    .filter(function(t) { return isNotOff(t.is_active); })
    .map(function(t) { return { id: String(t.record_id), code: t.code || '', name: t.name || '' }; });
}

function _crShopTypeName(id) {
  if (!id) return '';
  var hit = '';
  centralObjects('shop_types').forEach(function(t) { if (String(t.record_id) === String(id)) hit = t.name || ''; });
  return hit;
}

function _crToApi(r) {
  return {
    id: r.record_id, requestNo: r.request_no || _crRequestNo(r.record_id),
    tenantId: r.tenant_id || '', status: r.status || CR_PENDING,
    statusLabel: CR_STATUS_LABELS[String(r.status || CR_PENDING)] || String(r.status || ''),
    requestedBy: r.requested_by || '', requestedByName: r.requested_by_name || '', requestedAt: r.requested_at || '',
    name: r.name || '', address: r.address || '', taxId: r.tax_id || '',
    contactName: r.contact_name || '', phone: r.phone || '',
    paymentType: r.payment_type || 'cash', creditLimit: _crNum(r.credit_limit),
    shopTypeId: r.shop_type_id || '', shopTypeName: _crShopTypeName(r.shop_type_id),
    lat: r.lat || '', lng: r.lng || '', note: r.note || '',
    groupId: r.group_id || '', customerId: r.customer_id || '', customerCode: r.customer_code || '',
    rejectReason: r.reject_reason || '',
    decidedBy: r.decided_by || '', decidedByName: r.decided_by_name || '', decidedAt: r.decided_at || '',
    seenAt: r.seen_at || ''
  };
}

/* ═══════════════════════ ฝั่งแอปมือถือ ═══════════════════════ */

/**
 * เซลส์ส่งคำขอเปิดร้านใหม่
 * ตรวจเท่าที่ "ผิดแล้วแก้ทีหลังแพง" เท่านั้น — เลขภาษี 13 หลัก (ใช้ตัวตรวจเดียวกับทะเบียนลูกค้า
 * ไม่เขียนกฎชุดที่สอง) และวงเงินเครดิตต้องมีเมื่อขอเป็นร้านเครดิต · ที่เหลือแอดมินแก้ได้ตอนอนุมัติ
 */
function submitCustomerRequest(user, payload) {
  payload = payload || {};
  var name = _crStr(payload.name);
  if (!name) return { success: false, message: 'กรุณาระบุชื่อร้าน' };

  var taxId = normalizeTaxId(payload.taxId);
  if (taxId && taxId.length !== 13) {
    return { success: false, message: 'เลขประจำตัวผู้เสียภาษี/บัตรประชาชน ต้องเป็นตัวเลข 13 หลัก' };
  }

  var paymentType = _crStr(payload.paymentType).toLowerCase() || 'cash';
  if (CUSTOMER_PAYMENT_TYPES.indexOf(paymentType) === -1) {
    return { success: false, message: 'ประเภทการชำระต้องเป็นเงินสดหรือเครดิต' };
  }
  var creditLimit = _crNum(payload.creditLimit);
  // ขอเป็นร้านเครดิตแต่ไม่บอกวงเงิน = คำขอที่แอดมินตัดสินใจไม่ได้ ต้องโทรกลับมาถาม — กันตั้งแต่ตรงนี้
  if (paymentType === 'credit' && !creditLimit) {
    return { success: false, message: 'ร้านเครดิตต้องระบุวงเงินเครดิตที่ขอ' };
  }

  var shopTypeId = _crStr(payload.shopTypeId);
  if (shopTypeId && !_crShopTypeName(shopTypeId)) {
    return { success: false, message: 'ประเภทร้านค้าไม่ถูกต้อง' };
  }

  return _withDocLock(function() {
    var id = centralNextId('customer_requests');
    var now = nowStr();
    var row = {
      record_id: id, request_no: _crRequestNo(id), tenant_id: user.tenantId || '', status: CR_PENDING,
      requested_by: user.lineUserId || '', requested_by_name: _crStr(payload.requestedByName) || _crStr(user.name),
      requested_at: now,
      name: name, address: _crStr(payload.address), tax_id: taxId,
      contact_name: _crStr(payload.contactName), phone: _crStr(payload.phone),
      payment_type: paymentType, credit_limit: creditLimit, shop_type_id: shopTypeId,
      lat: _crStr(payload.lat), lng: _crStr(payload.lng), note: _crStr(payload.note),
      group_id: '', customer_id: '', customer_code: '', reject_reason: '',
      decided_by: '', decided_by_name: '', decided_at: '', seen_at: '',
      created_at: now, updated_at: now
    };
    centralAppend('customer_requests', row);
    return { success: true, requestId: id, requestNo: row.request_no,
      message: 'ส่งคำขอเปิดร้าน ' + row.request_no + ' ให้แอดมินแล้ว' };
  });
}

/**
 * คำขอของเซลส์คนนี้ + ผลการพิจารณา — แอปใช้ทั้งแสดงรายการและ "ตีตราแจ้งเตือน"
 * `unseenDecided` = คำขอที่ตัดสินแล้วแต่เซลส์ยังไม่ได้กดรับทราบ → แอปขึ้นแถบแจ้ง
 * (ยังไม่ push เข้า LINE เพราะระบบยังไม่มี channel access token — ดู CLAUDE.md)
 */
function listMyCustomerRequests(user, payload) {
  var mine = centralObjects('customer_requests')
    .filter(function(r) { return String(r.requested_by) === String(user.lineUserId); })
    .map(_crToApi);
  mine.sort(function(a, b) { return Number(b.id) - Number(a.id); });
  var unseen = mine.filter(function(r) { return r.status !== CR_PENDING && !r.seenAt; });
  return { success: true, requests: mine, unseenDecided: unseen,
    pendingCount: mine.filter(function(r) { return r.status === CR_PENDING; }).length };
}

/** เซลส์กดรับทราบผลแล้ว — แถบแจ้งเตือนจะไม่ขึ้นอีก (เก็บฝั่งเซิร์ฟเวอร์ ไม่ใช่ localStorage เพราะเปลี่ยนเครื่องแล้วต้องไม่เด้งซ้ำ) */
function markCustomerRequestSeen(user, payload) {
  payload = payload || {};
  var ids = payload.requestIds || (payload.requestId ? [payload.requestId] : []);
  if (!ids.length) return { success: false, message: 'ไม่ได้ระบุคำขอ' };
  var now = nowStr(), n = 0;
  centralObjects('customer_requests').forEach(function(r) {
    if (ids.map(String).indexOf(String(r.record_id)) === -1) return;
    if (String(r.requested_by) !== String(user.lineUserId)) return;   // รับทราบแทนคนอื่นไม่ได้
    centralUpdate('customer_requests', r.record_id, { seen_at: now, updated_at: now });
    n++;
  });
  return { success: true, marked: n };
}

/** ประเภทร้านให้แอปมือถือเอาไปทำตัวเลือก */
function listShopTypesMobile(user, payload) {
  return { success: true, shopTypes: _crShopTypes() };
}

/* ═══════════════════════ ฝั่งแอดมิน ═══════════════════════ */

function listShopTypes(session, payload) {
  return { success: true, shopTypes: _crShopTypes() };
}

/**
 * คิวคำขอฝั่งแอดมิน — ค่าตั้งต้นแสดงเฉพาะที่ยังรออนุมัติ (คิวคือสิ่งที่ต้องทำ ไม่ใช่ประวัติ)
 * ขอบเขตเหมือนทุกโมดูล: ตัวแทนเห็นเฉพาะคำขอของตัวเอง · ฝั่งบริษัทสวมสิทธิ์เข้าไปดูของตัวแทนได้
 */
function listCustomerRequests(session, payload) {
  var err = _requirePermission(session, 'customers', 'view'); if (err) return err;
  payload = payload || {};
  var scope = _effectiveTenantId(session, payload);
  var want = _crStr(payload.status) || CR_PENDING;

  /* ★ กลุ่มที่เลือกได้คิดต่อ "ตัวแทนของคำขอใบนั้น" ไม่ใช่ชุดเดียวใช้ทั้งหน้า — ฝั่งบริษัทเห็นคำขอ
     ของหลายตัวแทนพร้อมกัน และชุดราคาที่จ่ายให้แต่ละตัวแทนไม่เหมือนกัน (ชั้น A) */
  var groupMemo = {};
  var rows = centralObjects('customer_requests').filter(function(r) {
    if (scope && String(r.tenant_id) !== String(scope)) return false;
    if (want !== 'all' && String(r.status || CR_PENDING) !== want) return false;
    return true;
  }).map(function(r) {
    var dto = _crToApi(r);
    dto.groupChoices = _crGroupChoicesFor(r.tenant_id, groupMemo);
    return dto;
  });
  rows.sort(function(a, b) { return Number(b.id) - Number(a.id); });

  // นับของที่รออยู่เสมอ (ไม่ขึ้นกับตัวกรองที่เลือก) — เอาไปขึ้นตัวเลขบนเมนู
  var pending = centralObjects('customer_requests').filter(function(r) {
    if (scope && String(r.tenant_id) !== String(scope)) return false;
    return String(r.status || CR_PENDING) === CR_PENDING;
  }).length;

  return { success: true, requests: rows, pendingCount: pending,
    shopTypes: _crShopTypes(),
    groups: _crGroupChoicesFor(scope, groupMemo),   // ฝั่งที่ดูตัวแทนเดียว ใช้ชุดนี้ได้เลย
    groupTotal: _crGroupTotal() };
}

/**
 * กลุ่มราคาให้แอดมินเลือกตอนอนุมัติ — **เฉพาะกลุ่มที่มีชุดราคาใช้งานอยู่จริงสำหรับตัวแทนรายนั้น**
 *
 * ★★ เคยพลาดมาแล้ว 5 ต.ค. 2026: รอบแรกส่งกลุ่มทั้งหมดไปให้เลือก แอดมินเลยเห็นสองชื่อที่แทบเหมือนกัน
 *   [8] `ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้`  (ไม่มีชุดราคา — ขยะจากการนำเข้ารอบเก่า)
 *   [12] `ร้านค้า เหนือ, อีสาน, ตะวันออก, ใต้` (มีชุดราคา active)
 *   ต่างกันแค่ `/` กับ `,` · เลือกผิดแล้วระบบปฏิเสธการอนุมัติพร้อมบอกว่า "ไม่มีชุดราคา" ทั้งที่มี
 *   — CLAUDE.md เขียนกติกานี้ไว้แล้วที่หัวข้อ "เลือกกลุ่มปลายทางจากกลุ่มที่มีชุดราคาเปิดใช้งานอยู่
 *   ไม่ใช่จากชื่อกลุ่ม" แต่รอบแรกไม่ได้ทำตาม
 *
 * ★ ใช้ `resolvePriceListForCustomer` ตัวเดียวกับด่านตอนอนุมัติ — รายการที่ให้เลือกกับด่านที่ตัดสิน
 *   จึงขัดกันเองไม่ได้ (ถ้าคิดเองคนละสูตร วันหนึ่งจะมีกลุ่มที่เลือกได้แต่อนุมัติไม่ผ่าน)
 * ★ ขึ้นกับตัวแทนด้วย เพราะชั้น A (บริษัทจ่ายชุดให้ตัวแทนรายไหน) เป็นส่วนหนึ่งของการตัดสิน
 *   ชุดเดียวกันตัวแทน A ได้ ตัวแทน B ไม่ได้ จึงคิดแยกต่อตัวแทน แล้วจำไว้กันคิดซ้ำ
 */
function _crGroupChoicesFor(tenantId, memo) {
  var key = String(tenantId || '');
  if (memo && memo[key]) return memo[key];
  var out = [];
  centralObjects('customer_groups').forEach(function(g) {
    var hit = resolvePriceListForCustomer({ tenant_id: key, group_id: g.record_id });
    if (!hit) return;
    out.push({ id: String(g.record_id), name: g.name || String(g.record_id),
      listName: (hit.list && hit.list.name) || '' });
  });
  if (memo) memo[key] = out;
  return out;
}

/** จำนวนกลุ่มทั้งหมด — ไว้บอกแอดมินว่าซ่อนไปกี่กลุ่ม จะได้ไม่งงว่ากลุ่มที่เคยเห็นหายไปไหน */
function _crGroupTotal() { return centralObjects('customer_groups').length; }

/**
 * ประกอบ "แถวลูกค้าที่จะสร้าง" จากคำขอ + สิ่งที่แอดมินแก้/เติมตอนอนุมัติ
 * แยกออกมาเป็นฟังก์ชันเพราะต้องใช้สองรอบ: รอบตรวจ (ยังไม่เขียน) กับรอบสร้างจริง — ต้องเป็นค่าชุดเดียวกันเป๊ะ
 */
function _crCustomerPayload(req, payload) {
  payload = payload || {};
  var pick = function(key, fallback) {
    return Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined && payload[key] !== ''
      ? payload[key] : fallback;
  };
  return {
    name:        pick('name', req.name),
    address:     pick('address', req.address),
    taxId:       pick('taxId', req.tax_id),
    contactName: pick('contactName', req.contact_name),
    phone:       pick('phone', req.phone),
    paymentType: pick('paymentType', req.payment_type || 'cash'),
    creditLimit: pick('creditLimit', _crNum(req.credit_limit)),
    shopTypeId:  pick('shopTypeId', req.shop_type_id),
    lat:         req.lat || '',
    lng:         req.lng || '',
    note:        pick('note', req.note),
    groupId:     payload.groupId,
    channelId:   pick('channelId', ''),
    salesmanLineUserId: req.requested_by || ''
  };
}

/**
 * อนุมัติ → สร้างลูกค้าจริง → ออกรหัสร้าน
 * ★ ลำดับสำคัญ: ตรวจให้ครบ **ก่อน** เขียนอะไรลงชีตเลยสักแถว — ล้มกลางทางแล้วตามเก็บยาก
 *   (ไม่มี transaction ในชีต ลบแถวที่เพิ่งสร้างทิ้งเองยิ่งเสี่ยงกว่า)
 */
function approveCustomerRequest(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var reqId = payload.requestId;
  if (!reqId) return { success: false, message: 'ไม่ได้ระบุคำขอ' };

  // ★ บังคับเลือกกลุ่มราคา — เหตุผลเต็มอยู่หัวไฟล์ ("อนุมัติแล้วต้องขายได้จริง")
  var groupId = _crNum(payload.groupId);
  if (!groupId) return { success: false, message: 'กรุณาเลือกกลุ่มลูกค้า (กลุ่มราคา) ก่อนอนุมัติ — ร้านที่ไม่มีกลุ่มจะเปิดบิลไม่ได้' };

  return _withDocLock(function() {
    var req = null;
    centralObjects('customer_requests').forEach(function(r) { if (String(r.record_id) === String(reqId)) req = r; });
    if (!req) return { success: false, message: 'ไม่พบคำขอนี้' };
    if (String(req.status || CR_PENDING) !== CR_PENDING) {
      return { success: false, message: 'คำขอนี้ถูก' + (CR_STATUS_LABELS[String(req.status)] || 'ดำเนินการ') + 'ไปแล้ว' };
    }
    var scope = _effectiveTenantId(session, payload);
    if (scope && String(req.tenant_id) !== String(scope)) {
      return { success: false, message: 'คำขอนี้ไม่ใช่ของตัวแทนที่กำลังดูแลอยู่' };
    }

    var tenantId = req.tenant_id || _salesTenantId(session, payload);
    if (!tenantId) return { success: false, message: 'คำขอนี้ไม่มีตัวแทนกำกับ — ติดต่อผู้ดูแลระบบ' };

    var custPayload = _crCustomerPayload(req, payload);
    custPayload.groupId = groupId;
    var built = buildCustomerFields(custPayload, { tenantId: tenantId, actor: session.adminUserId });
    if (!built.ok) return { success: false, message: built.message };

    /* ★★ ลองหาชุดราคาด้วยแถวที่ "ยังไม่ได้เขียน" — resolvePriceListForCustomer รับ object ไม่ใช่ id
       จึงตรวจได้ก่อนสร้างจริง · ไม่เจอ = ไม่อนุมัติ ดีกว่าสร้างร้านที่เปิดบิลไม่ได้แล้วบอกเซลส์ว่าขายได้ */
    var probe = {};
    for (var k in built.fields) if (Object.prototype.hasOwnProperty.call(built.fields, k)) probe[k] = built.fields[k];
    probe.tenant_id = tenantId;
    if (!resolvePriceListForCustomer(probe)) {
      return { success: false, needsPriceList: true,
        message: 'กลุ่มที่เลือกยังไม่มีชุดราคาที่ใช้งานอยู่สำหรับตัวแทนรายนี้ — ร้านนี้จะเปิดบิลไม่ได้ '
               + 'กรุณาเลือกกลุ่มอื่น หรือเปิดใช้งาน/จ่ายชุดราคาให้ตัวแทนก่อน แล้วค่อยอนุมัติ' };
    }

    built.fields.record_id = centralNextId('customers');
    centralAppend('customers', built.fields);

    var now = nowStr();
    centralUpdate('customer_requests', req.record_id, {
      status: CR_APPROVED, group_id: groupId,
      customer_id: built.fields.record_id, customer_code: built.fields.customer_code,
      decided_by: session.adminUserId || '', decided_by_name: session.displayName || session.username || '',
      decided_at: now, seen_at: '', updated_at: now
    });

    // เซลส์เจ้าของคำขอต้องเห็นร้านใหม่ทันทีที่เปิดแอป — ของเดิมในเครื่องเขาไม่มีร้านนี้
    if (req.requested_by) cacheClear('bootstrap', req.requested_by);

    return { success: true, customerId: built.fields.record_id, customerCode: built.fields.customer_code,
      message: 'เปิดร้าน ' + built.fields.customer_code + ' เรียบร้อย — แจ้งเซลส์แล้ว' };
  });
}

/** ไม่อนุมัติ — ต้องมีเหตุผลเสมอ ไม่งั้นเซลส์ไม่รู้ว่าต้องแก้อะไรแล้วส่งคำขอเดิมกลับมาใหม่ */
function rejectCustomerRequest(session, payload) {
  var err = _requirePermission(session, 'customers', 'edit'); if (err) return err;
  payload = payload || {};
  var reason = _crStr(payload.reason);
  if (!reason) return { success: false, message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' };

  return _withDocLock(function() {
    var req = null;
    centralObjects('customer_requests').forEach(function(r) { if (String(r.record_id) === String(payload.requestId)) req = r; });
    if (!req) return { success: false, message: 'ไม่พบคำขอนี้' };
    if (String(req.status || CR_PENDING) !== CR_PENDING) {
      return { success: false, message: 'คำขอนี้ถูก' + (CR_STATUS_LABELS[String(req.status)] || 'ดำเนินการ') + 'ไปแล้ว' };
    }
    var scope = _effectiveTenantId(session, payload);
    if (scope && String(req.tenant_id) !== String(scope)) {
      return { success: false, message: 'คำขอนี้ไม่ใช่ของตัวแทนที่กำลังดูแลอยู่' };
    }
    var now = nowStr();
    centralUpdate('customer_requests', req.record_id, {
      status: CR_REJECTED, reject_reason: reason,
      decided_by: session.adminUserId || '', decided_by_name: session.displayName || session.username || '',
      decided_at: now, seen_at: '', updated_at: now
    });
    // เหมือนตอนอนุมัติ: ผลการพิจารณาเดินทางไปกับ bootstrap ไม่ล้างแคช = เซลส์ไม่เห็นว่าถูกตีกลับ
    if (req.requested_by) cacheClear('bootstrap', req.requested_by);
    return { success: true, message: 'ตีกลับคำขอ ' + (req.request_no || '') + ' แล้ว' };
  });
}
