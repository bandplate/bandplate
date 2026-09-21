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
pnpm exec wrangler --version     # 4.136.0
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

Rotating the keys silently kills every existing subscription: each stored
row is stamped with the `vapidKeyId` it subscribed under, sends against an
old key ID are skipped, and a device only starts working again once its
member reopens `/me` and it re-subscribes under the current key.

## 4. Migrate — before every deploy, unconditionally

```
cd apps/web
pnpm migrate:remote
```

Run this as its own explicit step **before** `pnpm exec wrangler deploy`, every
time, not just the first time. It is not run automatically on startup
(same posture as the Node profile, which runs `pnpm --filter @bandplate/db
migrate` as its own step, not on boot) — but unlike the Node profile,
there is no server process here to fail loudly if you forget: the first
request against an unmigrated D1 database just gets a bare 500 from a
query against a schema-less table, with nothing in the response and
nothing obviously wrong about the deploy that produced it.

### Migrations

**Always run `pnpm migrate:remote`. Never run `wrangler d1 migrations apply
DB --remote` directly.** The raw command is exactly what deleted ~2,000 rows
on 2026-09-20: a Drizzle table-rebuild migration (create `__new_takes`, copy
every row across, `DROP TABLE takes`, rename `__new_takes` back) applied
cleanly, and D1 cascaded the `DROP TABLE` into every child table that
referenced `takes` — votes, assets, everything. **`PRAGMA
foreign_keys=OFF`, set immediately before the drop, does not stop this on
D1.** That pragma is a SQLite-only safety net; D1 does not honor it for its
own cascade behavior.

`pnpm migrate:remote` (`apps/web/scripts/migrate-remote.ts`) wraps the raw
apply with two things it doesn't have on its own:

1. **A guard.** Before touching the database, it reads every pending
   migration file and refuses to proceed if any of them contains a `DROP
   TABLE`, an `ALTER TABLE ... RENAME TO`, an identifier starting `__new_`
   (Drizzle's rebuild-and-swap idiom), or a `PRAGMA foreign_keys`
   statement. It prints each offending line and exits without applying
   anything. See `@bandplate/db/migration-guard` (`findUnsafeStatements`).
2. **A backup.** If the guard passes, it exports the whole remote database
   with `wrangler d1 export DB --remote` to
   `.data/backups/d1-<ISO timestamp>.sql` before applying anything, and
   aborts if the export fails or comes back empty. `.data/` is gitignored,
   so this backup stays local. Copy it somewhere durable if you want it to
   survive longer than your machine.

**Schema changes against this database are additive only:** `ADD COLUMN`,
new tables, new indexes. That covers everything this app has needed so
far. If a change genuinely cannot be additive (SQLite can't alter a column
in place, so narrowing a type or dropping `NOT NULL` needs the rebuild
idiom above), it needs a deliberate, reviewed exception, not an unattended
`pnpm migrate:remote` run. Talk it through, write the migration by hand
with every hand-added index restored (see
[`frontend-traps.md`](frontend-traps.md)'s "A drizzle-kit table rebuild
silently drops a hand-added index"), and add its file name to
`UNSAFE_BASELINE` in `packages/db/src/migration-guard.ts` only once it has
actually been reviewed and applied, never ahead of that, and never as a
way to get the guard out of your way.

**Run `pnpm migrate:remote --dry-run` first** if you want to see what the
guard says without touching anything: it lists pending migrations, runs
the guard, and stops.

#### Restoring from a backup

If a migration needs to be rolled back, or applied cleanly on top of a
restore, replay the export file against the remote database:

```
pnpm exec wrangler d1 execute DB --remote --file=.data/backups/d1-<timestamp>.sql
```

A large export can be too big for one `execute` call. If it fails on size,
split the file into chunks along its statement boundaries (each
`CREATE TABLE`/`INSERT` block is self-contained) and run each chunk as its
own `--file=` call, in order.

## 5. Build and deploy

**Use `pnpm ship` (from the repo root) rather than running these by hand.**
It runs the whole gate below itself — dirty tree, unpushed HEAD, pending
migrations — and stops on the first thing that fails, in
`set -euo pipefail` style (every subprocess's exit code is checked; nothing
is swallowed):

```
pnpm ship
```

In order: refuses if the working tree is dirty; refuses if `HEAD` isn't
pushed to `origin/main`; refuses if `wrangler d1 migrations list DB
--remote` reports anything pending (run `pnpm migrate:remote` first — this
script never applies migrations itself); then `BANDPLATE_ADAPTER=cloudflare
pnpm exec astro build` and `pnpm exec wrangler deploy`, both from
`apps/web`. The source is `apps/web/scripts/deploy.ts`, run via `tsx`,
mirroring `migrate-remote.ts`'s style — the decidable parts (is the tree
clean, is HEAD pushed, what to do about a pending-migrations list) live in
the pure, node-tested `apps/web/scripts/deploy-guard.ts`.

(`pnpm deploy` is a built-in pnpm command — a root script literally named
`deploy` would be shadowed by it and never run, which is why this one is
named `ship`.)

Equivalent by hand, if you need to skip straight to build/deploy for some
reason (not recommended — you lose every guard above):

```
cd apps/web
BANDPLATE_ADAPTER=cloudflare pnpm exec astro build   # → dist/server/ + dist/client/
pnpm migrate:remote                                  # step 4, repeated — don't skip on redeploys
pnpm exec wrangler deploy
```

`BANDPLATE_ADAPTER=cloudflare` is the only thing that switches the build
— omit it and `astro build` produces the unchanged Node profile
(`dist/start.mjs`) instead.

The build also writes `.wrangler/deploy/config.json`, which points every
later `wrangler` command in `apps/web` (`deploy`, `dev`, `d1 migrations`)
at the generated `dist/server/wrangler.json` instead of your
`wrangler.toml`. That generated file is your `wrangler.toml` with the
entry and assets paths filled in by the build, so nothing you configured is
lost, but it only changes when you rebuild: edit `wrangler.toml`, then
build again before deploying.

## 6. Gated deploys from CI

Every push to `main` that passes the existing `build` job (typecheck,
lint, test, build) also runs a `deploy` job in `.github/workflows/ci.yml`,
gated with `concurrency: deploy-production` so two deploys can never race.
It runs the same pending-migrations check as `pnpm ship`
(`apps/web/scripts/check-remote-migrations.ts` — the same code, not a
second parse of `wrangler`'s output) and **fails the job if anything is
pending**; CI never applies migrations itself, only `pnpm migrate:remote`
run by hand does that.

The job needs three repository secrets:

- **`CLOUDFLARE_API_TOKEN`** — scoped to `Workers Scripts:Edit`,
  `D1:Edit`, and `Account Settings:Read`. That's enough to build and
  deploy the Worker and to list/read D1 migration state; it is
  deliberately not scoped to apply migrations or write secrets — those
  stay a human's job (`pnpm migrate:remote`, `wrangler secret put`).
- **`CLOUDFLARE_ACCOUNT_ID`** — your Cloudflare account id (same value
  wrangler already needs locally).
- **`WRANGLER_TOML`** — the deploying account's complete
  `apps/web/wrangler.toml` (the file itself is gitignored — see "Before
  anything" above), written to disk as-is (`printf '%s' "$WRANGLER_TOML" >
  apps/web/wrangler.toml`) before the migrations check and build run. It
  must be the **whole** file, including the `[observability]` block
  (`enabled = true`, `head_sampling_rate = ...`) — a `WRANGLER_TOML` secret
  copied from an older local file that predates that block will deploy
  successfully but silently ship without Workers Logs/observability
  configured.

  **Upgrading a `WRANGLER_TOML` (or local `wrangler.toml`) from before the
  Astro 7 upgrade:** two lines change, both already in
  `wrangler.toml.example`. `main` becomes `"./src/worker.ts"` (it was
  `"dist/_worker.js/index.js"`), and `[assets]` loses its
  `directory = "dist"` line, keeping only `binding = "ASSETS"`. The build
  fails on the old `main`, since that file no longer exists. Leave `main`
  out entirely and the build succeeds with the adapter's stock entry,
  which has no `scheduled` handler: the site works and the notification
  cron silently does nothing.

If `CLOUDFLARE_API_TOKEN` is unset (a fork, or a repo that hasn't been set
up for production deploys yet), the job's first step prints `deploy
skipped: secrets not configured` and every later step is skipped via an
`if:` on that step's output — the job still exits 0, and the `build` job
it depends on is completely unaffected.

**Migrations are still never automatic**, in CI or locally: the sanctioned
way to apply one to the real database is `pnpm migrate:remote`
(`apps/web/scripts/migrate-remote.ts`), run by hand, before the deploy that
needs it — see "Migrate — before every deploy, unconditionally" above.

## Scheduled tick

`wrangler.toml.example` ships `[triggers] crons = ["*/10 * * * *"]`, which
runs the notification tick every 10 minutes — matching
`NOTIFICATION_TICK_INTERVAL_MS` on the Node profile. The Worker's `scheduled` handler
(`src/worker.ts`, alongside the normal `fetch` one — wired in by
`main = "./src/worker.ts"` in `wrangler.toml`) calls
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

To fire the scheduled tick without waiting for the cron itself, hit the
local-only route `wrangler dev` serves for exactly that (it changes
nothing about the deploy config):

```
pnpm exec wrangler dev
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/10+*+*+*+*"
```

(The older `--test-scheduled` flag and its `/__scheduled` route do nothing
for this build: wrangler injects that route while bundling, and the Worker
now arrives already bundled by the Astro build. The request falls through
to the app, which redirects it to `/login`.)

The `curl` should return `200` with the body `ok`, and the `wrangler dev` terminal logs the
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
