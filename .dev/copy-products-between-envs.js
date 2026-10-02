/**
 * คัดลอกข้อมูลสินค้า (รายละเอียด + หน่วยขาย) ตามรายการรหัสจากสภาพแวดล้อมหนึ่งไปอีกอัน (ใช้ UAT → prod, 3 ต.ค. 2026)
 *
 *   SRC_URL=… SRC_USER=… SRC_PASS=…  DST_URL=… DST_USER=… DST_PASS=…  \
 *     node .dev/copy-products-between-envs.js 10185 10190 … [--commit]
 *   ไม่ใส่ --commit = ดูอย่างเดียว · รันซ้ำได้ (ส่งเฉพาะช่องที่ต่าง)
 *
 * - จับคู่สินค้าด้วย product_code · ไม่มีปลายทาง = สร้างใหม่ · มีแล้ว = ทับเฉพาะช่องที่ต่าง
 * - กลุ่มสินค้า: จับคู่ด้วย "ชื่อกลุ่ม" (รหัสกลุ่มคนละ env ไม่ตรงกัน) · ไม่มีกลุ่มปลายทางจะสร้างให้
 * - หน่วยขาย (product_units): เพิ่ม/แก้ให้ตรงต้นทาง (factor/ราคา/ชื่อ/สถานะ/บาร์โค้ด) ต่อรหัสหน่วย
 * - ช่อง true/false (is_stock ฯลฯ) ส่งเฉพาะเมื่อต้นทางมีค่า — ค่าว่างมีความหมาย ("ใช่"/"ลดได้") ห้ามส่ง '' ไปให้ตัวแปลงกลายเป็น TRUE
 * - ไม่คัดลอก: รูปภาพ, ราคาซื้อล่าสุด, สต็อก, has_transactions (ของแต่ละ env เอง)
 */
const COMMIT = process.argv.includes('--commit');
const codes = process.argv.slice(2).filter(a => !a.startsWith('--'));
const E = k => process.env[k];
for (const k of ['SRC_URL', 'SRC_USER', 'SRC_PASS', 'DST_URL', 'DST_USER', 'DST_PASS']) if (!E(k)) { console.error('ต้องตั้ง ' + k); process.exit(1); }
if (!codes.length) { console.error('ระบุรหัสสินค้าที่จะคัดลอก'); process.exit(1); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const norm = c => { const x = String(c || '').trim().toUpperCase(); return { CASE: 'CT', PACK: 'PK', PCS: 'PC' }[x] || x; };
const same = (a, b) => String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
const sameNum = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.0001;
const bool = v => v === true || String(v).toUpperCase() === 'TRUE';

async function post(url, body) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
      return JSON.parse(await res.text());
    } catch (e) { last = e; await wait(3000 * (i + 1)); }
  }
  throw last;
}
async function connect(url, user, pass) {
  const l = await post(url, { action: 'adminLogin', payload: { username: user, password: pass } });
  if (!l.token) throw new Error('ล็อกอินไม่สำเร็จ: ' + JSON.stringify(l).slice(0, 150));
  return (action, payload) => post(url, { action, token: l.token, payload: payload || {} });
}

// [payloadKey, column, kind]  kind: s=ข้อความ n=ตัวเลข u=รหัสหน่วย b=true/false(ส่งเมื่อมีค่า)
const FIELDS = [
  ['name', 'name', 's'], ['nameEn', 'name_en', 's'], ['basePrice', 'base_price', 'n'], ['unit', 'unit', 's'], ['unitCode', 'unit_code', 'u'],
  ['barcode', 'barcode', 's'], ['groupBarcode', 'group_barcode', 's'], ['costPrice', 'cost_price', 'n'],  /* vat_type ไม่คัดลอก: คอลัมน์เก่าที่ไม่มีโค้ดอ่าน (ค่าตั้งต้นต่างกันแล้วเป็น diff ลวง) */
  ['taxStatus', 'tax_status', 's'], ['externalCode', 'external_code', 's'], ['salesUnitCode', 'sales_unit_code', 'u'],
  ['purchaseUnitCode', 'purchase_unit_code', 'u'], ['salesUnitFactor', 'sales_unit_factor', 'n'], ['purchaseUnitFactor', 'purchase_unit_factor', 'n'],
  ['cartonBarcode', 'carton_barcode', 's'], ['packingText', 'packing_text', 's'], ['weightKg', 'weight_kg', 'n'], ['reorderPoint', 'reorder_point', 'n'],
  ['note', 'note', 's'], ['isStock', 'is_stock', 'b'], ['isSellable', 'is_sellable', 'b'], ['isPurchasable', 'is_purchasable', 'b'], ['noDiscount', 'no_discount', 'b']
];
const sameField = (kind, a, b) => kind === 'n' ? sameNum(a, b) : kind === 'u' ? same(norm(a), norm(b)) : kind === 'b' ? bool(a) === bool(b) : same(a, b);

(async () => {
  const src = await connect(E('SRC_URL'), E('SRC_USER'), E('SRC_PASS'));
  const dst = await connect(E('DST_URL'), E('DST_USER'), E('DST_PASS'));
  const [sp, su, sg, dp, du, dg] = await Promise.all([src('listProductsAdmin'), src('listProductUnits'), src('listProductGroups'), dst('listProductsAdmin'), dst('listProductUnits'), dst('listProductGroups')]);
  for (const r of [sp, su, sg, dp, du, dg]) if (!r.success) throw new Error('อ่านข้อมูลไม่สำเร็จ: ' + r.message);
  let dstGroups = dg.data.slice();
  const srcGroupName = id => (sg.data.find(g => String(g.record_id) === String(id)) || {}).name || '';
  const dstByCode = new Map(); dp.data.forEach(p => dstByCode.set(String(p.product_code).trim(), p));
  const dstAlias = new Map(); dp.data.forEach(p => String(p.alias_codes || '').split(',').map(s => s.trim()).filter(Boolean).forEach(a => dstAlias.set(a, p)));

  const missing = codes.filter(c => !sp.data.find(p => String(p.product_code).trim() === c));
  if (missing.length) throw new Error('ไม่พบในต้นทาง: ' + missing.join(', '));
  const aliasClash = codes.filter(c => !dstByCode.has(c) && dstAlias.has(c));
  // รหัสที่ปลายทางเก็บเป็น "รหัสรอง" ของสินค้าอื่น (เช่น prod รวม 10504 ไว้ใต้ 10503) → ถอดออกจากสินค้านั้นก่อน แล้วสร้างเป็นสินค้าของตัวเอง
  for (const c of aliasClash) {
    const owner = dstAlias.get(c);
    const rest = String(owner.alias_codes || '').split(',').map(x => x.trim()).filter(x => x && x !== c).join(',');
    console.log(`! รหัส ${c} เป็นรหัสรองของ ${owner.product_code} ${owner.name} ในปลายทาง → ถอดออก (alias "${owner.alias_codes}" → "${rest}")`);
    if (COMMIT) { const r = await dst('updateProduct', { id: owner.record_id, aliasCodes: rest }); if (!r.success) throw new Error('ถอด alias ' + c + ': ' + r.message); }
  }

  // กลุ่มสินค้าที่ต้องมีในปลายทาง
  const needGroups = [...new Set(codes.map(c => srcGroupName(sp.data.find(p => String(p.product_code).trim() === c).group_id)).filter(Boolean))];
  const toCreate = needGroups.filter(n => !dstGroups.find(g => g.name === n));
  console.log('กลุ่มสินค้าที่ต้องสร้างในปลายทาง:', toCreate.join(', ') || '(ไม่มี)');
  if (COMMIT) {
    for (const n of toCreate) { const r = await dst('addProductGroup', { name: n, description: (sg.data.find(g => g.name === n) || {}).description || '' }); if (!r.success) throw new Error('สร้างกลุ่ม ' + n + ': ' + r.message); }
    if (toCreate.length) { const r = await dst('listProductGroups'); dstGroups = r.data; }
  }
  const dstGroupId = name => (dstGroups.find(g => g.name === name) || {}).record_id || 0;

  const stats = { created: 0, updated: 0, unchanged: 0, unitAdd: 0, unitUpd: 0 };
  for (const code of codes) {
    const s = sp.data.find(p => String(p.product_code).trim() === code);
    const gName = srcGroupName(s.group_id), gId = COMMIT || !toCreate.includes(gName) ? dstGroupId(gName) : '(สร้างใหม่)';
    let d = dstByCode.get(code), id;
    if (!d) {
      console.log(`+ สร้างสินค้า ${code} ${s.name} [กลุ่ม ${gName}]`);
      stats.created++;
      if (COMMIT) {
        const payload = { productCode: code, groupId: gId };
        FIELDS.forEach(([k, col, kind]) => { if (kind === 'b' ? String(s[col] === '' || s[col] == null ? '' : s[col]) !== '' : true) payload[k] = s[col]; });
        const r = await dst('addProduct', payload);
        if (!r.success) throw new Error('สร้าง ' + code + ': ' + r.message);
        id = r.id;
        const up = {};
        if (String(s.alias_codes || '').trim()) up.aliasCodes = String(s.alias_codes);
        if (!bool(s.is_active)) up.isActive = 'FALSE';
        if (Object.keys(up).length) { const r2 = await dst('updateProduct', Object.assign({ id }, up)); if (!r2.success) throw new Error('แก้ ' + code + ': ' + r2.message); }
      }
    } else {
      id = d.record_id;
      const patch = {}, diff = [];
      FIELDS.forEach(([k, col, kind]) => {
        if (kind === 'b' && (s[col] === '' || s[col] == null)) return;
        if (!sameField(kind, s[col], d[col])) { patch[k] = s[col]; diff.push(`${k}: ${JSON.stringify(d[col])} → ${JSON.stringify(s[col])}`); }
      });
      if (String(gId) !== String(d.group_id) && gId !== '(สร้างใหม่)') { patch.groupId = gId; diff.push(`group: ${d.group_id} → ${gId} (${gName})`); }
      else if (gId === '(สร้างใหม่)') { diff.push(`group: ${d.group_id} → (สร้างใหม่) ${gName}`); }
      const sa = String(s.alias_codes || '').split(',').map(x => x.trim()).filter(Boolean).sort().join(','), da = String(d.alias_codes || '').split(',').map(x => x.trim()).filter(Boolean).sort().join(',');
      if (sa !== da) { patch.aliasCodes = sa; diff.push(`alias: "${da}" → "${sa}"`); }
      if (bool(s.is_active) !== bool(d.is_active)) { patch.isActive = bool(s.is_active) ? 'TRUE' : 'FALSE'; diff.push('active'); }
      if (diff.length) {
        console.log(`~ แก้ ${code} ${d.name}\n    ` + diff.join('\n    '));
        stats.updated++;
        if (COMMIT) { const r = await dst('updateProduct', Object.assign({ id }, patch)); if (!r.success) throw new Error('แก้ ' + code + ': ' + r.message); }
      } else stats.unchanged++;
    }
    // หน่วยขาย
    const sUnits = su.data.filter(u => String(u.product_id) === String(s.record_id));
    for (const u of sUnits) {
      const uc = norm(u.unit_code);
      const cur = d && du.data.find(x => String(x.product_id) === String(d.record_id) && norm(x.unit_code) === uc);
      if (!cur) {
        console.log(`    + หน่วย ${uc} ×${u.unit_factor} @${u.price} "${u.unit_label}"`);
        stats.unitAdd++;
        if (COMMIT) { const r = await dst('addProductUnit', { productId: id, unitCode: uc, unitLabel: u.unit_label, unitFactor: Number(u.unit_factor), price: Number(u.price) || 0, barcode: u.barcode || '' });
          if (!r.success) throw new Error('เพิ่มหน่วย ' + code + ' ' + uc + ': ' + r.message);
          if (!bool(u.is_active)) { const all = await dst('listProductUnits'); const row = all.data.find(x => String(x.product_id) === String(id) && norm(x.unit_code) === uc); if (row) await dst('updateProductUnit', { id: row.record_id, isActive: 'FALSE' }); } }
        continue;
      }
      const patch = {}, diff = [];
      if (!same(cur.unit_label, u.unit_label)) { patch.unitLabel = u.unit_label; diff.push(`ชื่อ "${cur.unit_label}"→"${u.unit_label}"`); }
      if (!sameNum(cur.unit_factor, u.unit_factor)) { patch.unitFactor = Number(u.unit_factor); diff.push(`factor ${cur.unit_factor}→${u.unit_factor}`); }
      if (!sameNum(cur.price, u.price)) { patch.price = Number(u.price) || 0; diff.push(`ราคา ${cur.price}→${u.price}`); }
      if (!same(cur.barcode, u.barcode)) { patch.barcode = u.barcode || ''; diff.push('barcode'); }
      if (bool(cur.is_active) !== bool(u.is_active)) { patch.isActive = bool(u.is_active) ? 'TRUE' : 'FALSE'; diff.push('active'); }
      if (diff.length) {
        console.log(`    ~ หน่วย ${uc}: ` + diff.join(', '));
        stats.unitUpd++;
        if (COMMIT) { const r = await dst('updateProductUnit', Object.assign({ id: cur.record_id }, patch)); if (!r.success) throw new Error('แก้หน่วย ' + code + ' ' + uc + ': ' + r.message); }
      }
    }
  }
  console.log('\nสรุป: สร้างสินค้า', stats.created, '· แก้สินค้า', stats.updated, '· เหมือนเดิม', stats.unchanged, '· เพิ่มหน่วย', stats.unitAdd, '· แก้หน่วย', stats.unitUpd);
  if (!COMMIT) console.log('(ดูอย่างเดียว — ใส่ --commit เพื่อบันทึกจริง)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
