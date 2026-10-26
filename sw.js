// Allurus service worker: keeps a copy of the app so the check-in page opens without a connection.
// Pages are fetched from the network first (falling back to the saved copy offline); scripts, styles, images and
// the face-check models are served from the saved copy and refreshed in the background. Check-ins taken offline
// wait in the app's outbox (js/kiosk.js) and sync when the phone is back online.
const CACHE = 'allurus-v3.6';
const SHELL = ['./', 'index.html', 'assets/logo-mark.svg'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('allurus-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (ev) => {
  const req = ev.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    ev.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return res; })
      .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))));
    return;
  }
  ev.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
// Clicking a browser notification opens (or focuses) Allurus on the page it links to.
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const href = ev.notification.data?.href || '';
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list[0];
    if (c) { c.postMessage({ href }); return c.focus(); }
    return self.clients.openWindow(`./index.html${href}`);
  }));
});
