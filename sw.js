/* Service worker: offline app shell + daily review push notifications. */
importScripts('js/scheduler.js', 'js/db.js');

const CACHE = 'karticky-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/config.js',
  'js/scheduler.js',
  'js/db.js',
  'js/images.js',
  'js/reminders.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network first so updates show up immediately; cache is the offline fallback.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch {
      return (await caches.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    }
  })());
});

function plural(n, one, few, many) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

// The push carries no payload; the count comes from the cards on this device.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let due = 0;
    let breakdown = '';
    try {
      const [cards, decks] = await Promise.all([DB.all(), DB.decks()]);
      const perDeck = {};
      for (const c of cards) {
        if (!Leitner.isDue(c)) continue;
        due++;
        perDeck[c.deckId] = (perDeck[c.deckId] || 0) + 1;
      }
      // With more than one set due, say how the cards split, e.g. "(Angličtina 5, Matematika 3)".
      const parts = decks.filter((d) => perDeck[d.id]).map((d) => `${d.name} ${perDeck[d.id]}`);
      if (parts.length > 1) breakdown = ` (${parts.join(', ')})`;
    } catch { /* fall through to the generic message */ }

    if (self.navigator.setAppBadge) {
      try {
        if (due) await self.navigator.setAppBadge(due);
        else await self.navigator.clearAppBadge();
      } catch { /* badges are optional */ }
    }

    const body = due
      ? `Dnes máte ${due} ${plural(due, 'kartu', 'karty', 'karet')} k opakování${breakdown}.`
      : 'Je čas na opakování kartiček.';
    await self.registration.showNotification('Kartičky', {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'daily-review',
      data: { url: './#/review' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
