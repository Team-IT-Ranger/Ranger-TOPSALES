/**
 * ===================== SETUP: CENTRAL SHEET =====================
 * รันครั้งเดียวตอนเริ่มโปรเจกต์: setupCentralSheet()
 * Apps Script Editor → เลือกฟังก์ชัน setupCentralSheet → Run
 * รันซ้ำได้ปลอดภัย (สร้างเฉพาะ tab/คอลัมน์ที่ยังไม่มี ไม่แตะข้อมูลเดิม)
 */
// สิทธิ์เริ่มต้นของ role มาตรฐาน (owner_admin/tenant_admin) — ต้องอยู่นอกฟังก์ชันเพื่อให้ ensureSchemaCurrent()
// เอาไปรวมกับ CENTRAL_SHEETS คำนวณลายนิ้วมือด้วย (เพิ่มโมดูลใหม่ในนี้ = สคีมาเปลี่ยน ต้อง re-seed อัตโนมัติ)
// customers/staff/sales อยู่ในนี้ด้วย เพราะบริษัทเจ้าของสินค้าเองก็ต้องเปิดบิลขายแทนตัวแทนได้ (เลือกลูกค้า/พนักงานที่จะตัดสต็อกให้)
var OWNER_MODULES = ['products', 'pricing', 'promotions', 'tenants', 'settings', 'users_roles', 'sales_report', 'customers', 'staff', 'sales',
  'vendors', 'purchasing', 'inventory', 'accounting'];
var TENANT_MODULES = ['staff', 'zones', 'customers', 'sales', 'docnum', 'stock_receive', 'stock_transfer', 'van_issue', 'shipping', 'sales_report', 'users_roles',
  'vendors', 'purchasing', 'inventory'];   // ตัวแทนจำหน่ายซื้อของเองได้ (ข้อมูลแยกกันด้วย tenant_id — ดู 20_purchasing_master.gs)

var CENTRAL_SHEETS = {
  liff_users: ['line_user_id','display_name','role','tenant_id','status','last_login'],
  // line_user_id = ตัวตน LINE ที่ผูกกับบัญชีนี้ (กติกา 2026-09-24: ทุกบัญชีของทุกแอปผูกกับ LINE user id เสมอ)
  admin_users: ['record_id','username','password_hash','salt','display_name','role_code','tenant_id','status','created_at','line_user_id'],
  tenants: ['tenant_id','name','sheet_file_id','region','is_active','created_at',
    'address','tax_id','branch_code','phone','email','logo_url','bank_name','bank_account_no','bank_account_name',
    'is_house'],  // TRUE บนแถวเดียว = "ตัวแทนบ้าน" ของบริษัทเจ้าของสินค้าเอง ใช้เก็บยอดขายตรงที่ไม่ผ่านตัวแทนจำหน่าย (ดู _ensureHouseTenant ใน 13_tenants.gs)

  // product_code: รหัสประจำตัวสินค้า (เหมือนเลขบัตรประชาชนของสินค้า) — unique บังคับ, สำคัญอันดับ 1
  //   ผู้ใช้ตั้งเอง/แก้เองได้ ไม่ใช่ FK ไปหาอะไร คนละความหมายกับ external_code (รหัสจากไฟล์นำเข้า Express
  //   ใช้จับคู่ตอน import เท่านั้น อาจไม่ unique เพราะมาจากระบบภายนอก) — แนวคิดจาก item_code ของ Hippo Village
  // has_transactions: 'TRUE' เมื่อสินค้านี้เคยถูกขายจริงอย่างน้อยหนึ่งครั้ง (recordSale ใน 07_sales.gs เป็นคนเซ็ต)
  //   ใช้ล็อกไม่ให้เปลี่ยน product_code อีก กันเอกสาร/รายงานย้อนหลังอ้างรหัสผิดของ — เซ็ตครั้งเดียวไม่มีวันเคลียร์คืน
  // unit = ชื่อหน่วยฐาน (ไทย, default 'ชิ้น') / unit_code = รหัสหน่วยฐาน — ทั้งระบบใช้ 3 หน่วยเท่านั้น
  // CT=ลัง · PK=แพ็ค · PC=ชิ้น (หน่วยฐาน) ดู 28_units.gs · ข้อมูลเก่ารหัส CASE/PACK/pcs แปลงด้วย migrateUnitCodes()
  //   คู่กันแบบเดียวกับ unit_label/unit_code ใน product_units (หน่วยขายเพิ่มเติม) ด้านล่าง — ถ้าไม่ตั้งมาใช้ default,
  //   ถ้าตั้งมาแล้วใช้ค่าที่ตั้งเสมอ (บังคับ default ที่ addProduct/updateProduct ใน 10_master_data.gs)
  // barcode: บาร์โค้ด "ชุด" ของหน่วยฐาน unique เฉพาะสินค้า+หน่วยนี้เท่านั้น
  // group_barcode: บาร์โค้ด "กลุ่ม" ของหน่วยฐาน — ตั้งใจให้ซ้ำกันได้ข้ามหลาย record (สินค้าเดียวกันจริงแต่คนละรหัสสินค้า)
  // vat_type: 'none' | 'included' | 'excluded' (VAT ใช้อัตรา 7% คงที่ตามกฎหมายไทย ไม่ต้องเก็บอัตราแยกรายสินค้า)
  // alias_codes: รหัสอื่นของสินค้าตัวเดียวกัน คั่นด้วย , (เช่น ใบราคาเขียน "10189 / 10191" = product_code 10189 + alias 10191)
  //   ต้อง unique รวมกับ product_code ของสินค้าทุกตัว — ใช้จับคู่ตอนนำเข้าใบราคา/ไฟล์ขาย
  // tax_status: สถานะภาษีของสินค้าตัวนี้ — '' หรือ 'vat' = คิด VAT 7% ตามปกติ · 'exempt' = ยกเว้นภาษี · 'zero' = อัตราศูนย์
  //   ★ คนละคอลัมน์กับ vat_type ที่มีมาแต่เดิมโดยตั้งใจ — vat_type ค่า default คือ 'none' ซึ่งแปลว่า "ยังไม่ได้ตั้ง"
  //   ไม่ใช่ "ไม่มีภาษี" ถ้าเอามาใช้ตรงๆ สินค้าทุกตัวในระบบจะกลายเป็นยกเว้นภาษีทันที (ไม่มีโค้ดไหนอ่าน vat_type เลย)
  //   คอลัมน์ใหม่นี้ค่าว่าง = คิด VAT จึงไม่ต้อง migrate อะไร ของเดิมทำงานถูกตั้งแต่แถวแรก
  /* ── ฟิลด์ชุดที่ถอดจากทะเบียนสินค้าของ Express (STMAS.DBF) และแอป Smartsales (ชีต item) 2026-09-27 ──
     เอามาเฉพาะตัวที่ "มีโค้ดของเราใช้ได้ทันที" ไม่เอามาตั้งไว้เฉยๆ ให้กลายเป็นคอลัมน์ขยะ
       sales_unit_* / purchase_unit_*  ← ISSAL+SQUCOD+SFACTOR / ISPUR+PQUCOD+PFACTOR
          หน่วยตั้งต้นของแต่ละงาน: ขายเป็นลัง แต่ซื้อเป็นตัน เป็นเรื่องปกติของธุรกิจนี้
       carton_barcode  ← BARCOD ของหน่วยลัง (สแกนที่ปากคลังคนละตัวกับสแกนที่หน้าร้าน)
       packing_text    ← PACKING ("1x12", "1x4x3") ข้อความบรรจุที่พิมพ์บนใบราคา/เอกสาร
       weight_kg       ← NUM1 ใช้กับใบปะหน้าพัสดุและค่าขนส่ง
       is_stock        ← ISINV  สินค้านี้ตัดสต็อกไหม (ค่าบริการ/ค่าขนส่งขายได้แต่ไม่มีของ)
       is_sellable / is_purchasable ← ISSAL / ISPUR  โผล่ในหน้าเปิดบิล / หน้าสั่งซื้อไหม
       no_discount     ← NoDisc ของ Smartsales  ห้ามลดราคา (ส่วนลดท้ายบิลไม่กินรายการนี้)
       reorder_point   ← TOTREO  จุดสั่งซื้อ ใช้เตือนของใกล้หมดในหน้าคลัง
       last_purchase_* ← LPURPR/LPURDAT  ราคาซื้อครั้งล่าสุด (ระบบเติมให้เองตอนรับของ) ใช้ตอนเปิดใบสั่งซื้อ
     ค่าว่างของทุก is_* แปลว่า "ใช่" — สินค้าเดิมทุกตัวจึงทำงานเหมือนเดิมโดยไม่ต้อง migrate */
  products: ['record_id','product_code','name','base_price','unit','unit_code','group_id','is_active','external_code',
    'barcode','group_barcode','cost_price','vat_type','image_url','has_transactions','alias_codes','tax_status',
    'name_en','sales_unit_code','sales_unit_factor','purchase_unit_code','purchase_unit_factor','carton_barcode',
    'packing_text','weight_kg','is_stock','is_sellable','is_purchasable','no_discount','reorder_point',
    'last_purchase_price','last_purchase_date','note','external_system','created_at','created_by','updated_at','updated_by'],
  product_groups: ['record_id','name','description'],
  // ── ชุดราคา/ส่วนลดตามกลุ่มลูกค้า (ใบรายการขายรายไตรมาส) — ดู 17_pricing.gs ──
  //  price_lists: 1 ชุด = 1 กลุ่มลูกค้า × 1 ช่วงเวลา, status: draft | active | archived (valid_from/to เป็นข้อความ yyyy-MM-dd)
  //  price_list_items: 1 แถว = 1 ขั้นราคาของ 1 สินค้า 1 หน่วยขาย — ราคาสุทธิรวม VAT เป็นตัวตั้ง (ส่วนลด % คำนวณเอา)
  //    line_id = กลุ่มแถวที่ใช้ตารางขั้นบันไดร่วมกัน (เช่น แซนดัลวูด+ลาเวนเดอร์) นับจำนวนหีบรวมกันทั้ง line
  //    unit_code CT=ลัง, PK=แพ็ค (van_only=TRUE ขายได้เฉพาะ Cash Van + เงินสด), max_qty ว่าง = ขึ้นไป
  price_lists: ['record_id','name','customer_group_id','valid_from','valid_to','status','source_file','note','created_at','activated_at'],
  price_list_items: ['record_id','price_list_id','line_id','product_id','unit_code','unit_factor','min_qty','max_qty',
    'list_price_ex_vat','cash_price_incl_vat','credit_price_incl_vat','van_only','suggested_price','retail_price','tier_label'],
  price_list_bill_promos: ['record_id','price_list_id','min_amount_ex_vat','percent'],
  // ประวัติการแก้ราคาของชุดที่ "เปิดใช้งานแล้ว" — เดิมห้ามแก้ชุดที่ใช้งานอยู่เพื่อให้ตอบได้ว่า
  // ราคา ณ วันนั้นคือเท่าไร · ตอนนี้แก้ได้แล้ว (ความยืดหยุ่นช่วงเริ่มใช้งาน) จึงต้องเก็บประวัติแทน
  // ไม่งั้นจะเสียความสามารถนั้นไปเฉยๆ · บิลเก่าไม่กระทบอยู่แล้วเพราะเก็บราคาไว้ในบรรทัดของตัวเอง
  price_list_change_log: ['record_id','price_list_id','action','detail','changed_by','changed_at'],
  // ── สิทธิ์เข้าถึงชุดราคา (36_price_rules.gs) ──
  // 1 ชุดราคามีได้หลายกฎ · กฎหนึ่ง = กลุ่มเป้าหมายหนึ่ง มีลำดับความสำคัญของตัวเอง (priority สูงชนะ)
  // ชุดที่ยังไม่มีกฎแต่มี customer_group_id = มีกฎซ่อน "กลุ่มลูกค้า = ค่านั้น" ลำดับ 0 (ของเดิมทำงานต่อได้)
  // target_type: price_list (ค่าว่าง = price_list เพื่อความเข้ากันได้กับแถวเดิม) | promo — กฎสิทธิ์ชุดเดียวกัน
  // ใช้ได้ทั้งกับชุดราคาและโปรโมชั่น · price_list_id เก็บ id ของเป้าหมายตามชนิดนั้น (ชื่อคอลัมน์คงไว้ไม่ให้ของเดิมพัง)
  price_list_rules: ['record_id','target_type','price_list_id','name','match_type','priority','is_active','note','created_at','created_by'],
  // match_type: all = ต้องผ่านทุกเงื่อนไข · any = ผ่านข้อใดข้อหนึ่ง
  // field รับได้เฉพาะที่อยู่ใน PLR_FIELDS หรือขึ้นต้น attr: (ไปอ่าน customers.attributes)
  price_list_rule_conditions: ['record_id','rule_id','field','op','value'],
  // หน่วยขายเพิ่มเติมของสินค้า นอกเหนือจากหน่วยฐาน (products.unit/base_price)
  // เช่น สินค้าเป็น "ชิ้น" ฐาน แต่ขายเป็น "แพ็ค" (factor 6) หรือ "ลัง" (factor 12) ได้ด้วย คนละราคา
  // อ้างอิงจากไฟล์ export จริงของ SmartVan BackOffice (Export_Express) ที่เก็บ UnitCode+UnitFactor แยกจากกัน
  // barcode: บาร์โค้ด "ชุด" ของหน่วยนี้โดยเฉพาะ unique เฉพาะสินค้า+หน่วยนี้ (หน่วยขายเพิ่มเติมไม่มี group_barcode เพราะ concept กลุ่มอยู่ที่ระดับหน่วยฐานเท่านั้น)
  product_units: ['record_id','product_id','unit_code','unit_label','unit_factor','price','is_active','barcode'],

  // ── ทะเบียนลูกค้า — ประกอบแถวผ่าน buildCustomerFields() ใน 33_customers.gs เท่านั้น ──
  // customer_code: รหัสลูกค้าที่คนอ่าน/พิมพ์บนเอกสาร (C0001…) unique ต่อตัวแทน · คนละเรื่องกับ record_id (คีย์ภายใน)
  //   และคนละเรื่องกับ external_code (รหัสจากระบบต้นทางตอนนำเข้า คู่กับ external_system ว่ามาจาก Express/BDC)
  // name_prefix แยกจาก name: ใบกำกับภาษีต้องพิมพ์ "บริษัท … จำกัด" ครบ แต่การค้นหา/เรียงต้องใช้ชื่อจริง
  // การจัดกลุ่ม 3 แกนที่ไม่ปนกัน: group_id = กลุ่มลูกค้า (ตัวกำหนดชุดราคา) · channel_id = ประเภทร้าน/ช่องทาง
  //   (→ distribution_channels) · sales_mode = van | preorder (ขายจากรถ vs รับออเดอร์ส่งทีหลัง)
  // tax_branch_code: 00000 = สำนักงานใหญ่ — กฎหมายไทยบังคับให้ระบุสาขาบนใบกำกับภาษี
  // payment_terms_days/credit_limit: เครดิตประจำร้าน — ใบแจ้งหนี้คิดวันครบกำหนดจากตรงนี้ (23_accounting.gs)
  // status: active | inactive | blocked (ระงับเครดิต ขายสดได้) · is_active คงไว้เพราะโค้ดเดิมทั้งระบบอ่านคอลัมน์นี้
  //   — buildCustomerFields() เขียนสองคอลัมน์นี้ให้ตรงกันเสมอ ห้ามเขียนแยกกันเอง
  // attributes: JSON สำหรับฟิลด์ที่ยังไม่ตกผลึก (แทนคอลัมน์สำรอง rs1..rs5 ของระบบเดิมที่กลายเป็นขยะ)
  customers: ['record_id','customer_code','name_prefix','name','name_2','tenant_id','group_id','channel_id','sales_mode',
    'area_code','salesman_line_user_id','contact_name','phone','email','tax_id','tax_branch_code','tax_type',
    'address','subdistrict_id','district_id','province_id','postcode','lat','lng','ship_to_address',
    'payment_type','payment_terms_days','credit_limit','status','is_active','inactive_at',
    'note','attributes','external_code','external_system','last_sale_at',
    'created_at','created_by','updated_at','updated_by'],
  customer_groups: ['record_id','name','description'],
  // ข้อมูลอ้างอิงกลางเพิ่มเติม จัดการได้เฉพาะโหมด "บริษัทเจ้าของสินค้า" (module 'settings')
  distribution_channels: ['record_id','name','description','is_active'],
  payment_types: ['record_id','code','name','is_active'],

  // trigger_product_ids: รายการ product_id คั่นด้วย , — ใบอนุมัติโปรจริงคิดเป็น "ตระกูลสินค้า" (เช่น Ranger 12hrs
  //   ซึ่งมี 6 SKU) ซึ่งละเอียดกว่า product_group_id (กลุ่ม 7 = ยาจุดทั้งหมด รวม Extreme ที่คนละโปร)
  //   และกว้างกว่า product_id เดี่ยว — ถ้าไม่มีช่องนี้ต้องสร้างกฎซ้ำทีละ SKU แล้วแก้ตกหล่นแน่นอน
  discount_rules: ['record_id','name','scope','product_group_id','product_id','trigger_group_ids','trigger_product_ids','customer_group_id','min_qty','min_amount','type','value','free_product_id','free_qty','priority','stackable','date_start','date_end','is_active'],

  // ═══ การจ่ายชุดราคา/โปรโมชั่นให้ตัวแทน (38_package_distribution.gs) ═══
  // 1 แถว = ชุดนี้จ่ายให้ตัวแทนรายนี้ · ไม่มีแถว = ไม่มีตัวแทนรายไหนได้ใช้ (ไม่ใช่ "ทุกคน" — กติกาเจ้าของระบบ
  // 27 ก.ย. 2026 "จะไม่เอาทุกชุดไปโยนให้ตัวแทนแบบเหมารวม") · ชุดที่มีอยู่ก่อนกติกานี้เขียนย้อนหลังด้วย
  // migratePackageAssignments() ให้ครบทุกตัวแทน ของที่ขายอยู่จะได้ไม่สะดุด
  package_tenants: ['record_id','package_type','package_id','tenant_id','assigned_at','assigned_by'],

  // ═══ ชุดแถม (39_free_goods.gs) ═══
  // แยกจากชุดราคาโดยตั้งใจ: ช่วงเวลาไม่ตรงกัน (ใบอนุมัติจริงมี FOC 1-31 ก.ค. ในงวดราคา ก.ค.-ก.ย.)
  // และของแถมถูกยกเลิก/ต่ออายุระหว่างงวดเป็นปกติ — ฝังในชุดราคาจะต้องคัดลอกชุดราคาใหม่ทุกครั้ง
  // ═══ รายชื่อร้านค้า (40_customer_lists.gs) ═══
  // เกณฑ์อย่าง "ร้านค้าใหม่ที่ยังไม่เคยซื้อ" ตัดสินด้วยดุลพินิจของคนขาย ไม่ใช่วันที่ในฐานข้อมูล
  // แอดมินบริษัทหรือแอดมินตัวแทนทำตารางระบุเองว่าร้านไหนเข้าเกณฑ์ แล้วอ้างในกฎสิทธิ์ด้วย member_of_list
  // tenant_id ว่าง = รายชื่อของบริษัท ทุกตัวแทนใช้ได้ · มีค่า = ของตัวแทนรายนั้น
  customer_lists: ['record_id','name','tenant_id','note','created_at','created_by'],
  customer_list_members: ['record_id','list_id','customer_id','added_at'],

  free_goods_sets: ['record_id','name','status','valid_from','valid_to','customer_group_id','note','created_at','created_by'],
  // tier_group: บรรทัดที่อยู่กลุ่มเดียวกัน = กลไกเดียวกันหลายขั้น → ได้ขั้นสูงสุดที่ถึง "ขั้นเดียว"
  //   ("ซื้อ 12 ลัง FOC 1 ลัง · ซื้อ 6 ลัง FOC 6 แพ็ค" คือกลไกเดียว ไม่ใช่สองโปรที่ได้พร้อมกัน)
  free_goods_items: ['record_id','set_id','tier_group','trigger_product_ids','trigger_group_ids',
    'min_qty','min_unit_code','free_product_id','free_qty','free_unit_code','note','is_active'],

  // ═══════════ งานซื้อ (PR → PO → รับของเข้าคลัง) — ดู 20_purchasing_master.gs, 21_purchase_requisition.gs, 22_purchase_order.gs ═══════════
  // ทั้งหมดเป็นข้อมูล "ฝั่งบริษัทเจ้าของสินค้า" จึงอยู่ Central Sheet (ตัวแทนไม่ได้ซื้อของเอง)
  // tenant_id ในกลุ่มตารางงานซื้อ/คลัง: ว่าง = ของบริษัทเจ้าของสินค้า · มีค่า = ของตัวแทนรายนั้น (ข้อมูลไม่ปนกัน)
  vendors: ['record_id','tenant_id','vendor_code','name','tax_id','branch_code','contact_name','phone','email','address',
    'payment_terms_days','credit_limit','bank_name','bank_account_no','is_active','note','created_at'],
  warehouses: ['record_id','tenant_id','code','name','address','is_active','is_default','created_at'],
  // ยอดคงเหลือต่อคลัง+สินค้า (หน่วยฐาน) · avg_cost = ต้นทุนเฉลี่ยถ่วงน้ำหนัก อัปเดตตอนรับของ
  warehouse_stock: ['record_id','tenant_id','warehouse_id','product_id','qty','avg_cost','updated_at'],
  // บัญชีคุมการเคลื่อนไหวสต็อกคลัง (ledger) — 1 แถว = 1 การเคลื่อนไหว ย้อนรอยได้เสมอ
  stock_ledger: ['record_id','tenant_id','warehouse_id','product_id','change_qty','balance_after','unit_cost','move_type','ref_type','ref_id','note','created_by','created_at'],

  // ── สายอนุมัติ: ออกแบบขั้นตอน (steps) เงื่อนไข (ช่วงวงเงิน) และจำนวนผู้อนุมัติต่อขั้นได้ ──
  // approval_flows: 1 สาย = 1 ประเภทเอกสาร (PR) × ช่วงวงเงิน [min_amount, max_amount] (max ว่าง = ไม่จำกัด)
  approval_flows: ['record_id','tenant_id','doc_type','name','min_amount','max_amount','is_active','note','created_at'],
  // approver_type: 'role' (ทุกคนที่ถือ role นี้) | 'user' (ระบุ admin_users.record_id)
  // approver_ref: role_code หรือ user id — ใส่หลายคนคั่นด้วย , ได้ · required_approvals = ต้องอนุมัติกี่คนจึงผ่านขั้นนี้
  approval_flow_steps: ['record_id','flow_id','step_no','name','approver_type','approver_ref','required_approvals'],

  purchase_requisitions: ['record_id','tenant_id','pr_no','requester_user_id','department','need_by_date','note','status',
    'flow_id','current_step','total_ex_vat','created_at','submitted_at','decided_at','closed_at'],
  pr_items: ['record_id','pr_id','line_no','product_id','description','qty','unit_code','unit_price','amount','po_qty','note'],
  // ประวัติการตัดสินใจทุกครั้ง (ไม่ลบ ไม่ทับ) — ใช้ดูว่าใครอนุมัติขั้นไหนเมื่อไหร่
  pr_approvals: ['record_id','pr_id','step_no','approver_user_id','decision','comment','decided_at'],

  purchase_orders: ['record_id','tenant_id','po_no','vendor_id','pr_id','warehouse_id','status','order_date','expected_date',
    'vat_type','subtotal_ex_vat','discount_ex_vat','vat_amount','total','note','created_by','created_at','closed_at'],
  po_items: ['record_id','po_id','line_no','pr_item_id','product_id','description','qty','unit_code','unit_factor','unit_price','amount','received_qty'],

  goods_receipts: ['record_id','tenant_id','gr_no','po_id','vendor_id','warehouse_id','receive_date','note','status','journal_id','created_by','created_at'],
  gr_items: ['record_id','gr_id','po_item_id','product_id','qty','unit_code','unit_factor','base_qty','unit_cost','amount'],

  // ═══════════ บัญชี (แยกประเภท / ลูกหนี้ / เจ้าหนี้) — ดู 23_accounting.gs ═══════════
  // ผังบัญชีมาตรฐานอย่างย่อ seed ให้ตอน setup (แก้/เพิ่มเองได้) · acct_type: asset|liability|equity|income|expense
  gl_accounts: ['code','name','acct_type','parent_code','is_active','note'],
  // สมุดรายวัน: ทุกใบต้องเดบิต=เครดิต (postJournal บังคับ) · source: GL|AP|AR|INV
  gl_journals: ['record_id','journal_no','journal_date','source','ref_type','ref_id','memo','status','total_debit','total_credit','created_by','created_at','voided_at'],
  gl_journal_lines: ['record_id','journal_id','line_no','account_code','description','debit','credit','party_type','party_id'],

  // เจ้าหนี้: ใบแจ้งหนี้จากผู้ขาย (ตั้งหนี้) + การจ่ายเงิน (1 การจ่าย ตัดได้หลายใบ)
  ap_bills: ['record_id','bill_no','vendor_invoice_no','vendor_id','po_id','gr_id','bill_date','due_date',
    'subtotal_ex_vat','vat_amount','total','paid_amount','status','journal_id','note','created_by','created_at'],
  ap_payments: ['record_id','payment_no','vendor_id','payment_date','amount','method','bank_account','note','status','journal_id','created_by','created_at'],
  ap_payment_allocations: ['record_id','payment_id','bill_id','amount'],

  // ลูกหนี้: ใบแจ้งหนี้ลูกค้า (ออกจากบิลขายเครดิตได้) + การรับชำระ
  ar_invoices: ['record_id','invoice_no','customer_id','tenant_id','sales_order_id','invoice_date','due_date',
    'subtotal_ex_vat','vat_amount','total','received_amount','status','journal_id','note','created_by','created_at'],
  ar_receipts: ['record_id','receipt_no','customer_id','receipt_date','amount','method','bank_account','note','status','journal_id','created_by','created_at'],
  ar_receipt_allocations: ['record_id','receipt_id','invoice_id','amount'],

  // ตัวนับเลขที่เอกสารระดับบริษัท (เอกสารของตัวแทนใช้ doc_number_counters ใน tenant sheet — ดู 12_docnum.gs)
  // ยอดขายรายวันต่อตัวแทน — แดชบอร์ดอ่านตารางนี้แทนการเปิดไฟล์ของทุกตัวแทน (ดู 31_sales_rollup.gs)
  sales_daily: ['record_id','tenant_id','sale_date','bills','revenue','updated_at'],
  central_doc_counters: ['doc_type','period_key','last_number'],   // doc_type ของตัวแทนจะเป็น 'PR@TNKN' แยกเลขรันของใครของมัน

  // ข้อมูลบริษัทเจ้าของสินค้า (แถวเดียว record_id=1) — ใช้เป็นชื่อบริษัทที่โชว์ในตัวเลือกบริษัท หัวเอกสาร และใบกำกับภาษี
  // คนละเรื่องกับ tenants (ข้อมูลตัวแทนแต่ละราย) และคนละเรื่องกับ tenant 'HOUSE' ที่เป็นแค่บัญชีขายตรงของบริษัท
  // vat_rate เก็บเป็น "เปอร์เซ็นต์" (7) — การคำนวณใช้ทศนิยม (0.07) แปลงที่ currentVatRate() จุดเดียว
  //   อัตราภาษีเปลี่ยนได้จริง (ไทยเคยลด 10% เหลือ 7% แล้วต่ออายุเป็นช่วงๆ) จึงห้ามฮาร์ดโค้ดในโค้ด
  // default_vat_type: inclusive = ราคาที่กรอกรวม VAT แล้ว (ค่าตั้งต้นของเรา ใบราคาบริษัทพิมพ์ราคารวมภาษีมาตลอด)
  company_profile: ['record_id','name','legal_name','tax_id','branch_code','address','phone','email','website',
    'logo_url','bank_name','bank_account_no','bank_account_name','note','updated_at','updated_by',
    'vat_rate','default_vat_type'],

  // roles.tenant_id ว่าง = บทบาทกลางของระบบ (super_admin/owner_admin/tenant_admin)
  // มีค่า = บทบาทที่แอดมินของตัวแทนรายนั้นสร้างเอง เห็น/แก้ได้เฉพาะตัวแทนนั้น (ดู 26_roles.gs)
  roles: ['role_code','role_label','is_system','tenant_id','description'],
  role_permissions: ['role_code','module_code','can_view','can_edit'],

  provinces: ['id','name','name_en','region'],
  districts: ['id','name','name_en','province_id'],
  subdistricts: ['id','name','name_en','district_id','zipcode']
};

// สคีมาเปลี่ยน (เพิ่มตาราง/คอลัมน์ใน CENTRAL_SHEETS หรือเพิ่มโมดูลสิทธิ์ใหม่ใน OWNER_MODULES/TENANT_MODULES)
// → รัน setupCentralSheet() ให้เองอัตโนมัติ "ครั้งเดียว" ตอนแอดมินล็อกอิน
// เทียบลายนิ้วมือ (MD5) กับที่เคยใช้ไว้ใน Script Properties — ไม่ต้องจำไปรัน setup ด้วยมืออีก
// ล้มเหลวไม่ทำให้ล็อกอินพัง (แค่ไม่บันทึกลายนิ้วมือ จะลองใหม่ครั้งหน้า)
/**
 * @param force true = ไม่สนลายนิ้วมือ ลงมือเติมเลย — ใช้ตอนถูกเรียกเพราะ "หาชีตไม่เจอ" (centralSheet)
 *   ซึ่งแปลว่าของจริงกับลายนิ้วมือไม่ตรงกันอยู่แล้ว การเช็คลายนิ้วมือจะทำให้ไม่ยอมซ่อม
 */
function ensureSchemaCurrent(force) {
  try {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify({ sheets: CENTRAL_SHEETS, ownerModules: OWNER_MODULES, tenantModules: TENANT_MODULES }));
    var fp = digest.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
    var props = PropertiesService.getScriptProperties();
    if (!force && props.getProperty('SCHEMA_FINGERPRINT') === fp) return false;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return false;
    try {
      if (!force && props.getProperty('SCHEMA_FINGERPRINT') === fp) return false;
      setupCentralSheet();
      props.setProperty('SCHEMA_FINGERPRINT', fp);
      return true;
    } finally { lock.releaseLock(); }
  } catch (e) { Logger.log('ensureSchemaCurrent ล้มเหลว: ' + e.message); return false; }
}

function _setTextColumns(ss, sheetName, headers) {
  var sh = ss.getSheetByName(sheetName); if (!sh) return;
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  headers.forEach(function(h) {
    var c = hdr.indexOf(h); if (c === -1) return;
    sh.getRange(2, c + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });
}

function setupCentralSheet() {
  var cfg = getConfig();
  var ss = SpreadsheetApp.openById(cfg.CENTRAL_SHEET_FILEID);
  Logger.log('=== TOPSALES Central Sheet Setup ===');

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
  _seedGlAccounts();
  _seedCompanyProfile();
  _seedDefaultWarehouse();

  _setTextColumns(ss, 'price_lists', ['valid_from', 'valid_to']);   // กัน Sheets แปลงวันที่เป็น Date เอง (เขตเวลาไม่ตรงกัน = วันเลื่อน)
  // เลขผู้เสียภาษี 13 หลักขึ้นต้นด้วย 0 ได้ — Sheets จะกลืนศูนย์นำหน้าทิ้งถ้าปล่อยเป็นตัวเลข
  // แล้วใบกำกับภาษีจะผิดแบบเงียบๆ (0105552018639 → 105552018639) · กันสองชั้นคู่กับการเติมศูนย์ตอนอ่าน
  _setTextColumns(ss, 'customers', ['tax_id', 'tax_branch_code', 'postcode', 'phone']);
  _setTextColumns(ss, 'company_profile', ['tax_id', 'branch_code']);
  _setTextColumns(ss, 'tenants', ['tax_id', 'branch_code']);
  _setTextColumns(ss, 'vendors', ['tax_id', 'branch_code']);
  clearRolePermissionsCache(); // ให้สิทธิ์ที่เพิ่งเติม (เช่น settings) มีผลทันที ไม่ต้องรอแคช 5 นาที
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

// ผังบัญชีมาตรฐานอย่างย่อ (ภาษาไทย) — seed ครั้งเดียว แก้/เพิ่มบัญชีเองได้ทีหลัง
// รหัสที่ระบบใช้อ้างอิงเองอยู่ใน GL_ACCT (23_accounting.gs) ถ้าจะเปลี่ยนรหัส ต้องแก้ที่นั่นด้วย
function _seedGlAccounts() {
  var sh = centralSheet('gl_accounts');
  if (sh.getLastRow() > 1) return;
  [
    ['1000', 'สินทรัพย์', 'asset', '', 'TRUE', 'หมวดหลัก'],
    ['1100', 'เงินสดและเงินฝากธนาคาร', 'asset', '1000', 'TRUE', ''],
    ['1110', 'เงินสดในมือ', 'asset', '1100', 'TRUE', ''],
    ['1120', 'เงินฝากธนาคาร', 'asset', '1100', 'TRUE', 'บัญชีรับ-จ่ายหลัก'],
    ['1200', 'ลูกหนี้การค้า', 'asset', '1000', 'TRUE', 'คุมยอดจากระบบลูกหนี้'],
    ['1300', 'สินค้าคงเหลือ', 'asset', '1000', 'TRUE', 'คุมยอดจากคลังสินค้า'],
    ['1400', 'ภาษีซื้อ', 'asset', '1000', 'TRUE', 'VAT ซื้อ 7%'],
    ['2000', 'หนี้สิน', 'liability', '', 'TRUE', 'หมวดหลัก'],
    ['2100', 'เจ้าหนี้การค้า', 'liability', '2000', 'TRUE', 'คุมยอดจากระบบเจ้าหนี้'],
    ['2150', 'รับของแล้วยังไม่ได้รับใบแจ้งหนี้', 'liability', '2000', 'TRUE', 'GR/NI — ตั้งตอนรับของ ล้างตอนตั้งหนี้'],
    ['2200', 'ภาษีขาย', 'liability', '2000', 'TRUE', 'VAT ขาย 7%'],
    ['3000', 'ส่วนของเจ้าของ', 'equity', '', 'TRUE', 'หมวดหลัก'],
    ['3100', 'ทุนจดทะเบียน', 'equity', '3000', 'TRUE', ''],
    ['3900', 'กำไรสะสม', 'equity', '3000', 'TRUE', ''],
    ['4000', 'รายได้', 'income', '', 'TRUE', 'หมวดหลัก'],
    ['4100', 'รายได้จากการขาย', 'income', '4000', 'TRUE', ''],
    ['5000', 'ค่าใช้จ่าย', 'expense', '', 'TRUE', 'หมวดหลัก'],
    ['5100', 'ต้นทุนขาย', 'expense', '5000', 'TRUE', ''],
    ['5900', 'ค่าใช้จ่ายอื่น', 'expense', '5000', 'TRUE', 'ใช้กับใบแจ้งหนี้ที่ไม่ผูกสินค้า']
  ].forEach(function(r) { sh.appendRow(r); });
}

// ข้อมูลบริษัทเริ่มต้น 1 แถว — ผู้ใช้เข้าไปแก้ชื่อจริง/เลขผู้เสียภาษีได้ที่เมนู ตั้งค่าระบบ → ข้อมูลบริษัท
function _seedCompanyProfile() {
  var sh = centralSheet('company_profile');
  if (sh.getLastRow() > 1) return;
  sh.appendRow([1, 'บริษัทเจ้าของสินค้า', '', '', '', '', '', '', '', '', '', '', '', '', nowStr(), '']);
}

// คลังกลาง 1 แห่งให้เริ่มใช้งานได้ทันที (เพิ่มคลังเองได้ที่เมนูคลังสินค้า)
function _seedDefaultWarehouse() {
  var sh = centralSheet('warehouses');
  if (sh.getLastRow() > 1) return;
  // เขียนด้วยชื่อคอลัมน์ ไม่ใช่ตำแหน่ง — ชีตเก่าที่เพิ่ง migrate จะมี tenant_id ต่อท้ายแถวหัว ไม่ได้อยู่คอลัมน์ที่ 2
  centralAppend('warehouses', { record_id: 1, tenant_id: '', code: 'MAIN', name: 'คลังกลาง', address: '',
    is_active: 'TRUE', is_default: 'TRUE', created_at: nowStr() });
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
      ['super_admin', 'ผู้ดูแลระบบสูงสุด (บริษัท)', 'TRUE', '', 'เห็นและแก้ได้ทุกเมนู กำหนดผ่าน Apps Script เท่านั้น'],
      ['owner_admin', 'แอดมินบริษัทเจ้าของสินค้า', 'TRUE', '', 'ดูแลข้อมูลกลาง สินค้า ราคา งานซื้อ บัญชี'],
      ['tenant_admin', 'แอดมินตัวแทนจำหน่าย', 'TRUE', '', 'ดูแลงานขาย พนักงาน ลูกค้า ของตัวแทนตัวเอง']
    ].forEach(function(r) { rolesSh.appendRow(r); });
  }

  // เช็คทีละ (role, module) แทนที่จะดูว่า sheet ว่างเปล่าไหม — กัน rerun setupCentralSheet()
  // ครั้งถัดๆ ไป ไม่เพิ่มสิทธิ์ของ module ที่เพิ่งเพิ่มใหม่ให้ role เดิมที่ seed ไปแล้วก่อนหน้า
  var permSh = centralSheet('role_permissions');
  var existingPerms = {};
  permSh.getDataRange().getValues().slice(1).forEach(function(row) { existingPerms[row[0] + '|' + row[1]] = true; });

  OWNER_MODULES.forEach(function(m) { if (!existingPerms['owner_admin|' + m]) permSh.appendRow(['owner_admin', m, 'TRUE', 'TRUE']); });
  TENANT_MODULES.forEach(function(m) { if (!existingPerms['tenant_admin|' + m]) permSh.appendRow(['tenant_admin', m, 'TRUE', 'TRUE']); });
}
