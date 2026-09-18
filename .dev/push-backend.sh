#!/usr/bin/env bash
# ใช้: .dev/push-backend.sh uat|prod   (รันที่ root ของ repo)
#  prod → clasp push จาก backend/ ตรงๆ (.clasp.json)
#  uat  → คัดลอกโค้ดไปโฟลเดอร์ชั่วคราว "ไม่เอา script_properties.gs" (มี secret + Sheet ID ของ production)
#         แล้ว push ขึ้นโปรเจกต์ UAT (.clasp.uat.json) — กัน UAT ไปชี้ข้อมูลจริงโดยไม่ตั้งใจ
set -e
ENVNAME="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$ENVNAME" in
  prod)
    cd "$ROOT/backend" && clasp push --force ;;
  uat)
    TMP="$(mktemp -d)"
    cp "$ROOT"/backend/*.gs "$ROOT/backend/appsscript.json" "$TMP"/
    rm -f "$TMP/script_properties.gs"
    cp "$ROOT/backend/.clasp.uat.json" "$TMP/.clasp.json"
    cd "$TMP" && clasp push --force
    rm -rf "$TMP" ;;
  *) echo "ใช้: $0 uat|prod"; exit 1 ;;
esac
