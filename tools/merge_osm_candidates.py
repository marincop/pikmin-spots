#!/usr/bin/env python3
"""把 OSM 候選點（candidate）併入既有 spots 資料。

核心原則：
  - **既有的點（verified）一律原封不動保留** —— 那是社群驗證過的資產，不可取代。
  - OSM 來的新點以 status="candidate" 加入，僅供「找點」用，需社群確認後才轉 verified。
  - 去重規則：**同類別**且距離 50 公尺內 → 視為重複，略過（不同類別不算重複，例如
    咖啡店候選點就算旁邊已有一間餐廳 verified，仍要保留）。

用法：
    python3 merge_osm_candidates.py --candidates osm.json.gz \
        --base map/data/raw-spots.json -o map/data/raw-spots_merged.json --report
    python3 merge_osm_candidates.py --candidates osm.json.gz --base app/data/spots.js \
        -o /tmp/merged.json          # 也會吃 spots.js（JS 包住的 JSON）
"""
import argparse
import gzip
import json
import math
import re
import sys

DUP_METERS = 50.0


def load_json_any(path):
    """讀 JSON；若檔頭是 JS（window.X = ...）也能撈出 JSON。"""
    if path.endswith(".gz"):
        text = gzip.open(path, "rt", encoding="utf-8").read()
    else:
        text = open(path, encoding="utf-8").read()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"[\[{].*[\]}]", text, re.S)
        if not m:
            raise SystemExit(f"無法解析：{path}")
        return json.loads(m.group(0))


def spots_of(data):
    return data["spots"] if isinstance(data, dict) and "spots" in data else data


def dist_m(lat1, lon1, lat2, lon2):
    dlat = (lat1 - lat2) * 111320.0
    dlng = (lon1 - lon2) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlng)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True, help="OSM 候選點檔（fetch_overpass.py 或 extract_osm_spots.py 的輸出）")
    ap.add_argument("--base", required=True, help="既有 spots（raw-spots.json 或 app/data/spots.js）")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    base = spots_of(load_json_any(args.base))
    cand = spots_of(load_json_any(args.candidates))
    print(f"  既有 spots：{len(base)} 筆", file=sys.stderr)
    print(f"  OSM 候選點：{len(cand)} 筆", file=sys.stderr)

    # 建既有點的索引：(category, lat3, lon3) 供快速比對
    by_cat = {}
    for s in base:
        try:
            cat = s.get("category") or s.get("category_label") or ""
            by_cat.setdefault(cat, []).append((float(s["lat"]), float(s["lng"])))
        except Exception:
            continue

    merged = list(base)  # 既有點全部保留（原封不動）
    added, dup = 0, 0
    for c in cand:
        try:
            lat, lon = float(c["lat"]), float(c["lng"])
        except Exception:
            continue
        cat = c.get("category", "")
        hit = False
        for (blat, blon) in by_cat.get(cat, []):
            if dist_m(lat, lon, blat, blon) <= DUP_METERS:
                hit = True
                break
        if hit:
            dup += 1
            continue
        c = dict(c)
        c["status"] = c.get("status") or "candidate"
        c.setdefault("confirms", "0")
        c.setdefault("issues", "0")
        merged.append(c)
        by_cat.setdefault(cat, []).append((lat, lon))  # 讓候選點之間也去重
        added += 1

    out = {"spots": merged}
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    print(f"  ✅ 輸出 {args.output}", file=sys.stderr)
    print(f"     既有保留：{len(base)} 筆（沒有被改動）", file=sys.stderr)
    print(f"     新增候選：{added} 筆", file=sys.stderr)
    print(f"     略過重複：{dup} 筆（同類別 {DUP_METERS:.0f} 公尺內）", file=sys.stderr)
    print(f"     總計：{len(merged)} 筆", file=sys.stderr)

    if args.report:
        import collections
        c = collections.Counter(s.get("status", "verified") for s in merged)
        print("  === status 分布 ===", file=sys.stderr)
        for k, v in c.most_common():
            print(f"     {k}: {v}", file=sys.stderr)


if __name__ == "__main__":
    main()
