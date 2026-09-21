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
ok('category filter (multi via Set)', () => {
  const cats = new Set(['🍀 公園']);
  const r = app.applyFilters(SPOTS, { categories: cats });
  assert(r.length > 0 && r.every(s => s.category_label === '🍀 公園'));
});
ok('confirmedOnly', () => {
  const r = app.applyFilters(SPOTS, { confirmedOnly: true });
  assert(r.every(s => s.confirms > 0));
});
ok('namedOnly', () => {
  const r = app.applyFilters(SPOTS, { namedOnly: true });
  assert(r.every(s => s.name));
});
ok('search q matches name/address/region', () => {
  const r = app.applyFilters(SPOTS, { q: '台北' });
  assert(r.length > 0);
  assert(r.every(s => (s.name + s.address + s.region + s.category_label).includes('台北')));
});
ok('visitedOnly uses set', () => {
  const id = SPOTS[0].id;
  const r = app.applyFilters(SPOTS, { visitedOnly: true, visitedSet: new Set([id]) });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, id);
});
ok('combined filters AND', () => {
  const r = app.applyFilters(SPOTS, { country: '台灣', confirmedOnly: true });
  assert(r.every(s => app.countryOf(s.region) === '台灣' && s.confirms > 0));
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
ok('name asc', () => {
  const r = app.sortSpots(SPOTS, 'name');
  assert(r.length === SPOTS.length);
});
ok('distance from origin is ascending', () => {
  const origin = { lat: 25.033, lng: 121.565 }; // Taipei 101
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

console.log(`\n${pass} checks passed ✅`);
