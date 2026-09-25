#!/usr/bin/env python3
"""把篩選後的 OSM 純點轉成 pikmin-spots 的 raw-spots 格式，產生匯入清單。

篩選規則（2026-09-25 定案）
  - R = 100m（探測器範圍）、排除「路邊」、只收 pure（100m 內無其他類別）
  - 其他類別：距既有社群點 > --gap-km（預設 1 km）
  - 公車站：**只收偏遠**（距既有社群點 > --bus-km，預設 3 km）← 避免淹沒既有內容

輸入：filter_pure_spots.py 產生的 gap 清單（已含 purity / dist_to_existing_m）
輸出：{"spots": [...]}，欄位與 map/data/raw-spots.json 相同，可直接餵 build_app_data.py

用法：
  python3 build_import_list.py --gap /tmp/pikmin_gap2.json -o map/data/osm_candidates.json.gz
"""
import argparse
import collections
import gzip
import json
import sys
import time

# category_label -> 你的 category slug（與 raw-spots.json 一致）
LABEL_SLUG = {
    "🍀 公園": "park", "🚌 公車站": "bus", "🏪 便利商店": "minimart",
    "🍽️ 餐廳": "restaurant", "🌲 森林": "forest", "🎣 水邊": "waterside",
    "🍌 超市": "supermarket", "🌉 橋梁": "bridge", "☕ 咖啡店": "cafe",
    "🍜 拉麵店": "ramen", "👗 服飾店": "clothesstore", "📮 郵局": "postoffice",
    "🎓 大學/學院": "university", "🚂 車站": "station", "🏨 飯店": "hotel",
    "📚 圖書館/書店": "library", "✈️ 機場": "airport", "🔋 電器行": "electronics",
    "💊 藥局": "pharmacy", "🔧 五金行": "diy", "🐚 海灘": "beach",
    "🥖 麵包店": "bakery", "🏟️ 體育館": "stadium", "✂️ 美容院": "hairsalon",
    "👕 自助洗衣店": "laundry", "⛰️ 山丘": "mountain", "✏️ 文具": "stationery",
    "🍕 義式餐廳": "italian", "🍣 壽司店": "sushi", "🎢 主題樂園": "themePark",
    "🍩 甜點店": "sweetshop", "🎨 美術館": "artgallery", "🥬 韓式餐廳": "korean",
    "⛩️ 神社/寺廟": "shrine", "🍔 漢堡店": "hamburger", "🎬 電影院": "movie",
    "🍛 咖哩餐廳": "curry", "💄 化妝品商店": "makeup", "🦁 動物園": "zoo",
}

NOW = time.strftime("%Y-%m-%d %H:%M:%S")


def load(path):
    if path.endswith(".gz"):
        return json.load(gzip.open(path, "rt", encoding="utf-8"))
    return json.load(open(path, encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gap", required=True, help="filter_pure_spots.py 的 gap 清單")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--bus-km", type=float, default=3.0, help="公車站只收超過這個距離的（偏遠）")
    ap.add_argument("--id-base", type=int, default=900000, help="候選點 id 起始（避免撞既有 id）")
    args = ap.parse_args()

    gap = load(args.gap)
    gap = gap["spots"] if isinstance(gap, dict) else gap
    out, skipped = [], collections.Counter()
    nid = args.id_base
    for s in gap:
        lbl = s.get("category_label") or ""
        slug = LABEL_SLUG.get(lbl)
        if not slug:
            skipped["無法對應類別"] += 1
            continue
        d = s.get("dist_to_existing_m")
        # 公車站：只收偏遠
        if slug == "bus" and (d is None or d < args.bus_km * 1000):
            skipped["公車站（市區，不收）"] += 1
            continue
        nid += 1
        out.append({
            "id": str(nid),
            "category": slug,
            # 座標固定 4 位小數 → 建置可重複執行而不產生重複（去重就是比 4 位小數）
            "lat": f"{float(s['lat']):.4f}", "lng": f"{float(s['lng']):.4f}",
            "name": s.get("name") or "",
            "address": s.get("address") or "",
            "description": (f"OSM 候選點（OpenStreetMap，ODbL）｜純點 R={s.get('purity_R', 100)}m "
                            f"｜距既有點 {d if d is not None else '>1km'} m"),
            "status": "candidate",
            "created_at": NOW,
            "verified_at": "None",
            "region": s.get("region") or "",
            "sponsor_id": "None",
            "updated_at": NOW,
            "confirms": "0", "issues": "0",
            "last_confirmed_at": "None", "last_issue_at": "None",
            "sponsor_name": "None", "sponsor_slug": "None", "sponsor_config": "None",
        })

    text = json.dumps({"spots": out}, ensure_ascii=False)
    if args.output.endswith(".gz"):
        with gzip.open(args.output, "wt", encoding="utf-8") as f:
            f.write(text)
    else:
        open(args.output, "w", encoding="utf-8").write(text)

    c = collections.Counter(s["category"] for s in out)
    print(f"  ✅ 寫入 {args.output}（{len(out)} 筆，{len(text)/1048576:.1f} MB）", file=sys.stderr)
    print("  === 匯入清單類別分布 ===", file=sys.stderr)
    for k, n in c.most_common(15):
        print(f"     {k:14s} {n}", file=sys.stderr)
    print(f"  === 略過 ===", file=sys.stderr)
    for k, n in skipped.most_common():
        print(f"     {k}: {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
