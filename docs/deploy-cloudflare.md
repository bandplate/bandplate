# Deploying bandlib to Cloudflare Workers

This is the Workers deploy profile (increment 7), alongside the existing
Node/container profile (`deploy/node/compose.yml`). Both build from the
same source tree; the adapter is selected per build (see
`apps/web/astro.config.mjs`).

Everything below can be verified **locally** with `wrangler dev` /
`vitest-pool-workers` / Miniflare, with no real Cloudflare account. Only
the steps explicitly marked "on a real account" require one.

## What a self-deployer creates (on a real account)

1. **A D1 database**: `wrangler d1 create bandlib`. Copy the printed
   `database_id` into `apps/web/wrangler.toml`'s `[[d1_databases]]` entry
   (it ships with a placeholder id).
2. **An R2 bucket**: `wrangler r2 bucket create bandlib`, plus an **S3 API
   token** for it (R2 dashboard → "Manage R2 API Tokens" → create a token
   scoped to the bucket). This app talks to R2 over its **S3-compatible
   endpoint**, not the R2 binding — see `packages/storage/src/s3.ts`'s
   closing comment for why. You'll get an access key id and secret access
   key, and the account's R2 S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. **A mail provider account** (Resend or Postmark) and an API key. The
   app has no non-email way in after bootstrap — a Workers deploy with no
   working mailer is a lockout, exactly like the Node profile with no
   SMTP configured (see `packages/mail/src/factory.ts`'s doc comment).
4. **A Cloudflare Pages/Workers project** for the Worker itself — created
   implicitly by `wrangler deploy` the first time, using the `name` in
   `wrangler.toml`.
5. **Replace every `[vars]` placeholder in `apps/web/wrangler.toml`.**
   This step is easy to skip because nothing about the file *looks*
   broken afterward — every placeholder is a non-empty, well-formed-
   looking string, so it's easy to assume "the D1 `database_id` from
   step 1 was the only thing to change." It is not. Replace all five:
   - `BANDLIB_APP_ORIGIN` — the exact public origin the Worker will be
     served from (e.g. `https://bandlib.yourdomain.com`). Left at the
     shipped `https://bandlib.example`, every mutating form POST from
     your real origin fails the same-origin check with a silent 403 —
     including `POST /setup`, so the very first thing you try after
     deploying looks like it works and then does nothing. **The app now
     refuses to start if this is left at the placeholder** (see
     "Fail-fast on placeholder vars" below), but don't rely on that
     instead of just replacing it.
   - `MAIL_FROM` — the address login-link and confirmation emails send
     from. Left at `bandlib@bandlib.example`, Resend/Postmark will
     reject sends for a domain you never verified — silently, from the
     operator's point of view (mail failures don't reach the browser).
   - `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` — your account's real R2 S3
     endpoint from step 2 (`https://<account-id>.r2.cloudflarestorage.com`
     with your actual account id in place of `<account-id>`). These are
     normally the *same* value on Workers (unlike the Node profile's
     Docker-internal-vs-browser split) since R2's S3 endpoint is
     publicly reachable either way.
   - `S3_BUCKET` — the bucket name you actually created in step 2, if
     it isn't literally `bandlib`.

   `BANDLIB_APP_ORIGIN`, `MAIL_FROM`, `S3_ENDPOINT`, and
   `S3_PUBLIC_ENDPOINT` are checked at startup and fail fast, by name,
   if left on the shipped placeholder — see "Fail-fast on placeholder
   vars" below. `S3_BUCKET` cannot be checked this way (`"bandlib"` is
   itself a valid bucket name), so double-check it by hand.

## Fail-fast on placeholder vars

`apps/web/src/server/config.worker.ts` refuses to start if
`BANDLIB_APP_ORIGIN`, `MAIL_FROM`, `S3_ENDPOINT`, or `S3_PUBLIC_ENDPOINT`
still matches the shipped placeholder shape (`*.example`, or a literal
`<account-id>`-style angle-bracket slot) — the same fail-fast treatment
every other misconfigured variable already gets, with the offending
variable named in the error. This turns "step 5 above got skipped" into
an immediate, loud startup failure instead of a same-origin check that
silently 403s every form submission with no visible error. See
"Diagnosing a 500 on Workers" below for how to actually *see* that error
message, since Workers doesn't put it in the HTTP response body.

## Config: vars vs secrets

`apps/web/wrangler.toml`'s `[vars]` block holds everything that is NOT
sensitive (the app origin, mail provider name, R2 bucket/region/endpoint
names). Set the sensitive ones with `wrangler secret put`:

```
wrangler secret put BANDLIB_BOOTSTRAP_TOKEN
wrangler secret put MAIL_API_KEY
wrangler secret put S3_ACCESS_KEY_ID
wrangler secret put S3_SECRET_ACCESS_KEY
```

`BANDLIB_TRUSTED_PROXY_DEPTH` is optional (defaults to 1) — see "Trusted
proxy depth" below for why the default is almost always correct on
Workers.

For **local** `wrangler dev`, put the same four secret names in a
`.dev.vars` file (gitignored, never committed) instead of running
`wrangler secret put` — see `apps/web/wrangler.toml`'s header comment.
Note this is four *secrets*; `.dev.vars` also needs a fifth,
non-secret override of `BANDLIB_APP_ORIGIN` — see "Local verification"
below for why.

## Migrations

The Drizzle schema is SQLite-dialect and the committed migrations
(`packages/db/migrations/sqlite/*.sql`) are already in the exact
`NNNN_name.sql` layout `wrangler d1 migrations` expects — no separate
migration set for D1. Apply them with:

```
# local (no account needed):
wrangler d1 migrations apply DB --local
# real database, after `wrangler d1 create`:
wrangler d1 migrations apply DB --remote
```

Run this as an explicit deploy step **before** `wrangler deploy`, not
after — it is not run automatically on startup (same posture as the Node
profile, which runs `pnpm --filter @bandlib/db migrate` as its own step,
not on boot), and unlike the Node profile there's no server process to
fail loudly if it's missing: the first request after a `wrangler deploy`
against an unmigrated D1 database just gets a bare 500 from a query
against a schema-less table. Migrate first, always.

## Build and deploy

```
cd apps/web
BANDLIB_ADAPTER=cloudflare pnpm exec astro build   # → dist/_worker.js/
wrangler d1 migrations apply DB --remote           # on a real account, BEFORE deploy
wrangler deploy                                    # on a real account
```

`BANDLIB_ADAPTER=cloudflare` is the only thing that switches the build —
omit it (or leave it unset) and `astro build` produces the unchanged Node
profile (`dist/start.mjs`), exactly as today. Nothing else in
`astro.config.mjs` branches on it.

## Local verification (no account needed)

```
cd apps/web
BANDLIB_ADAPTER=cloudflare pnpm exec astro build
wrangler d1 migrations apply DB --local
wrangler dev
```

`.dev.vars` (gitignored) needs **five** values, not four — the four
secrets from "Config: vars vs secrets" above, *plus* a non-placeholder
`BANDLIB_APP_ORIGIN` override. This is the one var you can't just leave
at whatever `wrangler.toml` ships: `wrangler dev` serves the app from
`http://localhost:8787`, and if `BANDLIB_APP_ORIGIN` is still
`https://bandlib.example` (or any other value that doesn't match), every
form POST your browser makes will 403 on the same-origin check before it
reaches a page — this includes `/setup`, so a naive "just run `wrangler
dev` and click around" pass looks broken even though nothing is. Fake
values are fine for the other four (the app only needs them present and
well-formed; object storage and outbound mail calls will fail against
fake local credentials, since no MinIO/real provider is reachable — but
every route that doesn't touch those two integrations works end-to-end,
including the full sign-in flow), but `BANDLIB_APP_ORIGIN` must match
where you're actually browsing:

```
# apps/web/.dev.vars
BANDLIB_BOOTSTRAP_TOKEN=dev-bootstrap-token
MAIL_API_KEY=dev-fake-key
S3_ACCESS_KEY_ID=dev-fake-key-id
S3_SECRET_ACCESS_KEY=dev-fake-secret
BANDLIB_APP_ORIGIN=http://localhost:8787
```

(An earlier verification pass here used `curl` with a hand-set `Origin`
header instead of a real browser, which is exactly how this got missed —
`curl` doesn't 403, and no browser was ever pointed at the running
`wrangler dev` instance to catch it. Following the steps above verbatim,
in an actual browser, is what confirms it's fixed.)

This serves the full app — login, setup/bootstrap, admin, member pages,
and the `/api/*` JSON API — against a real local D1 database and a
real (though offline-by-default) local Workers runtime.

## Diagnosing a 500 on Workers

A misconfigured var (including a placeholder one caught by the
fail-fast check above) surfaces to the browser as a bare `500` with an
empty body — Workers doesn't attach thrown-error detail to the HTTP
response the way a Node stack trace might leak locally. The actual
`ConfigError` message (which names the offending variable) only reaches
`wrangler tail` (or the real-time log stream in the dashboard for a
deployed Worker). Run `wrangler tail` — or, locally, just watch the
`wrangler dev` terminal, which already prints it — before assuming a 500
is unexplainable.

## What's different from the Node profile — and why

| | Node/container | Workers |
|---|---|---|
| Database driver | libSQL (`@libsql/client`) | D1 (`drizzle-orm/d1`) — same `Db` interface, zero repo changes (see `packages/db/src/client.ts`) |
| Object storage | `S3Storage` against MinIO's S3 API | `S3Storage` against R2's S3 API — **identical class**, only endpoint/credentials differ |
| Mail | SMTP (`@bandlib/mail/smtp`, nodemailer) | HTTP API (`@bandlib/mail`'s `createHttpMailer`, Resend/Postmark over `fetch`) — Workers has no TCP sockets, so SMTP cannot run there at all |
| Login-link timing side channel | Mail send awaited inline, response clamped to a 300ms floor (`DEFAULT_LOGIN_TIMING_FLOOR_MS`) | Mail send scheduled via `ctx.waitUntil` (never awaited in the request path) — the floor still applies but now only has to cover a DB write, not mail-provider latency |
| Client IP for rate limiting | `X-Forwarded-For`, last trusted hop | `CF-Connecting-IP` (Cloudflare's own edge header, not client-suppliable) preferred outright — same `extractClientIp` function, no code difference, see `packages/api/src/routes/auth.ts` |
| Rate limiting | In-memory token bucket, per-process | Same in-memory bucket, but now **per-isolate** — weaker under Workers' horizontal scaling; see "Rate limiting" below |
| Cookie `Secure` flag | Configurable (`BANDLIB_COOKIE_SECURE`, `false` for non-TLS local dev) | Always `true` — every Workers deploy is behind Cloudflare's TLS-terminating edge |

## Rate limiting on Workers

The in-memory token bucket (`@bandlib/core`'s `createInMemoryRateLimiter`)
is per-isolate on Workers: Cloudflare can and does run multiple isolates
for the same Worker concurrently under load, each with its own bucket
state, so the *effective* limit multiplies with isolate count rather than
staying fixed. This is real and not fixed by this increment — a Durable
Object-backed limiter is the correct long-term answer (one DO instance
per rate-limit key, giving a single consistent counter regardless of
isolate count), but is not implemented here: the port (`RateLimiter` in
`@bandlib/core`) is already an interface with one implementation, so
dropping in a DO-backed one later needs no call-site changes, exactly the
same seam that made the D1 driver a zero-repo-change swap. Until then,
the login-attempt rate limits (`LOGIN_EMAIL_LIMIT`/`LOGIN_IP_LIMIT` in
`packages/api/src/routes/auth.ts`) are weaker on Workers than the numbers
themselves suggest — document this to operators, don't rely on it as a
hard cap.

## Testing against Workers locally

- `pnpm --filter @bandlib/api test:workers` runs this package's entire
  existing `*.test.ts` suite (auth, votes, favorites, admin, ingest,
  scopes, ...) a second time, inside workerd via
  `@cloudflare/vitest-pool-workers`, against a real D1 database (migrated
  fresh per test file by `packages/api/test/apply-migrations.ts`). It's
  the same test files the Node pool runs (`pnpm test`) — see
  `packages/api/src/test-helpers.ts`'s `resolveTestDb` for how one harness
  serves both.
- A handful of tests (ingest's real-bytes upload roundtrip,
  `audio.test.ts`'s redirect-then-fetch assertion) are skipped under that
  pool — `isWorkerdRuntime` in `test-helpers.ts` explains why: they
  depend on `InMemoryStorage` starting a real listening `node:http`
  server, and a Cloudflare Worker cannot bind a listening socket at all
  (a structural platform constraint, not a bug). The production
  `S3Storage` implementation only ever does outbound `fetch`, which IS
  exercised on Workers — see the next section for how that path is
  verified instead.

## Storage conformance: what is and isn't verified for R2

`packages/storage`'s conformance suite (`conformance.ts`) runs against
three legs: the in-memory fake, real MinIO, and — the requirement this
increment set out to add — Miniflare's local R2 simulator.

**That third leg is not possible as specified.** Cloudflare's local dev
tooling (Miniflare/`wrangler dev`, and `@cloudflare/vitest-pool-workers`
which is built on it) only exposes R2 locally through the **binding**
API (`env.BUCKET.get/put/head/delete/list`, called from inside a
Worker) — there is no local S3-compatible HTTP endpoint to sign
`aws4fetch` requests against, the way real R2's S3 API and MinIO both
provide. `S3Storage` is deliberately binding-free (see `s3.ts`'s closing
comment on why: presigning is an S3-endpoint-only feature, and the app's
whole audio-serving design depends on presigned URLs, not streaming
bytes through the Worker) — which is exactly what makes it unable to run
against the binding-only local simulator at all.

Confirmed by starting a real `wrangler dev` Worker with an `r2_buckets`
binding: the binding table shows `R2 Bucket ... local` with no
accompanying S3 gateway port, and Cloudflare's own docs describe only
binding-based local R2 access.

**What this leaves verified vs. not:**
- Verified: `S3Storage`'s SigV4 signing, content-type/length enforcement,
  Range requests, and expiry/quantisation logic against a real
  S3-compatible REST endpoint (MinIO) — the exact same code path R2's
  production S3 API also implements (both speak the same SigV4 protocol
  MinIO does).
- Not verified locally, and not verifiable without a real Cloudflare
  account: `S3Storage` against R2's *own* S3 endpoint specifically. If
  R2's S3 API has any real behavioral divergence from AWS S3/MinIO's
  (none is expected — it advertises S3 API compatibility — but this
  increment did not confirm it against a live bucket, per the "no real
  account, no deploy" constraint), that divergence is unverified.

## Login-timing side channel — verified, not just designed

Confirmed with a real `wrangler dev` run (real local D1, a fake mail
key): `POST /setup` (bootstrap) took 317ms; a subsequent `POST /login`
for the now-real member returned in exactly the 300ms floor while the
scheduled mail send failed *after* the response, logged separately by
workerd rather than blocking or being visible to the client. The Node
profile's own 300ms floor is unchanged and still the only protection
there — see the comparison table above for why Workers additionally
removes mail-provider latency from the timing signal entirely via
`ctx.waitUntil`.

## Post-deploy smoke test (5 minutes, on a real account)

`S3Storage` against R2's own S3 endpoint is the one path this profile
cannot verify locally at all (see "Storage conformance" above — no local
R2 S3 gateway exists to test against). After a real `wrangler deploy`,
close that gap directly rather than trusting the MinIO conformance suite
as a total stand-in:

1. Create a service token with `ingest:write` (`POST /admin/tokens` as
   an admin, or via the admin UI).
2. Upload one real take with the reference ingest client:
   ```
   python3 tools/ingest_client/bandlib_ingest.py \
     --base-url https://<your-worker>.workers.dev \
     --token <the ingest:write token> \
     --project /path/to/a/small/take/folder
   ```
   (see `docs/ingest-contract-v1.md` for the folder convention it
   expects — a `master.<ext>` file is enough for this smoke test).
3. Play the uploaded take back in the browser (`/admin` or a song page)
   and confirm audio actually plays, not just that the page renders.

If the upload or playback fails, it isolates to the one thing
`wrangler dev` structurally can't exercise (R2's real S3 API), not to
anything else in the deploy.
