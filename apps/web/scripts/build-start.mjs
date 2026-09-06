#!/usr/bin/env node
// Bundles the production start wrapper (`scripts/start.ts`) into
// `dist/start.mjs`, run as a step of `pnpm build` (see `package.json`).
//
// Why this exists (task-4-report.md "Fix round 2"): `scripts/start.ts`
// imports `../src/server/config.js`, TypeScript source. Round 1 ran it via
// `tsx scripts/start.ts`, which only works when both `tsx` (a
// devDependency) and `src/` are present — neither is true of a real
// production install (`pnpm install --prod`, or a Docker stage that
// copies `dist/` plus production `node_modules`). Bundling the wrapper —
// config validation, zod, all of it — into one dependency-free ESM file
// under `dist/` fixes that: the documented start command becomes `node
// dist/start.mjs`, self-contained except for the dynamic `import()` of
// `dist/server/entry.mjs` sitting right next to it (see `start.ts`'s own
// comment on why that one import is deliberately left unbundled).
import { build } from "esbuild";

await build({
  entryPoints: ["scripts/start.ts"],
  outfile: "dist/start.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
});
