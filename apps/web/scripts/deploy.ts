#!/usr/bin/env -S node
// `pnpm ship` (root) — the only sanctioned way to deploy bandplate to
// production from a laptop. Named `ship`, not `deploy`, because `pnpm
// deploy` is a built-in pnpm command (workspace publish/deploy) and a root
// script literally named `deploy` gets shadowed by it rather than running
// this file.
//
// Mirrors `migrate-remote.ts`'s style: `tsx`, `spawnSync`, every exit code
// checked, nothing swallowed. In order:
//
//   1. Refuse if the working tree is dirty (`git status --porcelain`).
//   2. Refuse if HEAD isn't pushed to `origin/main` (`git fetch origin
//      main` first, so a stale local ref can never let this pass, then
//      `git rev-parse`).
//   3. Refuse if there are pending remote migrations — CI runs the exact
//      same check (`check-remote-migrations.ts`), so there's one place
//      this decision is made, not two.
//   4. `BANDPLATE_ADAPTER=cloudflare pnpm exec astro build`.
//   5. `pnpm exec wrangler deploy`.
//
// Never run automatically, never run by an agent — a human runs
// `pnpm ship` from a clean, pushed checkout.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkRemoteMigrations } from "./check-remote-migrations.js";
import { isHeadPushed, isTreeClean } from "./deploy-guard.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));

const HELP = process.argv.includes("--help") || process.argv.includes("-h");

const HELP_TEXT = `Usage: pnpm ship

Deploys bandplate to production. In order:

  1. Refuse if the working tree is dirty.
  2. Refuse if HEAD is not pushed to origin/main (fetches origin/main
     first, so a stale local ref can't let this pass).
  3. Refuse if any remote migration is pending — run \`pnpm migrate:remote\`
     first (this script never applies migrations itself).
  4. Build (BANDPLATE_ADAPTER=cloudflare astro build).
  5. Deploy (wrangler deploy).

  --help, -h  Print this message and exit 0.
`;

function fail(message: string): never {
  console.error(`ship: ${message}`);
  process.exit(1);
}

function runGit(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "" };
}

function runInherit(command: string, args: string[], env?: NodeJS.ProcessEnv): number {
  const result = spawnSync(command, args, {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: env ?? process.env,
  });
  return result.status ?? 1;
}

function main(): void {
  if (HELP) {
    console.log(HELP_TEXT);
    return;
  }

  // (1) Clean tree.
  const statusResult = runGit(["status", "--porcelain"]);
  if (statusResult.status !== 0) {
    fail("`git status --porcelain` failed — see output above.");
  }
  if (!isTreeClean(statusResult.stdout)) {
    fail("working tree is dirty — commit or stash before deploying.");
  }
  console.log("ship: working tree is clean.");

  // (2) HEAD pushed to origin/main. Fetch first — comparing against a
  // stale local origin/main ref could let this gate pass on a HEAD that
  // isn't actually on the remote, which is the wrong direction to be
  // wrong in for a safety gate.
  const fetchResult = runGit(["fetch", "origin", "main", "--quiet"]);
  if (fetchResult.status !== 0) {
    fail(
      "`git fetch origin main` failed — see output above. Refusing to deploy against a stale origin/main.",
    );
  }
  const headResult = runGit(["rev-parse", "HEAD"]);
  if (headResult.status !== 0) {
    fail("`git rev-parse HEAD` failed — see output above.");
  }
  const originResult = runGit(["rev-parse", "origin/main"]);
  if (originResult.status !== 0) {
    fail("`git rev-parse origin/main` failed — see output above.");
  }
  if (!isHeadPushed(headResult.stdout, originResult.stdout)) {
    fail("HEAD is not pushed to origin/main — push before deploying.");
  }
  console.log("ship: HEAD is pushed to origin/main.");

  // (3) No pending remote migrations — same check CI runs.
  checkRemoteMigrations();

  // (4) Build.
  console.log("ship: building (BANDPLATE_ADAPTER=cloudflare astro build)...");
  const buildStatus = runInherit("pnpm", ["exec", "astro", "build"], {
    ...process.env,
    BANDPLATE_ADAPTER: "cloudflare",
  });
  if (buildStatus !== 0) {
    fail("`astro build` failed — see output above.");
  }

  // (5) Deploy.
  console.log("ship: deploying (wrangler deploy)...");
  const deployStatus = runInherit("pnpm", ["exec", "wrangler", "deploy"]);
  if (deployStatus !== 0) {
    fail("`wrangler deploy` failed — see output above.");
  }

  console.log("ship: done.");
}

main();
