// The previous Upptime page registered a service worker at this path. Browsers that still run
// it fetch this file when checking for an update, then this version removes itself and its caches.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
      for (const client of await self.clients.matchAll({ type: "window" }))
        client.navigate(client.url);
    })(),
  );
});
