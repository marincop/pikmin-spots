/* 皮克敏純點地圖 — service worker
 * App shell: cache-first (instant + offline).
 * CDN (leaflet/unpkg) & map tiles: cache-first with background refresh, so the
 * map still works offline after the first online visit.
 */
'use strict';

const VERSION = 'pikmin-v4';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './data/spots.js?v=4',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Don't try to cache chrome-extension / non-http schemes.
  if (!/^https?:$/.test(url.protocol)) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: false });

    // Navigation: serve shell when offline.
    if (req.mode === 'navigate') {
      try {
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return cached || (await cache.match('./index.html')) || Response.error();
      }
    }

    if (cached) {
      // Background refresh (stale-while-revalidate), ignore failures offline.
      fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {});
      return cached;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
