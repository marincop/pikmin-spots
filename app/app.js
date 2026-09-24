/* 皮克敏純點地圖 — mobile PWA app logic
 *
 * Pure helpers are exported for node tests (see test.mjs); DOM/bootstrap code
 * only runs in a browser.
 */
'use strict';

/* ---------- pure logic (node-testable) ---------- */

const COUNTRY_RULES = [
  ['台灣', /^(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)/],
  ['香港', /香港/],
  ['日本', /日本|東京|大阪|京都|北海道|沖繩|福岡|名古屋|台場|札幌/],
  ['韓國', /韓國|首爾|釜山|浦市/],
  ['美國', /美國|檀香山|夏威夷|紐澤西|麻省|伊利諾|德克薩斯|華盛頓|加利福尼亞|羅徹斯特|西雅圖|達拉斯/],
  ['加拿大', /加拿大|溫哥華|多倫多|蒙特婁/],
  ['英國', /英國|曼徹斯特|加地夫|卡地夫|倫敦|愛丁堡/],
  ['德國', /德國|多特蒙德|萊比錫|柏林|慕尼黑|漢堡/],
  ['法國', /法國|巴黎|聖但尼|里昂/],
  ['西班牙', /西班牙|馬德里|巴塞隆納/],
  ['葡萄牙', /葡萄牙|里斯本/],
  ['義大利', /義大利|羅馬|Roma|米蘭|佛羅倫斯/],
  ['荷蘭', /荷蘭|阿姆斯特丹/],
  ['比利時', /比利時|布魯塞爾/],
  ['希臘', /希臘|雅典/],
  ['澳洲', /澳洲|凱恩斯|雪梨|墨爾本|布里斯本/],
  ['紐西蘭', /紐西蘭|威靈頓|奧克蘭/],
  ['阿拉伯', /阿拉伯|阿聯|杜拜|شارع/],
  ['埃及', /埃及|開羅/],
  ['巴西', /巴西|聖保羅/],
  ['墨西哥', /墨西哥/],
  ['秘魯', /秘魯/],
  ['印度', /印度/],
  ['越南', /越南/],
  ['泰國', /泰國|曼谷/],
  ['新加坡', /新加坡/],
  ['馬來西亞', /馬來西亞|吉隆坡/],
];

function countryOf(region) {
  const r = String(region || '').replace(/^__overseas__/, '').trim();
  if (!r) return '其他';
  for (const [name, re] of COUNTRY_RULES) if (re.test(r)) return name;
  return '其他';
}

// 台灣縣市：取 region 開頭的「○○市 / ○○縣」；臺→台 正規化
const TW_COUNTY = /^([\u4e00-\u9fff]{2,3}[縣市])/;
const TW_BARE = /^(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|嘉義|屏東|宜蘭|花蓮|台東|臺東|苗栗|彰化|南投|雲林|澎湖|金門|連江)/;
const TW_CITY = new Set(['台北', '新北', '桃園', '台中', '台南', '高雄', '基隆', '新竹', '嘉義']);
function twCounty(region) {
  const r = String(region || '').replace(/^__overseas__/, '').replace(/臺/g, '台').trim();
  if (countryOf(r) !== '台灣') return '';
  const m = r.match(TW_COUNTY);
  if (m) return m[1];
  // 後備：只有裸地名（例：桃園、台中機場）
  const b = r.match(TW_BARE);
  if (b) return b[1] + (TW_CITY.has(b[1]) ? '市' : '縣');
  return '';
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function applyFilters(spots, opt) {
  const o = opt || {};
  const cat = o.category || null;
  const visited = o.visitedSet || null;
  return spots.filter(s => {
    if (o.country && countryOf(s.region) !== o.country) return false;
    if (o.county && twCounty(s.region) !== o.county) return false;
    if (cat && s.category_label !== cat) return false;
    if (!o.showCandidates && s.status === "candidate") return false;   // 預設只顯示社群已驗證的點
    if (o.namedOnly && !s.name) return false;
    if (o.confirmedOnly && !(s.confirms > 0)) return false;
    if (o.visitedOnly && !(visited && visited.has(s.id))) return false;
    if (o.unvisitedOnly && visited && visited.has(s.id)) return false;
    return true;
  });
}

/* Single-select decor type: tapping the active one clears it; tapping a
 * different one while one is active is rejected (error) instead of adding. */
function nextCategory(current, tapped) {
  if (current === tapped) return { value: null, error: false };
  if (current) return { value: current, error: true };
  return { value: tapped, error: false };
}

function sortSpots(arr, mode, origin) {
  const out = arr.slice();
  if (mode === 'distance' && origin) {
    out.sort((a, b) =>
      haversine(origin.lat, origin.lng, a.lat, a.lng) -
      haversine(origin.lat, origin.lng, b.lat, b.lng));
  } else if (mode === 'confirms') {
    out.sort((a, b) => b.confirms - a.confirms || b.id - a.id);
  } else if (mode === 'name') {
    out.sort((a, b) => (a.name || '～').localeCompare(b.name || '～', 'zh-Hant'));
  } else {
    out.sort((a, b) => b.id - a.id); // newest
  }
  return out;
}

function fmtDist(m) {
  if (m == null) return '';
  return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
}

/* 「導航到這裡」的連結：刻意不帶起點參數（Apple 的 saddr / Google 的 origin），
 * 這樣地圖 App 會用「裝置目前位置」當出發點；dirflg=d / travelmode=driving = 開車導航。*/
function navURL(lat, lng, platform) {
  if (String(platform) === 'apple') {
    return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** 只在 Apple 平台用 Apple 地圖（iPhone/iPad/Mac，含 iOS 殼的 WKWebView）；其他平台退 Google 導航 */
function navPlatform(ua) {
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(String(ua || '')) ? 'apple' : 'google';
}

/** 以某點為中心、半徑 radiusM 公尺的外接矩形 → [[南,西],[北,東]]（地圖框選用） */
function regionBounds(lat, lng, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = Math.min(180, radiusM / (111320 * Math.max(0.05, Math.cos(lat * Math.PI / 180))));
  return [[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]];
}

/** 依視野框挑出要放上地圖的點（含外擴邊界，避免邊緣突然冒出） */
function withinBox(spots, box, padRatio) {
  if (!box) return spots;
  const [[s, w], [n, e]] = box;
  const r = padRatio == null ? 0.15 : padRatio;
  const padLat = Math.max((n - s) * r, 0.01);
  const padLng = Math.max((e - w) * r, 0.01);
  return spots.filter(x =>
    x.lat >= s - padLat && x.lat <= n + padLat &&
    x.lng >= w - padLng && x.lng <= e + padLng);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    countryOf, twCounty, haversine, applyFilters, nextCategory, sortSpots, fmtDist,
    navURL, navPlatform, regionBounds, withinBox,
  };
}

/* ---------- browser bootstrap ---------- */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (async function () {
    const SPOTS = window.PIKMIN_SPOTS || [];
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s)
      .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const LS_VISITED = 'pikmin:visited';
    const visited = new Set(JSON.parse(localStorage.getItem(LS_VISITED) || '[]'));
    const saveVisited = () => localStorage.setItem(LS_VISITED, JSON.stringify([...visited]));

    const state = {
      country: '', county: '', category: null,
      namedOnly: false, confirmedOnly: false, visitedOnly: false, showCandidates: false,
      sortMode: 'distance', origin: null, rows: [],
      near: false,          // 目前是不是「我附近」模式（地圖固定在定位點 50 公里）
    };
    const NEAR_RADIUS_M = 50000;   // 「我附近」＝定位點半徑 50 公里
    const MAX_MARKERS = 2500;      // iOS 原生地圖一次最多放幾個標記（超過就取離視野中心最近的）
    let viewBox = null;            // 目前視野 [[南,西],[北,東]]（由 MapKit camera idle 回報）
    let rendering = false, renderAgain = false;

    /* ---------- 地圖層：iOS 走原生 Apple 地圖（MapKit），其餘用 Leaflet ---------- */
    const APPLE = (window.AppleMapsAdapter && window.AppleMapsAdapter.available)
      ? window.AppleMapsAdapter : null;
    const layers = new Map();         // Leaflet markers
    let map = null, clusters = null;  // Leaflet（只在非 iOS 路徑建立）
    let appleIds = new Set();         // MapKit 目前顯示過的 markerId

    if (APPLE) {
      await APPLE.init();
      await APPLE.setTapHandler(id => openSpot(id));
      // 視野一動（平移/缩放）就重算該載入哪些標記；150ms 去抖，免得手勢中一直算
      await APPLE.setIdleHandler(box => { viewBox = box; render(); });
    } else {
      map = L.map('map', { worldCopyJump: true, zoomControl: false })
        .setView([23.9, 120.9], 7);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      clusters = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 15 });
      map.addLayer(clusters);

      // Force a relayout after first paint: in native WKWebView wrappers (Capacitor)
      // and some iOS PWA launch paths, Leaflet can compute the container size
      // before the webview has finished its own layout pass, leaving the map
      // rendered in a truncated strip until the next resize event.
      const fixMapSize = () => map.invalidateSize();
      requestAnimationFrame(() => requestAnimationFrame(fixMapSize));
      window.addEventListener('resize', fixMapSize);
      window.addEventListener('orientationchange', fixMapSize);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', fixMapSize);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) fixMapSize(); });
      setTimeout(fixMapSize, 300);
    }

    const gmLink = s => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;
    const NAV = navPlatform(navigator.userAgent);   // 'apple' | 'google'
    const navLink = s => navURL(s.lat, s.lng, NAV);

    function popupHTML(s) {
      const isV = visited.has(s.id);
      const dist = state.origin
        ? fmtDist(haversine(state.origin.lat, state.origin.lng, s.lat, s.lng)) : '';
      return `<div class="pop">
        <div><b>${esc(s.category_label)}</b> · #${s.id}</div>
        <div style="font-size:14px;margin:4px 0">${esc(s.name || '(未命名)')}</div>
        <div style="font-size:12px;color:#9fbfa7">${esc(s.region || '')}${s.address ? ' · ' + esc(s.address) : ''}</div>
        <div class="c" style="margin:6px 0">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}${dist ? ' · ' + dist : ''}</div>
        <div style="font-size:12px;color:#9fbfa7">確認 ${s.confirms} · 問題 ${s.issues} · 收錄 ${esc((s.created_at || '').slice(0, 10))}</div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a class="navbtn" href="${navLink(s)}" target="_blank" rel="noopener">🧭 導航到這裡</a>
          <a href="${gmLink(s)}" target="_blank" rel="noopener">Google Maps ↗</a>
        </div>
        <button class="visitbtn" data-id="${s.id}" style="margin-top:8px">${isV ? '✓ 已踩過（點擊取消）' : '☐ 標記為踩過'}</button>
      </div>`;
    }

    if (!APPLE) {
      SPOTS.forEach(s => {
        const m = L.marker([s.lat, s.lng], { title: s.name || ('#' + s.id) });
        m.spot = s;
        m.bindPopup(() => popupHTML(s));
        layers.set(s.id, m);
      });

      map.on('popupopen', e => {
        const el = e.popup.getElement();
        const btn = el && el.querySelector('.visitbtn');
        if (!btn) return;
        btn.onclick = () => toggleVisit(Number(btn.dataset.id), btn);
      });
    }

    /* ② 地點（下拉：全部 / 我附近 / 各國）＋台灣縣市 */
    const NEAR = '__near__';
    const countryCount = {};
    SPOTS.forEach(s => { const c = countryOf(s.region); countryCount[c] = (countryCount[c] || 0) + 1; });
    const countryList = Object.keys(countryCount).sort((a, b) => {
      if (a === '台灣') return -1;
      if (b === '台灣') return 1;
      return countryCount[b] - countryCount[a] || a.localeCompare(b, 'zh-Hant');
    });
    $('#place').innerHTML =
      '<option value="">② 地點：🌏 全部</option>' +
      `<option value="${NEAR}">② 地點：📍 我附近（用定位）</option>` +
      countryList.map(c => `<option value="${esc(c)}">${esc(c)}（${countryCount[c]}）</option>`).join('');

    /* 縣市（僅台灣）：細分到縣市 */
    const countyCount = {};
    SPOTS.forEach(s => { const c = twCounty(s.region); if (c) countyCount[c] = (countyCount[c] || 0) + 1; });
    const countyList = Object.keys(countyCount).sort((a, b) =>
      countyCount[b] - countyCount[a] || a.localeCompare(b, 'zh-Hant'));
    $('#county').innerHTML = '<option value="">全部縣市</option>' +
      countyList.map(c => `<option value="${esc(c)}">${esc(c)}（${countyCount[c]}）</option>`).join('');
    $('#county').addEventListener('change', e => { state.county = e.target.value; state.near = false; render(); });

    $('#place').addEventListener('change', e => {
      const v = e.target.value;
      if (v === NEAR) { locate(true); return; }   // 步驟②選「我附近」→ 定位 + 依距離排序 + 50 公里視野
      state.country = v;
      state.near = false;                          // 離開「我附近」→ 視野交還給篩選結果
      const isTW = v === '台灣';
      $('#county').hidden = !isTW;
      if (!isTW) { state.county = ''; $('#county').value = ''; }
      openNearby(false);
      render();
    });

    /* ① 飾品類型（下拉、單選；先選類型再選地點） */
    const catCount = {};
    SPOTS.forEach(s => { catCount[s.category_label] = (catCount[s.category_label] || 0) + 1; });
    const cats = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
    $('#decor').innerHTML = '<option value="">① 飾品類型：全部</option>' +
      cats.map(([k, v]) => `<option value="${esc(k)}">${esc(k)}（${v}）</option>`).join('');
    const syncTypeUI = () => { $('#decor').value = state.category || ''; };
    $('#decor').addEventListener('change', e => {
      state.category = e.target.value || null;
      syncTypeUI();
      toast(state.category ? `① ${state.category}（${catCount[state.category]} 個）` : '① 飾品類型：全部');
      render();
      if (state.origin) showNearby();
    });

    /* toast */
    let toastT;
    function toast(msg, isErr) {
      const t = $('#toast');
      t.textContent = msg;
      t.classList.toggle('err', !!isErr);
      t.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(() => t.classList.remove('on'), isErr ? 2600 : 1800);
    }

    /* sort button cycles */
    const SORTS = [['distance', '距離'], ['newest', '最新'], ['confirms', '確認數']];
    function syncSortBtn() {
      const cur = SORTS.find(s => s[0] === state.sortMode);
      $('#btnSort').textContent = '↕️ 排序：' + (cur ? cur[1] : '距離');
    }

    function syncVisitedMarkers() {
      if (APPLE) return;   // MapKit 用原生 pin，不吃 CSS class
      layers.forEach((m, id) => {
        const el = m.getElement();
        if (el) el.classList.toggle('visited', visited.has(id));
      });
    }

    function toggleVisit(id, btn) {
      if (visited.has(id)) visited.delete(id); else visited.add(id);
      saveVisited();
      syncVisitedMarkers();
      if (btn) btn.textContent = visited.has(id) ? '✓ 已踩過（點擊取消）' : '☐ 標記為踩過';
      $('#visitedCount').textContent = visited.size;
      toast(visited.has(id) ? '已標記踩過 ✅' : '已取消標記');
    }

    /** 把地圖框到「以 (lat,lng) 為中心、半徑 radiusM」的範圍（Leaflet / MapKit 共用） */
    function showRegion(lat, lng, radiusM) {
      const b = regionBounds(lat, lng, radiusM);
      if (APPLE) { APPLE.showBox(b[0], b[1]); return; }
      map.fitBounds(L.latLngBounds(b), { padding: [0, 0], animate: false });
    }

    /* 點一個純點：iOS 開資訊面板、web 用 Leaflet popup */
    function openSpot(id) {
      const s = SPOTS.find(x => String(x.id) === String(id));
      if (!s) return;
      if (APPLE) {
        APPLE.goTo(s.lat, s.lng, 17);
        $('#spotBody').innerHTML = popupHTML(s);
        const btn = $('#spotBody').querySelector('.visitbtn');
        if (btn) btn.onclick = () => toggleVisit(Number(btn.dataset.id), btn);
        openNearby(false);
        $('#spot').classList.add('on');
      } else {
        map.setView([s.lat, s.lng], 17);
        const m = layers.get(s.id);
        if (m && clusters.hasLayer(m)) setTimeout(() => m.openPopup(), 250);
      }
    }
    $('#spotClose').onclick = () => $('#spot').classList.remove('on');

    /* render（async：MapKit 的 marker 增減是原生呼叫）
     * 用單一鎖序列化：開場的 render 和定位完的 render 會撞在一起，
     * 若並行跑，後者會拿到「還沒更新」的 appleIds → 同 8702 個標記再加一次
     * （build 5 就是這樣變成 17404 個原生標記 → 頓 + 閃退）。*/
    async function render() {
      if (rendering) { renderAgain = true; return; }
      rendering = true;
      try {
        await renderOnce();
      } finally {
        rendering = false;
        if (renderAgain) { renderAgain = false; render(); }
      }
    }

    async function renderOnce() {
      const rows = sortSpots(applyFilters(SPOTS, {
        country: state.country, county: state.county, category: state.category,
        namedOnly: state.namedOnly, confirmedOnly: state.confirmedOnly, showCandidates: state.showCandidates,
        visitedOnly: state.visitedOnly, visitedSet: visited,
      }), state.sortMode, state.origin);
      state.rows = rows;

      if (APPLE) {
        // 差集更新：只新增/移除有變動的點，不用每次重畫。
        // 而且只看視野內的點（50km 視野 ≈ 1771 點，全圖是 8702 點），避免原生標記爆量。
        if (!viewBox) viewBox = await APPLE.getBounds();   // 開場先跟原生要目前視野
        let cand = withinBox(rows, viewBox);
        if (cand.length > MAX_MARKERS && viewBox) {
          const cLat = (viewBox[0][0] + viewBox[1][0]) / 2;
          const cLng = (viewBox[0][1] + viewBox[1][1]) / 2;
          cand = cand.slice()
            .sort((a, b) => haversine(cLat, cLng, a.lat, a.lng) - haversine(cLat, cLng, b.lat, b.lng))
            .slice(0, MAX_MARKERS);
        }
        const wantIds = new Set(cand.map(s => String(s.id)));
        const toAdd = cand.filter(s => !appleIds.has(String(s.id)));
        const toRemove = [...appleIds].filter(id => !wantIds.has(id));
        appleIds = wantIds;                 // ← 先更新再叫原生（並行才不會重複加）
        if (toRemove.length) await APPLE.removeMarkers(toRemove);
        if (toAdd.length) await APPLE.addMarkers(toAdd);
        // 相機不在這裡動：「我附近」的 50km 視野只由 locate() 設定，
        // 否則 idle → render → fitBounds 會無限迴圈
        if (!state.near && rows.length) await APPLE.fit(rows);
      } else {
        clusters.clearLayers();
        const pts = [];
        rows.forEach(s => { const m = layers.get(s.id); if (m) pts.push(m); });
        if (pts.length) clusters.addLayers(pts);
        if (!state.near && rows.length) {
          map.fitBounds(L.latLngBounds(rows.map(s => [s.lat, s.lng])),
            { padding: [40, 40], maxZoom: 15 });
        }
        syncVisitedMarkers();
      }
      $('#shown').textContent = rows.length;
      $('#visitedCount').textContent = visited.size;
      syncSortBtn();
    }

    /* events */
    $('#btnSort').onclick = () => {
      const i = SORTS.findIndex(s => s[0] === state.sortMode);
      state.sortMode = SORTS[(i + 1) % SORTS.length][0];
      if (state.sortMode === 'distance' && !state.origin) locate(false);
      render();
    };
    /* 「待確認」開關：預設只顯示已驗證的點；打開才顯示 OSM 候選點 */
    $('#btnCand').onclick = () => {
      state.showCandidates = !state.showCandidates;
      $('#btnCand').textContent = state.showCandidates ? '🔍 待確認：開' : '🔍 待確認：關';
      toast(state.showCandidates
        ? '顯示「待確認」候選點（OSM 來源，尚未經社群驗證）'
        : '只顯示社群已驗證的點');
      render();
    };

    $('#btnReset').onclick = () => {
      state.country = ''; state.county = ''; state.category = null;
      state.namedOnly = false; state.confirmedOnly = false; state.visitedOnly = false;
      $('#decor').value = '';
      $('#place').value = '';
      $('#county').value = ''; $('#county').hidden = true;
      syncTypeUI();
      openNearby(false);
      $('#spot').classList.remove('on');
      $('#relocate').hidden = true;
      toast('已重設');
      render();
    };

    /* geolocation — 優先用 Capacitor 原生 Geolocation，沒包殼時退回瀏覽器 API */
    function getGeo() {
      const cap = (window.Capacitor && window.Capacitor.Plugins &&
        window.Capacitor.Plugins.Geolocation) || null;
      if (cap && typeof cap.getCurrentPosition === 'function') {
        return cap.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
          .then(p => ({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }));
      }
      return new Promise((res, rej) => {
        if (!navigator.geolocation) return rej(new Error('unsupported'));
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
          rej, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
    }

    /* 我的位置圖層：藍點 + 精確度圓 */
    let meLayer = null, accLayer = null;
    function showMe(o) {
      if (APPLE) { APPLE.showMe(true); return; }   // MapKit 原生藍點
      const ll = [o.lat, o.lng];
      const icon = L.divIcon({ className: '', html: '<div id="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
      if (!meLayer) {
        meLayer = L.marker(ll, { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
        accLayer = L.circle(ll, { radius: o.acc || 50, color: '#3b82f6', weight: 1,
          opacity: .5, fillColor: '#3b82f6', fillOpacity: .12, interactive: false }).addTo(map);
      } else {
        meLayer.setLatLng(ll);
        if (accLayer) { accLayer.setLatLng(ll); accLayer.setRadius(o.acc || 50); }
      }
    }

    /* 附近純點清單（依目前篩選結果排序後取前 15） */
    function showNearby() {
      if (!state.origin) return;
      const rows = state.rows.slice(0, 15);
      $('#nearbyCount').textContent = rows.length ? `（最近 ${rows.length} 個）` : '';
      $('#nearbyList').innerHTML = rows.map(s => {
        const d = fmtDist(haversine(state.origin.lat, state.origin.lng, s.lat, s.lng));
        return `<button class="nrow" data-id="${s.id}">
          <span><span class="nm">${esc(s.name || '(未命名)')}</span>
          <br><span class="sub">${esc(s.category_label)} · ${esc(s.region || '')}</span></span>
          <span class="d">${d}</span></button>`;
      }).join('') || '<div class="sheetclose">這組篩選附近沒有純點</div>';
      $('#nearbyList').querySelectorAll('.nrow').forEach(el => el.onclick = () => {
        const s = SPOTS.find(x => x.id === Number(el.dataset.id));
        if (!s) return;
        openNearby(false);
        openSpot(s.id);
      });
    }
    const openNearby = on => $('#nearby').classList.toggle('on', on);
    $('#nearbyClose').onclick = () => openNearby(false);

    function locate(showToast, opts) {
      const quiet = !!(opts && opts.quiet);      // 開場自動定位：不跳 toast、不自動開清單
      if (!quiet) toast('定位中…');
      getGeo().then(o => {
        state.origin = { lat: o.lat, lng: o.lng };
        state.sortMode = 'distance';
        state.near = true;                        // 地圖框回定位點 50 公里
        showMe(o);
        render();                                 // render 內依 state.near 決定視野
        showRegion(o.lat, o.lng, NEAR_RADIUS_M);
        showNearby();
        if (!quiet) openNearby(true);
        $('#relocate').hidden = false;
        if (showToast) toast('已定位，依距離排序 ✅');
      }).catch(err => {
        const msg = String(err && (err.message || err.code) || '');
        if ($('#place').value === NEAR) $('#place').value = '';   // 定位失敗退回「全部」
        state.near = false;
        $('#relocate').hidden = true;
        if (showToast) toast(msg.includes('denied') || msg.includes('permission') || msg.includes('User denied')
          ? '定位被拒（請到設定允許）' : '定位失敗，請再試一次', true);
      });
    }
    $('#relocate').onclick = () => locate(true);

    /* PWA install prompt */
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredPrompt = e;
      $('#install').hidden = false;
    });
    $('#install').onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('#install').hidden = true;
    };

    /* init */
    $('#total').textContent = SPOTS.length;
    $('#visitedCount').textContent = visited.size;
    syncTypeUI();
    syncSortBtn();
    render();

    // 開場就抓 GPS：帶出定位藍點，地圖框到定位點半徑 50 公里（安靜模式：不跳 toast、不自動開清單）
    locate(false, { quiet: true });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        // 版本查詢字串：繞過 Cloudflare 快取，確保新版 sw 一定被抓到
        navigator.serviceWorker.register('sw.js?v=7').catch(() => {});
      });
    }
  })();
}
