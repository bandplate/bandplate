// `/me`'s Notifications section — which of five faces to show, and whether a
// stored subscription still matches this deployment's VAPID key.
//
// Pure, same reasoning as `install-hint.ts`: the DOM half is a handful of
// property reads (`"serviceWorker" in navigator`, `Notification.permission`,
// a `PushSubscription`'s own key), and everything that decides between them
// belongs somewhere `vitest` can check without a browser.
//
// Five answers, in the order they're checked:
//   ios-needs-install  iOS has no install-less way to receive push at all —
//                      Safari only grants the permission to a page added to
//                      the home screen. Checked FIRST and unconditionally:
//                      an iPhone that somehow reports the APIs as present
//                      (Safari does, even outside standalone) still can't
//                      actually subscribe, so this pre-empts every other
//                      branch rather than only firing when the APIs are
//                      missing.
//   unsupported        no service worker, no PushManager, or no Notification
//                      API — nothing here can work. No fake affordance.
//   denied             the member (or the OS) blocked the permission already;
//                      only their own browser/phone settings undo that.
//   on                 subscribed AND the browser confirms the permission is
//                      still granted (a subscription can outlive a
//                      permission the member revoked out of band).
//   off                supported, not blocked, but not subscribed (yet).
export type PushUiState = "unsupported" | "ios-needs-install" | "denied" | "off" | "on";

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied";
  standalone: boolean;
  ios: boolean;
  subscribed: boolean;
}

export function decidePushUiState(env: PushEnvironment): PushUiState {
  if (env.ios && !env.standalone) {
    return "ios-needs-install";
  }
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return "unsupported";
  }
  if (env.permission === "denied") {
    return "denied";
  }
  if (env.subscribed && env.permission === "granted") {
    return "on";
  }
  return "off";
}

/**
 * Decodes a base64url string (no padding — the shape `getWebConfig()`'s
 * `publicKey` and a `PushSubscriptionOptions.applicationServerKey` both
 * use) into raw bytes. `atob`, not `Buffer`: this module runs in the
 * browser as much as it runs under `vitest`.
 */
export function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Whether an existing subscription's `applicationServerKey` is still THIS
 * deployment's VAPID public key. A mismatch means the subscription was
 * created under a key that has since rotated (or a different environment
 * entirely) — the push service will accept it, but this server's private
 * key can no longer sign anything it will deliver, so the island
 * unsubscribes and re-subscribes under the current key.
 */
export function subscriptionMatchesKey(
  subscriptionKey: ArrayBuffer | null,
  publicKey: string,
): boolean {
  if (!subscriptionKey) {
    return false;
  }
  const expected = base64UrlToUint8Array(publicKey);
  const actual = new Uint8Array(subscriptionKey);
  if (actual.length !== expected.length) {
    return false;
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      return false;
    }
  }
  return true;
}
