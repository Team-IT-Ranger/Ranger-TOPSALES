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

สถานะ ณ 2026-09-24: **production กำลังตั้งขึ้น** — เจ้าของระบบเลือกให้โปรเจกต์ prod อยู่กับบัญชี
`channarong@thanatkorn.com` (บัญชีเดียวกับ dev/uat และเป็นเจ้าของไฟล์ฐานข้อมูลทั้งหมด) ดูขั้นตอนที่เหลือ
ในหัวข้อ "เปิด production" ด้านล่าง · `/admin/` ยังปิดอยู่จนกว่า backend prod จะตอบล็อกอินได้จริง

| | dev | UAT | production |
|---|---|---|---|
| Git branch | — (เจ้าของระบบใช้เอง) | `UAT` | `main` |
| Admin App | — | `.../admin-uat/` (แถบแดง "UAT") | `.../admin/` — **ปิดไว้** (ยังไม่ต่อ backend ใดๆ) |
| Apps Script | `salesranger-TOPSHOP-be(dev)` `1iVJDVuc…` (`backend/.clasp.dev.json`) | `salesranger-TOPSHOP-be(uat)` `1SDBJgSN…` (`backend/.clasp.uat.json`) | รอสร้างจากบัญชี `channarong@thanatkorn.com` แล้วใส่ `backend/.clasp.prod.json` |
| Database | Central Sheet ของ dev | Central Sheet ของ UAT (`setupUatEnvironment()`) + Tenant Sheet แยก | ยังไม่สร้าง — รัน `setupProductionEnvironment()` ครั้งเดียวใน editor |

`frontend-admin/config.js` เลือก backend จาก URL: `/admin-uat/` และ localhost = UAT · นอกนั้น = prod
(`BACKENDS.prod` ชี้ไปที่ deployment ของโปรเจกต์ prod แล้ว) — `/admin/` จะเปิดใช้ได้ก็ต่อเมื่อ merge `UAT` → `main`

**ขั้นตอนทำงานตอนนี้**
1. แก้โค้ด → commit ลง branch `UAT` เท่านั้น → `.dev/push-backend.sh uat` (ถ้าแก้ backend)
2. ให้เจ้าของโปรเจกต์กด Deploy → New version ที่ deployment เดิมของ UAT (clasp deploy ข้ามโดเมนไม่ได้)
3. ทดสอบบน `/admin-uat/` จนผ่าน
4. ห้าม commit ลง `main` ตรงๆ

**เปิด production** — ลำดับที่ตกลงกันไว้ (2026-09-24)

ทำจากบัญชี `channarong@thanatkorn.com` (เจ้าของ dev/uat และไฟล์ฐานข้อมูลทั้งหมด):
1. ✅ สร้างโปรเจกต์แล้ว: `1XObaZXuCcXcBn6j12tzXMj1VHcx1KIETNsso_zKPw1UGKaLrVvFrVv1c`
   (ใส่ใน `backend/.clasp.prod.json` แล้ว) — **ยังต้องแชร์ให้ `info@tnk.co.th` เป็น Editor**
   ไม่งั้น `clasp push` จากเครื่อง dev ขึ้นว่า "The caller does not have permission"
2. `.dev/push-backend.sh prod` (ทำให้จากเครื่อง dev ได้)
3. ใน editor: Run `setupProductionEnvironment()` (`99_dev_tools.gs`) หนึ่งครั้ง → กดยอมรับสิทธิ์
   Sheets / Drive / External request → ได้ Central Sheet ของ prod + ผังบัญชี + แอดมินคนแรก
   (`admin` / `ChangeMe123!` — เปลี่ยนรหัสทันทีหลังเข้าได้) และตั้ง `ENV_NAME='prod'` ให้เอง
4. ตั้ง Script Properties ที่เหลือ: `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LIFF_ID`, `ENDPOINT_URL`
5. Deploy → New deployment → Web app (Execute as: **Me**, Who has access: **Anyone**) → ส่ง exec URL มา
   ใส่ `BACKENDS.prod` ทั้ง `frontend-admin/config.js` และ `frontend-mobile/config.js`
6. สร้าง LIFF app ของ production (Endpoint `.../mobile/`, scope `profile` + `openid`) → ใส่ `LIFF_IDS.prod`
7. ทดสอบล็อกอินกับ backend prod จริง → ผ่านแล้วจึง `git merge UAT --ff-only` ขึ้น `main` (เปิด `/admin/`)

หมายเหตุ: 24 ก.ย. 2026 เคยสร้างโปรเจกต์ prod ด้วยบัญชี `info@tnk.co.th` ไปก่อน (`1BDLcQIB…`) แต่เจ้าของระบบ
เลือกให้ prod อยู่บัญชี `channarong@` แทน — โปรเจกต์นั้น **ห้ามนำมาใช้** และยังค้างอยู่ในไดรฟ์ของ `info@`
(ลบได้ด้วย `clasp delete-script 1BDLcQIB…` เมื่อเจ้าของระบบสั่ง)

`.dev/push-backend.sh` ไม่ส่ง `script_properties.gs` (มี secret) ขึ้นโปรเจกต์ใดทั้งสิ้น
