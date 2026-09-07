// Proves — by actually bundling, not by inspecting our own source — that
// `@bandplate/api`'s barrel (`index.ts`) never pulls a `node:*` built-in
// into a Workers-targeted bundle. Mirrors `@bandplate/mail`'s and
// `@bandplate/storage`'s identical tests for their own barrels — see either
// file's header comment for the technique. This is the actual Hono app
// wired into `apps/web`'s Workers composition root
// (`server/app.workers.ts`), so it's exactly the module graph a Workers
// deploy's `_worker.js` bundle depends on.
//
// Like `@bandplate/core`, `@bandplate/api` has no existing Node-only sibling
// module to use as this technique's "sanity check" half (grep confirms
// no file under `packages/api/src` imports a `node:*` built-in — its
// devDependencies on `@bandplate/mail`/`@bandplate/storage` are test-only,
// via `test-helpers.ts`, never reachable from the barrel). So the sanity
// check bundles a synthetic one-line fixture instead, proving the
// detection technique itself catches a `node:*` import when present.
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("@bandplate/api barrel is Workers-safe", () => {
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

  it("sanity check: this technique DOES detect a node:* import when one is present", async () => {
    const result = await build({
      stdin: {
        contents: 'import { randomUUID } from "node:crypto";\nexport { randomUUID };\n',
        loader: "ts",
        resolveDir: new URL(".", import.meta.url).pathname,
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      metafile: true,
      logLevel: "silent",
      packages: "external",
    });

    const outputText = result.outputFiles?.[0]?.text ?? "";
    expect(outputText).toMatch(/["']node:crypto["']/);
  });
});
