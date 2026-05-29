const CACHE = 'marine-tiles-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Intercept tile requests and serve from cache if available
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isTile = url.includes('tile.openstreetmap.org') ||
                 url.includes('openseamap.org') ||
                 url.includes('opentopomap.org');
  if (!isTile) return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached || new Response('', {status: 503}));
      })
    )
  );
});

// Message: cache tiles for given URLs
self.addEventListener('message', e => {
  if (e.data.type === 'CACHE_TILES') {
    cacheTiles(e.data.urls, e.ports[0]);
  }
  if (e.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE).then(() => {
      e.ports[0].postMessage({type:'CLEARED'});
    });
  }
  if (e.data.type === 'CACHE_SIZE') {
    getCacheSize(e.ports[0]);
  }
});

async function cacheTiles(urls, port) {
  const cache = await caches.open(CACHE);
  let done = 0, failed = 0;
  const total = urls.length;
  const BATCH = 8;

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await Promise.all(batch.map(async url => {
      try {
        const cached = await cache.match(url);
        if (!cached) {
          const res = await fetch(url, {mode:'cors'});
          if (res.ok) await cache.put(url, res);
        }
        done++;
      } catch {
        failed++;
        done++;
      }
      port.postMessage({type:'PROGRESS', done, total, failed});
    }));
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 50));
  }
  port.postMessage({type:'DONE', done, total, failed});
}

async function getCacheSize(port) {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  port.postMessage({type:'SIZE', count: keys.length});
}
