/**
 * ===================== ROUTER =====================
 * doPost() (04_auth.gs) เป็นทางเข้าเดียวของทุก action แยก ACTION_MAP กันชัดเจนเพราะรูปแบบ
 * การยืนยันตัวตนต่างกัน (Mobile = lineUserId, Admin = token)
 */

// ── Mobile App (LIFF, hosted แยกบน Vercel — เรียกผ่าน doPost) ──
var ACTION_MAP = {
  getBootstrap:   getBootstrap,
  getDashboard:   getDashboard,
  getRecentSales: getRecentSales,
  getSaleDetail:  getSaleDetail,
  recordSale:     recordSale,
  // ยืนยัน/ยกเลิกใบสั่งขายของตัวเองจากแอปมือถือ (34_sales_status.gs)
  confirmSalesOrder:  confirmSalesOrder,
  cancelMySalesOrder: cancelMySalesOrder,
  quoteSale:      quoteSale,
  restockVan:     restockVan,
  submitCount:    submitCount,
  checkInVisit:   checkInVisit,
  addVisitNote:   addVisitNote,
  addCompetitor:  addCompetitor,
  addCustomer:    addCustomer
};

// เรียกจาก doPost() หลังตรวจแล้วว่า action อยู่ใน ACTION_MAP
function _handleMobileActionCore(lineUserId, action, payload) {
  try {
    if (!lineUserId) return { success: false, message: 'ไม่พบตัวตนผู้ใช้ (lineUserId)' };

    var userStatus = checkUser(lineUserId);
    if (!userStatus.exists || userStatus.status !== 'Yes') {
      return { success: false, message: 'บัญชียังไม่ได้รับอนุมัติให้ใช้งาน' };
    }

    var user = { lineUserId: lineUserId, tenantId: userStatus.tenantId, role: userStatus.role, name: userStatus.name };
    // กันบันทึกซ้ำที่จุดเดียว: action ที่สร้างของใหม่ + หน้าเว็บแนบ requestId มา = ทำงานครั้งเดียวต่อ id (35_idempotency.gs)
    if (IDEMPOTENT_ACTIONS[action]) {
      return withIdempotency(_idemKey(lineUserId, action, payload), function() { return ACTION_MAP[action](user, payload || {}); });
    }
    return ACTION_MAP[action](user, payload || {});
  } catch (e) {
    Logger.log('ERROR [' + action + ']: ' + (e.stack || e.message));
    return { success: false, message: 'ระบบผิดพลาด: ' + e.message };
  }
}

// ── Admin App (hosted แยกบน GitHub Pages — username/password + token ผ่าน doPost) ──
var ADMIN_ACTION_MAP = {
  getAdminDashboard:      getAdminDashboard,
  listAdminUsers:        listAdminUsers,
  listRoles:              listRoles,
  createAdminUser:        createAdminUser,
  updateAdminUser:        updateAdminUser,
  resetAdminUserPasswordByAdmin: resetAdminUserPasswordByAdmin,
  changeMyPassword:       changeMyPassword,

  getTenantProfile:       getTenantProfile,
  updateTenantProfile:    updateTenantProfile,
  uploadTenantLogo:       uploadTenantLogo,

  listStaffAdmin:         listStaffAdmin,
  updateStaffAdmin:       updateStaffAdmin,

  listCustomersAdmin:     listCustomersAdmin,
  addCustomerAdmin:       addCustomerAdmin,
  updateCustomerAdmin:    updateCustomerAdmin,

  listSalesOrdersAdmin:   listSalesOrdersAdmin,
  getSalesOrderAdmin:     getSalesOrderAdmin,
  previewSaleAdmin:       previewSaleAdmin,
  recordSaleAdmin:        recordSaleAdmin,
  cancelSalesOrderAdmin:  cancelSalesOrderAdmin,
  updateSalesOrderStatus: updateSalesOrderStatus,   // เปลี่ยนสถานะส่งของ/การเงิน (34_sales_status.gs)

  listProductsAdmin:      listProductsAdmin,
  addProduct:             addProduct,
  updateProduct:          updateProduct,
  uploadProductImage:     uploadProductImage,
  listProductUnits:       listProductUnits,
  ensureDefaultSalesUnit: ensureDefaultSalesUnit,   // ตั้งหน่วย "ลัง" ให้สินค้าที่ยังไม่มีหน่วยขาย (10_master_data.gs)
  listUnconfirmedUnits:   listUnconfirmedUnits,
  addProductUnit:         addProductUnit,
  updateProductUnit:      updateProductUnit,
  listProductGroups:      listProductGroups,
  addProductGroup:        addProductGroup,
  listCustomerGroups:     listCustomerGroups,
  addCustomerGroup:       addCustomerGroup,
  listDistributionChannels: listDistributionChannels,
  addDistributionChannel:   addDistributionChannel,
  listPaymentTypes:         listPaymentTypes,
  addPaymentType:           addPaymentType,

  listPriceLists:         listPriceLists,
  getPriceList:           getPriceList,
  importPriceList:        importPriceList,
  updatePriceList:        updatePriceList,
  setPriceListStatus:     setPriceListStatus,
  listPriceListChanges:   listPriceListChanges,      // ประวัติการแก้ราคาของชุดที่ใช้งานอยู่ (17_pricing.gs)
  listPriceListRules:     listPriceListRules,        // สิทธิ์เข้าถึงชุดราคา (36_price_rules.gs)
  savePriceListRule:      savePriceListRule,
  deletePriceListRule:    deletePriceListRule,
  previewPriceListAudience: previewPriceListAudience,
  explainCustomerPricing: explainCustomerPricing,
  listCustomerLists:      listCustomerLists,         // รายชื่อร้านค้า (40_customer_lists.gs)
  saveCustomerList:       saveCustomerList,
  deleteCustomerList:     deleteCustomerList,
  listCustomerListMembers: listCustomerListMembers,
  addCustomerListMembers: addCustomerListMembers,
  removeCustomerListMember: removeCustomerListMember,
  listFreeGoodsSets:      listFreeGoodsSets,         // ชุดแถม (39_free_goods.gs)
  getFreeGoodsSet:        getFreeGoodsSet,
  saveFreeGoodsSet:       saveFreeGoodsSet,
  setFreeGoodsSetStatus:  setFreeGoodsSetStatus,
  saveFreeGoodsItem:      saveFreeGoodsItem,
  deleteFreeGoodsItem:    deleteFreeGoodsItem,
  previewFreeGoods:       previewFreeGoods,
  listPackageTenants:     listPackageTenants,        // จ่ายชุดราคา/โปรโมชั่นให้ตัวแทน (38_package_distribution.gs)
  savePackageTenants:     savePackageTenants,
  listMyPackages:         listMyPackages,
  migratePackageAssignments: migratePackageAssignments,
  previewCustomerBulkAssign: previewCustomerBulkAssign,  // จัดกลุ่มลูกค้าเป็นชุด (37_customer_bulk.gs)
  applyCustomerBulkAssign:   applyCustomerBulkAssign,
  deletePriceList:        deletePriceList,
  createPriceList:        createPriceList,
  clonePriceList:         clonePriceList,
  savePriceListLine:      savePriceListLine,
  deletePriceListLine:    deletePriceListLine,
  savePriceListBillPromos: savePriceListBillPromos,
  previewPricing:         previewPricing,

  listPromotions:         listPromotions,
  addPromotion:           addPromotion,
  updatePromotion:        updatePromotion,
  deactivatePromotion:    deactivatePromotion,

  listDocSeries:          listDocSeries,
  // saveDocSeries แทน addDocSeries/updateDocSeries เดิม — บันทึก = ออกเวอร์ชันใหม่ ปิดของเดิม (12_docnum.gs)
  saveDocSeries:          saveDocSeries,
  previewDocNumber:       previewDocNumberAdmin,

  getCompanyProfile:      getCompanyProfile,
  saveCompanyProfile:     saveCompanyProfile,
  getMyPermissions:       getMyPermissions,
  listRolesWithPermissions: listRolesWithPermissions,
  listPendingAdminUsers:  listPendingAdminUsers,
  linkAdminLineId:        linkAdminLineId,
  approveAdminUser:       approveAdminUser,
  rejectAdminUser:        rejectAdminUser,
  promoteToAdmin:         promoteToAdmin,
  saveRole:               saveRole,
  deleteRole:             deleteRole,

  createTenant:           createTenant,
  getAdminBootstrap:      getAdminBootstrap,
  rebuildSalesDaily:      function(session) { return session.role_code === 'super_admin' ? rebuildSalesDaily() : { success: false, message: 'เฉพาะ super_admin' }; },
  migrateUnitCodes:       migrateUnitCodes,
  getDatabaseLayout:      getDatabaseLayout,
  organizeDatabaseFiles:  organizeDatabaseFiles,
  syncTenantSheets:       syncTenantSheets,
  migrateOwnerTenantCode: migrateOwnerTenantCode,   // ย้ายรหัสตัวแทนบ้าน HOUSE → TNKI (13_tenants.gs)
  previewTestTenantCleanup: previewTestTenantCleanup,   // ดู/ลบตัวแทนทดสอบที่ e2e ทิ้งไว้ (13_tenants.gs)
  deleteTestTenants:      deleteTestTenants,
  backfillUserAffiliations: backfillUserAffiliations,   // เติมสังกัดให้ครบทุกคน (13_tenants.gs)        // เติม tab/คอลัมน์ที่ขาดให้ไฟล์ตัวแทนทุกราย (13_tenants.gs)
  listTenants:            listTenants,
  updateTenantStatus:     updateTenantStatus,

  // ── งานซื้อ: ข้อมูลตั้งต้น (20) / ใบขอซื้อ (21) / ใบสั่งซื้อ + รับของ (22) ──
  listVendors:            listVendors,
  saveVendor:             saveVendor,
  listWarehouses:         listWarehouses,
  saveWarehouse:          saveWarehouse,
  listApprovalFlows:      listApprovalFlows,
  saveApprovalFlow:       saveApprovalFlow,
  deleteApprovalFlow:     deleteApprovalFlow,

  listPurchaseRequisitions: listPurchaseRequisitions,
  getPurchaseRequisition:   getPurchaseRequisition,
  savePurchaseRequisition:  savePurchaseRequisition,
  submitPurchaseRequisition: submitPurchaseRequisition,
  decidePurchaseRequisition: decidePurchaseRequisition,
  cancelPurchaseRequisition: cancelPurchaseRequisition,
  listApprovedPrLines:      listApprovedPrLines,

  listPurchaseOrders:     listPurchaseOrders,
  getPurchaseOrder:       getPurchaseOrder,
  savePurchaseOrder:      savePurchaseOrder,
  issuePurchaseOrder:     issuePurchaseOrder,
  cancelPurchaseOrder:    cancelPurchaseOrder,
  receiveGoods:           receiveGoods,
  listGoodsReceipts:      listGoodsReceipts,
  getGoodsReceipt:        getGoodsReceipt,
  cancelGoodsReceipt:     cancelGoodsReceipt,
  listWarehouseStock:     listWarehouseStock,
  listStockLedger:        listStockLedger,

  // ── นำเข้ารายการขายออกของบริษัท → PO+GR ของศูนย์ (43) ──
  previewExternalSalesImport:    previewExternalSalesImport,
  importExternalSalesInvoices:   importExternalSalesInvoices,
  listPendingExternalGoodsReceipts: listPendingExternalGoodsReceipts,
  confirmExternalGoodsReceipt:   confirmExternalGoodsReceipt,
  withdrawExternalGoodsReceipt:  withdrawExternalGoodsReceipt,

  // ── รายงานการขาย (41): 1.8.1 แยกพนักงาน / 1.8.2 แยกลูกค้า / 1.8.3 แยกสินค้า ──
  salesReportByStaff:     salesReportByStaff,
  salesReportByCustomer:  salesReportByCustomer,
  salesReportByProduct:   salesReportByProduct,

  // ── บัญชี (23): แยกประเภท / เจ้าหนี้ / ลูกหนี้ ──
  listGlAccounts:         listGlAccounts,
  saveGlAccount:          saveGlAccount,
  postManualJournal:      postManualJournal,
  voidJournal:            voidJournal,
  listJournals:           listJournals,
  getJournal:             getJournal,
  getTrialBalance:        getTrialBalance,
  getIncomeStatement:     getIncomeStatement,
  getBalanceSheet:        getBalanceSheet,
  listApBills:            listApBills,
  createApBillFromGr:     createApBillFromGr,
  createApBillManual:     createApBillManual,
  payApBills:             payApBills,
  getApAging:             getApAging,
  listArInvoices:         listArInvoices,
  createArInvoice:        createArInvoice,
  receiveArPayment:       receiveArPayment,
  getArAging:             getArAging,
  listUninvoicedSalesOrders: listUninvoicedSalesOrders,

  importExpressProducts:  importExpressProducts,
  importExpressCustomers: importExpressCustomers,
  exportExpressSales:     exportExpressSales,

  listHelpArticles:       listHelpArticles,          // คู่มือใช้งานระบบ (42_help_center.gs)
  saveHelpArticle:        saveHelpArticle,
  setHelpArticleActive:   setHelpArticleActive
};

/** คีย์กันซ้ำผูกกับผู้ใช้+action ด้วย เผื่อ requestId ของสองเครื่องบังเอิญชนกัน (และกันคนอื่นยิง id ทับ) */
function _idemKey(who, action, payload) {
  var rid = String((payload && (payload.requestId || payload.clientRequestId)) || '').trim();
  return rid ? (String(who || '') + '|' + action + '|' + rid) : '';
}

// เรียกจาก doPost() (04_auth.gs) หลัง resolve session แล้วเท่านั้น
function _handleAdminActionCore(session, action, payload) {
  try {
    var fn = ADMIN_ACTION_MAP[action];
    if (!fn) return { success: false, message: 'ไม่พบ action: ' + action };
    if (IDEMPOTENT_ACTIONS[action]) {
      return withIdempotency(_idemKey(session.adminUserId, action, payload), function() { return fn(session, payload || {}); });
    }
    return fn(session, payload || {});
  } catch (e) {
    Logger.log('ADMIN ERROR [' + action + ']: ' + (e.stack || e.message));
    return { success: false, message: 'ระบบผิดพลาด: ' + e.message };
  }
}
