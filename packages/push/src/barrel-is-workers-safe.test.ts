// Proves — by actually bundling, not by inspecting our own source — that
// `@bandplate/push`'s barrel (`index.ts`) never pulls a `node:*` built-in
// into a Workers-targeted bundle. esbuild with `platform: "browser"` refuses
// to resolve bare `node:*` specifiers, so if the barrel's module graph
// reached one, this build would fail.
//
// Unlike `@bandplate/mail` (which carves `smtp.ts` out of its barrel
// specifically because nodemailer needs Node), nothing in this package
// touches a Node built-in: `vapid.ts` uses only `crypto.subtle`/`btoa`,
// `web-push.ts` and `recording.ts` are pure, and `@block65/webcrypto-web-push`
// itself was verified delivering a push to a real Android device from
// workerd. So there is no
// Node-only sibling module here to run mail's second "sanity check" test
// against — this package's whole barrel is workers-safe by construction,
// not by exclusion.
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("@bandplate/push barrel is Workers-safe", () => {
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
    expect(outputText).not.toMatch(/require\(['"]node:/);
  });
});
