// Proves — by actually bundling, not by inspecting our own source — that
// `@bandlib/db`'s main barrel (`index.ts`) never pulls a `node:*`
// built-in into a Workers-targeted bundle. Mirrors `@bandlib/mail`'s and
// `@bandlib/storage`'s identical tests for their own barrels — see either
// file's header comment for the technique and why the "sanity check"
// half matters (proving this technique actually detects a Node-only
// module when it IS reachable, not just that it's clean when it isn't).
//
// `@bandlib/db`'s whole increment-7 premise (`createD1Db` — see
// `client.ts`) rests on this package running unmodified on Workers; the
// closest thing it has to `@bandlib/mail`'s `smtp.ts`/`@bandlib/storage`'s
// `in-memory.ts` is `scripts/migrate.ts` — Node CLI tooling, not exported
// from the barrel, that does import `node:fs`/`node:path` directly.
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("@bandlib/db barrel is Workers-safe", () => {
  it("bundling the barrel for the browser platform pulls in no node:* built-in", async () => {
    const result = await build({
      entryPoints: [new URL("./index.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      metafile: true,
      logLevel: "silent",
    });

    const inputFiles = Object.keys(result.metafile.inputs);
    expect(inputFiles.some((f) => f.startsWith("node:"))).toBe(false);

    const outputText = result.outputFiles?.[0]?.text ?? "";
    expect(outputText).not.toMatch(/require\(["']node:/);
  });

  it("sanity check: bundling scripts/migrate.ts (not exported from the barrel) DOES pull in node:fs", async () => {
    const result = await build({
      entryPoints: [new URL("../scripts/migrate.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      metafile: true,
      logLevel: "silent",
      packages: "external",
    });

    // `node:*` built-ins are always external to esbuild (even without
    // `packages: "external"`) and never show up as resolved entries in
    // `metafile.inputs` — they pass straight through into the OUTPUT text
    // instead, which is what we actually care about detecting here.
    const outputText = result.outputFiles?.[0]?.text ?? "";
    expect(outputText).toMatch(/["']node:fs\/promises["']/);
  });
});
