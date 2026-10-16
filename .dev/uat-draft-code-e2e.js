// ทดสอบบน UAT: เลขที่เอกสารตอนพ้นร่าง + ตัวซ่อมของเก่า + ยกเลิกใบลดหนี้/ใบเพิ่มหนี้
// รัน: UAT_URL='<uat exec url>' node .dev/uat-draft-code-e2e.js
//
// ★★ บั๊กที่กำลังพิสูจน์: ศูนย์เลื่อนสถานะเองจากหน้าแอดมิน แล้วเลขบิลค้างเป็น DRAFT-
//   (เจ้าของระบบเห็นบน prod 16 ต.ค. 2026) — ของจริงที่ mock พิสูจน์แทนไม่ได้คือ
//   เลขที่ออกมาจากตัวนับจริงของตัวแทน และเรียงต่อจากเลขล่าสุดจริงๆ
const URL_ = process.env.UAT_URL;
if (!URL_) { console.error('ตั้ง UAT_URL ก่อน'); process.exit(1); }
if (!/AKfycbwsdgUjEe1RQFeuHQ3je92eok/.test(URL_)) { console.error('URL นี้ไม่ใช่ backend ของ UAT — ปฏิเสธ'); process.exit(1); }

const T = process.env.UAT_TENANT || 'BDC';
const CUST = Number(process.env.UAT_CUSTOMER || 1113);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
let failed = 0;
const ck = (n, got, want) => {
  const okNow = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
  console.log((okNow ? 'PASS ' : 'FAIL ') + n);
  if (!okNow) { failed++; console.log('      got  ' + JSON.stringify(got === undefined ? null : got).slice(0, 300));
    if (want !== undefined) console.log('      want ' + JSON.stringify(want).slice(0, 300)); }
};
const post = async b => {
  for (let i = 0; i < 3; i++) {
    try { return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) })).json(); }
    catch (e) { if (i === 2) throw e; }
  }
};

(async () => {
  const login = await post({ action: 'adminLogin', payload: { username: process.env.UAT_USER || 'admin', password: process.env.UAT_PASS || 'ChangeMe123!' } });
  if (!login.success) { console.error('ล็อกอินไม่ผ่าน', login); process.exit(1); }
  const api = async (a, p) => {
    for (let i = 0; i < 6; i++) {
      const r = await post({ action: a, token: login.token, payload: Object.assign({ tenantId: T }, p || {}) });
      if (r && r.success === false && /กำลังบันทึกเอกสาร/.test(r.message || '')) { await sleep(4000); continue; }
      await sleep(650);
      return r;
    }
    return { success: false, message: 'ชนล็อกเอกสารซ้ำหลายครั้ง' };
  };
  const codeOf = async id => {
    const d = await api('getSalesOrderAdmin', { id });
    return ((d.order || {}).code) || ((d.order || {}).orderCode) || '';
  };

  const bills = [];
  try {
    const wh = (await api('listWarehouseStock', {})).data || [];
    const free = wh.filter(w => Number(w.qty) - Number(w.reserved || 0) > 0).sort((a, b) => Number(a.qty) - Number(b.qty))[0];
    if (!free) throw new Error('ไม่มีสินค้าที่ว่างพอให้ทดสอบ');
    const P = free.productId;
    console.log('สินค้า', free.productCode, '· คงเหลือ', free.qty, '\n');

    /* ══ ของเก่าที่ค้างอยู่บน UAT ══ */
    console.log('══ สำรวจของที่ค้างอยู่ ══');
    let dry = await api('repairDraftOrderCodes', { dry: true });
    ck('ดูรายการที่ต้องซ่อมได้', dry.success, true);
    console.log('   พบ ' + (dry.data || []).length + ' ใบที่พ้นร่างแล้วแต่เลขยังเป็น DRAFT-');
    (dry.data || []).slice(0, 5).forEach(x => console.log('     · ' + x.oldCode + ' · ' + x.status + ' · ' + x.createdAt));

    /* ══ บิลใหม่: เลื่อนสถานะจากแอดมิน ต้องได้เลขจริงทันที ══ */
    console.log('\n══ บิลใหม่ที่ศูนย์เลื่อนสถานะเอง ══');
    const b = await api('recordSaleAdmin', { customerId: CUST, paymentType: 'credit_term',
      fulfillmentType: 'office_delivery', items: [{ productId: P, unitCode: 'CT', qty: 1 }], note: 'E2E เลขบิล' });
    if (!b.success) throw new Error('เปิดบิลไม่ได้: ' + b.message);
    bills.push(b.orderId);
    /* ★ บิลที่เปิดจากแอดมินได้เลขจริงตั้งแต่แรกอยู่แล้ว (recordSaleAdmin ออกให้)
       ของที่เป็นปัญหาคือใบร่างจากมือถือ — จำลองไม่ได้จากฝั่งแอดมิน จึงพิสูจน์ด้วยสองอย่างแทน:
       (1) ใบที่มีเลขจริงแล้วต้องไม่ถูกออกเลขใหม่ทับ (2) ตัวซ่อมทำงานกับของเก่าที่ค้างจริง */
    const code0 = await codeOf(b.orderId);
    ck('บิลที่เปิดจากแอดมินมีเลขจริงตั้งแต่แรก', !/^DRAFT-/.test(code0), true);
    let r = await api('updateSalesOrderStatus', { id: b.orderId, status: 'accepted' });
    ck('★ เลื่อนสถานะแล้วเลขเดิมต้องไม่ถูกทับ', [r.success, await codeOf(b.orderId)], [true, code0]);
    ck('  backend คืน orderCode กลับมาให้หน้าจอใช้ต่อ', r.orderCode, code0);
    await api('cancelSalesOrderAdmin', { id: b.orderId, note: 'E2E' });

    /* ══ ซ่อมของเก่า ══ */
    if ((dry.data || []).length) {
      console.log('\n══ ซ่อมของเก่าที่ค้างอยู่ ══');
      const before = dry.data.map(x => x.id);
      r = await api('repairDraftOrderCodes', {});
      ck('★ ซ่อมได้ครบทุกใบที่พบ', [r.success, r.fixed], [true, before.length]);
      const codes = await Promise.all(before.slice(0, 5).map(codeOf));
      ck('★★ ไม่มีใบไหนเหลือเลข DRAFT- อีก', codes.filter(c => /^DRAFT-/.test(c)).length, 0);
      console.log('   เลขใหม่: ' + codes.join(' · '));
      /* ★ เรียงตามลำดับที่เปิดบิล — เลขที่ออกให้ใบเก่ากว่าต้องน้อยกว่าใบใหม่กว่าเสมอ */
      const seq = (r.data || []).map(x => x.newCode);
      ck('★★ เลขเรียงต่อเนื่องตามลำดับที่เปิดบิล',
        seq.every((c, i) => i === 0 || c > seq[i - 1]), true);
      ck('  รันซ้ำไม่มีอะไรให้ซ่อมแล้ว', (await api('repairDraftOrderCodes', {})).fixed, 0);
    } else {
      console.log('\nSKIP  ไม่มีของเก่าค้างบน UAT ให้ซ่อม (ทดสอบตัวซ่อมด้วยเทสต์หน่วยแทน)');
    }

    /* ══ ยกเลิกใบลดหนี้ ══ */
    console.log('\n══ ยกเลิกใบลดหนี้ ══');
    const cn = ((await api('listArCreditNotes', {})).data || []).filter(x => x.status !== 'voided')[0];
    if (!cn) { console.log('SKIP  ไม่มีใบลดหนี้ที่ยังไม่ถูกยกเลิกบน UAT'); }
    else {
      const iv0 = ((await api('listArInvoices', {})).data || []).find(x => String(x.id) === String(cn.invoiceId));
      r = await api('voidArAdjustNote', { id: cn.id, kind: 'credit' });
      ck('★ ไม่ระบุเหตุผล → ปฏิเสธ', !r.success && /เหตุผล/.test(r.message || ''), true);
      r = await api('voidArAdjustNote', { id: cn.id, kind: 'credit', reason: 'E2E ทดสอบยกเลิก' });
      ck('★ ยกเลิกใบลดหนี้ได้ พร้อมกลับรายการบัญชี', r.success && /กลับรายการ/.test(r.message || ''), true);
      const iv1 = ((await api('listArInvoices', {})).data || []).find(x => String(x.id) === String(cn.invoiceId));
      if (iv0 && iv1) ck('★★ ยอดค้างของใบแจ้งหนี้เพิ่มกลับมาเท่ายอดที่เคยลด',
        r2(iv1.outstanding - iv0.outstanding), r2(cn.total));
      ck('  ยกเลิกซ้ำไม่ได้', !(await api('voidArAdjustNote', { id: cn.id, kind: 'credit', reason: 'ซ้ำ' })).success, true);
      const back = ((await api('listArCreditNotes', {})).data || []).find(x => String(x.id) === String(cn.id));
      ck('  แถวใบเดิมยังอยู่ สถานะ voided (เอกสารภาษี ลบไม่ได้)', back && back.status, 'voided');
    }

  } catch (e) {
    console.error('\nผิดพลาด:', e.message);
    failed++;
  }

  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
