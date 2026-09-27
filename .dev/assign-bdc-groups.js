/**
 * จัดกลุ่ม/สายวิ่งให้ร้านค้าที่นำเข้าจากระบบเดิมของตัวแทน BDC
 *
 *   BACKEND_URL='<exec url>' ADMIN_TOKEN='<token>' node .dev/assign-bdc-groups.js            # ดูอย่างเดียว
 *   BACKEND_URL='<exec url>' ADMIN_TOKEN='<token>' node .dev/assign-bdc-groups.js --commit   # ลงมือจริง
 *   (ใส่ --tenant XXX ถ้าไม่ใช่ BDC)
 *
 * ทำไมต้องมีสคริปต์ทั้งที่มีหน้าจอ "จัดกลุ่มเป็นชุด" แล้ว: งานรอบนี้มีหลายขั้นเรียงกันและต้องตรวจก่อนทุกขั้น
 * รันจากสคริปต์จึงได้บันทึกว่าทำอะไรไปบ้างครบ และรันซ้ำได้ผลเหมือนเดิม · ทุกขั้นเรียก action ตัวเดียวกับหน้าจอ
 * (previewCustomerBulkAssign / applyCustomerBulkAssign) ไม่มีทางลัดเขียนชีตเอง
 *
 * ★ สิ่งที่อ่านจากไฟล์ต้นทางแล้วพบ (reference/customer_for_bdc.xlsx ชีต customer, 2,039 แถว):
 *   - GroupCode SV11/SV12 ไม่ใช่กลุ่มราคา แต่เป็น "สายวิ่ง" — แบ่งตามจังหวัดเป๊ะ
 *       SV11 = 20,21,22,23 (ชลบุรี ระยอง จันทบุรี ตราด) · SV12 = 24,25,26,27 (ฉะเชิงเทรา ปราจีนบุรี นครนายก สระแก้ว)
 *     เอาไปลง group_id = รายงานตามกลุ่มเพี้ยนทั้งระบบ จึงลง area_code แทน
 *   - ทุกจังหวัดที่ BDC ขายอยู่คือภาคตะวันออก → กลุ่มราคาเดียวกันหมด (สระบุรี 1 ร้านเป็นข้อยกเว้น)
 *   - มี 6 แถวแม่แบบ "ลูกค้าใหม่" ของระบบเดิมติดมาด้วย (CustNo = SV01…SV12 ชื่อ "New") → ปิดใช้งาน ไม่ลบ
 */
const COMMIT = process.argv.includes('--commit');
const _ti = process.argv.indexOf('--tenant');
const TENANT = (_ti !== -1 && process.argv[_ti + 1]) ? process.argv[_ti + 1] : 'BDC';
const ENDPOINT = process.env.BACKEND_URL;
const TOKEN = process.env.ADMIN_TOKEN;
if (!ENDPOINT || !TOKEN) { console.error('ต้องตั้ง BACKEND_URL และ ADMIN_TOKEN'); process.exit(1); }

const wait = ms => new Promise(r => setTimeout(r, ms));
/* UAT คืนหน้า HTML แทน JSON เป็นครั้งคราว (Google หน่วงเวลาเอง ไม่ใช่บั๊กของเรา)
   งานนี้มีหลายขั้นต่อกัน ล้มกลางคันแล้วข้อมูลจะค้างครึ่งๆ จึงต้องลองซ้ำเอง */
const call = async (action, payload, tries) => {
  tries = tries || 3;
  for (var i = 1; i <= tries; i++) {
    var t;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: TOKEN, payload: Object.assign({ tenantId: TENANT }, payload || {}) })
      });
      t = await res.text();
      return JSON.parse(t);
    } catch (e) {
      if (i === tries) return { success: false, message: 'ตอบกลับไม่ใช่ JSON หลังลอง ' + tries + ' ครั้ง: ' + String(t || e).slice(0, 160) };
      console.log('   (คำขอเพี้ยน — ลองใหม่ครั้งที่ ' + (i + 1) + '/' + tries + ')');
      await wait(4000 * i);
    }
  }
};
const die = m => { console.error('\n✗ ' + m); process.exit(1); };

/* จังหวัดตามรหัสมาตรฐานกระทรวงมหาดไทย — ใช้ชี้ว่าร้านอยู่ภาคไหน เพื่อเลือกกลุ่มราคา */
const EAST = ['20', '21', '22', '23', '24', '25', '26', '27'];   // ชลบุรี…สระแก้ว
const CENTRAL = ['19'];                                          // สระบุรี
const ROUTES = { SV11: ['20', '21', '22', '23'], SV12: ['24', '25', '26', '27'] };

(async () => {
  console.log('ตัวแทน: ' + TENANT + ' · โหมด: ' + (COMMIT ? 'ลงมือจริง' : 'ดูอย่างเดียว (ใส่ --commit เพื่อรันจริง)'));

  /* ★ เลือกกลุ่มจาก "กลุ่มที่มีชุดราคาเปิดใช้งานอยู่จริง" ไม่ใช่จากชื่อกลุ่ม
     เจอมาแล้วบน UAT: กลุ่ม 8 "ร้านค้า เหนือ/อีสาน/ตะวันออก/ใต้" กับกลุ่ม 12 "ร้านค้า เหนือ, อีสาน, ตะวันออก, ใต้"
     ชื่อเกือบเหมือนกัน แต่ชุดราคาผูกกับ 12 เท่านั้น — ยัดร้านเข้ากลุ่ม 8 = ยังเปิดบิลไม่ได้อยู่ดี
     และจะไม่มีอะไรฟ้องเลยจนกว่าพนักงานขายจะเปิดบิลไม่ได้หน้าร้าน */
  const gres = await call('listCustomerGroups', {});
  if (!gres.success) die('อ่านกลุ่มลูกค้าไม่ได้: ' + gres.message);
  const gname = {};
  (gres.data || []).forEach(g => gname[String(g.record_id)] = g.name);
  const gidOf = l => (l.customerGroupId !== undefined ? l.customerGroupId : l.customer_group_id);

  const pres = await call('listPriceLists', {});
  if (!pres.success) die('อ่านชุดราคาไม่ได้: ' + pres.message);
  const active = (pres.data || pres.priceLists || []).filter(l => String(l.status) === 'active');
  console.log('\nชุดราคาที่เปิดใช้งานอยู่ ' + active.length + ' ชุด:');
  active.forEach(l => console.log('  ' + l.name + '  → กลุ่ม ' + gidOf(l) + ' ' + (gname[String(gidOf(l))] || '?')));

  const pickGroup = (re, what) => {
    const ids = {};
    active.forEach(l => {
      if (!re.test(String(l.name)) && !re.test(String(gname[String(gidOf(l))] || ''))) return;
      const g = gidOf(l);
      if (g !== '' && g != null) ids[String(g)] = 1;
    });
    const list = Object.keys(ids);
    if (list.length > 1) die('ชุดราคาที่ตรงเงื่อนไข "' + what + '" ชี้ไปหลายกลุ่ม (' + list.join(', ') + ') — ตัดสินใจเองก่อน');
    return list.length ? { record_id: list[0], name: gname[list[0]] || '' } : null;
  };
  const gEast = pickGroup(/ตะวันออก/, 'ภาคตะวันออก');
  const gCentral = pickGroup(/กลาง|กทม/, 'ภาคกลาง');
  if (!gEast) die('ไม่มีชุดราคาที่เปิดใช้งานสำหรับร้านภาคตะวันออก — เปิดใช้งานชุดราคาก่อน ไม่งั้นจัดกลุ่มไปก็ยังขายไม่ได้');
  console.log('\n  ร้านภาคตะวันออก → กลุ่ม ' + gEast.record_id + ' ' + gEast.name);
  console.log('  ร้านภาคกลาง     → ' + (gCentral ? 'กลุ่ม ' + gCentral.record_id + ' ' + gCentral.name : '(ไม่มีชุดราคาที่เปิดใช้ — ข้ามขั้นนี้)'));

  // ── แผนงาน: ทุกขั้นเป็น (ชื่อขั้น, เงื่อนไข, ค่าที่จะตั้ง) ──
  const steps = [
    { name: 'กลุ่มราคา: ร้านภาคตะวันออก',
      conditions: [{ field: 'attr:sourceProvCode', op: 'in', value: EAST.join(',') }],
      set: { group_id: String(gEast.record_id) } }
  ];
  if (gCentral) steps.push({ name: 'กลุ่มราคา: ร้านภาคกลาง (สระบุรี)',
    conditions: [{ field: 'attr:sourceProvCode', op: 'in', value: CENTRAL.join(',') }],
    set: { group_id: String(gCentral.record_id) } });
  Object.keys(ROUTES).forEach(code => steps.push({
    name: 'สายวิ่ง ' + code + ' (จังหวัด ' + ROUTES[code].join(',') + ')',
    conditions: [{ field: 'attr:sourceGroupCode', op: 'eq', value: code }],
    set: { area_code: code } }));
  steps.push({ name: '★ ปิดใช้งานแถวแม่แบบ "ลูกค้าใหม่" ที่ติดมากับการนำเข้า',
    matchType: 'all',
    conditions: [{ field: 'name', op: 'eq', value: 'New' },
                 { field: 'attr:sourceProvCode', op: 'empty', value: '' }],
    set: { status: 'inactive' } });

  let failed = 0;
  for (const st of steps) {
    const body = { matchType: st.matchType || 'all', conditions: st.conditions };
    const pre = await call('previewCustomerBulkAssign', body);
    if (!pre.success) { console.log('\n✗ ' + st.name + ' — ' + pre.message); failed++; continue; }
    const setText = Object.keys(st.set).map(k => k + ' = ' + st.set[k]).join(' · ');
    console.log('\n── ' + st.name);
    console.log('   เข้าเงื่อนไข ' + pre.matched + ' ร้าน (จาก ' + pre.total + ') → ตั้ง ' + setText);
    if (pre.byGroup && pre.byGroup.length)
      console.log('   ตอนนี้อยู่กลุ่ม: ' + pre.byGroup.map(g => g.name + ' ' + g.count).join(' · '));
    if (pre.samples && pre.samples.length)
      console.log('   ตัวอย่าง: ' + pre.samples.slice(0, 3).map(c => (c.code ? c.code + ' ' : '') + c.name).join(' · '));
    if (!pre.matched) { console.log('   (ข้าม — ไม่มีร้านเข้าเงื่อนไข)'); continue; }
    if (!COMMIT) continue;

    const r = await call('applyCustomerBulkAssign', Object.assign({}, body, { set: st.set, confirmCount: pre.matched }));
    if (!r.success) { console.log('   ✗ ' + r.message); failed++; continue; }
    console.log('   ✓ ' + r.message);
  }

  // ── ตรวจผล: ยังเหลือร้านที่ไม่มีกลุ่มอีกไหม (ร้านที่ไม่มีกลุ่ม = เปิดบิลขายไม่ได้) ──
  // op 'empty' นับ '0' เป็นว่างด้วย (group_id = 0 แปลว่ายังไม่ได้จัดกลุ่ม) — ถามอย่างเดียวพอ
  const left = await call('previewCustomerBulkAssign', {
    matchType: 'all', conditions: [{ field: 'group_id', op: 'empty', value: '' }] });
  const stillN = left.success ? left.matched : 0;
  console.log('\n' + (COMMIT ? 'หลังรัน' : 'ตอนนี้') + ': ร้านที่ยังไม่มีกลุ่ม ' + stillN + ' ร้าน' +
    (stillN ? ' ← ร้านเหล่านี้ยังเปิดบิลขายไม่ได้' : ' — ทุกร้านพร้อมขายแล้ว'));
  if (stillN && left.samples)
    console.log('   ตัวอย่าง: ' + left.samples.slice(0, 5)
      .map(c => (c.code ? c.code + ' ' : '') + c.name).join(' · '));

  if (!COMMIT) console.log('\n[ดูอย่างเดียว] ยังไม่ได้แก้อะไร — ใส่ --commit เพื่อรันจริง');
  process.exit(failed ? 1 : 0);
})();
