import { describe, expect, it } from "vitest";
import {
  checkCronWiring,
  checkObservability,
  cronsOf,
  defaultExportObject,
} from "./cron-wiring.js";

// Trimmed from real `dist/server/entry.mjs` output (@astrojs/cloudflare
// 14.3.2, Rolldown): ours with `main = "./src/worker.ts"`, and the stock one
// the adapter falls back to when `main` is missing.
const OURS = `
//#region src/server/scheduled.ts
/**
* Called from \`worker.ts\`'s \`scheduled\` export, itself wrapped in
*/
async function runScheduledTick() {
	console.log(\`[scheduled] notification tick: sent=\${1}\`);
}
//#endregion
//#region src/worker.ts
var worker_entry_default = {
	fetch: handle,
	scheduled: (_controller, _env, ctx) => {
		ctx.waitUntil(runScheduledTick());
	}
};
//#endregion
export { worker_entry_default as default };
`;

const STOCK = `
//#region src/server/scheduled.ts
// even the stock build mentions "scheduled: " in a comment somewhere
//#endregion
var worker_entry_default = { fetch: handle };
//#endregion
export { worker_entry_default as default };
`;

const CRONS = ["*/10 * * * *"];

describe("cronsOf", () => {
  it("reads triggers.crons", () => {
    expect(cronsOf({ triggers: { crons: CRONS } })).toEqual(CRONS);
  });

  it("is empty when there are no triggers, or the value is not an object", () => {
    expect(cronsOf({})).toEqual([]);
    expect(cronsOf({ triggers: {} })).toEqual([]);
    expect(cronsOf(null)).toEqual([]);
    expect(cronsOf("nope")).toEqual([]);
  });
});

describe("defaultExportObject", () => {
  it("finds the object literal exported as default", () => {
    expect(defaultExportObject(OURS)).toContain("scheduled:");
    expect(defaultExportObject(STOCK)).toBe("{ fetch: handle }");
  });

  it("is undefined when there is no default export in that shape", () => {
    expect(defaultExportObject("export { a as b };")).toBeUndefined();
    expect(defaultExportObject("export { x as default };")).toBeUndefined();
  });
});

describe("checkCronWiring", () => {
  it("passes our entry with a cron declared", () => {
    expect(checkCronWiring({ crons: CRONS, entrySource: OURS })).toEqual({ ok: true });
  });

  it("fails the stock entry with a cron declared, and says how to fix it", () => {
    const result = checkCronWiring({ crons: CRONS, entrySource: STOCK });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("no `scheduled`");
      expect(result.reason).toContain('main = "./src/worker.ts"');
      expect(result.reason).toContain("*/10 * * * *");
    }
  });

  it("does not take a `scheduled` mention outside the default export as a handler", () => {
    // STOCK mentions "scheduled: " in a comment and nowhere in the export.
    expect(STOCK).toContain("scheduled: ");
    expect(checkCronWiring({ crons: CRONS, entrySource: STOCK }).ok).toBe(false);
  });

  it("accepts method syntax", () => {
    const src =
      "var w = {\n\tfetch: handle,\n\tasync scheduled(c, e, x) {}\n};\nexport { w as default };";
    expect(checkCronWiring({ crons: CRONS, entrySource: src })).toEqual({ ok: true });
  });

  it("does not care about the entry when no cron is declared", () => {
    expect(checkCronWiring({ crons: [], entrySource: STOCK })).toEqual({ ok: true });
    expect(checkCronWiring({ crons: [], entrySource: "" })).toEqual({ ok: true });
  });

  it("fails when the default export cannot be found at all", () => {
    const result = checkCronWiring({ crons: CRONS, entrySource: "export default handler;" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("could not be found");
    }
  });
});

describe("checkObservability", () => {
  it("passes when observability.enabled is true", () => {
    expect(checkObservability({ observability: { enabled: true } })).toEqual({ ok: true });
  });

  it("fails when observability is missing entirely", () => {
    const result = checkObservability({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("observability");
      expect(result.reason).toContain("[observability]");
    }
  });

  it("fails when observability.enabled is false", () => {
    const result = checkObservability({ observability: { enabled: false } });
    expect(result.ok).toBe(false);
  });

  it("fails when observability.enabled is missing or not a boolean true", () => {
    expect(checkObservability({ observability: {} }).ok).toBe(false);
    expect(checkObservability({ observability: { enabled: "true" } }).ok).toBe(false);
  });

  it("fails on a non-object wrangler.json", () => {
    expect(checkObservability(null).ok).toBe(false);
    expect(checkObservability("nope").ok).toBe(false);
  });
});
