/* sw.js — offline cache. Network-first for navigations so a deploy is picked up
 * immediately; cache-first for the static assets. Bump CACHE to invalidate.
 */
/* Bump CACHE on every deploy. Static assets are served cache-first, so a stale
 * cache name is not a slow update — it is a player permanently running last
 * week's code with this week's index.html. */
var CACHE = 'last-one-dead-v3';
var ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/rng.js', './js/platform.js', './js/input.js', './js/audio.js',
  './js/juice.js', './js/story.js', './js/render.js', './js/game.js',
  './js/share.js', './js/tutorial.js', './js/main.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Add individually: one 404 must not fail the whole install.
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u)['catch'](function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches['delete'](k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        // Only cache a real page: a 404 or a redirect to one must not become
        // the offline shell.
        if (res && res.ok && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        }
        return res;
      })['catch'](function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  // Stale-while-revalidate: answer instantly from cache, but always refresh it
  // in the background. Plain cache-first pins the first build a visitor ever
  // loaded, so a deploy would never reach anyone who had opened the game once.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () { return hit; });
      return hit || network;
    })
  );
});
