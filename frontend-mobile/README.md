# SalesRanger TOPSHOP — Frontend (Mobile / LINE LIFF)

แอปพนักงานขาย (หน่วยรถ Cash Van / พนักงานขายตรง) เปิดใน LINE ผ่าน LIFF — static site ไฟล์เดียว
(`index.html` + `config.js`, ไม่มี build, ไม่มี framework) ต่อยอดจาก `_legacy-standalone-liff-app/`
เรียก backend (`../backend/`) ผ่าน `doPost` กลุ่ม **Mobile**: `{ action, lineUserId, payload }`
(action ทั้งหมดอยู่ใน `ACTION_MAP` ของ `backend/05_router.gs`)

## Deploy

GitHub Pages ด้วย workflow เดียวกับ Admin App (`.github/workflows/deploy-admin.yml`) — push แล้วขึ้นเอง
- `UAT` branch → `https://<pages>/mobile-uat/`
- `main` branch → `https://<pages>/mobile/`

`config.js` เลือก backend ตาม URL เหมือน `frontend-admin/config.js` (`/mobile-uat/` และ localhost = UAT)

## ตั้งค่า LINE (ทำครั้งเดียวต่อสภาพแวดล้อม — ยังไม่ได้ทำ)

1. LINE Developers Console → channel แบบ **LINE Login** → แท็บ LIFF → Add
   - Endpoint URL: `https://<pages>/mobile-uat/` (ตัว UAT) / `https://<pages>/mobile/` (ตัว production) — สร้างแยก 2 ตัว
   - Size: Full · Scope: `profile` (+ `openid`)
2. เอา LIFF ID ที่ได้ใส่ `LIFF_IDS.uat` / `LIFF_IDS.prod` ใน `config.js` แล้ว push
3. ยังว่าง = production เปิดแล้วขึ้นข้อความ "ยังไม่ได้ตั้งค่า LIFF ID" (ไม่พัง ไม่ไปแตะข้อมูล)

## ทดสอบโดยไม่ผ่าน LINE (UAT เท่านั้น)

`http://localhost:5502/?devLineUserId=U...` (preview config `frontend-mobile` ใน `.claude/launch.json`)
หรือ `.../mobile-uat/?devLineUserId=U...` — ใช้ LINE user id นั้นเรียก backend UAT ตรงๆ
production ไม่มีทางเข้านี้ (โค้ดเช็ค `ENV === 'uat'`)

## หน้าจอ

| แท็บ | ทำอะไร | action |
|---|---|---|
| (เริ่มต้น) | LIFF login → ตรวจสิทธิ์ → ยังไม่มีบัญชี = ลงทะเบียน (เลือกสังกัด) → รอแอดมินอนุมัติ | `checkUser`, `listActiveTenants`, `registerUser` |
| หน้าแรก | ยอดวันนี้, Sync, บิลค้างในคิว (ดู/ลบบิลที่ส่งไม่ผ่าน) | `getDashboard`, `getBootstrap` |
| ขาย | เลือกร้าน, เงินสด/เครดิต, ส่งจากสำนักงาน, เลือกหน่วย (ชิ้น/หีบ/แพ็ค), ราคาจริงจากเซิร์ฟเวอร์ก่อนกดขาย | `quoteSale`, `recordSale` |
| สต็อก | เบิกของขึ้นรถ / ตรวจนับบนรถ (หน่วยฐาน) | `restockVan`, `submitCount` |
| เยี่ยมร้าน | เช็คอิน (GPS) → บันทึกการเยี่ยม / สินค้าคู่แข่ง | `checkInVisit`, `addVisitNote`, `addCompetitor` |
| ลูกค้า | รายชื่อ + แผนที่, เพิ่มร้านใหม่ (GPS) | `addCustomer` |

กติกาที่สำคัญ:
- **ราคาไม่เชื่อฝั่งแอป** — แอปส่งแค่ `productId / unitCode / qty`; ตัวเลขในตะกร้ามาจาก `quoteSale`
  (เครื่องยนต์เดียวกับ `recordSale`) ถ้าร้านมีชุดราคาจะเห็นชื่อชุด/ขั้นราคา · ออฟไลน์แสดงเป็น "ประมาณการ"
- **ออฟไลน์**: บิลเข้าคิวใน `localStorage` (แยก key ตาม env + lineUserId) ส่งตอนกด Sync ทีละบิล —
  สำเร็จ = เอาออก, เซิร์ฟเวอร์ปฏิเสธ = ค้างไว้พร้อมเหตุผลให้คนตัดสินใจ, เน็ตหลุดกลางทาง = หยุด เก็บที่เหลือไว้
  (ของเดิมใน legacy ล้างคิวทิ้งหมดแม้ส่งไม่ผ่าน)
- กดขายตอนออนไลน์แล้วเน็ตหลุดระหว่างรอ → **ไม่**เข้าคิวอัตโนมัติ (ไม่รู้ว่าเซิร์ฟเวอร์ได้รับหรือยัง เสี่ยงบิลซ้ำ)
  ให้คนเช็คยอดวันนี้ก่อน
- ขายจากรถห้ามเกินของบนรถ (นับเป็นหน่วยฐานรวมทุกหน่วย) · ติ๊ก "ส่งจากสำนักงาน" = ไม่เช็ค/ไม่ตัดสต็อกรถ

## ยังไม่ได้ทำ / ข้อควรรู้

- LIFF ID ทั้งสอง env (ข้างบน)
- **backend เชื่อ `lineUserId` ที่ client ส่งมาโดยไม่ตรวจ** — ใครรู้ user id ของพนักงานก็ยิง action แทนได้
  ก่อนใช้จริงควรให้แอปส่ง `liff.getIDToken()` แล้ว backend verify กับ LINE (`/oauth2/v2.1/verify`) ก่อนเชื่อ
- `recordSale` ไม่มี idempotency key — ถ้าจะให้คิวออฟไลน์ส่งซ้ำได้ปลอดภัย ควรเพิ่ม `clientRef` ที่ backend กันบิลซ้ำ
- ของแถม (ของแถมตามชุดราคา) — พักไว้ตามลำดับความสำคัญของผู้ใช้; เพดานแพ็คต่อร้าน (ไม่เกิน 4 แพ็ค) ยังไม่ทำ

## ไฟล์อ้างอิงเก่า

- `_legacy-standalone-liff-app/` — ตัวตั้งต้นของแอปนี้ (API/LIFF เดิม, engine ส่วนลดฝั่ง client ที่เลิกใช้แล้ว)
- `_legacy-gas-liff-reference/` — HTML รุ่นที่ backend เสิร์ฟเองผ่าน HtmlService อ้างอิง UI เท่านั้น
- ทั้งสองโฟลเดอร์ไม่ถูก deploy ขึ้นเว็บ
