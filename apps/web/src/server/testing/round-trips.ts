// Counts database ROUND TRIPS while a loader runs, for the tests that pin how
// many a page costs.
//
// On Workers every D1 call is a network hop, and a page's wall time is mostly
// the number of hops it waits on in sequence, not how many rows come back.
// So this counts what crosses the wire, not what SQL runs: one
// `client.execute` is one trip, and one `client.batch` is one trip however
// many statements it carries (that is the whole point of `runReads`).
//
// `depth` is the longest chain of trips that each had to wait for an earlier
// one to come back. Trips issued together (a `Promise.all`) share a level;
// a trip issued after another has completed sits one level deeper. It is what
// the member actually waits for, give or take the CPU between the hops.
//
// Test support only: wraps a libSQL `Db` from `createTestDb`, the same way
// `take-context.test.ts` reaches the client under Drizzle.
import type { Db } from "@bandplate/db";

export interface Trip {
  kind: "execute" | "batch";
  statements: number;
  level: number;
  /** The most bound parameters any one statement in it carried. D1 refuses more than 100. */
  maxParams: number;
}

export interface RoundTrips {
  trips: Trip[];
  /** Every trip, execute and batch alike. */
  total: number;
  /** The longest chain of trips that waited on each other. */
  depth: number;
  /** The most bound parameters any single statement carried. */
  maxParams: number;
}

type Method = (...args: unknown[]) => Promise<unknown>;
type Statement = { args?: unknown[] } | string;

const paramsOf = (statement: Statement) =>
  typeof statement === "string" ? 0 : (statement.args?.length ?? 0);

export async function countRoundTrips<T>(
  db: Db,
  run: () => Promise<T>,
): Promise<{ result: T; roundTrips: RoundTrips }> {
  const client = (db as unknown as { $client: Record<string, Method> }).$client;
  const original = { execute: client.execute, batch: client.batch };
  const trips: Trip[] = [];
  // The deepest level of any trip that has already come back. A trip issued
  // now could have depended on it, so it sits one level deeper.
  let settledLevel = 0;

  const wrap = (kind: Trip["kind"], method: Method | undefined): Method =>
    function (this: unknown, ...args: unknown[]) {
      const sent = kind === "batch" ? (args[0] as Statement[]) : [args[0] as Statement];
      const trip: Trip = {
        kind,
        statements: sent.length,
        level: settledLevel + 1,
        maxParams: Math.max(0, ...sent.map(paramsOf)),
      };
      trips.push(trip);
      const settle = () => {
        settledLevel = Math.max(settledLevel, trip.level);
      };
      const pending = (method as Method).apply(this, args);
      pending.then(settle, settle);
      return pending;
    };

  client.execute = wrap("execute", original.execute);
  client.batch = wrap("batch", original.batch);
  try {
    const result = await run();
    return {
      result,
      roundTrips: {
        trips,
        total: trips.length,
        depth: trips.reduce((deepest, trip) => Math.max(deepest, trip.level), 0),
        maxParams: trips.reduce((most, trip) => Math.max(most, trip.maxParams), 0),
      },
    };
  } finally {
    client.execute = original.execute as Method;
    client.batch = original.batch as Method;
  }
}
