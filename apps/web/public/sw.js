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
 * Only a same-origin path is a valid click target. Resolving against
 * `self.location.origin` (rather than a `startsWith("/")` check) is what
 * catches `/\evil.example` too, not just `//evil.example` — a browser
 * normalises a leading `/\` the same as `//`, into a protocol-relative,
 * cross-origin URL, and a naive prefix check would have let it through.
 * Anything that resolves off-origin, or doesn't parse at all, falls back to
 * `/` rather than navigating somewhere this worker didn't choose.
 */
function targetPath(data) {
  const raw = data && typeof data.url === "string" ? data.url : "/";
  try {
    const resolved = new URL(raw, self.location.origin);
    if (resolved.origin === self.location.origin) {
      return resolved.pathname + resolved.search + resolved.hash;
    }
  } catch {
    // Not a parseable URL at all — falls through to "/" below.
  }
  return "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = targetPath(event.notification.data);

  event.waitUntil(
    (async () => {
      // Prefer an already-open, same-origin tab: focus it and navigate it
      // there, rather than piling up a new tab every time a notification is
      // tapped. `includeUncontrolled` also matches a tab this worker hasn't
      // claimed yet (e.g. right after an update), and `navigate()` can
      // reject for exactly that kind of client — so focus/navigate is
      // wrapped in its own try/catch, and ANY failure (no client, an
      // unsupported or rejecting `navigate`) falls back to
      // `clients.openWindow`. A click must always land somewhere.
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const sameOrigin = clientList.filter(
        (client) => new URL(client.url).origin === self.location.origin,
      );

      for (const client of sameOrigin.length > 0 ? sameOrigin : clientList) {
        try {
          await client.focus();
          if (typeof client.navigate === "function") {
            await client.navigate(path);
          }
          return;
        } catch {
          // This client couldn't be focused/navigated — try the next one,
          // or fall through to openWindow below if none work.
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
 *
 * A subtler failure mode when the rotation is OURS (a new
 * `BANDPLATE_VAPID_*` deploy): the fallback below re-subscribes with
 * `oldKey`, the applicationServerKey this device originally subscribed
 * under, not this deployment's current public key — there is no other key
 * available here to subscribe with. The POST this sends still gets stamped
 * with the server's CURRENT `vapidKeyId` (`push.ts`'s handler always uses
 * `deps.push.keyId`, not anything the client claims), so the row looks
 * current while the underlying push-service subscription is still signed
 * for the old key. Sends to it then simply fail until the member reopens
 * `/me`, whose own mismatch check (`subscriptionMatchesKey` in
 * `NotificationSettings.tsx`) unsubscribes and re-subscribes for real,
 * under the current public key.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldKey = event.oldSubscription?.options.applicationServerKey;
  if (!oldKey) {
    return;
  }

  event.waitUntil(
    (async () => {
      try {
        // Some browsers hand back the replacement subscription on the event
        // itself — use it directly rather than subscribing again when it's
        // there.
        const subscription =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: oldKey,
          }));
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
