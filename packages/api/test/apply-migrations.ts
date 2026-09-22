// `setupFiles` entry for the `@cloudflare/vitest-plugin` pool only (wired
// in `vitest.workers.config.ts`, never in `vitest.config.ts`). Runs inside
// workerd before each test file.
//
// Every test here assumes a fresh, migrated `DB` per `it()`, which is what
// the old pool's `isolatedStorage` gave for free. The plugin dropped that
// (0.13.0) for per-FILE isolation, so this file restores the per-test
// guarantee itself: `reset()` wipes every binding's storage, then the
// migrations are applied again. Without it, a test that seeds a song
// collides with the song an earlier `it()` in the same file left behind.
import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

// `TEST_MIGRATIONS` is a plain JSON binding (a `D1Migration[]`, read off
// disk in Node.js by `readD1Migrations` inside `vitest.workers.config.ts`
// and injected as Miniflare bindings data), not something this file reads
// from the filesystem itself, since workerd has none.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: { name: string; queries: string[] }[];
    }
  }
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
