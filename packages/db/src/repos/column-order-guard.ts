// Guards the `db.insert(table).select(sql\`select v1, v2, ... where ...\`)`
// pattern used by `membersRepo.buildCreateIfEmptyStatement` and
// `authSessionsRepo.buildCreateIfMemberExistsStatement` — see either
// function's doc comment for why raw `sql\`select ...\`` is used at all
// (a D1-vs-libSQL `db.batch([...])` incompatibility, not stylistic
// preference).
//
// The column list on the SQL side is written out positionally, by hand,
// in the same order Drizzle emits an `INSERT`'s target columns for that
// table (schema declaration order — see `packages/db/src/schema/sqlite/
// index.ts`). That correspondence is real but entirely implicit: nothing
// ties the raw SQL's value list to the table's actual column count, so
// adding, removing, or reordering a column on either table silently
// misaligns the two — the insert either binds a value to the wrong
// column or fails at query time with an arity mismatch, on the very
// first `bootstrapAdmin` call any fresh deploy makes. `assertColumnCount`
// makes that coupling loud instead: called with the *number* of values
// the raw SQL supplies, it throws immediately (not "eventually, in
// production") if the table's actual column count has drifted from what
// the call site was written against.
import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

export function assertColumnCount(table: SQLiteTable, expected: number): void {
  const actual = Object.keys(getTableColumns(table)).length;
  if (actual !== expected) {
    throw new Error(
      `column-order-guard: "${getTableName(table)}" has ${actual} columns but this call site's raw SQL supplies ${expected} values — the positional \`insert(...).select(sql\`...\`)\` column list is now misaligned with the schema. Update the raw SQL (and this assertion) to match.`,
    );
  }
}
