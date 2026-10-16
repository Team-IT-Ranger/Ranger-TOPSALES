<!-- ★ ไฟล์นี้ถูกสร้างด้วย `node .dev/gen-blueprint.js` ห้ามแก้ด้วยมือ — แก้แล้วจะถูกทับ
     เพิ่ม action / ตาราง / โมดูล / เอกสารใหม่แล้ว รันตัวนี้ซ้ำ แบบจะตามเอง -->
# แผ่น 06 — รายการประกอบแบบ (สร้างจากโค้ด)

> สร้างเมื่อ 2026-10-16 จากโค้ดใน repo นี้ · `node .dev/gen-blueprint.js` เพื่อสร้างใหม่
> · `node .dev/gen-blueprint.js --check` เพื่อเช็คว่าแบบยังตรงกับโค้ดอยู่

แผ่นนี้ตอบคำถาม **"มีอะไรอยู่บ้าง"** · ส่วน **"ทำไมและห้ามแตะอะไร"** อยู่ในแผ่น
[01](01-site-plan.md)–[05](05-contracts.md) ซึ่งเขียนมือ

## A. ขนาดของสิ่งก่อสร้าง

| ส่วน | ไฟล์ | บรรทัด |
|---|---|---|
| Backend (Apps Script) | 58 ไฟล์ `.gs` | 16,020 |
| แอดมิน (หน้าเว็บ) | `frontend-admin/` | 11,439 |
| แอปมือถือ (LIFF) | `frontend-mobile/` | 1,406 |
| ตารางข้อมูล | 66 ชีตกลาง + 14 ชีตต่อตัวแทน |  |
| Action | 18 มือถือ + 212 แอดมิน |  |

## B. ไฟล์ backend — ผังพื้นแบบละเอียด

เลขนำหน้าไฟล์คือ**ลำดับที่ Apps Script โหลด** ไฟล์เลขน้อยถูกอ่านก่อน จึงใช้เลขน้อยกับของที่คนอื่นเรียก

| ไฟล์ | บรรทัด | หัวเรื่องในไฟล์ |
|---|---|---|
| `00_setup_sheets.gs` | 557 | SETUP: CENTRAL SHEET |
| `01_config.gs` | 23 | CONFIG |
| `02_helpers.gs` | 446 | SHEET ACCESS LAYER |
| `03_cache.gs` | 47 | CACHE HELPERS |
| `04_auth.gs` | 226 | AUTH |
| `05_router.gs` | 322 | ROUTER |
| `06_bootstrap.gs` | 304 | BOOTSTRAP / DASHBOARD (Mobile App) |
| `07_sales.gs` | 402 | SALES (Mobile App — Cash Van) |
| `08_stock.gs` | 73 | VAN STOCK (Mobile App) |
| `09_visits.gs` | 31 | VISITS (Mobile App) |
| `10_master_data.gs` | 436 | MASTER DATA |
| `11_promotions.gs` | 198 | PROMOTION ENGINE |
| `12_docnum.gs` | 354 | DOCUMENT NUMBER CONTROL (ต่อตัวแทน) |
| `13_tenants.gs` | 512 | TENANT ONBOARDING (บริษัทเจ้าของสินค้าเท่านั้น) |
| `14_permissions.gs` | 164 | RBAC (Admin App) |
| `15_import_export_express.gs` | 229 | เชื่อมโปรแกรม EXPRESS (Export/Import ไฟล์) |
| `16_admin_users.gs` | 149 | จัดการบัญชีแอดมิน (Admin App) |
| `17_pricing.gs` | 553 | ชุดราคาและส่วนลด (ใบรายการขายตามกลุ่มลูกค้า × ช่วงเวลา) |
| `18_pricing_engine.gs` | 423 | เครื่องยนต์คิดราคา (ใช้ทั้งตอนขายจริง recordSale และหน้า "ทดลองคิดราคา |
| `19_sales_admin.gs` | 474 | SALES (Admin App) |
| `20_purchasing_master.gs` | 312 | งานซื้อ: ข้อมูลตั้งต้น (ผู้ขาย / คลัง / สายอนุมัติ) |
| `21_purchase_requisition.gs` | 252 | ใบขอซื้อ (Purchase Requisition) |
| `22_purchase_order.gs` | 538 | ใบสั่งซื้อ (PO) และการรับของเข้าคลัง (GR) |
| `23_accounting.gs` | 827 | บัญชี: แยกประเภท (GL) / เจ้าหนี้ (AP) / ลูกหนี้ (AR) |
| `24_drive_layout.gs` | 137 | ที่เก็บไฟล์ฐานข้อมูลบน Google Drive |
| `25_company.gs` | 87 | ข้อมูลบริษัทเจ้าของสินค้า (ตั้งค่าระบบ) |
| `26_roles.gs` | 185 | บทบาทและสิทธิ์ผู้ใช้งาน (กลุ่มเมนู "ผู้ใช้งานและสิทธิ์") |
| `27_line_auth.gs` | 106 | ยืนยันตัวตน LINE (ID token จาก LIFF) |
| `28_units.gs` | 125 | หน่วยนับมาตรฐานของระบบ |
| `29_admin_signup.gs` | 289 | ลงทะเบียนผู้ใช้ใหม่ + รออนุมัติ (Admin App) |
| `30_admin_line_login.gs` | 110 | เข้าสู่ระบบแอปแอดมินด้วย LINE |
| `31_sales_rollup.gs` | 82 | สรุปยอดขายรายวัน (rollup) |
| `32_admin_bootstrap.gs` | 37 | เปิดแอปแอดมินด้วยคำขอเดียว |
| `33_customers.gs` | 309 | ทะเบียนลูกค้า (customer master) |
| `34_sales_status.gs` | 856 | สถานะบิลขาย |
| `35_idempotency.gs` | 84 | กันบันทึกซ้ำ (idempotency) |
| `36_price_rules.gs` | 451 | สิทธิ์เข้าถึงชุดราคา (price list eligibility) |
| `37_customer_bulk.gs` | 129 | จัดกลุ่มลูกค้าเป็นชุด (bulk assign) |
| `38_package_distribution.gs` | 220 | การจ่ายชุดราคา/โปรโมชั่นให้ตัวแทน (package distribution) |
| `39_free_goods.gs` | 274 | ชุดแถม (free goods) |
| `40_customer_lists.gs` | 170 | รายชื่อร้านค้า (customer lists) |
| `41_sales_reports.gs` | 226 | รายงานการขาย (เมนู 1.8.1 / 1.8.2 / 1.8.3) |
| `42_help_center.gs` | 88 | คู่มือใช้งานระบบ (Help Center) — module 8 |
| `43_external_sales_import.gs` | 543 | นำเข้ารายการขายออกจากบริษัท → ใบสั่งซื้อ+ใบรับของของศูนย์ (2026-10-02) |
| `44_product_categories.gs` | 97 | hit.category && curSub |
| `45_unit_rescale.gs` | 75 | ปรับ "ขนาดหน่วยฐาน" ของสินค้า — งานครั้งเดียวที่รันจาก Apps Script edi |
| `46_customer_requests.gs` | 368 | null \|\| v |
| `47_address_refs.gs` | 133 | ══════════════════════════════════════════════════════════════════════ |
| `48_delivery_rounds.gs` | 649 | รอบจัดส่ง · ของค้างส่ง (แอดมินศูนย์ขอ 14 ต.ค. 2026) |
| `49_credit_notes.gs` | 451 | ใบลดหนี้ (Credit Note) · ใบเพิ่มหนี้ (Debit Note) — 15 ต.ค. 2026 |
| `50_cogs.gs` | 289 | ต้นทุนขาย (COGS) |
| `51_tax_reports.gs` | 211 | รายงานภาษีขาย / ภาษีซื้อ (สำหรับยื่น ภ.พ.30) |
| `52_cash_sales_gl.gs` | 131 | ลงบัญชีการขายสด |
| `53_billing_notes.gs` | 198 | ใบวางบิล (Billing Note) |
| `54_goods_returns.gs` | 303 | ใบรับคืนสินค้า (Goods Return Note) |
| `55_van_stock_link.gs` | 183 | เชื่อมสต็อกรถกับคลังกลาง + ต้นทุนขายของการขายจากรถ |
| `56_customer_credit.gs` | 290 | วงเงินเครดิตและหนี้ค้างของลูกค้า |
| `99_dev_tools.gs` | 282 | DEV TOOLS (Apps Script Editor เท่านั้น) |

## C. Action ทั้งหมด (ทางเข้าของระบบ)

**ทางเข้ามีทางเดียวคือ `doPost`** แล้วแยกเป็นสามพื้นผิว เพราะวิธียืนยันตัวตนต่างกัน — ดู [แผ่น 01](01-site-plan.md) หัวข้อ "ทางเข้า"

ช่อง "สิทธิ์" อ่านจาก `_requirePermission()` ในตัวฟังก์ชันจริง **เครื่องหมาย — คือไม่พบการตรวจสิทธิ์** (ถูกต้องสำหรับ action ที่ตรวจเองด้วยวิธีอื่น แต่ถ้าเป็น action ที่เขียนข้อมูล ให้สงสัยไว้ก่อน)

### C.1 แอปมือถือ — `ACTION_MAP` (ยืนยันตัวตนด้วย LINE ID token)

| action | นิยามที่ | สิทธิ์ | กันกดซ้ำ |
|---|---|---|---|
| `addCompetitor` | `09_visits.gs` | — |  |
| `addCustomer` | `10_master_data.gs` | — | requestId |
| `addVisitNote` | `09_visits.gs` | — |  |
| `cancelMySalesOrder` | `34_sales_status.gs` | — |  |
| `checkInVisit` | `09_visits.gs` | — |  |
| `confirmSalesOrder` | `34_sales_status.gs` | — |  |
| `getBootstrap` | `06_bootstrap.gs` | — |  |
| `getDashboard` | `06_bootstrap.gs` | — |  |
| `getRecentSales` | `06_bootstrap.gs` | — |  |
| `getSaleDetail` | `06_bootstrap.gs` | — |  |
| `listMyCustomerRequests` | `46_customer_requests.gs` | — |  |
| `listShopTypesMobile` | `46_customer_requests.gs` | — |  |
| `markCustomerRequestSeen` | `46_customer_requests.gs` | — |  |
| `quoteSale` | `07_sales.gs` | — |  |
| `recordSale` | `07_sales.gs` | — | requestId |
| `restockVan` | `08_stock.gs` | — | requestId |
| `submitCount` | `08_stock.gs` | — | requestId |
| `submitCustomerRequest` | `46_customer_requests.gs` | — | requestId |

### C.2 แอดมิน — `ADMIN_ACTION_MAP` (ยืนยันตัวตนด้วย token จากการล็อกอิน)

| action | นิยามที่ | สิทธิ์ | กันกดซ้ำ |
|---|---|---|---|
| `addCustomerAdmin` | `10_master_data.gs` | customers:edit | กันกดซ้ำ · requestId |
| `addCustomerGroup` | `10_master_data.gs` | settings:edit | กันกดซ้ำ |
| `addCustomerListMembers` | `40_customer_lists.gs` | customers:edit | กันกดซ้ำ |
| `addDistributionChannel` | `10_master_data.gs` | settings:edit | กันกดซ้ำ |
| `addPaymentType` | `10_master_data.gs` | settings:edit | กันกดซ้ำ |
| `addProduct` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `addProductGroup` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `addProductUnit` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `addPromotion` | `11_promotions.gs` | promotions:edit | กันกดซ้ำ |
| `applyCustomerBulkAssign` | `37_customer_bulk.gs` | customers:edit | กันกดซ้ำ |
| `approveAdminUser` | `29_admin_signup.gs` | users_roles:edit | กันกดซ้ำ |
| `approveCustomerRequest` | `46_customer_requests.gs` | customers:edit | กันกดซ้ำ · requestId |
| `backfillCustomerAreas` | `47_address_refs.gs` | customers:edit | กันกดซ้ำ |
| `backfillGrJournals` | `23_accounting.gs` | — |  |
| `backfillUserAffiliations` | `13_tenants.gs` | — | กันกดซ้ำ |
| `cancelBillingNote` | `53_billing_notes.gs` | accounting:edit | กันกดซ้ำ |
| `cancelGoodsReceipt` | `22_purchase_order.gs` | inventory:edit | กันกดซ้ำ |
| `cancelGoodsReturn` | `54_goods_returns.gs` | sales:edit | กันกดซ้ำ |
| `cancelPurchaseOrder` | `22_purchase_order.gs` | purchasing:edit | กันกดซ้ำ |
| `cancelPurchaseRequisition` | `21_purchase_requisition.gs` | purchasing:edit | กันกดซ้ำ |
| `cancelSalesOrderAdmin` | `19_sales_admin.gs` | sales:edit | กันกดซ้ำ |
| `changeMyPassword` | `16_admin_users.gs` | — | กันกดซ้ำ |
| `clonePriceList` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `confirmExternalGoodsReceipt` | `43_external_sales_import.gs` | inventory:edit | กันกดซ้ำ · requestId |
| `createAdminUser` | `16_admin_users.gs` | users_roles:edit | กันกดซ้ำ |
| `createApBillFromGr` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ · requestId |
| `createApBillManual` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ · requestId |
| `createArCreditNote` | `49_credit_notes.gs` | accounting:edit | กันกดซ้ำ |
| `createArDebitNote` | `49_credit_notes.gs` | accounting:edit | กันกดซ้ำ |
| `createArInvoice` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ · requestId |
| `createBillingNote` | `53_billing_notes.gs` | accounting:edit | กันกดซ้ำ |
| `createCreditNoteFromReturn` | `54_goods_returns.gs` | accounting:edit | กันกดซ้ำ |
| `createGoodsReturn` | `54_goods_returns.gs` | sales:edit | กันกดซ้ำ |
| `createPriceList` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `createTenant` | `13_tenants.gs` | tenants:edit | กันกดซ้ำ · requestId |
| `deactivatePromotion` | `11_promotions.gs` | promotions:edit | กันกดซ้ำ |
| `decidePurchaseRequisition` | `21_purchase_requisition.gs` | purchasing:edit | กันกดซ้ำ |
| `deleteApprovalFlow` | `20_purchasing_master.gs` | purchasing:edit | กันกดซ้ำ |
| `deleteCustomerList` | `40_customer_lists.gs` | customers:edit | กันกดซ้ำ |
| `deleteFreeGoodsItem` | `39_free_goods.gs` | promotions:edit | กันกดซ้ำ |
| `deletePriceList` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `deletePriceListLine` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `deletePriceListRule` | `36_price_rules.gs` | pricing:edit | กันกดซ้ำ |
| `deleteRole` | `26_roles.gs` | users_roles:edit | กันกดซ้ำ |
| `deleteTestTenants` | `13_tenants.gs` | — | กันกดซ้ำ |
| `editSalesOrderAdmin` | `34_sales_status.gs` | sales:edit | กันกดซ้ำ |
| `ensureDefaultSalesUnit` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `ensureSaleDocNo` | `34_sales_status.gs` | sales:edit | กันกดซ้ำ |
| `explainCustomerPricing` | `36_price_rules.gs` | pricing:view |  |
| `exportExpressSales` | `15_import_export_express.gs` | sales_report:view |  |
| `getAccountingSettings` | `50_cogs.gs` | accounting:view |  |
| `getAdminBootstrap` | `32_admin_bootstrap.gs` | — |  |
| `getAdminDashboard` | `06_bootstrap.gs` | sales_report:view |  |
| `getApAging` | `23_accounting.gs` | accounting:view |  |
| `getArAging` | `23_accounting.gs` | accounting:view |  |
| `getArCreditNote` | `49_credit_notes.gs` | accounting:view |  |
| `getArCreditNoteDraft` | `49_credit_notes.gs` | accounting:view |  |
| `getArDebitNote` | `49_credit_notes.gs` | — |  |
| `getBalanceSheet` | `23_accounting.gs` | accounting:view |  |
| `getBillingNote` | `53_billing_notes.gs` | accounting:view |  |
| `getCompanyProfile` | `25_company.gs` | — |  |
| `getCreditSettings` | `56_customer_credit.gs` | customers:view |  |
| `getCustomerAdmin` | `10_master_data.gs` | customers:view |  |
| `getCustomerCredit` | `56_customer_credit.gs` | customers:view |  |
| `getDatabaseLayout` | `24_drive_layout.gs` | tenants:view |  |
| `getExternalSalesAutoImportStatus` | `43_external_sales_import.gs` | purchasing:view |  |
| `getFreeGoodsSet` | `39_free_goods.gs` | promotions:view |  |
| `getGoodsReceipt` | `22_purchase_order.gs` | inventory:view |  |
| `getGoodsReturn` | `54_goods_returns.gs` | sales:view |  |
| `getGoodsReturnDraft` | `54_goods_returns.gs` | sales:view |  |
| `getIncomeStatement` | `23_accounting.gs` | accounting:view |  |
| `getJournal` | `23_accounting.gs` | accounting:view |  |
| `getMyPermissions` | `26_roles.gs` | — |  |
| `getPriceList` | `17_pricing.gs` | pricing:view |  |
| `getPurchaseOrder` | `22_purchase_order.gs` | purchasing:view |  |
| `getPurchaseRequisition` | `21_purchase_requisition.gs` | purchasing:view |  |
| `getSaleDeliveryPlan` | `48_delivery_rounds.gs` | sales:view |  |
| `getSalesOrderAdmin` | `19_sales_admin.gs` | sales:view |  |
| `getSalesOrderStockFlags` | `48_delivery_rounds.gs` | sales:view |  |
| `getTenantProfile` | `13_tenants.gs` | tenants:view |  |
| `getTrialBalance` | `23_accounting.gs` | accounting:view |  |
| `getVatPurchaseReport` | `51_tax_reports.gs` | accounting:view |  |
| `getVatSalesReport` | `51_tax_reports.gs` | accounting:view |  |
| `getVatSummary` | `51_tax_reports.gs` | accounting:view |  |
| `importAddressRefs` | `47_address_refs.gs` | settings:edit | กันกดซ้ำ |
| `importExpressCustomers` | `15_import_export_express.gs` | customers:edit | กันกดซ้ำ |
| `importExpressProducts` | `15_import_export_express.gs` | products:edit | กันกดซ้ำ |
| `importExternalSalesInvoices` | `43_external_sales_import.gs` | purchasing:edit | กันกดซ้ำ · requestId |
| `importPriceList` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `issuePurchaseOrder` | `22_purchase_order.gs` | purchasing:edit | กันกดซ้ำ |
| `linkAdminLineId` | `29_admin_signup.gs` | — | กันกดซ้ำ |
| `listAddressRefs` | `47_address_refs.gs` | customers:view |  |
| `listAdminUsers` | `14_permissions.gs` | — |  |
| `listApBills` | `23_accounting.gs` | accounting:view |  |
| `listApprovalFlows` | `20_purchasing_master.gs` | purchasing:view |  |
| `listApprovedPrLines` | `21_purchase_requisition.gs` | purchasing:view |  |
| `listArCreditNotes` | `49_credit_notes.gs` | accounting:view |  |
| `listArDebitNotes` | `49_credit_notes.gs` | accounting:view |  |
| `listArInvoices` | `23_accounting.gs` | accounting:view |  |
| `listBillableInvoices` | `53_billing_notes.gs` | accounting:view |  |
| `listBillingNotes` | `53_billing_notes.gs` | accounting:view |  |
| `listCustomerCredit` | `56_customer_credit.gs` | customers:view |  |
| `listCustomerGroups` | `10_master_data.gs` | settings:view |  |
| `listCustomerListMembers` | `40_customer_lists.gs` | customers:view |  |
| `listCustomerLists` | `40_customer_lists.gs` | customers:view |  |
| `listCustomerRequests` | `46_customer_requests.gs` | customers:view |  |
| `listCustomersAdmin` | `10_master_data.gs` | customers:view |  |
| `listDistributionChannels` | `10_master_data.gs` | settings:view |  |
| `listDocSeries` | `12_docnum.gs` | docnum:view |  |
| `listFreeGoodsSets` | `39_free_goods.gs` | promotions:view |  |
| `listGlAccounts` | `23_accounting.gs` | accounting:view |  |
| `listGoodsReceipts` | `22_purchase_order.gs` | inventory:view |  |
| `listGoodsReturns` | `54_goods_returns.gs` | sales:view |  |
| `listHelpArticles` | `42_help_center.gs` | — |  |
| `listJournals` | `23_accounting.gs` | accounting:view |  |
| `listMyPackages` | `38_package_distribution.gs` | pricing:view |  |
| `listPackageTenants` | `38_package_distribution.gs` | — |  |
| `listPaymentTypes` | `10_master_data.gs` | settings:view |  |
| `listPendingAdminUsers` | `29_admin_signup.gs` | users_roles:view |  |
| `listPendingExternalGoodsReceipts` | `43_external_sales_import.gs` | inventory:view |  |
| `listPriceListChanges` | `17_pricing.gs` | pricing:view |  |
| `listPriceListRules` | `36_price_rules.gs` | pricing:view |  |
| `listPriceLists` | `17_pricing.gs` | pricing:view |  |
| `listProductGroups` | `10_master_data.gs` | products:view |  |
| `listProductUnits` | `10_master_data.gs` | products:view |  |
| `listProductsAdmin` | `10_master_data.gs` | products:view |  |
| `listPromotions` | `11_promotions.gs` | promotions:view |  |
| `listPurchaseOrders` | `22_purchase_order.gs` | purchasing:view |  |
| `listPurchaseRequisitions` | `21_purchase_requisition.gs` | purchasing:view |  |
| `listRoles` | `14_permissions.gs` | — |  |
| `listRolesWithPermissions` | `26_roles.gs` | users_roles:view |  |
| `listSalesOrdersAdmin` | `19_sales_admin.gs` | sales:view |  |
| `listShopTypes` | `46_customer_requests.gs` | — |  |
| `listStaffAdmin` | `10_master_data.gs` | staff:view |  |
| `listStockLedger` | `22_purchase_order.gs` | inventory:view |  |
| `listTenants` | `13_tenants.gs` | tenants:view |  |
| `listUnconfirmedUnits` | `10_master_data.gs` | products:view |  |
| `listUninvoicedSalesOrders` | `23_accounting.gs` | accounting:view |  |
| `listVendors` | `20_purchasing_master.gs` | vendors:view |  |
| `listWarehouseStock` | `22_purchase_order.gs` | inventory:view |  |
| `listWarehouses` | `20_purchasing_master.gs` | inventory:view |  |
| `message` | **หาไม่เจอ** | — |  |
| `migrateOwnerTenantCode` | `13_tenants.gs` | — | กันกดซ้ำ |
| `migratePackageAssignments` | `38_package_distribution.gs` | — | กันกดซ้ำ |
| `migrateUnitCodes` | `28_units.gs` | — | กันกดซ้ำ |
| `organizeDatabaseFiles` | `24_drive_layout.gs` | — | กันกดซ้ำ |
| `payApBills` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ · requestId |
| `postManualJournal` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ |
| `previewCustomerBulkAssign` | `37_customer_bulk.gs` | customers:view |  |
| `previewDocNumber` | **หาไม่เจอ** | — |  |
| `previewExternalSalesImport` | `43_external_sales_import.gs` | purchasing:edit |  |
| `previewFreeGoods` | `39_free_goods.gs` | promotions:view |  |
| `previewPriceListAudience` | `36_price_rules.gs` | pricing:view |  |
| `previewPricing` | `18_pricing_engine.gs` | pricing:view |  |
| `previewSaleAdmin` | `19_sales_admin.gs` | sales:view |  |
| `previewTestTenantCleanup` | `13_tenants.gs` | — |  |
| `promoteToAdmin` | `29_admin_signup.gs` | — | กันกดซ้ำ |
| `rebuildSalesDaily` | `31_sales_rollup.gs` | — | กันกดซ้ำ |
| `receiveArPayment` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ · requestId |
| `receiveGoods` | `22_purchase_order.gs` | inventory:edit | กันกดซ้ำ · requestId |
| `recordSaleAdmin` | `19_sales_admin.gs` | sales:edit | กันกดซ้ำ · requestId |
| `rejectAdminUser` | `29_admin_signup.gs` | users_roles:edit | กันกดซ้ำ |
| `rejectCustomerRequest` | `46_customer_requests.gs` | customers:edit | กันกดซ้ำ |
| `removeCustomerListMember` | `40_customer_lists.gs` | customers:edit | กันกดซ้ำ |
| `repairDraftOrderCodes` | `34_sales_status.gs` | — | กันกดซ้ำ |
| `resetAdminUserPasswordByAdmin` | `16_admin_users.gs` | users_roles:edit | กันกดซ้ำ |
| `salesReportByCustomer` | `41_sales_reports.gs` | sales_report:view |  |
| `salesReportByProduct` | `41_sales_reports.gs` | sales_report:view |  |
| `salesReportByStaff` | `41_sales_reports.gs` | sales_report:view |  |
| `saveAccountingSettings` | `50_cogs.gs` | accounting:edit | กันกดซ้ำ |
| `saveApprovalFlow` | `20_purchasing_master.gs` | purchasing:edit | กันกดซ้ำ |
| `saveCompanyProfile` | `25_company.gs` | settings:edit | กันกดซ้ำ |
| `saveCreditSettings` | `56_customer_credit.gs` | customers:edit | กันกดซ้ำ |
| `saveCustomerList` | `40_customer_lists.gs` | customers:edit | กันกดซ้ำ |
| `saveDeliveryRound` | `48_delivery_rounds.gs` | sales:edit | กันกดซ้ำ |
| `saveDocSeries` | `12_docnum.gs` | docnum:edit | กันกดซ้ำ |
| `saveFreeGoodsItem` | `39_free_goods.gs` | promotions:edit | กันกดซ้ำ |
| `saveFreeGoodsSet` | `39_free_goods.gs` | promotions:edit | กันกดซ้ำ |
| `saveGlAccount` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ |
| `saveHelpArticle` | `42_help_center.gs` | — | กันกดซ้ำ |
| `savePackageTenants` | `38_package_distribution.gs` | — | กันกดซ้ำ |
| `savePriceListBillPromos` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `savePriceListLine` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `savePriceListRule` | `36_price_rules.gs` | pricing:edit | กันกดซ้ำ |
| `savePurchaseOrder` | `22_purchase_order.gs` | purchasing:edit | กันกดซ้ำ · requestId |
| `savePurchaseRequisition` | `21_purchase_requisition.gs` | purchasing:edit | กันกดซ้ำ · requestId |
| `saveRole` | `26_roles.gs` | users_roles:edit | กันกดซ้ำ |
| `saveVendor` | `20_purchasing_master.gs` | vendors:edit | กันกดซ้ำ |
| `saveWarehouse` | `20_purchasing_master.gs` | inventory:edit | กันกดซ้ำ |
| `setDocCounter` | `12_docnum.gs` | docnum:edit | กันกดซ้ำ |
| `setFreeGoodsSetStatus` | `39_free_goods.gs` | promotions:edit | กันกดซ้ำ |
| `setHelpArticleActive` | `42_help_center.gs` | — | กันกดซ้ำ |
| `setPriceListStatus` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `submitPurchaseRequisition` | `21_purchase_requisition.gs` | purchasing:edit | กันกดซ้ำ |
| `success` | **หาไม่เจอ** | — |  |
| `syncProductCategories` | `44_product_categories.gs` | products:edit | กันกดซ้ำ |
| `syncTenantSheets` | `13_tenants.gs` | — | กันกดซ้ำ |
| `updateAdminUser` | `16_admin_users.gs` | users_roles:edit | กันกดซ้ำ |
| `updateCustomerAdmin` | `10_master_data.gs` | customers:edit | กันกดซ้ำ |
| `updatePriceList` | `17_pricing.gs` | pricing:edit | กันกดซ้ำ |
| `updateProduct` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `updateProductUnit` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `updatePromotion` | `11_promotions.gs` | promotions:edit | กันกดซ้ำ |
| `updateSalesOrderStatus` | `34_sales_status.gs` | sales:edit | กันกดซ้ำ |
| `updateStaffAdmin` | `10_master_data.gs` | staff:edit | กันกดซ้ำ |
| `updateTenantProfile` | `13_tenants.gs` | tenants:edit | กันกดซ้ำ |
| `updateTenantStatus` | `13_tenants.gs` | tenants:edit | กันกดซ้ำ |
| `uploadProductImage` | `10_master_data.gs` | products:edit | กันกดซ้ำ |
| `uploadTenantLogo` | `13_tenants.gs` | tenants:edit | กันกดซ้ำ |
| `voidArAdjustNote` | `49_credit_notes.gs` | accounting:edit | กันกดซ้ำ |
| `voidJournal` | `23_accounting.gs` | accounting:edit | กันกดซ้ำ |
| `withdrawExternalGoodsReceipt` | `43_external_sales_import.gs` | inventory:edit | กันกดซ้ำ |

### C.3 เรียกได้โดยไม่ต้องล็อกอิน

พื้นผิวที่คนนอกยิงถึง — **เพิ่มที่นี่ต้องคิดเรื่องการกรอกข้อมูลขยะและการสวมรอยเสมอ**

`adminLogin` · `adminLoginWithLine` · `adminLogout` · `checkUser` · `lineExchangeCode` · `lineLoginUrl` · `listActiveTenants` · `registerAdminUser` · `registerAdminUserWithLine` · `registerUser`

## D. ตารางข้อมูล

**ข้อมูลอยู่สองที่** — ชีตกลาง (Central Sheet, ไฟล์เดียวของทั้ง env) กับไฟล์ของตัวแทนแต่ละราย · เหตุผลและกติกาการเลือกที่เก็บอยู่ใน [แผ่น 03](03-structure.md)

### D.1 ชีตกลาง (`CENTRAL_SHEETS` — `00_setup_sheets.gs`)

ช่อง "แคช" = อยู่ใน `SHEET_CACHE_TABLES` (`02_helpers.gs`) อ่านข้ามคำขอได้ TTL 5 นาที — **ตารางเอกสาร/ตัวนับเลขที่/ผู้ใช้ ห้ามแคช**

| ชีต | คอลัมน์ | แคช | รายชื่อคอลัมน์ |
|---|---|---|---|
| `accounting_settings` | 9 |  | `record_id` `tenant_id` `cost_method` `cogs_from` `cash_sales` `cash_from` `van_issue` `updated_at` `updated_by` |
| `admin_users` | 10 |  | `record_id` `username` `password_hash` `salt` `display_name` `role_code` `tenant_id` `status` `created_at` `line_user_id` |
| `ap_bills` | 18 |  | `record_id` `tenant_id` `bill_no` `vendor_invoice_no` `vendor_id` `po_id` `gr_id` `bill_date` `due_date` `subtotal_ex_vat` `vat_amount` `total` `paid_amount` `status` `journal_id` `note` `created_by` `created_at` |
| `ap_payment_allocations` | 4 |  | `record_id` `payment_id` `bill_id` `amount` |
| `ap_payments` | 13 |  | `record_id` `tenant_id` `payment_no` `vendor_id` `payment_date` `amount` `method` `bank_account` `note` `status` `journal_id` `created_by` `created_at` |
| `approval_flow_steps` | 7 | ✓ | `record_id` `flow_id` `step_no` `name` `approver_type` `approver_ref` `required_approvals` |
| `approval_flows` | 9 | ✓ | `record_id` `tenant_id` `doc_type` `name` `min_amount` `max_amount` `is_active` `note` `created_at` |
| `ar_credit_note_items` | 11 |  | `record_id` `note_id` `credit_note_id` `order_item_id` `product_id` `unit_code` `unit_factor` `qty` `unit_price` `amount` `tax_status` |
| `ar_credit_notes` | 20 |  | `record_id` `credit_note_no` `ar_invoice_id` `invoice_no` `customer_id` `tenant_id` `sales_order_id` `delivery_round_id` `credit_date` `reason_code` `reason` `vat_rate` `subtotal_ex_vat` `vat_amount` `total` `stock_returned` `journal_id` `status` `created_by` `created_at` |
| `ar_debit_note_items` | 11 |  | `record_id` `note_id` `debit_note_id` `order_item_id` `product_id` `unit_code` `unit_factor` `qty` `unit_price` `amount` `tax_status` |
| `ar_debit_notes` | 20 |  | `record_id` `debit_note_no` `ar_invoice_id` `invoice_no` `customer_id` `tenant_id` `sales_order_id` `delivery_round_id` `credit_date` `reason_code` `reason` `vat_rate` `subtotal_ex_vat` `vat_amount` `total` `stock_returned` `journal_id` `status` `created_by` `created_at` |
| `ar_invoices` | 19 |  | `record_id` `invoice_no` `customer_id` `tenant_id` `sales_order_id` `delivery_round_id` `invoice_date` `due_date` `subtotal_ex_vat` `vat_amount` `total` `received_amount` `credited_amount` `debited_amount` `status` `journal_id` `note` `created_by` `created_at` |
| `ar_receipt_allocations` | 4 |  | `record_id` `receipt_id` `invoice_id` `amount` |
| `ar_receipts` | 13 |  | `record_id` `tenant_id` `receipt_no` `customer_id` `receipt_date` `amount` `method` `bank_account` `note` `status` `journal_id` `created_by` `created_at` |
| `billing_note_items` | 7 |  | `record_id` `note_id` `invoice_id` `invoice_no` `invoice_date` `due_date` `amount` |
| `billing_notes` | 12 |  | `record_id` `tenant_id` `note_no` `customer_id` `note_date` `due_date` `invoice_count` `total` `status` `note` `created_by` `created_at` |
| `central_doc_counters` | 3 |  | `doc_type` `period_key` `last_number` |
| `company_profile` | 18 | ✓ | `record_id` `name` `legal_name` `tax_id` `branch_code` `address` `phone` `email` `website` `logo_url` `bank_name` `bank_account_no` `bank_account_name` `note` `updated_at` `updated_by` `vat_rate` `default_vat_type` |
| `credit_settings` | 6 |  | `record_id` `tenant_id` `mode` `overdue_days` `updated_at` `updated_by` |
| `customer_groups` | 3 | ✓ | `record_id` `name` `description` |
| `customer_list_members` | 4 | ✓ | `record_id` `list_id` `customer_id` `added_at` |
| `customer_lists` | 6 | ✓ | `record_id` `name` `tenant_id` `note` `created_at` `created_by` |
| `customer_requests` | 28 |  | `record_id` `request_no` `tenant_id` `status` `requested_by` `requested_by_name` `requested_at` `name` `address` `tax_id` `contact_name` `phone` `payment_type` `credit_limit` `shop_type_id` `lat` `lng` `note` `group_id` `customer_id` `customer_code` `reject_reason` `decided_by` `decided_by_name` `decided_at` `seen_at` `created_at` `updated_at` |
| `customers` | 41 | ✓ | `record_id` `customer_code` `name_prefix` `name` `name_2` `tenant_id` `group_id` `channel_id` `shop_type_id` `sales_mode` `area_code` `salesman_line_user_id` `contact_name` `phone` `email` `tax_id` `tax_branch_code` `tax_type` `address` `subdistrict_id` `district_id` `province_id` `postcode` `lat` `lng` `ship_to_address` `payment_type` `payment_terms_days` `credit_limit` `status` `is_active` `inactive_at` `note` `attributes` `external_code` `external_system` `last_sale_at` `created_at` `created_by` `updated_at` `updated_by` |
| `discount_rules` | 19 | ✓ | `record_id` `name` `scope` `product_group_id` `product_id` `trigger_group_ids` `trigger_product_ids` `customer_group_id` `min_qty` `min_amount` `type` `value` `free_product_id` `free_qty` `priority` `stackable` `date_start` `date_end` `is_active` |
| `distribution_channels` | 4 | ✓ | `record_id` `name` `description` `is_active` |
| `districts` | 4 |  | `id` `name` `name_en` `province_id` |
| `free_goods_items` | 12 | ✓ | `record_id` `set_id` `tier_group` `trigger_product_ids` `trigger_group_ids` `min_qty` `min_unit_code` `free_product_id` `free_qty` `free_unit_code` `note` `is_active` |
| `free_goods_sets` | 9 | ✓ | `record_id` `name` `status` `valid_from` `valid_to` `customer_group_id` `note` `created_at` `created_by` |
| `gl_accounts` | 6 | ✓ | `code` `name` `acct_type` `parent_code` `is_active` `note` |
| `gl_journal_lines` | 9 |  | `record_id` `journal_id` `line_no` `account_code` `description` `debit` `credit` `party_type` `party_id` |
| `gl_journals` | 14 |  | `record_id` `tenant_id` `journal_no` `journal_date` `source` `ref_type` `ref_id` `memo` `status` `total_debit` `total_credit` `created_by` `created_at` `voided_at` |
| `goods_receipts` | 13 |  | `record_id` `tenant_id` `gr_no` `po_id` `vendor_id` `warehouse_id` `receive_date` `note` `status` `journal_id` `created_by` `created_at` `source_ref` |
| `goods_return_items` | 13 |  | `record_id` `return_id` `order_item_id` `product_id` `unit_code` `unit_factor` `qty` `base_qty` `condition` `restock` `unit_price` `amount` `tax_status` |
| `goods_returns` | 18 |  | `record_id` `tenant_id` `return_no` `sales_order_id` `order_code` `customer_id` `return_date` `reason_code` `reason` `item_count` `amount` `restock_qty` `scrap_qty` `credit_note_id` `status` `note` `received_by` `created_at` |
| `gr_items` | 10 |  | `record_id` `gr_id` `po_item_id` `product_id` `qty` `unit_code` `unit_factor` `base_qty` `unit_cost` `amount` |
| `help_articles` | 10 | ✓ | `record_id` `code` `category` `title` `summary` `body` `sort_order` `is_active` `updated_at` `updated_by` |
| `liff_users` | 6 |  | `line_user_id` `display_name` `role` `tenant_id` `status` `last_login` |
| `package_tenants` | 6 | ✓ | `record_id` `package_type` `package_id` `tenant_id` `assigned_at` `assigned_by` |
| `payment_types` | 4 | ✓ | `record_id` `code` `name` `is_active` |
| `po_items` | 12 |  | `record_id` `po_id` `line_no` `pr_item_id` `product_id` `description` `qty` `unit_code` `unit_factor` `unit_price` `amount` `received_qty` |
| `pr_approvals` | 7 |  | `record_id` `pr_id` `step_no` `approver_user_id` `decision` `comment` `decided_at` |
| `pr_items` | 11 |  | `record_id` `pr_id` `line_no` `product_id` `description` `qty` `unit_code` `unit_price` `amount` `po_qty` `note` |
| `price_list_bill_promos` | 4 | ✓ | `record_id` `price_list_id` `min_amount_ex_vat` `percent` |
| `price_list_change_log` | 6 |  | `record_id` `price_list_id` `action` `detail` `changed_by` `changed_at` |
| `price_list_items` | 15 | ✓ | `record_id` `price_list_id` `line_id` `product_id` `unit_code` `unit_factor` `min_qty` `max_qty` `list_price_ex_vat` `cash_price_incl_vat` `credit_price_incl_vat` `van_only` `suggested_price` `retail_price` `tier_label` |
| `price_list_rule_conditions` | 5 | ✓ | `record_id` `rule_id` `field` `op` `value` |
| `price_list_rules` | 10 | ✓ | `record_id` `target_type` `price_list_id` `name` `match_type` `priority` `is_active` `note` `created_at` `created_by` |
| `price_lists` | 10 | ✓ | `record_id` `name` `customer_group_id` `valid_from` `valid_to` `status` `source_file` `note` `created_at` `activated_at` |
| `product_groups` | 3 | ✓ | `record_id` `name` `description` |
| `product_units` | 8 | ✓ | `record_id` `product_id` `unit_code` `unit_label` `unit_factor` `price` `is_active` `barcode` |
| `products` | 40 | ✓ | `record_id` `product_code` `name` `base_price` `unit` `unit_code` `group_id` `category` `sub_category` `is_active` `external_code` `barcode` `group_barcode` `cost_price` `vat_type` `image_url` `has_transactions` `alias_codes` `tax_status` `name_en` `sales_unit_code` `sales_unit_factor` `purchase_unit_code` `purchase_unit_factor` `carton_barcode` `packing_text` `weight_kg` `is_stock` `is_sellable` `is_purchasable` `no_discount` `reorder_point` `last_purchase_price` `last_purchase_date` `note` `external_system` `created_at` `created_by` `updated_at` `updated_by` |
| `provinces` | 4 |  | `id` `name` `name_en` `region` |
| `purchase_orders` | 19 |  | `record_id` `tenant_id` `po_no` `vendor_id` `pr_id` `warehouse_id` `status` `order_date` `expected_date` `vat_type` `subtotal_ex_vat` `discount_ex_vat` `vat_amount` `total` `note` `created_by` `created_at` `closed_at` `source_ref` |
| `purchase_requisitions` | 15 |  | `record_id` `tenant_id` `pr_no` `requester_user_id` `department` `need_by_date` `note` `status` `flow_id` `current_step` `total_ex_vat` `created_at` `submitted_at` `decided_at` `closed_at` |
| `role_permissions` | 4 | ✓ | `role_code` `module_code` `can_view` `can_edit` |
| `roles` | 5 | ✓ | `role_code` `role_label` `is_system` `tenant_id` `description` |
| `sales_daily` | 6 |  | `record_id` `tenant_id` `sale_date` `bills` `revenue` `updated_at` |
| `shop_types` | 5 |  | `record_id` `code` `name` `description` `is_active` |
| `stock_ledger` | 13 |  | `record_id` `tenant_id` `warehouse_id` `product_id` `change_qty` `balance_after` `unit_cost` `move_type` `ref_type` `ref_id` `note` `created_by` `created_at` |
| `stock_reservations` | 9 |  | `record_id` `tenant_id` `warehouse_id` `product_id` `qty` `order_id` `status` `created_at` `released_at` |
| `subdistricts` | 5 |  | `id` `name` `name_en` `district_id` `zipcode` |
| `tenants` | 17 | ✓ | `tenant_id` `name` `sheet_file_id` `region` `is_active` `created_at` `address` `tax_id` `branch_code` `phone` `email` `logo_url` `bank_name` `bank_account_no` `bank_account_name` `is_house` `customer_account` |
| `vendors` | 17 | ✓ | `record_id` `tenant_id` `vendor_code` `name` `tax_id` `branch_code` `contact_name` `phone` `email` `address` `payment_terms_days` `credit_limit` `bank_name` `bank_account_no` `is_active` `note` `created_at` |
| `warehouse_stock` | 7 |  | `record_id` `tenant_id` `warehouse_id` `product_id` `qty` `avg_cost` `updated_at` |
| `warehouses` | 8 | ✓ | `record_id` `tenant_id` `code` `name` `address` `is_active` `is_default` `created_at` |

### D.2 ชีตในไฟล์ของตัวแทน (`TENANT_SHEET_TABS` — `13_tenants.gs`)

**เพิ่มคอลัมน์ที่นี่ต้องเรียก `ensureTenantSheetsCurrent(tenantId)` ก่อนเขียนเสมอ** ไม่งั้นค่าถูกทิ้งเงียบๆ เพราะเขียนลงชีตด้วยชื่อหัวคอลัมน์

| ชีต | คอลัมน์ | รายชื่อคอลัมน์ |
|---|---|---|
| `competitor_logs` | 7 | `record_id` `visit_id` `customer_id` `brand` `product` `price` `created_at` |
| `delivery_round_items` | 9 | `record_id` `round_id` `order_id` `item_id` `product_id` `unit_code` `unit_factor` `qty` `base_qty` |
| `delivery_rounds` | 25 | `record_id` `order_id` `round_no` `status` `picking_no` `picking_at` `delivery_order_no` `delivery_order_at` `shipped_at` `note` `created_at` `created_by` `updated_at` `updated_by` `tax_invoice_no` `tax_invoice_at` `ar_invoice_id` `ar_invoice_no` `invoiced_at` `subtotal` `discount` `total` `subtotal_ex_vat` `vat_amount` `exempt_amount` |
| `doc_number_counters` | 3 | `doc_type` `period_key` `last_number` |
| `doc_number_series` | 8 | `record_id` `doc_type` `prefix` `date_format` `running_digits` `reset_cycle` `separator` `is_active` |
| `order_discounts` | 8 | `record_id` `order_id` `rule_id` `rule_name` `type` `value` `free_product_id` `free_qty` |
| `order_items` | 14 | `record_id` `order_id` `product_id` `unit_code` `unit_factor` `qty` `base_qty` `price` `line_total` `unit_discount` `line_discount` `list_price_ex_vat` `is_free` `tax_status` |
| `order_status_log` | 10 | `record_id` `order_id` `from_status` `to_status` `from_payment` `to_payment` `note` `changed_by` `changed_by_role` `changed_at` |
| `sales_orders` | 40 | `record_id` `order_code` `customer_id` `subtotal` `discount` `total` `payment_method` `fulfillment_type` `status` `sale_by` `lat` `lng` `map` `note` `created_at` `payment_status` `paid_amount` `delivered_at` `paid_at` `updated_at` `updated_by` `requested_delivery_date` `delivery_order_no` `delivery_order_at` `picking_no` `picking_at` `receipt_no` `receipt_at` `tax_invoice_no` `tax_invoice_at` `center_edited_at` `center_edited_by` `ship_round_no` `backorder_lines` `apply_vat` `vat_type` `vat_rate` `subtotal_ex_vat` `vat_amount` `exempt_amount` |
| `stock_counts` | 7 | `record_id` `line_user_id` `product_id` `system_qty` `counted_qty` `diff_qty` `created_at` |
| `stock_movements` | 7 | `record_id` `line_user_id` `product_id` `change_qty` `type` `ref_id` `created_at` |
| `van_stock` | 4 | `line_user_id` `product_id` `qty` `avg_cost` |
| `visit_notes` | 4 | `record_id` `visit_id` `note` `created_at` |
| `visits` | 7 | `record_id` `customer_id` `line_user_id` `check_in_at` `lat` `lng` `has_order` |

## E. โมดูลสิทธิ์

สิทธิ์เป็น **ดู / แก้ รายโมดูล** ผูกกับบทบาท (`roles` + `role_permissions`) ไม่ได้ผูกกับคนโดยตรง · โมดูลที่ไม่อยู่ในลิสต์ของฝั่งไหน **ฝั่งนั้นกดไม่ได้เลย** แม้เมนูจะตั้ง `scope` ให้เห็น

| โมดูล | บริษัทเจ้าของสินค้า | ตัวแทน |
|---|---|---|
| `accounting` | ดู + แก้ | ดู + แก้ |
| `customers` | ดู + แก้ | ดู + แก้ |
| `docnum` | ดู + แก้ | ดู + แก้ |
| `inventory` | ดู + แก้ | ดู + แก้ |
| `pricing` | ดู + แก้ | ดูอย่างเดียว |
| `products` | ดู + แก้ | ดูอย่างเดียว |
| `promotions` | ดู + แก้ | ดูอย่างเดียว |
| `purchasing` | ดู + แก้ | ดู + แก้ |
| `sales` | ดู + แก้ | ดู + แก้ |
| `sales_report` | ดู + แก้ | ดู + แก้ |
| `settings` | ดู + แก้ | ดูอย่างเดียว |
| `shipping` | — | ดู + แก้ |
| `staff` | ดู + แก้ | ดู + แก้ |
| `stock_receive` | — | ดู + แก้ |
| `stock_transfer` | — | ดู + แก้ |
| `tenants` | ดู + แก้ | — |
| `users_roles` | ดู + แก้ | ดู + แก้ |
| `van_issue` | — | ดู + แก้ |
| `vendors` | ดู + แก้ | ดู + แก้ |
| `zones` | — | ดู + แก้ |

## F. เอกสารที่มีเลขกำกับ (`DOC_SERIES_TYPES` — `12_docnum.gs`)

`ที่เก็บตัวนับ = กลาง` หมายถึงแถวตัวนับอยู่ในชีตกลาง **ไม่ได้แปลว่าเลขเดินร่วมกันระหว่างบริษัท** — ทุกสมุดมีเล่มของตัวเอง (คีย์ `PO@BDC` แยกจาก `PO`)

| รหัส | เอกสาร | ที่เก็บตัวนับ | รูปแบบตั้งต้น | หมายเหตุ |
|---|---|---|---|---|
| `SO` | ใบขาย / ใบสั่งขาย | ไฟล์ตัวแทน | SO-yyyyMMdd-xxxx · รีเซ็ตรายวัน | ใช้กับบิลขายทั้งจากแอปมือถือและแอดมิน |
| `DO` | ใบส่งสินค้า | ไฟล์ตัวแทน | DO-yyyyMMdd-xxxx · รีเซ็ตรายวัน | ออกเลขอัตโนมัติเมื่อบิลขายเข้าสถานะ "อนุมัติ/เตรียมจัดส่ง" |
| `PICK` | ใบจัดของ | ไฟล์ตัวแทน | PICK-yyyyMMdd-xxxx · รีเซ็ตรายวัน | ออกเลขอัตโนมัติพร้อมใบส่งสินค้า เมื่อบิลเข้าสถานะ "อนุมัติ/เตรียมจัดส่ง" |
| `RC` | ใบเสร็จรับเงิน | ไฟล์ตัวแทน | RC-yyyyMMdd-xxxx · รีเซ็ตรายวัน | ออกเลขอัตโนมัติเมื่อรับชำระครั้งแรก (ขายสดจากรถออกตั้งแต่เปิดบิล) |
| `TAX-IV` | ใบกำกับภาษี | ไฟล์ตัวแทน | TAX-IV-yyyyMMdd-xxxx · รีเซ็ตรายวัน | ออกเลขอัตโนมัติตอนส่งมอบสินค้า ("พร้อมจัดส่ง" · ขายสดจากรถออกตั้งแต่เปิดบิล) |
| `PR` | ใบขอซื้อ | กลาง |  |  |
| `PO` | ใบสั่งซื้อ | กลาง |  |  |
| `GR` | ใบรับของ | กลาง |  |  |
| `AP` | ตั้งหนี้เจ้าหนี้ | กลาง |  |  |
| `PV` | ใบสำคัญจ่าย | กลาง |  |  |
| `INV` | ใบแจ้งหนี้ลูกค้า | กลาง |  |  |
| `RV` | ใบสำคัญรับ | กลาง |  |  |
| `CN` | ใบลดหนี้ | กลาง |  |  |
| `DN` | ใบเพิ่มหนี้ | กลาง |  |  |
| `GRN` | ใบรับคืนสินค้า | กลาง | GRN-yyyyMM-xxxx · รีเซ็ตรายเดือน | ออกตอนรับของคืนจากลูกค้า — เป็นเอกสารตั้งต้นของใบลดหนี้ |
| `BN` | ใบวางบิล | กลาง | BN-yyyyMM-xxxx · รีเซ็ตรายเดือน | รวมใบแจ้งหนี้หลายใบของลูกค้ารายเดียวไปวางบิลครั้งเดียว — ไม่ใช่เอกสารภาษี |
| `JV` | ใบสำคัญทั่วไป | กลาง |  |  |

## G. รหัสบัญชีที่ระบบอ้างอิงเอง (`GL_ACCT` — `23_accounting.gs`)

**เปลี่ยนรหัสในผังบัญชีต้องแก้ `GL_ACCT` ด้วย** ไม่งั้นระบบลงบัญชีไปที่รหัสที่ไม่มีอยู่

| ค่าคงที่ | รหัส | ชื่อบัญชี |
|---|---|---|
| `GL_ACCT.CASH` | 1110 | เงินสดในมือ |
| `GL_ACCT.BANK` | 1120 | เงินฝากธนาคาร |
| `GL_ACCT.AR` | 1200 | ลูกหนี้การค้า |
| `GL_ACCT.INVENTORY` | 1300 | สินค้าคงเหลือ |
| `GL_ACCT.VAT_INPUT` | 1400 | ภาษีซื้อ |
| `GL_ACCT.AP` | 2100 | เจ้าหนี้การค้า |
| `GL_ACCT.GRNI` | 2150 | รับของแล้วยังไม่ได้รับใบแจ้งหนี้ |
| `GL_ACCT.VAT_OUTPUT` | 2200 | ภาษีขาย |
| `GL_ACCT.SALES` | 4100 | รายได้จากการขาย |
| `GL_ACCT.COGS` | 5100 | ต้นทุนขาย |
| `GL_ACCT.OTHER_EXPENSE` | 5900 | ค่าใช้จ่ายอื่น |

## H. เมนูแอดมิน (`NAV_GROUPS` — `frontend-admin/index.html`)

**ชุดเดียวใช้ทั้งสองฝั่ง** เลขเดียวกันทุกคน ต่างกันแค่เห็น/ไม่เห็น และกดได้/กดไม่ได้ (`navState()`) · กลุ่ม 6 สำรองไว้ตามที่เจ้าของระบบสั่ง

| เลข | เมนู | view | โมดูล | ฝั่ง | สถานะ |
|---|---|---|---|---|---|
| 1.1.1 | งานขาย › เอกสารการขาย › ใบสั่งขาย | `salesorders` | `sales` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.1.2 | งานขาย › เอกสารการขาย › ใบลดหนี้ / เพิ่มหนี้ | `adjnotes` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.1.3 | งานขาย › เอกสารการขาย › ใบรับคืนสินค้า | `goodsreturns` | `sales` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.2.1 | งานขาย › ราคาขาย / ส่วนลด › กำหนดชุดตารางราคาขาย | `pricelists` | `pricing` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.2.2 | งานขาย › ราคาขาย / ส่วนลด › กำหนดชุดส่วนลดการขาย | `promotions` | `promotions` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.3.1 | งานขาย › ส่งเสริมการขาย › ชุดแถม (ของแถม) | `freegoods` | `promotions` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.1 | งานขาย › ข้อมูลลูกค้า › ทะเบียนรายชื่อลูกค้า | `customers` | `customers` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.2 | งานขาย › ข้อมูลลูกค้า › รายชื่อร้านค้า (สำหรับกฎ/โปร) | `custlists` | `customers` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.3 | งานขาย › ข้อมูลลูกค้า › กลุ่มลูกค้า | `custgroups` | `settings` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.4 | งานขาย › ข้อมูลลูกค้า › ช่องทางการจัดจำหน่าย | `distchannels` | `settings` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.5 | งานขาย › ข้อมูลลูกค้า › ประเภทการชำระเงิน | `paytypes` | `settings` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.6 | งานขาย › ข้อมูลลูกค้า › คำขอเปิดร้านใหม่ | `custrequests` | `customers` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.4.7 | งานขาย › ข้อมูลลูกค้า › วงเงินเครดิตและหนี้ค้าง | `creditcontrol` | `customers` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.5.1 | งานขาย › พนักงานและเขตขาย › เขตการขายของพนักงาน | `v-zone` | `zones` | ทั้งสองฝั่ง | **ยังไม่ได้ทำ** |
| 1.6.1 | งานขาย › การจัดส่ง › สถานะการจัดส่ง | `v-ship` | `shipping` | ตัวแทน | **ยังไม่ได้ทำ** |
| 1.8.1 | งานขาย › รายงานขาย › รายงานการขายแยกพนักงาน | `v-rep-staff` | `sales_report` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.8.2 | งานขาย › รายงานขาย › รายงานการขายแยกลูกค้า | `v-rep-cust` | `sales_report` | ทั้งสองฝั่ง | ใช้งานได้ |
| 1.8.3 | งานขาย › รายงานขาย › รายงานการขายแยกสินค้า | `v-rep-prod` | `sales_report` | ทั้งสองฝั่ง | ใช้งานได้ |
| 2.1.1 | งานซื้อ › ใบขอซื้อ › รายการใบขอซื้อ (PR) | `purchasereqs` | `purchasing` | ทั้งสองฝั่ง | ใช้งานได้ |
| 2.2.1 | งานซื้อ › ใบสั่งซื้อ › รายการใบสั่งซื้อ (PO) | `purchaseorders` | `purchasing` | ทั้งสองฝั่ง | ใช้งานได้ |
| 2.3.1 | งานซื้อ › ข้อมูลผู้ขาย › ผู้ขาย | `vendors` | `vendors` | ทั้งสองฝั่ง | ใช้งานได้ |
| 2.3.2 | งานซื้อ › ข้อมูลผู้ขาย › สายอนุมัติใบขอซื้อ | `approvalflows` | `purchasing` | ทั้งสองฝั่ง | ใช้งานได้ |
| 3.1.1 | ข้อมูลสินค้า › สินค้า › รายการสินค้า | `products` | `products` | ทั้งสองฝั่ง | ใช้งานได้ |
| 3.1.2 | ข้อมูลสินค้า › สินค้า › กำหนดกลุ่มสินค้า | `productgroups` | `products` | ทั้งสองฝั่ง | ใช้งานได้ |
| 3.1.3 | ข้อมูลสินค้า › สินค้า › หน่วยขายเพิ่มเติม | `productunits` | `products` | ทั้งสองฝั่ง | ใช้งานได้ |
| 4.1.1 | คลังสินค้า › สินค้าคงเหลือ › ยอดสินค้าคงเหลือ | `warehousestock` | `inventory` | ทั้งสองฝั่ง | ใช้งานได้ |
| 4.2.1 | คลังสินค้า › รับ / จ่ายสินค้า › ใบรับของเข้าคลัง | `goodsreceipts` | `inventory` | ทั้งสองฝั่ง | ใช้งานได้ |
| 4.2.2 | คลังสินค้า › รับ / จ่ายสินค้า › ใบเบิกจ่ายสินค้าออก | `v-issue` | `inventory` | ทั้งสองฝั่ง | **ยังไม่ได้ทำ** |
| 4.3.1 | คลังสินค้า › นำเข้าจากรายการขายออกของบริษัท › ตรวจ/นำเข้ารายการใหม่ | `externalsalesimport` | `purchasing` | บริษัท | ใช้งานได้ |
| 4.3.2 | คลังสินค้า › นำเข้าจากรายการขายออกของบริษัท › ใบรับของรอตรวจรับ | `pendinggoodsreceipts` | `inventory` | ทั้งสองฝั่ง | ใช้งานได้ |
| 4.8.1 | คลังสินค้า › รายงานเคลื่อนไหวสินค้า › รายงานเคลื่อนไหวสินค้า | `v-stockledger` | `inventory` | ทั้งสองฝั่ง | **ยังไม่ได้ทำ** |
| 5.1.1 | งานบัญชีการเงิน › บัญชีทั่วไป › สมุดรายวัน / งบทดลอง | `glbooks` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 5.2.1 | งานบัญชีการเงิน › เจ้าหนี้ › ใบแจ้งหนี้และการจ่าย | `apbills` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 5.3.1 | งานบัญชีการเงิน › ลูกหนี้ › ใบแจ้งหนี้และการรับชำระ | `arinvoices` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 5.3.2 | งานบัญชีการเงิน › ลูกหนี้ › ใบวางบิล | `billingnotes` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 5.8.1 | งานบัญชีการเงิน › รายงานภาษี › รายงานภาษีขาย / ภาษีซื้อ (ภ.พ.30) | `vatreport` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 5.9.1 | งานบัญชีการเงิน › ตั้งค่าทางบัญชี › วิธีตัดต้นทุนขาย | `acctsettings` | `accounting` | ทั้งสองฝั่ง | ใช้งานได้ |
| 8.1.1 | คู่มือใช้งานระบบ › คู่มือใช้งานระบบ › คู่มือใช้งานระบบ | `helpcenter` | `` | ทั้งสองฝั่ง | ใช้งานได้ |
| 9.1.1 | ตั้งค่าระบบ › ข้อมูลบริษัท › ข้อมูลบริษัท | `companyinfo` | `settings` | ทั้งสองฝั่ง | ใช้งานได้ |
| 9.2.1 | ตั้งค่าระบบ › เลขที่เอกสาร › ตั้งค่ารูปแบบเลขที่เอกสาร | `docnum` | `docnum` | ทั้งสองฝั่ง | ใช้งานได้ |
| 9.3.1 | ตั้งค่าระบบ › ตัวแทนจำหน่าย › รายชื่อตัวแทน | `tenants` | `tenants` | บริษัท | ใช้งานได้ |
| 9.4.1 | ตั้งค่าระบบ › สิทธิ์การใช้งาน › ผู้ใช้งานและอนุมัติ | `adminusers` | `users_roles` | ทั้งสองฝั่ง | ใช้งานได้ |
| 9.4.2 | ตั้งค่าระบบ › สิทธิ์การใช้งาน › บทบาทและสิทธิ์ | `roles` | `users_roles` | ทั้งสองฝั่ง | ใช้งานได้ |

**ยังไม่ได้ทำ 4 เมนู**: 1.5.1 เขตการขายของพนักงาน · 1.6.1 สถานะการจัดส่ง · 4.2.2 ใบเบิกจ่ายสินค้าออก · 4.8.1 รายงานเคลื่อนไหวสินค้า

## I. เทสต์ที่คุมแบบนี้อยู่

| สคริปต์ | ชนิด | บรรทัด |
|---|---|---|
| `.dev/test-address-refs.js` | หน่วย (ไม่ยิงเน็ต) | 116 |
| `.dev/test-barcode.js` | หน่วย (ไม่ยิงเน็ต) | 111 |
| `.dev/test-customer-bulk.js` | หน่วย (ไม่ยิงเน็ต) | 191 |
| `.dev/test-customer-credit.js` | หน่วย (ไม่ยิงเน็ต) | 224 |
| `.dev/test-customer-lists.js` | หน่วย (ไม่ยิงเน็ต) | 137 |
| `.dev/test-customer-requests.js` | หน่วย (ไม่ยิงเน็ต) | 263 |
| `.dev/test-customers.js` | หน่วย (ไม่ยิงเน็ต) | 195 |
| `.dev/test-docnum.js` | หน่วย (ไม่ยิงเน็ต) | 299 |
| `.dev/test-drive-layout.js` | หน่วย (ไม่ยิงเน็ต) | 126 |
| `.dev/test-external-sales-import.js` | หน่วย (ไม่ยิงเน็ต) | 321 |
| `.dev/test-flags.js` | หน่วย (ไม่ยิงเน็ต) | 89 |
| `.dev/test-free-goods.js` | หน่วย (ไม่ยิงเน็ต) | 187 |
| `.dev/test-help-center.js` | หน่วย (ไม่ยิงเน็ต) | 79 |
| `.dev/test-idempotency.js` | หน่วย (ไม่ยิงเน็ต) | 98 |
| `.dev/test-line-auth.js` | หน่วย (ไม่ยิงเน็ต) | 129 |
| `.dev/test-mobile-sale-detail.js` | หน่วย (ไม่ยิงเน็ต) | 94 |
| `.dev/test-owner-tenant.js` | หน่วย (ไม่ยิงเน็ต) | 156 |
| `.dev/test-package-distribution.js` | หน่วย (ไม่ยิงเน็ต) | 210 |
| `.dev/test-price-rules.js` | หน่วย (ไม่ยิงเน็ต) | 221 |
| `.dev/test-pricelist-edit.js` | หน่วย (ไม่ยิงเน็ต) | 206 |
| `.dev/test-pricelist-parser.js` | หน่วย (ไม่ยิงเน็ต) | 16 |
| `.dev/test-pricing-engine.js` | หน่วย (ไม่ยิงเน็ต) | 343 |
| `.dev/test-product-categories.js` | หน่วย (ไม่ยิงเน็ต) | 77 |
| `.dev/test-purchasing-accounting.js` | หน่วย (ไม่ยิงเน็ต) | 1,466 |
| `.dev/test-record-sale.js` | หน่วย (ไม่ยิงเน็ต) | 218 |
| `.dev/test-roles.js` | หน่วย (ไม่ยิงเน็ต) | 239 |
| `.dev/test-sale-by-label.js` | หน่วย (ไม่ยิงเน็ต) | 76 |
| `.dev/test-sales-status.js` | หน่วย (ไม่ยิงเน็ต) | 838 |
| `.dev/test-sales.js` | หน่วย (ไม่ยิงเน็ต) | 197 |
| `.dev/test-sheet-cache.js` | หน่วย (ไม่ยิงเน็ต) | 114 |
| `.dev/test-unit-rescale.js` | หน่วย (ไม่ยิงเน็ต) | 56 |
| `.dev/test-user-promotion.js` | หน่วย (ไม่ยิงเน็ต) | 136 |
| `.dev/uat-ar-adjust-notes-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 165 |
| `.dev/uat-cash-and-billing-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 159 |
| `.dev/uat-cogs-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 161 |
| `.dev/uat-delivery-rounds-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 144 |
| `.dev/uat-draft-code-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 121 |
| `.dev/uat-draft-code-real-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 68 |
| `.dev/uat-goods-returns-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 125 |
| `.dev/uat-pricelist-edit-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 85 |
| `.dev/uat-purchasing-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 121 |
| `.dev/uat-sale-docs-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 130 |
| `.dev/uat-sale-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 122 |
| `.dev/uat-van-cogs-e2e.js` | ยิง UAT จริง (เขียนข้อมูล) | 156 |

