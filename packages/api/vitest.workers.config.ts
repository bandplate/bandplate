// Runs this package's EXISTING `*.test.ts` files (the same files
// `vitest.config.ts`/the Node pool runs) inside workerd against a real D1
// binding, via `@cloudflare/vitest-plugin`. One parameterised
// harness, not a forked copy: every test file goes through
// `buildTestApp`/`resolveTestDb` in `test-helpers.ts`, which is the only
// place that knows which pool it's running under (see its doc comment).
//
// `readD1Migrations` runs here, in Node.js, at config-evaluation time — it
// can freely read `packages/db/migrations/sqlite` off disk. The parsed
// migrations are injected into the Worker as a plain JSON binding
// (`TEST_MIGRATIONS`) and applied inside workerd by
// `test/apply-migrations.ts` (a `setupFiles` entry, which resets and
// re-migrates before every test; see its own doc comment for why).
//
// Vitest 4 moved custom pools from `test.poolOptions` to a Vite plugin:
// `cloudflareTest(...)` takes what used to be `poolOptions.workers`. This
// is also why this package is pinned to vitest 4.1: see `vitest.config.ts`.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.resolve(import.meta.dirname, "../db/migrations/sqlite");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ["src/**/*.test.ts"],
      // `barrel-is-workers-safe.test.ts` is the one file that cannot run
      // here. It bundles the barrel with esbuild to prove the module graph
      // never reaches a `node:*` import — and esbuild is itself a Node
      // program (`node:os`, a child process), so loading it inside workerd
      // fails before it can bundle anything. Running it under Node is not a
      // weaker check: what it asserts about the graph is runtime-independent,
      // and the rest of this suite exercising the same code against real D1
      // is the empirical half.
      exclude: ["src/barrel-is-workers-safe.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
