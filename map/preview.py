#!/usr/bin/env python3
"""不靠瀏覽器，用 PIL 直接把 2655 個純點畫成一張總覽圖 preview.png。"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SPOTS = json.loads((ROOT / "data/spots.js").read_text(encoding="utf-8")
                   .split("=", 1)[1].rstrip().rstrip(";"))

W, H = 1400, 1000
img = Image.new("RGB", (W, H), (15, 26, 18))
d = ImageDraw.Draw(img)

# 台灣本島 + 外島範圍
LNG0, LNG1 = 118.0, 122.2
LAT0, LAT1 = 21.7, 25.4
ML, MR, MT, MB = 70, W - 70, 120, H - 70

def xy(lat, lng):
    x = ML + (lng - LNG0) / (LNG1 - LNG0) * (MR - ML)
    y = MB - (lat - LAT0) / (LAT1 - LAT0) * (MB - MT)
    return x, y

# 類別 → 顏色
COLOR = {
    "park": (93, 220, 122), "forest": (34, 139, 34), "waterside": (70, 170, 230),
    "beach": (240, 215, 120), "mountain": (170, 130, 90), "bus": (150, 150, 160),
    "station": (230, 120, 120), "minimart": (255, 170, 60), "supermarket": (255, 210, 90),
    "restaurant": (235, 90, 90), "cafe": (200, 140, 80), "roadside": (170, 170, 170),
}
DEFAULT = (110, 150, 190)

# 網格
for gx in range(int(LNG0), int(LNG1) + 1):
    x, _ = xy(0, gx)
    d.line([(x, MT), (x, MB)], fill=(32, 48, 36))
    d.text((x - 12, MB + 8), f"{gx}°E", fill=(120, 150, 130))
for gy in range(int(LAT0), int(LAT1) + 1):
    _, y = xy(gy, 0)
    d.line([(ML, y), (MR, y)], fill=(32, 48, 36))
    d.text((12, y - 6), f"{gy}°N", fill=(120, 150, 130))

tw = outside = 0
for s in SPOTS:
    x, y = xy(s["lat"], s["lng"])
    if not (ML - 40 <= x <= MR + 40 and MT - 40 <= y <= MB + 40):
        outside += 1
        continue
    tw += 1
    c = COLOR.get(s["category"], DEFAULT)
    r = 4 if s["confirms"] > 0 else 3
    d.ellipse([x - r, y - r, x + r, y + r], fill=c)

d.text((ML, 40), "Pikmin Bloom 純點地圖 · 2655 spots (Taiwan view)", fill=(230, 245, 235))
d.text((ML, 64), f"台灣視窗內 {tw} 點 · 海外/範圍外 {outside} 點（香港、日本、歐美等）",
       fill=(140, 175, 150))
d.text((ML, 86), "綠=公園/森林  藍=水邊  紅=餐廳/車站  橘=便利商店  灰=路邊/公車站",
       fill=(120, 150, 130))
img.save(ROOT / "preview.png")
print(f"wrote preview.png ({tw} in-window, {outside} outside)")
