# CLAUDE.md — orientation for a fresh Claude Code session

Read this first. It covers the things that aren't obvious from the code alone: business rules,
environment gotchas, and where things stand. Architecture/deploy mechanics are in
[README.md](README.md) and [backend/README.md](backend/README.md) — this file doesn't repeat those,
it fills the gaps around them.

## Golden rules

1. **All work happens on git branch `UAT`. Never commit to `main` directly.** `main` only moves via
   `git merge UAT --ff-only`, and only after the user explicitly approves what's on UAT.
   Production is being set up (2026-09-24) but does not answer yet — `/admin/` stays closed and `main`
   must not move until the prod backend answers a real login.
2. **Environments are fully separate.** **dev** (`1iVJDVuc…`, `backend/.clasp.dev.json`) — the system
   owner's own environment, this app does not use it; **uat** (`1SDBJgSN…`, `backend/.clasp.uat.json`)
   — what we test on, `/admin-uat/`; **prod** — to be created by `channarong@thanatkorn.com`
   (see "เปิด production" in README.md); `BACKENDS.prod` stays empty until its Web App URL exists.
   Never let one environment's code or data touch another's Apps Script project or Sheet.
3. Verify things actually work before reporting success — the user tests live and expects real
   verification (UAT end-to-end test run, or a live browser check), not "should work now."
4. After a toggle/status-style action, mutate the local JS cache and re-render — don't refetch the
   whole list. This pattern is used throughout `frontend-admin/index.html`; keep following it.

## Business domain (not derivable from the code)

- Distribution model: **part of sales goes through ตัวแทนจำหน่าย (distributors/tenants), part is
  direct company sales staff whose revenue goes straight to the company itself.** The company's own
  direct-sales ledger is an auto-provisioned tenant with fixed id `'HOUSE'` (see
  `_ensureHouseTenant()` in `backend/13_tenants.gs`, `_salesTenantId()` in `backend/14_permissions.gs`)
  — an owner-mode admin opening a sale never needs to pick a distributor; it defaults to HOUSE.
- Product codes (`product_code`) are unique system-wide and have **no cash/credit split** — one code,
  two possible prices (cash vs credit) depending on payment method at sale time.
- The centre (ศูนย์) price is entered manually by the admin each pricing period — it is **not** a
  fixed 6%; it changes occasionally. Workflow for a new period: "คัดลอกเป็นงวดใหม่" (clone the
  previous list as a draft) → edit only the changed lines → เปิดใช้งาน. The centre group uses one
  price per product, so the line modal defaults to a single tier (1 หีบขึ้นไป).
- Price lists are editable **only while `draft` and never activated** (`activated_at` empty) —
  `_draftListOrError()` in `backend/17_pricing.gs`. Active/archived lists, and drafts that were
  once active, are frozen because old bills reference their prices; change them by cloning.
- A customer/shop belongs to exactly **one** price list at a time (by customer group × period).
- Van packs (แพ็ค) sell **only via Cash Van, only for cash** — enforced server-side in
  `priceCart()` (`backend/18_pricing_engine.gs`): `PACK_VAN_ONLY` / `PACK_CASH_ONLY` error codes.
- Price-list tiers are counted by **combined case (หีบ) quantity across products sharing the same
  `line_id`** (e.g. scent variants of the same item share one tier table) — every case in the order
  gets the price of the tier the combined total reaches.
- When a customer's group has an active price list, that list is the **only** price source (no
  stacking with the legacy `discount_rules` engine); products not in the list can't be sold to that
  customer. Groups with no active list fall back to the legacy `applyPromotions` engine untouched.
- Free goods (ของแถม) were deliberately deferred — the user's instruction was "finish discounts
  first." Don't build free-goods-on-price-lists without checking with the user first.

## งานซื้อและบัญชี (added 2026-09-23, UAT only)

- **Chain**: ใบขอซื้อ PR (`21_purchase_requisition.gs`) → อนุมัติ → ใบสั่งซื้อ PO (`22_purchase_order.gs`, เปิดตรง
  ก็ได้) → รับของ GR → เข้าคลัง → ตั้งหนี้ AP → จ่ายเงิน (`23_accounting.gs`). ทุกอย่างอยู่ Central Sheet และใช้
  `_withDocLock()` ทุก action ที่เขียนเอกสาร.
- **ใช้ได้ทั้งบริษัทและตัวแทน (2026-09-24)**: ตารางงานซื้อ/คลังทุกตัวมีคอลัมน์ `tenant_id` — ว่าง = ของบริษัท
  เจ้าของสินค้า · มีค่า = ของตัวแทนรายนั้น. ทุก action อ่านผ่าน `_scoped()/_findScoped()` (`20_purchasing_master.gs`)
  ที่คิด scope จาก `_purchaseScope()` = `_effectiveTenantId()` — **ห้ามเรียก `centralObjects()` ตรงๆ กับตารางกลุ่มนี้**
  ไม่งั้นข้อมูลข้ามบริษัทกัน. ตัวแทนเห็นเฉพาะของตัวเอง · ฝั่งบริษัทสวมสิทธิ์เข้าไปทำแทนได้ด้วย `payload.tenantId`
  (เหมือนโมดูลอื่น — `callApi` ในหน้าเว็บแนบให้อัตโนมัติเมื่อ Ultra Admin เลือกตัวแทน).
  เลขเอกสารแยกเล่มต่อบริษัท: ตัวนับคีย์ `'PO@TNKN'` และเลขที่ออกมาเป็น `PO-TNKN-202609-0001`.
  คลังของตัวแทนสร้างให้อัตโนมัติครั้งแรกที่ใช้ (`_ensureScopeWarehouse`).
- **บัญชีเป็นสมุดของบริษัทเท่านั้น**: ใบรับของของตัวแทน **ไม่ลง** journal (journal_id ว่าง) และ `createApBillFromGr`
  ปฏิเสธใบรับของที่มี `tenant_id` — ตัวแทนเป็นคนละนิติบุคคล จะเอาเข้างบบริษัทไม่ได้ (หน้าเว็บซ่อนปุ่ม "ตั้งหนี้"
  ฝั่งตัวแทนด้วย). ถ้าจะทำบัญชีให้ตัวแทนต้องเป็นชุดสมุดแยกของเขาเอง — ยังไม่ได้ทำ.
- **Approval flows are data, not code**: `approval_flows` (doc_type × ช่วงวงเงิน) + `approval_flow_steps`
  (ขั้น, ผู้อนุมัติแบบ role หรือ user list, `required_approvals` = ต้องกี่คนต่อขั้น). เลือกสายตอน submit จาก
  ยอดรวม PR; เข้าหลายสาย → ใช้สายที่ `min_amount` สูงสุด. ไม่มีสายเข้าเงื่อนไข = อนุมัติอัตโนมัติ (บันทึกไว้ใน
  ประวัติว่าระบบอนุมัติให้). ปฏิเสธคนเดียว = ตีกลับทั้งใบ; ส่งใหม่ล้างประวัติเดิมเพื่อให้การนับเริ่มใหม่.
  `super_admin` อนุมัติแทนได้เสมอ (กันงานค้างเมื่อผู้อนุมัติไม่อยู่).
- **Editing rules**: PR แก้ได้เฉพาะ draft/rejected · PO แก้ได้เฉพาะ draft (ส่งผู้ขายแล้วต้องยกเลิกแล้วเปิดใหม่) ·
  ยกเลิก PO ที่รับของแล้วไม่ได้ · ยกเลิก PO ที่ release จาก PR แล้วจะคืนยอดค้างให้ PR เอง.
- **หน่วยสั่งซื้อ vs หน่วยฐาน**: `po_items.unit_factor` = จำนวนหน่วยฐานต่อ 1 หน่วยสั่งซื้อ (สั่งเป็นลัง 20 ชิ้น →
  factor 20). สต็อก/ต้นทุนทุกอย่างเก็บเป็นหน่วยฐาน. ต้นทุนเฉลี่ยถ่วงน้ำหนักคิดใหม่ทุกครั้งที่รับของ
  (`_applyStockIn` ใน `22_purchase_order.gs`) — คลังกลางนี้แยกคนละเรื่องกับ `van_stock` ของตัวแทน.
- **การลงบัญชีอัตโนมัติ** (รหัสอยู่ใน `GL_ACCT`, seed ผังบัญชีใน `00_setup_sheets.gs`):
  รับของ → Dr 1300 สินค้าคงเหลือ / Cr 2150 GR-NI · ตั้งหนี้ → Dr 2150 + Dr 1400 ภาษีซื้อ / Cr 2100 เจ้าหนี้ ·
  จ่ายเงิน → Dr 2100 / Cr 1120 (หรือ 1110 ถ้าเงินสด) · ใบแจ้งหนี้ลูกค้า → Dr 1200 / Cr 4100 + Cr 2200 ·
  รับชำระ → Dr 1120 / Cr 1200. ทุกใบสำคัญบังคับเดบิต=เครดิต (`_postJournal`).
- **ยกเลิกใบสำคัญ = กลับรายการ** (ออกใบใหม่ตรงข้าม) ไม่ลบของเดิม — งบทดลองจึงนับ**ทุก**ใบรวมใบที่ voided
  แล้ว (ถ้าตัดใบเดิมออกด้วยจะหักซ้ำสองเท่า — เคยพลาดตรงนี้ เทสต์จับได้).
- ยังไม่ได้ทำ: แก้ไข/ยกเลิกใบรับของ (GR) หลังลงบัญชีแล้ว, ตัดต้นทุนขาย (COGS 5100) ตอนขายออกจากคลังกลาง,
  งบกำไรขาดทุน/งบดุล (มีแต่งบทดลอง), ปิดงวดบัญชี, ภาษีหัก ณ ที่จ่าย, multi-currency.

## เปิด production (กำลังทำ 2026-09-24)

- **เจ้าของโปรเจกต์ prod = `channarong@thanatkorn.com`** (เจ้าของระบบเลือกเอง — บัญชีเดียวกับ dev/uat และ
  เป็นเจ้าของไฟล์ฐานข้อมูลทุกไฟล์ ถ้าใช้บัญชีอื่นไฟล์ prod จะไปอยู่คนละมือกับของเดิม) — ลำดับขั้นทั้งหมด
  อยู่ในหัวข้อ "เปิด production" ของ README.md
- `setupProductionEnvironment()` (`99_dev_tools.gs`) = ปุ่มเดียวจบสำหรับเจ้าของ: สร้าง Central Sheet ของ prod,
  ตั้ง `ENV_NAME='prod'`, ลงชีต/ผังบัญชี, สร้างแอดมินคนแรก — ไม่คัดลอกข้อมูลจาก UAT (ข้อมูลทดสอบห้ามขึ้น prod)
- บทเรียนจากความพยายามครั้งแรก: `clasp create-script` + `clasp create-deployment` จากบัญชี `info@tnk.co.th`
  สร้างและ deploy ได้จริง แต่ยิงเข้า exec URL ได้ HTTP 403 (หน้า Drive "ต้องมีสิทธิ์เข้าถึง") ทั้งที่
  `entryPointConfig.access` = `ANYONE_ANONYMOUS` — **deployment ที่สร้างจาก API โดยเจ้าของยังไม่เคยเปิดสคริปต์
  และกดยอมรับสิทธิ์ จะยังไม่เปิดให้คนนอกเข้า** ดังนั้น deploy ครั้งแรกต้องทำจากใน editor เสมอ
  (โปรเจกต์ `1BDLcQIB…` ที่สร้างไว้ตอนนั้นยังค้างอยู่ในไดรฟ์ของ `info@tnk.co.th` — **ห้ามนำมาใช้**
  เปลี่ยนชื่อจากเครื่องนี้ไม่ได้เพราะ clasp มีแค่ `drive.file`/`drive.metadata.readonly` สำหรับไฟล์นั้น
  ลบได้ด้วย `clasp delete-script 1BDLcQIB…` เมื่อเจ้าของระบบสั่ง)
- ยังไม่ merge `UAT` → `main` จนกว่า backend prod จะตอบล็อกอินได้จริง (ไม่งั้น `/admin/` เปิดมาแล้วพัง)

## ตัวตนของแอปมือถือ (LINE ID token, added 2026-09-24)

- แอปมือถือแนบ `idToken` (`liff.getIDToken()`) ไปกับ **ทุก** คำขอ · backend ยืนยันกับ LINE
  (`https://api.line.me/oauth2/v2.1/verify`) แล้วใช้ `sub` เป็นตัวตนจริง — `lineUserId` ที่ client ส่งมา
  เป็นแค่ข้อมูลประกอบ ถ้าไม่ตรงกับ token จะถูกปฏิเสธ (`resolveLineIdentity` ใน `backend/27_line_auth.gs`)
- ครอบคลุมทั้งกลุ่ม Mobile (`ACTION_MAP`) และ `checkUser`/`registerUser` — สมัครแทนคนอื่นไม่ได้แล้ว
  และ `registerUser` กันแถวซ้ำด้วย (กดสมัครซ้ำ/เน็ตกระตุกเคยได้ 2 แถว)
- ผลการยืนยันถูกแคชตามอายุ token (สูงสุด 30 นาที) ด้วย CacheService — ไม่ได้ยิง LINE ทุกคำขอ
- **ความเข้มขึ้นกับ env**: `ALLOW_UNVERIFIED_LINE_LOGIN` ไม่ได้ตั้ง = ยอมรับคำขอที่ไม่มี token เฉพาะเมื่อ
  `ENV_NAME='uat'` (เพื่อให้โหมดทดสอบ `?devLineUserId=` ยังใช้ได้) · production (ไม่ได้ตั้ง `ENV_NAME`) เข้มเสมอ ·
  ตั้ง `'FALSE'` เพื่อบังคับเข้มบน UAT ด้วย
- ยังไม่ได้ตั้ง `LINE_LOGIN_CHANNEL_ID`/`LINE_CHANNEL_ID` = ยืนยันไม่ได้ → ระบบยอมรับแบบเดิมและเขียน log เตือน
  (ไม่ล้มทั้งระบบเพราะลืมตั้งค่า) — ตั้งให้ครบแล้วจะเข้มเองอัตโนมัติ
- LIFF app **ต้องติ๊ก scope `openid`** ไม่งั้น `getIDToken()` คืนค่าว่าง แอปจะพาไปล็อกอินใหม่วนไป
- token หมดอายุ (~1 ชม.) → backend ตอบ `needLogin` · `api()` ในแอปขอ token ใหม่จาก LIFF แล้วลองซ้ำครั้งเดียว
  (ถ้าขอใหม่ไม่ได้ก็ `liff.logout()` + `liff.login()` — ไม่วนยิง backend ซ้ำ)

## ที่เก็บไฟล์ฐานข้อมูลบน Drive (added 2026-09-23)

- โครงสร้าง: `<root>/db_<env>/TNKI/` = Central Sheet + ฐานข้อมูลบริษัทเจ้าของสินค้า (tenant `HOUSE`) ·
  `<root>/db_<env>/<รหัสตัวแทน>/` = ไฟล์ของตัวแทนรายนั้น (ชื่อโฟลเดอร์ = รหัสตัวแทน = อักษรย่อของชื่อตัวแทน)
- root = Script Property `DB_ROOT_FOLDER_ID` (default `1vjnkJ1Sec0pWh2HPJ0WulkGd2yRnFyvK` = โฟลเดอร์
  `Ranger-TOPSHOP` บน Shared Drive — โฟลเดอร์เดียวกับ Drive clone ของ repo · id ไม่เปลี่ยนตามชื่อโฟลเดอร์) · env = `ENV_NAME`
  (`uat` ตั้งไว้แล้วโดย `setupUatEnvironment()`; ไม่ตั้ง = ถือว่า prod) — ดู `24_drive_layout.gs`
- สร้างไฟล์ใหม่จะเข้าโฟลเดอร์ถูกที่ตั้งแต่แรก (`_buildTenantSpreadsheet`, `setupUatEnvironment`)
- ไฟล์เก่าที่สร้างก่อนหน้านี้ย้ายด้วย action `organizeDatabaseFiles` (super_admin, ปุ่มอยู่หน้า "ตัวแทนจำหน่าย")
  — รันซ้ำได้ ไฟล์ที่อยู่ถูกที่แล้วข้าม และรายงานผลรายไฟล์
- สิทธิ์ OAuth: งานนี้ต้องใช้ scope `https://www.googleapis.com/auth/drive` (เต็ม) ใน `backend/appsscript.json`
  — `drive.file` ไม่พอ เพราะแตะได้เฉพาะไฟล์ที่แอปสร้างเอง แต่โฟลเดอร์ปลายทางคนสร้าง (พลาดมาแล้ว 2026-09-23:
  “สิทธิ์ที่ระบุไว้ไม่เพียงพอ… DriveApp.getFolderById”) เมื่อเปลี่ยน scope แล้ว **เจ้าของ deployment ต้องรัน
  `authorizeDriveAccess()` (99_dev_tools.gs) ใน editor หนึ่งครั้งเพื่อกดยอมรับสิทธิ์ใหม่** แล้วค่อย Deploy → New version
- **สำคัญ**: ไฟล์ฐานข้อมูลทุกไฟล์ถูกสร้างโดย Apps Script จึงมีเจ้าของเป็นบัญชีที่รันสคริปต์
  (`channarong@thanatkorn.com`) — บัญชีอื่น (รวม `inno09_it@`) เปิดอ่านได้แต่ **ย้ายไฟล์ไม่ได้**
  การจัดระเบียบจึงต้องสั่งผ่าน backend เท่านั้น ไม่ใช่ลากใน Drive หรือสั่งจากเครื่องมือภายนอก
- `salesranger-TOPSHOP(dev)` (ไฟล์ Sheet ในโฟลเดอร์ราก, 8 ก.ย. 2026) เป็น Central Sheet รุ่นแรกที่เลิกใช้แล้ว
  (สคีมาเก่า ไม่มีสินค้า/ตัวแทน, password ยังเป็น plaintext) — **เจ้าของระบบสั่งให้เก็บไว้ ห้ามลบ** (2026-09-23)
  ไม่ใช่ฐานข้อมูลที่ใช้งาน อย่าเอาไปตั้งเป็น CENTRAL_SHEET_FILEID ของ env ไหน
- ยังไม่มีสภาพแวดล้อม production → โฟลเดอร์ `db_prod/` ที่สร้างไว้ยังว่าง จะได้ใช้ก็ต่อเมื่อมีโปรเจกต์จริง
  (ฐานข้อมูลของ dev ยังไม่ได้จัดเข้าโครงสร้างนี้ — ถ้าจะจัดด้วย ต้องเพิ่ม `db_dev/` และตั้ง `ENV_NAME='dev'`)

## หน้าตาแอดมิน (ปรับโฉม 2026-09-23)

- ธีม light/minimal: พื้น `#F6F8FC` · การ์ดขาว · เส้น `#E4E9F1` · ฟ้า `#2B63D9` สีเดียวเป็นสีเน้น ·
  **sidebar ขาว** เมนูที่เลือกเป็นชิปฟ้าอ่อน (เดิมเป็นน้ำเงินเข้มเกือบดำ) · แถบ UAT เป็นเหลืองอำพันอ่อนแทนแดงเต็มแถบ
- โค้ดอยู่ท้าย `<style>` ในบล็อก "ปรับโฉม light / minimal" — ลบบล็อกนั้น + คืนค่า `:root` = กลับธีมเดิม
- ตัวเลขเงินในตารางชิดขวาอัตโนมัติด้วย `initMoneyAlign()` (ดูช่องที่ขึ้นต้นด้วย ฿ แล้วใส่คลาส `.num` ให้เอง
  รวมถึงหัวคอลัมน์ที่ตรงกัน ยกเว้นตารางที่มีเซลล์ผสานอย่างหน้าชุดราคา) — ตารางใหม่ได้ผลเองไม่ต้องแก้ renderer
- **แอปมือถือใช้ธีมเดียวกัน** (2026-09-24): พาเลตต์/มุม/เงาชุดเดียวกับแอดมิน · แถบตะกร้าลอยเปลี่ยนจากแถบดำ
  เป็นการ์ดขาวยกลอย · ไอคอนแท็บล่างและไอคอนในปุ่มเป็น inline SVG (`MI` ใน `frontend-mobile/index.html`)
  — ปุ่มที่มีไอคอนต้องเขียน label ด้วย `innerHTML` ไม่ใช่ `textContent` ไม่งั้นไอคอนหายตอนเปลี่ยนสถานะ
- ไอคอนเมนูเป็น **inline SVG** (`ICONS` + `navIcon()` ใน `index.html`) ไม่ใช่ emoji แล้ว — เพิ่มเมนูใหม่ต้องเพิ่ม key ใน `ICONS`
- ความเร็วยืดหด sidebar เปลี่ยนจาก 3 วินาที ("อ้อยอิ่ง" ตามที่เคยสั่ง) เป็น **0.25 วิ** ตามที่ผู้ใช้สั่งใหม่
- **ปุ่มสลับมุมมอง ปกติ/กระชับ**: ผู้ใช้กำหนดให้มีในทุกแอป และ **ค่าเริ่มต้นคือ "กระชับ" เสมอ** — คลาส `body.density-compact` + จำค่าใน `localStorage`
  (แอดมิน: ปุ่มบนแถบบน · มือถือ: การ์ด "ข้อมูลในเครื่อง" หน้าแรก) เวลาเพิ่มหน้าใหม่ ให้เช็คว่าโหมดกระชับยังอ่านได้

## Environment gotchas

- Windows + Git Bash: `.gs`/`.js`/`.html` files are CRLF. Prefer the `Edit`/`Write` tools over shell
  heredocs for anything with Thai text or quotes — bash heredocs with Thai content have broken
  mid-session before. If you must script an edit, write a Python script to a file and run it (avoid
  inline `python - <<EOF` with Thai text, and avoid stray backslash-escaping bugs — verify the file
  after writing).
- `node --check` on the concatenated `backend/*.gs` files and on the extracted inline `<script>`
  from `frontend-admin/index.html` is a fast, cheap syntax check — do this after every backend/
  frontend edit before pushing.
- Local preview: run `.dev/serve_utf8.py <port> frontend-admin` (must be run with the repo root as
  cwd, or via `.claude/launch.json`'s `frontend-admin` config through `preview_start`). The script
  was made multi-threaded (`ThreadingTCPServer`) because the single-threaded version could hang on
  keep-alive connections from the browser pane.
- UAT's Apps Script Web App is sometimes very slow or flaky (4–37s response times instead of the
  normal ~1.5–2s, and occasionally an HTML error page instead of JSON). This has repeatedly turned
  out to be transient Google-side throttling, not a real bug — retry before assuming something broke.
- `backend/script_properties.gs` is gitignored (has the LINE channel secret) and is **not needed for
  ongoing development** — it's a one-time setup script (`set_ScriptProperties()`, see
  `backend/script_properties.gs.example`). The real values already live server-side in each Apps
  Script project's own Script Properties (Project Settings in the Apps Script editor); that's the
  place to look if they're ever needed again, not this file.
- Two clones of this repo live on the dev machine, both active and both fast-forward-only from
  GitHub: `G:\Shared drives\AppSpace\Ranger-TOPSHOP` (Google Shared Drive — the working copy; folder
  renamed from `salesranger-TOPSHOP` on 2026-09-23, older notes use the old name) and
  `C:\Users\dev-administrator\appdev\salesranger-TOPSHOP` (local — backup / second checkout, still
  under the old name).
  **GitHub is the single source of truth.** Rules: develop in one clone at a time; sync only by
  push/pull through GitHub, never by copying `.git` between them; `reference/` (ใบราคาจริง) lives in
  the Drive clone only, per README. Before starting work, confirm the clone is current — compare
  `git fetch && git log origin/UAT --oneline -1` with `git log --oneline -1`. On the Drive clone,
  keep the folder "Available offline" and let Drive finish syncing before running git — a
  half-synced `.git` is how that copy gets corrupted (files named `index (1)` inside `.git`, or
  `07_sales (1).gs`, mean a Drive collision: re-clone from GitHub rather than trying to repair).
- Mascot source art (~2 MB PNGs) is kept outside the repo at `G:\Shared drives\AppSpace\mascot-source\`.
  Only the web-sized export `frontend-admin/mascot-sr1.png` (344 KB, displayed at 236×236 on the
  login screen and 60×60 in the sidebar) is committed; bump its `?v=` query in `index.html` when
  replacing it so browsers don't serve a cached copy.

## Deploying

- Frontend (`frontend-admin/index.html`, `config.js`, `pricelist-parser.js`): just push to `UAT` (or
  `main`) — `.github/workflows/deploy-admin.yml` deploys automatically to `/admin-uat/` or `/admin/`.
  **แก้ `config.js` เมื่อไหร่ ให้บัมป์ `?v=` ของ `<script src="config.js?v=…">` ใน `index.html` ด้วย** ทั้งสองแอป —
  เบราว์เซอร์แคชไฟล์นี้ไว้ ผู้ใช้เดิมจะยังยิงไป backend ตัวเก่าจนกว่าแคชหมดอายุ (เจอมาแล้วตอนเปิด prod 2026-09-24)
  อีกอาการของวันนั้น: บิลด์ของ Pages ที่ทริกเกอร์จาก push ขึ้น `main` ประกอบ `/mobile/` จาก main ได้ไฟล์ **เก่า**
  (ทั้งที่ main มีคอมมิตแล้ว ส่วน `/mobile-uat/` จาก UAT ได้ไฟล์ใหม่) — แก้ด้วยการ push อีกครั้งให้บิลด์ใหม่
  วิธีเช็คของจริงที่เสิร์ฟอยู่: `curl -s '<pages url>/mobile/config.js?cb=1' | grep …` อย่าดูจากเบราว์เซอร์อย่างเดียว
- Backend: `.dev/push-backend.sh dev|uat|prod` pushes the `.gs` files via `clasp` (`prod` refuses with
  a message until `backend/.clasp.prod.json` exists), but that alone
  does **not** redeploy the live Web App URL — Apps Script libraries need an explicit new deployment
  version. For UAT, redeploy the *existing* deployment (so the URL in `frontend-admin/config.js`
  keeps working) with something like:
  ```bash
  TMP=$(mktemp -d) && cp backend/.clasp.uat.json "$TMP/.clasp.json" && cp backend/appsscript.json "$TMP/" \
    && cd "$TMP" && clasp deploy -i <existing UAT deployment id> -d "description"
  ```
  Find `<existing UAT deployment id>` from the URL in `frontend-admin/config.js` (`BACKENDS.uat`) —
  it's the `.../macros/s/<deployment id>/exec` segment. Deploys are always done by the user
  themselves (Deploy → New version) per their standing instruction, not automated by Claude.
- Apps Script project IDs: **dev = `1iVJDVuc…`** (`backend/.clasp.dev.json`, and still the default
  `backend/.clasp.json`), **uat = `1SDBJgSN…`** (`backend/.clasp.uat.json`), **prod = `1XObaZXu…`**
  (`backend/.clasp.prod.json`, สร้างโดย `channarong@thanatkorn.com` 2026-09-24).
  ค่าที่ต่างกันรายสภาพแวดล้อม **ไม่มีอยู่ในโค้ดเลย** — อยู่ใน Script Properties ของแต่ละโปรเจกต์ล้วนๆ
  (`CENTRAL_SHEET_FILEID`, `ENV_NAME`, `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `LIFF_ID`,
  `ENDPOINT_URL`, `DB_ROOT_FOLDER_ID`) และ property ไม่ติดไปกับการ copy โปรเจกต์ จึงต้องตั้งใหม่ทุกครั้ง.
  The deployment `AKfycbzDLcX5…` lives in the **dev** project — it is NOT production,
  whatever its description says. (This file claimed the opposite until 2026-09-23: the repo called dev
  "production", so `/admin/` was wired to the dev backend and `push-backend.sh prod` pushed into dev.)
  The dev project also holds two unrelated old `salesranger-isp` deployments; leave them alone.
- `clasp` needs `clasp login` with a Google account that has edit access to the dev and UAT
  Apps Script projects. This is a per-machine login
  (`~/.clasprc.json`) — a fresh machine/account needs to run it again.
- `clasp push` works for any account the project is shared with as Editor, but `clasp deploy` only
  works for accounts **in the same Google Workspace domain as the script owner**. On the dev
  machine clasp is logged in as `info@tnk.co.th`, which can push to dev/uat but cannot deploy them —
  after `push-backend.sh uat` the user redeploys the UAT deployment (`AKfycbwsdg…`) from
  the Apps Script editor (Manage deployments → edit → New version).
  **prod is different**: that project was created by `info@tnk.co.th` itself, so
  `clasp create-deployment` / `clasp update-deployment <id>` work from here (still ask the user first —
  a prod deploy is their call).

## Testing

- `node .dev/test-pricing-engine.js` — pure unit tests of `priceCart()`, no network, runs anywhere.
- `node .dev/test-pricelist-edit.js` — unit tests of the manual price-entry actions (create / clone /
  savePriceListLine / deletePriceListLine / savePriceListBillPromos) against in-memory fake sheets,
  including the draft-only rule and that saved rows price correctly through `priceCart()`.
- `node .dev/test-drive-layout.js` — unit tests ของการจัดโฟลเดอร์ไฟล์ฐานข้อมูล (แยก env, TNKI, โฟลเดอร์ต่อตัวแทน,
  รันซ้ำไม่สร้างซ้ำ) ด้วย DriveApp จำลอง
- `node .dev/test-purchasing-accounting.js` — unit tests ของงานซื้อ+บัญชีทั้งสาย (PR/อนุมัติหลายขั้น/PO/รับของ/
  ต้นทุนเฉลี่ย/AP/AR/งบทดลอง/งบกำไรขาดทุน/งบดุล) บนชีตจำลอง ไม่ยิงเน็ต — รวมหมวดแยกข้อมูลตัวแทน
  (ตัวแทนเปิด PR/PO/รับของเองได้ · บริษัทมองไม่เห็นของตัวแทนและกลับกัน · ไม่แตะบัญชีบริษัท).
- `node .dev/test-flags.js` — unit tests ของ `isFlagOn/isFlagOff/isNotOff` (`02_helpers.gs`) และจุดที่เคยพังเพราะ
  Sheets แปลงสตริง `'TRUE'` เป็น boolean `true`.
- `node .dev/test-roles.js` — unit tests ของระบบบทบาท/สิทธิ์ (`26_roles.gs`): สร้าง/แก้/ลบบทบาท, กติกากันยกระดับ
  สิทธิ์เกินของตัวเอง, ขอบเขตบทบาทของตัวแทน, `resolveAssignableRole`.
- `node .dev/test-line-auth.js` — unit tests ของการยืนยัน LINE ID token (`27_line_auth.gs`) ด้วย UrlFetchApp จำลอง:
  token ของแอปอื่น/หมดอายุ/ปลอมต้องไม่ผ่าน, สวมรอย lineUserId คนอื่นไม่ได้, แคชไม่ยิงซ้ำ, ความเข้มตาม env.
- `UAT_URL='<uat exec url>' node .dev/uat-sale-e2e.js` — full end-to-end test against the live UAT
  backend (creates a throwaway test tenant/customer/staff, runs pricing + sales-order scenarios
  through both the mobile and admin action surfaces). Refuses to run against the production URL as a
  safety check. Re-run this after any pricing-engine or sales-order backend change before calling it
  verified.
- `UAT_URL='<uat exec url>' node .dev/uat-purchasing-e2e.js` — live UAT test ของงานซื้อ+บัญชีทั้งสาย
  (ผู้ขาย → สายอนุมัติ 2 ขั้น → PR → PO → รับของ 2 ครั้ง → ตั้งหนี้ → จ่าย → ลูกหนี้ → งบทดลอง/งบดุล)
  ทิ้งเอกสารทดสอบชื่อขึ้นต้น `E2E` ไว้ใน UAT (เอกสารที่ลงบัญชีแล้วลบไม่ได้ตามหลักบัญชี)
- `UAT_URL='<uat exec url>' node .dev/uat-pricelist-edit-e2e.js` — live UAT test of manual price entry
  (clone an active list, edit/delete lines, bill promos, empty list; confirms active lists refuse edits).
  Only touches drafts it creates and deletes them at the end.
- Before trusting a UAT/prod deployment, check it actually runs the expected code: a deployment
  version snapshots whatever is at the project's HEAD, and a push from a stale clone silently puts
  old code there (happened 2026-09-22 — UAT @10 was built from `5861bc1`). Quick check: call a new
  action and make sure it doesn't answer `ไม่พบ action`, or `clasp pull` into a temp dir and diff.

## Current status (as of the last work in this repo)

On `main` (`5861bc1`, merged 2026-09-22) and served at `/admin/`, which is **closed** until a real
production environment exists. That day's backend push went into the **dev** project by mistake (the
repo called dev "production"); dev's live deployment was never updated, so nothing live changed:
- Price-list/discount system: Excel import wizard, tiered case pricing, cash/credit split, bill-level
  promos, admin "ทดลองคิดราคา" price tester (`backend/17_pricing.gs`, `18_pricing_engine.gs`).
- Admin-side Sales Order module: list/detail/open-new-sale/cancel, working both in tenant mode and
  in owner ("บริษัทเจ้าของสินค้า") mode via the HOUSE tenant (`backend/19_sales_admin.gs`).

On UAT only (user testing on `/admin-uat/`):
- Manual price entry/edit (2026-09-22): `createPriceList`, `clonePriceList`, `savePriceListLine`,
  `deletePriceListLine`, `savePriceListBillPromos` in `backend/17_pricing.gs`; UI on the ชุดราคา list
  (สร้างชุดราคาใหม่ / คัดลอกเป็นงวดใหม่) and detail pages (✎ แก้ไขราคา mode + per-line modal +
  bill-promo editor).

- งานซื้อ + บัญชี (2026-09-23): ผู้ขาย/คลัง/สายอนุมัติ (`20_purchasing_master.gs`), ใบขอซื้อพร้อมสายอนุมัติ
  หลายขั้น (`21`), ใบสั่งซื้อ + รับของเข้าคลัง + ต้นทุนเฉลี่ย (`22`), บัญชีแยกประเภท/เจ้าหนี้/ลูกหนี้ +
  งบทดลอง/งบกำไรขาดทุน/งบดุล + อายุหนี้ (`23`). ทดสอบด้วย unit test ครบสายและ UI กับ mock backend แล้ว —
  **ยังไม่เคยรันกับ backend UAT จริง** (รอ deploy + ทดสอบ)
- แก้บั๊ก boolean/string ทั้งระบบ (2026-09-24): `isFlagOn/isFlagOff/isNotOff` ใน `02_helpers.gs` แทนการเทียบ
  `String(x) === 'TRUE'` ทุกจุด (13 แห่งใน `04/06/07/10/11/12/14/17/19`) — โปรโมชั่นเก่าที่ไม่เคยทำงานจะเริ่ม
  ทำงานแล้ว และสินค้า/ลูกค้าที่ปิดใช้งานจะไม่โผล่ในแอปมือถืออีก
- ข้อมูลบริษัท + ระบบบทบาท/สิทธิ์ (2026-09-24): `25_company.gs` (เมนู ตั้งค่าระบบ → ข้อมูลบริษัท — ชื่อบริษัทนี้
  ไปแสดงเป็นตัวเลือกบริษัทด้านบนแทนคำว่า "บริษัทเจ้าของสินค้า" และไม่มีรายการ HOUSE ซ้ำในลิสต์ตัวแทนอีก) และ
  `26_roles.gs` (กลุ่มเมนู "ผู้ใช้งานและสิทธิ์" — แอดมินแต่ละบริษัทสร้างบทบาทและติ๊กสิทธิ์ดู/แก้ รายโมดูลได้เอง
  โดยให้สิทธิ์เกินที่ตัวเองมีไม่ได้ และบทบาทของระบบแก้ไม่ได้ ต้องคัดลอกก่อน)
- งานซื้อสำหรับตัวแทนจำหน่าย (2026-09-24): ตัวแทนซื้อของเข้าคลังตัวเองได้ครบสาย PR → อนุมัติ → PO → รับของ →
  สต็อก/ต้นทุนเฉลี่ย โดยข้อมูลแยกด้วย `tenant_id` (ดูหัวข้องานซื้อด้านบน) พร้อมเมนูฝั่งตัวแทนกลุ่ม 5 งานซื้อ
  และกลุ่ม 6 คลังสินค้า
- LINE LIFF mobile sales app scaffold (2026-09-22): `frontend-mobile/index.html` + `config.js`, deployed
  by the same Pages workflow to `/mobile-uat/` (and `/mobile/` once on `main`). Tested against a mock
  backend only — see `frontend-mobile/README.md` for screens, offline-queue rules and what's missing.

Pending / not started:
- LIFF IDs for both environments (LINE Developers Console → `frontend-mobile/config.js`).
- ทดสอบ LIFF จริงบนมือถือหลังเปิดใช้การยืนยัน ID token (ดูหัวข้อ "ตัวตนของแอปมือถือ") — ต้องติ๊ก scope
  `openid` ใน LIFF app ก่อน ไม่งั้น `liff.getIDToken()` ว่างและแอปจะวนล็อกอิน
- บัญชีของตัวแทนจำหน่าย (สมุดแยกของตัวแทนเอง) — ตอนนี้ตัวแทนซื้อของและเก็บสต็อกได้ แต่ไม่มีเจ้าหนี้/สมุดบัญชี
- โอนย้าย/เบิกจ่ายสต็อกของตัวแทนแบบมีเอกสาร (เมนู 6.3/6.4 ฝั่งตัวแทนยังเป็น "เร็วๆ นี้")
- Minor open items noted in code comments: 10505's base unit was imported as ชิ้น but is probably
  แผ่น/ซอง; a per-shop pack quantity cap (ไม่เกิน 4 แพ็ค) isn't implemented; free goods (ของแถม) are
  deferred per the user's own prioritization.
