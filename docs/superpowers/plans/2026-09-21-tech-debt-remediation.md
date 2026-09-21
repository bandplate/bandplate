# Tech-debt remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay down the 13 prioritized tech-debt items from the 2026-09-21 analysis, highest risk first, without changing user-visible behaviour.

**Architecture:** Phase 1 puts guardrails around production (migration guard, observability, a gated deploy path, security patch bumps, push hygiene). Phase 2 does the risky upgrades and the stash-privacy consolidation, one at a time, each behind the full gate. Phase 3 is test debt and toolchain. Each task is a self-contained commit series on the `chore/tech-debt` branch.

**Tech Stack:** pnpm monorepo; Astro 5 + Preact islands (apps/web); Hono (packages/api); Drizzle on libSQL / Cloudflare D1 (packages/db); vitest; Biome 1.9; Cloudflare Workers via wrangler.

**Spec:** The tech-debt analysis in the owner's session (2026-09-21). Its content is restated per task below; there is no separate spec file.

## Global Constraints

- Read `CLAUDE.md` and `docs/frontend-traps.md` at the repo root before starting. Both bind every task.
- Gate before every commit: `pnpm typecheck && pnpm lint && pnpm test`, all three exit 0. Never pipe the gate through something that masks its exit code.
- Every Bash call starts with `export PATH="/opt/homebrew/bin:$PATH"`.
- Never read or write any `.env` file (a safety hook blocks it). The dev server gets its config as exported env vars, see "Dev server" below.
- Commit with `git commit --no-gpg-sign`. No `Co-Authored-By` or any attribution lines. Never commit anything under `.superpowers/`.
- Never run anything against production: no `wrangler deploy`, no `wrangler d1 ... --remote`, no `wrangler secret`. The controller deploys.
- Never post to GitHub (no `gh pr comment`, no issues).
- Foreign keys are never enforced (`PRAGMA foreign_keys` off, matching D1). D1 CASCADEs on `DROP TABLE` regardless, which is why a table-rebuild migration destroyed data on 2026-09-20.
- Decidable logic lives in pure `.ts` modules with node-only vitest tests (there is no jsdom).
- Both locales in the same commit if any i18n string changes (parity test).
- `apps/web/wrangler.toml` is gitignored (per-deployer); the tracked template is `apps/web/wrangler.toml.example`.
- Dev server (for tasks that must verify in a browser), run from `apps/web` with a COPY of `.data/bandlib.db` placed in the worktree's own `.data/`:
  `BANDPLATE_DATABASE_URL="file:<worktree>/.data/bandlib.db" BANDPLATE_APP_ORIGIN="http://localhost:4410" BANDPLATE_DEFAULT_LOCALE=en BANDPLATE_BOOTSTRAP_TOKEN=devtoken BANDPLATE_COOKIE_SECURE=false BANDPLATE_TRUSTED_PROXY_DEPTH=0 S3_ENDPOINT=http://localhost:9000 S3_PUBLIC_ENDPOINT=http://localhost:9000 S3_BUCKET=bandplate S3_REGION=us-east-1 S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin pnpm exec astro dev --port 4410 --force`
  Sign in as admin@example.com; the sign-in link is printed to the server log (dev mailer). Stop the server when done.

---

## Phase 1: guardrails

### Task 1: Migration guard and the D1 cascade rule, written down

**Files:**
- Create: `packages/db/src/migration-guard.ts`, `packages/db/src/migration-guard.test.ts`
- Create: `apps/web/scripts/migrate-remote.ts`
- Modify: `apps/web/package.json` (script `migrate:remote`), `packages/db/package.json` exports if needed
- Modify: `docs/deploy-cloudflare.md`, `docs/frontend-traps.md`

**Interfaces:**
- Produces: `findUnsafeStatements(sql: string): { line: number; statement: string; reason: string }[]` and `UNSAFE_BASELINE: readonly string[]` (file names of already-applied migrations exempt from the check: `0000`–`0011` as they exist today), exported from `@bandplate/db/migration-guard`.

Unsafe patterns (case-insensitive, ignoring `--` comments): `DROP TABLE`, `ALTER TABLE ... RENAME TO`, any identifier starting `__new_` (Drizzle's rebuild idiom), `PRAGMA foreign_keys`. Reason strings in plain English saying D1 cascades on DROP TABLE.

- [ ] Step 1: Write failing tests for `findUnsafeStatements`: a pure `ALTER TABLE x ADD COLUMN` passes; each unsafe pattern is caught with its line number; a pattern inside a `--` comment is ignored; lower-case variants are caught.
- [ ] Step 2: Write a test that reads every file in `packages/db/migrations/sqlite/*.sql` not listed in `UNSAFE_BASELINE` and asserts `findUnsafeStatements` returns `[]`. This makes CI refuse a future rebuild migration.
- [ ] Step 3: Implement; run `pnpm --filter @bandplate/db test`; pass.
- [ ] Step 4: `apps/web/scripts/migrate-remote.ts` (run with `tsx`). In order: (a) `wrangler d1 migrations list DB --remote` to get pending migration names; if none, print so and exit 0; (b) run the guard over each pending file, and on any finding print them and exit 1 without touching the database; (c) `wrangler d1 export DB --remote --output=<repo>/.data/backups/d1-<ISO timestamp>.sql`, and exit 1 if the export fails or the file is empty; (d) `wrangler d1 migrations apply DB --remote`. Pass `--dry-run` to stop after (b). Use `node:child_process` `spawnSync` with `stdio: "inherit"` where output matters and check every exit code. Add `"migrate:remote": "tsx scripts/migrate-remote.ts"` to apps/web. `.data/` is already gitignored.
- [ ] Step 5: Verify locally that `pnpm --filter @bandplate/web exec tsx scripts/migrate-remote.ts --help` (or a `--dry-run` against a fake: factor the pending-list parsing into the guard module as `parsePendingMigrations(listOutput: string): string[]` and unit-test it with a captured sample of wrangler's table output) works. Do NOT run against --remote.
- [ ] Step 6: `docs/deploy-cloudflare.md`: a "Migrations" section saying: always `pnpm migrate:remote`, never raw `wrangler d1 migrations apply --remote`; D1 cascades on DROP TABLE even with `PRAGMA foreign_keys=OFF`; schema changes are additive (`ADD COLUMN`, new tables); how to restore from the backup file (`wrangler d1 execute DB --remote --file=...`, in chunks if large). Plain prose, no em-dash splices.
- [ ] Step 7: `docs/frontend-traps.md`: two new entries in the file's existing style: (1) importing `@lucide/astro` from its barrel made every dev SSR request load ~1,600 icon modules (1.5 s/page); import `@lucide/astro/icons/<name>`; (2) a dependency Vite discovers late re-optimizes mid-session and the open page fails every island with "504 Outdated Optimize Dep"; add it to `optimizeDeps.include` in `astro.config.mjs`, and restart with `--force` to recover.
- [ ] Step 8: Gate; commit `feat(db): refuse table-rebuild migrations and back up D1 before applying`.

### Task 2: Production observability

**Files:**
- Modify: `apps/web/wrangler.toml.example`, `apps/web/wrangler.toml` (local, untracked: make the same edit so the controller's next deploy carries it)
- Modify/Create: the request error path in `apps/web/src/middleware.ts` (or wherever unhandled errors surface) and `apps/web/src/worker.ts` `scheduled`
- Test: a node test for any pure formatting helper you add

- [ ] Step 1: Add `[observability]\nenabled = true\nhead_sampling_rate = 1` with a comment saying Workers Logs is where `console.error` lands and where to look.
- [ ] Step 2: Find where an unhandled page/API error and a failed scheduled tick end up. Make each emit ONE structured `console.error(JSON.stringify({ level: "error", kind, route/cron, message, stack }))` line. Never log request bodies, cookies, emails or tokens. Put the record-building in a pure `apps/web/src/server/log-error.ts` with a node test (it drops unknown fields, truncates stack to 2 KB, never includes a `cookie`/`authorization` value even if passed).
- [ ] Step 3: Make sure existing "caught and logged" paths (e.g. home visit write failure in `server/pages/home.ts`) use the same helper.
- [ ] Step 4: Gate; commit `feat(ops): structured error logs and Workers observability`.

### Task 3: Gated deploys, local and CI

**Files:**
- Create: `scripts/deploy.sh` (repo root) or `apps/web/scripts/deploy.ts`; root `package.json` script `deploy`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/deploy-cloudflare.md`

- [ ] Step 1: `pnpm deploy` (root): runs the gate with `set -euo pipefail` semantics (any failure stops), refuses if the working tree is dirty or HEAD is not pushed to `origin/main`, checks there are no pending remote migrations (`wrangler d1 migrations list DB --remote`; if any are pending, stop and say "run pnpm migrate:remote first"), then `BANDPLATE_ADAPTER=cloudflare pnpm exec astro build` and `pnpm exec wrangler deploy` in `apps/web`. Do not run it.
- [ ] Step 2: CI `deploy` job: `needs: build`, runs only on `push` to `main`, `concurrency: deploy-production`. It writes `apps/web/wrangler.toml` from the secret `WRANGLER_TOML` (the file is gitignored; `printf '%s' "$WRANGLER_TOML" > apps/web/wrangler.toml`), uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, checks pending migrations exactly like step 1 and FAILS with a clear message if any are pending (CI never applies migrations), then builds and deploys. If `CLOUDFLARE_API_TOKEN` is empty, the job prints "deploy skipped: secrets not configured" and exits 0 (use a first step that sets an output, and gate later steps with `if:`).
- [ ] Step 3: Validate the YAML (`pnpm dlx @action-validator/cli .github/workflows/ci.yml` or `python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'`).
- [ ] Step 4: Document in `docs/deploy-cloudflare.md`: the three secrets, the scopes the API token needs (Workers Scripts:Edit, D1:Edit, Account Settings:Read), and that migrations stay a manual `pnpm migrate:remote`.
- [ ] Step 5: Gate; commit `ci: deploy main after the gate; pnpm deploy runs the gate locally`.

### Task 4: Security patch bumps (no framework upgrade)

**Files:** `packages/db/package.json` (drizzle-orm, drizzle-kit), `packages/mail/package.json` (nodemailer, @types/nodemailer), `apps/web/package.json` + `packages/api/package.json` (wrangler), `pnpm-lock.yaml`, whatever code the bumps require.

- [ ] Step 1: drizzle-orm `0.38.4` → latest `0.45.x` (≥0.45.2), and drizzle-kit to its matching version. Fix type errors. Run `pnpm --filter @bandplate/db test` and confirm `drizzle-kit generate` against the current schema produces NO new migration (schema unchanged).
- [ ] Step 2: nodemailer 6 → latest (≥9.1.0) and `@types/nodemailer` to match. Read nodemailer's changelog for breaking changes in 7, 8, 9, 10 that touch `createTransport`/`sendMail` as `packages/mail` uses them; adapt. `pnpm --filter @bandplate/mail test`.
- [ ] Step 3: wrangler → latest 4.x in both packages. Confirm `BANDPLATE_ADAPTER=cloudflare pnpm exec astro build` still succeeds in apps/web (build only, no deploy).
- [ ] Step 4: `pnpm audit --prod` and record in the report which high/critical advisories remain (expected: astro, sharp, undici, ws via astro/wrangler; handled in Task 8).
- [ ] Step 5: Gate; commit per dependency group.

### Task 5: Push unsubscribe on sign-out

**Files:** the logout route (`apps/web/src/pages/logout*`), the push client code (`apps/web/src/client/*push*`), `apps/web/public/sw.js` if needed, the push subscription repo in `packages/db`, tests.

- [ ] Step 1: Read how subscriptions are created and stored (endpoint per member). On sign-out the SERVER deletes every push subscription row for the signing-out session's device. Identify the device by the subscription endpoint the client sends with the logout form (a hidden field filled by a small script when a subscription exists), and fall back to doing nothing server-side when absent. The client also calls `subscription.unsubscribe()` before submitting.
- [ ] Step 2: The server side (delete by member + endpoint, never another member's row) gets a repo test. The client decision ("is there a subscription to send") lives in a pure helper with a node test.
- [ ] Step 3: Logout without JS keeps working exactly as today.
- [ ] Step 4: Gate; commit `fix(push): signing out stops this device's notifications`.

## Phase 2: upgrades and the privacy rule

### Task 6: Stash privacy in one place

**Files:** `packages/db/src/repos/takes.ts` (12 uses of `bandVisibleCondition`), `packages/db/src/repos/songs.ts`, any other repo that lists takes or counts them, new test file `packages/db/src/repos/stash-privacy.test.ts`.

- [ ] Step 1: Write the test first: seed two members, a band take, and a private stash take owned by member B. Call EVERY exported read function on every repo that returns takes, counts takes, or aggregates over takes (enumerate them from the repo modules; the test must fail if a new exported function is added and not listed, by comparing the list against `Object.keys(repo)` minus an explicit allowlist of non-reading functions). Assert member A never sees B's stash take in any result or count; B sees it only through the stash-specific functions.
- [ ] Step 2: Run it; record which (if any) fail.
- [ ] Step 3: Replace the 12 hand-copied conditions with one builder, e.g. `visibleTakes(viewerMemberId)` returning the SQL condition "band take, or private take owned by viewer" where the call site needs owner visibility, and `bandTakesOnly()` where it must never include private takes. Every listing uses one of the two. No behaviour change.
- [ ] Step 4: Test passes; gate; commit `refactor(db): one rule decides which takes a member can see`.

### Task 7: Biome 2, and components.css back under the linter

**Files:** root `package.json`, `biome.json`, `packages/ui/src/tokens/components.css` → split into `packages/ui/src/tokens/components/*.css` + an index, everything Biome 2 reformats or flags.

- [ ] Step 1: `@biomejs/biome` → latest 2.x; `pnpm exec biome migrate --write`. Fix new lint findings properly (no new blanket `biome-ignore`; any that remain carry a reason). Keep formatting settings identical so the diff is not a mass reformat; if Biome 2's formatter still changes files, commit that as its own "style: biome 2 formatting" commit.
- [ ] Step 2: Remove the `components.css` override and run `pnpm lint`. If Biome 2 parses `@starting-style` and `@-moz-document url-prefix()`, keep the file linted and fix real findings. If it still cannot parse them, keep the narrowest override that works and update the CLAUDE.md "gate" paragraph with the Biome 2 status.
- [ ] Step 3: Split `components.css` into files by the section banners it already has (one file per component family, in original order), with `components.css` becoming an ordered list of `@import`s. Prove equivalence: a script concatenates the parts in import order and `diff`s against the original; must be identical apart from the removed banner-only lines you moved. Check how the file is consumed (Tailwind v4 via Vite) and confirm the built CSS (`astro build`, node adapter) contains the same rules: compare `dist` CSS size before/after within 1%.
- [ ] Step 4: Browser check with the dev server: home, /takes, /songs, a take page, /record at 375 px and desktop, light and dark. Screenshots to the report folder.
- [ ] Step 5: Gate; commits.

### Task 8: Astro 7 and its adapters

**Files:** `apps/web/package.json`, `apps/web/astro.config.mjs`, `apps/web/src/worker.ts`, `apps/web/src/server/app.workers.ts`, anything the migration guides require; root `package.json` `engines`; `.github/workflows/ci.yml` Node version.

- [ ] Step 1: Read the Astro 6 and 7 upgrade guides and the `@astrojs/cloudflare` 13/14, `@astrojs/node` 10/11, `@astrojs/preact` 5/6 changelogs (context7 docs tool or web). Write the list of breaking changes that touch this app into the report BEFORE changing code: especially Node version floor, `Astro.locals.runtime`, the custom `workerEntryPoint` + `scheduled` export, sessions, `security.checkOrigin`, `imageService`, `platformProxy`, view transitions/`ClientRouter`, `astro check`.
- [ ] Step 2: Upgrade; fix. Node floor: raise `engines` and CI's `node-version` to what Astro 7 requires.
- [ ] Step 3: Verify: the gate; `pnpm build` (node adapter) and `node dist/start.mjs` boots and serves `/login`; `BANDPLATE_ADAPTER=cloudflare pnpm exec astro build` succeeds and the output still has `.assetsignore` and a `scheduled` export (`grep -c scheduled dist/_worker.js/*.mjs` or equivalent); `pnpm exec wrangler dev --local` serves `/login` with 200 and `GET /_worker.js/index.js` is 404.
- [ ] Step 4: Dev-server browser pass: sign in, home, /takes (play toggles hydrate), /record (Recorder island hydrates, song list scrolls), a take page with the player, the mixer page, /me, admin pages. No console errors. Screenshots.
- [ ] Step 5: `pnpm audit --prod`: astro/sharp/undici/ws high+critical gone; record what remains.
- [ ] Step 6: Gate; commit.

## Phase 3: test debt and toolchain

### Task 9: Player and Recorder decisions into pure modules

**Files:** `apps/web/src/components/Player.tsx`, `Recorder.tsx`, `Mixer.tsx`; new `apps/web/src/client/*.ts` modules + tests; `packages/ui` gets its first tests if it has pure logic (e.g. pagination item building).

- [ ] Step 1: In each island, list the decisions that do not need the DOM or audio (state transitions, what a button does given state, labels/format choices, queue/seek arithmetic, recorder stage machine: pick → ready → recording → review, discard/leave rules, which confirm to show). Write that list into the report.
- [ ] Step 2: For each, TDD a pure function in `apps/web/src/client/` (follow `player-actions.ts`'s header and style), then make the component call it. The component shrinks; behaviour is identical.
- [ ] Step 3: `packages/ui`: add vitest to the package if absent, and test any pure logic its components compute (Pagination's page list). If the logic is inline in `.astro` frontmatter, extract it to a `.ts` next to it first.
- [ ] Step 4: Browser check the recorder flow (pick song, start is only testable up to permission; the leave/discard modals), the player bar (play/pause/next/queue sheet), and the mixer loop buttons. Gate; commits.

### Task 10: Stash sync survives a member switch across tabs

**Files:** the stash offline queue and sync runner in `apps/web/src/client/` (search `memberId` near IndexedDB / sync), tests.

- [ ] Step 1: Read the sync runner. Today it checks the memberId; the gap is multi-tab: tab 1 signed in as A, tab 2 signs out and in as B, tab 1's runner (or a queued item) can still upload A's recording under B's session, or show A's pending items to B. Write a failing pure test for the decision function: given the queued item's `memberId` and the CURRENT session member (re-read from a source that reflects other tabs, e.g. a cookie-derived value or a `BroadcastChannel`/`storage` event), the runner must skip items that are not the current member's and must never display them.
- [ ] Step 2: Implement: re-check the current member immediately before each upload (not once at startup), and listen for the cross-tab signal to stop the runner. Keep pending items of other members in IndexedDB untouched (they upload when that member signs back in on this device).
- [ ] Step 3: Gate; commit `fix(stash): a queued recording only ever uploads as the member who made it`.

### Task 11: Zod without private internals

**Files:** `packages/api/src/routes/ingest/zod-json-schema.ts` and its consumers/tests.

- [ ] Step 1: Read what the file produces (JSON Schema for the ingest contract, see `docs/ingest-contract-v1.md`). Snapshot its current output for every schema it is called with into a test fixture (JSON) FIRST.
- [ ] Step 2: Replace the `_def` walking with `zod-to-json-schema` (established library, Zod 3 compatible) or Zod's public API, whichever reproduces the snapshot; where the library's output differs, normalize in a small post-processing step so the published contract stays byte-identical. Remove the related `biome-ignore`s.
- [ ] Step 3: Snapshot test passes; gate; commit.

### Task 12: Foreign keys: a test that catches the forgotten delete

**Files:** new `packages/db/src/repos/orphans.test.ts`; `packages/db/src/schema/sqlite/index.ts` (read only); repos with `remove` functions.

- [ ] Step 1: Use Drizzle's `getTableConfig(table).foreignKeys` to enumerate every FK. Build a map from each referenced (parent) table to the repo function that deletes a parent row (e.g. `songsRepo.remove`, `takesRepo.remove`, member removal, event removal). The test FAILS if a parent table referenced by any FK has no entry in the map and is not on an explicit allowlist with a one-line reason (e.g. "members are never deleted, only revoked").
- [ ] Step 2: For each mapped parent: seed a parent row plus one child row in EVERY table that references it, call the remove function, assert zero orphan rows in each child table (for FKs declared `onDelete: cascade`) or that the child's FK column is null (for `set null`).
- [ ] Step 3: Fix any orphan it finds by extending the repo's explicit deletes. Gate; commit `test(db): every parent delete leaves no orphans`.

### Task 13: TypeScript 7 and vitest 5

**Files:** every `package.json` with `typescript`/`vitest`, tsconfigs, vitest configs, test code the upgrade breaks.

- [ ] Step 1: vitest 2 → 5 in every package. Read the 3/4/5 migration notes; fix config and API changes. All tests pass.
- [ ] Step 2: TypeScript → 7. `tsc --noEmit` packages first. `apps/web` typechecks with `astro check`, which depends on `@astrojs/check`'s TypeScript integration: if `astro check` does not support TS 7, keep apps/web on the newest 5.x/6.x that it supports (pin it there with a comment saying why and what to watch) and upgrade the rest. Record the ruling in the report.
- [ ] Step 3: Gate; commits.

---

## Owner actions (not agent tasks)

- Add the GitHub Actions secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `WRANGLER_TOML` (Task 3).
- Save the VAPID private key to 1Password.
- A real-phone recording pass: record, lock the screen mid-take, save offline, come back online.
- Delete the stale local branches if unwanted (`feat/stash-v2` is unmerged; the safety hook blocks `git branch -D` for agents).
- Optionally set a Cloudflare notification on Worker error rate (dashboard → Notifications).
