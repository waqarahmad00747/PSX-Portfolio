// Caches the app shell only. Portfolio data lives in IndexedDB; backups/exports are never cached.
const CACHE = 'psx-shell-v18';
const SHELL = ['./', 'index.html', 'manifest.json', 'css/styles.css', 'js/calculations.js', 'js/storage.js', 'js/app.js', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => { if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))); });
