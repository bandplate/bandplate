# Self-hosting bandplate

bandplate is meant to be run by the band that uses it. This is the full
first-run guide for a fresh deployment or a local scratch database. For a
two-minute look at the app without deploying anything, see "Try it locally"
in the [README](../README.md).

Two deployment profiles build from the same source tree, selected per build
by `BANDPLATE_ADAPTER`:

- **Node** (default) — `astro build && node dist/start.mjs`, anywhere Node 20
  runs. SQLite via libSQL, any S3-compatible bucket.
- **Cloudflare Workers** — `BANDPLATE_ADAPTER=cloudflare astro build`, then
  `wrangler deploy`. D1 for the database, R2 for audio. See
  [`deploy-cloudflare.md`](deploy-cloudflare.md).

## Toolchain

- Node 20.18.1 (see `.nvmrc`)
- pnpm 10.33.0, managed via corepack (`"packageManager"` in `package.json`)

```sh
corepack enable
pnpm install
```

## 1. Configure

Copy `apps/web/.env.example` to `apps/web/.env` and fill it in. Every
variable is documented in that file.

The app validates this config **once, at startup**, and refuses to start
with a message naming the specific variable if something required is
missing. That includes refusing to start with no way to send login emails
(set `BANDPLATE_SMTP_*`, or `BANDPLATE_ALLOW_DEV_MAILER=true` for local dev
only, which is refused outright once `NODE_ENV=production`) and with no
object storage configured. There is no "no storage" mode: every take's
audio lives in a bucket.

### Object storage

For local dev, `deploy/node/compose.yml` starts a MinIO container and
creates the bucket for you:

```sh
cd deploy/node && docker compose up -d minio minio-init
```

The `S3_*` defaults in `.env.example` (`S3_ENDPOINT=http://localhost:9000`,
`S3_PUBLIC_ENDPOINT=http://localhost:9000`, `S3_BUCKET=bandplate`,
`S3_ACCESS_KEY_ID=bandplate-dev`, `S3_SECRET_ACCESS_KEY=bandplate-dev-secret`)
already match that path, for `apps/web` running directly on the host and
reaching the compose-started MinIO at `localhost`.

The one case that needs a **different** `S3_ENDPOINT` is running `apps/web`
itself inside `deploy/node/compose.yml`'s own `app` service. Point
`S3_ENDPOINT` at `http://minio:9000` there (the compose network's internal
hostname); `S3_PUBLIC_ENDPOINT` stays `http://localhost:9000` regardless,
since the browser is never on that network.

**`S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` are allowed to differ, and inside
that `app` service they must.** The `.env.example` comment on those two
variables explains exactly why: a presigned URL signed against the wrong one
403s or hangs in the browser with no obvious cause.

### One variable that is a decision, not a value

**`BANDPLATE_TRUSTED_PROXY_DEPTH`** controls how many reverse-proxy hops in
front of bandplate are trusted to have appended their own observed peer
address to `X-Forwarded-For`. That is how the login rate limiter picks the
real client IP.

It defaults to `1`, correct for the common case of one edge or proxy (a CDN,
a PaaS router, a single nginx/Caddy) in front of the app.

**If bandplate has no reverse proxy in front of it at all — it receives
connections directly from clients — set this to `0`.** Left at `1` with no
fronting proxy, a client can set `X-Forwarded-For` on their own request with
nothing trustworthy having appended to it, letting an attacker pick an
arbitrary rate-limit bucket per request and bypass the login rate limit
entirely.

Get it wrong the other way (`0` behind a real proxy) and the rate-limit
bucket becomes the proxy's own address, shared across everyone behind it.

## 2. Run migrations

```sh
BANDPLATE_DATABASE_URL=file:./apps/web/.data/bandplate.db \
  pnpm --filter @bandplate/db run migrate
```

## 3. (Optional) Seed example data

A generic demo band lineup — songs, events, takes, votes — useful for trying
the app or for local dev. **Skip this against a real deployment's database.**

It reads the same `BANDPLATE_DATABASE_URL` as the migration step (or the bare
`DATABASE_URL`, accepted as a fallback) and fails loudly, naming the
variable, if neither is set. It will not silently write to some default local
file if you forget it.

```sh
BANDPLATE_DATABASE_URL=file:./apps/web/.data/bandplate.db \
  pnpm --filter @bandplate/db run seed
```

The seed creates asset **rows**, so the UI has something to show, but not
real audio bytes behind them. Run the dev upload script to put real, playable
encoded audio behind every seeded take, so the player actually has something
to play. It needs `ffmpeg` on PATH and the same `S3_*` config as the app:

```sh
BANDPLATE_DATABASE_URL=file:./apps/web/.data/bandplate.db \
  S3_ENDPOINT=http://localhost:9000 S3_PUBLIC_ENDPOINT=http://localhost:9000 \
  S3_BUCKET=bandplate S3_REGION=auto \
  S3_ACCESS_KEY_ID=bandplate-dev S3_SECRET_ACCESS_KEY=bandplate-dev-secret \
  pnpm --filter @bandplate/db run dev:upload-audio
```

## 4. Build and start

For local dev, `pnpm --filter web dev` is fine.

For a real deployment, build and start with **`pnpm --filter web start`**.
Not `astro preview` (dev-only), and not `node dist/server/entry.mjs`
directly.

`start` runs `node dist/start.mjs`, a small dependency-free wrapper (bundled
by `pnpm build` itself — see `apps/web/scripts/build-start.mjs`) that
validates configuration and fails loudly *before* the server binds a port.
Running the built adapter entry directly skips that check: it binds the
port, prints "Server listening" regardless of whether configuration is
valid, and only 500s once the first real request arrives. To a supervisor or
a `docker run` health check, that looks like a healthy boot.

`dist/` is the only thing this needs beyond production `node_modules` — no
dev tooling, no `src/`. That is verified by running it from a scratch
directory containing nothing but `dist/`, `package.json`, and a
`pnpm install --prod` node_modules.

> Astro's own `security.checkOrigin` CSRF guard is disabled in
> `astro.config.mjs` for a related reason: under the standalone Node adapter
> it checks the wrong origin and 403s every real form POST in the built
> server. See the comment there. The app's own `isSameOrigin` check, applied
> by every mutating page route, is what actually guards CSRF here, backed by
> a structural check in `apps/web/src/middleware.ts` that rejects any
> mutating page request with a mismatched `Origin` whether or not the
> specific page remembered its own check.

## 5. Create the first member

Once it is running, visit `/setup`. This page only exists until the first
member is created; it 404s permanently afterward.

Enter the bootstrap token from your env config plus your own name and email.
On success you are signed in as the first admin, and told whether the mail
self-test succeeded — so a broken mailer is caught here rather than by the
first member who cannot log in.

## 6. Add the band

From `/admin/members`, add everyone else. Each member signs in by requesting
a link at `/login` with their email. There are no passwords.

## Feeding it recordings

`/admin/tokens` issues ingest tokens. A token with the `ingest:write` scope
and nothing else is all any ingest route checks, so one that leaks off a
laptop cannot read votes or touch members.

[reapertoire](https://github.com/bandplate/reapertoire) uses such a token to
push a rendered rehearsal straight from REAPER. The wire format is
[`ingest-contract-v1.md`](ingest-contract-v1.md), and anything that can
speak it will do — reapertoire is one client, not a requirement.

## Everyday scripts

Each fans out across the workspace with `pnpm -r`:

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
```
