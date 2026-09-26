/**
 * นำเข้าทะเบียนลูกค้าจากไฟล์ของระบบเดิม เข้าโครงสร้าง customers ของเรา
 *
 *   node .dev/import-customers.js --file reference/ARMAS.DBF          --tenant HOUSE --dry
 *   node .dev/import-customers.js --file reference/customer_for_bdc.xlsx --tenant TNKN --dry
 *   BACKEND_URL='<exec url>' ADMIN_TOKEN='<token>' node .dev/import-customers.js --file ... --tenant ...
 *
 * --dry (ค่าตั้งต้น) = อ่านไฟล์ แปลง แล้วรายงานอย่างเดียว ไม่แตะ backend
 * ต้องมี --commit ถึงจะยิงเข้า backend จริง (นำเข้าทับด้วย external_code — รันซ้ำได้ ไม่เกิดแถวซ้ำ)
 *
 * รองรับสองรูปแบบไฟล์:
 *   .dbf  — แฟ้มลูกหนี้ของโปรแกรมบัญชี Express (ARMAS) เข้ารหัส TIS-620
 *   .xlsx — ทะเบียนลูกค้าของโปรแกรมขายเดิมที่ตัวแทนใช้ (customer_for_bdc)
 * ฟิลด์ที่ระบบเรายังไม่มีคอลัมน์ให้ ไม่ทิ้ง — เก็บลง attributes (JSON) ไว้ก่อน
 */
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FILE = arg('--file');
const TENANT = arg('--tenant', '');
const COMMIT = args.includes('--commit');
const LIMIT = parseInt(arg('--limit', '0'), 10) || 0;
if (!FILE) { console.error('ต้องระบุ --file <path>'); process.exit(1); }

/* ── TIS-620 / cp874: 0xA1–0xFB คือ U+0E01–U+0E5B ตรงๆ (ส่วน ASCII เหมือนเดิม) ── */
function decodeTis620(buf) {
  let out = '';
  for (const b of buf) {
    if (b === 0) continue;
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b >= 0xA1 && b <= 0xFB) out += String.fromCharCode(0x0E00 + (b - 0xA0));
    else out += ' ';
  }
  return out;
}

/* ── อ่าน DBF (FoxPro) แบบไม่พึ่งไลบรารี ── */
function readDbf(file) {
  const raw = fs.readFileSync(file);
  const nRec = raw.readUInt32LE(4), hdrLen = raw.readUInt16LE(8), recLen = raw.readUInt16LE(10);
  const fields = [];
  for (let pos = 32; raw[pos] !== 0x0D; pos += 32) {
    fields.push({ name: decodeTis620(raw.slice(pos, pos + 11)).trim(), type: String.fromCharCode(raw[pos + 11]),
      len: raw[pos + 16], dec: raw[pos + 17] });
  }
  const rows = [];
  for (let i = 0; i < nRec; i++) {
    const off = hdrLen + i * recLen;
    if (raw[off] === 0x2A) continue;                       // แถวที่ถูกลบ (*)
    const row = {};
    let p = off + 1;
    for (const f of fields) {
      const slice = raw.slice(p, p + f.len);
      p += f.len;
      if (f.type === 'B' || f.type === 'O') row[f.name] = f.len === 8 ? slice.readDoubleLE(0) : 0;
      else if (f.type === 'N' || f.type === 'F') { const t = decodeTis620(slice).trim(); row[f.name] = t === '' ? '' : Number(t); }
      else if (f.type === 'L') row[f.name] = /[TtYy]/.test(String.fromCharCode(slice[0]));
      else row[f.name] = decodeTis620(slice).trim();
    }
    if (Object.keys(row).some(k => row[k] !== '' && row[k] !== 0 && row[k] !== false)) rows.push(row);
  }
  return { fields, rows };
}

const S = v => String(v === undefined || v === null ? '' : v).trim();
const num = v => { const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const yyyymmdd = v => { const s = S(v).replace(/[^0-9]/g, ''); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : ''; };
const clean = o => { const r = {}; Object.keys(o).forEach(k => { if (o[k] !== '' && o[k] !== undefined && o[k] !== null) r[k] = o[k]; }); return r; };

/* เลขผู้เสียภาษี: แฟ้มเก่าเก็บเป็นข้อความ เลขศูนย์นำหน้าจึงหายไป (13 หลักเหลือ 12) — เติมคืนให้
   ส่วนเลข 10 หลักคือรูปแบบก่อนปี 2555 แปลงเป็น 13 หลักไม่ได้ ส่งคืนเป็น legacy ไว้เก็บใน attributes */
function fixTaxId(v) {
  const d = S(v).replace(/[^0-9]/g, '');
  if (!d) return { taxId: '' };
  if (d.length === 13) return { taxId: d };
  if (d.length === 12) return { taxId: '0' + d };
  return { taxId: '', legacy: d };
}

/* แยกคำนำหน้าออกจากชื่อ (ระบบเดิมพิมพ์รวมกันมาในช่องเดียว) — ชื่อจริงจะได้ค้นหา/เรียงได้ถูก
   และใบกำกับภาษียังพิมพ์ชื่อเต็มได้เหมือนเดิมเพราะเรานำคำนำหน้ามาต่อกลับตอนแสดงผล */
const THAI_PREFIXES = ['บริษัทจำกัด(มหาชน)', 'บริษัท', 'ห้างหุ้นส่วนจำกัด', 'หจก.', 'หจก', 'ห้างหุ้นส่วนสามัญ',
  'ร้านค้า', 'ร้าน', 'สหกรณ์', 'โรงเรียน', 'โรงพยาบาล', 'คุณ', 'นางสาว', 'น.ส.', 'นาง', 'นาย'];
function splitThaiPrefix(full) {
  const name = S(full);
  for (const p of THAI_PREFIXES) {
    if (name.indexOf(p) === 0 && name.length > p.length) {
      return { prefix: p, name: name.slice(p.length).trim() };
    }
  }
  return { prefix: '', name };
}

/* ── ARMAS (Express) → payload ของเรา ── */
function fromArmas(r) {
  const address = [r.ADDR01, r.ADDR02, r.ADDR03].map(S).filter(Boolean).join(' ');
  const terms = num(r.PAYTRM);
  const tax = fixTaxId(r.TAXID);
  // PRENAM มีคำนำหน้าอยู่แล้วเป็นส่วนใหญ่ ที่เหลือแยกออกจากชื่อให้
  let prefix = S(r.PRENAM), name = S(r.CUSNAM);
  if (!prefix) { const sp = splitThaiPrefix(name); prefix = sp.prefix; name = sp.name; }
  return clean({
    externalCode: S(r.CUSCOD), externalSystem: 'express',
    namePrefix: prefix, name: name, name2: S(r.CUSNAM2),
    contactName: S(r.CONTACT), phone: S(r.TELNUM),
    taxId: tax.taxId, address, postcode: S(r.ZIPCOD),
    areaCode: S(r.AREACOD),
    paymentType: terms > 0 ? 'credit' : 'cash', paymentTermsDays: terms, creditLimit: num(r.CRLINE),
    status: S(r.STATUS).toUpperCase() === 'I' ? 'inactive' : 'active',
    lastSaleAt: yyyymmdd(r.LASIVC),
    // ของที่ระบบเรายังไม่มีคอลัมน์ให้ — เก็บไว้ก่อน ไม่ทิ้ง (เลื่อนขึ้นเป็นคอลัมน์จริงได้เมื่อมีโค้ดใช้)
    attributes: clean({ custType: S(r.CUSTYP), taxType: S(r.TAXTYP), taxGroup: S(r.TAXGRP), taxCond: S(r.TAXCOND),
      salesmanCode: S(r.SLMCOD), payCondition: S(r.PAYCOND), payerCode: S(r.PAYER), priceTable: S(r.TABPR),
      stdDiscount: S(r.DISC), glAccount: S(r.ACCNUM), shipToCode: S(r.SHIPTO), deliveryBy: S(r.DLVBY),
      legacyTaxId: tax.legacy,
      sourceCreatedAt: yyyymmdd(r.CREDAT), sourceCreatedBy: S(r.CREBY),
      sourceUpdatedAt: yyyymmdd(r.CHGDAT), sourceUpdatedBy: S(r.USERID) })
  });
}

/* ── customer_for_bdc (โปรแกรมขายเดิม) → payload ของเรา ── */
function fromBdc(r) {
  const address = [r.Addr1, r.Addr2, r.Tumbol].map(S).filter(Boolean).join(' ');
  // ระบบเดิมยัดคำนำหน้าไว้ในคอลัมน์สำรอง Value1 (กรอกไว้แค่ 1%) ที่เหลือแยกออกจากชื่อเอง
  let prefix = S(r.Value1), name = S(r.CustName);
  if (prefix && name.indexOf(prefix) === 0) name = name.slice(prefix.length).trim();
  if (!prefix) { const sp = splitThaiPrefix(name); prefix = sp.prefix; name = sp.name; }
  const terms = num(r.Term);
  const tax = fixTaxId(r.TaxID);
  return clean({
    externalCode: S(r.CustNo), externalSystem: 'bdc',
    namePrefix: prefix, name,
    contactName: [S(r.Contact1), S(r.Contact2)].filter(Boolean).join(' / '), phone: S(r.Phone),
    email: S(r.Email) === '-' ? '' : S(r.Email),
    taxId: tax.taxId, taxBranchCode: S(r.TaxBranchID),
    address, postcode: S(r.Postcode),
    areaCode: S(r.AreaCode),
    salesMode: S(r.BusinessType) === 'VS' ? 'van' : (S(r.BusinessType) === 'OB' ? 'preorder' : ''),
    lat: S(r.Latitude), lng: S(r.Longtitude),
    paymentType: S(r.PayType) === 'CR' ? 'credit' : 'cash', paymentTermsDays: terms, creditLimit: num(r.Limit),
    status: S(r.Status) === '1' ? 'active' : 'inactive',
    attributes: clean({ sourceGroupCode: S(r.GroupCode), sourceShopType: S(r.ShopTypeCode),
      sourceAmphurCode: S(r.AmphurCode), sourceProvCode: S(r.ProvCode), sourceCompanyId: S(r.CompanyID),
      legacyTaxId: tax.legacy,
      oneTime: S(r.OneTime) === '1' ? true : undefined })
  });
}

/* ── อ่านไฟล์ ── */
const ext = path.extname(FILE).toLowerCase();
let src = [], mapper, srcLabel;
if (ext === '.dbf') {
  const d = readDbf(FILE);
  src = d.rows; mapper = fromArmas; srcLabel = 'Express (ARMAS.DBF)';
  console.log('ไฟล์ DBF: ' + d.fields.length + ' คอลัมน์ · ' + d.rows.length + ' แถวที่ยังไม่ถูกลบ');
} else {
  const XLSX = require(path.join(__dirname, 'xlsx.full.min.js'));
  const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer' });
  src = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  mapper = fromBdc; srcLabel = 'โปรแกรมขายเดิม (' + path.basename(FILE) + ')';
  console.log('ไฟล์ Excel: ชีต "' + wb.SheetNames[0] + '" · ' + src.length + ' แถว');
}
if (LIMIT) src = src.slice(0, LIMIT);

/* ── แปลง + ตรวจ ── */
const rows = [], problems = [];
const seen = {};
src.forEach((r, i) => {
  const m = mapper(r);
  if (!S(m.name)) { problems.push('แถว ' + (i + 1) + ': ไม่มีชื่อลูกค้า — ข้าม'); return; }
  if (m.attributes && m.attributes.legacyTaxId) problems.push('แถว ' + (i + 1) + ' (' + m.externalCode + '): เลขภาษีรูปแบบเก่า ' + m.attributes.legacyTaxId.length + ' หลัก — เก็บไว้ใน attributes.legacyTaxId');
  if (m.externalCode) { if (seen[m.externalCode]) problems.push('แถว ' + (i + 1) + ': รหัสต้นทาง ' + m.externalCode + ' ซ้ำ'); seen[m.externalCode] = 1; }
  rows.push(m);
});

const fill = {};
rows.forEach(m => Object.keys(m).forEach(k => { fill[k] = (fill[k] || 0) + 1; }));
console.log('\nที่มา: ' + srcLabel + ' → ตาราง customers ของ Ranger TOPSALES');
console.log('แปลงได้ ' + rows.length + ' แถว จาก ' + src.length + ' แถว');
console.log('\nฟิลด์ที่มีข้อมูล (จาก ' + rows.length + ' แถว):');
Object.keys(fill).sort((a, b) => fill[b] - fill[a]).forEach(k => {
  console.log('  ' + k.padEnd(20) + String(fill[k]).padStart(6) + '  (' + Math.round(fill[k] / rows.length * 100) + '%)');
});
if (problems.length) {
  console.log('\nข้อสังเกต ' + problems.length + ' รายการ (แสดง 15 แรก):');
  problems.slice(0, 15).forEach(p => console.log('  - ' + p));
}
console.log('\nตัวอย่างแถวที่แปลงแล้ว:');
rows.slice(0, 2).forEach(m => console.log(JSON.stringify(m, null, 1)));

if (!COMMIT) {
  console.log('\n[dry run] ยังไม่ได้เขียนอะไรลง backend — ใส่ --commit พร้อม BACKEND_URL/ADMIN_TOKEN เพื่อนำเข้าจริง');
  process.exit(0);
}

/* ── ส่งเข้า backend เป็นก้อน (Apps Script มีเวลาจำกัด 6 นาทีต่อคำขอ) ── */
const BACKEND_URL = process.env.BACKEND_URL, ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!BACKEND_URL || !ADMIN_TOKEN) { console.error('ต้องตั้ง BACKEND_URL และ ADMIN_TOKEN'); process.exit(1); }
if (!TENANT) { console.error('ต้องระบุ --tenant (ตัวแทนที่ลูกค้าชุดนี้สังกัด)'); process.exit(1); }
const CHUNK = 300;

(async () => {
  let created = 0, updated = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const res = await fetch(BACKEND_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'importExpressCustomers', token: ADMIN_TOKEN,
        payload: { tenantId: TENANT, externalSystem: rows[0].externalSystem, rows: part } }) });
    const r = await res.json();
    if (!r.success) { console.error('ก้อนที่ ' + (i / CHUNK + 1) + ' ล้มเหลว: ' + r.message); process.exit(1); }
    created += r.created; updated += r.updated; skipped += r.skipped || 0;
    console.log('ก้อนที่ ' + (i / CHUNK + 1) + ': +' + r.created + ' ~' + r.updated + ' ข้าม ' + (r.skipped || 0));
    (r.errors || []).forEach(e => console.log('   ' + e));
  }
  console.log('\nรวม: เพิ่มใหม่ ' + created + ' · อัปเดต ' + updated + ' · ข้าม ' + skipped);
})();
