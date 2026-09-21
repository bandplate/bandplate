// The D1 cascade rule, enforced in code, not just written down.
//
// On 2026-09-20 a Drizzle table-rebuild migration ran against the real D1
// database: create `__new_takes`, copy every row across, `DROP TABLE takes`,
// rename `__new_takes` back to `takes`. That is the correct, documented way
// to change a column SQLite can't alter in place (see
// `docs/frontend-traps.md`'s "A drizzle-kit table rebuild silently drops a
// hand-added index"), and it is also exactly the shape that destroyed
// ~2,000 rows: D1 CASCADEs a `DROP TABLE` into every child table that
// references it, even with `PRAGMA foreign_keys=OFF` set immediately before
// it. That pragma is a SQLite-only safety net, and D1 does not honor it for
// this. `0010_stash.sql` (already applied, already in `UNSAFE_BASELINE`
// below) carries this exact idiom; it is safe only because every child row
// it touched had already been accounted for by hand, which is not something
// a migration file can promise on its own.
//
// `findUnsafeStatements` flags any *new* migration that so much as touches
// this shape, so the choice to run one has to be a deliberate, reviewed
// decision — never an accidental `drizzle-kit generate` on a column change
// that happens to need a rebuild.
export interface UnsafeStatement {
  line: number;
  statement: string;
  reason: string;
}

const DROP_TABLE_REASON =
  "DROP TABLE: D1 cascades a DROP TABLE into every child table that references it, even with PRAGMA foreign_keys=OFF set. This is the exact statement that deleted ~2,000 rows on 2026-09-20.";

const RENAME_TO_REASON =
  "ALTER TABLE ... RENAME TO: part of Drizzle's table-rebuild idiom (create __new_x, copy rows, DROP TABLE, rename back). The DROP TABLE inside that idiom is what cascades on D1.";

const NEW_TABLE_REASON =
  "An identifier starting with __new_ marks Drizzle's rebuild-and-swap idiom. The migration this belongs to almost certainly drops the original table next, which D1 cascades into every child table.";

const PRAGMA_REASON =
  "PRAGMA foreign_keys: a SQLite-only safety net. It does not stop D1 from cascading a DROP TABLE into child tables, so it gives no protection here.";

interface UnsafePattern {
  regex: RegExp;
  reason: string;
}

const UNSAFE_PATTERNS: UnsafePattern[] = [
  { regex: /\bdrop\s+table\b/i, reason: DROP_TABLE_REASON },
  { regex: /\balter\s+table\b.*\brename\s+to\b/i, reason: RENAME_TO_REASON },
  { regex: /__new_/i, reason: NEW_TABLE_REASON },
  { regex: /\bpragma\s+foreign_keys\b/i, reason: PRAGMA_REASON },
];

// Strips a trailing `--` line comment (and Drizzle's own
// `--> statement-breakpoint` marker, which is one). Migration files in this
// repo don't use `--` inside string literals, so a simple "first -- wins"
// cut is enough — no need for a real SQL tokenizer here.
function stripLineComment(line: string): string {
  const index = line.indexOf("--");
  return index === -1 ? line : line.slice(0, index);
}

export function findUnsafeStatements(sql: string): UnsafeStatement[] {
  const findings: UnsafeStatement[] = [];
  const lines = sql.split("\n");

  lines.forEach((rawLine, index) => {
    const code = stripLineComment(rawLine);
    if (!code.trim()) {
      return;
    }
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.regex.test(code)) {
        findings.push({ line: index + 1, statement: code.trim(), reason: pattern.reason });
      }
    }
  });

  return findings;
}

// Migrations that were already applied before this guard existed. They are
// exempt from `findUnsafeStatements` even where they trip it (0010_stash.sql
// does, deliberately and safely — see the module doc comment above). Every
// migration added AFTER these has to pass the guard clean; nothing gets
// added to this list going forward.
export const UNSAFE_BASELINE: readonly string[] = [
  "0000_careless_prima.sql",
  "0001_optimal_johnny_storm.sql",
  "0002_careful_carlie_cooper.sql",
  "0003_add_instrument_icon.sql",
  "0004_add_event_archived_at.sql",
  "0005_add_member_locale.sql",
  "0006_add_instrument_color.sql",
  "0007_add_instrument_is_stub.sql",
  "0008_add_instrument_aliases.sql",
  "0009_push_notifications.sql",
  "0010_stash.sql",
  "0011_add_member_home_visit.sql",
];

// Parses the output of `wrangler d1 migrations list DB --remote` (wrangler
// 4's `logger.table`: a box-drawn table with a single "Name" column, one
// migration file name per row) into a plain list of pending migration file
// names, in the order wrangler printed them. Returns `[]` when wrangler
// reports nothing pending ("✅ No migrations to apply!").
//
// Kept separate from the process-spawning script so it can be unit-tested
// against a captured sample without ever invoking wrangler.
export function parsePendingMigrations(listOutput: string): string[] {
  if (/no migrations to apply/i.test(listOutput)) {
    return [];
  }

  const names: string[] = [];
  for (const rawLine of listOutput.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("│")) {
      continue;
    }
    const cell = line.replace(/^│/, "").replace(/│.*$/, "").trim();
    if (!cell || cell === "Name") {
      continue;
    }
    names.push(cell);
  }
  return names;
}
