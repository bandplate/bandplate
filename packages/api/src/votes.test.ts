// `POST /votes` — see `routes/votes.ts`'s own header comment for why this
// route exists alongside apps/web's own Astro form handler. Covers what the
// brief's §5/§7 call out specifically: scope gating, a forged `memberId`
// being structurally impossible (not just "ignored" — there's no field for
// it), a disabled member losing their session (and so their principal)
// before this route ever runs, and a service token being rejected even
// when it happens to hold `votes:write`.
import { createServiceToken } from "@bandplate/core";
import { eventsRepo, membersRepo, songsRepo, takesRepo, votesRepo } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  extractLoginToken,
  extractSessionCookieValue,
  TEST_APP_ORIGIN,
  type TestApp,
} from "./test-helpers.js";

const jsonHeaders = { "content-type": "application/json", origin: TEST_APP_ORIGIN };

async function loginAsMember(
  testApp: TestApp,
  input: { email: string; displayName: string },
): Promise<{ cookie: string; memberId: string }> {
  const member = await membersRepo.create(testApp.db, {
    displayName: input.displayName,
    slug: input.displayName.toLowerCase().replace(/\s+/g, "-"),
    email: input.email,
    role: "member",
    status: "active",
    createdAt: testApp.clock.now(),
  });
  await testApp.app.request("/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email: input.email }),
  });
  const token = extractLoginToken(testApp.mailer);
  const res = await testApp.app.request(`/auth/login/${token}`, {
    method: "POST",
    headers: { origin: TEST_APP_ORIGIN },
  });
  return { cookie: extractSessionCookieValue(res.headers.get("set-cookie")), memberId: member.id };
}

async function seedTake(testApp: TestApp): Promise<string> {
  const now = testApp.clock.now();
  const song = await songsRepo.create(testApp.db, {
    title: "Vote Route Test Song",
    slug: "vote-route-test-song",
    createdAt: now,
    updatedAt: now,
  });
  const event = await eventsRepo.create(testApp.db, {
    kind: "rehearsal",
    heldAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const take = await takesRepo.create(testApp.db, {
    songId: song.id,
    eventId: event.id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return take.id;
}

describe("POST /votes", () => {
  it("a signed-in member can cast a keeper vote and gets the updated tally back", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);
    const { cookie } = await loginAsMember(testApp, {
      email: "voter@example.com",
      displayName: "Voter",
    });

    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ takeId, keeper: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.take.keeperVotes).toBe(1);
    expect(body.take.totalVotes).toBe(1);
    expect(body.take.ratingScore).toBe(1);
  });

  it("an anonymous caller gets 403, not a vote", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);

    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ takeId, keeper: true }),
    });

    expect(res.status).toBe(403);
    const row = await takesRepo.getById(testApp.db, takeId);
    expect(row?.totalVotes).toBe(0);
  });

  it("MUTATION CHECK: a forged memberId in the body cannot make member A vote as member B — the vote is always attributed to the session's own principal", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);
    const { memberId: memberAId } = await loginAsMember(testApp, {
      email: "member-a@example.com",
      displayName: "Member A",
    });
    const { cookie: cookieB, memberId: memberBId } = await loginAsMember(testApp, {
      email: "member-b@example.com",
      displayName: "Member B",
    });

    // Member B is signed in, but the body claims to vote as member A.
    // `castVoteSchema` has no `memberId` field at all, so this extra field
    // is simply dropped by `.safeParse` — proven below by checking WHO the
    // vote actually landed as, not just that the request succeeded.
    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookieB}` },
      body: JSON.stringify({ takeId, keeper: true, memberId: memberAId }),
    });
    expect(res.status).toBe(200);

    const takeVotes = await votesRepo.listByTake(testApp.db, takeId);
    expect(takeVotes.length).toBe(1);
    expect(takeVotes[0]?.memberId).toBe(memberBId);
    expect(takeVotes[0]?.memberId).not.toBe(memberAId);
  });

  it("a disabled member's stale session cannot vote (resolveSession rejects it before this route ever runs)", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);
    const { cookie, memberId } = await loginAsMember(testApp, {
      email: "disabled@example.com",
      displayName: "Disabled Member",
    });

    await membersRepo.setStatus(testApp.db, memberId, "disabled");

    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ takeId, keeper: true }),
    });

    expect(res.status).toBe(403);
    const row = await takesRepo.getById(testApp.db, takeId);
    expect(row?.totalVotes).toBe(0);
  });

  it("a service token, even one holding votes:write, is rejected — voting needs a real member identity", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);
    const created = await createServiceToken(
      { db: testApp.db, mailer: testApp.mailer, clock: testApp.clock },
      { label: "bot", scopes: ["votes:write"] },
    );

    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, authorization: `Bearer ${created.rawToken}` },
      body: JSON.stringify({ takeId, keeper: true }),
    });

    expect(res.status).toBe(403);
  });

  it("MUTATION CHECK: POST /votes is declared with votes:write specifically, not some other scope", async () => {
    // See the equivalent test in favorites.test.ts for why a request-level
    // probe (an out-of-scope service token, say) can't distinguish "this
    // route requires votes:write" from "requires some other scope" — the
    // `principal?.kind !== "member"` check above rejects every service
    // token the same way regardless of which scope it holds. Assert the
    // declaration itself against the registry `assertEveryRouteIsGuarded`
    // cross-checks against the live Hono app.
    const testApp = await buildTestApp();
    const route = testApp.router.registry.find((r) => r.method === "POST" && r.path === "/votes");
    expect(route).toBeDefined();
    expect(route?.guard).toEqual({ scopes: ["votes:write"] });
  });

  it("a cross-origin POST (no matching Origin header) is rejected by the origin-check backstop", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);
    const { cookie } = await loginAsMember(testApp, {
      email: "origin-test@example.com",
      displayName: "Origin Test",
    });

    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `bp_session=${cookie}`,
        origin: "https://evil.example",
      },
      body: JSON.stringify({ takeId, keeper: true }),
    });

    expect(res.status).toBe(403);
  });

  it("voting on a nonexistent take is 404, not a silent no-op", async () => {
    const testApp = await buildTestApp();
    const { cookie } = await loginAsMember(testApp, {
      email: "notfound@example.com",
      displayName: "Not Found",
    });

    const res = await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ takeId: "not-a-real-take-id", keeper: true }),
    });

    expect(res.status).toBe(404);
  });

  it("changing a vote (second POST) updates the tally rather than duplicating it", async () => {
    const testApp = await buildTestApp();
    const takeId = await seedTake(testApp);
    const { cookie } = await loginAsMember(testApp, {
      email: "changer@example.com",
      displayName: "Changer",
    });

    await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ takeId, keeper: true }),
    });
    const second = await testApp.app.request("/votes", {
      method: "POST",
      headers: { ...jsonHeaders, cookie: `bp_session=${cookie}` },
      body: JSON.stringify({ takeId, keeper: false }),
    });

    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.take.totalVotes).toBe(1);
    expect(body.take.keeperVotes).toBe(0);
  });
});
