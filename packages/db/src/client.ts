// Db handle typing — see the report for the full trade-off writeup.
//
// Repos are written against `Db`, a narrow interface rather than a union of
// `LibSQLDatabase<S> | DrizzleD1Database<S>`. A union was tried first: it
// type-checks for the simple cases (`db.select().from(...)`, `db.batch(...)`)
// but breaks down as soon as an *overloaded* method is called with an
// argument — `db.select({ col: table })` (partial/aliased select) and
// `.groupBy(...).having(...)` both fail to type-check on the union with
// "Expected 0 arguments, but got 1", because TypeScript does not merge
// overload sets across union members when resolving a call. Both patterns
// are needed by real repo methods (`songs.findByAlias`,
// `takes.listByInstruments`), so the union was not viable in practice.
//
// `Db` instead extends `BaseSQLiteDatabase<'async', unknown, Schema>` — the
// single concrete generic class both `LibSQLDatabase` and `DrizzleD1Database`
// derive from — and adds the one method the base class does not declare:
// `.batch()`, typed with the exact signature both drivers implement
// identically. Because this is a single concrete type (not a union),
// TypeScript resolves every overload normally, and both driver classes are
// structurally assignable to it with zero casts (verified for both during
// development, and again here — see `createD1Db` below).
//
// Increment 7: the D1 driver's *value* import (`drizzle-orm/d1`'s
// `drizzle()`) is now live, since `createD1Db` actually constructs one. The
// `D1Database` binding type itself, though, is still `import type` only —
// so no Cloudflare-specific ambient global type is required just from
// importing this module; a consumer that never calls `createD1Db` never
// sees a `D1Database`/`R2Bucket`/... global leak into their own
// type-checking. `DrizzleD1Database<Schema>` is structurally assignable to
// `Db` with zero casts, confirming the design note above.
import type { D1Database } from "@cloudflare/workers-types";
import type { Client } from "@libsql/client";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema/sqlite/index.js";

export { schema };

export type Schema = typeof schema;

/**
 * The db handle every repo function takes as its first argument. See the
 * module doc comment above for why this is a narrow interface rather than a
 * union of the two concrete driver types.
 */
export interface Db extends BaseSQLiteDatabase<"async", unknown, Schema> {
  batch<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(
    batch: T,
  ): Promise<BatchResponse<T>>;
}

/** Build a `Db` backed by a libSQL client (container profile, tests). */
export function createDb(client: Client): Db {
  return drizzle(client, { schema });
}

/**
 * Build a `Db` backed by a D1 binding (Workers profile, increment 7).
 * `DrizzleD1Database<Schema>` is structurally assignable to `Db` with zero
 * casts — the whole point of the narrow interface documented above. Not
 * one repo function changed to support this.
 */
export function createD1Db(d1: D1Database): Db {
  return drizzleD1(d1, { schema });
}
