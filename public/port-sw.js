/* YM-TRANSIT — service worker de l'application agent au port.
   Garde l'écran disponible sans réseau ; les données passent toujours par le réseau. */
const CACHE = 'ymt-port-v4.31';
const SHELL = ['/port', '/port-print.js', '/port-manifest.webmanifest', '/icons/port-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname) && url.pathname !== '/port/') return;
  // Réseau d'abord (toujours la dernière version), cache si hors ligne
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/port')))
  );
});
