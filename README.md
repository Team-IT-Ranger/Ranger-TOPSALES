# SalesRanger TOPSHOP

ระบบขาย/บริหารตัวแทนจำหน่ายสำหรับ Cash Van Sales และ Credit Sales — ดูภาพรวมสถาปัตยกรรมได้ที่
[docs/topshop_architecture.html](docs/topshop_architecture.html)

## โครงสร้างโปรเจกต์

```
backend/          Google Apps Script — JSON API ล้วนๆ (ไม่มีหน้าเว็บ) จัดการ Central + Tenant Sheets
                   deploy ด้วย clasp (มี .clasp.json ผูกกับโปรเจกต์จริงแล้ว) — ดู backend/README.md
frontend-admin/    Admin App (ตัวแทนจำหน่าย + บริษัทเจ้าของสินค้า) — deploy บน GitHub Pages อัตโนมัติ
                   (.github/workflows/deploy-admin.yml: main → /admin/, UAT → /admin-uat/)
frontend-mobile/   Mobile App พนักงานขาย (LINE LIFF) — ยังไม่สร้าง แผนขึ้น Vercel สัปดาห์ 3
                   มีของเดิม 2 ชุดเก็บไว้อ้างอิง ดู frontend-mobile/README.md
docs/              เอกสารแผน/สถาปัตยกรรม
```

## Branch

- `main` — โค้ดที่ผ่านการตรวจแล้ว
- `UAT` — ไว้ทดสอบก่อนขึ้นจริงกับตัวแทนนำร่อง

## Stack

Google Apps Script (backend) + Google Sheets (database, เฟส 1) + GitHub Pages (Admin App) + Vercel (Mobile App — แผนสัปดาห์ 3)
— เตรียมโครงสร้างรองรับ Cloud Database เต็มรูปแบบไว้สำหรับเฟสถัดไป ยังไม่ใช้ตอนนี้

## สภาพแวดล้อม — dev / UAT / production

สถานะ ณ 2026-09-24: **สร้างโปรเจกต์ production แล้ว** (deploy ครั้งแรกเรียบร้อย) เหลือขั้นตอนที่ต้องทำในบัญชี
เจ้าของโปรเจกต์เอง — ดูหัวข้อ "เปิด production" ด้านล่าง

| | dev | UAT | production |
|---|---|---|---|
| Git branch | — (เจ้าของระบบใช้เอง) | `UAT` | `main` |
| Admin App | — | `.../admin-uat/` (แถบแดง "UAT") | `.../admin/` — **ปิดไว้** (ยังไม่ต่อ backend ใดๆ) |
| Apps Script | `salesranger-TOPSHOP-be(dev)` `1iVJDVuc…` (`backend/.clasp.dev.json`) | `salesranger-TOPSHOP-be(uat)` `1SDBJgSN…` (`backend/.clasp.uat.json`) | `salesranger-TOPSHOP-be(prod)` `1BDLcQIB…` (`backend/.clasp.prod.json`) — เจ้าของ: `info@tnk.co.th` |
| Database | Central Sheet ของ dev | Central Sheet ของ UAT (`setupUatEnvironment()`) + Tenant Sheet แยก | ยังไม่สร้าง — รัน `setupProductionEnvironment()` ครั้งเดียวใน editor |

`frontend-admin/config.js` เลือก backend จาก URL: `/admin-uat/` และ localhost = UAT · นอกนั้น = prod
(`BACKENDS.prod` ชี้ไปที่ deployment ของโปรเจกต์ prod แล้ว) — `/admin/` จะเปิดใช้ได้ก็ต่อเมื่อ merge `UAT` → `main`

**ขั้นตอนทำงานตอนนี้**
1. แก้โค้ด → commit ลง branch `UAT` เท่านั้น → `.dev/push-backend.sh uat` (ถ้าแก้ backend)
2. ให้เจ้าของโปรเจกต์กด Deploy → New version ที่ deployment เดิมของ UAT (clasp deploy ข้ามโดเมนไม่ได้)
3. ทดสอบบน `/admin-uat/` จนผ่าน
4. ห้าม commit ลง `main` ตรงๆ

**เปิด production** — ทำไปแล้ว: สร้างโปรเจกต์ `1BDLcQIB…` (clasp, บัญชี `info@tnk.co.th`) · push โค้ดครบ ·
deploy ครั้งแรกเป็น Web App (`AKfycbwpUpxp…`, access = ANYONE_ANONYMOUS, execute as = ผู้ deploy) ·
ใส่ URL ลง `BACKENDS.prod` ของทั้งสอง frontend แล้ว

เหลือขั้นตอนที่ต้องทำในบัญชีเจ้าของโปรเจกต์ (`info@tnk.co.th`) เพราะรันจากเครื่องมือภายนอกไม่ได้:
1. เปิด `https://script.google.com/d/1BDLcQIBqwJaGTDdUa0WD8s-w35oj8H_2q3AYiedTPzRz0kUnHoECViLR/edit`
   → Run `setupProductionEnvironment()` → กดยอมรับสิทธิ์ (Sheets / Drive / External request)
   ฟังก์ชันนี้สร้าง Central Sheet ของ production, ตั้ง `ENV_NAME=prod`, สร้างชีต/ผังบัญชี และแอดมินคนแรก
2. Deploy → Manage deployments → ตรวจว่า "Who has access" = **Anyone** (ตอน deploy ครั้งแรกจากภายนอก
   Google ยังไม่เปิดให้คนนอกเข้า — ทดสอบแล้วได้ HTTP 403 จนกว่าจะยืนยันจากในบัญชีเจ้าของ)
   ถ้าโดเมนไม่อนุญาตให้เปิดสาธารณะ ต้องย้ายโปรเจกต์ไปอยู่บัญชีเดียวกับ dev/uat (`thanatkorn.com`) แทน
3. ตั้ง Script Properties: `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LIFF_ID`, `ENDPOINT_URL`
4. สร้าง LIFF app ของ production (Endpoint `.../mobile/`, scope `profile` + `openid`) แล้วใส่ `LIFF_IDS.prod`
5. ทดสอบล็อกอิน `/admin/` แล้วค่อย merge `UAT` → `main` (ขั้นนี้ยังไม่ทำ — `/admin/` ยังปิดอยู่)

`.dev/push-backend.sh` ไม่ส่ง `script_properties.gs` (มี secret) ขึ้นโปรเจกต์ใดทั้งสิ้น
