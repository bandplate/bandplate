// JSON Schema for the ingest contract's request bodies (`docs/ingest-contract-v1.md`,
// `./schemas.ts`), built by `zod-to-json-schema` — an established, Zod-3-compatible
// library — rather than by walking Zod's private `_def` shape by hand. That hand-walk
// used to live here and broke silently on a Zod internals change; the library's public
// contract is what does the walking now.
//
// The library's own output isn't byte-identical to what this file used to publish, so
// `normalize` below trims it down to match. `zod-json-schema.test.ts` pins the exact
// result against `__fixtures__/ingest-json-schema.snapshot.json` — the published
// contract, captured before this file changed — so a normalization step that drifts
// fails loudly instead of silently.
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema as convert } from "zod-to-json-schema";

// biome-ignore lint/suspicious/noExplicitAny: JSON Schema is inherently a loosely-typed recursive structure
export type JsonSchema = Record<string, any>;

function isPlainObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullType(value: unknown): boolean {
  return isPlainObject(value) && value.type === "null" && Object.keys(value).length === 1;
}

/**
 * Trims `zod-to-json-schema`'s output down to what this file has always published:
 *
 * - `default` is dropped. A field's optionality is already conveyed by its absence
 *   from `required`; the default VALUE was never part of the published schema.
 * - `additionalProperties: false` is dropped. This document has never claimed
 *   objects are closed to unknown properties.
 * - `exclusiveMinimum` folds into `minimum` at the same value. `.positive()` is
 *   technically "> 0", but the contract has always published ">= 0" here (the old
 *   hand-walker treated every Zod "min" check as inclusive); preserving that is this
 *   task's whole point, not a chance to silently tighten a published document.
 * - a bare `const` never carries a redundant `type` alongside it.
 * - `anyOf` becomes `oneOf` for an actual union (plain or discriminated) — this file
 *   has always published "exactly one of these shapes" as `oneOf`. An `anyOf` paired
 *   with a `{ type: "null" }` member is a nullable field, not a union, and stays
 *   `anyOf` untouched.
 */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalize);
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "default") {
      continue;
    }
    if (key === "additionalProperties" && value === false) {
      continue;
    }
    if (key === "type" && "const" in node) {
      continue;
    }
    if (key === "exclusiveMinimum" && typeof value === "number") {
      result.minimum = value;
      continue;
    }
    result[key] = normalize(value);
  }

  const anyOf = result.anyOf;
  if (Array.isArray(anyOf) && !anyOf.some(isNullType)) {
    result.oneOf = anyOf;
    delete result.anyOf;
  }

  return result;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const raw = convert(schema, { target: "jsonSchema7", $refStrategy: "none" }) as JsonSchema;
  const { $schema, ...rest } = raw;
  return normalize(rest) as JsonSchema;
}
