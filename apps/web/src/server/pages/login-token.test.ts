// `/login/[token]`: GET twice then POST still succeeds — the mail-scanner
// scenario. Exercised against `peekView`/`consume`, the exact two functions
// the `[token].astro` page's frontmatter calls for GET and POST
// respectively (see that file) — this is "the page level" in the sense the
// brief means it: the actual functions the page runs, not a re-test of
// `@bandplate/core`'s own (already covered in packages/core) unit tests, and
// not only the JSON API's HTTP-level test
// (packages/api/src/auth.test.ts's "GET /auth/login/:token" suite).
import { type AuthDeps, generateToken, hashToken, systemClock } from "@bandplate/core";
import { loginTokensRepo, membersRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { createNullMailer } from "@bandplate/mail";
import { beforeEach, describe, expect, it } from "vitest";
import { consume, peekView } from "./login-token.js";

describe("login-token page logic", () => {
  let auth: AuthDeps;
  let rawToken: string;

  beforeEach(async () => {
    const db = await createTestDb();
    auth = { db, mailer: createNullMailer(), clock: systemClock };

    const member = await membersRepo.create(db, {
      displayName: "Alex",
      slug: "alex",
      email: "alex@example.com",
      status: "active",
      createdAt: 1_000,
    });
    rawToken = generateToken();
    await loginTokensRepo.create(db, {
      memberId: member.id,
      tokenHash: await hashToken(rawToken),
      expiresAt: Date.now() + 15 * 60 * 1000,
      requestedIp: null,
      createdAt: Date.now(),
    });
  });

  it("GET (peekView) does not consume the token — two GETs, then a POST (consume) still succeeds", async () => {
    const get1 = await peekView(auth, rawToken);
    const get2 = await peekView(auth, rawToken);
    expect(get1).toEqual({ kind: "valid", displayName: "Alex" });
    expect(get2).toEqual({ kind: "valid", displayName: "Alex" });

    const post = await consume(auth, rawToken, "Mozilla/5.0 test agent");
    expect(post.ok).toBe(true);
    if (post.ok) {
      expect(post.sessionToken).toEqual(expect.any(String));
      expect(post.principal.kind).toBe("member");
    }
  });

  it("consume is single-use: a second POST with the same token fails", async () => {
    const first = await consume(auth, rawToken, null);
    const second = await consume(auth, rawToken, null);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("peekView reports an unknown token as invalid, not a throw", async () => {
    const view = await peekView(auth, "not-a-real-token");
    expect(view).toEqual({ kind: "invalid" });
  });

  it("consume reports an unknown token as not ok, not a throw", async () => {
    const result = await consume(auth, "not-a-real-token", null);
    expect(result.ok).toBe(false);
  });
});
