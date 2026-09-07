// Proves — by actually bundling, not by inspecting our own source — that
// `@bandlib/storage`'s main barrel (`index.ts`) never pulls `node:http` (or
// any other `node:*` built-in) into a Workers-targeted bundle. Mirrors
// `@bandlib/mail`'s identical test for its own SMTP/nodemailer split — see
// that file's header comment for the technique and why the "sanity check"
// half matters (proving this technique actually detects the Node-only
// module when it IS reachable, not just that it's clean when it isn't).
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("@bandlib/storage barrel is Workers-safe", () => {
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
    expect(inputFiles.some((f) => f.includes("in-memory.ts"))).toBe(false);

    const outputText = result.outputFiles?.[0]?.text ?? "";
    expect(outputText).not.toMatch(/require\(["']node:/);
  });

  it("sanity check: bundling in-memory.ts (not exported from the barrel) DOES pull in node:http", async () => {
    const result = await build({
      entryPoints: [new URL("./in-memory.ts", import.meta.url).pathname],
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
    expect(outputText).toMatch(/["']node:http["']/);
  });
});
