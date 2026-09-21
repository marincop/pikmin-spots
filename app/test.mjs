import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const app = require('./app.js');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

// load real spots data
const spotsSrc = readFileSync(join(__dirname, 'data/spots.js'), 'utf8');
const SPOTS = JSON.parse(spotsSrc.replace(/^window\.PIKMIN_SPOTS\s*=\s*/, '').replace(/;\s*$/, ''));

console.log('data:');
ok('spots loaded & non-trivial', () => assert(SPOTS.length > 1000));
ok('each spot has required fields', () => {
  for (const s of SPOTS) {
    assert.equal(typeof s.id, 'number');
    assert.equal(typeof s.lat, 'number');
    assert.equal(typeof s.lng, 'number');
    assert.equal(typeof s.category_label, 'string');
  }
});

console.log('countryOf:');
ok('TW region -> 台灣', () => assert.equal(app.countryOf('桃園市中壢區'), '台灣'));
ok('overseas prefix stripped', () => assert.equal(app.countryOf('__overseas__香港'), '香港'));
ok('香港 bare', () => assert.equal(app.countryOf('香港'), '香港'));
ok('日本', () => assert.equal(app.countryOf('日本東京台場'), '日本'));
ok('美國', () => assert.equal(app.countryOf('美國加利福尼亞英格爾伍德'), '美國'));
ok('unknown -> 其他', () => assert.equal(app.countryOf('火星'), '其他'));
ok('empty -> 其他', () => assert.equal(app.countryOf(''), '其他'));
ok('every spot maps to a country', () => {
  const set = new Set(SPOTS.map(s => app.countryOf(s.region)));
  assert(set.size >= 2 && set.size < 40, 'country count ' + set.size);
  assert(!set.has(''), 'no empty country');
});

console.log('haversine:');
ok('~111km per degree lat', () => {
  const d = app.haversine(25, 121, 26, 121);
  assert(d > 110000 && d < 112000, String(d));
});
ok('zero distance', () => assert.equal(app.haversine(25, 121, 25, 121), 0));

console.log('applyFilters:');
ok('no opts -> all', () => assert.equal(app.applyFilters(SPOTS, {}).length, SPOTS.length));
ok('country filter', () => {
  const tw = app.applyFilters(SPOTS, { country: '台灣' });
  assert(tw.length > 0 && tw.every(s => app.countryOf(s.region) === '台灣'));
});
ok('single category filter', () => {
  const r = app.applyFilters(SPOTS, { category: '🍀 公園' });
  assert(r.length > 0 && r.every(s => s.category_label === '🍀 公園'));
});
ok('no category -> all categories', () => {
  assert.equal(app.applyFilters(SPOTS, { category: null }).length, SPOTS.length);
});
ok('confirmedOnly', () => {
  const r = app.applyFilters(SPOTS, { confirmedOnly: true });
  assert(r.every(s => s.confirms > 0));
});
ok('namedOnly', () => {
  const r = app.applyFilters(SPOTS, { namedOnly: true });
  assert(r.every(s => s.name));
});
ok('visitedOnly uses set', () => {
  const id = SPOTS[0].id;
  const r = app.applyFilters(SPOTS, { visitedOnly: true, visitedSet: new Set([id]) });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, id);
});
ok('combined country + category AND', () => {
  const r = app.applyFilters(SPOTS, { country: '台灣', category: '🍀 公園' });
  assert(r.every(s => app.countryOf(s.region) === '台灣' && s.category_label === '🍀 公園'));
});

console.log('twCounty (台灣縣市):');
ok('桃園市中壢區 -> 桃園市', () => assert.equal(app.twCounty('桃園市中壢區'), '桃園市'));
ok('臺→台 正規化', () => assert.equal(app.twCounty('臺中市東勢區'), '台中市'));
ok('宜蘭縣宜蘭市 -> 宜蘭縣', () => assert.equal(app.twCounty('宜蘭縣宜蘭市'), '宜蘭縣'));
ok('重複市名 台中市台中市北區 -> 台中市', () => assert.equal(app.twCounty('台中市台中市北區'), '台中市'));
ok('非台灣 -> 空', () => assert.equal(app.twCounty('__overseas__香港'), ''));
ok('美國 -> 空', () => assert.equal(app.twCounty('美國加利福尼亞英格爾伍德'), ''));
ok('無縣市前綴 -> 空', () => assert.equal(app.twCounty('中壢區'), ''));
ok('裸地名 桃園 -> 桃園市', () => assert.equal(app.twCounty('桃園'), '桃園市'));
ok('裸地名 屏東 -> 屏東縣', () => assert.equal(app.twCounty('屏東'), '屏東縣'));
ok('前綴地名 台中機場 -> 台中市', () => assert.equal(app.twCounty('台中機場'), '台中市'));
ok('TW 縣市數量合理', () => {
  const set = new Set(SPOTS.map(s => app.twCounty(s.region)).filter(Boolean));
  assert(set.size >= 10, 'county count ' + set.size);
});

console.log('applyFilters (county):');
ok('county filter narrows within 台灣', () => {
  const r = app.applyFilters(SPOTS, { country: '台灣', county: '桃園市' });
  assert(r.length > 0 && r.every(s => app.twCounty(s.region) === '桃園市'));
});
ok('county without country still filters', () => {
  const r = app.applyFilters(SPOTS, { county: '高雄市' });
  assert(r.length > 0 && r.every(s => app.twCounty(s.region) === '高雄市'));
});

console.log('nextCategory (single-select):');
ok('none -> select', () => assert.deepEqual(app.nextCategory(null, 'A'), { value: 'A', error: false }));
ok('same -> deselect', () => assert.deepEqual(app.nextCategory('A', 'A'), { value: null, error: false }));
ok('different while one active -> error, keep first', () =>
  assert.deepEqual(app.nextCategory('A', 'B'), { value: 'A', error: true }));
ok('error never returns the tapped value', () => {
  const r = app.nextCategory('A', 'B');
  assert.equal(r.error, true);
  assert.notEqual(r.value, 'B');
});

console.log('sortSpots:');
ok('newest = id desc', () => {
  const r = app.sortSpots(SPOTS, 'newest');
  for (let i = 1; i < Math.min(r.length, 500); i++) assert(r[i - 1].id >= r[i].id);
});
ok('confirms desc', () => {
  const r = app.sortSpots(SPOTS, 'confirms');
  for (let i = 1; i < Math.min(r.length, 500); i++) assert(r[i - 1].confirms >= r[i].confirms);
});
ok('name asc', () => assert.equal(app.sortSpots(SPOTS, 'name').length, SPOTS.length));
ok('distance from origin is ascending', () => {
  const origin = { lat: 25.033, lng: 121.565 };
  const r = app.sortSpots(SPOTS, 'distance', origin);
  for (let i = 1; i < Math.min(r.length, 500); i++) {
    const a = app.haversine(origin.lat, origin.lng, r[i - 1].lat, r[i - 1].lng);
    const b = app.haversine(origin.lat, origin.lng, r[i].lat, r[i].lng);
    assert(a <= b + 1e-6, `${a} > ${b}`);
  }
});
ok('distance without origin falls back to newest', () => {
  const r = app.sortSpots(SPOTS, 'distance', null);
  for (let i = 1; i < Math.min(r.length, 200); i++) assert(r[i - 1].id >= r[i].id);
});
ok('does not mutate input', () => {
  const before = SPOTS.map(s => s.id).join();
  app.sortSpots(SPOTS, 'confirms');
  assert.equal(SPOTS.map(s => s.id).join(), before);
});

console.log('fmtDist:');
ok('null -> empty', () => assert.equal(app.fmtDist(null), ''));
ok('meters', () => assert.equal(app.fmtDist(540), '540 m'));
ok('km 1dp', () => assert.equal(app.fmtDist(1500), '1.5 km'));
ok('km 0dp over 10km', () => assert.equal(app.fmtDist(23456), '23 km'));

console.log('navURL:');
ok('apple -> maps.apple.com daddr, no saddr (starts from current location)', () => {
  const u = app.navURL(25.033, 121.565, 'apple');
  assert.equal(u, 'https://maps.apple.com/?daddr=25.033,121.565&dirflg=d');
  assert(!u.includes('saddr'), 'must not pin a start point');
});
ok('google fallback -> /maps/dir/?destination=...', () => {
  const u = app.navURL(25.033, 121.565, 'google');
  assert.equal(u, 'https://www.google.com/maps/dir/?api=1&destination=25.033,121.565&travelmode=driving');
  assert(!u.includes('origin='), 'must not pin a start point');
});
ok('negative lng survives (west hemisphere)', () => {
  assert(app.navURL(-33.86, -151.21, 'apple').includes('daddr=-33.86,-151.21'));
});

console.log('navPlatform:');
ok('iPhone/iPad/Mac -> apple', () => {
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  ]) assert.equal(app.navPlatform(ua), 'apple', ua);
});
ok('Android/Windows -> google', () => {
  for (const ua of [
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130',
  ]) assert.equal(app.navPlatform(ua), 'google', ua);
});
ok('empty ua does not crash', () => assert.equal(app.navPlatform(undefined), 'google'));

console.log('regionBounds:');
ok('50km box is ~100km tall', () => {
  const [[s], [n]] = app.regionBounds(25.033, 121.565, 50000);
  const h = app.haversine(s, 121.565, n, 121.565);
  assert(Math.abs(h - 100000) < 500, `height ${h}`);
});
ok('50km box is ~100km wide at that latitude', () => {
  const [[s, w], [n, e]] = app.regionBounds(25.033, 121.565, 50000);
  const mid = (s + n) / 2;
  const wd = app.haversine(mid, w, mid, e);
  assert(Math.abs(wd - 100000) < 1500, `width ${wd}`);
});
ok('center is preserved', () => {
  const [[s, w], [n, e]] = app.regionBounds(25.033, 121.565, 50000);
  assert(Math.abs((s + n) / 2 - 25.033) < 1e-9 && Math.abs((w + e) / 2 - 121.565) < 1e-9);
});
ok('south/north ordering (s < n)', () => {
  const box = app.regionBounds(-33.86, 151.21, 50000);
  assert(box[0][0] < box[1][0] && box[0][1] < box[1][1]);
});
ok('no crash at the poles', () => {
  const box = app.regionBounds(89.9, 0, 50000);
  assert(box.every(p => p.every(v => Number.isFinite(v))));
});

console.log(`\n${pass} checks passed ✅`);
