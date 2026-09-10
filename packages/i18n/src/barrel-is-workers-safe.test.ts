// Same technique every other package here uses: bundle the barrel for the
// browser and prove nothing Node-only came along. See
// `@bandplate/mail`'s copy for the original rationale.
//
// This package has no dependencies at all, so the interesting assertion is not
// really "no `node:*`" — it is the SIZE one below. `@bandplate/i18n` is the
// first `@bandplate/*` package an island will import, and the whole reason it
// exists rather than living in `packages/core` is to keep drizzle and zod out
// of the client graph. A byte budget is what stops that from quietly reverting
// the first time somebody imports a repo type "just for a type".
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

async function bundle(entry: string) {
  return build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    write: false,
    minify: true,
    platform: "browser",
    format: "esm",
    metafile: true,
    logLevel: "silent",
  });
}

describe("@bandplate/i18n is client-safe", () => {
  it("the barrel pulls in no node:* built-in and no other workspace package", async () => {
    const result = await bundle("./index.ts");

    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((f) => f.startsWith("node:"))).toBe(false);
    expect(inputs.filter((f) => f.includes("node_modules"))).toEqual([]);

    const output = result.outputFiles?.[0]?.text ?? "";
    expect(output).not.toMatch(/require\(["']node:/);
  });

  it("an island importing ONE area gets that area, not the whole catalog", async () => {
    const area = await bundle("./messages/voting.ts");
    const whole = await bundle("./index.ts");

    const areaBytes = area.outputFiles?.[0]?.text.length ?? 0;
    const wholeBytes = whole.outputFiles?.[0]?.text.length ?? 0;

    expect(areaBytes).toBeGreaterThan(0);
    // The point of splitting areas into their own modules. Today the catalog
    // is small enough that this is a modest gap; it widens with every area
    // added, and the assertion is here to notice if an area ever starts
    // reaching sideways into the composed catalog.
    expect(areaBytes).toBeLessThanOrEqual(wholeBytes);

    // A hard ceiling on what one area costs a page. Both languages of an area
    // ship, because the choice is made at runtime — see `messages/voting.ts`.
    // Against a 60KB gzipped island budget this leaves plenty of room, and it
    // fails loudly if an area ever becomes a dumping ground.
    expect(areaBytes).toBeLessThan(16_000);
  });
});
