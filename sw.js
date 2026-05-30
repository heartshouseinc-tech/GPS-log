// Marine Tracker Service Worker
// アプリHTML/JS/CSS: キャッシュしない（常に最新を取得）
// 地図タイル: キャッシュする（オフライン対応）

const CACHE_TILES = 'marine-tiles-v1'; // タイルキャッシュは変えない

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 地図タイルのみキャッシュ
  const isTile = url.includes('tile.openstreetmap.org') ||
                 url.includes('openseamap.org') ||
                 url.includes('opentopomap.org');

  if (isTile) {
    // タイル: キャッシュ優先、なければネット取得してキャッシュ
    e.respondWith(
      caches.open(CACHE_TILES).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request, {signal: AbortSignal.timeout(8000)})
            .then(res => {
              if (res.ok) cache.put(e.request, res.clone());
              return res;
            }).catch(() => new Response('', {status: 503}));
        })
      )
    );
    return;
  }

  // アプリファイル: 常にネットから取得、失敗時のみキャッシュ使用
  // これによりindex.htmlは常に最新版が使われる
  if (url.includes('github.io') || url.includes('cdnjs') || url.includes('fonts.googleapis')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // 成功したら一時キャッシュに保存（オフライン起動用）
          if (res.ok) {
            const clone = res.clone();
            caches.open('marine-app-temp').then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // オフライン時は一時キャッシュから返す
          return caches.match(e.request, {cacheName: 'marine-app-temp'})
            || new Response('Offline', {status: 503});
        })
    );
    return;
  }
});

// メッセージハンドラ
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
