/**
 * ===================== เปิดแอปแอดมินด้วยคำขอเดียว =====================
 * วัดจริง 2026-09-24: ค่าคงที่ของ Apps Script Web App ≈ 1.6 วินาที **ต่อคำขอ** (ยังไม่แตะชีตเลย)
 * เปิดแอปเดิมยิง 4 คำขอเป็นทอดๆ (ล็อกอิน → รายชื่อตัวแทน → สิทธิ์+ข้อมูลบริษัท → แดชบอร์ด) ≈ 32 วินาที
 * ไฟล์นี้รวมทุกอย่างที่หน้าแรกต้องใช้ไว้ในคำขอเดียว — ค่าคงที่จ่ายครั้งเดียว และอ่านชีตซ้ำไม่เสียเวลา
 * เพราะชั้นอ่านข้อมูลมี memo ต่อคำขอ + แคชข้ามคำขอแล้ว (ดู 02_helpers.gs)
 *
 * ฝั่งหน้าเว็บจะเก็บผลลัพธ์นี้ไว้ใน localStorage แล้ววาดหน้าจอทันทีที่เปิดแอป (stale-while-revalidate)
 * ผู้ใช้จึงเห็นเมนู/ชื่อบริษัท/ตัวเลขของเมื่อครู่ทันที แล้วค่อยอัปเดตเมื่อข้อมูลสดมาถึง
 */
function getAdminBootstrap(session, payload) {
  if (!session) return { success: false, message: 'ไม่ได้เข้าสู่ระบบ' };
  payload = payload || {};
  var out = { success: true, serverTime: nowStr() };

  var perms = getMyPermissions(session);
  if (perms && perms.success) {
    out.roleCode = perms.roleCode; out.roleLabel = perms.roleLabel;
    out.isSuperAdmin = perms.isSuperAdmin; out.permissions = perms.permissions; out.modules = perms.modules;
  }

  var co = getCompanyProfile(session);
  if (co && co.success) { out.company = co.company; out.companyCanEdit = co.canEdit; }

  // รายชื่อตัวแทนใช้กับหน้าเลือกบริษัทของ Ultra Admin และป้ายชื่อบนแถบบน
  if (session.role_code === 'super_admin' || session.role_code === 'owner_admin') {
    var tn = listTenants(session, {});
    if (tn && tn.success) out.tenants = tn.data;
  }

  // แดชบอร์ดของ scope ที่กำลังเปิดอยู่ (ฝั่งบริษัทอ่านยอดสรุปรายวัน ไม่เปิดไฟล์ตัวแทนแล้ว — ดู 31_sales_rollup.gs)
  var dash = getAdminDashboard(session, payload);
  if (dash && dash.success) out.dashboard = dash;

  return out;
}
