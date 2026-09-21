// Pure decisions for the deploy gate — `pnpm ship` (deploy.ts) locally, and
// CI's `deploy` job. Kept separate from anything that spawns `git` or
// `wrangler` so they're node-testable against captured sample output,
// exactly like `@bandplate/db/migration-guard`'s `parsePendingMigrations`.

// `git status --porcelain` prints one line per dirty/untracked path and
// nothing at all when the tree is clean.
export function isTreeClean(porcelainOutput: string): boolean {
  return porcelainOutput.trim().length === 0;
}

// `git rev-parse HEAD` and `git rev-parse origin/main` each print one sha
// (plus a trailing newline). HEAD counts as pushed only when both resolved
// to something and they're the same commit.
export function isHeadPushed(headShaOutput: string, originMainShaOutput: string): boolean {
  const head = headShaOutput.trim();
  const origin = originMainShaOutput.trim();
  return head.length > 0 && head === origin;
}

// Given the pending migration file names (from
// `@bandplate/db/migration-guard`'s `parsePendingMigrations` — never
// re-parse `wrangler d1 migrations list` output a second way), decide
// whether the deploy gate should stop. Returns the message to print and
// exit on, or null when there's nothing pending.
export function pendingMigrationsGuardMessage(pending: readonly string[]): string | null {
  if (pending.length === 0) {
    return null;
  }
  return `${pending.length} pending remote migration(s): ${pending.join(", ")} — run pnpm migrate:remote first.`;
}
