// พิสูจน์เคสจริง: ใบร่างที่ค้างอยู่ → ศูนย์เลื่อนสถานะจากหน้าแอดมิน → ต้องได้เลขจริง
// ★ UAT ช้าและสะดุดเป็นปกติ — ทุกคำขอต้องลองใหม่เอง ไม่งั้นเทสต์ล้มโดยที่โค้ดไม่ได้ผิด
const URL_ = process.env.UAT_URL, T = 'BDC';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ck = (n, got, want) => {
  const ok = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS ' : 'FAIL ') + n);
  if (!ok) { failed++; console.log('      got  ' + JSON.stringify(got === undefined ? null : got).slice(0, 250));
    if (want !== undefined) console.log('      want ' + JSON.stringify(want).slice(0, 250)); }
};
const post = async (b, tries) => {
  tries = tries || 4;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = AbortSignal.timeout(90000);
      return await (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(b), signal: ctl })).json();
    } catch (e) {
      console.log('   (คำขอสะดุด ลองใหม่ ' + (i + 1) + '/' + tries + ': ' + e.message + ')');
      if (i === tries - 1) throw e;
      await sleep(3000);
    }
  }
};

(async () => {
  const l = await post({ action: 'adminLogin', payload: { username: 'admin', password: 'ChangeMe123!' } });
  const api = async (a, p) => {
    for (let i = 0; i < 5; i++) {
      const r = await post({ action: a, token: l.token, payload: Object.assign({ tenantId: T }, p || {}) });
      if (r && r.success === false && /กำลังบันทึกเอกสาร/.test(r.message || '')) { await sleep(4000); continue; }
      await sleep(600);
      return r;
    }
    return { success: false, message: 'ชนล็อกเอกสาร' };
  };

  // หาใบร่างที่ค้างอยู่ — จำกัดจำนวนให้น้อยเพื่อไม่ให้คำขอหนักจน timeout
  const list = (await api('listSalesOrdersAdmin', { limit: 60 })).data || [];
  const drafts = list.filter(o => String(o.code || '').indexOf('DRAFT-') === 0);
  console.log('บิลที่ถือรหัสชั่วคราวอยู่ ' + drafts.length + ' ใบ: ' +
    drafts.map(o => o.code + '(' + o.status + ')').join(' · ') + '\n');
  if (!drafts.length) { console.log('ไม่มีใบร่างให้ทดสอบ'); process.exit(0); }

  const d = drafts.find(o => String(o.status) === 'draft') || drafts[0];
  const id = d.id;
  const codeOf = async () => ((await api('getSalesOrderAdmin', { id })).order || {}).code || '';
  ck('ตั้งต้น: ใบนี้ถือรหัสชั่วคราว', /^DRAFT-/.test(await codeOf()), true);

  // ★★ เส้นทางที่ทำให้เกิดบั๊ก: ศูนย์เลื่อนสถานะเองจากหน้าแอดมิน
  const r = await api('updateSalesOrderStatus', { id, status: 'confirmed' });
  const after = await codeOf();
  ck('★★★ ศูนย์เลื่อนร่าง → รออนุมัติ: ได้เลขจริง (บั๊กเดิมค้างเป็น DRAFT-)',
    [r.success, /^DRAFT-/.test(after)], [true, false]);
  console.log('   ' + d.code + '  →  ' + after);
  ck('  ข้อความบอกว่าออกเลขอะไรให้', /ออกเลขที่เอกสาร/.test(r.message || ''), true);
  ck('  คืน orderCode กลับมาตรงกัน', r.orderCode, after);

  const r2 = await api('updateSalesOrderStatus', { id, status: 'accepted' });
  ck('★ ขั้นถัดไปไม่ออกเลขใหม่ทับ', await codeOf(), after);

  await api('cancelSalesOrderAdmin', { id, note: 'E2E ทดสอบเลขบิล' });
  console.log('\nยกเลิกบิลทดสอบแล้ว');
  console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})();
