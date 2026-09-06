// `setSessionCookie`/`clearSessionCookie` shipped with zero tests —
// mutation testing found `httpOnly:false, secure:false` survives, i.e.
// nothing pinned the actual security attributes on the session cookie.
// Astro's real `AstroCookies` needs a live `Request`/response cycle, so
// this exercises the same call against a minimal fake that records what
// was passed to `.set()`/`.delete()` — enough to assert the exact
// attributes without booting Astro.
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, clearSessionCookie, setSessionCookie } from "./cookies.js";

interface RecordedSet {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

interface RecordedDelete {
  name: string;
  options: Record<string, unknown>;
}

class FakeCookies {
  sets: RecordedSet[] = [];
  deletes: RecordedDelete[] = [];

  set(name: string, value: string, options: Record<string, unknown> = {}): void {
    this.sets.push({ name, value, options });
  }

  delete(name: string, options: Record<string, unknown> = {}): void {
    this.deletes.push({ name, options });
  }
}

describe("setSessionCookie", () => {
  it("sets httpOnly, sameSite=lax, path=/, and a ~1 year maxAge", () => {
    const cookies = new FakeCookies();
    // biome-ignore lint/suspicious/noExplicitAny: FakeCookies only implements the two methods used
    setSessionCookie(cookies as any, "raw-token", { cookieSecure: true });

    expect(cookies.sets).toHaveLength(1);
    const [set] = cookies.sets;
    expect(set?.name).toBe(SESSION_COOKIE_NAME);
    expect(set?.value).toBe("raw-token");
    expect(set?.options.httpOnly).toBe(true);
    expect(set?.options.sameSite).toBe("lax");
    expect(set?.options.path).toBe("/");
    expect(set?.options.maxAge).toBe(365 * 24 * 60 * 60);
  });

  it("sets secure:true when cookieSecure is true", () => {
    const cookies = new FakeCookies();
    // biome-ignore lint/suspicious/noExplicitAny: FakeCookies only implements the two methods used
    setSessionCookie(cookies as any, "raw-token", { cookieSecure: true });
    expect(cookies.sets[0]?.options.secure).toBe(true);
  });

  it("sets secure:false only when cookieSecure is explicitly false (local HTTP dev)", () => {
    const cookies = new FakeCookies();
    // biome-ignore lint/suspicious/noExplicitAny: FakeCookies only implements the two methods used
    setSessionCookie(cookies as any, "raw-token", { cookieSecure: false });
    expect(cookies.sets[0]?.options.secure).toBe(false);
  });
});

describe("clearSessionCookie", () => {
  it("deletes the session cookie at path=/ with the configured secure flag", () => {
    const cookies = new FakeCookies();
    // biome-ignore lint/suspicious/noExplicitAny: FakeCookies only implements the two methods used
    clearSessionCookie(cookies as any, { cookieSecure: true });

    expect(cookies.deletes).toHaveLength(1);
    const [del] = cookies.deletes;
    expect(del?.name).toBe(SESSION_COOKIE_NAME);
    expect(del?.options.path).toBe("/");
    expect(del?.options.secure).toBe(true);
  });
});
