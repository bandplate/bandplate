// Proves — by actually bundling, not by inspecting our own source — that
// `@bandlib/mail`'s barrel (`index.ts`) never pulls nodemailer or any
// `node:*` built-in into a Workers-targeted bundle. esbuild with
// `platform: "browser"` refuses to resolve bare `node:*` specifiers, so if
// the barrel's module graph reached one, this build would fail; instead we
// assert on the bundle's metafile that nodemailer plainly isn't in the
// graph. The `smtp.ts` case is a sanity check that this technique actually
// detects nodemailer when it IS present — otherwise a barrel-side pass here
// would be meaningless.
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("@bandlib/mail barrel is Workers-safe", () => {
  it("bundling the barrel for the browser platform pulls in no nodemailer and no node:* built-in", async () => {
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
    expect(inputFiles.some((f) => f.includes("nodemailer"))).toBe(false);
    expect(inputFiles.some((f) => f.startsWith("node:"))).toBe(false);

    const outputText = result.outputFiles?.[0]?.text ?? "";
    expect(outputText).not.toMatch(/nodemailer/i);
  });

  it("sanity check: bundling smtp.ts (not exported from the barrel) DOES pull in nodemailer", async () => {
    const result = await build({
      entryPoints: [new URL("./smtp.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      metafile: true,
      logLevel: "silent",
      packages: "external",
    });

    // `packages: "external"` keeps nodemailer as an unbundled `import`
    // rather than inlining its source — either way, its specifier appears
    // in the graph, which is the point: this technique does detect it.
    const outputText = result.outputFiles?.[0]?.text ?? "";
    expect(outputText).toMatch(/nodemailer/i);
  });
});
