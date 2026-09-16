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

// ── Admin App (hosted แยกบน Vercel — username/password + token ผ่าน doPost) ──
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

  listPromotions:         listPromotions,
  addPromotion:           addPromotion,
  updatePromotion:        updatePromotion,
  deactivatePromotion:    deactivatePromotion,

  listDocSeries:          listDocSeries,
  addDocSeries:           addDocSeries,
  updateDocSeries:        updateDocSeries,
  previewDocNumber:       previewDocNumberAdmin,

  createTenant:           createTenant,
  listTenants:            listTenants,
  updateTenantStatus:     updateTenantStatus,

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
