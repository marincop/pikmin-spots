# 🍀 皮克敏純點地圖 (Pikmin Bloom Pure Spots)

用 [pikdecor.com](https://pikdecor.com/spots) 玩家社群回報的純點資料做成的離線互動地圖。

- **`app/`** — 手機 PWA 版（Leaflet + MarkerCluster，可「加入主畫面」離線使用）
- **`map/`** — 桌機版單檔地圖

## 本機執行

```bash
cd app && python3 -m http.server 8791   # 開 http://127.0.0.1:8791
node test.mjs                          # 30 項邏輯驗證
```

## 部署

Coolify（Dockerfile / nginx）→ https://pikmin.marincop-ai.com
PWA 需要 HTTPS 才能註冊 service worker / 加入主畫面。

## 資料來源

純點資料：pikdecor.com 玩家社群（本站為第三方工具，與 Nintendo/Niantic 無關）。
圖磚：OpenStreetMap contributors (ODbL)。
