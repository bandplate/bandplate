// `GET /ingest/v1/openapi.json` — contract v1's header promise: "The
// server publishes a machine-readable OpenAPI 3.1 document ..., generated
// from the same Zod schemas that validate requests, so a typed client can
// be generated rather than hand-written."
//
// Request-body schemas below are produced by walking the EXACT same Zod
// objects `./events.ts`/`./takes.ts` call `.safeParse` against
// (`./schemas.ts`) — not a hand-maintained parallel copy. Response shapes
// are plain JSON Schema (this codebase validates requests, not its own
// outputs, so there is no second Zod schema for them to drift out of sync
// with).
//
// `security` per operation is derived from the SAME `GuardedRouter`
// declarations that actually enforce it (`router.registry`, filtered to
// `/ingest/v1/*`) rather than a hand-written copy — so a route whose scope
// requirement changes in `takes.ts`/`events.ts`/etc. can never leave this
// document silently wrong about what it takes to call it.
import type { GuardedRouter } from "../../route-registry.js";
import { commitTakeSchema, createEventSchema, createTakeSchema } from "./schemas.js";
import { type JsonSchema, zodToJsonSchema } from "./zod-json-schema.js";

const errorSchema: JsonSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
    },
  },
  required: ["error"],
};

const uploadItemSchema: JsonSchema = {
  type: "object",
  description:
    "A ready asset omits tier/storageKey/method/url/headers/expiresAt entirely — see contract v1 §4.",
  properties: {
    assetId: { type: "string" },
    kind: { type: "string", enum: ["master", "stem", "peaks"] },
    instrument: { anyOf: [{ type: "string" }, { type: "null" }] },
    tier: { type: "string", enum: ["lossy", "lossless"] },
    storageKey: { type: "string" },
    status: { type: "string", enum: ["pending", "ready"] },
    method: { type: "string", enum: ["PUT"] },
    url: { type: "string", format: "uri" },
    headers: { type: "object", additionalProperties: { type: "string" } },
    expiresAt: { type: "string", format: "date-time" },
  },
  required: ["assetId", "kind", "instrument", "status"],
};

/** Path template as declared on `GuardedRouter` (`:id` style) -> OpenAPI style (`{id}`). */
function toOpenApiPath(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function pathParameters(honoPath: string): JsonSchema[] {
  const names = [...honoPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

interface OperationSpec {
  method: "get" | "post" | "delete";
  path: string;
  summary: string;
  requestBody?: JsonSchema;
  responses: Record<string, { description: string; schema?: JsonSchema }>;
}

function buildOperationSpecs(): OperationSpec[] {
  const eventResponse: JsonSchema = {
    type: "object",
    properties: { eventId: { type: "string" }, created: { type: "boolean" } },
    required: ["eventId", "created"],
  };

  const takeResponse: JsonSchema = {
    type: "object",
    properties: {
      takeId: { type: "string" },
      songId: { type: "string" },
      songCreated: { type: "boolean" },
      songMatch: {
        type: "string",
        enum: ["external-ref", "title", "alias", "created-stub", "existing"],
      },
      state: { type: "string", enum: ["uploading", "new", "published"] },
      uploads: { type: "array", items: uploadItemSchema },
    },
    required: ["takeId", "songId", "songCreated", "songMatch", "state", "uploads"],
  };

  const commitResponse: JsonSchema = {
    type: "object",
    properties: {
      takeId: { type: "string" },
      state: { type: "string", enum: ["new", "published"] },
      assets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            assetId: { type: "string" },
            status: { type: "string" },
            bytes: { type: "integer" },
          },
        },
      },
    },
  };

  return [
    {
      method: "post",
      path: "/ingest/v1/events",
      summary: "Declare a rehearsal/concert/session event (idempotent on clientRef).",
      requestBody: zodToJsonSchema(createEventSchema),
      responses: { "200": { description: "Event resolved.", schema: eventResponse } },
    },
    {
      method: "post",
      path: "/ingest/v1/takes",
      summary: "Declare a take and its assets; receive presigned upload URLs.",
      requestBody: zodToJsonSchema(createTakeSchema),
      responses: {
        "200": { description: "Take resolved.", schema: takeResponse },
        "409": { description: "song_not_found or assets_incomplete.", schema: errorSchema },
        "422": {
          description: "unknown_instrument or validation_failed.",
          schema: errorSchema,
        },
      },
    },
    {
      method: "get",
      path: "/ingest/v1/takes/:takeId/uploads",
      summary: "Fresh presigned URLs for a take's still-pending assets.",
      responses: {
        "200": {
          description: "Current upload status.",
          schema: {
            type: "object",
            properties: {
              takeId: { type: "string" },
              uploads: { type: "array", items: uploadItemSchema },
            },
          },
        },
        "404": { description: "Take not found.", schema: errorSchema },
      },
    },
    {
      method: "post",
      path: "/ingest/v1/takes/:takeId/commit",
      summary: "Verify uploaded assets and publish (or file as new) the take.",
      requestBody: zodToJsonSchema(commitTakeSchema),
      responses: {
        "200": { description: "Committed.", schema: commitResponse },
        "409": { description: "assets_incomplete.", schema: errorSchema },
        "404": { description: "Take not found.", schema: errorSchema },
      },
    },
    {
      method: "delete",
      path: "/ingest/v1/takes/:takeId",
      summary: "Undo a mistaken push. Only while state is uploading or new.",
      responses: {
        "200": { description: "Deleted.", schema: { type: "object" } },
        "404": { description: "Take not found.", schema: errorSchema },
        "409": { description: "take_not_deletable.", schema: errorSchema },
      },
    },
    {
      method: "get",
      path: "/ingest/v1/instruments",
      summary: "The live instrument-slug vocabulary.",
      responses: {
        "200": {
          description: "Instruments.",
          schema: {
            type: "object",
            properties: {
              instruments: {
                type: "array",
                items: {
                  type: "object",
                  properties: { slug: { type: "string" }, label: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  ];
}

export function buildIngestOpenApiDocument(router: GuardedRouter): JsonSchema {
  const specs = buildOperationSpecs();
  const paths: JsonSchema = {};

  for (const spec of specs) {
    // Security requirement derived from the live GuardedRouter
    // declaration for this exact method+path, not hand-copied — see this
    // file's header comment.
    const declared = router.registry.find(
      (r) => r.method === spec.method.toUpperCase() && r.path === spec.path,
    );
    const scopes =
      declared && "scopes" in declared.guard ? [...declared.guard.scopes] : ["ingest:write"];

    const openApiPath = toOpenApiPath(spec.path);
    paths[openApiPath] ??= {};
    paths[openApiPath][spec.method] = {
      summary: spec.summary,
      operationId: `${spec.method}${openApiPath.replace(/[/{}]/g, "_")}`,
      parameters: pathParameters(spec.path),
      ...(spec.requestBody
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: spec.requestBody } },
            },
          }
        : {}),
      responses: Object.fromEntries(
        Object.entries(spec.responses).map(([status, r]) => [
          status,
          {
            description: r.description,
            ...(r.schema ? { content: { "application/json": { schema: r.schema } } } : {}),
          },
        ]),
      ),
      security: [{ serviceToken: scopes }],
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "bandlib ingest API",
      version: "1.0.0",
      description:
        "Contract v1 — see docs/ingest-contract-v1.md in the bandlib repo. The interface the Reaper bridge uses to push rendered rehearsal takes into the archive.",
    },
    servers: [{ url: "/api" }],
    paths,
    components: {
      securitySchemes: {
        serviceToken: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "blk_{tokenId}_{secret}",
          description:
            "A service token issued from /admin/tokens, carrying an explicit scope set. " +
            "401 for a missing/malformed/unknown/revoked token; 403 for a valid token missing a required scope.",
        },
      },
    },
  };
}
