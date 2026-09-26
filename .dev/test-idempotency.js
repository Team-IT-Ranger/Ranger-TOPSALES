// รัน: node .dev/test-idempotency.js
// ทดสอบการกันบันทึกซ้ำฝั่งเซิร์ฟเวอร์ (35_idempotency.gs + _idemKey ใน 05_router.gs)
// อาการจริงที่ต้องกันให้ได้: ผู้ใช้กดซ้ำ / เน็ตหลุดหลังบันทึกสำเร็จแล้วส่งใหม่ / คิวออฟไลน์ส่งบิลเดิมซ้ำ
const fs = require('fs'), path = require('path'), vm = require('vm');
const B = f => fs.readFileSync(path.join(__dirname, '..', 'backend', f), 'utf8');

const CACHE = {};
let lockHeld = false, lockAvailable = true;
const ctx = {
  console, JSON, String, Number, Object, Array, Date,
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({
    get: k => (CACHE[k] === undefined ? null : CACHE[k]),
    put: (k, v) => { if (String(v).length > 100000) throw new Error('too big'); CACHE[k] = v; },
    remove: k => { delete CACHE[k]; } }) },
  LockService: { getScriptLock: () => ({
    tryLock: () => { if (!lockAvailable) return false; lockHeld = true; return true; },
    releaseLock: () => { lockHeld = false; } }) }
};
vm.createContext(ctx);
vm.runInContext(B('35_idempotency.gs'), ctx, { filename: '35_idempotency.gs' });
vm.runInContext(/function _idemKey\(who, action, payload\) \{[\s\S]*?\n\}/.exec(B('05_router.gs'))[0], ctx, { filename: '05_router.gs' });

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n   expected ' + JSON.stringify(expected) + '\n   actual   ' + JSON.stringify(actual)));
  if (!ok) failed++;
};

let runs = 0;
const makeOrder = () => { runs++; return { success: true, orderId: runs, orderCode: 'SO-000' + runs, total: 1500 }; };

console.log('\n── ไม่ได้แนบ requestId (แอปรุ่นเก่า) ──');
runs = 0;
ctx.withIdempotency('', makeOrder);
ctx.withIdempotency('', makeOrder);
eq('ทำงานทุกครั้ง ไม่กันอะไร (ของเดิมยังใช้ได้ ไม่พัง)', runs, 2);

console.log('\n── กดซ้ำด้วย requestId เดิม ──');
runs = 0;
const first = ctx.withIdempotency('u1|recordSale|abc', makeOrder);
const second = ctx.withIdempotency('u1|recordSale|abc', makeOrder);
eq('ครั้งแรกบันทึกจริง', [first.success, first.orderCode, runs], [true, 'SO-0001', 1]);
eq('ครั้งที่สองไม่บันทึกซ้ำ — คืนผลใบเดิม', [second.orderCode, second.orderId, runs], ['SO-0001', 1, 1]);
eq('  บอกว่าเป็นการส่งซ้ำ พร้อมเลขที่บิลเดิม', [second.duplicate, /บันทึกไปแล้ว \(SO-0001\)/.test(second.message)], [true, true]);
eq('  ยังเป็น success อยู่ (การกดซ้ำไม่ใช่ความผิดพลาดของผู้ใช้)', second.success, true);

console.log('\n── requestId คนละค่า = คนละความตั้งใจ ──');
runs = 0;
ctx.withIdempotency('u1|recordSale|k1', makeOrder);
ctx.withIdempotency('u1|recordSale|k2', makeOrder);
eq('บันทึกสองใบตามที่ตั้งใจ', runs, 2);

console.log('\n── คนละคน / คนละ action ใช้ id ชนกันได้ ──');
eq('คีย์ผูกกับผู้ใช้และ action ด้วย', [
  ctx._idemKey('u1', 'recordSale', { requestId: 'same' }),
  ctx._idemKey('u2', 'recordSale', { requestId: 'same' }),
  ctx._idemKey('u1', 'restockVan', { requestId: 'same' })
], ['u1|recordSale|same', 'u2|recordSale|same', 'u1|restockVan|same']);
eq('ไม่ส่ง requestId → คีย์ว่าง = ไม่กัน', ctx._idemKey('u1', 'recordSale', {}), '');
eq('รับชื่อ clientRequestId ด้วย (เผื่อฝั่งเรียกใช้คนละชื่อ)', ctx._idemKey('u1', 'recordSale', { clientRequestId: 'z' }), 'u1|recordSale|z');
runs = 0;
ctx.withIdempotency(ctx._idemKey('u1', 'recordSale', { requestId: 'same' }), makeOrder);
ctx.withIdempotency(ctx._idemKey('u2', 'recordSale', { requestId: 'same' }), makeOrder);
eq('  สองคนกดพร้อมกันด้วย id เดียวกัน ไม่ถูกมองว่าซ้ำ', runs, 2);

console.log('\n── รายการที่ล้มเหลว ──');
runs = 0;
let attempt = 0;
const flaky = () => { runs++; attempt++; return attempt === 1 ? { success: false, message: 'สต็อกรถไม่พอ' } : { success: true, orderCode: 'SO-9999' }; };
const bad = ctx.withIdempotency('u1|recordSale|retry', flaky);
const good = ctx.withIdempotency('u1|recordSale|retry', flaky);
eq('ครั้งแรกล้มเหลว → ไม่จำไว้', bad.success, false);
eq('แก้แล้วกดใหม่ด้วย id เดิม ต้องทำงานจริง (ไม่ใช่คืนความล้มเหลวเดิมค้างไว้)', [good.success, good.orderCode, runs], [true, 'SO-9999', 2]);

console.log('\n── สองคำขอมาพร้อมกันเป๊ะ ──');
lockAvailable = false;
const busy = ctx.withIdempotency('u1|recordSale|zzz', makeOrder);
lockAvailable = true;
eq('จับ lock ไม่ได้ → ปฏิเสธ ไม่เสี่ยงบันทึกซ้อน', [busy.success, busy.busy, /รอสักครู่/.test(busy.message)], [false, true, true]);
eq('  และไม่มีการเรียกฟังก์ชันบันทึกเลย', CACHE['idem_u1|recordSale|zzz'], undefined);

console.log('\n── lock ต้องถูกปล่อยทุกทาง ──');
lockHeld = false;
ctx.withIdempotency('u1|recordSale|lock1', makeOrder);
eq('ปล่อย lock หลังทำงานสำเร็จ', lockHeld, false);
try { ctx.withIdempotency('u1|recordSale|lock2', () => { throw new Error('พัง'); }); } catch (e) {}
eq('ปล่อย lock แม้ฟังก์ชันข้างในจะ throw', lockHeld, false);

console.log('\n── รายชื่อ action ที่ต้องกันซ้ำ ──');
eq('บิลขายทั้งสองฝั่งอยู่ในลิสต์', [!!ctx.IDEMPOTENT_ACTIONS.recordSale, !!ctx.IDEMPOTENT_ACTIONS.recordSaleAdmin], [true, true]);
eq('action ที่เขียนทับค่าเดิมไม่ต้องอยู่ในลิสต์', !!ctx.IDEMPOTENT_ACTIONS.updateCustomerAdmin, false);
eq('อายุที่เก็บผลไม่เกินเพดานของ CacheService (6 ชม.)', ctx.IDEMPOTENCY_TTL_SEC <= 21600, true);

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED');
process.exit(failed ? 1 : 0);
