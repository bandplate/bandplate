// `/push/subscriptions` and `/push/prefs` — the JSON API surface a signed-in
// member's browser uses to register a device for Web Push and to choose
// which of the three tick categories (new takes, weekly unvoted, song
// changes) reach them at all. Scope-gated through `GuardedRouter` on
// `notifications:write` (see `@bandplate/core`'s `scopes.ts` for why that's
// its own scope, distinct from `votes:write`/`favorites:write`), and member
// principals only — a service token has no device and no notification
// preferences of its own, same rule `routes/votes.ts` and
// `routes/favorites.ts` apply for the same reason.
//
// Every route here 404s outright when `config.push` is unset — Web Push is
// entirely unconfigured (no VAPID keys), so there is nothing to subscribe
// to and no point pretending the feature exists.
import type { Clock } from "@bandplate/core";
import { isAllowedPushEndpoint } from "@bandplate/core";
import { type Db, notificationPrefsRepo, pushSubscriptionsRepo } from "@bandplate/db";
import { z } from "zod";
import { errorResponse } from "../errors.js";
import { type GuardedRouter, requireScopes } from "../route-registry.js";

export interface PushRouteDeps {
  db: Db;
  clock: Clock;
  /** Same shape as `AppConfig.push` — undefined means Web Push is off, and every route here 404s. */
  push?: { publicKey: string; keyId: string };
}

/** A member may hold at most this many subscribed devices at once — global-constraints.md. */
const MAX_SUBSCRIPTIONS_PER_MEMBER = 10;

/** `user-agent` is stored purely for diagnostics — truncated so one header can't blow up a row. */
const USER_AGENT_MAX_LENGTH = 200;

/** A real push-service endpoint is a short opaque URL; bound it so nothing oversized reaches the DB or `isAllowedPushEndpoint`'s `new URL()` parse. */
const ENDPOINT_MAX_LENGTH = 2048;

const subscribeSchema = z.object({
  endpoint: z.string().min(1).max(ENDPOINT_MAX_LENGTH),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(ENDPOINT_MAX_LENGTH),
});

const prefsSchema = z.object({
  newTakes: z.boolean(),
  weeklyUnvoted: z.boolean(),
  songChanges: z.boolean(),
});

/**
 * Decodes a base64url string (no padding, per the Web Push/PushSubscription
 * JSON shape) to its byte length — Workers-safe (`atob`, no `Buffer`).
 * Returns `undefined` for input that isn't valid base64url at all, so a
 * length check downstream can't be fooled by garbage that merely "decodes"
 * to some byte count by accident of `atob`'s leniency.
 */
function decodedByteLength(value: string): number | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return atob(padded).length;
  } catch {
    return undefined;
  }
}

export function registerPushRoutes(router: GuardedRouter, deps: PushRouteDeps): void {
  router.post("/push/subscriptions", requireScopes("notifications:write"), async (c) => {
    const principal = c.get("principal");
    if (principal?.kind !== "member") {
      return errorResponse(c, 403, "forbidden", "Only a signed-in member can subscribe a device.");
    }
    if (!deps.push) {
      return errorResponse(c, 404, "not_found", "Push notifications are not enabled.");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        "invalid_body",
        "endpoint and keys.p256dh/keys.auth are required.",
      );
    }
    const { endpoint, keys } = parsed.data;

    if (!isAllowedPushEndpoint(endpoint)) {
      return errorResponse(c, 400, "invalid_endpoint", "That push endpoint is not recognized.");
    }

    const p256dhLength = decodedByteLength(keys.p256dh);
    if (p256dhLength !== 65) {
      return errorResponse(c, 400, "invalid_key", "keys.p256dh must decode to 65 bytes.");
    }
    const authLength = decodedByteLength(keys.auth);
    if (authLength !== 16) {
      return errorResponse(c, 400, "invalid_key", "keys.auth must decode to 16 bytes.");
    }

    const existing = await pushSubscriptionsRepo.getByEndpoint(deps.db, endpoint);
    if (existing?.memberId !== principal.memberId) {
      const count = await pushSubscriptionsRepo.countForMember(deps.db, principal.memberId);
      if (count >= MAX_SUBSCRIPTIONS_PER_MEMBER) {
        return errorResponse(
          c,
          409,
          "too_many_subscriptions",
          `A member may have at most ${MAX_SUBSCRIPTIONS_PER_MEMBER} subscribed devices.`,
        );
      }
    }

    const userAgent = c.req.header("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;

    // Deliberately no "does this endpoint already belong to someone else"
    // check here — `upsert` reassigns `memberId` on conflict, so an
    // endpoint already owned by member A that member B POSTs here simply
    // becomes B's. This is the intended takeover, not a missing
    // authorization check: `endpoint` is a device secret the browser
    // itself handed back from `PushManager.subscribe()`, so a caller
    // presenting it has proven they control that device/browser profile —
    // exactly the "a shared device follows whoever signed in last" rule
    // `upsert`'s own doc comment describes. It's also safe by
    // construction: A's device can no longer decrypt pushes sent under
    // B's `p256dh`/`auth` keys (overwritten here), and B gains no access
    // to anything A had that B didn't already have by holding the same
    // endpoint/keys — there's no cross-member data exposed, only where
    // future notifications for *this device* get attributed.
    await pushSubscriptionsRepo.upsert(
      deps.db,
      {
        memberId: principal.memberId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        vapidKeyId: deps.push.keyId,
        // `MemberPrincipal` carries no session id today — nothing to
        // attribute this subscription's session to yet.
        authSessionId: null,
        userAgent,
      },
      deps.clock.now(),
    );

    return c.body(null, 204);
  });

  router.delete("/push/subscriptions", requireScopes("notifications:write"), async (c) => {
    const principal = c.get("principal");
    if (principal?.kind !== "member") {
      return errorResponse(
        c,
        403,
        "forbidden",
        "Only a signed-in member can unsubscribe a device.",
      );
    }
    if (!deps.push) {
      return errorResponse(c, 404, "not_found", "Push notifications are not enabled.");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = unsubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(c, 400, "invalid_body", "endpoint is required.");
    }

    // Scoped to the caller's own memberId by the repo itself — a foreign
    // endpoint (someone else's device, or one that doesn't exist) is
    // silently a no-op, not an error: there is nothing for this caller to
    // have removed either way, and the endpoint is opaque to them.
    await pushSubscriptionsRepo.removeByEndpoint(deps.db, principal.memberId, parsed.data.endpoint);

    return c.body(null, 204);
  });

  router.get("/push/prefs", requireScopes("notifications:write"), async (c) => {
    const principal = c.get("principal");
    if (principal?.kind !== "member") {
      return errorResponse(c, 403, "forbidden", "Only a signed-in member has notification prefs.");
    }
    if (!deps.push) {
      return errorResponse(c, 404, "not_found", "Push notifications are not enabled.");
    }

    const prefs = await notificationPrefsRepo.get(deps.db, principal.memberId);
    return c.json(prefs, 200);
  });

  router.put("/push/prefs", requireScopes("notifications:write"), async (c) => {
    const principal = c.get("principal");
    if (principal?.kind !== "member") {
      return errorResponse(c, 403, "forbidden", "Only a signed-in member has notification prefs.");
    }
    if (!deps.push) {
      return errorResponse(c, 404, "not_found", "Push notifications are not enabled.");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = prefsSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        "invalid_body",
        "newTakes, weeklyUnvoted, and songChanges (all boolean) are required.",
      );
    }

    await notificationPrefsRepo.set(deps.db, principal.memberId, parsed.data, deps.clock.now());

    return c.body(null, 204);
  });
}
