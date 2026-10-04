"""สร้าง STMAS_new.dbf / stloc_new.dbf จากสินค้าบน prod (อ่านอย่างเดียว) — ไม่แตะไฟล์ต้นฉบับ
ข้อมูลต้นทาง: prod_products.json (listProductsAdmin/listProductUnits) + pl_prod_5_full.json (ชุดราคาที่ BDC ใช้) + ราคา Pao Pao จาก PDF (ใส่เป็นค่าคงที่ด้านล่าง)
"""
import json, struct, sys, os, datetime
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r'G:\Shared drives\AppSpace\Ranger-TOPSALES\reference'
OUT = os.path.join(SRC, 'dbf_new')
os.makedirs(OUT, exist_ok=True)
TODAY = datetime.date.today().strftime('%Y%m%d')
USER = 'BIT9'
LOC = 'DCGW'
CODEPAGE = 'cp874'

DATA = os.path.join(HERE, 'data')   # สร้างด้วย fetch-prod-data.js (ไม่ commit)
prod = json.load(open(os.path.join(DATA, 'prod_products.json'), encoding='utf-8'))
pl5 = json.load(open(os.path.join(DATA, 'pl_prod_5_full.json'), encoding='utf-8'))

# ---- Pao Pao: ราคา "ร้านค้าทั่วไป" ขั้น 1-3 ลัง รวม VAT ต่อลัง (ใบรายการขาย พ.ย.-ธ.ค. 2569 หน้า 1) · ใช้กับทุกตัวแทน
PAOPAO_CARTON = {  # กลุ่ม: (เงินสด, เครดิต, ราคาตั้งก่อน VAT ต่อลัง)
    'mini': (372.00, 382.00, 403.74),
    'regular': (496.00, 506.00, 1069.16),
    'jumbo': (1056.00, 1066.00, 1342.06),
}
PAOPAO_GROUP = {'10257': 'mini', '10258': 'mini', '10259': 'mini',
                '10263': 'regular', '10264': 'regular', '10265': 'regular',
                '10267': 'jumbo', '10268': 'jumbo', '10269': 'jumbo', '10270': 'jumbo'}
# บาร์โค้ด "แพ็ค" จาก PDF (ตรวจ check digit EAN-13 ด้านล่าง)
PAOPAO_BARCODE = {'10257': '8858786202512', '10258': '8858786202536', '10259': '8858786202550',
                  '10263': '8858786202604', '10264': '8858786202611', '10265': '8858786202628',
                  '10267': '8858786202642', '10268': '8858786202659', '10269': '8858786202666', '10270': '8858786202673'}
# สินค้าที่ไม่มีในชุดราคา แต่ราคาตั้งเท่ากับสินค้าอีกรหัส (ตรวจ base_price ตรงกัน) → ใช้ราคาของรหัสนั้น
PRICE_FROM = {'10820': '10815', '10821': '10816', '10822': '10813'}

def ean_ok(s):
    d = [int(c) for c in s]
    return (10 - (sum(d[i] * (1 if i % 2 == 0 else 3) for i in range(12)) % 10)) % 10 == d[12]
for c, b in PAOPAO_BARCODE.items():
    assert len(b) == 13 and ean_ok(b), (c, b)

# ---- ชุดราคา 5: product_code -> (ราคาเงินสด/ลัง, เครดิต/ลัง, caseFactor) ขั้นต่ำสุด
line_price = {}
for ln in pl5['lines']:
    t = sorted(ln['tiers'], key=lambda x: x['min'])[0]
    for p in ln['products']:
        line_price[str(p['productCode'])] = (t['cashInclVat'], t['creditInclVat'], ln['caseFactor'], t['min'], ln['listExVat'])

units = {}
for u in prod['units']:
    units.setdefault(u['product_id'], {})[u['unit_code']] = u

# ---- DBF helpers
def read_dbf(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    hl, rl = struct.unpack('<HH', b[8:12])
    fs, i = [], 32
    while b[i] != 0x0D:
        name = b[i:i+11].split(b'\0')[0].decode()
        fs.append((name, chr(b[i+11]), b[i+16], b[i+17]))   # ชื่อ ชนิด ความยาว ทศนิยม
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
    assert len(raw) <= w, ('too long', v, w)
    return raw.ljust(w, b' ')

def make_record(fs, values):
    out = b' '
    for name, t, w, dec in fs:
        out += enc_field(t, w, dec, values.get(name))
    return out

def cut(s, w):
    s = (s or '').strip()
    while len(s.encode(CODEPAGE)) > w:
        s = s[:-1]
    return s

def write_dbf(path, head, recs, rl):
    h = bytearray(head)
    d = datetime.date.today()
    h[1], h[2], h[3] = d.year - 1900, d.month, d.day
    h[4:8] = struct.pack('<I', len(recs))
    open(path, 'wb').write(bytes(h) + b''.join(recs) + b'\x1a')

# ---- สร้างค่าต่อสินค้า
rows, report = [], []
active = [p for p in prod['products'] if str(p.get('is_active')).lower() != 'false']
for p in sorted(active, key=lambda x: int(x['product_code'])):
    code = str(p['product_code'])
    uu = units.get(p['record_id'], {})
    ct = uu.get('CT')
    assert ct, ('no CT unit', code)
    ctf = float(ct['unit_factor'])
    # ตารางหน่วยที่เจ้าของระบบยืนยัน 3 ต.ค. 2026 (1 CT = ? PC): กาว 10503/10504 = 50 PC (10 ซองใหญ่ × 5 ซองเล็ก) · ในระบบเรายังเป็น 500 → Express ใช้ค่าที่ยืนยัน
    CT_OVERRIDE = {'10503': 50.0, '10504': 50.0}
    sys_ctf = ctf
    ctf = CT_OVERRIDE.get(str(p['product_code']), ctf)
    paopao = code in PAOPAO_GROUP
    note = ''
    if paopao:
        cash_ct, credit_ct, list_ex = PAOPAO_CARTON[PAOPAO_GROUP[code]]
        src = 'PDF Pao Pao ร้านค้าทั่วไป ขั้น 1-3 ลัง'
        qucod = 'PK'
        expect = {'mini': 6, 'regular': 8, 'jumbo': 4}[PAOPAO_GROUP[code]]
        assert ctf == expect, (code, ctf, expect)
    else:
        key = PRICE_FROM.get(code, code)
        assert key in line_price, ('no price', code)
        cash_ct, credit_ct, case_f, mn, list_ex = line_price[key]
        src = 'ชุดราคา 5 (เหนือ/อีสาน/ตะวันออก/ใต้) ขั้น %d ลัง' % mn + (' [ใช้ราคาของ %s]' % key if code in PRICE_FROM else '')
        qucod = 'PC'
        if case_f and float(case_f) != ctf:
            note = 'factor ชุดราคา %s ≠ ที่ใช้ %s (ในระบบ %s)' % (case_f, ctf, sys_ctf)
    # Express เก็บ "ราคาตั้งต่อหน่วยขาย ก่อนหักส่วนลด ไม่รวม VAT" (ส่วนลดแสดงแยกในช่องส่วนลดของเอกสาร) → SELLPR1 = SELLPR2 = ราคาตั้งต่อลัง ÷ factor ลัง
    if abs(float(list_ex) - float(p.get('base_price') or 0)) > 0.011:
        note = (note + ' ' if note else '') + 'ราคาตั้งในชุดราคา %s ≠ base_price %s' % (list_ex, p.get('base_price'))
    if abs(float(list_ex) - float(p.get('base_price') or 0)) <= 0.011:
        list_ex = round(float(p['base_price']), 2)   # ใช้ base_price (ปัดสตางค์แล้ว) แทนค่าที่มีเศษจากสูตร Excel ในชุดราคา
    sell1 = sell2 = round(float(list_ex) / ctf, 4)
    pu = p.get('purchase_unit_code') or 'CT'
    barcode = PAOPAO_BARCODE.get(code) if paopao else (p.get('barcode') or '')
    v = {
        'STKCOD': cut(code, 20), 'STKDES': cut(p['name'], 50), 'STKDES2': cut(p.get('name_en'), 50),
        'STKTYP': '0', 'STKGRP': 'NFT', 'BARCOD': cut(barcode, 20), 'ACCCOD': 'ST01',
        'QUCOD': qucod, 'CQUCOD': 'CT', 'CFACTOR': ctf, 'PQUCOD': pu, 'PFACTOR': ctf if pu == 'CT' else 1,
        'SQUCOD': qucod, 'SFACTOR': 1, 'SELLPR1': sell1, 'SELLPR2': sell2,
        'NUMELEM': 0, 'CREBY': USER, 'CREDAT': TODAY, 'USERID': USER, 'CHGDAT': TODAY,
    }
    rows.append(v)
    report.append((code, p['name'][:28], qucod, ctf, list_ex, sell1, sell2, src, note))

# ---- STMAS: รวมกับของเดิม (รหัสซ้ำ = ทับ)
head, fs, old, rl = read_dbf(os.path.join(SRC, 'STMAS.dbf'))
new_codes = {r['STKCOD'] for r in rows}
kept = [r for r in old if r[1:21].decode(CODEPAGE, 'replace').strip() not in new_codes]
replaced = len(old) - len(kept)
out_recs = kept + [make_record(fs, r) for r in rows]
assert all(len(r) == rl for r in out_recs)
write_dbf(os.path.join(OUT, 'STMAS.dbf'), head, out_recs, rl)

# ---- stloc
head2, fs2, old2, rl2 = read_dbf(os.path.join(SRC, 'stloc.dbf'))
def key2(r):
    return (r[1:21].decode(CODEPAGE, 'replace').strip(), r[21:25].decode(CODEPAGE, 'replace').strip())
new_keys = {(r['STKCOD'], LOC) for r in rows}
kept2 = [r for r in old2 if key2(r) not in new_keys]
loc_recs = [make_record(fs2, {'STKCOD': r['STKCOD'], 'LOCCOD': LOC, 'STATUS': 'A'}) for r in rows]
out2 = kept2 + loc_recs
assert all(len(r) == rl2 for r in out2)
write_dbf(os.path.join(OUT, 'stloc.dbf'), head2, out2, rl2)

print('STMAS: เดิม %d แถว · ทับ %d · ใหม่รวม %d' % (len(old), replaced, len(out_recs)))
print('stloc: เดิม %d แถว · ใหม่รวม %d' % (len(old2), len(out2)))
for r in report:
    print(' | '.join(str(x) for x in r))
json.dump(report, open(os.path.join(DATA, 'dbf_report.json'), 'w', encoding='utf-8'), ensure_ascii=False)
