// `/login/[token]`: GET twice then POST still succeeds — asserted against
// the REAL ROUTE over real HTTP, not just the two helper functions
// (`peekView`/`consume`) the page's frontmatter calls.
//
// `login-token.test.ts` already covers those two functions directly, but
// as its own comment concedes, that only proves the functions themselves
// behave — it never loads `[token].astro`, never constructs a `Request`,
// and never distinguishes a GET from a POST arriving at the actual route.
// Mutation testing confirmed the gap: swapping `[token].astro`'s GET
// branch to call `consume()` instead of `peekView()` passed the entire
// suite. The routing of method -> function is the property under test
// here, so this drives the real HTTP route against a scratch database.
//
// This also closes the "no test asserts redirect status + Location, so no
// PRG redirect is covered" gap noted separately: the POST-success
// assertion below checks both explicitly.
//
// Drives the BUILT server (`pnpm build` then `node dist/start.mjs`), never
// `astro dev` — same rationale as `songs-events.route.test.ts`: the dev
// server and the Node adapter resolve request origin differently, a
// divergence invisible to typecheck/lint/unit-tests/build that already
// shipped one Critical in this project (the CSRF origin check this very
// route's POST exercises). This file used to be the one route test still
// spawning `astro dev`, silently exempting the login flow's own POST from
// that coverage.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateToken, hashToken } from "@bandplate/core";
import { createDb, loginTokensRepo, membersRepo } from "@bandplate/db";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PORT = 43217;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// The repo root — vitest's cwd is apps/web, so two levels up.
const REPO_ROOT = join(process.cwd(), "..", "..");

let dbDir: string;
let dbPath: string;
let rawToken: string;
let child: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not become ready in time: ${String(lastErr)}`);
}

async function seedMemberAndToken(): Promise<string> {
  // Reuses the real migration runner (packages/db/scripts/migrate.ts,
  // exercised the same way an operator would run it) rather than
  // depending on drizzle-orm directly from apps/web — apps/web has no
  // direct dependency on drizzle-orm (only @bandplate/db does), and pnpm's
  // strict node_modules resolution means importing it here would require
  // adding a dependency purely for this one test file.
  await execFileAsync("pnpm", ["--filter", "@bandplate/db", "run", "migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, BANDPLATE_DATABASE_URL: `file:${dbPath}` },
  });

  const client = createClient({ url: `file:${dbPath}` });
  const db = createDb(client);

  const member = await membersRepo.create(db, {
    displayName: "Robyn Route-Test",
    slug: "robyn-route-test",
    email: "robyn@example.com",
    status: "active",
    createdAt: Date.now(),
  });
  const token = generateToken();
  await loginTokensRepo.create(db, {
    memberId: member.id,
    tokenHash: await hashToken(token),
    expiresAt: Date.now() + 15 * 60 * 1000,
    requestedIp: null,
    createdAt: Date.now(),
  });
  client.close();
  return token;
}

/** `pnpm build` (astro build + the `dist/start.mjs` bundling step) — see `package.json`. */
async function buildApp(): Promise<void> {
  await execFileAsync("pnpm", ["run", "build"], { cwd: process.cwd() });
}

/** The real production entry point (`node dist/start.mjs`), never `astro dev`. */
function startBuiltServer(): ChildProcess {
  return spawn(process.execPath, [join(process.cwd(), "dist", "start.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      BANDPLATE_DATABASE_URL: `file:${dbPath}`,
      BANDPLATE_BOOTSTRAP_TOKEN: "route-test-bootstrap-token",
      BANDPLATE_APP_ORIGIN: ORIGIN,
      BANDPLATE_ALLOW_DEV_MAILER: "true",
      BANDPLATE_COOKIE_SECURE: "false",
      // Dummy S3 config — none of these route tests exercise the audio
      // endpoint, so this never needs to actually reach a bucket. It only
      // has to be PRESENT (config validation requires it) and internally
      // consistent enough that `createS3Storage` can be constructed.
      S3_ENDPOINT: "http://127.0.0.1:1",
      S3_PUBLIC_ENDPOINT: "http://127.0.0.1:1",
      S3_BUCKET: "unused-in-this-test",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "unused",
      S3_SECRET_ACCESS_KEY: "unused",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
}

describe("GET/POST /login/[token] over real HTTP (the mail-scanner scenario)", () => {
  beforeAll(async () => {
    dbDir = await mkdtemp(join(tmpdir(), "bandplate-login-token-route-"));
    dbPath = join(dbDir, "db.sqlite");
    rawToken = await seedMemberAndToken();

    await buildApp();
    child = startBuiltServer();
    await waitForServer(`${ORIGIN}/login`, 30_000);
  }, 90_000);

  afterAll(async () => {
    if (child && !child.killed) {
      // WAIT for it to actually exit, don't just signal it. Every route test
      // file builds into the same `dist/` and spawns `node dist/start.mjs`, so
      // a server still running from the previous file can be reading a bundle
      // the next file's `pnpm build` is midway through rewriting. That
      // surfaces, confusingly, as the NEXT file's server never becoming ready
      // — a different file each run, which is the signature of a race rather
      // than of a broken assertion.
      const exited = new Promise<void>((resolve) => {
        child?.once("exit", () => resolve());
      });
      child.kill("SIGTERM");
      // Bounded: a server that ignores SIGTERM must not hang the whole suite.
      await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5_000))]);
    }
    await rm(dbDir, { recursive: true, force: true });
  });

  // A sign-in URL is a bearer credential. A mail client or chat app that
  // unfurls the link would fetch its card and cache a preview of a one-time
  // credential where anyone on the thread can see it — so this page offers
  // NOTHING to unfurl. `Layout` gates every `og:`/`twitter:` tag on the same
  // `noindex` flag this page already sets, and this is what proves the two
  // stayed wired together.
  it("offers a link unfurler nothing: noindex, and not one og: or twitter: tag", async () => {
    const res = await fetch(`${ORIGIN}/login/${rawToken}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('name="robots" content="noindex"');
    expect(body).not.toContain('property="og:');
    expect(body).not.toContain('name="twitter:');
    expect(body).not.toContain("og-image.png");
  });

  it("GET renders the token page twice without consuming it, then POST still succeeds (302, Set-Cookie)", async () => {
    const get1 = await fetch(`${ORIGIN}/login/${rawToken}`);
    expect(get1.status).toBe(200);
    const body1 = await get1.text();
    expect(body1).toContain("Robyn Route-Test");
    expect(get1.headers.get("cache-control")).toContain("no-store");

    const get2 = await fetch(`${ORIGIN}/login/${rawToken}`);
    expect(get2.status).toBe(200);
    const body2 = await get2.text();
    expect(body2).toContain("Robyn Route-Test");

    const post = await fetch(`${ORIGIN}/login/${rawToken}`, {
      method: "POST",
      headers: { origin: ORIGIN },
      redirect: "manual",
    });
    expect(post.status).toBe(302);
    expect(post.headers.get("location")).toBe("/");
    expect(post.headers.get("set-cookie")).toContain("bp_session=");

    // Single-use: the SAME token, POSTed again, must now fail — the two
    // preceding GETs did not burn its one use, only this POST did.
    const secondPost = await fetch(`${ORIGIN}/login/${rawToken}`, {
      method: "POST",
      headers: { origin: ORIGIN },
      redirect: "manual",
    });
    expect(secondPost.status).toBe(200);
    const secondBody = await secondPost.text();
    expect(secondBody).toContain("expired");
  });

  // `/login?email=` is what the invitation mail's button carries, so that a
  // new member presses one thing instead of retyping the address the mail
  // was sent to. Asserted here rather than as a unit test because the value
  // reaches the page as a query parameter and leaves it as an HTML
  // attribute — the two ends nothing below the real route connects.
  it("GET /login?email= fills the field and locks it", async () => {
    const res = await fetch(`${ORIGIN}/login?email=${encodeURIComponent("robyn+inv@example.com")}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('value="robyn+inv@example.com"');
    expect(body).toContain("readonly");
    // The way back out of the lock. Without it the only escape is knowing to
    // edit the URL.
    expect(body).toContain('href="/login"');
  });

  // Anyone can type a query string, and whatever it says is rendered as the
  // address this sign-in is FOR. Anything that is not an address at all falls
  // through to the ordinary empty form rather than being echoed.
  it("GET /login ignores an email parameter that is not one", async () => {
    const res = await fetch(`${ORIGIN}/login?email=${encodeURIComponent("not an address")}`);
    const body = await res.text();
    expect(body).not.toContain("not an address");
    expect(body).not.toContain("readonly");
  });

  // The manifest is fetched by the browser with no cookie, from any page,
  // including /login. It must therefore be a static file that never reaches
  // the session guard: a redirect to /login here would make the app
  // uninstallable with no visible error.
  it("serves the web manifest publicly, as a manifest", async () => {
    const res = await fetch(`${ORIGIN}/manifest.webmanifest`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as Record<string, unknown>;
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("links the manifest and lets the page reach the screen edges", async () => {
    const body = await (await fetch(`${ORIGIN}/login`)).text();
    expect(body).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(body).toContain("viewport-fit=cover");
    expect(body).toContain('name="theme-color"');
  });
});
