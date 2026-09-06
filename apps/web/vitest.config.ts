import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Both `*.route.test.ts` files run `pnpm run build` against this same
    // package's `dist/` before spawning `node dist/start.mjs` — with
    // Vitest's default file-level parallelism, two test files can start
    // that build concurrently and race on the same output directory (one
    // process's `astro build` output getting clobbered mid-write by the
    // other's). Forcing test FILES to run sequentially avoids that; it
    // does not serialize the individual `it`s within a file.
    fileParallelism: false,
  },
});
