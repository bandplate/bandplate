// A small, deliberately narrow Zod -> JSON Schema converter — just enough
// to walk the shapes actually used by `./schemas.ts` (object/string/
// number/boolean/enum/literal/array/optional/nullable/default/
// discriminated-union). Not a general-purpose library: adding a
// dependency (`zod-to-openapi` or similar) for this one document felt like
// more supply-chain surface than the contract's promise actually needs —
// "generated from the same Zod schemas that validate requests" is
// satisfied by walking the real `ZodType` objects, whatever the walker's
// own size. Falls back to `{}` (accept-anything) for any construct this
// file doesn't recognize, rather than throwing — a slightly-loose OpenAPI
// document beats a 500 on `/openapi.json`.
import type { ZodTypeAny } from "zod";

// biome-ignore lint/suspicious/noExplicitAny: JSON Schema is inherently a loosely-typed recursive structure
export type JsonSchema = Record<string, any>;

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; nullable: boolean } {
  let inner = schema;
  let optional = false;
  let nullable = false;
  // biome-ignore lint/suspicious/noExplicitAny: walking Zod's internal `_def` shape
  let def = (inner as any)._def;
  while (
    def.typeName === "ZodOptional" ||
    def.typeName === "ZodNullable" ||
    def.typeName === "ZodDefault"
  ) {
    if (def.typeName === "ZodOptional") {
      optional = true;
      inner = def.innerType;
    } else if (def.typeName === "ZodNullable") {
      nullable = true;
      inner = def.innerType;
    } else {
      // ZodDefault: still "optional" from a caller's perspective (has a default).
      optional = true;
      inner = def.innerType;
    }
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    def = (inner as any)._def;
  }
  return { inner, optional, nullable };
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const { inner, nullable } = unwrap(schema);
  // biome-ignore lint/suspicious/noExplicitAny: walking Zod's internal `_def` shape
  const def = (inner as any)._def;
  const base = zodInnerToJsonSchema(inner, def);
  if (nullable) {
    return { anyOf: [base, { type: "null" }] };
  }
  return base;
}

// biome-ignore lint/suspicious/noExplicitAny: `_def`'s shape is Zod-internal and varies by typeName
function zodInnerToJsonSchema(inner: ZodTypeAny, def: any): JsonSchema {
  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape();
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        // biome-ignore lint/suspicious/noExplicitAny: shape values are ZodTypeAny at runtime
        const propSchema = value as any;
        const { optional } = unwrap(propSchema);
        properties[key] = zodToJsonSchema(propSchema);
        if (!optional) {
          required.push(key);
        }
      }
      const result: JsonSchema = { type: "object", properties };
      if (required.length > 0) {
        result.required = required;
      }
      return result;
    }
    case "ZodString": {
      const result: JsonSchema = { type: "string" };
      for (const check of def.checks ?? []) {
        if (check.kind === "min") {
          result.minLength = check.value;
        } else if (check.kind === "max") {
          result.maxLength = check.value;
        } else if (check.kind === "email") {
          result.format = "email";
        } else if (check.kind === "datetime") {
          result.format = "date-time";
          result.description = "ISO-8601 timestamp with a UTC offset";
        } else if (check.kind === "regex") {
          result.pattern = check.regex.source;
        }
      }
      return result;
    }
    case "ZodNumber": {
      const result: JsonSchema = { type: "number" };
      for (const check of def.checks ?? []) {
        if (check.kind === "int") {
          result.type = "integer";
        } else if (check.kind === "min") {
          result.minimum = check.value;
        } else if (check.kind === "max") {
          result.maximum = check.value;
        }
      }
      return result;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodEnum":
      return { type: "string", enum: [...def.values] };
    case "ZodArray": {
      const result: JsonSchema = { type: "array", items: zodToJsonSchema(def.type) };
      if (def.minLength) {
        result.minItems = def.minLength.value;
      }
      return result;
    }
    case "ZodDiscriminatedUnion": {
      return { oneOf: [...def.options.values()].map((opt) => zodToJsonSchema(opt as ZodTypeAny)) };
    }
    case "ZodUnion":
      return { oneOf: def.options.map((opt: ZodTypeAny) => zodToJsonSchema(opt)) };
    default:
      return {};
  }
}
