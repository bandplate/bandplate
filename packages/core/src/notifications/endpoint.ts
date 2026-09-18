// Which push endpoints bandplate will actually send to.
//
// A subscription's `endpoint` is whatever the BROWSER handed back from
// `PushManager.subscribe()` — untrusted input from the client, stored and
// later fetched verbatim by the tick to know where to POST. Restricting it
// to the handful of real push services (rather than sending to whatever URL
// a client claims) closes off using bandplate's server as an open relay
// that POSTs attacker-chosen bodies to attacker-chosen HTTPS endpoints.

const ALLOWED_HOSTS = new Set(["fcm.googleapis.com", "web.push.apple.com"]);

/** Suffixes covering an entire push service's subdomain, e.g. `updates.push.services.mozilla.com`. */
const ALLOWED_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

/** Whether `url` is HTTPS and points at a recognized browser push service. */
export function isAllowedPushEndpoint(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname;
  if (ALLOWED_HOSTS.has(host)) {
    return true;
  }
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}
