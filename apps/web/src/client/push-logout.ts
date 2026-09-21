// Sign-out's push-unsubscribe helper (Task 5). The listener that intercepts
// a sign-out form submit lives inline in `AppLayout.astro` (it has to touch
// `navigator.serviceWorker`, which only exists in a browser) — this module
// holds the one decision inside that chain that doesn't need a DOM, so a
// node-only vitest test can check it without one. See `docs/frontend-traps.md`
// and `player-actions.ts` for why decidable logic never stays in the
// component.
//
// "Is there a subscription to send" is the whole decision: the server only
// deletes a push-subscription row when the logout POST carries a non-empty
// endpoint (see `pages/logout.astro`), so a device with nothing subscribed
// must submit the field empty rather than the literal string "null" or
// "undefined" a naive template would produce from `subscription?.endpoint`.
export function endpointFieldValue(subscription: { endpoint: string } | null): string {
  return subscription ? subscription.endpoint : "";
}
