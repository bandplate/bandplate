// Runs this package's EXISTING `*.test.ts` files (the same files
// `vitest.config.ts`/the Node pool runs) inside workerd against a real D1
// binding, via `@cloudflare/vitest-pool-workers`. One parameterised
// harness, not a forked copy: every test file goes through
// `buildTestApp`/`resolveTestDb` in `test-helpers.ts`, which is the only
// place that knows which pool it's running under (see its doc comment).
//
// `readD1Migrations` runs here, in Node.js, at config-evaluation time — it
// can freely read `packages/db/migrations/sqlite` off disk. The parsed
// migrations are injected into the Worker as a plain JSON binding
// (`TEST_MIGRATIONS`) and applied inside workerd by
// `test/apply-migrations.ts` (a `setupFiles` entry — see its own doc
// comment for why every test file, not just once per process).
import path from "node:path";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrationsPath = path.resolve(__dirname, "../db/migrations/sqlite");
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.test.jsonc" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
