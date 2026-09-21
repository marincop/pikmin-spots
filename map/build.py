#!/usr/bin/env python3
"""把 pikdecor 純點資料轉成 CSV / GeoJSON / 前端可直接載入的 JS 資料檔。

用法:
    python3 build.py            # 讀 data/raw-spots.json
    python3 build.py other.json # 指定來源
輸出:
    data/spots.csv
    data/spots.geojson
    data/spots.js   (window.PIKMIN_SPOTS = [...]；給 file:// 直接開的 index.html 用)
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/raw-spots.json"
DATA = ROOT / "data"

# 中文類別標籤（對照 pikdecor 前端的分類定義）
CATEGORY_LABELS = {
    "restaurant": "🍽️ 餐廳", "cafe": "☕ 咖啡店", "sweetshop": "🍩 甜點店",
    "hamburger": "🍔 漢堡店", "sushi": "🍣 壽司店", "italian": "🍕 義式餐廳",
    "ramen": "🍜 拉麵店", "curry": "🍛 咖哩餐廳", "mexican": "🌮 墨西哥餐廳",
    "korean": "🥬 韓式餐廳", "bakery": "🥖 麵包店", "supermarket": "🍌 超市",
    "minimart": "🏪 便利商店", "clothesstore": "👗 服飾店", "hairsalon": "✂️ 美容院",
    "makeup": "💄 化妝品商店", "pharmacy": "💊 藥局", "electronics": "🔋 電器行",
    "diy": "🔧 五金行", "cheese": "🧀 起司店", "airport": "✈️ 機場",
    "station": "🚂 車站", "bus": "🚌 公車站", "bridge": "🌉 橋梁",
    "roadside": "🪙 路邊", "forest": "🌲 森林", "waterside": "🎣 水邊",
    "beach": "🐚 海灘", "mountain": "⛰️ 山丘", "park": "🍀 公園",
    "movie": "🎬 電影院", "artgallery": "🎨 美術館", "library": "📚 圖書館/書店",
    "stationery": "✏️ 文具", "zoo": "🦁 動物園", "aquarium": "🐠 水族館",
    "themePark": "🎢 主題樂園", "stadium": "🏟️ 體育館", "postoffice": "📮 郵局",
    "shrine": "⛩️ 神社/寺廟", "hotel": "🏨 飯店", "university": "🎓 大學/學院",
    "laundry": "👕 自助洗衣店",
}

FIELDS = ["id", "name", "category", "category_label", "region", "address",
          "lat", "lng", "status", "confirms", "issues", "created_at",
          "verified_at", "last_confirmed_at", "description"]


def load():
    raw = json.loads(SRC.read_text(encoding="utf-8"))
    spots = raw["spots"] if isinstance(raw, dict) else raw
    out = []
    for s in spots:
        lat, lng = s.get("lat"), s.get("lng")
        if lat is None or lng is None:
            continue
        cat = s.get("category") or ""
        out.append({
            "id": s["id"],
            "name": (s.get("name") or "").strip(),
            "category": cat,
            "category_label": CATEGORY_LABELS.get(cat, cat),
            "region": (s.get("region") or "").strip(),
            "address": (s.get("address") or "").strip(),
            "lat": float(lat),
            "lng": float(lng),
            "status": s.get("status") or "",
            "confirms": s.get("confirms") or 0,
            "issues": s.get("issues") or 0,
            "created_at": s.get("created_at") or "",
            "verified_at": s.get("verified_at") or "",
            "last_confirmed_at": s.get("last_confirmed_at") or "",
            "description": s.get("description") or "",
        })
    out.sort(key=lambda x: x["id"], reverse=True)
    return out


def write_csv(rows):
    p = DATA / "spots.csv"
    with p.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    return p


def write_geojson(rows):
    fc = {
        "type": "FeatureCollection",
        "name": "pikmin_pure_spots",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]},
            "properties": {k: r[k] for k in FIELDS if k not in ("lat", "lng")},
        } for r in rows],
    }
    p = DATA / "spots.geojson"
    p.write_text(json.dumps(fc, ensure_ascii=False, indent=1), encoding="utf-8")
    return p


def write_js(rows):
    p = DATA / "spots.js"
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    p.write_text(f"window.PIKMIN_SPOTS = {payload};\n", encoding="utf-8")
    return p


if __name__ == "__main__":
    rows = load()
    for p in (write_csv(rows), write_geojson(rows), write_js(rows)):
        print(f"wrote {p.relative_to(ROOT)}  ({p.stat().st_size:,} bytes)")
    print(f"{len(rows)} spots")
