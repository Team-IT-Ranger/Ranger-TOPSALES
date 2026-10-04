import struct, sys, os
sys.stdout.reconfigure(encoding='utf-8')
BASE = r'G:\Shared drives\AppSpace\Ranger-TOPSALES\reference'

def rd(p):
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[4:8])[0]
    hl, rl = struct.unpack('<HH', b[8:12])
    fs, i = [], 32
    while b[i] != 0x0D:
        fs.append((b[i:i+11].split(b'\0')[0].decode(), chr(b[i+11]), b[i+16]))
        i += 32
    assert len(b) in (hl + n*rl, hl + n*rl + 1), ('size mismatch', len(b), hl + n*rl)
    print('  ', os.path.basename(p), 'EOF byte 0x1A:', len(b) == hl + n*rl + 1)
    out = []
    for r in range(n):
        rec = b[hl + r*rl: hl + (r+1)*rl]
        assert rec[0:1] == b' '
        off, d = 1, {}
        for a, t, l in fs:
            v = rec[off:off+l]; off += l
            d[a] = struct.unpack('<d', v)[0] if t == 'B' else (v.decode().strip() if t in 'ND' else v.decode('cp874').rstrip(' '))
        out.append(d)
    return b[:hl], fs, out

# โครงสร้างต้องเหมือนต้นฉบับทุกไบต์ (ยกเว้นวันที่แก้ไข + จำนวนแถว)
for f in ['STMAS.dbf', 'stloc.dbf']:
    h0, fs0, _ = rd(os.path.join(BASE, f))
    h1, fs1, rows = rd(os.path.join(BASE, 'dbf_new', f))
    same = h0[8:] == h1[8:] and h0[:1] == h1[:1] and fs0 == fs1
    print(f, 'header/fields identical:', same, '| rows:', len(rows), '| version byte', hex(h1[0]), 'codepage', hex(h1[29]))
_, _, st = rd(os.path.join(BASE, 'dbf_new', 'STMAS.dbf'))
keys = ['STKCOD', 'STKDES', 'STKDES2', 'BARCOD', 'QUCOD', 'CQUCOD', 'CFACTOR', 'PQUCOD', 'PFACTOR', 'SQUCOD', 'SFACTOR', 'SELLPR1', 'SELLPR2', 'STKGRP', 'ACCCOD', 'CREBY', 'CREDAT', 'LSELLFAC', 'NUMELEM']
for r in st[:3] + st[6:7] + st[-1:]:
    print({k: r[k] for k in keys})
print('codes unique:', len({r['STKCOD'] for r in st}) == len(st))
_, _, lc = rd(os.path.join(BASE, 'dbf_new', 'stloc.dbf'))
print(lc[0]['STKCOD'], lc[0]['LOCCOD'], lc[0]['STATUS'], lc[0]['LOCBAL'], len(lc))
for f in ['STMAS.dbf', 'stloc.dbf', 'STMAS.CDX', 'STLOC.CDX']:
    print(f, os.path.getsize(os.path.join(BASE, f)), 'mtime', os.path.getmtime(os.path.join(BASE, f)))
