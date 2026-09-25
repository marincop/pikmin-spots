#!/usr/bin/env python3
"""合併 pikdecor(app/data/spots.js) + talllkai 純點，輸出精簡版 app/data/spots.js。

- 以 pikdecor 資料為底（欄位較完整）
- 併入 talllkai 未被涵蓋的點（座標 4 位小數去重）
- talllkai 類型名稱統一成我們既有的 category_label（避免選單出現重複項）
- 輸出精簡欄位（只留前端用得到的）以控制檔案大小

用法：python3 tools/build_app_data.py
"""
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from fetch_talllkai import fetch_html, extract_json  # noqa: E402

# talllkai 的 Type -> 我們的 category_label（統一命名，圖示沿用我們的）
TYPE_MAP = {
    "公車站": "🚌 公車站",
    "公園": "🍀 公園",
    "便利店": "🏪 便利商店",
    "路邊": "🪙 路邊",
    "餐廳": "🍽️ 餐廳",
    "森林": "🌲 森林",
    "水邊": "🎣 水邊",
    "超市": "🍌 超市",
    "橋樑": "🌉 橋梁",
    "咖啡杯": "☕ 咖啡店",
    "拉麵店": "🍜 拉麵店",
    "服裝店": "👗 服飾店",
    "郵局": "📮 郵局",
    "大學&學院": "🎓 大學/學院",
    "車站": "🚂 車站",
    "飯店": "🏨 飯店",
    "藥局": "💊 藥局",
    "圖書館": "📚 圖書館/書店",
    "電器行": "🔋 電器行",
    "海灘": "🐚 海灘",
    "五金行": "🔧 五金行",
    "機場": "✈️ 機場",
    "麵包店": "🥖 麵包店",
    "山丘": "⛰️ 山丘",
    "文具店": "✏️ 文具",
    "美容院": "✂️ 美容院",
    "體育館": "🏟️ 體育館",
    "自助洗衣店&乾洗店": "👕 自助洗衣店",
    "義式餐廳": "🍕 義式餐廳",
    "主題樂園": "🎢 主題樂園",
    "壽司": "🍣 壽司店",
    "甜點店": "🍩 甜點店",
    "美術館": "🎨 美術館",
    "神社和寺廟": "⛩️ 神社/寺廟",
    "漢堡": "🍔 漢堡店",
    "韓國餐廳": "🥬 韓式餐廳",
    "電影院": "🎬 電影院",
    "化妝品": "💄 化妝品商店",
    "動物園": "🦁 動物園",
    "咖哩": "🍛 咖哩餐廳",
    "墨西哥餐廳": "🌮 墨西哥餐廳",
}

FIELDS = ("id", "name", "category_label", "region", "address",
          "lat", "lng", "confirms", "issues", "created_at", "status")

# OSM category slug -> 我們既有的 category_label（供 candidate 圖層用）
SLUG_LABEL = {
    "park": "\U0001f340 公園", "bus": "\U0001f68c 公車站", "minimart": "\U0001f3ea 便利商店",
    "restaurant": "\U0001f37d\ufe0f 餐廳", "forest": "\U0001f332 森林", "waterside": "\U0001f3a3 水邊",
    "supermarket": "\U0001f34c 超市", "bridge": "\U0001f309 橋梁", "cafe": "\u2615 咖啡店",
    "ramen": "\U0001f35c 拉麵店", "clothesstore": "\U0001f457 服飾店", "postoffice": "\U0001f4ee 郵局",
    "university": "\U0001f393 大學/學院", "station": "\U0001f682 車站", "hotel": "\U0001f3e8 飯店",
    "library": "\U0001f4da 圖書館/書店", "airport": "\u2708\ufe0f 機場", "electronics": "\U0001f50b 電器行",
    "pharmacy": "\U0001f48a 藥局", "diy": "\U0001f527 五金行", "beach": "\U0001f41a 海灘",
    "bakery": "\U0001f956 麵包店", "stadium": "\U0001f3df\ufe0f 體育館", "hairsalon": "\u2702\ufe0f 美容院",
    "laundry": "\U0001f455 自助洗衣店", "mountain": "\u26f0\ufe0f 山丘", "stationery": "\u270f\ufe0f 文具",
    "italian": "\U0001f355 義式餐廳", "sushi": "\U0001f363 壽司店", "themePark": "\U0001f3a2 主題樂園",
    "sweetshop": "\U0001f369 甜點店", "artgallery": "\U0001f3a8 美術館", "korean": "\U0001f96c 韓式餐廳",
    "shrine": "\u26e9\ufe0f 神社/寺廟", "hamburger": "\U0001f354 漢堡店", "movie": "\U0001f3ac 電影院",
    "curry": "\U0001f35b 咖哩餐廳", "makeup": "\U0001f484 化妝品商店", "zoo": "\U0001f981 動物園",
}


def load_osm_candidates():
    """可選：讀 map/data/osm_candidates.json[.gz]（OSM 候選點）。"""
    for p in (os.path.join(ROOT, "map/data/osm_candidates.json.gz"),
              os.path.join(ROOT, "map/data/osm_candidates.json")):
        if os.path.exists(p):
            text = (gzip.open(p, "rt", encoding="utf-8").read()
                    if p.endswith(".gz") else open(p, encoding="utf-8").read())
            data = json.loads(text)
            return (data["spots"] if isinstance(data, dict) else data), p
    return [], None


def load_pikdecor(path):
    txt = open(path, encoding="utf-8").read()
    return json.loads(re.sub(r"^window\.PIKMIN_SPOTS\s*=\s*", "", txt).strip().rstrip(";"))


def slim(s):
    d = {k: s.get(k) for k in FIELDS if k in s}
    d["status"] = s.get("status") or "verified"   # 舊資料一律視為 verified
    return d


def main():
    path = os.path.join(ROOT, "app/data/spots.js")
    base = load_pikdecor(path)
    theirs = extract_json(fetch_html())

    key = lambda a, b: f"{round(float(a), 4)},{round(float(b), 4)}"  # noqa: E731
    seen = {key(s["lat"], s["lng"]) for s in base}
    out = [slim(s) for s in base]
    added = 0
    unmapped = set()
    for s in theirs:
        k = key(s["Lat"], s["Lon"])
        if k in seen:
            continue
        seen.add(k)
        label = TYPE_MAP.get(s["Type"])
        if not label:
            label = (s.get("Icon") or "") + " " + s["Type"]
            unmapped.add(s["Type"])
        out.append({
            "id": 100000 + int(s["Id"]),
            "name": s.get("Name") or "",
            "category_label": label,
            "region": (s.get("City") or "") + (s.get("District") or ""),
            "address": "",
            "lat": round(float(s["Lat"]), 6),
            "lng": round(float(s["Lon"]), 6),
            "confirms": int(s.get("Good") or 0),
            "issues": 0,
            "created_at": s.get("UpdateDate") or "",
            "status": "verified",
        })
        added += 1

    # ── OSM 候選點（可選；status=candidate，不影響既有 verified）──
    cand, cpath = load_osm_candidates()
    cadded = 0
    if cand:
        for s in cand:
            try:
                k = key(s["lat"], s["lng"])
            except Exception:
                continue
            if k in seen:
                continue
            label = SLUG_LABEL.get(s.get("category"))
            if not label:
                continue
            seen.add(k)
            out.append({
                "id": 200000 + len(out),
                "name": s.get("name") or "",
                "category_label": label,
                "region": s.get("region") or "",
                "address": s.get("address") or "",
                "lat": round(float(s["lat"]), 6),
                "lng": round(float(s["lng"]), 6),
                "confirms": 0,
                "issues": 0,
                "created_at": s.get("created_at") or "",
                "status": "candidate",
            })
            cadded += 1
        print(f"osm candidates（{cpath}）：新增 {cadded} 筆 candidate")

    js = "window.PIKMIN_SPOTS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";"
    open(path, "w", encoding="utf-8").write(js)

    labels = {}
    for s in out:
        labels[s["category_label"]] = labels.get(s["category_label"], 0) + 1
    print(f"base={len(base)}  added={added}  total={len(out)}  size={len(js)/1e6:.2f}MB  labels={len(labels)}")
    if unmapped:
        print("UNMAPPED types:", sorted(unmapped))


if __name__ == "__main__":
    main()
