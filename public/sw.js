const CACHE = 'mytools-shell-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/icon.svg', '/manifest.webmanifest']))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); } return res; }).catch(() => caches.match('/')));
  } else if (url.pathname.startsWith('/assets/') || ['/icon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); } return res; })));
  }
});
