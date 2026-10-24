<#
=========================== ตัวตรวจโครง DBF ของ Express ===========================
อ่านอย่างเดียว ไม่เขียนอะไรลงไฟล์ .dbf เลยแม้แต่ไบต์เดียว — เอาไปรันบนเครื่องของตัวแทนได้
โดยไม่ต้องปิด Express และไม่ต้องติดตั้งอะไรเพิ่ม (PowerShell มากับ Windows อยู่แล้ว)

★★★ ทำไมต้องมี (docs/express-interface-notes.md ข้อ 3): โครง DBF บนเครื่องที่เราสำรวจ
  (Express ปี 2013) **อาจไม่ตรงกับเครื่องของตัวแทน** ซึ่งเป็นคนละเวอร์ชัน — ต่างกันแม้ไบต์เดียว
  ไฟล์ที่เราเขียนลงไปก็เสียทั้งตาราง ไม่ใช่แค่แถวเดียว · ตัวนี้จึงต้องรันบนเครื่องปลายทาง
  แล้วเทียบกับแบบที่เราบันทึกไว้ **ก่อน**เขียนโค้ดสร้างไฟล์จริง

วิธีใช้
  # 1) เก็บแบบไว้เทียบ (ทำบนเครื่องเรา ครั้งเดียว)
  .\Get-DbfSchema.ps1 -Path 'Z:\TNK2020' -SaveBaseline '.\schema-baseline.json'

  # 2) เอาไปรันบนเครื่องตัวแทน แล้วดูว่าต่างตรงไหน
  .\Get-DbfSchema.ps1 -Path 'C:\ExpressI\TNK2026' -Baseline '.\schema-baseline.json'

  # 3) อยากได้ไฟล์ผลไว้ส่งกลับมาให้เราดู
  .\Get-DbfSchema.ps1 -Path 'C:\ExpressI\TNK2026' -SaveBaseline '.\schema-ตัวแทน.json'

ออกจากโปรแกรมด้วยรหัส 0 = เหมือนกันทุกตาราง · 1 = มีจุดต่าง (ดูรายงาน) · 2 = เปิดไฟล์ไม่ได้
#>
[CmdletBinding()]
param(
  # โฟลเดอร์ข้อมูลของ Express (โฟลเดอร์ที่มี ARMAS.DBF, STMAS.DBF อยู่)
  [Parameter(Mandatory = $true)][string]$Path,
  # จำกัดเฉพาะตารางที่สนใจ — ค่าตั้งต้นคือ 10 ตารางที่เกี่ยวกับงาน interface ใบสั่งขาย
  [string[]]$Tables = @('ARTRN','ARBAL','ARMAS','GLJNL','GLJNLIT','ISRUN','ISVAT','STCRD','STLOC','STMAS','OESO','OESOIT'),
  # เขียนผลเป็น JSON ไว้เทียบทีหลัง
  [string]$SaveBaseline,
  # เทียบกับไฟล์ JSON ที่เก็บไว้ก่อนหน้า
  [string]$Baseline,
  # ตรวจทุกไฟล์ .dbf ในโฟลเดอร์ ไม่สนรายชื่อข้างบน
  [switch]$AllTables
)

$ErrorActionPreference = 'Stop'

# ── รหัสหน้า (codepage) ที่ Express ใช้จริงในไทยคือ 874 — ไบต์นี้ผิด = ภาษาไทยเพี้ยนทั้งไฟล์ ──
$CodePages = @{
  0x00 = 'ไม่ระบุ'; 0x01 = '437 (US MS-DOS)'; 0x02 = '850 (Intl MS-DOS)'; 0x03 = '1252 (Windows ANSI)'
  0x04 = '10000 (Mac)'; 0x64 = '852'; 0x65 = '866'; 0x66 = '865'; 0x67 = '861'; 0x68 = '895'
  0x69 = '620'; 0x6A = '737'; 0x6B = '857'; 0x78 = '950 (จีนตัวเต็ม)'; 0x79 = '949 (เกาหลี)'
  0x7A = '936 (จีนตัวย่อ)'; 0x7B = '932 (ญี่ปุ่น)'; 0x7C = '874 (ไทย Windows)'; 0x7D = '1255'
  0x7E = '1256'; 0xC8 = '1250'; 0xC9 = '1251'; 0xCA = '1254'; 0xCB = '1253'
}

$Versions = @{
  0x02 = 'FoxBASE'; 0x03 = 'dBase III+ (ไม่มี memo)'; 0x04 = 'dBase IV'; 0x05 = 'dBase 5'
  0x30 = 'Visual FoxPro'; 0x31 = 'Visual FoxPro (auto-increment)'; 0x32 = 'Visual FoxPro (varchar)'
  0x43 = 'dBase IV SQL table'; 0x83 = 'dBase III+ (มี memo)'; 0x8B = 'dBase IV (มี memo)'
  0xF5 = 'FoxPro 2.x (มี memo)'; 0xFB = 'FoxPro'
}

# ชนิดฟิลด์ที่รู้จัก · ★ `B` คือตัวที่พลาดแล้วเจ็บที่สุด (binary double 8 ไบต์ ไม่ใช่ตัวเลขแบบข้อความ)
$FieldTypes = @{
  'C' = 'ข้อความ'; 'N' = 'ตัวเลข (เก็บเป็นข้อความ)'; 'F' = 'ทศนิยม (ข้อความ)'
  'D' = 'วันที่ YYYYMMDD'; 'L' = 'ตรรกะ T/F'; 'M' = 'memo (อยู่ในไฟล์ .fpt/.dbt)'
  'B' = '★ binary double 8 ไบต์ (IEEE754 little-endian)'; 'G' = 'general/OLE'
  'I' = 'จำนวนเต็ม 4 ไบต์'; 'T' = 'datetime 8 ไบต์'; 'Y' = 'currency 8 ไบต์'
  'P' = 'picture'; 'V' = 'varchar'; 'Q' = 'varbinary'; '@' = 'timestamp'; 'O' = 'double'; '+' = 'auto-increment'
}

function Read-DbfHeader {
  param([string]$File)

  # ★ FileShare = ReadWrite เพื่อให้อ่านได้แม้ Express กำลังเปิดไฟล์นั้นอยู่ —
  #   ถ้าใช้ค่าตั้งต้น จะอ่านไม่ได้บนเครื่องที่กำลังทำงานจริง ซึ่งคือเครื่องที่เราต้องไปตรวจพอดี
  $fs = [System.IO.File]::Open($File, [System.IO.FileMode]::Open,
          [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $len = $fs.Length
    if ($len -lt 32) { throw "ไฟล์สั้นกว่าหัวตาราง ($len ไบต์) — ไม่ใช่ไฟล์ DBF" }
    $head = New-Object byte[] 32
    [void]$fs.Read($head, 0, 32)

    $recCount  = [BitConverter]::ToUInt32($head, 4)
    $headerLen = [BitConverter]::ToUInt16($head, 8)
    $recLen    = [BitConverter]::ToUInt16($head, 10)

    $fields = @()
    $pos = 32
    $offset = 1              # ไบต์แรกของทุกแถวคือธงลบ (' ' หรือ '*') ไม่ใช่ข้อมูล
    while ($pos -lt $headerLen -and $pos + 32 -le $len) {
      $fs.Position = $pos
      $fd = New-Object byte[] 32
      [void]$fs.Read($fd, 0, 32)
      if ($fd[0] -eq 0x0D -or $fd[0] -eq 0x00) { break }    # 0x0D = จบรายการฟิลด์

      $nameBytes = $fd[0..10]
      $stop = [Array]::IndexOf([byte[]]$nameBytes, [byte]0)
      if ($stop -lt 0) { $stop = 11 }
      $name = [Text.Encoding]::ASCII.GetString($nameBytes, 0, $stop).Trim()
      $type = [char]$fd[11]

      $fields += [pscustomobject]@{
        no      = $fields.Count + 1
        name    = $name
        type    = [string]$type
        length  = [int]$fd[16]
        dec     = [int]$fd[17]
        offset  = $offset
        meaning = $(if ($FieldTypes.ContainsKey([string]$type)) { $FieldTypes[[string]$type] } else { '** ไม่รู้จักชนิดนี้ **' })
      }
      $offset += [int]$fd[16]
      $pos += 32
    }

    $cpByte = [int]$head[29]
    [pscustomobject]@{
      file          = Split-Path $File -Leaf
      fileWritten   = (Get-Item -LiteralPath $File).LastWriteTime.ToString('yyyy-MM-dd HH:mm')
      fileSize      = $len
      version       = [int]$head[0]
      versionName   = $(if ($Versions.ContainsKey([int]$head[0])) { $Versions[[int]$head[0]] } else { 'ไม่รู้จัก' })
      # ★★ ไบต์ปีในหัวตารางของ Express ไม่ตรงมาตรฐาน (ดู Write-TableReport) — เก็บค่าดิบไว้ทั้งสามไบต์
      stampRaw      = ('{0}-{1}-{2}' -f [int]$head[1], [int]$head[2], [int]$head[3])
      stampYearByte = [int]$head[1]
      lastUpdate    = ('{0:d4}-{1:d2}-{2:d2}' -f (1900 + [int]$head[1]), [int]$head[2], [int]$head[3])
      recordCount   = [int]$recCount
      headerLength  = [int]$headerLen
      recordLength  = [int]$recLen
      codepageByte  = $cpByte
      codepage      = $(if ($CodePages.ContainsKey($cpByte)) { $CodePages[$cpByte] } else { ('ไม่รู้จัก (0x{0:X2})' -f $cpByte) })
      hasCdx        = (($head[28] -band 0x01) -ne 0)
      hasMemo       = (($head[28] -band 0x02) -ne 0)
      fieldSum      = $offset                  # 1 + ผลรวมความยาวทุกฟิลด์ ต้องเท่ากับ recordLength
      expectedSize  = [int64]$headerLen + ([int64]$recCount * [int64]$recLen) + 1
      fields        = $fields
    }
  } finally { $fs.Dispose() }
}

function Write-TableReport {
  param($t, [string]$Name)

  Write-Host ''
  Write-Host ("=== {0} ({1}) ===" -f $Name, $t.file) -ForegroundColor Cyan
  Write-Host ("  เวอร์ชัน : 0x{0:X2} {1}" -f $t.version, $t.versionName)
  Write-Host ("  รหัสหน้า : 0x{0:X2} = {1}" -f $t.codepageByte, $t.codepage)
  Write-Host ("  แถว      : {0:N0}   ยาวแถวละ {1} ไบต์   หัวตาราง {2} ไบต์" -f $t.recordCount, $t.recordLength, $t.headerLength)
  Write-Host ("  ดัชนี .CDX: {0}   memo: {1}   ไฟล์แก้ล่าสุด (ตามวินโดวส์): {2}" -f $t.hasCdx, $t.hasMemo, $t.fileWritten)
  <# ★★ ไบต์ "วันที่แก้ล่าสุด" ในหัวตารางของ Express **ไม่ตรงมาตรฐาน DBF**
       มาตรฐานคือ ปี ค.ศ. − 1900 (ปี 2026 ต้องได้ 126) แต่ไฟล์ที่ Express เขียนเองได้ 234 ทุกไฟล์
       (ตรวจแล้ว 15 ต.ค. 2026: ARTRN/ARBAL/ARMAS/ISRUN/STCRD/STMAS จากเครื่องตัวแทนได้ 234 เหมือนกันหมด
        ส่วนไฟล์ที่ **เราสร้างเอง** ด้วยไลบรารี Python ได้ 126 ตามมาตรฐาน)
       ★ แปลว่า: อย่าเชื่อวันที่นี้ และ **ตอนเขียนไฟล์จริงต้องลอกค่าที่ Express ใช้ ไม่ใช่คิดเอง**
         ไบต์นี้จึงเป็นตัวชี้ที่ดีว่าไฟล์ไหน Express เขียน ไฟล์ไหนเราเขียน #>
  Write-Host ("  ไบต์วันที่ในหัวตาราง: {0} (อ่านแบบมาตรฐาน = {1})" -f $t.stampRaw, $t.lastUpdate) -NoNewline
  if ($t.stampYearByte -eq 126) { Write-Host '  <- ค่าแบบมาตรฐาน: ไฟล์นี้ไม่ได้เขียนโดย Express' -ForegroundColor Yellow }
  else { Write-Host '' }
  Write-Host ("  {0,-3} {1,-12} {2,-4} {3,5} {4,4} {5,6}  {6}" -f '#','ชื่อฟิลด์','ชนิด','ยาว','ทศ','ตำแหน่ง','ความหมาย')
  foreach ($f in $t.fields) {
    Write-Host ("  {0,-3} {1,-12} {2,-4} {3,5} {4,4} {5,6}  {6}" -f $f.no, $f.name, $f.type, $f.length, $f.dec, $f.offset, $f.meaning)
  }

  # ── ตรวจความสมบูรณ์: สามข้อนี้ผิดแปลว่าอ่านโครงผิด หรือไฟล์เสีย — อย่าเขียนทับเด็ดขาด ──
  if ($t.fieldSum -ne $t.recordLength) {
    Write-Host ("  ** ผลรวมความยาวฟิลด์ ({0}) ไม่เท่ากับความยาวแถวในหัวตาราง ({1}) **" -f $t.fieldSum, $t.recordLength) -ForegroundColor Red
  }
  if ($t.fileSize -lt ($t.expectedSize - 1)) {
    Write-Host ("  ** ไฟล์สั้นกว่าที่หัวตารางบอก (มี {0:N0} ไบต์ ควรมี {1:N0}) — ไฟล์อาจถูกตัด **" -f $t.fileSize, $t.expectedSize) -ForegroundColor Red
  }
  foreach ($f in $t.fields) {
    if ($f.type -eq 'B' -and $f.length -ne 8) {
      Write-Host ("  ** ฟิลด์ {0} ชนิด B แต่ยาว {1} ไบต์ (ปกติต้อง 8) **" -f $f.name, $f.length) -ForegroundColor Red
    }
    if (-not $FieldTypes.ContainsKey($f.type)) {
      Write-Host ("  ** ฟิลด์ {0} ชนิด '{1}' ไม่รู้จัก — ต้องตรวจก่อนเขียน **" -f $f.name, $f.type) -ForegroundColor Red
    }
  }
}

# ═══════════════ เก็บโครงทุกตาราง ═══════════════
if (-not (Test-Path -LiteralPath $Path)) { Write-Host "ไม่พบโฟลเดอร์ $Path" -ForegroundColor Red; exit 2 }

$found = @{}
$missing = @()

if ($AllTables) {
  $files = Get-ChildItem -LiteralPath $Path -Filter '*.dbf' -File | Sort-Object Name
} else {
  $files = @()
  foreach ($name in $Tables) {
    # Windows ไม่แยกตัวพิมพ์อยู่แล้ว แต่นามสกุลในของจริงมีทั้ง .DBF และ .dbf
    $hit = Get-ChildItem -LiteralPath $Path -Filter "$name.dbf" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { $files += $hit } else { $missing += $name }
  }
}

foreach ($f in $files) {
  $key = [IO.Path]::GetFileNameWithoutExtension($f.Name).ToUpper()
  try {
    $t = Read-DbfHeader -File $f.FullName
    $found[$key] = $t
    Write-TableReport -t $t -Name $key
  } catch {
    Write-Host ''
    Write-Host ("=== {0} ===" -f $key) -ForegroundColor Cyan
    Write-Host ("  ** อ่านไม่ได้: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

if ($missing.Count) {
  Write-Host ''
  Write-Host ("ไม่พบไฟล์ในโฟลเดอร์นี้: {0}" -f ($missing -join ', ')) -ForegroundColor Yellow
}

# ═══════════════ บันทึกแบบไว้เทียบ ═══════════════
if ($SaveBaseline) {
  <# ★ ตัดคอลัมน์ `meaning` (คำอธิบายภาษาไทยของชนิดฟิลด์) ออกก่อนบันทึก — มันมีไว้ให้คนอ่านบนจอ
     เก็บลงไฟล์ด้วยจะโตขึ้นสามเท่าโดยไม่ได้ใช้เทียบอะไรเลย และ diff ใน git อ่านไม่รู้เรื่อง #>
  $slim = @{}
  foreach ($k in $found.Keys) {
    $t = $found[$k]
    $slim[$k] = [pscustomobject]@{
      file = $t.file; fileSize = $t.fileSize; version = $t.version; versionName = $t.versionName
      stampRaw = $t.stampRaw; stampYearByte = $t.stampYearByte
      recordCount = $t.recordCount; headerLength = $t.headerLength; recordLength = $t.recordLength
      codepageByte = $t.codepageByte; codepage = $t.codepage; hasCdx = $t.hasCdx; hasMemo = $t.hasMemo
      <# ★ เก็บฟิลด์เป็นสตริงบรรทัดละตัว `ชื่อ|ชนิด|ยาว|ทศนิยม|ตำแหน่ง` แทน object
         — ไฟล์เล็กลง 10 เท่า และเวลาเทียบสองเวอร์ชันด้วย git diff จะเห็นเป็นบรรทัดต่อบรรทัด
         ว่าฟิลด์ไหนเปลี่ยน ซึ่งคือสิ่งที่เราจะทำกับไฟล์นี้จริงๆ #>
      fields = @($t.fields | ForEach-Object {
        '{0}|{1}|{2}|{3}|{4}' -f $_.name, $_.type, $_.length, $_.dec, $_.offset
      })
    }
  }
  $out = [pscustomobject]@{
    tool       = 'Get-DbfSchema.ps1'
    schema     = 1
    capturedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    machine    = $env:COMPUTERNAME
    source     = (Resolve-Path -LiteralPath $Path).Path
    tables     = $slim
  }
  $out | ConvertTo-Json -Depth 8 | Out-File -FilePath $SaveBaseline -Encoding utf8
  Write-Host ''
  Write-Host ("บันทึกแบบไว้ที่ {0}" -f $SaveBaseline) -ForegroundColor Green
}

# ═══════════════ เทียบกับแบบที่เก็บไว้ ═══════════════
if (-not $Baseline) { exit 0 }

if (-not (Test-Path -LiteralPath $Baseline)) { Write-Host "ไม่พบไฟล์แบบ $Baseline" -ForegroundColor Red; exit 2 }
$base = Get-Content -LiteralPath $Baseline -Raw -Encoding UTF8 | ConvertFrom-Json

<# แปลงฟิลด์ในไฟล์แบบกลับเป็น object — รองรับทั้งสองรูป: สตริง `ชื่อ|ชนิด|ยาว|ทศ|ตำแหน่ง` (รูปปัจจุบัน)
   และ object เต็ม (ไฟล์ที่เก็บด้วยสคริปต์รุ่นแรก — ของที่ส่งออกไปแล้วต้องยังเทียบได้) #>
function ConvertTo-FieldList {
  param($raw)
  @($raw | ForEach-Object {
    if ($_ -is [string]) {
      $p = $_ -split '\|'
      [pscustomobject]@{ name = $p[0]; type = $p[1]; length = [int]$p[2]; dec = [int]$p[3]; offset = [int]$p[4] }
    } else { $_ }
  })
}

Write-Host ''
Write-Host '════════ เทียบกับแบบที่เก็บไว้ ════════' -ForegroundColor Cyan
Write-Host ("แบบเดิม: {0} · เก็บเมื่อ {1} · จากเครื่อง {2}" -f $base.source, $base.capturedAt, $base.machine)
Write-Host ("ของจริง: {0} · เครื่อง {1}" -f (Resolve-Path -LiteralPath $Path).Path, $env:COMPUTERNAME)

$diffs = 0
$tableDiffs = 0
function Note { param([string]$m, [string]$c = 'Red') ; $script:diffs++ ; $script:tableDiffs++ ; Write-Host ("  {0}" -f $m) -ForegroundColor $c }

foreach ($p in $base.tables.PSObject.Properties) {
  $name = $p.Name
  $b = $p.Value
  Write-Host ''
  Write-Host ("-- {0} --" -f $name)
  $tableDiffs = 0
  $bFields = ConvertTo-FieldList $b.fields
  if (-not $found.ContainsKey($name)) { Note ("ไม่มีตารางนี้บนเครื่องนี้ (แบบเดิมมี {0} ฟิลด์)" -f $bFields.Count) ; continue }
  $c = $found[$name]

  if ($b.recordLength -ne $c.recordLength) { Note ("ความยาวแถวต่างกัน: แบบเดิม {0} · ของจริง {1}" -f $b.recordLength, $c.recordLength) }
  if ($b.codepageByte -ne $c.codepageByte) { Note ("รหัสหน้าต่างกัน: แบบเดิม {0} · ของจริง {1}" -f $b.codepage, $c.codepage) }
  if ($b.version -ne $c.version) { Note ("เวอร์ชันตารางต่างกัน: 0x{0:X2} -> 0x{1:X2}" -f $b.version, $c.version) 'Yellow' }

  $bNames = @($bFields | ForEach-Object { $_.name })
  $cNames = @($c.fields | ForEach-Object { $_.name })
  foreach ($n in $bNames) { if ($cNames -notcontains $n) { Note ("ฟิลด์ที่หายไป: {0}" -f $n) } }
  foreach ($n in $cNames) { if ($bNames -notcontains $n) { Note ("ฟิลด์ที่เพิ่มมาใหม่: {0}" -f $n) } }

  $shifted = @()
  foreach ($bf in $bFields) {
    $cf = $c.fields | Where-Object { $_.name -eq $bf.name } | Select-Object -First 1
    if (-not $cf) { continue }
    if ($bf.type -ne $cf.type -or $bf.length -ne $cf.length -or $bf.dec -ne $cf.dec) {
      Note ("{0}: {1}({2},{3}) -> {4}({5},{6})" -f $bf.name, $bf.type, $bf.length, $bf.dec, $cf.type, $cf.length, $cf.dec)
    } elseif ($bf.offset -ne $cf.offset) {
      # ชนิด/ความยาวเท่ากันแต่ตำแหน่งขยับ = เขียนลงผิดช่วงไบต์ทั้งแถว
      $shifted += $bf.name
    }
  }
  <# ★ ฟิลด์เดียวที่ยาวขึ้น ทำให้ฟิลด์ที่เหลือ "ขยับ" ตามกันหมด — ถ้ารายงานทีละตัวจะได้ 28 บรรทัด
     จากต้นเหตุเดียว แล้วบรรทัดที่สำคัญจริงจมหายไป · รวบเป็นบรรทัดเดียวพร้อมตัวอย่างตัวแรก #>
  if ($shifted.Count) {
    Note ("อีก {0} ฟิลด์ตำแหน่งในแถวขยับตามกัน (ตัวแรกคือ {1}) — เกิดจากความยาวที่เปลี่ยนข้างบน" -f $shifted.Count, $shifted[0])
  }
  if ($tableDiffs -eq 0) { Write-Host '  เหมือนกันทุกฟิลด์' -ForegroundColor Green }
}

# ตารางที่เครื่องนี้มีแต่แบบเดิมไม่มี — ไม่ใช่เรื่องผิด แต่ต้องรู้ว่ายังไม่เคยตรวจ
$baseNames = @($base.tables.PSObject.Properties.Name)
foreach ($k in $found.Keys) {
  if ($baseNames -notcontains $k) {
    Write-Host ''
    Write-Host ("-- {0} --" -f $k)
    Write-Host '  มีบนเครื่องนี้แต่ไม่มีในแบบที่เก็บไว้ (ยังไม่เคยเทียบ)' -ForegroundColor Yellow
  }
}

Write-Host ''
if ($diffs -eq 0) {
  Write-Host 'สรุป: โครงตรงกับแบบที่เก็บไว้ทุกตาราง — เขียนไฟล์ตามโครงเดิมได้' -ForegroundColor Green
  exit 0
} else {
  Write-Host ("สรุป: พบจุดต่าง {0} จุด — **ห้ามใช้โครงเดิมเขียนไฟล์** ต้องแก้ตัวสร้างไฟล์ให้ตรงกับเครื่องนี้ก่อน" -f $diffs) -ForegroundColor Red
  exit 1
}
