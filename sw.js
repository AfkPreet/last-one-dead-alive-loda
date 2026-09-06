/* sw.js — offline cache. Network-first for navigations so a deploy is picked up
 * immediately; cache-first for the static assets. Bump CACHE to invalidate.
 */
var CACHE = 'last-one-dead-v1';
var ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/rng.js', './js/platform.js', './js/input.js', './js/audio.js',
  './js/juice.js', './js/render.js', './js/game.js', './js/share.js', './js/main.js',
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
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      })['catch'](function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })['catch'](function () { return caches.match('./index.html'); })
  );
});
