/* YM-TRANSIT — service worker (appli agent au port + notifications du bureau).
   - Garde l'appli /port disponible sans réseau (les données passent toujours par le réseau)
   - Reçoit les notifications push et ouvre le bon écran au toucher */
const CACHE = 'ymt-port-v4.32';
const SHELL = ['/port', '/port-print.js', '/port-manifest.webmanifest', '/icons/port-192.png', '/icons/port-512.png', '/icons/badge-72.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const isShell = SHELL.includes(url.pathname) || url.pathname === '/port/';
  if (!isShell) return;
  // Réseau d'abord (toujours la dernière version), cache si hors ligne
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname === '/port/' ? '/port' : e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('/port')))
  );
});

// ── Notifications ────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'YM-TRANSIT';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icons/port-192.png',
      badge: '/icons/badge-72.png',
      tag: d.tag,
      renotify: !!d.tag,
      vibrate: [120, 60, 120],
      data: { url: d.url || '/' }
    }),
    // Prévenir les fenêtres ouvertes pour qu'elles se rafraîchissent
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage({ type: 'push', payload: d })))
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || '/', self.location.origin);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const wantsPort = target.pathname.startsWith('/port');
    const sameApp = cs.find(c => new URL(c.url).pathname.startsWith('/port') === wantsPort);
    if (sameApp) { sameApp.postMessage({ type: 'open', url: target.href }); return sameApp.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
