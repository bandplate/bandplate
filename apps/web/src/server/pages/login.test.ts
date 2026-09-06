// `/login`: "forms work without JS" — `handleLoginPost` is exactly what
// the `login/index.astro` page's frontmatter calls after reading
// `await Astro.request.formData()`, i.e. a plain `<form method="post">`
// submission, no `fetch`/JSON involved anywhere in this path.
import { type AuthDeps, createInMemoryRateLimiter, systemClock } from "@bandlib/core";
import { createTestDb } from "@bandlib/db/testing";
import { type CapturingMailer, createCapturingMailer } from "@bandlib/mail";
import { beforeEach, describe, expect, it } from "vitest";
import { type LoginPostDeps, handleLoginPost } from "./login.js";

function formData(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

const headers = (ip?: string) => ({
  get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? (ip ?? null) : null),
});

describe("handleLoginPost", () => {
  let deps: LoginPostDeps;

  beforeEach(async () => {
    const db = await createTestDb();
    const mailer = createCapturingMailer();
    const auth: AuthDeps = { db, mailer, clock: systemClock, sleep: async () => {} };
    deps = {
      auth,
      rateLimiter: createInMemoryRateLimiter(systemClock),
      appOrigin: "https://band.example",
    };
  });

  it("rejects an empty email without throwing", async () => {
    const result = await handleLoginPost(deps, formData(""), headers());
    expect(result).toEqual({ kind: "invalid", error: "Enter your email address." });
  });

  it("accepts a plain form submission and reports success identically for an unknown address", async () => {
    const result = await handleLoginPost(deps, formData("nobody@example.com"), headers());
    expect(result).toEqual({ kind: "sent" });
  });

  it("rate-limits after 5 requests for the same email within the window", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await handleLoginPost(deps, formData("alex@example.com"), headers());
      expect(r.kind).toBe("sent");
    }
    const sixth = await handleLoginPost(deps, formData("alex@example.com"), headers());
    expect(sixth.kind).toBe("rate_limited");
    if (sixth.kind === "rate_limited") {
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("builds the login URL from the configured appOrigin", async () => {
    const mailer = deps.auth.mailer as CapturingMailer;
    const db = deps.auth.db;
    const { membersRepo } = await import("@bandlib/db");
    await membersRepo.create(db, {
      displayName: "Alex",
      slug: "alex",
      email: "alex@example.com",
      status: "active",
      createdAt: Date.now(),
    });

    const result = await handleLoginPost(deps, formData("alex@example.com"), headers());

    // This is the enumeration-safety property, asserted where it matters:
    // a REGISTERED address gets back the exact same `{ kind: "sent" }`
    // this suite already proved an unknown address gets (see "accepts a
    // plain form submission..." above). The previous version of this test
    // discarded `handleLoginPost`'s return value entirely and only checked
    // that mail was sent — so a hypothetical future branch that returned a
    // different response for a known address (leaking whether an email is
    // registered) would have survived unnoticed.
    expect(result).toEqual({ kind: "sent" });

    expect(mailer.sent).toHaveLength(1);
    const sent = mailer.sent[0];
    expect(sent?.kind).toBe("login-link");
    if (sent?.kind === "login-link") {
      expect(sent.url.startsWith("https://band.example/login/")).toBe(true);
    }
  });
});
