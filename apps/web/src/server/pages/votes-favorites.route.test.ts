// `/takes/[id]/vote`, `/favorites`, `/admin/takes/[id]/keeper` over real
// HTTP — same rationale as `songs-events.route.test.ts`: drives the BUILT
// server (never `astro dev`), because `security.checkOrigin` and this
// app's own origin-check middleware behave differently there (see the
// brief and `astro.config.mjs`'s comment). This is also the file that
// proves the no-JS path actually works end to end (a plain, unencoded
// `application/x-www-form-urlencoded` POST with no `Accept: application/json`
// header — exactly what a browser sends for a real `<form>` submission with
// JS disabled) and that a forged `memberId`/disabled member is rejected at
// the HTTP layer, not just in the page-logic unit tests.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateToken, hashToken } from "@bandlib/core";
import {
  createDb,
  eventsRepo,
  favoritesRepo,
  loginTokensRepo,
  membersRepo,
  songsRepo,
  takesRepo,
  votesRepo,
} from "@bandlib/db";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PORT = 43223;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = join(process.cwd(), "..", "..");

let dbDir: string;
let dbPath: string;
let child: ChildProcess | undefined;

let memberACookie: string;
let memberAId: string;
let memberBCookie: string;
let memberBId: string;
let disabledMemberId: string;
let disabledMemberCookie: string;
let adminCookie: string;
let takeId: string;
let songId: string;
let songSlug: string;

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

async function loginViaLinkAndGetCookie(
  db: Awaited<ReturnType<typeof createDb>>,
  memberId: string,
): Promise<string> {
  const token = generateToken();
  await loginTokensRepo.create(db, {
    memberId,
    tokenHash: await hashToken(token),
    expiresAt: Date.now() + 15 * 60 * 1000,
    requestedIp: null,
    createdAt: Date.now(),
  });
  const res = await fetch(`${ORIGIN}/login/${token}`, {
    method: "POST",
    headers: { origin: ORIGIN },
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("expected a Set-Cookie header from consuming the login token");
  }
  return setCookie.split(";")[0] ?? "";
}

async function seed(): Promise<void> {
  await execFileAsync("pnpm", ["--filter", "@bandlib/db", "run", "migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, BANDLIB_DATABASE_URL: `file:${dbPath}` },
  });

  const client = createClient({ url: `file:${dbPath}` });
  const db = createDb(client);
  const now = Date.now();

  const memberA = await membersRepo.create(db, {
    displayName: "Vote Route Member A",
    slug: "vote-route-member-a",
    email: "vote-route-a@example.com",
    status: "active",
    createdAt: now,
  });
  memberAId = memberA.id;
  const memberB = await membersRepo.create(db, {
    displayName: "Vote Route Member B",
    slug: "vote-route-member-b",
    email: "vote-route-b@example.com",
    status: "active",
    createdAt: now,
  });
  memberBId = memberB.id;
  const disabled = await membersRepo.create(db, {
    displayName: "Vote Route Disabled",
    slug: "vote-route-disabled",
    email: "vote-route-disabled@example.com",
    status: "active",
    createdAt: now,
  });
  disabledMemberId = disabled.id;
  const admin = await membersRepo.create(db, {
    displayName: "Vote Route Admin",
    slug: "vote-route-admin",
    email: "vote-route-admin@example.com",
    role: "admin",
    status: "active",
    createdAt: now,
  });

  const song = await songsRepo.create(db, {
    title: "Vote Route Test Song",
    slug: "vote-route-test-song",
    createdAt: now,
    updatedAt: now,
  });
  songId = song.id;
  songSlug = song.slug;
  const event = await eventsRepo.create(db, {
    kind: "rehearsal",
    heldAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const take = await takesRepo.create(db, {
    songId: song.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
    state: "published",
  });
  takeId = take.id;

  memberACookie = await loginViaLinkAndGetCookie(db, memberA.id);
  memberBCookie = await loginViaLinkAndGetCookie(db, memberB.id);
  disabledMemberCookie = await loginViaLinkAndGetCookie(db, disabled.id);
  adminCookie = await loginViaLinkAndGetCookie(db, admin.id);

  // Disable AFTER logging in — the session already exists; the point of
  // this fixture is a session that WAS valid and no longer is, exactly the
  // scenario `resolveSession` (see `packages/core/src/services/auth.ts`)
  // has to reject.
  await membersRepo.setStatus(db, disabled.id, "disabled");

  client.close();
}

async function buildApp(): Promise<void> {
  await execFileAsync("pnpm", ["run", "build"], { cwd: process.cwd() });
}

function startBuiltServer(): ChildProcess {
  return spawn(process.execPath, [join(process.cwd(), "dist", "start.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      BANDLIB_DATABASE_URL: `file:${dbPath}`,
      BANDLIB_BOOTSTRAP_TOKEN: "vote-route-bootstrap-token",
      BANDLIB_APP_ORIGIN: ORIGIN,
      BANDLIB_ALLOW_DEV_MAILER: "true",
      BANDLIB_COOKIE_SECURE: "false",
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

describe("vote/favorite/admin-keeper routes over real HTTP", () => {
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    dbDir = await mkdtemp(join(tmpdir(), "bandlib-vote-favorites-route-"));
    dbPath = join(dbDir, "db.sqlite");

    await buildApp();
    child = startBuiltServer();
    await waitForServer(`${ORIGIN}/login`, 30_000);

    await seed();
    db = createDb(createClient({ url: `file:${dbPath}` }));
  }, 120_000);

  afterAll(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    await rm(dbDir, { recursive: true, force: true });
  });

  it("a plain, no-JS form POST casts a vote and redirects back (302, not JSON)", async () => {
    const res = await fetch(`${ORIGIN}/takes/${takeId}/vote`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: memberACookie,
        "content-type": "application/x-www-form-urlencoded",
        // Deliberately NOT `accept: application/json` — this is what a
        // real browser sends for a plain <form method="post"> submission.
      },
      body: "keeper=true",
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    // No `Referer` header was sent — falls back to the take detail page,
    // per `safeRedirectPath`'s own fallback (not an open redirect to
    // wherever a header claims).
    expect(res.headers.get("location")).toBe(`/takes/${takeId}`);

    const vote = (await votesRepo.listByTake(db, takeId)).find((v) => v.memberId === memberAId);
    expect(vote?.keeper).toBe(true);
  });

  it("a JS (fetch) vote POST with Accept: application/json gets the fresh tally back as JSON, not a redirect", async () => {
    const res = await fetch(`${ORIGIN}/takes/${takeId}/vote`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: memberBCookie,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "keeper=false",
      redirect: "manual",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { keeper: boolean; tally: { totalVotes: number } };
    expect(body.keeper).toBe(false);
    expect(body.tally.totalVotes).toBe(2); // memberA (keeper) + memberB (not-keeper) by now
  });

  it("MUTATION CHECK: a forged memberId form field cannot vote as someone else — attribution follows the session, not the form", async () => {
    const res = await fetch(`${ORIGIN}/takes/${takeId}/vote`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: memberBCookie,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: `keeper=true&memberId=${memberAId}`,
      redirect: "manual",
    });
    expect(res.status).toBe(200);

    // The vote must be memberB's own (now flipped to keeper=true by THIS
    // request), never a second vote attributed to memberA.
    const votes = await votesRepo.listByTake(db, takeId);
    const bVote = votes.find((v) => v.memberId === memberBId);
    expect(bVote?.keeper).toBe(true);
    // memberA's vote is still their own earlier one (keeper=true from the
    // first test) — exactly one row per member, never duplicated by the
    // forged field.
    const votesForA = votes.filter((v) => v.memberId === memberAId);
    expect(votesForA.length).toBe(1);
  });

  it("a disabled member's stale session redirects to /login instead of voting", async () => {
    const res = await fetch(`${ORIGIN}/takes/${takeId}/vote`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: disabledMemberCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "keeper=true",
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    const vote = (await votesRepo.listByTake(db, takeId)).find(
      (v) => v.memberId === disabledMemberId,
    );
    expect(vote).toBeUndefined();
  });

  it("a cross-origin POST is rejected by the app-wide origin-check middleware before the page runs", async () => {
    const res = await fetch(`${ORIGIN}/takes/${takeId}/vote`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        cookie: memberACookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "keeper=true",
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });

  it("an anonymous POST redirects to /login rather than voting", async () => {
    const res = await fetch(`${ORIGIN}/takes/${takeId}/vote`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: "keeper=true",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("a plain no-JS favorite POST toggles the favorite and redirects", async () => {
    const first = await fetch(`${ORIGIN}/favorites`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: memberACookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `targetType=song&targetId=${songId}`,
      redirect: "manual",
    });
    expect(first.status).toBe(302);
    expect(await favoritesRepo.isFavorited(db, memberAId, "song", songId)).toBe(true);

    const second = await fetch(`${ORIGIN}/favorites`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: memberACookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `targetType=song&targetId=${songId}`,
      redirect: "manual",
    });
    expect(second.status).toBe(302);
    expect(await favoritesRepo.isFavorited(db, memberAId, "song", songId)).toBe(false);
  });

  it("MUTATION CHECK: a forged memberId cannot favorite on someone else's behalf", async () => {
    const res = await fetch(`${ORIGIN}/favorites`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: memberBCookie,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: `targetType=song&targetId=${songId}&memberId=${memberAId}`,
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await favoritesRepo.isFavorited(db, memberBId, "song", songId)).toBe(true);
    expect(await favoritesRepo.isFavorited(db, memberAId, "song", songId)).toBe(false);
  });

  it("a non-admin member is forbidden from the admin keeper-promotion route", async () => {
    const res = await fetch(`${ORIGIN}/admin/takes/${takeId}/keeper`, {
      headers: { cookie: memberACookie },
    });
    expect(res.status).toBe(403);
  });

  it("the admin confirm page names the take before promoting it", async () => {
    const res = await fetch(`${ORIGIN}/admin/takes/${takeId}/keeper`, {
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Vote Route Test Song");
    expect(body).toContain("keeper");
  });

  it("an admin can promote a take to keeper through the confirm page's POST", async () => {
    const res = await fetch(`${ORIGIN}/admin/takes/${takeId}/keeper`, {
      method: "POST",
      headers: { origin: ORIGIN, cookie: adminCookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const take = await takesRepo.getById(db, takeId);
    expect(take?.state).toBe("keeper");
  });

  it("member B sees member A's vote reflected on the song page's take tally", async () => {
    const res = await fetch(`${ORIGIN}/songs/${songSlug}`, {
      headers: { cookie: memberBCookie },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    // Both members have now voted (A: keeper, B: keeper after the mutation
    // check above) — the tally text should reflect 2 total votes.
    expect(body).toMatch(/2 (of|votes)/);
  });
});
