/*
 * Service worker: push notifications, and nothing else.
 *
 * The previous worker cached an app shell of the old Next.js pages and served
 * navigations network-first from that cache. Those pages no longer exist — the
 * site is the Expo web export now — so a phone still holding that cache would
 * open, offline or on a flaky connection, into a UI that has been deleted.
 *
 * So this version exists to undo that: on activate it deletes every cache it
 * can see (not just the old shell name, in case an even older one lingers) and
 * claims open tabs so the change takes effect without a second reload. There
 * is deliberately NO fetch handler. A worker without one never sits between
 * the page and the network, so it can never serve stale training data or a
 * stale bundle; the Expo export's hashed asset names and the CDN do the
 * caching. Existing installs pick this file up because `/sw.js` is served
 * no-cache (next.config.ts).
 */

self.addEventListener("install", () => {
  // Replace the old caching worker immediately rather than after every tab
  // using it has closed — that worker is the thing serving deleted pages.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "Lifemaxx", body: event.data.text(), url: "/" };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* plain text */ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
