#!/usr/bin/env python3
"""從台灣 OSM extract 抽出「皮克敏純點」候選點 —— 全程本地端，不打任何 API。

資料來源：Geofabrik 台灣 extract（https://download.geofabrik.de/asia/taiwan-latest.osm.pbf）
好處：一次抽完全台 40 類 POI、零限流風險、每月重跑一次即可更新。
⚠️ OSM 資料為 ODbL 授權 → 使用時須標示來源，衍生資料庫需以 ODbL 釋出。

用法：
    ~/.openclaw/workspace/venvs/osm/bin/python extract_osm_spots.py /tmp/taiwan-latest.osm.pbf -o all.json
    ... --gz                      # 輸出 all.json.gz
    ... --nodes-only              # 只抽 node（省記憶體，會少掉公園等 way）
"""
import argparse
import gzip
import json
import sys
import time

import osmium

# 與 fetch_overpass.py 同一套：你的 category slug → OSM (key, value)
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

REV = {}  # (key, value) -> [slug, ...]
for _slug, _pairs in CATEGORY_TAGS.items():
    for _kv in _pairs:
        REV.setdefault(_kv, []).append(_slug)

NOW = time.strftime("%Y-%m-%d %H:%M:%S")


def make_spot(slug, name, lat, lon, tags, ref):
    city = tags.get("addr:city") or tags.get("addr:county") or ""
    dist = tags.get("addr:district") or tags.get("addr:suburb") or ""
    addr = " ".join(x for x in [tags.get("addr:street", ""), tags.get("addr:housenumber", "")] if x)
    return {
        "id": "",
        "category": slug,
        "lat": f"{lat:.12f}",
        "lng": f"{lon:.12f}",
        "name": name,
        "address": addr,
        "description": f"OSM 候選點（OpenStreetMap，ODbL）{ref}",
        "status": "candidate",
        "created_at": NOW,
        "verified_at": "None",
        "region": f"{city}{dist}".strip(),
        "sponsor_id": "None",
        "updated_at": NOW,
        "confirms": "0",
        "issues": "0",
        "last_confirmed_at": "None",
        "last_issue_at": "None",
        "sponsor_name": "None",
        "sponsor_slug": "None",
        "sponsor_config": "None",
    }


class SpotHandler(osmium.SimpleHandler):
    def __init__(self, nodes_only=False):
        super().__init__()
        self.nodes_only = nodes_only
        self.spots = []
        self.seen = set()
        self.counts = {}

    def _emit(self, tags, lat, lon, ref):
        if lat is None or lon is None:
            return
        hit = []
        # 用 dict 快查（只掃這個物件的 tag，不掃全部規則）
        for t in tags:
            slugs = REV.get((t.k, t.v))
            if slugs:
                hit.extend(slugs)
        if not hit:
            return
        name = (tags.get("name:zh") or tags.get("name") or "").strip()
        if not name:
            return
        tdict = {t.k: t.v for t in tags}
        for slug in hit:
            key = (slug, round(lat, 4), round(lon, 4))
            if key in self.seen:
                continue
            self.seen.add(key)
            self.spots.append(make_spot(slug, name, lat, lon, tdict, ref))
            self.counts[slug] = self.counts.get(slug, 0) + 1

    def node(self, n):
        if n.location.valid():
            self._emit(n.tags, n.location.lat, n.location.lon, f"node/{n.id}")

    def way(self, w):
        if self.nodes_only:
            return
        # pyosmium 沒有 Way.center() → 用節點座標的 bbox 中心（接近遊戲「方格中心」概念）
        lats, lons = [], []
        try:
            for n in w.nodes:
                loc = n.location
                if loc.valid():
                    lats.append(loc.lat)
                    lons.append(loc.lon)
        except Exception:
            return
        if not lats:
            return
        lat = (min(lats) + max(lats)) / 2
        lon = (min(lons) + max(lons)) / 2
        self._emit(w.tags, lat, lon, f"way/{w.id}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf")
    ap.add_argument("-o", "--output", default="spots_osm.json")
    ap.add_argument("--gz", action="store_true")
    ap.add_argument("--nodes-only", action="store_true", help="只抽 node（省記憶體）")
    args = ap.parse_args()

    h = SpotHandler(nodes_only=args.nodes_only)
    t0 = time.time()
    h.apply_file(args.pbf, locations=not args.nodes_only)
    print(f"  抽取完成：{len(h.spots)} 筆候選點，耗時 {time.time()-t0:.0f}s", file=sys.stderr)

    out = {"spots": h.spots}
    text = json.dumps(out, ensure_ascii=False)
    if args.gz:
        with gzip.open(args.output, "wt", encoding="utf-8") as f:
            f.write(text)
    else:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
    print(f"  ✅ 寫入 {args.output}（{len(text)/1048576:.1f} MB）", file=sys.stderr)

    print("  === 各類別筆數 ===", file=sys.stderr)
    for slug, n in sorted(h.counts.items(), key=lambda x: -x[1]):
        print(f"    {slug:16s} {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
