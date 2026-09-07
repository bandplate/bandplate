// `setupFiles` entry for the `@cloudflare/vitest-pool-workers` pool only
// (wired in `vitest.workers.config.ts`, never in `vitest.config.ts`). Runs
// inside workerd before each test file's bodies — with `isolatedStorage`
// (the pool's default), every individual `it()` gets a fresh copy of the
// `DB` binding's storage, so migrations need to be (re-)applied here on
// every file rather than once per process. `applyD1Migrations` records
// what it has applied in a `d1_migrations` tracking table, so this is safe
// to call unconditionally.
import { applyD1Migrations, env } from "cloudflare:test";

// `TEST_MIGRATIONS` is a plain JSON binding (a `D1Migration[]`, read off
// disk in Node.js by `readD1Migrations` inside `vitest.workers.config.ts`
// and injected as Miniflare bindings data) — not something this file reads
// from the filesystem itself, since workerd has none.
declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
