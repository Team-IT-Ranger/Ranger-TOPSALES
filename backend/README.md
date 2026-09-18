# SalesRanger TOPSHOP — Backend (Google Apps Script)

**Backend นี้เป็น JSON API ล้วนๆ ไม่มีหน้าเว็บ ไม่มี HtmlService** — จัดการ Sheet (Central + Tenant) และ
business logic ทั้งหมดเท่านั้น หน้าตาทั้ง 2 แอป (Mobile LIFF ของพนักงานขาย และ Admin App) แยกคนละ
โปรเจกต์ — Admin App (`frontend-admin/`) ขึ้น **GitHub Pages** แล้ว ส่วน Mobile (`frontend-mobile/`)
ยังไม่ได้สร้างจริง รอสัปดาห์ 3 แล้วเรียก backend นี้ผ่าน `fetch()`

โครงสร้างไฟล์: ไฟล์ `.gs` เรียงเลขตามลำดับที่ควรอ่าน/แก้ (ไม่ใช่ลำดับรัน — GAS โหลดทุกไฟล์เป็น global scope เดียวกัน)

## Setup ครั้งแรก

1. สร้าง Google Sheet ใหม่ 1 ไฟล์ไว้เป็น **Central Sheet** แล้วคัดลอก File ID
2. `clasp push` ไฟล์ทั้งหมดในโฟลเดอร์นี้ (ยกเว้น README.md — `.claspignore` กันไว้ให้แล้ว)
3. Project Settings → Script Properties ตั้งค่า (หรือแก้ค่าใน `script_properties.gs` แล้วรัน `set_ScriptProperties()` ครั้งเดียว):
   - `CENTRAL_SHEET_FILEID` — File ID จากข้อ 1
   - `LIFF_ID` — LINE LIFF App ID
   - `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` — จาก LINE Developers Console
   - `ENDPOINT_URL` — URL ของ Web App นี้ (ได้หลัง deploy ครั้งแรก แล้วย้อนมาใส่)
4. รัน `setupCentralSheet()` (ใน `00_setup_sheets.gs`) — สร้าง tab ทั้งหมด + seed กลุ่มสินค้า/กลุ่มร้านค้า/จังหวัด/สิทธิ์เริ่มต้น
5. รัน `createFirstSuperAdmin()` (ใน `99_dev_tools.gs`) — แก้ username/password ในไฟล์ก่อน Run
6. รัน `createTenant(session, {tenantId, name, region})` ผ่าน Admin App เมื่อพร้อม (หรือเรียกตรงจาก Editor ด้วย `_buildTenantSpreadsheet()` ในกรณีทดสอบ) — สร้างไฟล์ Tenant Sheet ของตัวแทนนำร่อง
7. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone) → คัดลอก URL ไปใส่ `ENDPOINT_URL` ในข้อ 3 แล้ว deploy เวอร์ชันใหม่อีกครั้ง
8. **สำคัญ**: LINE Developers Console → Callback URL ต้องชี้ไปที่โดเมนของ `frontend-mobile` บน Vercel
   (ไม่ใช่ URL ของ backend นี้อีกต่อไป) —ตั้งได้หลังจาก deploy frontend-mobile จริงในสัปดาห์ 3

## doPost(e) — ทางเข้าเดียวของทุก action

Client (ทั้ง frontend-mobile และ frontend-admin) ยิง `fetch(ENDPOINT_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify({...}) })`
— ใช้ `text/plain` โดยเจตนาเพื่อเลี่ยง CORS preflight (GAS Web App ไม่รองรับ preflighted request)

แยก action เป็น 3 กลุ่ม:

| กลุ่ม | ต้องส่งอะไรมาด้วย | Action ตัวอย่าง |
|---|---|---|
| **Public** (ยังไม่มีตัวตน) | `{ action, payload }` | `lineLoginUrl`, `lineExchangeCode`, `checkUser`, `registerUser`, `listActiveTenants`, `adminLogin`, `adminLogout` |
| **Mobile** (พนักงานขาย) | `{ action, lineUserId, payload }` | ดู `ACTION_MAP` ใน `05_router.gs` — `getBootstrap`, `recordSale`, `restockVan` ฯลฯ |
| **Admin** (แอดมิน) | `{ action, token, payload }` — `token` มาจาก `adminLogin` | ดู `ADMIN_ACTION_MAP` ใน `05_router.gs` |

ตอบกลับเป็น JSON เสมอ รูปแบบ `{ success: true, ...data }` หรือ `{ success: false, message: '...' }`

**LINE Login flow ฝั่ง frontend-mobile** (ทำเองที่ frontend ไม่ใช่ backend):
1. เรียก action `lineLoginUrl` ได้ URL ไปเปิดหน้า LINE Login
2. LINE redirect กลับมาที่หน้า frontend เอง (ไม่ใช่ backend) พร้อม `?code=...`
3. frontend เรียก action `lineExchangeCode` ส่ง `{code, redirectUrl}` ไป — backend แลก code กับ LINE
   (เก็บ CHANNEL_SECRET ไว้ backend เท่านั้น) แล้วคืน `{lineProfile, userStatus}` กลับมา
4. frontend เก็บ `lineProfile.userId` ไว้ใช้เป็น `lineUserId` เรียก action กลุ่ม Mobile ต่อไป

## ยังไม่ได้ทำ (สัปดาห์ถัดไป)

- **frontend-mobile/** บน Vercel — ยังไม่ได้สร้างจริง มีแค่ HTML เดิม (GAS
  HtmlService รุ่นก่อนแยกโปรเจกต์) เก็บไว้อ้างอิงที่ `frontend-mobile/_legacy-gas-liff-reference/`
  เท่านั้น ต้องเขียนใหม่เป็น static site เรียก backend ผ่าน `fetch()` ตามสัญญา `doPost` ด้านบน
- คลังสินค้า/ใบรับสินค้าเข้า/ใบโอนคลัง แบบมีเลขเอกสารทางการ (ปัจจุบัน restock/count ยังเป็นแบบเรียบง่าย)
- Credit Sales flow (เฟส 2)
- Import/Export Express: เจอไฟล์ export จริงจากโปรแกรมเวนเดอร์ (SmartVan BackOffice) แล้วที่
  `C:\Smartsales Backoffice - UAT\Export_Express` และ `\Export` — pipe-delimited, ANSI/TIS-620,
  คู่ H_/D_ (Header/Detail) — ดูรายละเอียดที่คอมเมนต์บนสุดของ `15_import_export_express.gs`
  ยังต้องยืนยัน column mapping ที่แน่นอนกับฝ่ายบัญชี/เวนเดอร์ก่อนใช้งานจริง
- `product_units` (สินค้าขายได้หลายหน่วย เช่น ชิ้น/แพ็ค/ลัง คนละราคา คนละ factor แปลงหน่วย) —
  `recordSale` ล็อกราคาจาก master data เท่านั้น ไม่เชื่อราคาจาก client
