const CACHE_APP = 'marine-app-v2';   // ← index.html更新時にここを上げる
const CACHE_TILES = 'marine-tiles-v1'; // ← タイルキャッシュは別管理

// App shell files to cache on install
const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap',
];

// Install: cache app shell immediately
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP).then(cache => {
      return Promise.allSettled(
        APP_FILES.map(url => cache.add(url).catch(err => console.warn('Cache miss:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('marine-app-') && k !== CACHE_APP)
            .map(k => { console.log('Delete old cache:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isTile = url.includes('tile.openstreetmap.org') ||
                 url.includes('openseamap.org') ||
                 url.includes('opentopomap.org');

  if (isTile) {
    // Tiles: cache-first
    e.respondWith(
      caches.open(CACHE_TILES).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request, {signal: AbortSignal.timeout(8000)})
            .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
            .catch(() => new Response('', {status: 503}));
        })
      )
    );
    return;
  }

  // App shell: cache-first, fallback to network
  e.respondWith(
    caches.open(CACHE_APP).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request)
          .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
          .catch(() => caches.match('./index.html'));
      })
    )
  );
});

// Message handlers
self.addEventListener('message', e => {
  if (e.data.type === 'CACHE_TILES') cacheTiles(e.data.urls, e.ports[0]);
  if (e.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_TILES).then(() => e.ports[0].postMessage({type:'CLEARED'}));
  }
  if (e.data.type === 'CACHE_SIZE') getCacheSize(e.ports[0]);
});

async function cacheTiles(urls, port) {
  const cache = await caches.open(CACHE_TILES);
  let done = 0, failed = 0;
  const total = urls.length;
  const BATCH = 3;

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await Promise.all(batch.map(async url => {
      try {
        const cached = await cache.match(url);
        if (!cached) {
          const res = await fetch(url, {mode:'cors', signal: AbortSignal.timeout(6000)});
          if (res.ok) await cache.put(url, res);
        }
        done++;
      } catch { failed++; done++; }
      port.postMessage({type:'PROGRESS', done, total, failed});
    }));
    await new Promise(r => setTimeout(r, 100));
  }
  port.postMessage({type:'DONE', done, total, failed});
}

async function getCacheSize(port) {
  const cache = await caches.open(CACHE_TILES);
  const keys = await cache.keys();
  port.postMessage({type:'SIZE', count: keys.length});
}
