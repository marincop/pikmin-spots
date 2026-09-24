#!/usr/bin/env python3
"""皮克敏「純點」篩選（規則依 2026-09-25 查證的探測器機制）。

探測器機制（來源：pikminwiki.com/Detector ＋ 巴哈姆特 Pikmin Bloom 板 snA=841）
  - 探測器範圍 R = 100 公尺
  - 只納入「方格中心點」落在 R 內的格子
  - 每移動 25 公尺才重新判定
  - 除非範圍內只有路邊，否則探測器「排除路邊屬性」
  - 大面積指標（公園、水邊、森林）中獎率很高
  - 遊戲方格屬性大部分來自 OpenStreetMap

本工具把上述規則用在候選點上：
  1. 排除「路邊」屬性（探測器自己會排除）
  2. purity = R+容差 內「沒有其他裝飾類別」→ 可能純點
  3. purity_distance = 最近的「不同類別」距離（越大越純）
  4. high_hit = 大面積類別（公園/水邊/森林）→ 中獎率高，優先推薦
  5. gap = 距既有社群點 >1km → 真正「補洞」的候選

用法：
  python3 filter_pure_spots.py --osm /tmp/spots_osm_nodes.json.gz \
      --existing /tmp/pikmin/app/data/spots.js \
      -o /tmp/pikmin_filtered.json.gz --gap-output /tmp/pikmin_gap.json --R 100
"""
import argparse
import gzip
import json
import math
import os
import re
import sys

# OSM slug -> 你的 category_label（與 fetch_overpass.py / build_app_data.py 一致）
SLUG_LABEL = {
    "park": "🍀 公園", "bus": "🚌 公車站", "minimart": "🏪 便利商店",
    "restaurant": "🍽️ 餐廳", "forest": "🌲 森林", "waterside": "🎣 水邊",
    "supermarket": "🍌 超市", "bridge": "🌉 橋梁", "cafe": "☕ 咖啡店",
    "ramen": "🍜 拉麵店", "clothesstore": "👗 服飾店", "postoffice": "📮 郵局",
    "university": "🎓 大學/學院", "station": "🚂 車站", "hotel": "🏨 飯店",
    "library": "📚 圖書館/書店", "airport": "✈️ 機場", "electronics": "🔋 電器行",
    "pharmacy": "💊 藥局", "diy": "🔧 五金行", "beach": "🐚 海灘",
    "bakery": "🥖 麵包店", "stadium": "🏟️ 體育館", "hairsalon": "✂️ 美容院",
    "laundry": "👕 自助洗衣店", "mountain": "⛰️ 山丘", "stationery": "✏️ 文具",
    "italian": "🍕 義式餐廳", "sushi": "🍣 壽司店", "themePark": "🎢 主題樂園",
    "sweetshop": "🍩 甜點店", "artgallery": "🎨 美術館", "korean": "🥬 韓式餐廳",
    "shrine": "⛩️ 神社/寺廟", "hamburger": "🍔 漢堡店", "movie": "🎬 電影院",
    "curry": "🍛 咖哩餐廳", "makeup": "💄 化妝品商店", "zoo": "🦁 動物園",
}
ROADSIDE = "🪙 路邊"                      # 探測器會排除路邊
HIGH_HIT = {"🍀 公園", "🎣 水邊", "🌲 森林"}   # 大面積指標：中獎率高

CELL = 0.002   # 網格大小（約 220 m），加速最近鄰查詢


def load_any(path):
    if path.endswith(".gz"):
        text = gzip.open(path, "rt", encoding="utf-8").read()
    else:
        text = open(path, encoding="utf-8").read()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\[.*\]", text, re.S)
        return json.loads(m.group(0))


def spots_of(d):
    return d["spots"] if isinstance(d, dict) and "spots" in d else d


def cell(lat, lng):
    return (int(lat / CELL), int(lng / CELL))


def dist(a, b):
    dlat = (a[0] - b[0]) * 111320.0
    dlng = (a[1] - b[1]) * 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlng)


def build_grid(pts):
    g = {}
    for i, (lat, lng, _cat) in enumerate(pts):
        g.setdefault(cell(lat, lng), []).append(i)
    return g


def nearest_diff(pts, grid, i, R_eff):
    """回傳 (最近的『不同類別』距離, 該類別)。超過 R_eff 就視為沒有干擾。"""
    lat, lng, cat = pts[i]
    gx, gy = cell(lat, lng)
    best, best_cat = 1e9, None
    # 搜尋半徑：R_eff 約 115m → 0.002° 一格約 220m，3x3 足夠
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for j in grid.get((gx + dx, gy + dy), ()):
                if j == i: continue
                q = pts[j]
                if q[2] == cat or q[2] == ROADSIDE:  # 路邊不算干擾
                    continue
                d = dist((lat, lng), (q[0], q[1]))
                if d < best:
                    best, best_cat = d, q[2]
    return best, best_cat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", required=True, help="OSM 候選點檔（.json 或 .json.gz）")
    ap.add_argument("--existing", help="既有社群點（spots.js 或 raw JSON），用來算補洞")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--gap-output", help="另存『補洞優先』清單")
    ap.add_argument("--R", type=float, default=100.0, help="探測器半徑（公尺）")
    ap.add_argument("--tol", type=float, default=15.0, help="容差（格子非連續圓）")
    ap.add_argument("--gap-km", type=float, default=1.0, help="距既有點幾公里算『補洞』")
    args = ap.parse_args()

    R_eff = args.R + args.tol
    osm = spots_of(load_any(args.osm))
    print(f"  OSM 候選點: {len(osm)} 筆", file=sys.stderr)

    existing = []
    if args.existing and os.path.exists(args.existing):
        existing = spots_of(load_any(args.existing))
        print(f"  既有社群點: {len(existing)} 筆", file=sys.stderr)

    # 目標點（OSM，標籤化）
    targets = []
    for s in osm:
        lbl = SLUG_LABEL.get(s.get("category"))
        if not lbl:
            continue
        try:
            targets.append((float(s["lat"]), float(s["lng"]), lbl, s))
        except Exception:
            continue
    print(f"  可對應類別: {len(targets)} 筆", file=sys.stderr)

    # 參考集合 = 既有點（標籤化）＋ OSM 目標點
    ref = []
    for s in existing:
        lbl = s.get("category_label") or s.get("category") or ""
        try:
            ref.append((float(s["lat"]), float(s["lng"]), lbl))
        except Exception:
            continue
    n_existing = len(ref)
    ref += [(a, b, c) for (a, b, c, _s) in targets]
    grid = build_grid(ref)
    print(f"  參考總點數: {len(ref)}（既有 {n_existing}）", file=sys.stderr)

    # 既有點距離網格（算補洞用）
    egrid = build_grid(ref[:n_existing]) if n_existing else {}

    def nearest_existing(lat, lng):
        if not n_existing: return 1e9
        gx, gy = cell(lat, lng)
        best = 1e9
        for r in (0, 1, 2):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if r > 0 and max(abs(dx), abs(dy)) != r: continue
                    for j in egrid.get((gx + dx, gy + dy), ()):
                        d = dist((lat, lng), (ref[j][0], ref[j][1]))
                        if d < best: best = d
            if best < 1e9: return best
        return best

    out, gap = [], []
    stats = {"pure": 0, "mixed": 0, "roadside": 0, "high_hit_pure": 0}
    for idx, (lat, lng, lbl, src) in enumerate(targets):
        i = n_existing + idx
        if lbl == ROADSIDE:
            verdict, pd, near_cat = "roadside", 0.0, None
        else:
            d, nc = nearest_diff(ref, grid, i, R_eff)
            if d > R_eff:
                verdict, pd, near_cat = "pure", (None if d > 1e8 else round(d, 1)), nc
                stats["pure"] += 1
                if lbl in HIGH_HIT: stats["high_hit_pure"] += 1
            else:
                verdict, pd, near_cat = "mixed", round(d, 1), nc
                stats["mixed"] += 1
        if verdict == "roadside": stats["roadside"] += 1

        rec = dict(src)
        rec["category_label"] = lbl
        rec["status"] = "candidate"
        rec["purity"] = verdict
        rec["purity_R"] = args.R
        rec["purity_distance"] = pd
        rec["purity_near_category"] = near_cat
        rec["high_hit"] = lbl in HIGH_HIT
        out.append(rec)

        if verdict == "pure":
            de = nearest_existing(lat, lng)
            rec["dist_to_existing_m"] = None if de > 1e8 else round(de)
            if de > args.gap_km * 1000:
                gap.append(rec)

    # 輸出
    for path, data in ((args.output, {"spots": out}), (args.gap_output, {"spots": gap})):
        if not path: continue
        text = json.dumps(data, ensure_ascii=False)
        if path.endswith(".gz"):
            with gzip.open(path, "wt", encoding="utf-8") as f: f.write(text)
        else:
            with open(path, "w", encoding="utf-8") as f: f.write(text)
        print(f"  ✅ 寫入 {path}（{len(data['spots'])} 筆，{len(text)/1048576:.1f} MB）", file=sys.stderr)

    print("  === 篩選結果（R = %.0f m，容差 ±%.0f m）===" % (args.R, args.tol), file=sys.stderr)
    print(f"     可能純點 (pure)      : {stats['pure']}", file=sys.stderr)
    print(f"       其中大面積類別      : {stats['high_hit_pure']}", file=sys.stderr)
    print(f"     混合點 (mixed)       : {stats['mixed']}", file=sys.stderr)
    print(f"     路邊（排除）          : {stats['roadside']}", file=sys.stderr)
    print(f"     補洞優先（> {args.gap_km} km）: {len(gap)}", file=sys.stderr)


if __name__ == "__main__":
    main()
