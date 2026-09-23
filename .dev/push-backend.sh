#!/usr/bin/env bash
# ใช้: .dev/push-backend.sh dev|uat|prod   (รันที่ root ของ repo)
#
# สภาพแวดล้อมที่มีจริงตอนนี้ (2026-09-23):
#   dev  → Apps Script "salesranger-TOPSHOP-be(dev)"  1iVJDVuc…  (backend/.clasp.dev.json) — ของเจ้าของระบบใช้เอง
#   uat  → Apps Script "salesranger-TOPSHOP-be(uat)"  1SDBJgSN…  (backend/.clasp.uat.json) — ที่แอปนี้ใช้ทดสอบ
#   prod → **ยังไม่มีโปรเจกต์** — สร้างเมื่อไหร่ค่อยใส่ backend/.clasp.prod.json แล้วสคริปต์นี้จะใช้ได้เอง
#
# เดิมสคริปต์นี้ใช้คำว่า prod กับโปรเจกต์ 1iVJ ซึ่งที่จริงคือ dev — แก้แล้ว อย่าเอากลับ
# ทุกสภาพแวดล้อม push จากโฟลเดอร์ชั่วคราว และ "ไม่ส่ง" script_properties.gs (มี secret) ขึ้นไป
set -e
ENVNAME="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

push_with() {   # $1 = ไฟล์ .clasp.*.json ที่จะใช้
  local cfg="$1"
  if [ ! -f "$cfg" ]; then echo "ไม่พบไฟล์ตั้งค่า: $cfg"; exit 1; fi
  local TMP; TMP="$(mktemp -d)"
  cp "$ROOT"/backend/*.gs "$ROOT/backend/appsscript.json" "$TMP"/
  rm -f "$TMP/script_properties.gs"
  cp "$cfg" "$TMP/.clasp.json"
  echo "→ push ขึ้นโปรเจกต์: $(grep -o '"scriptId": "[^"]*"' "$cfg")"
  (cd "$TMP" && clasp push --force)
  rm -rf "$TMP"
}

case "$ENVNAME" in
  dev)  push_with "$ROOT/backend/.clasp.dev.json" ;;
  uat)  push_with "$ROOT/backend/.clasp.uat.json" ;;
  prod)
    if [ -f "$ROOT/backend/.clasp.prod.json" ]; then
      push_with "$ROOT/backend/.clasp.prod.json"
    else
      echo "❌ ยังไม่มีสภาพแวดล้อม production — ตอนนี้มีแค่ dev กับ uat"
      echo "   ถ้าสร้างโปรเจกต์ Apps Script ของ production แล้ว ให้สร้าง backend/.clasp.prod.json"
      echo "   ({\"scriptId\":\"<id ของโปรเจกต์ production>\",\"rootDir\":\".\"}) แล้วรันคำสั่งนี้ใหม่"
      exit 1
    fi ;;
  *) echo "ใช้: $0 dev|uat|prod"; exit 1 ;;
esac
