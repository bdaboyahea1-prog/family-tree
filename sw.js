// The service worker of the installed app.
//
// Its job is small and careful:
//   * the files of THIS site (pages, scripts, styles, icons) are asked for from the network first, and always
//     checked with the server (cache: 'no-cache'), so an update you publish reaches the app the next time it opens;
//   * a copy of each file is kept, and used only when the network fails (a weak connection, or none);
//   * anything from another address (the database, the sign-in, the fonts) is never touched: the browser handles it.
// Nothing about the family is ever stored here: the data comes from the database after signing in.
const CACHE = 'family-tree-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key); // a new version drops the old copies
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // not ours: leave it to the browser

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' }); // ask the server whether the copy is still the newest
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        const copy = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./') : null);
        if (copy) return copy;
        throw err;
      }
    })(),
  );
});
