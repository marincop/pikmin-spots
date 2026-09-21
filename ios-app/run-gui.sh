#!/bin/bash
# 在「圖形 session (gui/501)」裡跑 build-ipa.sh。
# 為什麼要這樣：我的 exec 跑在背景 session，keychain 搜尋清單只有 System.keychain
# → codesign 找不到 iPhone Distribution 憑證。掛臨時 LaunchAgent 讓指令跑在
# 老闆已登入的 GUI session 就正常（2026-09-16 stockwall 學到的招）。
set -euo pipefail

PROJ="/Users/albert/.openclaw/workspace/pikmin-spots/ios-app"
PLIST="/tmp/pikmin_build_agent.plist"
LABEL="com.albert.pikminbuild"
UID_NUM=$(id -u)

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>exec bash "$PROJ/build-ipa.sh"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/pikmin_build_run.log</string>
  <key>StandardErrorPath</key><string>/tmp/pikmin_build_run.err</string>
  <key>EnvironmentVariables</key>
  <dict><key>HOME</key><string>$HOME</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict>
</plist>
PLIST

: > /tmp/pikmin_build_run.log
: > /tmp/pikmin_build_run.err
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
echo "✅ 已丟進 GUI session 執行（label $LABEL）"
echo "   log: /tmp/pikmin_build_run.log"
