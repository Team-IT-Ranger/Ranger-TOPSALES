# -*- coding: utf-8 -*-
"""แก้ช่องว่างในข้อความไทยของไฟล์ DBF ที่สร้างไว้แล้ว ให้เป็น 0xA0 — แก้เฉพาะช่องที่ระบุ

ทำไมต้องมีตัวนี้แทนการ rebuild: ไฟล์ `dbf_new/STMAS.dbf` สร้างไว้ตั้งแต่ 3 ต.ค. จากข้อมูล ณ วันนั้น
rebuild ใหม่จะดึงข้อมูลสดมาทับ = เปลี่ยนมากกว่าที่สั่ง (ราคา/หน่วย/สินค้าขยับได้) และต้องมานั่งไล่ว่า
อะไรเปลี่ยนเพราะเจตนา อะไรเปลี่ยนเพราะข้อมูลขยับ · ตัวนี้แตะแค่ไบต์ช่องว่างในช่องที่บอก ตรวจง่าย

★ ไม่แตะช่องว่างที่เป็น padding ท้ายช่อง — ต้องเป็น 0x20 ตามรูปแบบ DBF
★ ตัวสร้าง (build_dbf.py) แก้ให้ใช้ hard_space() แล้วเช่นกัน รันใหม่ก็ได้ของถูก

ใช้:  python .dev/express-dbf/fix_spaces.py <ไฟล์.dbf> <ชื่อฟิลด์> [ชื่อฟิลด์...]
"""
import sys, struct, os, shutil, datetime

sys.stdout.reconfigure(encoding='utf-8')
CODEPAGE = 'cp874'
THAI = range(0xA1, 0xFB)       # ช่วงอักขระไทยใน TIS-620


def fields_of(raw):
    hl = struct.unpack('<H', raw[8:10])[0]
    out, off, pos = [], 32, 1
    while off < hl - 1 and raw[off] != 0x0D:
        fd = raw[off:off + 32]
        name = fd[0:11].split(b'\0')[0].decode()
        length = fd[16]
        out.append((name, chr(fd[11]), pos, length))
        pos += length
        off += 32
    return out


def main(path, names):
    raw = bytearray(open(path, 'rb').read())
    nrec = struct.unpack('<I', raw[4:8])[0]
    hl, rl = struct.unpack('<HH', raw[8:12])
    fields = {f[0]: f for f in fields_of(bytes(raw))}

    for n in names:
        if n not in fields:
            print('ไม่พบฟิลด์ %s ในไฟล์' % n)
            return 1
        if fields[n][1] != 'C':
            print('ฟิลด์ %s ไม่ใช่ชนิดข้อความ (เป็น %s) — ไม่แก้' % (n, fields[n][1]))
            return 1

    bak = path + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    shutil.copy2(path, bak)

    changed = rows = 0
    for i in range(nrec):
        base = hl + i * rl
        touched = False
        for n in names:
            _, _, pos, length = fields[n]
            s = base + pos
            cell = raw[s:s + length]
            content_len = len(cell.rstrip(b'\x20'))        # ตัด padding ออกจากขอบเขตที่จะแตะ
            if content_len == 0:
                continue
            if not any(x in THAI for x in cell[:content_len]):
                continue                                    # ไม่ใช่ข้อความไทย ปล่อยไว้
            for j in range(content_len):
                if cell[j] == 0x20:
                    raw[s + j] = 0xA0
                    changed += 1
                    touched = True
        if touched:
            rows += 1

    open(path, 'wb').write(bytes(raw))
    print('%s' % os.path.basename(path))
    print('  แก้ 0x20 → 0xA0  %d จุด ใน %d แถว (ช่อง: %s)' % (changed, rows, ', '.join(names)))
    print('  สำรองไฟล์เดิมไว้ที่ %s' % os.path.basename(bak))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2:]))
