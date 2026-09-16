/**
 * ===================== SETUP: CENTRAL SHEET =====================
 * รันครั้งเดียวตอนเริ่มโปรเจกต์: setupCentralSheet()
 * Apps Script Editor → เลือกฟังก์ชัน setupCentralSheet → Run
 * รันซ้ำได้ปลอดภัย (สร้างเฉพาะ tab/คอลัมน์ที่ยังไม่มี ไม่แตะข้อมูลเดิม)
 */
var CENTRAL_SHEETS = {
  liff_users: ['line_user_id','display_name','role','tenant_id','status','last_login'],
  admin_users: ['record_id','username','password_hash','salt','display_name','role_code','tenant_id','status','created_at'],
  tenants: ['tenant_id','name','sheet_file_id','region','is_active','created_at',
    'address','tax_id','branch_code','phone','email','logo_url','bank_name','bank_account_no','bank_account_name'],

  // product_code: รหัสประจำตัวสินค้า (เหมือนเลขบัตรประชาชนของสินค้า) — unique บังคับ, สำคัญอันดับ 1
  //   ผู้ใช้ตั้งเอง/แก้เองได้ ไม่ใช่ FK ไปหาอะไร คนละความหมายกับ external_code (รหัสจากไฟล์นำเข้า Express
  //   ใช้จับคู่ตอน import เท่านั้น อาจไม่ unique เพราะมาจากระบบภายนอก) — แนวคิดจาก item_code ของ Hippo Village
  // has_transactions: 'TRUE' เมื่อสินค้านี้เคยถูกขายจริงอย่างน้อยหนึ่งครั้ง (recordSale ใน 07_sales.gs เป็นคนเซ็ต)
  //   ใช้ล็อกไม่ให้เปลี่ยน product_code อีก กันเอกสาร/รายงานย้อนหลังอ้างรหัสผิดของ — เซ็ตครั้งเดียวไม่มีวันเคลียร์คืน
  // barcode: บาร์โค้ด "ชุด" ของหน่วยฐาน unique เฉพาะสินค้า+หน่วยนี้เท่านั้น
  // group_barcode: บาร์โค้ด "กลุ่ม" ของหน่วยฐาน — ตั้งใจให้ซ้ำกันได้ข้ามหลาย record (สินค้าเดียวกันจริงแต่คนละรหัสสินค้า)
  // vat_type: 'none' | 'included' | 'excluded' (VAT ใช้อัตรา 7% คงที่ตามกฎหมายไทย ไม่ต้องเก็บอัตราแยกรายสินค้า)
  products: ['record_id','product_code','name','base_price','unit','group_id','is_active','external_code',
    'barcode','group_barcode','cost_price','vat_type','image_url','has_transactions'],
  product_groups: ['record_id','name','description'],
  // หน่วยขายเพิ่มเติมของสินค้า นอกเหนือจากหน่วยฐาน (products.unit/base_price)
  // เช่น สินค้าเป็น "ชิ้น" ฐาน แต่ขายเป็น "แพ็ค" (factor 6) หรือ "ลัง" (factor 12) ได้ด้วย คนละราคา
  // อ้างอิงจากไฟล์ export จริงของ SmartVan BackOffice (Export_Express) ที่เก็บ UnitCode+UnitFactor แยกจากกัน
  // barcode: บาร์โค้ด "ชุด" ของหน่วยนี้โดยเฉพาะ unique เฉพาะสินค้า+หน่วยนี้ (หน่วยขายเพิ่มเติมไม่มี group_barcode เพราะ concept กลุ่มอยู่ที่ระดับหน่วยฐานเท่านั้น)
  product_units: ['record_id','product_id','unit_code','unit_label','unit_factor','price','is_active','barcode'],

  customers: ['record_id','name','tenant_id','group_id','phone','tax_id','address','subdistrict_id','district_id','province_id','lat','lng','is_active','created_at','external_code'],
  customer_groups: ['record_id','name','description'],
  // ข้อมูลอ้างอิงกลางเพิ่มเติม จัดการได้เฉพาะโหมด "บริษัทเจ้าของสินค้า" (module 'settings')
  distribution_channels: ['record_id','name','description','is_active'],
  payment_types: ['record_id','code','name','is_active'],

  discount_rules: ['record_id','name','scope','product_group_id','product_id','trigger_group_ids','customer_group_id','min_qty','min_amount','type','value','free_product_id','free_qty','priority','stackable','date_start','date_end','is_active'],

  roles: ['role_code','role_label','is_system'],
  role_permissions: ['role_code','module_code','can_view','can_edit'],

  provinces: ['id','name','name_en','region'],
  districts: ['id','name','name_en','province_id'],
  subdistricts: ['id','name','name_en','district_id','zipcode']
};

function setupCentralSheet() {
  var cfg = getConfig();
  var ss = SpreadsheetApp.openById(cfg.CENTRAL_SHEET_FILEID);
  Logger.log('=== TOPSHOP Central Sheet Setup ===');

  var created = [], existed = [];
  Object.keys(CENTRAL_SHEETS).forEach(function(tabName) {
    var headers = CENTRAL_SHEETS[tabName];
    var sh = ss.getSheetByName(tabName);
    if (!sh) {
      sh = ss.insertSheet(tabName);
      sh.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#1741C6').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.setColumnWidths(1, headers.length, 150);
      created.push(tabName);
    } else {
      _ensureColumns(sh, headers);
      existed.push(tabName);
    }
  });

  _seedProductGroups();
  _seedCustomerGroups();
  _seedDistributionChannels();
  _seedPaymentTypes();
  _seedProvinces();
  _seedRolesAndPermissions();

  SpreadsheetApp.flush();
  Logger.log('Created: ' + created.join(', '));
  Logger.log('Already existed (columns synced): ' + existed.join(', '));
  Logger.log('✅ Central Sheet setup เสร็จแล้ว — ขั้นตอนถัดไป: สร้าง super_admin คนแรกด้วย createFirstSuperAdmin() ใน 99_dev_tools.gs');
}

// เพิ่มคอลัมน์ที่ขาดต่อท้าย โดยไม่แตะข้อมูลเดิม (schema migration ปลอดภัยสำหรับ sheet ที่มีข้อมูลแล้ว)
function _ensureColumns(sh, expectedHeaders) {
  var lastCol = sh.getLastColumn();
  var currentHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var missing = expectedHeaders.filter(function(h) { return currentHeaders.indexOf(h) === -1; });
  if (!missing.length) return;
  sh.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing])
    .setFontWeight('bold').setBackground('#1741C6').setFontColor('#ffffff');
}

function _seedProductGroups() {
  var sh = centralSheet('product_groups');
  if (sh.getLastRow() > 1) return;
  [
    [1, 'เครื่องดื่ม', 'น้ำดื่ม น้ำอัดลม ชา กาแฟ'],
    [2, 'ขนมขบเคี้ยว', 'ขนมถุง บิสกิต เวเฟอร์'],
    [3, 'ของใช้ในบ้าน', 'ผงซักฟอก น้ำยา สบู่'],
    [4, 'อาหารสำเร็จรูป', 'บะหมี่กึ่ง ข้าวกล่อง'],
    [5, 'ผลิตภัณฑ์นม', 'นม โยเกิร์ต เนย'],
    [6, 'อื่นๆ', '']
  ].forEach(function(r) { sh.appendRow(r); });
}

function _seedCustomerGroups() {
  var sh = centralSheet('customer_groups');
  if (sh.getLastRow() > 1) return;
  [
    [1, 'Modern Trade', 'ห้างสรรพสินค้า ซูเปอร์มาร์เก็ต'],
    [2, 'Traditional Trade', 'ร้านโชห่วย ร้านขายของชำ'],
    [3, 'HoReCa', 'โรงแรม ร้านอาหาร ภัตตาคาร'],
    [4, 'Wholesale', 'ร้านค้าส่ง'],
    [5, 'Convenience', 'ร้านสะดวกซื้อ'],
    [6, 'Online', 'ร้านค้าออนไลน์'],
    [7, 'อื่นๆ', '']
  ].forEach(function(r) { sh.appendRow(r); });
}

function _seedDistributionChannels() {
  var sh = centralSheet('distribution_channels');
  if (sh.getLastRow() > 1) return;
  [
    [1, 'Cash Van Sales', 'พนักงานขับรถขายเสนอขายหน้าร้าน ตัดสต็อกบนรถ', 'TRUE'],
    [2, 'Credit Sales', 'พนักงานเข้าเยี่ยมจด Sales Order ส่งสำนักงานจัดส่งทีหลัง', 'TRUE'],
    [3, 'ขายหน้าคลัง', 'ลูกค้ามารับสินค้าที่คลังตัวแทนโดยตรง', 'TRUE']
  ].forEach(function(r) { sh.appendRow(r); });
}

function _seedPaymentTypes() {
  var sh = centralSheet('payment_types');
  if (sh.getLastRow() > 1) return;
  [
    [1, 'cash', 'เงินสด', 'TRUE'],
    [2, 'transfer', 'เงินโอน', 'TRUE'],
    [3, 'cheque', 'เช็ค', 'TRUE'],
    [4, 'credit_term', 'เครดิตเทอม', 'TRUE']
  ].forEach(function(r) { sh.appendRow(r); });
}

function _seedProvinces() {
  var sh = centralSheet('provinces');
  if (sh.getLastRow() > 1) return;
  var data = [
    [10,'กรุงเทพมหานคร','Bangkok','กลาง'],[11,'สมุทรปราการ','Samut Prakan','กลาง'],[12,'นนทบุรี','Nonthaburi','กลาง'],
    [13,'ปทุมธานี','Pathum Thani','กลาง'],[14,'พระนครศรีอยุธยา','Phra Nakhon Si Ayutthaya','กลาง'],[15,'อ่างทอง','Ang Thong','กลาง'],
    [16,'ลพบุรี','Lop Buri','กลาง'],[17,'สิงห์บุรี','Sing Buri','กลาง'],[18,'ชัยนาท','Chai Nat','กลาง'],[19,'สระบุรี','Saraburi','กลาง'],
    [20,'ชลบุรี','Chon Buri','กลาง'],[21,'ระยอง','Rayong','กลาง'],[22,'จันทบุรี','Chanthaburi','กลาง'],[23,'ตราด','Trat','กลาง'],
    [24,'ฉะเชิงเทรา','Chachoengsao','กลาง'],[25,'ปราจีนบุรี','Prachin Buri','กลาง'],[26,'นครนายก','Nakhon Nayok','กลาง'],[27,'สระแก้ว','Sa Kaeo','กลาง'],
    [30,'นครราชสีมา','Nakhon Ratchasima','ตะวันออกเฉียงเหนือ'],
    [50,'เชียงใหม่','Chiang Mai','เหนือ'],[51,'ลำพูน','Lamphun','เหนือ'],[52,'ลำปาง','Lampang','เหนือ'],[53,'อุตรดิตถ์','Uttaradit','เหนือ'],
    [54,'แพร่','Phrae','เหนือ'],[55,'น่าน','Nan','เหนือ'],[56,'พะเยา','Phayao','เหนือ'],[57,'เชียงราย','Chiang Rai','เหนือ'],
    [58,'แม่ฮ่องสอน','Mae Hong Son','เหนือ'],[60,'นครสวรรค์','Nakhon Sawan','เหนือ'],[61,'อุทัยธานี','Uthai Thani','เหนือ'],
    [62,'กำแพงเพชร','Kamphaeng Phet','เหนือ'],[63,'ตาก','Tak','เหนือ'],[64,'สุโขทัย','Sukhothai','เหนือ'],[65,'พิษณุโลก','Phitsanulok','เหนือ'],
    [66,'พิจิตร','Phichit','เหนือ'],[67,'เพชรบูรณ์','Phetchabun','เหนือ'],
    [31,'บุรีรัมย์','Buri Ram','ตะวันออกเฉียงเหนือ'],[32,'สุรินทร์','Surin','ตะวันออกเฉียงเหนือ'],[33,'ศรีสะเกษ','Si Sa Ket','ตะวันออกเฉียงเหนือ'],
    [34,'อุบลราชธานี','Ubon Ratchathani','ตะวันออกเฉียงเหนือ'],[35,'ยโสธร','Yasothon','ตะวันออกเฉียงเหนือ'],[36,'ชัยภูมิ','Chaiyaphum','ตะวันออกเฉียงเหนือ'],
    [37,'อำนาจเจริญ','Amnat Charoen','ตะวันออกเฉียงเหนือ'],[38,'บึงกาฬ','Bueng Kan','ตะวันออกเฉียงเหนือ'],[39,'หนองบัวลำภู','Nong Bua Lam Phu','ตะวันออกเฉียงเหนือ'],
    [40,'ขอนแก่น','Khon Kaen','ตะวันออกเฉียงเหนือ'],[41,'อุดรธานี','Udon Thani','ตะวันออกเฉียงเหนือ'],[42,'เลย','Loei','ตะวันออกเฉียงเหนือ'],
    [43,'หนองคาย','Nong Khai','ตะวันออกเฉียงเหนือ'],[44,'มหาสารคาม','Maha Sarakham','ตะวันออกเฉียงเหนือ'],[45,'ร้อยเอ็ด','Roi Et','ตะวันออกเฉียงเหนือ'],
    [46,'กาฬสินธุ์','Kalasin','ตะวันออกเฉียงเหนือ'],[47,'สกลนคร','Sakon Nakhon','ตะวันออกเฉียงเหนือ'],[48,'นครพนม','Nakhon Phanom','ตะวันออกเฉียงเหนือ'],
    [49,'มุกดาหาร','Mukdahan','ตะวันออกเฉียงเหนือ'],
    [70,'ราชบุรี','Ratchaburi','ตะวันตก'],[71,'กาญจนบุรี','Kanchanaburi','ตะวันตก'],[72,'สุพรรณบุรี','Suphan Buri','ตะวันตก'],
    [73,'นครปฐม','Nakhon Pathom','ตะวันตก'],[74,'สมุทรสาคร','Samut Sakhon','ตะวันตก'],[75,'สมุทรสงคราม','Samut Songkhram','ตะวันตก'],
    [76,'เพชรบุรี','Phetchaburi','ตะวันตก'],[77,'ประจวบคีรีขันธ์','Prachuap Khiri Khan','ตะวันตก'],
    [80,'นครศรีธรรมราช','Nakhon Si Thammarat','ใต้'],[81,'กระบี่','Krabi','ใต้'],[82,'พังงา','Phangnga','ใต้'],[83,'ภูเก็ต','Phuket','ใต้'],
    [84,'สุราษฎร์ธานี','Surat Thani','ใต้'],[85,'ระนอง','Ranong','ใต้'],[86,'ชุมพร','Chumphon','ใต้'],[90,'สงขลา','Songkhla','ใต้'],
    [91,'สตูล','Satun','ใต้'],[92,'ตรัง','Trang','ใต้'],[93,'พัทลุง','Phatthalung','ใต้'],[94,'ปัตตานี','Pattani','ใต้'],
    [95,'ยะลา','Yala','ใต้'],[96,'นราธิวาส','Narathiwat','ใต้']
  ];
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
}

// สิทธิ์เริ่มต้น: super_admin (bypass ทุกอย่างในโค้ด ไม่ต้อง seed แถว) / owner_admin / tenant_admin
function _seedRolesAndPermissions() {
  var rolesSh = centralSheet('roles');
  if (rolesSh.getLastRow() === 1) {
    [
      ['super_admin', 'ผู้ดูแลระบบสูงสุด (บริษัท)', 'TRUE'],
      ['owner_admin', 'แอดมินบริษัทเจ้าของสินค้า', 'TRUE'],
      ['tenant_admin', 'แอดมินตัวแทนจำหน่าย', 'TRUE']
    ].forEach(function(r) { rolesSh.appendRow(r); });
  }

  // เช็คทีละ (role, module) แทนที่จะดูว่า sheet ว่างเปล่าไหม — กัน rerun setupCentralSheet()
  // ครั้งถัดๆ ไป ไม่เพิ่มสิทธิ์ของ module ที่เพิ่งเพิ่มใหม่ให้ role เดิมที่ seed ไปแล้วก่อนหน้า
  var permSh = centralSheet('role_permissions');
  var existingPerms = {};
  permSh.getDataRange().getValues().slice(1).forEach(function(row) { existingPerms[row[0] + '|' + row[1]] = true; });

  var ownerModules = ['products', 'promotions', 'tenants', 'settings', 'users_roles', 'sales_report'];
  var tenantModules = ['staff', 'zones', 'customers', 'docnum', 'stock_receive', 'stock_transfer', 'van_issue', 'shipping', 'sales_report', 'users_roles'];

  ownerModules.forEach(function(m) { if (!existingPerms['owner_admin|' + m]) permSh.appendRow(['owner_admin', m, 'TRUE', 'TRUE']); });
  tenantModules.forEach(function(m) { if (!existingPerms['tenant_admin|' + m]) permSh.appendRow(['tenant_admin', m, 'TRUE', 'TRUE']); });
}
