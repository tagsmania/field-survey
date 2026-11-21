/* 제다 실사 서비스워커 : 앱 셸은 캐시 우선, 지도 타일은 런타임 캐시(상한), data/ 는 캐시하지 않음 */
const VERSION = 'v0.3.8';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const TILE_MAX = 4000;
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/jszip.min.js',
  'vendor/images/layers.png', 'vendor/images/layers-2x.png', 'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(TILES); const keys = await c.keys(); if (keys.length > TILE_MAX) for (const k of keys.slice(0, keys.length - TILE_MAX)) await c.delete(k); }
  finally { trimming = false; }
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES); const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok && res.type !== 'opaque') { c.put(req, res.clone()); if (Math.random() < 0.05) trimTiles(); } return res; }
      catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/data/')) return; // 실사 패키지 · 샘플은 캐시하지 않음
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true }); if (hit) return hit;
    try { return await fetch(req); } catch (err) { const shell = await caches.match('index.html'); return shell || new Response('offline', { status: 503 }); }
  })());
});
