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
  recordSale:     recordSale,
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

  listProductsAdmin:      listProductsAdmin,
  addProduct:             addProduct,
  updateProduct:          updateProduct,
  uploadProductImage:     uploadProductImage,
  listProductUnits:       listProductUnits,
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
  addDocSeries:           addDocSeries,
  updateDocSeries:        updateDocSeries,
  previewDocNumber:       previewDocNumberAdmin,

  getCompanyProfile:      getCompanyProfile,
  saveCompanyProfile:     saveCompanyProfile,
  getMyPermissions:       getMyPermissions,
  listRolesWithPermissions: listRolesWithPermissions,
  saveRole:               saveRole,
  deleteRole:             deleteRole,

  createTenant:           createTenant,
  migrateUnitCodes:       migrateUnitCodes,
  getDatabaseLayout:      getDatabaseLayout,
  organizeDatabaseFiles:  organizeDatabaseFiles,
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
  listWarehouseStock:     listWarehouseStock,
  listStockLedger:        listStockLedger,

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
  exportExpressSales:     exportExpressSales
};

// เรียกจาก doPost() (04_auth.gs) หลัง resolve session แล้วเท่านั้น
function _handleAdminActionCore(session, action, payload) {
  try {
    var fn = ADMIN_ACTION_MAP[action];
    if (!fn) return { success: false, message: 'ไม่พบ action: ' + action };
    return fn(session, payload || {});
  } catch (e) {
    Logger.log('ADMIN ERROR [' + action + ']: ' + (e.stack || e.message));
    return { success: false, message: 'ระบบผิดพลาด: ' + e.message };
  }
}
