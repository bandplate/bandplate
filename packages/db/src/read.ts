// Reads that are PLANNED before they run, so a page can send every read it
// can already name in one round trip.
//
// On Workers each D1 call is a network hop, and a page that awaits its reads
// one layer at a time pays one hop per layer however few rows come back. A
// `Read<T>` is the statements a repo function would have run plus the code
// that turns their rows into its answer. `runReads` sends the statements of
// any number of them as ONE `db.batch` and decodes each answer from its own
// slice of the results. The SQL stays in the repos (`build...Read`), and the
// page decides what goes out together.
//
// A batch is a single transaction on both drivers, so everything in it reads
// one consistent snapshot. That is only ever an improvement on separate
// reads, which could each see a different moment.
//
// D1 TRAP: in a batch, D1 hands rows back as objects keyed by column name
// and Drizzle turns them back into arrays by key. A statement whose result
// has two columns with the same name (`select takes.*, votes.*` both have a
// `created_at`) silently loses one, and only on D1. Keep batched statements
// to one table's columns (a join is fine when it selects one side), or alias.
// `createTestDb`'s client refuses such a batch so a test catches it here.
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./client.js";

export type BatchStatement = BatchItem<"sqlite">;

/** What one statement resolves to, the same as awaiting it directly. */
export type StatementResult<S extends BatchStatement> = S["_"]["result"];

export interface Read<T> {
  readonly statements: readonly BatchStatement[];
  /** Gets exactly one result per statement, in order. */
  readonly decode: (results: readonly unknown[]) => T;
}

/** A read of one statement. */
export function readOne<S extends BatchStatement, T>(
  statement: S,
  decode: (rows: StatementResult<S>) => T,
): Read<T> {
  return {
    statements: [statement],
    decode: (results) => decode(results[0] as StatementResult<S>),
  };
}

/**
 * A read of several statements of one shape: the chunks of a lookup kept
 * under D1's 100-parameter cap. `decode` gets their results in chunk order,
 * and gets an empty list when there were no chunks at all.
 */
export function readAll<S extends BatchStatement, T>(
  statements: readonly S[],
  decode: (results: StatementResult<S>[]) => T,
): Read<T> {
  return { statements, decode: (results) => decode(results as StatementResult<S>[]) };
}

/** An answer known without asking: an empty lookup, a branch not taken. */
export function readValue<T>(value: T): Read<T> {
  return { statements: [], decode: () => value };
}

export function mapRead<T, U>(read: Read<T>, map: (value: T) => U): Read<U> {
  return { statements: read.statements, decode: (results) => map(read.decode(results)) };
}

/** Several reads as one, answering as an object with the same keys. */
export function combineReads<R extends Record<string, Read<unknown>>>(
  reads: R,
): Read<ReadValues<R>> {
  const entries = Object.entries(reads);
  return {
    statements: entries.flatMap(([, read]) => read.statements),
    decode: (results) => {
      const values: Record<string, unknown> = {};
      let at = 0;
      for (const [key, read] of entries) {
        values[key] = read.decode(results.slice(at, at + read.statements.length));
        at += read.statements.length;
      }
      return values as ReadValues<R>;
    },
  };
}

export type ReadValues<R extends Record<string, Read<unknown>>> = {
  [K in keyof R]: R[K] extends Read<infer T> ? T : never;
};

/**
 * Runs one read in one round trip: nothing at all when it has no statements,
 * the statement itself when it has one, a batch otherwise.
 */
export async function runRead<T>(db: Db, read: Read<T>): Promise<T> {
  const { statements } = read;
  if (statements.length === 0) {
    return read.decode([]);
  }
  if (statements.length === 1) {
    return read.decode([await statements[0]]);
  }
  // `db.batch` wants a non-empty tuple, which a list built at run time cannot
  // be at the type level; the length check above is what guarantees it.
  const results = await db.batch(statements as unknown as Parameters<Db["batch"]>[0]);
  return read.decode(results as readonly unknown[]);
}

/** Runs every read given in ONE round trip, answering with the same keys. */
export function runReads<R extends Record<string, Read<unknown>>>(
  db: Db,
  reads: R,
): Promise<ReadValues<R>> {
  return runRead(db, combineReads(reads));
}
