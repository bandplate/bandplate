// The published contract (`GET /ingest/v1/openapi.json`, `docs/ingest-contract-v1.md`)
// promises a stable, machine-readable JSON Schema for every request body. This
// fixture is that promise, captured: the exact `JSON.stringify` byte output —
// key order included — for every schema `openapi.ts` actually calls
// `zodToJsonSchema` with. A future implementation swap (library, Zod version,
// refactor) must reproduce it exactly, or the contract has silently changed.
//
// Imported as a JSON module, not read with `node:fs`: this file also runs
// under the Workers pool (`vitest.workers.config.ts`), and workerd has no
// filesystem to read it from. A JSON import keeps key order, same as
// `JSON.parse`.
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/ingest-json-schema.snapshot.json";
import { commitTakeSchema, createEventSchema, createTakeSchema } from "./schemas.js";
import { zodToJsonSchema } from "./zod-json-schema.js";

describe("zodToJsonSchema", () => {
  it("reproduces the published JSON Schema for every schema openapi.ts converts, byte-identical", () => {
    const actual = {
      createEventSchema: zodToJsonSchema(createEventSchema),
      createTakeSchema: zodToJsonSchema(createTakeSchema),
      commitTakeSchema: zodToJsonSchema(commitTakeSchema),
    };
    // Compared as stringified JSON, not `toEqual`: `toEqual` ignores key
    // order, and the contract's promise is the exact published bytes.
    expect(JSON.stringify(actual, null, 2)).toBe(JSON.stringify(fixture, null, 2));
  });
});
