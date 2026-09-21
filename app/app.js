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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { countryOf, twCounty, haversine, applyFilters, nextCategory, sortSpots, fmtDist };
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
      country: '', county: '', category: null,
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
      const el = e.popup.getElement();
      const btn = el && el.querySelector('.visitbtn');
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

    /* 國家選擇（單選下拉） */
    const countryCount = {};
    SPOTS.forEach(s => { const c = countryOf(s.region); countryCount[c] = (countryCount[c] || 0) + 1; });
    const countryList = Object.keys(countryCount).sort((a, b) => {
      if (a === '台灣') return -1;
      if (b === '台灣') return 1;
      return countryCount[b] - countryCount[a] || a.localeCompare(b, 'zh-Hant');
    });
    $('#country').innerHTML = '<option value="">🌏 全部國家</option>' +
      countryList.map(c => `<option value="${esc(c)}">${esc(c)}（${countryCount[c]}）</option>`).join('');

    /* 縣市（僅台灣）：細分到縣市 */
    const countyCount = {};
    SPOTS.forEach(s => { const c = twCounty(s.region); if (c) countyCount[c] = (countyCount[c] || 0) + 1; });
    const countyList = Object.keys(countyCount).sort((a, b) =>
      countyCount[b] - countyCount[a] || a.localeCompare(b, 'zh-Hant'));
    $('#county').innerHTML = '<option value="">全部縣市</option>' +
      countyList.map(c => `<option value="${esc(c)}">${esc(c)}（${countyCount[c]}）</option>`).join('');
    $('#county').addEventListener('change', e => { state.county = e.target.value; render(); });

    $('#country').addEventListener('change', e => {
      state.country = e.target.value;
      const isTW = state.country === '台灣';
      $('#county').hidden = !isTW;
      if (!isTW) { state.county = ''; $('#county').value = ''; }
      render();
    });

    /* 飾品類型（只能選一種） */
    const catCount = {};
    SPOTS.forEach(s => { catCount[s.category_label] = (catCount[s.category_label] || 0) + 1; });
    const cats = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
    $('#tgrid').innerHTML = cats.map(([k, v]) =>
      `<button class="tbtn" data-k="${esc(k)}"><span>${esc(k)}</span><span class="n">${v}</span></button>`
    ).join('');
    const syncTypeUI = () => {
      $('#tgrid').querySelectorAll('.tbtn').forEach(x =>
        x.classList.toggle('on', x.dataset.k === state.category));
      $('#btnType').textContent = state.category ? '🍽️ ' + state.category : '🍽️ 飾品類型';
      $('#typeHint').textContent = state.category ? `（已選：${state.category}）` : '（只能選一種）';
    };
    $('#tgrid').querySelectorAll('.tbtn').forEach(el => el.onclick = () => {
      const tapped = el.dataset.k;
      const { value, error } = nextCategory(state.category, tapped);
      if (error) {
        toast(`⚠️ 飾品類型一次只能選一種，請先取消「${state.category}」`, true);
        return;
      }
      state.category = value;
      syncTypeUI();
      if (value) { toast('已選：' + value + '（僅顯示此類型）'); openTypes(false); }
      render();
    });
    const openTypes = on => $('#types').classList.toggle('on', on);

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
      layers.forEach((m, id) => {
        const el = m.getElement();
        if (el) el.classList.toggle('visited', visited.has(id));
      });
    }

    /* render */
    function render() {
      const rows = sortSpots(applyFilters(SPOTS, {
        country: state.country, county: state.county, category: state.category,
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
    $('#btnType').onclick = () => openTypes(true);
    $('#typeClose').onclick = () => openTypes(false);
    $('#btnSort').onclick = () => {
      const i = SORTS.findIndex(s => s[0] === state.sortMode);
      state.sortMode = SORTS[(i + 1) % SORTS.length][0];
      if (state.sortMode === 'distance' && !state.origin) locate(false);
      render();
    };
    $('#btnReset').onclick = () => {
      state.country = ''; state.county = ''; state.category = null;
      state.namedOnly = false; state.confirmedOnly = false; state.visitedOnly = false;
      $('#country').value = '';
      $('#county').value = ''; $('#county').hidden = true;
      syncTypeUI();
      openTypes(false);
      toast('已重設');
      render();
    };

    /* geolocation */
    function locate(showToast) {
      if (!navigator.geolocation) { if (showToast) toast('此裝置不支援定位', true); return; }
      toast('定位中…');
      navigator.geolocation.getCurrentPosition(pos => {
        state.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.sortMode = 'distance';
        map.setView([state.origin.lat, state.origin.lng], 14);
        if (showToast) toast('已定位，依距離排序');
        render();
      }, () => { if (showToast) toast('定位失敗（請允許定位權限）', true); },
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
    syncTypeUI();
    syncSortBtn();
    render();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        // 版本查詢字串：繞過 Cloudflare 快取，確保新版 sw 一定被抓到
        navigator.serviceWorker.register('sw.js?v=2').catch(() => {});
      });
    }
  })();
}
