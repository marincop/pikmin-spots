# 🍀 皮克敏純點地圖 (Pikmin Bloom Pure Spots Map)

用 [pikdecor.com](https://pikdecor.com/spots) 的純點資料做成的離線互動地圖。
目前收錄 **2655** 個已驗證純點（台灣為主，含港/日/美/歐等海外點）。

## 快速開始

```bash
# 1) 起本機 server（Leaflet 與圖磚走 CDN，需要網路；資料本身已離線打包）
python3 -m http.server 8791
# 開 http://127.0.0.1:8791/index.html
```

> 也可以直接雙擊 `index.html`（資料用 `data/spots.js` 內嵌，`file://` 可開），
> 但 `file://` 下部分瀏覽器會擋 CDN，建議用上面的 server。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` | 互動地圖（Leaflet + MarkerCluster，單檔、無 build step） |
| `build.py` | 把 `data/raw-spots.json` 轉出 CSV / GeoJSON / JS |
| `test.mjs` | 資料與篩選邏輯的驗證（`node test.mjs`，16 項檢查） |
| `data/raw-spots.json` | 從 API 抓下來的原始資料 |
| `data/spots.csv` | 試算表用（UTF-8 BOM，Excel 開中文不掉字） |
| `data/spots.geojson` | GIS 用（QGIS / geojson.io / Mapbox 直接吃） |
| `data/spots.js` | 前端載入用（`window.PIKMIN_SPOTS`） |

## 更新資料

```bash
curl -s -H 'Referer: https://pikdecor.com/spots' -H 'Origin: https://pikdecor.com' \
     -H 'User-Agent: Mozilla/5.0' \
     'https://pikdecor.com/api/pure-spots?limit=100000' -o data/raw-spots.json
python3 build.py && node test.mjs
```

## 地圖功能

- 🔍 搜尋名稱 / 地址 / 縣市 / 類別
- 類別、地區下拉篩選（帶數量）
- 排序：最新收錄 / 確認數 / 名稱
- 只看「有名稱」或「有人確認過」的點
- 叢集顯示（縮到 z15 自動展開），點列表可飛到該點開 popup
- popup 內附「Google Maps 開啟」與 pikdecor 原始頁連結

## 資料來源與授權

- 純點資料：pikdecor.com 玩家社群回報（本站為第三方工具，與 Nintendo/Niantic 無關）
- 圖磚：OpenStreetMap contributors（ODbL）
- 座標系統：WGS84
