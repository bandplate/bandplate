// Pure decision for the Workers profile's `AuthDeps.onLoginRequest` log
// line — see `app.workers.ts`'s call site for why it exists at all.
//
// The Node profile logs the address (`app.ts`'s own `onLoginRequest`):
// there `console.log` reaches the operator's own terminal, nothing else.
// On Workers it reaches `wrangler tail` AND, once `[observability]` is on
// (see `scripts/cron-wiring.ts#checkObservability`), Cloudflare's persisted
// Workers Logs — visible to every account member indefinitely, not just
// whoever is tailing right now. An email address is personal data with no
// reason to sit in a log store that long, and the outcome alone (sent vs.
// unknown) is all an operator debugging "I never got the email" needs.

/** The one line `onLoginRequest` logs, naming no address. */
export function loginRequestLogLine(outcome: "sent" | "unknown"): string {
  return outcome === "sent"
    ? "[login] link sent to a member"
    : "[login] no link sent — address is not an active member (the page says the same either way)";
}
