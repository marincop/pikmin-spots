#!/usr/bin/env python3
"""抓 pikmin.talllkai.com 的純點資料 (PureSpot/Map)。

該站是 ASP.NET 頁面，把全部純點以 gzip+base64 內嵌在 HTML 的
`Uint8Array.from(atob("..."))` blob 裡（無公開 API）。本工具：
  1. GET /PureSpot/Map
  2. 取出 atob("...") blob、base64 decode、gunzip
  3. 輸出 JSON 陣列（欄位：Id, Name, Lat, Lon, Type, Icon, City, District,
     Good, UserName, UpdateDate, Ext）

用法：
  python3 fetch_talllkai.py                 # 印統計
  python3 fetch_talllkai.py -o raw.json     # 另存原始資料
  python3 fetch_talllkai.py --merge app/data/spots.js -o merged.json
        # 把 talllkai 資料與 pikdecor 資料合併（依 4 位小數座標去重）
"""
import argparse
import base64
import gzip
import json
import re
import sys
import urllib.request

URL = "https://pikmin.talllkai.com/PureSpot/Map"
UA = "Mozilla/5.0 (compatible; pikmin-spots/1.0)"


def fetch_html(url=URL, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def extract_json(html):
    # Razor/JSON 有時把 + / = 轉義成 \u002B \u002F \u003D
    for esc, ch in (("\\u002B", "+"), ("\\u002b", "+"),
                    ("\\u002F", "/"), ("\\u002f", "/"),
                    ("\\u003D", "="), ("\\u003d", "=")):
        html = html.replace(esc, ch)
    m = re.search(r'atob\("([^"]+)"\)', html)
    if not m:
        raise SystemExit("找不到 atob blob（網站結構可能改了）")
    blob = base64.b64decode(m.group(1))
    if blob[:2] == b"\x1f\x8b":
        return json.loads(gzip.decompress(blob))
    import zlib
    return json.loads(zlib.decompress(blob))


def stats(rows):
    types, cities, years = {}, {}, {}
    for s in rows:
        types[s["Type"]] = types.get(s["Type"], 0) + 1
        cities[s["City"]] = cities.get(s["City"], 0) + 1
        years[(s.get("UpdateDate") or "")[:4]] = years.get((s["UpdateDate"] or "")[:4], 0) + 1
    top = sorted(types.items(), key=lambda x: -x[1])
    print(f"total={len(rows)}  types={len(types)}  cities={len(cities)}")
    print("top types:", top[:10])
    print("top cities:", sorted(cities.items(), key=lambda x: -x[1])[:8])
    print("by year:", sorted(years.items()))


def load_ours(path):
    txt = open(path, encoding="utf-8").read()
    return json.loads(re.sub(r"^window\.PIKMIN_SPOTS\s*=\s*", "", txt).strip().rstrip(";"))


def merge(ours, theirs):
    key = lambda lat, lon: f"{round(float(lat), 4)},{round(float(lon), 4)}"
    seen = {key(s["lat"], s["lng"]) for s in ours}
    added = 0
    for s in theirs:
        k = key(s["Lat"], s["Lon"])
        if k in seen:
            continue
        seen.add(k)
        ours.append({
            "id": None, "name": s.get("Name") or "",
            "category_label": s.get("Icon", "") + " " + s.get("Type", ""),
            "region": (s.get("City") or "") + (s.get("District") or ""),
            "address": "", "lat": s["Lat"], "lng": s["Lon"],
            "status": "verified", "confirms": s.get("Good", 0), "issues": 0,
            "created_at": s.get("UpdateDate", ""), "verified_at": "",
            "last_confirmed_at": "", "description": "",
            "source": "talllkai", "source_id": s.get("Id"),
        })
        added += 1
    print(f"ours={len(ours)-added}  added={added}  total={len(ours)}")
    return ours


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output")
    ap.add_argument("--merge", help="pikdecor spots.js 路徑（輸出合併結果）")
    a = ap.parse_args()
    rows = extract_json(fetch_html())
    stats(rows)
    if a.merge:
        merged = merge(load_ours(a.merge), rows)
        if a.output:
            json.dump(merged, open(a.output, "w", encoding="utf-8"), ensure_ascii=False)
            print("寫出:", a.output)
    elif a.output:
        json.dump(rows, open(a.output, "w", encoding="utf-8"), ensure_ascii=False)
        print("寫出:", a.output)


if __name__ == "__main__":
    sys.exit(main())
