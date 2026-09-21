#!/bin/bash
# 皮克敏純點地圖 — iOS (Capacitor) 打包上 TestFlight 用
# 手動簽章：明確指定 iPhone Distribution 身分 + App Store profile，
# 避免 Xcode 自動簽章去要 Apple Development 憑證。
#
# 用法（必須在圖形 session 跑，見 run-gui.sh）：
#   bash ios-app/build-ipa.sh
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$PROJ_DIR")"
cd "$PROJ_DIR"

LOGIN_KC="$HOME/Library/Keychains/login.keychain-db"
TEAM="8NSAMAHQF3"
IDENTITY="iPhone Distribution: SHIH WEI CHEN (8NSAMAHQF3)"
PROFILE_NAME="PureSpotMap App Store"
BUNDLE_ID="com.marincop.purespotmap"
ARCHIVE="build/purespotmap.xcarchive"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { echo ""; echo "▶ $*"; }

echo "═══════════════════════════════════════════════"
echo "  純點地圖 iOS — 打包（manual signing / App Store）"
echo "═══════════════════════════════════════════════"

say "① 同步 www（app/ → ios-app/www，CDN 連結換成本地 vendor）"
mkdir -p www
rsync -a --exclude 'vendor/' "$REPO_DIR/app/" www/
mkdir -p www/vendor
rsync -a src-ios/vendor/ www/vendor/
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('www/index.html')
s = p.read_text(encoding='utf-8')
for a, b in [
 (r'https://unpkg\.com/leaflet@1\.9\.4/dist/leaflet\.css', 'vendor/leaflet/leaflet.css'),
 (r'https://unpkg\.com/leaflet\.markercluster@1\.5\.3/dist/MarkerCluster\.css', 'vendor/markercluster/MarkerCluster.css'),
 (r'https://unpkg\.com/leaflet\.markercluster@1\.5\.3/dist/MarkerCluster\.Default\.css', 'vendor/markercluster/MarkerCluster.Default.css'),
 (r'https://unpkg\.com/leaflet@1\.9\.4/dist/leaflet\.js', 'vendor/leaflet/leaflet.js'),
 (r'https://unpkg\.com/leaflet\.markercluster@1\.5\.3/dist/leaflet\.markercluster\.js', 'vendor/markercluster/leaflet.markercluster.js'),
]:
    s = re.sub(a, b, s)
p.write_text(s, encoding='utf-8')
print('  index.html: CDN → vendor ✅')
PY

# 原生 Apple 地圖介面層：esbuild 打包成 www/vendor/apple-maps.js（web 版不會載入這支）
if [ -f src-ios/mapkit-adapter.js ]; then
  npx esbuild src-ios/mapkit-adapter.js --bundle --format=iife --target=safari15 \
    --outfile=www/vendor/apple-maps.js --log-level=warning
  python3 - <<'PY'
import pathlib
p = pathlib.Path('www/index.html')
s = p.read_text(encoding='utf-8')
tag = '<script src="vendor/apple-maps.js"></script>\n'
if tag not in s:
    s = s.replace('<script src="data/spots.js', tag + '<script src="data/spots.js', 1)
    p.write_text(s, encoding='utf-8')
    print('  www/index.html: 已注入 apple-maps adapter ✅')
PY
  echo "  MapKit adapter 打包完成（$(du -h www/vendor/apple-maps.js | cut -f1)）"
fi
npx cap copy ios 2>&1 | tail -3

say "② 檢查簽章身分"
security find-identity -v -p codesigning "$LOGIN_KC" | sed 's/^/  /'
if ! security find-identity -v -p codesigning "$LOGIN_KC" | grep -q "iPhone Distribution"; then
  echo "  ❌ 找不到 iPhone Distribution 身分（keychain 沒解鎖？）"; exit 1
fi

say "③ Archive（Release / generic iOS device，約 3-10 分鐘）"
rm -rf "$ARCHIVE"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$IDENTITY" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" \
  DEVELOPMENT_TEAM="$TEAM" \
  OTHER_CODE_SIGN_FLAGS="--keychain $LOGIN_KC" \
  archive > /tmp/pikmin_archive.log 2>&1 || {
    echo "  ❌ 編譯失敗："; grep -E "error:" /tmp/pikmin_archive.log | head -10 | sed 's/^/    /'
    echo "  （完整 log: /tmp/pikmin_archive.log）"; exit 1; }
echo "  ✅ ARCHIVE 完成"

say "④ 匯出 .ipa"
mkdir -p build/ipa
cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key>
  <dict><key>$BUNDLE_ID</key><string>$PROFILE_NAME</string></dict>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST
rm -rf build/ipa && mkdir -p build/ipa
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/ipa \
  -allowProvisioningUpdates > /tmp/pikmin_export.log 2>&1 || {
    echo "  ❌ 匯出失敗："; grep -E "error:" /tmp/pikmin_export.log | head -8 | sed 's/^/    /'
    echo "  （完整 log: /tmp/pikmin_export.log）"; exit 1; }

IPA=$(find build/ipa -name "*.ipa" | head -1)
echo "  ✅ 匯出完成：$PROJ_DIR/$IPA"
ls -lh "$IPA"
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ IPA 好了 → $(pwd)/$IPA"
echo "═══════════════════════════════════════════════"
