import { type Db, authSessionsRepo, membersRepo, schema, serviceTokensRepo } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../ports/clock.js";
import type { MailMessage, Mailer } from "../ports/mailer.js";
import {
  type AuthDeps,
  bootstrapAdmin,
  consumeLoginToken,
  createServiceToken,
  peekLoginToken,
  requestLogin,
  resolveServiceToken,
  resolveSession,
  revokeAllSessionsForMember,
  revokeSession,
} from "./auth.js";

function fakeClock(startAt = 1_000_000): Clock & { advance(ms: number): void } {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

type CapturedMail =
  | { kind: "login-link"; to: string; url: string }
  | ({ kind: "message" } & MailMessage);

interface CapturingMailer extends Mailer {
  sent: CapturedMail[];
}

function capturingMailer(): CapturingMailer {
  const sent: CapturedMail[] = [];
  return {
    sent,
    async sendLoginLink(to, url) {
      sent.push({ kind: "login-link", to, url });
    },
    async send(msg) {
      sent.push({ kind: "message", ...msg });
    },
  };
}

const buildLoginUrl = (rawToken: string) => `https://band.example/login/${rawToken}`;

function extractToken(mailer: CapturingMailer): string {
  const sent = mailer.sent[0];
  if (!sent || sent.kind !== "login-link") {
    throw new Error("expected a login link to have been sent");
  }
  const rawToken = sent.url.split("/").pop();
  if (!rawToken) {
    throw new Error("could not extract token from url");
  }
  return rawToken;
}

describe("auth service", () => {
  let db: Db;
  let mailer: CapturingMailer;
  let clock: ReturnType<typeof fakeClock>;
  let deps: AuthDeps;

  beforeEach(async () => {
    db = await createTestDb();
    mailer = capturingMailer();
    clock = fakeClock();
    deps = { db, mailer, clock, bootstrapToken: "correct-horse-battery-staple" };
  });

  describe("requestLogin", () => {
    it("sends a login link to a whitelisted, active member", async () => {
      await membersRepo.create(db, {
        displayName: "Alex",
        slug: "alex",
        email: "alex@example.com",
        status: "active",
        createdAt: clock.now(),
      });

      await requestLogin(deps, "alex@example.com", { buildLoginUrl });

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({ kind: "login-link", to: "alex@example.com" });
    });

    it("sends nothing for an unknown address", async () => {
      await requestLogin(deps, "nobody@example.com", { buildLoginUrl });
      expect(mailer.sent).toHaveLength(0);
    });

    it("sends nothing for a disabled member", async () => {
      await membersRepo.create(db, {
        displayName: "Blocked",
        slug: "blocked",
        email: "blocked@example.com",
        status: "disabled",
        createdAt: clock.now(),
      });

      await requestLogin(deps, "blocked@example.com", { buildLoginUrl });
      expect(mailer.sent).toHaveLength(0);
    });

    it("normalizes the email before lookup", async () => {
      await membersRepo.create(db, {
        displayName: "Alex",
        slug: "alex",
        email: "alex@example.com",
        status: "active",
        createdAt: clock.now(),
      });

      await requestLogin(deps, "  Alex@EXAMPLE.com  ", { buildLoginUrl });
      expect(mailer.sent).toHaveLength(1);
    });
  });

  describe("peekLoginToken / consumeLoginToken", () => {
    async function issueToken(status: "invited" | "active" = "invited"): Promise<string> {
      await membersRepo.create(db, {
        displayName: "Alex",
        slug: "alex",
        email: "alex@example.com",
        status,
        createdAt: clock.now(),
      });
      await requestLogin(deps, "alex@example.com", { buildLoginUrl });
      return extractToken(mailer);
    }

    it("peek reports a valid, unused token as valid without consuming it", async () => {
      const rawToken = await issueToken();

      const firstPeek = await peekLoginToken(deps, rawToken);
      const secondPeek = await peekLoginToken(deps, rawToken);
      expect(firstPeek.valid).toBe(true);
      expect(secondPeek.valid).toBe(true);

      const consumed = await consumeLoginToken(deps, rawToken);
      expect(consumed.ok).toBe(true);
    });

    it("consume succeeds exactly once for the same token", async () => {
      const rawToken = await issueToken();

      const first = await consumeLoginToken(deps, rawToken);
      const second = await consumeLoginToken(deps, rawToken);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
    });

    it("rejects a token past its 15-minute expiry", async () => {
      const rawToken = await issueToken();

      clock.advance(15 * 60 * 1000 + 1);

      const peek = await peekLoginToken(deps, rawToken);
      const consumed = await consumeLoginToken(deps, rawToken);

      expect(peek.valid).toBe(false);
      expect(consumed.ok).toBe(false);
    });

    it("rejects a garbage token without throwing", async () => {
      const peek = await peekLoginToken(deps, "not-a-real-token");
      const consumed = await consumeLoginToken(deps, "not-a-real-token");

      expect(peek.valid).toBe(false);
      expect(consumed.ok).toBe(false);
    });

    it("activates an invited member on first consumption and grants member scopes", async () => {
      const rawToken = await issueToken("invited");

      const result = await consumeLoginToken(deps, rawToken);

      expect(result.ok).toBe(true);
      expect(result.principal?.scopes).toContain("votes:write");
      expect(result.principal?.scopes).not.toContain("members:admin");

      const member = await membersRepo.getByEmail(db, "alex@example.com");
      expect(member?.status).toBe("active");
      expect(member?.emailVerifiedAt).toBe(clock.now());
    });

    it("does not touch an already-active member's activation fields", async () => {
      const rawToken = await issueToken("active");

      await consumeLoginToken(deps, rawToken);

      const member = await membersRepo.getByEmail(db, "alex@example.com");
      expect(member?.emailVerifiedAt).toBeNull();
    });
  });

  describe("resolveSession", () => {
    async function loginAndGetCookie(): Promise<string> {
      await membersRepo.create(db, {
        displayName: "Alex",
        slug: "alex",
        email: "alex@example.com",
        status: "active",
        createdAt: clock.now(),
      });
      await requestLogin(deps, "alex@example.com", { buildLoginUrl });
      const rawToken = extractToken(mailer);
      const consumed = await consumeLoginToken(deps, rawToken);
      if (!consumed.ok || !consumed.sessionToken) {
        throw new Error("consume failed");
      }
      return consumed.sessionToken;
    }

    async function getSessionRow(memberEmail: string) {
      const member = await membersRepo.getByEmail(db, memberEmail);
      if (!member) throw new Error("member missing");
      const sessions = await db.select().from(schema.authSessions);
      const session = sessions.find((s) => s.memberId === member.id);
      if (!session) throw new Error("session missing");
      return session;
    }

    it("resolves a valid cookie to a member principal", async () => {
      const cookie = await loginAndGetCookie();
      const principal = await resolveSession(deps, cookie);
      expect(principal?.kind).toBe("member");
    });

    it("returns undefined for a garbage cookie", async () => {
      const principal = await resolveSession(deps, "garbage");
      expect(principal).toBeUndefined();
    });

    it("returns undefined once the session is revoked", async () => {
      const cookie = await loginAndGetCookie();
      await revokeSession(deps, cookie);
      const principal = await resolveSession(deps, cookie);
      expect(principal).toBeUndefined();
    });

    it("does not extend lastSeenAt before the 24h refresh threshold", async () => {
      const cookie = await loginAndGetCookie();
      const loginAt = clock.now();

      clock.advance(60 * 60 * 1000); // 1h — under the 24h threshold
      await resolveSession(deps, cookie);
      await new Promise((resolve) => setTimeout(resolve, 0)); // flush the fire-and-forget refresh, if any

      const session = await getSessionRow("alex@example.com");
      expect(session.lastSeenAt).toBe(loginAt);
    });

    it("extends lastSeenAt/expiresAt once the 24h refresh threshold has passed", async () => {
      const cookie = await loginAndGetCookie();

      clock.advance(24 * 60 * 60 * 1000 + 1);
      await resolveSession(deps, cookie);
      await new Promise((resolve) => setTimeout(resolve, 0)); // flush the fire-and-forget refresh

      const session = await getSessionRow("alex@example.com");
      expect(session.lastSeenAt).toBe(clock.now());
      expect(session.expiresAt).toBe(clock.now() + 365 * 24 * 60 * 60 * 1000);
    });

    it("revokeAllSessionsForMember revokes every session for that member", async () => {
      const cookie = await loginAndGetCookie();
      const member = await membersRepo.getByEmail(db, "alex@example.com");
      if (!member) throw new Error("member missing");

      await revokeAllSessionsForMember(deps, member.id);
      const principal = await resolveSession(deps, cookie);

      expect(principal).toBeUndefined();
    });
  });

  describe("service tokens", () => {
    it("round-trips a created token through resolveServiceToken", async () => {
      const created = await createServiceToken(deps, {
        label: "ingest bot",
        scopes: ["ingest:write"],
      });

      const principal = await resolveServiceToken(deps, created.rawToken);

      expect(principal?.kind).toBe("service");
      expect(principal?.scopes).toEqual(["ingest:write"]);
    });

    it("rejects a token with a tampered secret", async () => {
      const created = await createServiceToken(deps, {
        label: "ingest bot",
        scopes: ["ingest:write"],
      });
      const tampered = `${created.rawToken.slice(0, -1)}x`;

      const principal = await resolveServiceToken(deps, tampered);

      expect(principal).toBeUndefined();
    });

    it("rejects malformed bearer values without throwing", async () => {
      expect(await resolveServiceToken(deps, "not-a-token")).toBeUndefined();
      expect(await resolveServiceToken(deps, "blk_")).toBeUndefined();
    });

    it("rejects a revoked token", async () => {
      const created = await createServiceToken(deps, {
        label: "ingest bot",
        scopes: ["ingest:write"],
      });
      await serviceTokensRepo.revoke(db, created.id, clock.now());

      const principal = await resolveServiceToken(deps, created.rawToken);
      expect(principal).toBeUndefined();
    });

    it("updates lastUsedAt on successful resolution", async () => {
      const created = await createServiceToken(deps, {
        label: "ingest bot",
        scopes: ["ingest:write"],
      });

      await resolveServiceToken(deps, created.rawToken);

      const row = await serviceTokensRepo.getById(db, created.id);
      expect(row?.lastUsedAt).toBe(clock.now());
    });
  });

  describe("bootstrapAdmin", () => {
    it("creates the first admin on an empty database and issues a session", async () => {
      const result = await bootstrapAdmin(deps, {
        bootstrapToken: "correct-horse-battery-staple",
        displayName: "Root Admin",
        email: "admin@example.com",
      });

      expect(result.ok).toBe(true);
      expect(result.sessionToken).toBeTruthy();
      expect(result.principal?.role).toBe("admin");

      const principal = result.sessionToken
        ? await resolveSession(deps, result.sessionToken)
        : undefined;
      expect(principal?.kind).toBe("member");
    });

    it("refuses a second bootstrap attempt", async () => {
      await bootstrapAdmin(deps, {
        bootstrapToken: "correct-horse-battery-staple",
        displayName: "Root Admin",
        email: "admin@example.com",
      });

      const second = await bootstrapAdmin(deps, {
        bootstrapToken: "correct-horse-battery-staple",
        displayName: "Someone Else",
        email: "someone@example.com",
      });

      expect(second.ok).toBe(false);
      expect(second.reason).toBe("already-bootstrapped");
      expect(await membersRepo.count(db)).toBe(1);
    });

    it("rejects a wrong bootstrap token and creates no member", async () => {
      const result = await bootstrapAdmin(deps, {
        bootstrapToken: "wrong-token",
        displayName: "Root Admin",
        email: "admin@example.com",
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("invalid-token");
      expect(await membersRepo.count(db)).toBe(0);
    });

    it("succeeds even when the test email fails to send", async () => {
      const failingMailer: Mailer = {
        async sendLoginLink() {},
        async send() {
          throw new Error("smtp is down");
        },
      };

      const result = await bootstrapAdmin(
        { ...deps, mailer: failingMailer },
        {
          bootstrapToken: "correct-horse-battery-staple",
          displayName: "Root Admin",
          email: "admin@example.com",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.testEmailSent).toBe(false);
    });
  });
});
