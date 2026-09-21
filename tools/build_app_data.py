#!/usr/bin/env python3
"""合併 pikdecor(app/data/spots.js) + talllkai 純點，輸出精簡版 app/data/spots.js。

- 以 pikdecor 資料為底（欄位較完整）
- 併入 talllkai 未被涵蓋的點（座標 4 位小數去重）
- talllkai 類型名稱統一成我們既有的 category_label（避免選單出現重複項）
- 輸出精簡欄位（只留前端用得到的）以控制檔案大小

用法：python3 tools/build_app_data.py
"""
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
          "lat", "lng", "confirms", "issues", "created_at")


def load_pikdecor(path):
    txt = open(path, encoding="utf-8").read()
    return json.loads(re.sub(r"^window\.PIKMIN_SPOTS\s*=\s*", "", txt).strip().rstrip(";"))


def slim(s):
    return {k: s.get(k) for k in FIELDS if k in s}


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
        })
        added += 1

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
