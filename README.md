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

## Workspace layout

```
apps/
  web/            Astro app (server output, @astrojs/node adapter)
packages/
  core/           Domain layer — runtime-agnostic, no node:* imports
  api/            Hono app (createApp), mounted under /api by apps/web
  ui/             Design tokens (CSS custom properties + Tailwind v4 theme)
e2e/              (reserved for end-to-end tests, not yet populated)
```

`packages/core` and `packages/api` must run unmodified on Cloudflare Workers —
no `node:*` imports or Node-only globals. Node-specific code is confined to
`deploy/node/` and build tooling (added in later increments).

Brand values (colors, fonts) are not hardwired into components — they live in
`packages/ui/src/tokens/*.css` as a swappable token layer.
