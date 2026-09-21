// 不靠瀏覽器，直接驗證資料檔與地圖頁的篩選邏輯是否正確。
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert";

const raw = fs.readFileSync(new URL("./data/spots.js", import.meta.url), "utf8");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(raw, ctx);
const SPOTS = ctx.window.PIKMIN_SPOTS;

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); pass++; };

console.log(`loaded ${SPOTS.length} spots`);
ok(SPOTS.length === 2655, "共 2655 筆");
ok(SPOTS.every(s => Number.isFinite(s.lat) && Number.isFinite(s.lng)), "每筆都有有效座標");
ok(SPOTS.every(s => s.lat > -90 && s.lat < 90 && s.lng > -180 && s.lng < 180), "座標在合法範圍");
ok(SPOTS.every(s => s.category_label && s.category_label.length > 0), "每筆都有類別標籤");
ok(new Set(SPOTS.map(s => s.id)).size === SPOTS.length, "id 不重複");

// 台灣本島 bounding box 抽查（約 21.8–25.4N, 119.3–122.1E）
const tw = SPOTS.filter(s => s.lat > 21.8 && s.lat < 25.4 && s.lng > 119.3 && s.lng < 122.1);
ok(tw.length > 2000, `台灣範圍內 ${tw.length} 筆`);

// 重現頁面 filter 邏輯
const filter = ({ q = "", cat = "", reg = "", named = false, conf = false }) => SPOTS.filter(s => {
  if (cat && s.category_label !== cat) return false;
  if (reg && s.region !== reg) return false;
  if (named && !s.name) return false;
  if (conf && !(s.confirms > 0)) return false;
  if (q) { const h = (s.name + " " + s.address + " " + s.region + " " + s.category_label).toLowerCase(); if (!h.includes(q.toLowerCase())) return false; }
  return true;
});

const parkCount = SPOTS.filter(s => s.category === "park").length;
ok(filter({ cat: "🍀 公園" }).length === parkCount, `類別「🍀 公園」= ${parkCount}`);
ok(filter({ conf: true }).length === SPOTS.filter(s => s.confirms > 0).length, "只顯示有人確認過");
ok(filter({ named: true }).length === SPOTS.filter(s => s.name).length, "只顯示有名稱");
ok(filter({ q: "台北" }).length > 0, `關鍵字「台北」命中 ${filter({ q: "台北" }).length} 筆`);
ok(filter({ q: "7-11" }).every(s => (s.name + s.address + s.region + s.category_label).includes("7-11")), "關鍵字搜尋結果正確");
ok(filter({ reg: "桃園市中壢區" }).length === 63, "地區「桃園市中壢區」= 63（與官網相符）");

// GeoJSON 驗證
const gj = JSON.parse(fs.readFileSync(new URL("./data/spots.geojson", import.meta.url), "utf8"));
ok(gj.type === "FeatureCollection" && gj.features.length === SPOTS.length, `GeoJSON features = ${gj.features.length}`);
const f0 = gj.features.find(f => f.properties.id === 2837);
ok(f0.geometry.coordinates[0] === 121.25874620134725 && f0.geometry.coordinates[1] === 24.96795430263329, "GeoJSON 座標順序 [lng, lat] 正確");

// CSV 驗證
const csv = fs.readFileSync(new URL("./data/spots.csv", import.meta.url), "utf8").replace(/^\uFEFF/, "").split("\n");
ok(csv[0].startsWith("id,name,category"), "CSV 表頭正確（含 BOM 供 Excel 讀中文）");
ok(csv.filter(l => l.trim()).length === SPOTS.length + 1, `CSV 行數 = ${csv.filter(l => l.trim()).length - 1} 筆資料`);

console.log(`\n${pass} checks passed`);
