/* iOS 原生 Apple 地圖（MapKit）介面層
 *
 * 為什麼需要這個檔：外掛是 ESM 模組，而這個 App 是「沒有 bundler」的靜態站。
 * build-ipa.sh 會用 esbuild 把這支打包成 www/vendor/apple-maps.js，
 * 在 iOS 殼裡載入後掛上 window.AppleMapsAdapter；web 版不會有這支檔案，
 * app.js 就自然走 Leaflet 那條路（雙軌，同一份程式碼）。
 *
 * ⚠️ 關鍵：外掛一定要用它的 <capacitor-apple-map> 自訂元素才會 mount 上去
 *（它靠 WKChildScrollView + 元素內 200% 高 spacer 的 contentSize 兩倍比對找容器，
 *  普通 <div> 永遠掛不上去）。所以 init() 會把 #map 換成該自訂元素。
 */
import { AppleMap } from 'capacitor-plugin-apple-maps';

let map = null;
let ready = false;
let tapCb = null;
let idleCb = null;
let idleTimer = null;

function swapElement() {
  const old = document.getElementById('map');
  if (!old) { console.error('[apple-maps] 找不到 #map 容器'); return null; }
  if (old.tagName === 'CAPACITOR-APPLE-MAP') return old;
  const el = document.createElement('capacitor-apple-map');
  el.id = 'map';
  el.setAttribute('style', 'position:absolute;inset:0;z-index:1');
  old.parentNode.replaceChild(el, old);
  return el;
}

async function init() {
  if (ready) return true;
  const el = swapElement();
  if (!el) return false;
  map = await AppleMap.create({
    id: 'map',
    element: el,
    config: { center: { lat: 23.9, lng: 120.9 }, zoom: 7, minZoom: 3 },
  });
  await map.enableClustering();
  await map.setOnMarkerClickListener((d) => { if (tapCb) tapCb(d.markerId); });
  ready = true;
  console.log('[apple-maps] MapKit ready');
  return true;
}

/** 只「新增」還沒顯示的點；移除交由 removeMarkers（差集更新，避免每次重畫 8702 個 marker） */
async function addMarkers(spots) {
  if (!ready || !spots.length) return;
  await map.addMarkers(spots.map((s) => ({
    markerId: String(s.id),
    coordinate: { lat: s.lat, lng: s.lng },
    title: s.name || ('#' + s.id),
    snippet: s.category_label || '',
  })));
}

async function removeMarkers(ids) {
  if (!ready || !ids.length) return;
  await map.removeMarkers(ids.map(String));
}

async function fit(spots) {
  if (!ready || !spots.length) return;
  await map.fitBounds(spots.map((s) => ({ lat: s.lat, lng: s.lng })), 40, false);
}

async function goTo(lat, lng, zoom) {
  if (!ready) return;
  await map.setCamera({ coordinate: { lat, lng }, zoom, animate: false });
}

/** 框住一個範圍（兩個對角座標）：用於「定位點半徑 50 公里」這種沒有 marker 可 fit 的情況 */
async function showBox(sw, ne) {
  if (!ready) return;
  await map.fitBounds(
    [{ lat: sw[0], lng: sw[1] }, { lat: ne[0], lng: ne[1] }], 0, false);
}
async function setTapHandler(cb) {
  tapCb = cb;
  if (ready) await map.setOnMarkerClickListener((d) => cb(d.markerId));
}

/** 目前視野框 [[南,西],[北,東]]（開場先用它決定要載入哪些標記，避免一次塞滿） */
async function getBounds() {
  if (!ready) return null;
  try {
    const b = await map.getMapBounds();
    if (!b || !b.southwest || !b.northeast) return null;
    return [[b.southwest.lat, b.southwest.lng], [b.northeast.lat, b.northeast.lng]];
  } catch (e) { return null; }
}

/** 相機停止移動（平移/縮放結束）時回報視野框 [[南,西],[北,東]]；150ms 去抖，免得手勢中一直算 */
async function setIdleHandler(cb) {
  idleCb = cb;
  if (!ready) return;
  await map.setOnCameraIdleListener((d) => {
    if (!idleCb || !d || !d.bounds) return;
    const b = d.bounds;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleCb([
      [b.southwest.lat, b.southwest.lng],
      [b.northeast.lat, b.northeast.lng],
    ]), 150);
  });
}

/** 原生「我的位置」藍點（需要 Info.plist 的 NSLocationWhenInUseUsageDescription） */
async function showMe(on) {
  if (!ready) return;
  await map.enableCurrentLocation({ id: 'map', enabled: !!on });
}

window.AppleMapsAdapter = {
  available: true, init, addMarkers, removeMarkers, fit, goTo, showBox, getBounds,
  setTapHandler, setIdleHandler, showMe,
};
