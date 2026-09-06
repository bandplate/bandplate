# bandlib

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
   in — every variable is documented there, including
   `BANDLIB_TRUSTED_PROXY_DEPTH` (get this wrong and the login rate limit is
   either shared across everyone behind your proxy, or bypassable outright —
   read the comment before deploying). The app validates this config once,
   at startup, and refuses to start with a message naming the specific
   variable if something required is missing — including refusing to start
   with no way to send login emails (set `BANDLIB_SMTP_*`, or
   `BANDLIB_ALLOW_DEV_MAILER=true` for local dev only).
2. **Run migrations** against `BANDLIB_DATABASE_URL`:
   ```sh
   BANDLIB_DATABASE_URL=file:./apps/web/.data/bandlib.db \
     pnpm --filter @bandlib/db run migrate
   ```
3. **Start the app** (`pnpm --filter web dev` for local dev, or build +
   `pnpm --filter web preview` / your Node host for a real deployment) and
   visit `/setup`. This page only exists until the first member is created —
   it 404s permanently afterward. Enter the bootstrap token from your env
   config plus your own name and email; on success you're signed in as the
   first admin and told whether the mail self-test succeeded, so a broken
   mailer is caught here rather than by the first member who can't log in.
4. From `/admin/members`, add the rest of the band. Each member signs in by
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
                   the SMTP one behind its own `@bandlib/mail/smtp` entry
                   point so importing the barrel never pulls in nodemailer)
  ui/             Design tokens + shared UI primitives (button/field/banner,
                   Tailwind v4 theme)
e2e/              (reserved for end-to-end tests, not yet populated)
```

`packages/core`, `packages/db` and `packages/api` must run unmodified on
Cloudflare Workers — no `node:*` imports or Node-only globals. `apps/web`
runs on Node today and is where Node-specific code (env reads, the SMTP
mailer, the libSQL client) is confined, so a future Workers profile
(increment 7) can swap just that composition root.

Brand values (colors, fonts) are not hardwired into components — they live in
`packages/ui/src/tokens/*.css` as a swappable token layer.
