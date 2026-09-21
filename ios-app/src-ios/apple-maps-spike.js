/* Spike: 用原生 MapKit（capacitor-plugin-apple-maps）畫 8702 個純點，驗證能不能扛
   跑法：esbuild 打包成 www/vendor/apple-maps.js，載入 spike 版 index.html */
import { AppleMap } from 'capacitor-plugin-apple-maps';

const $ = (s) => document.querySelector(s);
const SPOTS = window.PIKMIN_SPOTS || [];
const t = () => Math.round(performance.now());
const banner = (html, err) => {
  const b = $('#banner');
  b.innerHTML = html;
  b.classList.toggle('err', !!err);
};

(async () => {
  const log = [];
  try {
    banner('① 建立 MapKit…');
    const t0 = t();
    const map = await AppleMap.create({
      id: 'map',
      element: $('#map'),
      config: { center: { lat: 23.9, lng: 120.9 }, zoom: 7, minZoom: 3 },
    });
    log.push(`create ${t() - t0}ms`);

    banner(log.join(' · ') + '<br>② enableClustering…');
    const t1 = t();
    await map.enableClustering();
    log.push(`clustering ${t() - t1}ms`);

    banner(log.join(' · ') + `<br>③ 加入 ${SPOTS.length} 個 marker…`);
    const t2 = t();
    const ids = await map.addMarkers(SPOTS.map((s) => ({
      coordinate: { lat: s.lat, lng: s.lng },
      title: s.name || ('#' + s.id),
      snippet: s.category_label || '',
    })));
    log.push(`addMarkers ${SPOTS.length} → ${t() - t2}ms`);

    const t3 = t();
    await map.fitBounds(SPOTS.map((s) => ({ lat: s.lat, lng: s.lng })), 40, false);
    log.push(`fitBounds ${t() - t3}ms`);

    await map.setOnMarkerClickListener((d) => banner(`👆 tap marker: ${d.markerId}`));
    await map.setOnClusterClickListener((d) => banner(`👆 tap cluster: ${JSON.stringify(d).slice(0, 120)}`));

    banner(log.join('<br>') + `<br>✅ OK：${ids.length}/${SPOTS.length} markers`);
    console.log('SPIKE_RESULT', JSON.stringify({ spots: SPOTS.length, added: ids.length, log }));
  } catch (e) {
    const msg = (e && (e.message || e.code || JSON.stringify(e))) || String(e);
    banner('❌ 失敗：' + msg + '<br>' + log.join('<br>'), true);
    console.log('SPIKE_ERROR', msg);
  }
})();
