# -*- coding: utf-8 -*-
"""สร้าง ARMAS.DBF (ทะเบียนลูกหนี้) + ARBAL.DBF (ยอดลูกหนี้) จากลูกค้าบน prod — ไม่แตะไฟล์ต้นฉบับ

ต้นทาง: data/armas_source.json (สร้างด้วย fetch-armas-source.js)
ปลายทาง: reference/dbf_new/ARMAS.DBF, ARBAL.DBF

★ หัวไฟล์ (field descriptor) ยกมาจากแม่แบบจริงทั้งก้อน แก้แค่วันที่กับจำนวนเรคคอร์ด
  — วิธีเดียวกับ build_dbf.py ของ STMAS · โครงสร้างจึงตรงกับที่ Express คาดไว้แน่นอน
  แม่แบบ ARMAS.DBF ที่เจ้าของระบบส่งมามี 39 ฟิลด์ (ของเดิมในระบบมี 38 — เพิ่ม ORGNUM)

★★ ช่องว่างในข้อความไทยต้องเป็นไบต์ 0xA0 ไม่ใช่ 0x20 (เจ้าของระบบสั่ง 6 ต.ค. 2026)
  Express ชดเชยสระ/วรรณยุกต์ตอนพิมพ์รายงาน ช่องว่างธรรมดาเลยทำให้ข้อความกระโดด
  ยืนยันจากแฟ้มจริงแล้วว่าเขาใช้ 0xA0 คั่นคำไทย 2,969 ครั้ง (ดู NBSP ด้านล่าง)
"""
import json, struct, sys, os, datetime

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('EXPRESS_REF', r'G:\Shared drives\AppSpace\Ranger-TOPSALES\reference')
OUT = os.path.join(SRC, 'dbf_new')
os.makedirs(OUT, exist_ok=True)
CODEPAGE = 'cp874'
NBSP = '\u00a0'          # cp874 0xA0 — "ช่องว่างแข็ง" ที่ Express ใช้ในข้อความไทย
TODAY = datetime.date.today().strftime('%Y%m%d')
USER = 'BIT9'

# ── ค่าคงที่: เจ้าของระบบสั่งให้ยึด "ตามแม่แบบ" ทุกรายการ (6 ต.ค. 2026) ──
# ของจริงในระบบเดิมใช้ CUSTYP=TT / TABPR=4 / DLVBY=01 แต่ของใหม่ให้ใช้ตามแม่แบบ CJ0001
CONST = {
    'CUSTYP': '00',
    'TABPR':  '1',
    'ACCNUM': '1130-01',
    'DLVBY':  '', 'SLMCOD': '', 'AREACOD': '',
    # กลุ่ม 4 — ว่างทั้ง 1,106 รายในระบบเดิม จึงปล่อยว่างตาม
    'TAXTYP': '', 'TAXGRP': '', 'TAXCOND': '', 'TRACKSAL': '',
    'SHIPTO': '', 'PAYER': '', 'DISC': '', 'CUSNAM2': '',
}
# ช่องที่เป็นข้อความไทย → ต้องแปลงช่องว่างเป็น 0xA0
THAI_FIELDS = {'PRENAM', 'CUSNAM', 'CUSNAM2', 'ADDR01', 'ADDR02', 'ADDR03'}

# ★ คำนำหน้าที่ยาวเกินช่อง PRENAM (15 ไบต์) → ใช้ตัวย่อที่ Express ใช้อยู่แล้ว ไม่ใช่ตัดกลางคำ
#   'ห้างหุ้นส่วนจำกัด' = 17 ไบต์ ตัดตรงๆ ได้ 'ห้างหุ้นส่วนจำก' ซึ่งอ่านไม่รู้เรื่องบนใบกำกับภาษี
#   แฟ้มเดิมของ Express ใช้ 'หจก.' 159 ราย — และมี 2 รายที่โดนตัดพังแบบนี้อยู่จริง (เคยพลาดมาก่อน)
PRENAM_ABBR = {
    'ห้างหุ้นส่วนจำกัด': 'หจก.',
    'ห้างหุ้นส่วนสามัญ': 'หสน.',
    'บริษัทจำกัด(มหาชน)': 'บมจ.',
}


def read_dbf(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    hl, rl = struct.unpack('<HH', b[8:12])
    fs, i = [], 32
    while b[i] != 0x0D:
        fs.append((b[i:i+11].split(b'\0')[0].decode(), chr(b[i+11]), b[i+16], b[i+17]))
        i += 32
    recs = [b[hl + r*rl: hl + (r+1)*rl] for r in range(n)]
    return b[:hl], fs, recs, rl


def enc_field(t, w, dec, v):
    if t == 'B':
        return struct.pack('<d', float(v or 0))
    if t == 'N':
        s = ('%d' % int(v or 0)) if dec == 0 else ('%.*f' % (dec, float(v or 0)))
        return s.rjust(w)[:w].encode('ascii')
    if t == 'D':
        return (v or '').ljust(8).encode('ascii')
    raw = (v or '').encode(CODEPAGE)
    assert len(raw) <= w, ('ยาวเกินช่อง', v, w)
    return raw.ljust(w, b' ')


def make_record(fs, values):
    out = b' '
    for name, t, w, dec in fs:
        out += enc_field(t, w, dec, values.get(name))
    return out


DROPPED = []           # [(รหัสลูกค้า, ช่อง, อักขระ)] — รายงานท้ายการรัน


def tis620(s, code='', field=''):
    """ตัดอักขระที่ TIS-620 เขียนไม่ได้ทิ้ง แล้วจดไว้รายงาน
    ★ ไม่เดาตัวแทน — ข้อมูลต้นทางมีพิมพ์ผิดจริง (เช่น '238ม.÷' ที่ควรเป็นเลขหมู่)
      เดาให้แล้วจะกลายเป็นที่อยู่ผิดบนทะเบียนลูกหนี้โดยไม่มีใครรู้ · ปล่อยให้คนแก้ที่ต้นทาง
    ★ และต้องไม่ปล่อยให้ throw — ไฟล์ทั้งก้อนจะสร้างไม่ได้เพราะอักขระเดียวของร้านเดียว"""
    out = []
    for ch in (s or ''):
        try:
            ch.encode(CODEPAGE)
            out.append(ch)
        except Exception:
            DROPPED.append((code, field, ch))
    return ''.join(out)


def cut(s, w):
    """ตัดให้พอดีช่อง โดยนับเป็นไบต์ cp874 (ไทย 1 ไบต์/ตัวอักษร)"""
    s = (s or '').strip()
    while len(s.encode(CODEPAGE)) > w:
        s = s[:-1]
    return s


def hard_space(s):
    """ช่องว่างในข้อความไทย → 0xA0 · ยุบช่องว่างซ้อนก่อน ไม่งั้นได้ 0xA0 ติดกันหลายตัว"""
    return NBSP.join((s or '').split())


def write_dbf(path, head, recs, rl):
    h = bytearray(head)
    d = datetime.date.today()
    h[1], h[2], h[3] = d.year - 1900, d.month, d.day
    h[4:8] = struct.pack('<I', len(recs))
    open(path, 'wb').write(bytes(h) + b''.join(recs) + b'\x1a')


# ═══════════════════════════════════════════════════════════════
rows = json.load(open(os.path.join(HERE, 'data', 'armas_source.json'), encoding='utf-8'))

# แถวขยะจากระบบเดิม: CustNo = SV01..SV12 ชื่อ "New" (CLAUDE.md จดไว้แล้ว ปิดใช้งานในระบบเราแล้ว)
JUNK = {'SV01', 'SV02', 'SV03', 'SV04', 'SV11', 'SV12'}
skipped = [r for r in rows if r['externalCode'] in JUNK]
rows = [r for r in rows if r['externalCode'] not in JUNK]

head, fs, _, rl = read_dbf(os.path.join(SRC, 'ARMAS.DBF'))
assert len(fs) == 39, 'แม่แบบ ARMAS.DBF ควรมี 39 ฟิลด์ แต่พบ %d' % len(fs)

recs, warn = [], []
for r in rows:
    v = dict(CONST)
    C = r['code']
    T = lambda val, fld: tis620(val, C, fld)
    v['CUSCOD'] = cut(C, 10)
    pre = PRENAM_ABBR.get((r['namePrefix'] or '').strip(), r['namePrefix'])
    v['PRENAM'] = cut(hard_space(T(pre, 'PRENAM')), 15)
    v['CUSNAM'] = cut(hard_space(T(r['name'], 'CUSNAM')), 60)
    v['ADDR01'] = cut(hard_space(T(r['addr01'], 'ADDR01')), 50)
    v['ADDR02'] = cut(hard_space(T(r['addr02'], 'ADDR02')), 50)
    v['ADDR03'] = cut(hard_space(T(r['addr03'], 'ADDR03')), 30)
    v['ZIPCOD'] = cut(T(r['postcode'], 'ZIPCOD'), 5)
    v['TELNUM'] = cut(T(r['phone'], 'TELNUM'), 50)
    ct = T(r['contactName'], 'CONTACT')
    if len(ct.encode(CODEPAGE)) > 40 and '/' in ct:
        first = ct.split('/')[0].strip()
        if len(first.encode(CODEPAGE)) <= 40:
            ct = first          # ชื่อซ้ำสองสะกด เอาชื่อแรกครบๆ ดีกว่าชื่อเดียวที่ขาดครึ่ง
    v['CONTACT'] = cut(hard_space(ct), 40)
    v['TAXID'] = cut(T(r['taxId'], 'TAXID'), 15)
    # สาขาภาษี '00000' = สำนักงานใหญ่ → 0 (แม่แบบใส่ 0)
    v['ORGNUM'] = int(r['taxBranchCode'] or 0) if str(r['taxBranchCode']).isdigit() else 0
    v['PAYTRM'] = r['paymentTermsDays']
    v['CRLINE'] = r['creditLimit']
    v['BALANCE'] = 0
    v['CHQRCV'] = 0
    v['TAXRAT'] = 0
    v['REMARK'] = cut(hard_space(T(r['note'], 'REMARK')), 50)
    v['LASIVC'] = (r['lastSaleAt'] or '')[:10].replace('-', '')[:8]
    v['STATUS'] = 'I' if r['status'] == 'inactive' else 'A'
    v['INACTDAT'] = ''
    v['CREBY'] = USER
    v['CREDAT'] = TODAY
    v['USERID'] = USER
    v['CHGDAT'] = TODAY
    v['PAYCOND'] = ''
    if len(v['CUSNAM'].encode(CODEPAGE)) < len(hard_space(tis620(r['name'])).encode(CODEPAGE))        or len(v['PRENAM'].encode(CODEPAGE)) < len(hard_space(tis620(PRENAM_ABBR.get((r['namePrefix'] or '').strip(), r['namePrefix']))).encode(CODEPAGE))        or len(v['CONTACT'].encode(CODEPAGE)) < len(hard_space(ct).encode(CODEPAGE)):
        warn.append(r['code'])
    recs.append(make_record(fs, v))

write_dbf(os.path.join(OUT, 'ARMAS.DBF'), head, recs, rl)

# ── ARBAL: 1 แถวต่อ 1 รหัส ตัวเลขเป็น 0 ทั้งหมด (ลูกค้าใหม่ไม่มียอดยกมา/ประวัติ) ──
head2, fs2, _, rl2 = read_dbf(os.path.join(SRC, 'ARBAL.DBF'))
assert len(fs2) == 122, 'แม่แบบ ARBAL.DBF ควรมี 122 ฟิลด์ แต่พบ %d' % len(fs2)
recs2 = [make_record(fs2, {'CUSCOD': cut(r['code'], 10)}) for r in rows]
write_dbf(os.path.join(OUT, 'ARBAL.DBF'), head2, recs2, rl2)

print('ARMAS.DBF  %d เรคคอร์ด  (%s)' % (len(recs), os.path.join(OUT, 'ARMAS.DBF')))
print('ARBAL.DBF  %d เรคคอร์ด' % len(recs2))
print('ข้ามแถวขยะ SV01-SV12: %d ราย (%s)' % (len(skipped), ', '.join(s['externalCode'] for s in skipped)))
if warn:
    print('★ ข้อความถูกตัดให้พอดีช่อง %d ราย: %s' % (len(warn), ', '.join(warn[:10])))
if DROPPED:
    print('★ อักขระที่ TIS-620 เขียนไม่ได้ ถูกตัดทิ้ง %d ตัว — ควรแก้ที่ต้นทาง:' % len(DROPPED))
    for code, fld, ch in DROPPED[:20]:
        print('    %s  %s  %r (U+%04X)' % (code, fld, ch, ord(ch)))
