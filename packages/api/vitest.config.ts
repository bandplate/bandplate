// This package stays on vitest 4.1 (`~4.1.11` in package.json) while the
// rest of the repo is on 5: the same `vitest` runs `test:workers`
// (`vitest.workers.config.ts`), and `@cloudflare/vitest-plugin` (1.2.1,
// the renamed `@cloudflare/vitest-pool-workers`) declares `vitest: ^4.1.0`
// and drives Vitest internals that carry no semver promise. Move this
// package to 5 when the plugin's peer range includes it.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
