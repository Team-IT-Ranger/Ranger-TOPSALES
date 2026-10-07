/**
 * ลงบัญชีย้อนหลังให้ใบรับของของตัวแทนที่รับไว้ก่อนระบบจะมีสมุดของเขา (ดู backfillGrJournals ใน
 * backend/23_accounting.gs และ docs/tenant-books-design.md ขั้นที่ 1-5)
 *
 *   BACKEND_URL='<exec url>' ADMIN_USER='<username>' ADMIN_PASS='<รหัสผ่าน>' node .dev/run-backfill-gr-journals.js [--commit]
 *
 * ★ ไม่ใส่ --commit = ดูอย่างเดียว ไม่เขียนอะไรเลย (ค่าเริ่มต้น เหมือนสคริปต์อื่นในโฟลเดอร์นี้)
 * ★ ต้องล็อกอินด้วยบัญชี super_admin — action นี้ปฏิเสธบทบาทอื่นทุกบทบาท
 * ★ --commit จะวนรันจนกว่า remaining จะเป็น 0 (backend ทำทีละ 100 ใบกันชนเพดาน 6 นาทีของ Apps Script)
 */
const COMMIT = process.argv.includes('--commit');
const ENDPOINT = process.env.BACKEND_URL, USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASS;
if (!ENDPOINT || !USER || !PASS) {
  console.error('ตองตั้ง BACKEND_URL, ADMIN_USER, ADMIN_PASS ก่อน (ดูตัวอย่างคำสั่งด้านบนของไฟล์นี้)');
  process.exit(1);
}

const wait = ms => new Promise(r => setTimeout(r, ms));
let TOKEN = null;
const call = async (action, payload) => {
  let t;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: TOKEN, payload: payload || {} }) });
      t = await res.text();
      return JSON.parse(t);
    } catch (e) {
      if (i === 3) return { success: false, message: 'ตอบกลับไม่ใช่ JSON: ' + String(t || e).slice(0, 140) };
      await wait(3000 * i);
    }
  }
};

const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const login = await call('adminLogin', { username: USER, password: PASS });
  if (!login.success || !login.token) { console.error('ล็อกอินไม่สำเร็จ: ' + (login.message || 'ไม่ได้ token กลับมา')); process.exit(1); }
  TOKEN = login.token;
  console.log('ล็อกอินสำเร็จ: ' + (login.displayName || USER) + ' (' + (login.roleCode || '?') + ')');
  if (login.roleCode !== 'super_admin') {
    console.error('บัญชีนี้ไม่ใช่ super_admin — backfillGrJournals จะถูกปฏิเสธ');
    process.exit(1);
  }

  let round = 0, totalPosted = 0;
  const allSkipped = [], books = {};
  for (;;) {
    round++;
    const r = await call('backfillGrJournals', COMMIT ? { commit: true } : {});
    if (!r.success) { console.error('\nล้มเหลว: ' + (r.message || JSON.stringify(r))); process.exit(1); }
    console.log('\n--- รอบที่ ' + round + ' ---');
    console.log(r.message);
    (r.data || []).forEach(x => console.log('   ' + x.date + '  ' + x.grNo + '  สมุด ' + (x.book || '(บริษัท)') + '  ' + money(x.amount)));
    (r.skipped || []).forEach(x => allSkipped.push(x));
    Object.keys(r.byBook || {}).forEach(b => { books[b] = (books[b] || 0) + r.byBook[b]; });
    totalPosted += r.posted || 0;
    // ดูอย่างเดียวไม่ได้เขียนอะไร รันซ้ำก็ได้ชุดเดิม — วนต่อเฉพาะตอนลงจริงและยังมีของเหลือ
    if (!COMMIT || !r.remaining) {
      if (!COMMIT && r.remaining) console.log('\n(เหลืออีก ' + r.remaining + ' ใบที่ยังไม่ได้แสดง — รอบนี้ดูอย่างเดียวจึงไม่วนต่อ)');
      break;
    }
    await wait(1500);
  }

  console.log('\n═══ สรุป ═══');
  console.log((COMMIT ? 'ลงบัญชีย้อนหลังแล้ว ' : 'จะลงบัญชีย้อนหลัง ') + totalPosted + ' ใบ');
  Object.keys(books).forEach(b => console.log('   สมุด ' + (b || '(บริษัท)') + ': ' + money(books[b])));
  if (allSkipped.length) {
    console.log('ข้าม ' + allSkipped.length + ' ใบ:');
    allSkipped.forEach(x => console.log('   ' + x.grNo + ' — ' + x.why));
  }
  if (!COMMIT) console.log('\n★ ยังไม่ได้เขียนอะไรลงระบบ — เติม --commit เพื่อลงจริง');
})();
