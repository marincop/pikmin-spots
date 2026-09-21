# 純點地圖 iOS（Capacitor 殼）

皮克敏純點地圖的手機殼。**網頁資產的來源是 repo 根目錄的 `app/`**（web/PWA 與 iOS 共用同一份程式碼），這個目錄只放「殼」跟打包腳本。

## 一鍵打包（產出可上 TestFlight 的 IPA）

```bash
# 建議：丟進圖形 session 跑（我的 exec 在背景 session，keychain 看不到簽章身分）
bash ios-app/run-gui.sh

# 或直接在 Mac 的圖形 Terminal：
bash ios-app/build-ipa.sh
```

產出：`ios-app/build/ipa/App.ipa`

## build-ipa.sh 做了什麼

1. `../app/` → `www/`（rsync，排除 vendor）
2. `src-ios/vendor/` → `www/vendor/`（離線 leaflet + markercluster）
3. `www/index.html` 的 unpkg CDN 連結 → 本地 `vendor/`
4. esbuild 打包 `src-ios/mapkit-adapter.js` → `www/vendor/apple-maps.js`，並注入 script tag
5. `npx cap copy ios` → `xcodebuild archive`（manual signing）→ 匯出 app-store-connect 的 IPA

`www/`、`build/`、`ios/App/App/public/` 都是**產物**，已 gitignore，不要手改。

## 雙軌地圖層

| 平台 | 地圖 |
|---|---|
| iOS App | **原生 Apple 地圖（MapKit）** — `capacitor-plugin-apple-maps`，不需 API key |
| web / PWA / 其他平台 | Leaflet + OpenStreetMap |

分流判斷：`window.AppleMapsAdapter`（只有 iOS 殼會載入 `vendor/apple-maps.js`）。

⚠️ **MapKit 的關鍵坑**：外掛一定要用 `<capacitor-apple-map>` 自訂元素才會 mount
（它靠 `WKChildScrollView` + 元素內 200% 高 spacer 的 `contentSize` 兩倍比對找容器，
普通 `<div>` 永遠掛不上去）。`mapkit-adapter.js` 的 `init()` 會自動把 `#map` 換掉。

## 簽章 / 上傳

- 身分：`iPhone Distribution: SHIH WEI CHEN (8NSAMAHQF3)`
- Profile：`PureSpotMap App Store`（用 App Store Connect API 建立）
- 上傳：`xcrun altool --upload-app -f build/ipa/App.ipa -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER>`
  （⚠️ `--apiKey` 的值一定要加引號，zsh 會把 `***` 當 glob 展開）
- 憑證一律不進 repo（`.gitignore` 已擋 `*.p8` / `*.p12` / `*.mobileprovision` / `private_keys/`）；
  手動簽章密碼走 macOS keychain / 1Password

## 相依

- Capacitor 8.5.2（JS 與原生 SPM 版本必須一致，先前錯開過一次）
- `@capacitor/geolocation`（定位；`Info.plist` 需 `NSLocationWhenInUseUsageDescription`）
- `capacitor-plugin-apple-maps` 0.5.4（iOS 15+）
