/* 皮克敏純點地圖 — mobile PWA app logic
 *
 * Pure helpers (countryOf / haversine / applyFilters / sortSpots) are exported
 * for node tests; see test.mjs. DOM/bootstrap code only runs in a browser.
 */
'use strict';

/* ---------- pure logic (node-testable) ---------- */

const TW_PREFIX = /^(台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江)/;

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
  ['阿拉伯', /阿拉伯|阿聯|杜拜|杜拜|شارع/],
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

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function applyFilters(spots, opt) {
  const o = opt || {};
  const q = (o.q || '').trim().toLowerCase();
  const cats = o.categories && o.categories.size ? o.categories : null;
  const visited = o.visitedSet || null;
  return spots.filter(s => {
    if (o.country && countryOf(s.region) !== o.country) return false;
    if (cats && !cats.has(s.category_label)) return false;
    if (o.namedOnly && !s.name) return false;
    if (o.confirmedOnly && !(s.confirms > 0)) return false;
    if (o.visitedOnly && !(visited && visited.has(s.id))) return false;
    if (o.unvisitedOnly && visited && visited.has(s.id)) return false;
    if (q) {
      const hay = (s.name + ' ' + s.address + ' ' + s.region + ' ' + s.category_label).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { countryOf, haversine, applyFilters, sortSpots, fmtDist };
}

/* ---------- browser bootstrap ---------- */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    const SPOTS = window.PIKMIN_SPOTS || [];
    const $ = s => document.querySelector(s);
    const esc = s => String(s == null ? '' : s)
      .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const LS_VISITED = 'pikmin:visited';
    const visited = new Set(JSON.parse(localStorage.getItem(LS_VISITED) || '[]'));
    const saveVisited = () => localStorage.setItem(LS_VISITED, JSON.stringify([...visited]));

    const state = {
      q: '', country: '', categories: new Set(),
      namedOnly: false, confirmedOnly: false, visitedOnly: false,
      sortMode: 'distance', origin: null, rows: [],
    };

    /* map */
    const map = L.map('map', { worldCopyJump: true, zoomControl: false })
      .setView([23.9, 120.9], 7);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    const clusters = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 15 });
    map.addLayer(clusters);

    const gmLink = s => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`;

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
        <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap">
          <a href="${gmLink(s)}" target="_blank" rel="noopener">Google Maps ↗</a>
          <a href="https://pikdecor.com/spots/${s.id}" target="_blank" rel="noopener">pikdecor ↗</a>
        </div>
        <button class="visitbtn" data-id="${s.id}" style="margin-top:8px">${isV ? '✓ 已踩過（點擊取消）' : '☐ 標記為踩過'}</button>
      </div>`;
    }

    const layers = new Map();
    SPOTS.forEach(s => {
      const m = L.marker([s.lat, s.lng], { title: s.name || ('#' + s.id) });
      m.spot = s;
      m.bindPopup(() => popupHTML(s));
      layers.set(s.id, m);
    });

    map.on('popupopen', e => {
      const btn = e.popup.getElement() && e.popup.getElement().querySelector('.visitbtn');
      if (!btn) return;
      btn.onclick = () => {
        const id = Number(btn.dataset.id);
        if (visited.has(id)) visited.delete(id); else visited.add(id);
        saveVisited();
        syncVisitedMarkers();
        btn.textContent = visited.has(id) ? '✓ 已踩過（點擊取消）' : '☐ 標記為踩過';
        $('#visitedCount').textContent = visited.size;
        toast(visited.has(id) ? '已標記踩過 ✅' : '已取消標記');
      };
    });

    /* country chips */
    const chipCount = {};
    SPOTS.forEach(s => { const c = countryOf(s.region); chipCount[c] = (chipCount[c] || 0) + 1; });
    const chips = [['', '全部'], ...Object.entries(chipCount)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))];
    $('#countries').innerHTML = chips.map(([v, label]) =>
      `<button class="chip${v === '' ? ' on' : ''}" data-c="${esc(v)}">${esc(label)}${v ? ' ' + chipCount[v] : ''}</button>`
    ).join('');
    $('#countries').querySelectorAll('.chip').forEach(el => el.onclick = () => {
      state.country = el.dataset.c;
      $('#countries').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === el));
      render();
    });

    /* category sheet */
    const catCount = {};
    SPOTS.forEach(s => { catCount[s.category_label] = (catCount[s.category_label] || 0) + 1; });
    const cats = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
    $('#tgrid').innerHTML = cats.map(([k, v]) =>
      `<button class="tbtn" data-k="${esc(k)}"><span>${esc(k)}</span><span class="n">${v}</span></button>`
    ).join('');
    $('#tgrid').querySelectorAll('.tbtn').forEach(el => el.onclick = () => {
      const k = el.dataset.k;
      if (state.categories.has(k)) state.categories.delete(k); else state.categories.add(k);
      el.classList.toggle('on');
      updateTypeHint();
      render();
    });
    const updateTypeHint = () => {
      $('#typeHint').textContent = state.categories.size
        ? `（已選 ${state.categories.size} 類）` : '（可多選）';
    };
    const openTypes = on => $('#types').classList.toggle('on', on);

    /* toast */
    let toastT;
    function toast(msg) {
      const t = $('#toast');
      t.textContent = msg; t.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(() => t.classList.remove('on'), 1800);
    }

    /* sort button cycles */
    const SORTS = [['distance', '距離'], ['newest', '最新'], ['confirms', '確認數']];
    function syncSortBtn() {
      const cur = SORTS.find(s => s[0] === state.sortMode);
      $('#btnSort').textContent = '↕️ 排序：' + (cur ? cur[1] : '距離');
    }

    function syncVisitedMarkers() {
      layers.forEach((m, id) => {
        const el = m.getElement();
        if (el) el.classList.toggle('visited', visited.has(id));
      });
    }

    /* render */
    function render() {
      const rows = sortSpots(applyFilters(SPOTS, {
        q: state.q, country: state.country, categories: state.categories,
        namedOnly: state.namedOnly, confirmedOnly: state.confirmedOnly,
        visitedOnly: state.visitedOnly, visitedSet: visited,
      }), state.sortMode, state.origin);
      state.rows = rows;

      clusters.clearLayers();
      const pts = [];
      rows.forEach(s => { const m = layers.get(s.id); if (m) pts.push(m); });
      if (pts.length) clusters.addLayers(pts);
      if (rows.length) {
        map.fitBounds(L.latLngBounds(rows.map(s => [s.lat, s.lng])),
          { padding: [40, 40], maxZoom: 15 });
      }
      syncVisitedMarkers();
      $('#shown').textContent = rows.length;
      $('#visitedCount').textContent = visited.size;
      syncSortBtn();
    }

    /* events */
    let qT;
    $('#q').addEventListener('input', e => {
      clearTimeout(qT);
      const v = e.target.value;
      qT = setTimeout(() => { state.q = v; render(); }, 200);
    });
    $('#btnType').onclick = () => openTypes(true);
    $('#typeClose').onclick = () => openTypes(false);
    $('#btnSort').onclick = () => {
      const i = SORTS.findIndex(s => s[0] === state.sortMode);
      state.sortMode = SORTS[(i + 1) % SORTS.length][0];
      if (state.sortMode === 'distance' && !state.origin) { locate(false); }
      render();
    };
    $('#btnReset').onclick = () => {
      state.q = ''; state.country = ''; state.categories.clear();
      state.namedOnly = false; state.confirmedOnly = false; state.visitedOnly = false;
      $('#q').value = '';
      $('#countries').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x.dataset.c === ''));
      $('#tgrid').querySelectorAll('.tbtn').forEach(x => x.classList.remove('on'));
      updateTypeHint();
      toast('已重設');
      render();
    };

    /* geolocation */
    function locate(showToast) {
      if (!navigator.geolocation) { if (showToast) toast('此裝置不支援定位'); return; }
      toast('定位中…');
      navigator.geolocation.getCurrentPosition(pos => {
        state.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.sortMode = 'distance';
        map.setView([state.origin.lat, state.origin.lng], 14);
        if (showToast) toast('已定位，依距離排序');
        render();
      }, () => { if (showToast) toast('定位失敗（請允許定位權限）'); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    }
    $('#locate').onclick = () => locate(true);

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
    updateTypeHint();
    syncSortBtn();
    render();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  })();
}
