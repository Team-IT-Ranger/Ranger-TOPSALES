# CLAUDE.md — orientation for a fresh Claude Code session

Read this first. It covers the things that aren't obvious from the code alone: business rules,
environment gotchas, and where things stand. Architecture/deploy mechanics are in
[README.md](README.md) and [backend/README.md](backend/README.md) — this file doesn't repeat those,
it fills the gaps around them.

## Golden rules

1. **All work happens on git branch `UAT`. Never commit to `main` directly.** `main` only moves via
   `git merge UAT --ff-only`, and only after the user explicitly approves what's on UAT. See
   README.md's UAT/Production table for the exact promote steps (`.dev/push-backend.sh prod` +
   manual Deploy → New version in the Apps Script editor — production deploys are never automated).
2. **UAT and production are fully separate**: different git branch deploy targets
   (`/admin-uat/` vs `/admin/` on GitHub Pages), different Apps Script projects
   (`backend/.clasp.uat.json` vs `backend/.clasp.json`), different Central Sheets, different Tenant
   Sheets. Never let UAT code/data touch the production Apps Script project or Sheet.
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
  GitHub: `G:\Shared drives\AppSpace\salesranger-TOPSHOP` (Google Shared Drive — the working copy)
  and `C:\Users\dev-administrator\appdev\salesranger-TOPSHOP` (local — backup / second checkout).
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
- Backend: `.dev/push-backend.sh uat` (or `prod`) pushes the `.gs` files via `clasp`, but that alone
  does **not** redeploy the live Web App URL — Apps Script libraries need an explicit new deployment
  version. For UAT, redeploy the *existing* deployment (so the URL in `frontend-admin/config.js`
  keeps working) with something like:
  ```bash
  TMP=$(mktemp -d) && cp backend/.clasp.uat.json "$TMP/.clasp.json" && cp backend/appsscript.json "$TMP/" \
    && cd "$TMP" && clasp deploy -i <existing UAT deployment id> -d "description"
  ```
  Find `<existing UAT deployment id>` from the URL in `frontend-admin/config.js` (`BACKENDS.uat`) —
  it's the `.../macros/s/<deployment id>/exec` segment. For production this needs the user's
  explicit go-ahead and is normally done by the user themselves (Deploy → New version) per their
  standing instruction, not automated by Claude.
- Apps Script project IDs: **production = `1iVJDVuc…` (`backend/.clasp.json`)**, UAT = `1SDBJgSN…`
  (`backend/.clasp.uat.json`). The production Web App deployment (`AKfycbzDLcX5…`, the one
  `/admin/` calls) is labelled "salesranger-TOPSHOP-be**(dev)**" for historical reasons and people
  sometimes call it "backend dev" — it **is** production. There is no third project. The same
  project also holds two unrelated old `salesranger-isp` deployments; leave them alone.
- `clasp` needs `clasp login` with a Google account that has edit access to both the "TOPSHOP
  Backend" (prod) and "TOPSHOP Backend UAT" Apps Script projects. This is a per-machine login
  (`~/.clasprc.json`) — a fresh machine/account needs to run it again.
- `clasp push` works for any account the project is shared with as Editor, but `clasp deploy` only
  works for accounts **in the same Google Workspace domain as the script owner**. On the dev
  machine clasp is logged in as `info@tnk.co.th`, which can push to both projects but cannot
  deploy — after `push-backend.sh uat` the user redeploys the UAT deployment (`AKfycbwsdg…`) from
  the Apps Script editor (Manage deployments → edit → New version), same as production.

## Testing

- `node .dev/test-pricing-engine.js` — pure unit tests of `priceCart()`, no network, runs anywhere.
- `node .dev/test-pricelist-edit.js` — unit tests of the manual price-entry actions (create / clone /
  savePriceListLine / deletePriceListLine / savePriceListBillPromos) against in-memory fake sheets,
  including the draft-only rule and that saved rows price correctly through `priceCart()`.
- `UAT_URL='<uat exec url>' node .dev/uat-sale-e2e.js` — full end-to-end test against the live UAT
  backend (creates a throwaway test tenant/customer/staff, runs pricing + sales-order scenarios
  through both the mobile and admin action surfaces). Refuses to run against the production URL as a
  safety check. Re-run this after any pricing-engine or sales-order backend change before calling it
  verified.

## Current status (as of the last work in this repo)

Promoted to production on 2026-09-22 (`main` = `5861bc1`, backend pushed to the prod project):
- Price-list/discount system: Excel import wizard, tiered case pricing, cash/credit split, bill-level
  promos, admin "ทดลองคิดราคา" price tester (`backend/17_pricing.gs`, `18_pricing_engine.gs`).
- Admin-side Sales Order module: list/detail/open-new-sale/cancel, working both in tenant mode and
  in owner ("บริษัทเจ้าของสินค้า") mode via the HOUSE tenant (`backend/19_sales_admin.gs`).

On UAT only (user testing on `/admin-uat/`):
- Manual price entry/edit (2026-09-22): `createPriceList`, `clonePriceList`, `savePriceListLine`,
  `deletePriceListLine`, `savePriceListBillPromos` in `backend/17_pricing.gs`; UI on the ชุดราคา list
  (สร้างชุดราคาใหม่ / คัดลอกเป็นงวดใหม่) and detail pages (✎ แก้ไขราคา mode + per-line modal +
  bill-promo editor).

Pending / not started:
- The LINE LIFF mobile sales app (`frontend-mobile/`) — not started; base it on
  `frontend-mobile/_legacy-standalone-liff-app`.
- Minor open items noted in code comments: 10505's base unit was imported as ชิ้น but is probably
  แผ่น/ซอง; a per-shop pack quantity cap (ไม่เกิน 4 แพ็ค) isn't implemented; free goods (ของแถม) are
  deferred per the user's own prioritization.
