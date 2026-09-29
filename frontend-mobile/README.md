# Ranger TOPSALES — Frontend (Mobile / LINE LIFF)

แอปพนักงานขาย (หน่วยรถ Cash Van / พนักงานขายตรง) เปิดใน LINE ผ่าน LIFF — static site ไฟล์เดียว
(`index.html` + `config.js`, ไม่มี build, ไม่มี framework) ต่อยอดจาก `_legacy-standalone-liff-app/`
เรียก backend (`../backend/`) ผ่าน `doPost` กลุ่ม **Mobile**: `{ action, lineUserId, idToken, payload }`
(action ทั้งหมดอยู่ใน `ACTION_MAP` ของ `backend/05_router.gs`)
`idToken` = `liff.getIDToken()` — backend ยืนยันกับ LINE แล้วใช้ `sub` เป็นตัวตนจริง ไม่ได้เชื่อ `lineUserId`
ที่เราส่งไป (ดู `backend/27_line_auth.gs`) · token หมดอายุ (ปกติ ~1 ชม.) backend ตอบ `needLogin`
แล้ว `api()` ขอ token ใหม่จาก LIFF ให้เองแล้วลองซ้ำหนึ่งครั้ง

## Deploy

**โฮสต์จริงคือ Cloudflare Pages แล้ว** (ย้ายจาก GitHub Pages 2026-09-29 — ดู CLAUDE.md หัวข้อ "เปิด production"):
push แล้วขึ้นเอง คนละโดเมน/โปรเจกต์ต่อ env ไม่ใช่คนละ path อีกต่อไป
- `UAT` branch → `https://uat.<โปรเจกต์ Cloudflare Pages ของ mobile>.pages.dev/` (branch alias อัตโนมัติ)
- `main` branch → `https://<โปรเจกต์ Cloudflare Pages ของ mobile>.pages.dev/`

`config.js` เลือก backend/LIFF ID ตาม **hostname** (มีคำว่า `uat` = UAT, localhost = UAT ด้วย, นอกนั้น = prod)
— ไม่ใช่ path อีกต่อไป ดู URL ปัจจุบันจริงในตัวไฟล์ `config.js` เอง (คอมเมนต์หัวไฟล์มี)
· GitHub Pages workflow (`.github/workflows/deploy-admin.yml`) ยัง build `/mobile/`+`/mobile-uat/` อยู่ด้วย
เผื่อลิงก์เก่า แต่ **ตอนนี้ path-based ของ GitHub Pages พังแล้ว** (ทั้งสอง path ชี้เข้า backend prod เหมือนกัน
เพราะ hostname ของ github.io ไม่มีคำว่า uat) — ยังไม่ได้ตัดสินใจว่าจะปิด workflow นี้หรือแก้ให้รองรับทั้งคู่

## ตั้งค่า LINE (ทำครั้งเดียวต่อสภาพแวดล้อม — ยังไม่ได้ทำ)

1. LINE Developers Console → channel แบบ **LINE Login** → แท็บ LIFF → Add
   - Endpoint URL: `https://<pages>/mobile-uat/` (ตัว UAT) / `https://<pages>/mobile/` (ตัว production) — สร้างแยก 2 ตัว
   - Size: Full · Scope: **ต้องติ๊ก `openid` ด้วย** (นอกจาก `profile`) ไม่งั้น `liff.getIDToken()` คืนค่าว่าง
     และแอปจะพาผู้ใช้ไปล็อกอินใหม่วนไป
2. เอา LIFF ID ที่ได้ใส่ `LIFF_IDS.uat` / `LIFF_IDS.prod` ใน `config.js` แล้ว push
3. ยังว่าง = production เปิดแล้วขึ้นข้อความ "ยังไม่ได้ตั้งค่า LIFF ID" (ไม่พัง ไม่ไปแตะข้อมูล)

## ทดสอบโดยไม่ผ่าน LINE (UAT เท่านั้น)

`http://localhost:5502/?devLineUserId=U...` (preview config `frontend-mobile` ใน `.claude/launch.json`)
หรือ `.../mobile-uat/?devLineUserId=U...` — ใช้ LINE user id นั้นเรียก backend UAT ตรงๆ
production ไม่มีทางเข้านี้ (โค้ดเช็ค `ENV === 'uat'`)

โหมดนี้ไม่มี ID token → backend ต้องยอมรับคำขอที่ยังไม่ยืนยัน ซึ่ง **UAT เปิดไว้เป็นค่าเริ่มต้น**
(`ENV_NAME='uat'`) · ถ้าอยากทดสอบแบบเข้มเหมือน production ให้ตั้ง Script Property
`ALLOW_UNVERIFIED_LINE_LOGIN='FALSE'` แล้วทดสอบผ่านแอป LINE จริงเท่านั้น

## หน้าจอ

| แท็บ | ทำอะไร | action |
|---|---|---|
| (เริ่มต้น) | LIFF login → ตรวจสิทธิ์ → ยังไม่มีบัญชี = ลงทะเบียน (เลือกสังกัด) → รอแอดมินอนุมัติ | `checkUser`, `listActiveTenants`, `registerUser` |
| หน้าแรก | ยอดวันนี้, Sync, บิลค้างในคิว (ดู/ลบบิลที่ส่งไม่ผ่าน) | `getDashboard`, `getBootstrap` |
| ขาย | เลือกร้าน, เงินสด/เครดิต, ส่งจากสำนักงาน, เลือกหน่วย (ชิ้น/หีบ/แพ็ค), ราคาจริงจากเซิร์ฟเวอร์ก่อนกดขาย — แยก **"+ เพิ่มสินค้า"** (ไล่เลือกจากลิสต์สินค้า) กับ **"ตะกร้า"** (ทบทวน/ลบ/ยืนยัน) เป็นสองโหมดชัดเจน ไม่ปนกันเป็นลิสต์เดียว (2026-09-30, เจ้าของระบบสั่ง — เทียบกับความชัดเจนของหน้าเปิดบิลขายฝั่งแอดมิน) | `quoteSale`, `recordSale` |
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

- ~~LIFF ID ทั้งสอง env~~ **ตั้งไว้ครบแล้ว** (ดู `LIFF_IDS` ใน `config.js`) — ที่ยังไม่ยืนยันคือยังไม่เคยทดสอบผ่าน
  LINE จริงบนมือถือจริงสักครั้ง (ควรลองก่อนปล่อยให้พนักงานใช้งานจริง)
- ~~backend เชื่อ `lineUserId` ที่ client ส่งมาโดยไม่ตรวจ~~ **แก้แล้ว 2026-09-24** — แอปส่ง `idToken` ทุกคำขอ
  และ backend ยืนยันกับ LINE ก่อนเสมอ (`backend/27_line_auth.gs`) · สิ่งที่ยังต้องทำคือตั้ง Script Property
  `LINE_LOGIN_CHANNEL_ID` (ถ้าต่างจาก `LINE_CHANNEL_ID`) และติ๊ก scope `openid` ใน LIFF app
- ~~`recordSale` ไม่มี idempotency key~~ **มีแล้ว** — เป็นส่วนหนึ่งของงาน "กันกดซ้ำ/กันบันทึกซ้ำ" ทั้งระบบ
  2026-09-27 (`backend/35_idempotency.gs`, ดู `IDEMPOTENT_ACTIONS`) ไม่ใช่แค่มือถือ ครอบทุก action ที่สร้างของใหม่
- ~~ของแถม (ของแถมตามชุดราคา) — พักไว้~~ **เอนจิ้นทำแล้ว 2026-09-27 และมือถือก็คำนวณให้เหมือนแอดมิน** แต่
  **จนถึง 2026-09-29 หน้าจอไม่เคยโชว์ของแถมเลยสักบรรทัด** (คำนวณ/บันทึกถูกต้อง แต่พนักงานไม่เห็นว่าต้องส่งอะไร
  เพิ่ม) — **แก้แล้ว 2026-09-30**: ตะกร้าโชว์ของแถมเป็นแถวสีเขียวแยกจากรายการที่คิดเงิน พร้อมเหตุผล (ซื้อครบกี่ลัง)
  และติ๊กออกได้ถ้าของจริงไม่มีบนรถ/ลูกค้าไม่รับ (ส่งเป็น `payload.freeGoods[].applied=false` — backend รองรับ
  มาตั้งแต่แรกแต่ไม่มี UI ส่งมาเลย) · `quoteSale` เดิมส่งรูปดิบของของแถมที่ไม่ตรงกับที่ `recordSale` ใช้ตัดสินใจ
  ตอน opt-out ด้วย (แก้พร้อมกัน — ดู `_shapeFreeGoods()` ใน `backend/07_sales.gs`)
- เพดานแพ็คต่อร้าน (ไม่เกิน 4 แพ็ค) ยังไม่ทำ
- ไม่มีการแสดง VAT ในหน้าขายของมือถือ (บิลมีคำนวณ/บันทึกอยู่แล้ว แค่ไม่โชว์ให้พนักงานเห็นระหว่างขาย)
- ฟีเจอร์ "เยี่ยมร้าน" (เช็คอิน/บันทึกเยี่ยม/สินค้าคู่แข่ง) เก็บข้อมูลจริง แต่แอดมินยังไม่มีหน้าจอไหนอ่านข้อมูลนี้เลย

## ไฟล์อ้างอิงเก่า

- `_legacy-standalone-liff-app/` — ตัวตั้งต้นของแอปนี้ (API/LIFF เดิม, engine ส่วนลดฝั่ง client ที่เลิกใช้แล้ว)
- `_legacy-gas-liff-reference/` — HTML รุ่นที่ backend เสิร์ฟเองผ่าน HtmlService อ้างอิง UI เท่านั้น
- ทั้งสองโฟลเดอร์ไม่ถูก deploy ขึ้นเว็บ
