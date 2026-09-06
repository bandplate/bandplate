// Resolves the libSQL/SQLite connection URL from environment variables.
// Node-free (no `node:*` imports) so it can live in `src/` alongside the
// rest of the runtime-agnostic package — see the header comment on
// `index.ts`. The Node-only tooling that actually READS `process.env`
// (`packages/db/scripts/migrate.ts`, `packages/db/seed/run.ts`) imports
// this and passes `process.env` in; this module itself never touches it.
//
// Before this existed, `scripts/migrate.ts` and `seed/run.ts` each
// resolved the URL independently and had drifted: migrate required
// `BANDLIB_DATABASE_URL`/`DATABASE_URL` and threw on neither, while the
// seed silently fell back to a local file path and reported success —
// so a misconfigured environment made the seed "work" against a database
// nothing else opens, while migrate correctly failed. See
// task-5-report.md "Fix round 3" #2.
export interface DatabaseUrlEnv {
  BANDLIB_DATABASE_URL?: string | undefined;
  DATABASE_URL?: string | undefined;
}

/**
 * `BANDLIB_DATABASE_URL` is the name `apps/web` itself requires; the bare
 * `DATABASE_URL` is accepted as a fallback for tooling that doesn't know
 * the app's prefixed name. An empty string counts as unset for either
 * variable (never a valid database URL, and easy to end up with from an
 * env file that sets the key with no value) — so falls through to
 * `DATABASE_URL`, and to the loud failure below, the same as if the key
 * were absent entirely. Throws when neither resolves to a non-empty value
 * — deliberately: a script that silently defaults to some local file and
 * reports success is the exact bug this closes. `action` customizes the
 * error message for the caller's context (e.g. "running migrations",
 * "running the seed").
 */
export function resolveDatabaseUrl(
  env: DatabaseUrlEnv,
  action = "connecting to the database",
): string {
  const url = env.BANDLIB_DATABASE_URL || env.DATABASE_URL;
  if (!url) {
    throw new Error(`Set BANDLIB_DATABASE_URL (or DATABASE_URL) before ${action}.`);
  }
  return url;
}
