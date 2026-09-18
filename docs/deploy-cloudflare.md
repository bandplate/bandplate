# Deploying bandplate to Cloudflare Workers

This is the Workers deploy profile, alongside the Node/container profile
(see [`self-hosting.md`](self-hosting.md)). Both build from the
same source tree; the adapter is selected per build via the
`BANDPLATE_ADAPTER` env var (see `apps/web/astro.config.mjs`).

Follow this top to bottom for a first deploy. Everything up to "Build and
deploy" is either a one-time account setup step or a local check you can
do with no Cloudflare account at all.

## 0. Before anything: how to run `wrangler`

`wrangler` is a devDependency of `apps/web`, not a global install, so
every command below is run through pnpm **from that directory**:

```
cd apps/web
pnpm exec wrangler --version     # 4.41.0
pnpm exec wrangler login         # once, to authenticate
```

Every `pnpm exec wrangler ...` in this guide assumes `apps/web` as the
working directory — that is also where `wrangler.toml` lives, which
wrangler needs to find.

`wrangler.toml` itself is **not** tracked in git, for the same reason
`.dev.vars` isn't: every deployer fills it with their own account's
resource ids, so tracking it would mean a permanently modified file and a
conflict on every upstream pull. Copy the template once:

```
cp wrangler.toml.example wrangler.toml
```

Then edit your copy — steps 1 and 3 below tell you what to put in it.
Nothing in it is secret (a D1 `database_id` identifies a resource; access
is gated by your API token), so keeping it local is about ergonomics, not
security. Real secrets go through `pnpm exec wrangler secret put`, never
into this file — see step 5.

## 1. Create what you need on a real account

Do these in order — each later step needs something from the one before it.

1. **A D1 database**:
   ```
   pnpm exec wrangler d1 create bandplate
   ```
   Copy the printed `database_id` into `apps/web/wrangler.toml`'s
   `[[d1_databases]]` entry — it ships with a placeholder id.

2. **An R2 bucket**, plus an **S3 API token** for it:
   ```
   pnpm exec wrangler r2 bucket create bandplate
   ```
   Then create the S3 API token in the dashboard — wrangler cannot do
   this part. It lives on the **R2 Object Storage** overview page, in the
   **Account Details** panel on the right: **Manage** next to **API
   Tokens** → *Create Account API token*. (Direct link:
   `https://dash.cloudflare.com/?to=/:account/r2/api-tokens`. The label
   has moved between dashboard revisions — older docs call it "Manage R2
   API Tokens" — so navigate to the R2 page and look for API Tokens
   rather than hunting a top-level menu entry.) Give it **Object Read &
   Write**, scoped to the bucket you just created. This app talks to R2 over its
   **S3-compatible endpoint**, not the R2 binding (see
   `packages/storage/src/s3.ts`'s closing comment for why) — so what you
   need out of this step is an access key id, a secret access key, and
   the account's R2 S3 endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).

3. **A CORS rule on the bucket** — do not skip this one. Since M8 the
   browser uploads audio by PUTting a presigned URL directly at R2, which
   is a cross-origin request and so preflights. **MinIO allows `*` by
   default, so local development works and production does not**, and it
   fails at the PUT with an opaque CORS error that reads exactly like a
   signing bug. On the bucket's **Settings → CORS policy**:

   ```json
   [
     {
       "AllowedOrigins": ["https://your-app-origin"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["content-type", "range"],
       "ExposeHeaders": ["etag", "content-length", "content-range"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   `AllowedOrigins` is the app's own origin — the same value as
   `BANDPLATE_APP_ORIGIN`.

   **`GET`, `range` and `content-range` are not optional, and skipping them
   fails as silence.** Downloads and the take page's own player really do
   go through the app's 302 as ordinary no-cors requests and need none of
   this. The **mixer** (`/takes/:id/mix`) does not: it sets
   `crossOrigin="anonymous"` on every stem, because Web Audio refuses to
   read a tainted element — and when the header is missing, the element is
   tainted, `createMediaElementSource` emits silence, and **no error is
   raised anywhere**. The mixer draws its waveforms, the playhead runs, and
   nothing comes out. This paragraph used to say playback needed no CORS
   rule at all; that was true until the mixer shipped.

   MinIO allows `*` by default, so a local dev setup works whether or not
   you have done this — the same trap this page already names for `PUT`.

   Or from the CLI, which is what `deploy/worker/r2-cors.json` is for.
   **Edit the origin in it first** — it ships as `https://bandplate.example`,
   and `cors set` replaces the whole rule set, so running this with the
   placeholder in place silences the mixer on a working deployment:

   ```
   pnpm exec wrangler r2 bucket cors set bandplate --file ../../deploy/worker/r2-cors.json
   ```

   **The CLI takes a different shape from the dashboard** — a `rules`
   array of `{allowed: {origins, methods, headers}}`, not the flat
   `AllowedOrigins`/`AllowedMethods` above. Passing the dashboard's JSON
   to the CLI fails with "must contain a 'rules' array". Check the result
   with `wrangler r2 bucket cors list bandplate`; before the rule exists
   that command errors with "The CORS configuration does not exist",
   which is the answer, not a failure.

4. **A mail provider account** (Resend or Postmark) and an API key. The
   app is email-only after bootstrap — a Workers deploy with no working
   mailer is a lockout, exactly like the Node profile with no SMTP
   configured (see `packages/mail/src/factory.ts`'s doc comment).

5. **The Worker itself** — no separate step needed. `pnpm exec wrangler deploy`
   creates the Workers project on first run, using the `name` in
   `wrangler.toml`.

## 2. Replace every `[vars]` placeholder

`apps/web/wrangler.toml.example` ships with five placeholder values in
`[vars]`, which your copy inherits.
This step is easy to skip because nothing about the file *looks* broken
afterward — every placeholder is a non-empty, well-formed-looking string,
so it's easy to assume "the D1 `database_id` from step 1 was the only
thing to change." It is not. Replace all five:

- **`BANDPLATE_APP_ORIGIN`** — the exact public origin the Worker will be
  served from (e.g. `https://bandplate.yourdomain.com`). Left at the
  shipped `https://bandplate.example`, every mutating form POST from your
  real origin fails the same-origin check with a silent 403 — including
  `POST /setup`, so the very first thing you try after deploying looks
  like it works and then does nothing.
- **`MAIL_FROM`** — the address login-link and confirmation emails send
  from. Left at `bandplate@bandplate.example`, Resend/Postmark will
  reject sends for a domain you never verified — silently, from the
  operator's point of view (mail failures don't reach the browser).
- **`S3_ENDPOINT`** and **`S3_PUBLIC_ENDPOINT`** — your account's real R2
  S3 endpoint from step 1.2
  (`https://<account-id>.r2.cloudflarestorage.com`, with your actual
  account id in place of `<account-id>`). These are normally the *same*
  value on Workers (unlike the Node profile's Docker-internal-vs-browser
  split), since R2's S3 endpoint is publicly reachable either way.
- **`S3_BUCKET`** — the bucket name you actually created in step 1.2, if
  it isn't literally `bandplate`.

One more, not a placeholder and not required:

- **`BANDPLATE_DEFAULT_LOCALE`** — `en` or `cs`, English if unset. What
  this installation speaks when nothing better is known: a visitor whose
  browser asks for a language the app does not have, and — the part that
  matters — the language written onto every NEW member's row, which is
  what their invitation is sent in and what they see on their first
  sign-in. A member's own choice on `/me` still wins, and so does a
  browser that asks for a language the app does have. Validated against
  the shipped languages, so a typo'd `cz` fails the deploy naming the
  variable rather than quietly doing nothing.

`BANDPLATE_APP_ORIGIN`, `MAIL_FROM`, `S3_ENDPOINT`, and
`S3_PUBLIC_ENDPOINT` are checked at startup: `apps/web/src/server/config.worker.ts`
refuses to boot if any of them still matches the shipped placeholder
shape (`*.example`, or a literal `<account-id>`-style angle-bracket slot),
naming the offending variable in the error. That turns a skipped
replacement into an immediate, loud startup failure instead of a
same-origin check that silently 403s every form submission with no
visible error — see "Diagnosing a 500" below for how to actually see that
error message, since Workers doesn't put it in the HTTP response body.

**`S3_BUCKET` cannot be checked this way** — `"bandplate"` is itself a
perfectly valid bucket name, so a leftover placeholder there looks
identical to a deliberate choice. Double-check it by hand.

## 3. Secrets vs vars

`apps/web/wrangler.toml`'s `[vars]` block holds everything that is NOT
sensitive (the app origin, mail provider name, R2 bucket/region/endpoint
names — the values from step 2). Set the sensitive ones with `wrangler
secret put`, one at a time:

```
pnpm exec wrangler secret put BANDPLATE_BOOTSTRAP_TOKEN
pnpm exec wrangler secret put MAIL_API_KEY
pnpm exec wrangler secret put S3_ACCESS_KEY_ID
pnpm exec wrangler secret put S3_SECRET_ACCESS_KEY
```

`BANDPLATE_TRUSTED_PROXY_DEPTH` is optional (defaults to 1, which is
correct for Workers — every request arrives via Cloudflare's own edge as
exactly one trusted hop).

**Push notifications are optional.** Turning them on needs three more
values, all-or-nothing: `BANDPLATE_VAPID_PUBLIC_KEY` and
`BANDPLATE_VAPID_SUBJECT` uncommented in `wrangler.toml`'s `[vars]` (see
that file's own comment — a real subject, e.g. `mailto:you@bandplate.example`,
not the shipped example), plus the private key as a fifth secret:

```
pnpm exec wrangler secret put BANDPLATE_VAPID_PRIVATE_KEY
```

Generate the pair with `pnpm --filter @bandplate/push vapid:generate` — it
prints both keys, public first. Leave all three unset and push notifications
stay off: `/me`'s Notifikace section doesn't render, and nothing about
migrations, mail or storage changes.

## 4. Migrate — before every deploy, unconditionally

```
pnpm exec wrangler d1 migrations apply DB --remote
```

Run this as its own explicit step **before** `pnpm exec wrangler deploy`, every
time, not just the first time. It is not run automatically on startup
(same posture as the Node profile, which runs `pnpm --filter @bandplate/db
migrate` as its own step, not on boot) — but unlike the Node profile,
there is no server process here to fail loudly if you forget: the first
request against an unmigrated D1 database just gets a bare 500 from a
query against a schema-less table, with nothing in the response and
nothing obviously wrong about the deploy that produced it.

## 5. Build and deploy

```
cd apps/web
BANDPLATE_ADAPTER=cloudflare pnpm exec astro build   # → dist/_worker.js/
pnpm exec wrangler d1 migrations apply DB --remote             # step 4, repeated — don't skip on redeploys
pnpm exec wrangler deploy
```

`BANDPLATE_ADAPTER=cloudflare` is the only thing that switches the build
— omit it and `astro build` produces the unchanged Node profile
(`dist/start.mjs`) instead. Nothing else in `astro.config.mjs` branches
on it.

## Scheduled tick

`wrangler.toml.example` ships `[triggers] crons = ["*/10 * * * *"]`, which
runs the notification tick every 10 minutes — the same cadence
`global-constraints.md` specs. The Worker's `scheduled` handler
(`src/worker.ts`, alongside the normal `fetch` one — wired in via
`workerEntryPoint` in `astro.config.mjs`) calls
`src/server/scheduled.ts#runScheduledTick`, which builds the Workers
runtime, asks `getNotificationDeps()` for the push-sender/DB/clock bundle,
and — if push is configured at all — calls `@bandplate/core`'s
`runNotificationTick`. If push isn't configured (no `BANDPLATE_VAPID_*`
vars, see step 3), `getNotificationDeps()` returns `undefined` and the
handler returns immediately: the cron still fires every 10 minutes, it
just has nothing to do.

**Cron Triggers run in UTC.** The reminder logic itself — the weekly
Sunday-evening slot, the quiet periods, the staleness windows — reasons in
the band's own `Europe/Prague` zone (`Clock.now()` stays epoch
milliseconds throughout; only the notification code converts). A 10-minute
cadence makes the UTC-vs-Prague distinction immaterial for *when this
Worker wakes up* — it's frequent enough that the Prague-local decision
inside each tick is what actually gates a send, not the trigger's own
clock. Nothing about the cron schedule itself needs adjusting for daylight
saving; the underlying decision logic already accounts for it.

This trigger is applied automatically as part of `wrangler deploy` (crons
are Worker config, applied the same way `[vars]`/bindings are — no
separate subcommand to run for a first deploy). Confirm it's live in the
**Triggers** tab of the Worker in the dashboard, or with `wrangler tail`
around the :00/:10/:20/... mark — a tick logs
`[scheduled] notification tick: sent=... gone=... failed=... skippedStale=...`
on every run.

## Local verification (no account needed)

Everything above requires a real Cloudflare account. Before spending any
of that, verify the Workers build itself locally with `pnpm exec wrangler dev` and
a local D1 database — no account, no deploy:

```
cd apps/web
BANDPLATE_ADAPTER=cloudflare pnpm exec astro build
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler dev
```

This needs an `apps/web/.dev.vars` file (gitignored, never committed)
with **five** values — the four secrets from step 3, *plus* a
non-placeholder `BANDPLATE_APP_ORIGIN`:

```
# apps/web/.dev.vars
BANDPLATE_BOOTSTRAP_TOKEN=dev-bootstrap-token
MAIL_API_KEY=dev-fake-key
S3_ACCESS_KEY_ID=dev-fake-key-id
S3_SECRET_ACCESS_KEY=dev-fake-secret
BANDPLATE_APP_ORIGIN=http://localhost:8787
```

That's the minimum to boot. To also exercise push notifications locally,
add a sixth value — `BANDPLATE_VAPID_PRIVATE_KEY` from a pair generated with
`pnpm --filter @bandplate/push vapid:generate` — *and* uncomment the
matching `BANDPLATE_VAPID_PUBLIC_KEY`/`BANDPLATE_VAPID_SUBJECT` in your local
`wrangler.toml`'s `[vars]` (real values, not the shipped placeholders — see
step 2). Leave all three out and push notifications stay off, same as a real
deploy: nothing else here changes.

To fire the scheduled tick without waiting for the cron itself, run
`wrangler dev` with `--test-scheduled` (this opens an extra local-only
route that simulates a cron trigger; it changes nothing about the deploy
config) and hit it with `curl`:

```
pnpm exec wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"
```

The `curl` should return `200`, and the `wrangler dev` terminal logs the
same `[scheduled] notification tick: sent=...` line a real cron
invocation would produce (or nothing at all beyond that, if push isn't
configured in your local `.dev.vars`/`wrangler.toml` — see above). Normal
`fetch` handling is unaffected either way; `curl -I
http://localhost:8787/login` still serves the sign-in page.

`BANDPLATE_APP_ORIGIN` is the one value here you can't just leave at
whatever `wrangler.toml` ships, or fake: `pnpm exec wrangler dev` serves the app
from `http://localhost:8787`, and if this doesn't match exactly, every
form POST your browser makes — including `/setup` — 403s on the
same-origin check before it reaches a page. A `curl` request with a
hand-set `Origin` header won't catch this (curl doesn't enforce or care
about same-origin); only an actual browser pointed at `pnpm exec wrangler dev`
does. The other four values can be fake — the app only needs them
present and well-formed. Object storage and outbound mail calls will
fail against fake credentials (no MinIO or real provider is reachable
locally), but every route that doesn't touch those two integrations
works end-to-end, including the full sign-in flow.

This setup serves the full app — login, setup/bootstrap, admin, member
pages, and the `/api/*` JSON API — against a real local D1 database and a
real (though offline-by-default) local Workers runtime.

## Diagnosing a 500

A misconfigured var (including a placeholder one caught by the fail-fast
check in step 2) surfaces to the browser as a bare `500` with an empty
body — Workers doesn't attach thrown-error detail to the HTTP response
the way a Node stack trace might leak locally. The actual `ConfigError`
message, which names the offending variable, only reaches `wrangler
tail` (or the real-time log stream in the dashboard for a deployed
Worker) — locally, the `pnpm exec wrangler dev` terminal already prints it. Run
`pnpm exec wrangler tail` before assuming a 500 is unexplainable.

## Post-deploy smoke test

`S3Storage` against R2's own S3 endpoint is the one path that cannot be
verified locally at all: Cloudflare's local dev tooling (Miniflare /
`pnpm exec wrangler dev`, and `@cloudflare/vitest-pool-workers`, which is built on
it) only exposes R2 locally through the **binding** API
(`env.BUCKET.get/put/...`, called from inside a Worker) — there is no
local S3-compatible HTTP endpoint to sign requests against, the way real
R2's S3 API and MinIO both provide. `S3Storage` is deliberately
binding-free (presigning is an S3-endpoint-only feature, and the app's
audio-serving design depends on presigned URLs, not streaming bytes
through the Worker), which is exactly what makes it unable to run against
the binding-only local simulator. The MinIO leg of `packages/storage`'s
conformance suite exercises the same SigV4 signing, content-type/length
enforcement, Range requests, and expiry/quantisation logic that R2's
production S3 API also implements — but R2 itself is untested until a
real deploy.

Close that gap directly after every real `pnpm exec wrangler deploy`, rather than
trusting the MinIO suite as a total stand-in:

1. Create a service token with `ingest:write` (`POST /admin/tokens` as an
   admin, or via the admin UI).
2. Upload one real take with the reference ingest client:
   ```
   python3 tools/ingest_client/bandplate_ingest.py \
     --base-url https://<your-worker>.workers.dev \
     --token <the ingest:write token> \
     --project /path/to/a/small/take/folder
   ```
   (see `docs/ingest-contract-v1.md` for the folder convention it
   expects — a `master.<ext>` file is enough for this smoke test).
3. Play the uploaded take back in the browser (`/admin` or a song page)
   and confirm audio actually plays, not just that the page renders.

If the upload or playback fails, it isolates to the one thing local
verification structurally can't exercise (R2's real S3 API), not to
anything else in the deploy.

## Known limitations

**Rate limiting is per-isolate on Workers.** The in-memory token bucket
(`@bandplate/core`'s `createInMemoryRateLimiter`) keeps its state inside
one Worker isolate. Cloudflare can and does run multiple isolates for the
same Worker concurrently under load, each with its own bucket state, so
the *effective* rate limit multiplies with isolate count rather than
staying fixed. This is real and not fixed by this increment — the
login-attempt limits (`LOGIN_EMAIL_LIMIT`/`LOGIN_IP_LIMIT` in
`packages/api/src/routes/auth.ts`) are weaker on Workers than the numbers
themselves suggest. The fix is a Durable Object-backed limiter (one DO
instance per rate-limit key, giving a single consistent counter
regardless of isolate count); it isn't implemented here, but the port
(`RateLimiter` in `@bandplate/core`) is already an interface with one
implementation, so dropping in a DO-backed one later needs no call-site
changes — the same seam that made the D1 driver a zero-repo-change swap
over libSQL.

## What's different from the Node profile

| | Node/container | Workers |
|---|---|---|
| Database driver | libSQL (`@libsql/client`) | D1 (`drizzle-orm/d1`) — same `Db` interface, zero repo changes (see `packages/db/src/client.ts`) |
| Object storage | `S3Storage` against MinIO's S3 API | `S3Storage` against R2's S3 API — **identical class**, only endpoint/credentials differ |
| Mail | SMTP (`@bandplate/mail/smtp`, nodemailer) | HTTP API (`@bandplate/mail`'s `createHttpMailer`, Resend/Postmark over `fetch`) — Workers has no TCP sockets, so SMTP cannot run there at all |
| Login-link timing side channel | Mail send awaited inline, response clamped to a 300ms floor (`DEFAULT_LOGIN_TIMING_FLOOR_MS`) | Mail send scheduled via `ctx.waitUntil` (never awaited in the request path) — the floor still applies but now only has to cover a DB write, not mail-provider latency |
| Client IP for rate limiting | `X-Forwarded-For`, last trusted hop | `CF-Connecting-IP` (Cloudflare's own edge header, not client-suppliable) preferred outright — same `extractClientIp` function, no code difference, see `packages/api/src/routes/auth.ts` |
| Rate limiting | In-memory token bucket, per-process | Same in-memory bucket, but per-isolate — see "Known limitations" above |
| Cookie `Secure` flag | Configurable (`BANDPLATE_COOKIE_SECURE`, `false` for non-TLS local dev) | Always `true` — every Workers deploy is behind Cloudflare's TLS-terminating edge |

## Testing against Workers locally

`pnpm --filter @bandplate/api test:workers` runs this package's entire
existing `*.test.ts` suite (auth, votes, favorites, admin, ingest,
scopes, ...) a second time, inside workerd via
`@cloudflare/vitest-pool-workers`, against a real D1 database (migrated
fresh per test file by `packages/api/test/apply-migrations.ts`). It's the
same test files the Node pool runs (`pnpm test`) — see
`packages/api/src/test-helpers.ts`'s `resolveTestDb` for how one harness
serves both.

A handful of tests (ingest's real-bytes upload roundtrip,
`audio.test.ts`'s redirect-then-fetch assertion) are skipped under that
pool — `isWorkerdRuntime` in `test-helpers.ts` explains why: they depend
on `InMemoryStorage` starting a real listening `node:http` server, and a
Cloudflare Worker cannot bind a listening socket at all (a structural
platform constraint, not a bug). The production `S3Storage`
implementation only ever does outbound `fetch`, which IS exercised on
Workers.
