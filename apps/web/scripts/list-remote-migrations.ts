// `wrangler d1 migrations list DB --remote`, run the one way both callers
// need it: output passed through as it arrives, and a failure tried again
// only when `retryMigrationsList` says it is Cloudflare's passing 7403 (see
// that function for why). Shared by `check-remote-migrations.ts` (`pnpm ship`
// and CI) and `migrate-remote.ts`, so the retry rule lives in one place.
//
// Read-only on purpose: nothing that writes (`export`, `apply`) goes through
// here, so a retry can never run a write twice.
import { spawnSync } from "node:child_process";
import { retryMigrationsList } from "@bandplate/db/migration-guard";

export function listRemoteMigrations(): { status: number | null; stdout: string } {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync(
      "pnpm",
      ["exec", "wrangler", "d1", "migrations", "list", "DB", "--remote"],
      { encoding: "utf8" },
    );
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    if (stdout) {
      process.stdout.write(stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
    if (result.status === 0) {
      return { status: 0, stdout };
    }
    const next = retryMigrationsList(`${stdout}\n${stderr}`, attempt);
    if (!next.retry) {
      return { status: result.status, stdout };
    }
    console.error(
      `migrations list: Cloudflare answered 7403, a known passing error; trying again in ${next.delayMs / 1000}s.`,
    );
    // A synchronous wait: both callers are straight-line scripts built on
    // spawnSync, and a sleep here keeps them that way.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, next.delayMs);
  }
}
