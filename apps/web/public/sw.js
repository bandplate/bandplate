// bandplate's service worker: it shows push notifications and routes clicks
// on them. Nothing else — no offline cache, no asset interception. Plain JS
// (no build step touches this file; it is served as-is from `public/`), so
// it stays commented like the rest of the codebase despite the lack of
// types.

/**
 * The payload `encodePayload` in `packages/core/src/notifications/messages.ts`
 * writes: `{ v: 1, title, body, url, tag }`. `url` is always a same-origin
 * path such as `/events/abc` — never a full URL, so this worker never has to
 * reason about cross-origin navigation.
 */

self.addEventListener("push", (event) => {
  // A push with no data, or data that isn't the JSON this app sends, still
  // gets a notification: a silent push looks like a bug to whoever is
  // holding the phone, and the service worker gets no second chance once
  // the event handler returns.
  let title = "bandplate";
  let body = "";
  let url = "/";
  let tag;

  const raw = event.data ? event.data.text() : "";
  if (raw) {
    try {
      const payload = JSON.parse(raw);
      if (payload && typeof payload === "object") {
        if (typeof payload.title === "string" && payload.title) {
          title = payload.title;
        }
        if (typeof payload.body === "string") {
          body = payload.body;
        }
        if (typeof payload.url === "string") {
          url = payload.url;
        }
        if (typeof payload.tag === "string") {
          tag = payload.tag;
        }
      }
    } catch {
      // Not JSON (or not the shape expected) — fall through to the
      // "bandplate" / empty-body notification declared above rather than
      // dropping the push on the floor.
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    }),
  );
});

/**
 * Only a same-origin, root-relative path is a valid click target. Rejects
 * `//evil.example` (a protocol-relative URL a browser would treat as
 * cross-origin) and anything not starting with `/` (a full URL, `javascript:`,
 * or garbage) — those fall back to `/` rather than navigating somewhere this
 * worker didn't choose.
 */
function targetPath(data) {
  const url = data && typeof data.url === "string" ? data.url : undefined;
  if (url?.startsWith("/") && !url.startsWith("//")) {
    return url;
  }
  return "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = targetPath(event.notification.data);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer an already-open tab: focus it and navigate it there, rather
      // than piling up a new tab every time a notification is tapped.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(path);
          }
          return;
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});

/**
 * The push service can invalidate a subscription and hand back a
 * replacement at any time (key rotation, browser-side housekeeping) — this
 * is how the browser tells the worker. Best effort: there is no user
 * gesture to react to a failure with, so a subscribe or POST that fails
 * here just leaves the device unsubscribed until it next visits the app,
 * same as any other lost push registration.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldKey = event.oldSubscription?.options.applicationServerKey;
  if (!oldKey) {
    return;
  }

  event.waitUntil(
    (async () => {
      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: oldKey,
        });
        const json = subscription.toJSON();
        await fetch("/api/push/subscriptions", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
      } catch {
        // Best effort, as above.
      }
    })(),
  );
});
