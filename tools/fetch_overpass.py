#!/usr/bin/env python3
"""用 OpenStreetMap (Overpass API) 產生「皮克敏純點」候選點。

Pikmin Bloom 的裝飾類型本質上就是 POI 類別，所以可以從 OSM 批次撈出候選點，
標成 status="candidate" 後再由社群 confirms/issues 驗證 —— 省掉大量人工找點。

用法：
    python3 fetch_overpass.py --area "嘉義市" --categories park,postoffice,library
    python3 fetch_overpass.py --bbox 23.44,120.40,23.52,120.50 --categories cafe
    python3 fetch_overpass.py --area "嘉義市" --all -o candidates.json
    python3 fetch_overpass.py --list-categories

輸出格式與 map/data/raw-spots.json 相同（{"spots": [...]}），可直接餵給 merge/build。
⚠️ 資料來源為 OpenStreetMap（ODbL）→ 使用時須標示來源，衍生資料庫需以 ODbL 釋出。
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

UA = "pikmin-spots-overpass/1.0 (https://pikmin.marincop-ai.com)"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Overpass 主站常 504（忙）→ 依序重試鏡像站
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# 你的 category slug → OSM 查詢（(tag_key, tag_value) 或 (tag_key, None, 值清單)）
CATEGORY_TAGS = {
    "park": [("leisure", "park")],
    "bus": [("highway", "bus_stop")],
    "forest": [("landuse", "forest"), ("natural", "wood")],
    "restaurant": [("amenity", "restaurant")],
    "minimart": [("shop", "convenience")],
    "waterside": [("natural", "water"), ("waterway", "riverbank")],
    "supermarket": [("shop", "supermarket")],
    "cafe": [("amenity", "cafe")],
    "ramen": [("cuisine", "ramen")],
    "bridge": [("man_made", "bridge")],
    "clothesstore": [("shop", "clothes")],
    "airport": [("aeroway", "aerodrome")],
    "postoffice": [("amenity", "post_office")],
    "electronics": [("shop", "electronics")],
    "library": [("amenity", "library")],
    "university": [("amenity", "university"), ("amenity", "college")],
    "diy": [("shop", "doityourself")],
    "hairsalon": [("shop", "hairdresser")],
    "laundry": [("shop", "laundry")],
    "station": [("railway", "station"), ("railway", "halt")],
    "stadium": [("leisure", "stadium")],
    "hotel": [("tourism", "hotel")],
    "pharmacy": [("amenity", "pharmacy")],
    "bakery": [("shop", "bakery")],
    "beach": [("natural", "beach")],
    "sweetshop": [("shop", "confectionery")],
    "italian": [("cuisine", "italian")],
    "artgallery": [("tourism", "gallery")],
    "sushi": [("cuisine", "sushi")],
    "korean": [("cuisine", "korean")],
    "mountain": [("natural", "peak")],
    "themePark": [("tourism", "theme_park")],
    "stationery": [("shop", "stationery")],
    "movie": [("amenity", "cinema")],
    "shrine": [("amenity", "place_of_worship")],
    "hamburger": [("cuisine", "burger")],
    "curry": [("cuisine", "curry")],
    "makeup": [("shop", "cosmetics")],
    "zoo": [("tourism", "zoo")],
}
# roadside 沒有對應的 OSM 類別（依實際情況由社群回報）


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def geocode(area):
    q = urllib.parse.urlencode({"q": area, "format": "json", "limit": 1})
    data = http_get(f"{NOMINATIM}?{q}", timeout=30)
    if not data:
        raise SystemExit(f"找不到區域：{area}")
    bb = data[0]["boundingbox"]  # [south, north, west, east]
    return ",".join([bb[0], bb[2], bb[1], bb[3]])  # south,west,north,east


def overpass_query(bbox, tag_key, tag_value, timeout=90):
    """查 Overpass；主站 504/429 時自動換鏡像站重試。"""
    # bbox 格式：south,west,north,east
    filters = f'["{tag_key}"="{tag_value}"]'
    q = f"""[out:json][timeout:{timeout}];
(
  node{filters}({bbox});
  way{filters}({bbox});
  relation{filters}({bbox});
);
out center tags;"""
    payload = urllib.parse.urlencode({"data": q}).encode()
    last_err = None
    for attempt in range(2):
        for ep in OVERPASS_ENDPOINTS:
            try:
                req = urllib.request.Request(
                    ep, data=payload, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=timeout + 30) as r:
                    return json.loads(r.read().decode("utf-8", "replace"))
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(2)
    raise last_err if last_err else RuntimeError("overpass failed")


def to_spot(el, category):
    tags = el.get("tags") or {}
    name = (tags.get("name:zh") or tags.get("name") or "").strip()
    if not name:
        return None
    lat = el.get("lat", (el.get("center") or {}).get("lat"))
    lon = el.get("lon", (el.get("center") or {}).get("lon"))
    if lat is None or lon is None:
        return None
    city = tags.get("addr:city") or tags.get("addr:county") or ""
    dist = tags.get("addr:district") or tags.get("addr:suburb") or ""
    region = f"{city}{dist}".strip()
    addr = " ".join(x for x in [tags.get("addr:street", ""), tags.get("addr:housenumber", "")] if x).strip()
    osm_ref = f"{el.get('type')}/{el.get('id')}"
    return {
        "id": "",
        "category": category,
        "lat": f"{float(lat):.12f}",
        "lng": f"{float(lon):.12f}",
        "name": name,
        "address": addr,
        "description": f"OSM 候選點（地址來源：OpenStreetMap，ODbL）{osm_ref}",
        "status": "candidate",
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "verified_at": "None",
        "region": region,
        "sponsor_id": "None",
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "confirms": "0",
        "issues": "0",
        "last_confirmed_at": "None",
        "last_issue_at": "None",
        "sponsor_name": "None",
        "sponsor_slug": "None",
        "sponsor_config": "None",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", help="地名（用 Nominatim 查邊界），例如「嘉義市」")
    ap.add_argument("--bbox", help="south,west,north,east")
    ap.add_argument("--categories", help="逗號分隔的 category slug（見 --list-categories）")
    ap.add_argument("--all", action="store_true", help="所有有對應的類別（量大，建議只用在單一鄉鎮）")
    ap.add_argument("--list-categories", action="store_true")
    ap.add_argument("-o", "--output", default="-", help="輸出檔（預設印到 stdout）")
    args = ap.parse_args()

    if args.list_categories:
        for k in sorted(CATEGORY_TAGS):
            tags = ", ".join(f"{a}={b}" for a, b in CATEGORY_TAGS[k])
            print(f"{k:16s} {tags}")
        print(f"{'roadside':16s} （無 OSM 對應，需社群回報）")
        return

    if args.bbox:
        bbox = args.bbox
    elif args.area:
        bbox = geocode(args.area)
    else:
        raise SystemExit("請給 --area 或 --bbox")

    if args.all:
        cats = sorted(CATEGORY_TAGS)
    else:
        cats = [c.strip() for c in (args.categories or "").split(",") if c.strip()]
    if not cats:
        raise SystemExit("請給 --categories（或 --all）")

    spots, seen = [], set()
    for cat in cats:
        if cat not in CATEGORY_TAGS:
            print(f"  ⚠️ 跳過未知類別：{cat}", file=sys.stderr)
            continue
        got = 0
        for key, val in CATEGORY_TAGS[cat]:
            try:
                data = overpass_query(bbox, key, val)
            except Exception as e:  # noqa: BLE001
                print(f"  ⚠️ {cat} ({key}={val}) 查詢失敗：{str(e)[:60]}", file=sys.stderr)
                continue
            for el in data.get("elements", []):
                s = to_spot(el, cat)
                if not s:
                    continue
                dedup = f"{float(s['lat']):.4f},{float(s['lng']):.4f}"
                if dedup in seen:
                    continue
                seen.add(dedup)
                spots.append(s)
                got += 1
            time.sleep(1)  # 對 Overpass 友善
        print(f"  {cat:16s} 取得 {got} 筆", file=sys.stderr)

    out = {"spots": spots}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if args.output == "-":
        print(text)
    else:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"  ✅ 寫入 {args.output}（{len(spots)} 筆候選點）", file=sys.stderr)


if __name__ == "__main__":
    main()
