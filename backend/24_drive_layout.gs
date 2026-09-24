/**
 * ===================== ที่เก็บไฟล์ฐานข้อมูลบน Google Drive =====================
 * ไฟล์ฐานข้อมูล (Google Sheets) ต้องแยกโฟลเดอร์ให้ชัดว่าเป็นของสภาพแวดล้อมไหน และของใคร:
 *
 *   <โฟลเดอร์ราก>/
 *     db_uat/                      ← สภาพแวดล้อมทดสอบ
 *       TNKI/                      ← ข้อมูลส่วนกลาง + ฐานข้อมูลของบริษัทเจ้าของสินค้า (รวม tenant 'HOUSE' ที่เป็นบัญชีขายตรงของบริษัทเอง)
 *         TOPSALES UAT — Central Sheet      (ไฟล์ที่สร้างก่อน 24 ก.ย. 2026 ยังชื่อ TOPSHOP … — ชื่อไม่มีผลกับโค้ด)
 *         Ranger-TOPSALES-HOUSE
 *       <รหัสตัวแทน>/              ← 1 โฟลเดอร์ต่อตัวแทนจำหน่าย 1 ราย (ชื่อโฟลเดอร์ = รหัสตัวแทน = อักษรย่อของชื่อตัวแทน)
 *         Ranger-TOPSALES-<รหัส>          (ของเดิมชื่อ salesranger-TOPSHOP-<รหัส>)
 *     db_prod/                     ← ของจริง โครงสร้างเดียวกันทุกอย่าง
 *
 * ทำไมต้องให้ backend เป็นคนย้าย: ไฟล์ทั้งหมดถูกสร้างโดย Apps Script จึงมีเจ้าของเป็นบัญชีที่รันสคริปต์
 * คนอื่น (รวมทั้งเครื่องมือภายนอก) มองไม่เห็น/ย้ายไม่ได้ — โค้ดนี้รันในฐานะเจ้าของไฟล์จึงย้ายได้
 *
 * ตั้งค่า: Script Property `DB_ROOT_FOLDER_ID` (ไม่ตั้ง = ใช้ DB_ROOT_FOLDER_ID_DEFAULT ข้างล่าง)
 *         Script Property `ENV_NAME` = 'uat' | 'prod' (ไม่ตั้ง = ถือว่าเป็น production)
 */

var DB_ROOT_FOLDER_ID_DEFAULT = '1vjnkJ1Sec0pWh2HPJ0WulkGd2yRnFyvK';   // โฟลเดอร์ salesranger-TOPSHOP บน Shared Drive
var OWNER_FOLDER_NAME = 'TNKI';                                        // ข้อมูลส่วนกลาง + ฐานข้อมูลบริษัทเจ้าของสินค้า

function _dbRootFolderId() {
  return PropertiesService.getScriptProperties().getProperty('DB_ROOT_FOLDER_ID') || DB_ROOT_FOLDER_ID_DEFAULT;
}
// ชื่อสภาพแวดล้อมของโปรเจกต์นี้ — UAT ตั้ง ENV_NAME='uat' ไว้แล้วตอน setupUatEnvironment()
function _envName() {
  var v = String(PropertiesService.getScriptProperties().getProperty('ENV_NAME') || '').trim().toLowerCase();
  return v === 'uat' ? 'uat' : 'prod';
}
function _envFolderName() { return 'db_' + _envName(); }

// หาโฟลเดอร์ชื่อนี้ใต้ parent ถ้าไม่มีก็สร้าง (ชื่อซ้ำกันหลายอัน = ใช้อันแรกที่เจอ ไม่สร้างเพิ่ม)
function _ensureChildFolder(parentFolder, name) {
  var it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(name);
}
function _dbEnvFolder() { return _ensureChildFolder(DriveApp.getFolderById(_dbRootFolderId()), _envFolderName()); }
function _dbOwnerFolder() { return _ensureChildFolder(_dbEnvFolder(), OWNER_FOLDER_NAME); }
// โฟลเดอร์ของตัวแทน 1 ราย — 'HOUSE' (บัญชีขายตรงของบริษัทเอง) ถือเป็นข้อมูลของบริษัท เก็บรวมใน TNKI
function _dbTenantFolder(tenantId) {
  var code = String(tenantId || '').trim();
  if (!code) return _dbOwnerFolder();
  if (code === HOUSE_TENANT_ID) return _dbOwnerFolder();
  return _ensureChildFolder(_dbEnvFolder(), code);
}

// ย้ายไฟล์เข้าโฟลเดอร์ปลายทาง — ล้มเหลวไม่ทำให้งานหลักพัง (คืนข้อความบอกเหตุผลแทน)
function _moveFileTo(fileId, folder) {
  try {
    var file = DriveApp.getFileById(fileId);
    var parents = file.getParents();
    var currentId = parents.hasNext() ? parents.next().getId() : '';
    if (currentId === folder.getId()) return { moved: false, already: true, name: file.getName() };
    file.moveTo(folder);
    return { moved: true, name: file.getName(), from: currentId };
  } catch (e) {
    return { moved: false, error: _driveErrorHint(e) };
  }
}

/**
 * จัดระเบียบไฟล์ฐานข้อมูลที่มีอยู่แล้วทั้งหมดให้เข้าโครงสร้าง (รันซ้ำได้ ไฟล์ที่อยู่ถูกที่แล้วจะข้าม)
 * super_admin เท่านั้น — ย้ายไฟล์ข้ามโฟลเดอร์/เข้า Shared Drive มีผลกับสิทธิ์การเข้าถึงไฟล์
 */
function organizeDatabaseFiles(session, payload) {
  if (!session || session.role_code !== 'super_admin') return { success: false, message: 'เฉพาะผู้ดูแลระบบสูงสุด (super_admin) เท่านั้น' };
  var report = [];
  try {
    var envFolder = _dbEnvFolder(), ownerFolder = _dbOwnerFolder();
    // 1) Central Sheet → <env>/TNKI
    var centralId = getConfig().CENTRAL_SHEET_FILEID;
    if (centralId) {
      var r = _moveFileTo(centralId, ownerFolder);
      report.push({ what: 'Central Sheet', target: _envFolderName() + '/' + OWNER_FOLDER_NAME, fileId: centralId,
        status: r.error ? 'ย้ายไม่ได้: ' + r.error : (r.already ? 'อยู่ถูกที่แล้ว' : 'ย้ายแล้ว'), name: r.name || '' });
    }
    // 2) ไฟล์ของตัวแทนแต่ละราย → <env>/<รหัสตัวแทน> (HOUSE รวมอยู่ใน TNKI)
    centralObjects('tenants').forEach(function(t) {
      if (!t.sheet_file_id) return;
      var folder = _dbTenantFolder(t.tenant_id);
      var res = _moveFileTo(t.sheet_file_id, folder);
      report.push({ what: 'ตัวแทน ' + t.tenant_id + (t.name ? ' (' + t.name + ')' : ''),
        target: _envFolderName() + '/' + folder.getName(), fileId: t.sheet_file_id,
        status: res.error ? 'ย้ายไม่ได้: ' + res.error : (res.already ? 'อยู่ถูกที่แล้ว' : 'ย้ายแล้ว'), name: res.name || '' });
    });
    return { success: true, env: _envName(), rootFolderId: _dbRootFolderId(), envFolderId: envFolder.getId(),
      ownerFolderId: ownerFolder.getId(), report: report,
      moved: report.filter(function(x) { return x.status === 'ย้ายแล้ว'; }).length,
      failed: report.filter(function(x) { return x.status.indexOf('ย้ายไม่ได้') === 0; }).length };
  } catch (e) {
    return { success: false, message: _driveErrorHint(e), report: report };
  }
}

// แปลง error ของ Drive เป็นคำอธิบายที่ทำตามได้จริง (เจอบ่อย 2 แบบ: สิทธิ์ OAuth ไม่พอ / ไม่มีสิทธิ์ในโฟลเดอร์)
function _driveErrorHint(e) {
  var m = String((e && e.message) || e);
  if (/insufficient|ไม่เพียงพอ|auth\/drive/i.test(m)) {
    return 'สิทธิ์ Drive ของสคริปต์ยังไม่พอ — เจ้าของ deployment ต้องเปิด Apps Script editor แล้วรันฟังก์ชัน ' +
      '`authorizeDriveAccess()` หนึ่งครั้งเพื่อกดยอมรับสิทธิ์ใหม่ จากนั้น Deploy → New version แล้วลองใหม่ ' +
      '(รายละเอียด: ' + m + ')';
  }
  if (/permission|ไม่มีสิทธิ/i.test(m)) {
    return 'เข้าถึงโฟลเดอร์ปลายทางไม่ได้ — บัญชีที่รันสคริปต์ต้องมีสิทธิ์อย่างน้อย "ผู้จัดการเนื้อหา" ' +
      'บนไดรฟ์ที่แชร์ที่เก็บโฟลเดอร์ฐานข้อมูล (DB_ROOT_FOLDER_ID) · รายละเอียด: ' + m;
  }
  return 'จัดระเบียบไม่สำเร็จ: ' + m;
}

// ดูว่าตอนนี้ไฟล์ไหนอยู่โฟลเดอร์ไหน (ไม่ย้ายอะไรทั้งนั้น) — ใช้โชว์ในหน้าแอดมิน
function getDatabaseLayout(session) {
  var err = _requirePermission(session, 'tenants', 'view'); if (err) return err;
  var rows = [];
  var where = function(fileId) {
    try {
      var f = DriveApp.getFileById(fileId), ps = f.getParents();
      var parent = ps.hasNext() ? ps.next() : null;
      var grand = null;
      if (parent) { var gps = parent.getParents(); grand = gps.hasNext() ? gps.next() : null; }
      return { name: f.getName(), folder: parent ? ((grand ? grand.getName() + '/' : '') + parent.getName()) : '(ไม่มีโฟลเดอร์)', url: f.getUrl() };
    } catch (e) { return { name: '', folder: 'อ่านไม่ได้: ' + e.message, url: '' }; }
  };
  var centralId = getConfig().CENTRAL_SHEET_FILEID;
  if (centralId) { var c = where(centralId); rows.push({ what: 'Central Sheet (ข้อมูลส่วนกลาง)', tenantId: '', fileId: centralId, name: c.name, folder: c.folder, url: c.url }); }
  centralObjects('tenants').forEach(function(t) {
    if (!t.sheet_file_id) return;
    var w = where(t.sheet_file_id);
    rows.push({ what: _isTrue(t.is_house) ? 'ฐานข้อมูลบริษัทเจ้าของสินค้า (ขายตรง)' : 'ตัวแทน ' + (t.name || ''),
      tenantId: t.tenant_id, fileId: t.sheet_file_id, name: w.name, folder: w.folder, url: w.url });
  });
  return { success: true, env: _envName(), envFolder: _envFolderName(), ownerFolder: OWNER_FOLDER_NAME,
    rootFolderId: _dbRootFolderId(), data: rows };
}
