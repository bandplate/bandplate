# bandplate

A self-hostable web app where a band browses, plays, and votes on its
rehearsal recordings.

## Toolchain

- Node 20.18.1 (see `.nvmrc`)
- pnpm 10.33.0, managed via corepack (`"packageManager"` in `package.json`)
- TypeScript (strict), ESM throughout
- Astro 5 (`apps/web`), Hono (`packages/api`), Tailwind CSS v4 (`packages/ui`)
- Biome for lint + format
- Vitest for unit tests

## Install & run

```sh
corepack enable
pnpm install
pnpm --filter web dev
```

Other scripts (fan out across the workspace with `pnpm -r`):

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
```

## First run (a fresh deployment or a local scratch database)

1. **Configure.** Copy `apps/web/.env.example` to `apps/web/.env` and fill it
   in — every variable is documented there. The app validates this config
   once, at startup, and refuses to start with a message naming the specific
   variable if something required is missing — including refusing to start
   with no way to send login emails (set `BANDPLATE_SMTP_*`, or
   `BANDPLATE_ALLOW_DEV_MAILER=true` for local dev only, which is also
   refused outright once `NODE_ENV=production`) and with no object storage
   configured (`S3_*` — see the next step; there is no "no storage" mode,
   every take's audio lives there).

   **Object storage (audio).** For local dev, `deploy/node/compose.yml`
   starts a MinIO container and creates the bucket for you:
   ```sh
   cd deploy/node && docker compose up -d minio minio-init
   ```
   Then fill in the `.env`'s `S3_*` block — the defaults there
   (`S3_ENDPOINT=http://localhost:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`,
   `S3_BUCKET=bandplate`, `S3_ACCESS_KEY_ID=bandplate-dev`,
   `S3_SECRET_ACCESS_KEY=bandplate-dev-secret`) already match this path —
   `apps/web` running directly on the host (`pnpm --filter web dev`, or
   `pnpm build && pnpm start`), reaching the compose-started MinIO at
   `localhost`. The one case that needs a DIFFERENT `S3_ENDPOINT` is
   running `apps/web` itself inside `deploy/node/compose.yml`'s own `app`
   service — point `S3_ENDPOINT` at `http://minio:9000` there instead
   (the compose network's internal hostname; `S3_PUBLIC_ENDPOINT` stays
   `http://localhost:9000` regardless, since the browser is never on that
   network). **`S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` are allowed to
   differ, and inside that `app` service they must** — see the `.env.example`
   comment on those two variables for exactly why (a presigned URL signed
   against the wrong one 403s/hangs in the browser with no obvious cause).

   One variable needs a deployment-time decision, not just a value:
   **`BANDPLATE_TRUSTED_PROXY_DEPTH`** controls how many reverse-proxy hops in
   front of bandplate are trusted to have appended their own observed peer
   address to `X-Forwarded-For` — this is how the login rate limiter picks
   the real client IP. It defaults to `1`, correct for the common case of
   one edge/proxy (a CDN, a PaaS router, a single nginx/Caddy) in front of
   the app. **If bandplate has no reverse proxy in front of it at all —
   it receives connections directly from clients — set this to `0`.** Left
   at `1` with no fronting proxy, a client can set `X-Forwarded-For` on
   their own request with nothing trustworthy having appended to it, letting
   an attacker pick an arbitrary rate-limit bucket per request and bypass
   the login rate limit entirely. Get it backwards the other way (`0` behind
   a real proxy) and the rate limit bucket becomes the proxy's own address,
   shared across everyone behind it.
2. **Run migrations** against `BANDPLATE_DATABASE_URL`:
   ```sh
   BANDPLATE_DATABASE_URL=file:./apps/web/.data/bandplate.db \
     pnpm --filter @bandplate/db run migrate
   ```
3. **(Optional) Seed example data** — a generic demo band lineup (songs,
   events, takes, votes), useful for trying the app or for local dev.
   **Skip this against a real deployment's database.** It reads the same
   `BANDPLATE_DATABASE_URL` as the migration step above (or the bare
   `DATABASE_URL`, accepted as a fallback) and now fails loudly, naming the
   variable, if neither is set — it will NOT silently write to some default
   local file if you forget it:
   ```sh
   BANDPLATE_DATABASE_URL=file:./apps/web/.data/bandplate.db \
     pnpm --filter @bandplate/db run seed
   ```
   The seed creates asset ROWS (so the UI has something to show) but not
   real audio bytes behind them — run the dev upload script (needs
   `ffmpeg` on PATH, and the same `S3_*` config as the app) to put real,
   playable encoded audio behind every seeded take, so the player actually
   has something to play:
   ```sh
   BANDPLATE_DATABASE_URL=file:./apps/web/.data/bandplate.db \
     S3_ENDPOINT=http://localhost:9000 S3_PUBLIC_ENDPOINT=http://localhost:9000 \
     S3_BUCKET=bandplate S3_REGION=auto \
     S3_ACCESS_KEY_ID=bandplate-dev S3_SECRET_ACCESS_KEY=bandplate-dev-secret \
     pnpm --filter @bandplate/db run dev:upload-audio
   ```
4. **Build and start the app.** For local dev, `pnpm --filter web dev` is
   fine. For a real deployment, build (`pnpm --filter web build`) and start
   with **`pnpm --filter web start`** — NOT `astro preview` (dev-only) and
   NOT `node dist/server/entry.mjs` directly. `start` runs `node
   dist/start.mjs`, a small dependency-free wrapper (bundled by `pnpm
   build` itself — see `apps/web/scripts/build-start.mjs`) that validates
   configuration and fails loudly *before* the server binds a port; running
   the built adapter entry directly skips that check, binds the port,
   prints "Server listening" regardless of whether configuration is valid,
   and only 500s once the first real request arrives — which looks like a
   healthy boot to a supervisor or `docker run` health check. `dist/` is
   the only thing this needs beyond production `node_modules`: no dev
   tooling, no `src/` — verified by running it from a scratch directory
   containing nothing but `dist/`, `package.json`, and a `pnpm install
   --prod` node_modules (see task-4-report.md). (Astro's own
   `security.checkOrigin` CSRF guard is disabled in `astro.config.mjs` for
   a related reason: under the standalone Node adapter it checks the wrong
   origin and 403s every real form POST in the built server — see the
   comment there. The app's own `isSameOrigin` check, applied by every
   mutating page route, is what actually guards CSRF here — backed up by a
   structural check in `apps/web/src/middleware.ts` that rejects any
   mutating page request with a mismatched `Origin` regardless of whether
   the specific page remembered its own check.)

   Once it's running, visit `/setup`. This page only exists until the first
   member is created — it 404s permanently afterward. Enter the bootstrap
   token from your env config plus your own name and email; on success
   you're signed in as the first admin and told whether the mail self-test
   succeeded, so a broken mailer is caught here rather than by the first
   member who can't log in.
5. From `/admin/members`, add the rest of the band. Each member signs in by
   requesting a link at `/login` with their email — there is no password.

## Workspace layout

```
apps/
  web/            Astro app (server output, @astrojs/node adapter) — the
                   composition root: reads env, builds the db/mailer/rate
                   limiter, hosts the auth pages and admin screens, and
                   mounts packages/api's JSON API under /api/*.
packages/
  core/           Domain layer — runtime-agnostic, no node:* imports
  db/             Drizzle schema + repos — runtime-agnostic, no node:* imports
  api/            Hono app (createApp), mounted under /api by apps/web
  mail/           Mailer implementations (console/null/capturing + SMTP,
                   the SMTP one behind its own `@bandplate/mail/smtp` entry
                   point so importing the barrel never pulls in nodemailer)
  storage/        Object storage — `S3Storage` (aws4fetch, MinIO/R2-compatible
                   SigV4 signing), runtime-agnostic. `InMemoryStorage` (a
                   conformance-tested fake, `./testing` entry point only)
                   is the one place in this package that uses `node:*`.
  ui/             Design tokens + shared UI primitives (button/field/banner,
                   Tailwind v4 theme)
deploy/
  node/           `compose.yml` — local-dev MinIO + bucket creation (see
                   "First run" above); not a production deploy recipe.
e2e/              (reserved for end-to-end tests, not yet populated)
```

`packages/core`, `packages/db`, `packages/api` and `packages/storage` must
run unmodified on Cloudflare Workers — no `node:*` imports or Node-only
globals. `apps/web` runs on Node today and is where Node-specific code (env
reads, the SMTP mailer, the libSQL client) is confined, so a future Workers
profile (increment 7) can swap just that composition root — including
swapping `packages/storage`'s `S3Storage` for one pointed at R2's
S3-compatible endpoint (same class, no code change; see that package's own
header comment for why NOT the R2 binding).

Brand values (colors, fonts) are not hardwired into components — they live in
`packages/ui/src/tokens/*.css` as a swappable token layer.
