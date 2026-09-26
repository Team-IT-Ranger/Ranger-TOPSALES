/**
 * ===================== ทะเบียนลูกค้า (customer master) =====================
 * จุดเดียวที่ "ประกอบแถวลูกค้า" ของทั้งระบบ — ทุกทางที่เขียนตาราง customers (แอปมือถือ, แอดมิน, นำเข้าไฟล์)
 * ต้องผ่าน buildCustomerFields() เสมอ ไม่ประกอบ object เองกระจัดกระจาย
 *
 * โครงสร้างนี้ปรับจากการถอดบทเรียนของสองระบบที่ใช้งานจริงมาก่อน (2026-09-26):
 *   - ARMAS.DBF (แฟ้มลูกหนี้ของ Express) — แยกคำนำหน้าออกจากชื่อ, เลขผู้เสียภาษี, เครดิต (วัน/วงเงิน),
 *     พนักงานขายประจำร้าน, เขตการขาย, สถานะ A/I พร้อมวันที่หยุดใช้งาน, และ 4 คอลัมน์ audit (ใครสร้าง/ใครแก้ เมื่อไหร่)
 *   - customer_for_bdc.xlsx (ทะเบียนลูกค้าของโปรแกรมขายเดิมที่ตัวแทนใช้) — แยก "กลุ่มลูกค้า" (ใช้กำหนดราคา)
 *     ออกจาก "ประเภทร้าน/ช่องทาง" และ "รูปแบบการขาย (รถเร่/พรีออเดอร์)", เก็บพิกัด, และมี watermark การ sync
 *
 * กติกาที่ตั้งใจให้ต่างจากต้นแบบ:
 *   - ไม่มีคอลัมน์สำรองแบบ rs1..rs5 / Value1..Value3 (ของ BDC) — ฟิลด์เพิ่มเติมที่ยังไม่ตกผลึกให้ไปอยู่ใน
 *     `attributes` (JSON) แล้วค่อยเลื่อนขึ้นมาเป็นคอลัมน์จริงเมื่อมีโค้ดใช้งานจริง
 *   - ไม่ใส่คอลัมน์ที่ยังไม่มีโค้ดไหนอ่าน (ของ BDC ครึ่งแฟ้มเป็น 0 ทั้งคอลัมน์) — เพิ่มทีหลังได้ใน 1 บรรทัด
 *     เพราะ _ensureColumns() เติมคอลัมน์ท้ายตารางให้เองโดยไม่แตะข้อมูลเดิม
 */

var CUSTOMER_STATUS_ACTIVE = 'active';      // ขายได้ตามปกติ
var CUSTOMER_STATUS_INACTIVE = 'inactive';  // เลิกกิจการ/ไม่ค้าขายแล้ว — ไม่โผล่ในแอปมือถือ
var CUSTOMER_STATUS_BLOCKED = 'blocked';    // ระงับเครดิต — ยังขายสดได้ แต่เปิดบิลเชื่อไม่ได้
var CUSTOMER_STATUSES = [CUSTOMER_STATUS_ACTIVE, CUSTOMER_STATUS_INACTIVE, CUSTOMER_STATUS_BLOCKED];

var CUSTOMER_SALES_MODES = ['van', 'preorder'];   // รถเร่ (ขายจากรถทันที) · พรีออเดอร์ (รับออเดอร์แล้วส่งทีหลัง)
var CUSTOMER_PAYMENT_TYPES = ['cash', 'credit'];
// ประเภทภาษีของลูกค้า: vat = คิด VAT ตามปกติ · exempt = ยกเว้นภาษี · zero = อัตราศูนย์ (ส่งออก)
var CUSTOMER_TAX_TYPES = ['vat', 'exempt', 'zero'];

/** ชื่อเต็มที่ใช้พิมพ์บนเอกสาร = คำนำหน้า + ชื่อ (ARMAS แยก PRENAM ออกจาก CUSNAM ด้วยเหตุผลนี้) */
function customerFullName(c) {
  if (!c) return '';
  var prefix = String(c.name_prefix || '').trim();
  var name = String(c.name || '').trim();
  if (!prefix) return name;
  // คำนำหน้าที่ลงท้ายด้วย . หรือเป็นภาษาอังกฤษ ไม่ต้องเว้นวรรคซ้ำ
  return (prefix + ' ' + name).replace(/\s+/g, ' ').trim();
}

/** สาขาที่ต้องพิมพ์บนใบกำกับภาษี: 00000 = สำนักงานใหญ่ (กฎหมายไทยบังคับให้ระบุ) */
function customerTaxBranchLabel(c) {
  var b = String((c && c.tax_branch_code) || '').trim();
  if (!b) return '';
  return b === '00000' ? 'สำนักงานใหญ่' : ('สาขา ' + b);
}

/** อ่าน attributes (JSON) แบบไม่ล้ม — ข้อมูลเสียหาย/ว่าง คืน {} */
function customerAttributes(c) {
  var raw = String((c && c.attributes) || '').trim();
  if (!raw) return {};
  try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}

function _custStr(v) { return String(v === null || v === undefined ? '' : v).trim(); }

function _custNum(v, fallback) {
  if (v === null || v === undefined || String(v).trim() === '') return fallback;
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? fallback : n;
}

/** เลขผู้เสียภาษีไทย = ตัวเลข 13 หลัก (ตัดขีด/ช่องว่างออกก่อน) — ว่างได้ แต่ถ้าใส่ต้องถูกรูปแบบ */
function normalizeTaxId(v) {
  var s = _custStr(v).replace(/[^0-9]/g, '');
  return s;
}

/** รหัสสาขาผู้เสียภาษี: '', 'สำนักงานใหญ่', '0', '1' → 00000 / 00001 (ข้อมูลเก่าเขียนมาสารพัดแบบ) */
function normalizeTaxBranch(v) {
  var s = _custStr(v);
  if (!s || s === '-' || s === '--') return '';
  if (/สำนักงานใหญ่|head\s*office/i.test(s)) return '00000';
  var digits = s.replace(/[^0-9]/g, '');
  if (!digits) return '';
  while (digits.length < 5) digits = '0' + digits;
  return digits.slice(-5);
}

/**
 * ดัชนีรหัสลูกค้าของตัวแทนรายหนึ่ง { used:{รหัส:1}, max:เลขล่าสุด }
 * นำเข้าไฟล์ทีละพันแถวต้องส่งดัชนีตัวเดียวกันเข้าไปทุกแถว ไม่งั้นกลายเป็นไล่สแกนทั้งตารางต่อ 1 แถว (O(n²))
 */
function customerCodeIndex(tenantId, rows) {
  var idx = { used: {}, max: 0 };
  (rows || centralObjects('customers')).forEach(function(c) {
    if (String(c.tenant_id) !== String(tenantId)) return;
    var code = _custStr(c.customer_code);
    if (!code) return;
    idx.used[code] = 1;
    var m = /^C(\d+)$/.exec(code);
    if (m) { var n = parseInt(m[1], 10); if (n > idx.max) idx.max = n; }
  });
  return idx;
}

/** รหัสลูกค้าถัดไปของตัวแทนรายนี้ — C0001, C0002, … (เลขแยกเล่มต่อตัวแทน เหมือน CUSCOD ของ Express ที่แยกต่อบริษัท) */
function nextCustomerCode(tenantId, rows, idx) {
  var index = idx || customerCodeIndex(tenantId, rows);
  var next = index.max + 1;
  var code = 'C' + ('0000' + next).slice(-4);
  while (index.used[code]) { next++; code = 'C' + ('0000' + next).slice(-4); }
  return code;
}

/**
 * ประกอบ/ตรวจฟิลด์ลูกค้าจาก payload ของหน้าเว็บหรือไฟล์นำเข้า
 *   opts: { tenantId, existing (แถวเดิมตอนแก้ไข), actor (ชื่อ/id คนทำ), rows (แถวทั้งหมด ถ้ามีแล้วไม่ต้องอ่านซ้ำ) }
 * คืน { ok:true, fields } หรือ { ok:false, message }
 * ฟิลด์ที่ payload ไม่ส่งมาตอน "แก้ไข" จะไม่ถูกแตะ (ให้หน้าเว็บส่งเฉพาะช่องที่มีในฟอร์มได้)
 */
function buildCustomerFields(payload, opts) {
  payload = payload || {};
  opts = opts || {};
  var existing = opts.existing || null;
  var f = {};
  var has = function(k) { return Object.prototype.hasOwnProperty.call(payload, k) && payload[k] !== undefined; };
  var pick = function(key, field, fn) {
    if (!has(key)) return;
    f[field] = fn ? fn(payload[key]) : _custStr(payload[key]);
  };

  // ── ชื่อ ──
  if (has('name') || !existing) {
    var name = _custStr(payload.name);
    if (!name) return { ok: false, message: 'กรุณาระบุชื่อลูกค้า' };
    f.name = name;
  }
  pick('namePrefix', 'name_prefix');
  pick('name2', 'name_2');

  // ── การจัดกลุ่ม: กลุ่มลูกค้า (คุมราคา) · ประเภทร้าน/ช่องทาง · รูปแบบการขาย · เขต ──
  if (has('groupId')) f.group_id = _custNum(payload.groupId, 0);
  if (has('channelId')) f.channel_id = _custStr(payload.channelId);
  if (has('salesMode')) {
    var mode = _custStr(payload.salesMode).toLowerCase();
    if (mode && CUSTOMER_SALES_MODES.indexOf(mode) === -1) return { ok: false, message: 'รูปแบบการขายต้องเป็น van หรือ preorder' };
    f.sales_mode = mode;
  }
  pick('areaCode', 'area_code');
  pick('salesmanLineUserId', 'salesman_line_user_id');

  // ── ผู้ติดต่อ ──
  pick('contactName', 'contact_name');
  pick('phone', 'phone');
  pick('email', 'email');

  // ── ภาษี ──
  if (has('taxId')) {
    var tax = normalizeTaxId(payload.taxId);
    if (tax && tax.length !== 13) return { ok: false, message: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก' };
    f.tax_id = tax;
  }
  if (has('taxBranchCode')) f.tax_branch_code = normalizeTaxBranch(payload.taxBranchCode);
  if (has('taxType')) {
    var tt = _custStr(payload.taxType).toLowerCase();
    if (tt && CUSTOMER_TAX_TYPES.indexOf(tt) === -1) return { ok: false, message: 'ประเภทภาษีไม่ถูกต้อง' };
    f.tax_type = tt;
  }

  // ── ที่อยู่ ──
  pick('address', 'address');
  pick('subdistrictId', 'subdistrict_id');
  pick('districtId', 'district_id');
  pick('provinceId', 'province_id');
  if (has('postcode')) f.postcode = _custStr(payload.postcode).replace(/[^0-9]/g, '').slice(0, 5);
  pick('lat', 'lat');
  pick('lng', 'lng');
  pick('shipToAddress', 'ship_to_address');

  // ── เครดิต ──
  if (has('paymentType')) {
    var pt = _custStr(payload.paymentType).toLowerCase();
    if (pt && CUSTOMER_PAYMENT_TYPES.indexOf(pt) === -1) return { ok: false, message: 'ประเภทการชำระต้องเป็น cash หรือ credit' };
    f.payment_type = pt;
  }
  if (has('paymentTermsDays')) {
    var days = _custNum(payload.paymentTermsDays, null);
    if (days === null || days < 0 || days > 365) return { ok: false, message: 'เครดิต (วัน) ต้องเป็นตัวเลข 0–365' };
    f.payment_terms_days = days;
  }
  if (has('creditLimit')) {
    var lim = _custNum(payload.creditLimit, null);
    if (lim === null || lim < 0) return { ok: false, message: 'วงเงินเครดิตต้องเป็นตัวเลขไม่ติดลบ' };
    f.credit_limit = lim;
  }

  // ── สถานะ: เก็บทั้ง status (3 ค่า) และ is_active (ของเดิมที่โค้ดทั้งระบบอ่านอยู่) ให้ตรงกันเสมอ ──
  if (has('status') || has('isActive')) {
    var st;
    if (has('status')) {
      st = _custStr(payload.status).toLowerCase();
      if (CUSTOMER_STATUSES.indexOf(st) === -1) return { ok: false, message: 'สถานะลูกค้าไม่ถูกต้อง' };
    } else {
      st = isNotOff(payload.isActive) ? CUSTOMER_STATUS_ACTIVE : CUSTOMER_STATUS_INACTIVE;
    }
    f.status = st;
    f.is_active = st === CUSTOMER_STATUS_INACTIVE ? 'FALSE' : 'TRUE';   // blocked = ยังขายสดได้ จึงยัง active
    var wasInactive = existing && String(existing.status || '') === CUSTOMER_STATUS_INACTIVE;
    if (st === CUSTOMER_STATUS_INACTIVE && !wasInactive) f.inactive_at = nowStr();
    if (st !== CUSTOMER_STATUS_INACTIVE) f.inactive_at = '';
  }

  pick('note', 'note');
  if (has('attributes')) {
    var attrs = payload.attributes;
    if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch (e) { return { ok: false, message: 'attributes ต้องเป็น JSON' }; } }
    if (attrs && typeof attrs === 'object') f.attributes = JSON.stringify(attrs);
    else f.attributes = '';
  }
  pick('externalCode', 'external_code');
  pick('externalSystem', 'external_system');
  // วันที่ซื้อล่าสุด: ปกติระบบประทับเองตอนบันทึกบิล — รับจาก payload ได้เพื่อยกข้อมูลเก่าเข้ามา (เช่น LASIVC ของ Express)
  if (has('lastSaleAt')) f.last_sale_at = _custStr(payload.lastSaleAt).substring(0, 10);

  var actor = _custStr(opts.actor);
  if (existing) {
    f.updated_at = nowStr();
    if (actor) f.updated_by = actor;
  } else {
    // ── แถวใหม่: เติมค่าตั้งต้นให้ครบทุกคอลัมน์ กันแถวที่มีช่องว่างครึ่งตาราง ──
    var index = opts.codeIndex || customerCodeIndex(opts.tenantId, opts.rows);
    var code = _custStr(payload.customerCode) || nextCustomerCode(opts.tenantId, null, index);
    if (index.used[code]) return { ok: false, message: 'รหัสลูกค้า ' + code + ' ถูกใช้ไปแล้ว' };
    index.used[code] = 1;
    var seq = /^C(\d+)$/.exec(code);
    if (seq) { var sn = parseInt(seq[1], 10); if (sn > index.max) index.max = sn; }
    f.customer_code = code;
    f.tenant_id = opts.tenantId;
    f.created_at = nowStr();
    if (actor) f.created_by = actor;
    ['name_prefix','name_2','channel_id','sales_mode','area_code','salesman_line_user_id','contact_name','phone','email',
     'tax_id','tax_branch_code','tax_type','address','subdistrict_id','district_id','province_id','postcode','lat','lng',
     'ship_to_address','note','attributes','external_code','external_system','inactive_at','last_sale_at','updated_at','updated_by'
    ].forEach(function(k) { if (f[k] === undefined) f[k] = ''; });
    if (f.group_id === undefined) f.group_id = 0;
    if (f.payment_type === undefined) f.payment_type = 'cash';
    if (f.payment_terms_days === undefined) f.payment_terms_days = 0;
    if (f.credit_limit === undefined) f.credit_limit = 0;
    if (f.status === undefined) { f.status = CUSTOMER_STATUS_ACTIVE; f.is_active = 'TRUE'; }
  }
  return { ok: true, fields: f };
}

/** รูปร่างที่ส่งให้หน้าเว็บ (camelCase) — เพิ่มชื่อเต็มที่คำนวณแล้วไปด้วยเพื่อไม่ให้ทุกหน้าคำนวณเอง */
function customerToApi(c) {
  return {
    id: c.record_id, recordId: c.record_id, code: c.customer_code || '',
    namePrefix: c.name_prefix || '', name: c.name || '', name2: c.name_2 || '', fullName: customerFullName(c),
    tenantId: c.tenant_id || '', groupId: _custNum(c.group_id, 0), channelId: c.channel_id || '',
    salesMode: c.sales_mode || '', areaCode: c.area_code || '', salesmanLineUserId: c.salesman_line_user_id || '',
    contactName: c.contact_name || '', phone: c.phone || '', email: c.email || '',
    taxId: c.tax_id || '', taxBranchCode: c.tax_branch_code || '', taxBranchLabel: customerTaxBranchLabel(c), taxType: c.tax_type || '',
    address: c.address || '', subdistrictId: c.subdistrict_id || '', districtId: c.district_id || '', provinceId: c.province_id || '',
    postcode: c.postcode || '', lat: c.lat || '', lng: c.lng || '', shipToAddress: c.ship_to_address || '',
    paymentType: c.payment_type || 'cash', paymentTermsDays: _custNum(c.payment_terms_days, 0), creditLimit: _custNum(c.credit_limit, 0),
    status: c.status || (isNotOff(c.is_active) ? CUSTOMER_STATUS_ACTIVE : CUSTOMER_STATUS_INACTIVE),
    isActive: isNotOff(c.is_active), inactiveAt: c.inactive_at || '',
    note: c.note || '', attributes: customerAttributes(c),
    externalCode: c.external_code || '', externalSystem: c.external_system || '',
    lastSaleAt: c.last_sale_at || '', createdAt: c.created_at || '', updatedAt: c.updated_at || ''
  };
}

/** สถานะลูกค้าเป็นตัวกั้นการขาย: inactive = ขายไม่ได้เลย · blocked = ขายสดได้ แต่เปิดบิลเชื่อไม่ได้ */
function customerSaleGate(customer, paymentType) {
  if (!customer) return null;
  var status = String(customer.status || '').toLowerCase();
  if (!status) status = isNotOff(customer.is_active) ? CUSTOMER_STATUS_ACTIVE : CUSTOMER_STATUS_INACTIVE;
  if (status === CUSTOMER_STATUS_INACTIVE) {
    return { success: false, message: 'ลูกค้า ' + customerFullName(customer) + ' ถูกปิดการใช้งานแล้ว' };
  }
  if (status === CUSTOMER_STATUS_BLOCKED && String(paymentType || '').toLowerCase() === 'credit') {
    return { success: false, message: 'ลูกค้า ' + customerFullName(customer) + ' ถูกระงับเครดิต — ขายได้เฉพาะเงินสด' };
  }
  return null;
}

/** จำนวนวันเครดิตที่ใช้ตั้งวันครบกำหนดของใบแจ้งหนี้ (ARMAS PAYTRM) — ไม่ได้ตั้งไว้ = 0 (ครบกำหนดทันที) */
function customerTermsDays(customer, fallbackDays) {
  var d = _custNum(customer && customer.payment_terms_days, null);
  if (d === null) return fallbackDays === undefined ? 0 : fallbackDays;
  return d;
}

/**
 * ประทับวันที่ขายล่าสุด (เทียบเท่า LASIVC ของ Express) — ใช้หาลูกค้าที่หายไปนานโดยไม่ต้องไล่อ่านบิลทุกใบ
 * เขียนแบบ best-effort: ล้มแล้วไม่ทำให้การบันทึกบิลพัง
 */
function touchCustomerLastSale(customerId, dateStr) {
  if (!customerId) return;
  try {
    var row = null;
    centralObjects('customers').forEach(function(c) { if (String(c.record_id) === String(customerId)) row = c; });
    if (!row) return;
    var d = String(dateStr || '').substring(0, 10) || nowStr().substring(0, 10);
    if (String(row.last_sale_at || '').substring(0, 10) >= d) return;   // มีวันที่ใหม่กว่าอยู่แล้ว
    centralUpdate('customers', row.record_id, { last_sale_at: d });
  } catch (e) {
    Logger.log('touchCustomerLastSale: ' + e);
  }
}
