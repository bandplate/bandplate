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
// development). The D1 driver is referenced with `import type` only, so no
// Cloudflare-specific runtime dependency or ambient global type is required
// at this stage — `drizzle-orm/d1`'s types don't pull in `@cloudflare/workers-types`
// unless the `drizzle()` factory or `D1Database` type itself is referenced,
// neither of which we do here. Increment 7 can construct a
// `DrizzleD1Database<Schema>` and pass it anywhere a `Db` is expected without
// touching a single repo function.
import type { Client } from "@libsql/client";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
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
