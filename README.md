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

สถานะจริง ณ 2026-09-23: มี 2 สภาพแวดล้อมที่ใช้งานอยู่ (**dev** กับ **UAT**) ส่วน **production ยังไม่ถูกสร้าง**

| | dev | UAT | production |
|---|---|---|---|
| Git branch | — (เจ้าของระบบใช้เอง) | `UAT` | `main` |
| Admin App | — | `.../admin-uat/` (แถบแดง "UAT") | `.../admin/` — **ปิดไว้** (ยังไม่ต่อ backend ใดๆ) |
| Apps Script | `salesranger-TOPSHOP-be(dev)` `1iVJDVuc…` (`backend/.clasp.dev.json`) | `salesranger-TOPSHOP-be(uat)` `1SDBJgSN…` (`backend/.clasp.uat.json`) | ยังไม่มีโปรเจกต์ (จะใช้ `backend/.clasp.prod.json`) |
| Database | Central Sheet ของ dev | Central Sheet ของ UAT (`setupUatEnvironment()`) + Tenant Sheet แยก | ยังไม่มี |

`frontend-admin/config.js` เลือก backend จาก URL: `/admin-uat/` และ localhost = UAT · นอกนั้น = prod ซึ่ง**เว้นว่างไว้โดยเจตนา**
→ เปิด `/admin/` ตอนนี้จะล็อกอินไม่ได้และขึ้นแถบ "ยังไม่เปิดใช้งานระบบจริง" (กันไม่ให้เว็บตัวจริงไปคุยกับ backend ของ dev/uat)

**ขั้นตอนทำงานตอนนี้**
1. แก้โค้ด → commit ลง branch `UAT` เท่านั้น → `.dev/push-backend.sh uat` (ถ้าแก้ backend)
2. ให้เจ้าของโปรเจกต์กด Deploy → New version ที่ deployment เดิมของ UAT (clasp deploy ข้ามโดเมนไม่ได้)
3. ทดสอบบน `/admin-uat/` จนผ่าน
4. ห้าม commit ลง `main` ตรงๆ

**เมื่อจะเปิด production จริง** (ยังไม่ถึงขั้นนั้น): สร้างโปรเจกต์ Apps Script ใหม่ + Central Sheet ใหม่ → ใส่
`backend/.clasp.prod.json` → `.dev/push-backend.sh prod` → Deploy → New version → เอา Web App URL ใส่ `BACKENDS.prod`
ใน `frontend-admin/config.js` (และ `frontend-mobile/config.js`) → merge `UAT` → `main`

`.dev/push-backend.sh` ไม่ส่ง `script_properties.gs` (มี secret) ขึ้นโปรเจกต์ใดทั้งสิ้น
