// ตัวช่วยเทสต์: ชีตจำลอง "ตาราง 2 มิติจริง" ของไฟล์ตัวแทน + ตัวอ่านจริงจาก backend/02_helpers.gs
// ★ ทำไมไม่ mock tenantObjects เป็น array of object: ตัวอ่านแบบ "ท้ายตาราง/เฉพาะแถว" (tenantTailObjects, tenantRowsWhere)
//   อ่านด้วย getLastRow/getRange — mock ระดับ object จะไม่เคยรันโค้ดอ่านเลย เทสต์ผ่านทั้งที่ตรรกะไม่เคยถูกใช้
//   ตัวช่วยนี้นับจำนวนเซลล์ที่อ่านจริงด้วย (stats) ไว้ยืนยันว่า "อ่านน้อยลงจริง"
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'backend', '02_helpers.gs'), 'utf8');
const grab = name => { const m = new RegExp('(?:^|\n)function ' + name + String.raw`\([^)]*\) \{[\s\S]*?\r?\n\}`).exec(SRC); if (!m) throw new Error('ไม่พบ ' + name); return m[0]; };

// tables: { ชื่อแท็บ: [object...] } — อ่านสดทุกครั้งที่ขอชีต (เทสต์ push แถวเพิ่มระหว่างทางได้)
function install(ctx, tables, stats) {
  stats = stats || {};
  stats.cellsRead = 0; stats.reads = {};
  ctx.tenantSheet = (tid, name) => {
    vm.runInContext('_hdrMemo = {};', ctx);   // หัวตารางจำไว้ "ต่อคำขอ" — เทสต์เรียกหลายครั้งในโปรเซสเดียว จึงล้างทุกครั้งที่ขอชีต (เหมือนคำขอใหม่)
    const objs = tables[name] || (tables[name] = []);
    const keys = []; objs.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) === -1) keys.push(k); }));
    const hdr = ['record_id'].concat(keys.filter(k => k !== 'record_id'));
    const rows = [hdr].concat(objs.map(o => hdr.map(h => o[h] === undefined ? '' : o[h])));
    const bump = n => { stats.cellsRead += n; stats.reads[name] = (stats.reads[name] || 0) + n; };
    return {
      getName: () => name, getLastRow: () => rows.length, getLastColumn: () => hdr.length,
      getDataRange: () => ({ getValues: () => { bump(rows.length * hdr.length); return rows.map(r => r.slice()); } }),
      getRange: (r, c, nr, nc) => { nr = nr || 1; nc = nc || 1; return {
        getValue: () => { bump(1); return rows[r - 1][c - 1]; },
        getValues: () => { bump(nr * nc); const out = []; for (let i = 0; i < nr; i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return out; } }; }
    };
  };
  ['_sheetHeaders', '_rowToObj', 'sheetObjectsOf', 'tenantObjects', 'tenantRowsWhere', 'tenantRowById', 'tenantTailObjects', '_tailUntil']
    .forEach(n => vm.runInContext(grab(n), ctx, { filename: '02_helpers.gs#' + n }));
  vm.runInContext('var _hdrMemo = {};', ctx);
  return stats;
}
module.exports = { install };
