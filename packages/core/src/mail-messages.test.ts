// What these assert is mostly NEGATIVE, and deliberately so: the styling is a
// judgement call that a test would only freeze, but the email constraints in
// `mail-messages.ts`'s header are not — a `<style>` block, an inline SVG or a
// `data:` URI would each be silently dropped by a real client and look fine in
// every other check we run.
//
// The other half is the plain-text part carrying everything the HTML does. A
// text-only client is the fallback for the only way into the app, so a link
// that appears in one part and not the other is a lockout for whoever reads
// mail that way.
import { describe, expect, it } from "vitest";
import {
  buildInviteMessage,
  buildLoginLinkMessage,
  buildSetupTestMessage,
} from "./mail-messages.js";

const LOGIN_URL = "https://band.example/login/tok-123";

/** Every constraint from the module header that a client enforces silently. */
function expectRendersInEmailClients(html: string) {
  expect(html).not.toContain("<style");
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("data:");
  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).not.toContain("class=");
}

describe("buildLoginLinkMessage", () => {
  it("carries the link in both parts, and the greeting and lifetime in the text", () => {
    const msg = buildLoginLinkMessage({
      to: "alex@example.com",
      url: LOGIN_URL,
      displayName: "Alex",
      expiresInMinutes: 15,
    });

    expect(msg.to).toBe("alex@example.com");
    expect(msg.text).toContain(LOGIN_URL);
    expect(msg.text).toContain("Hi Alex,");
    expect(msg.text).toContain("next 15 minutes");
    expect(msg.html).toContain(LOGIN_URL);
    expectRendersInEmailClients(msg.html ?? "");
  });

  it("prints the link a second time as text, for a client that drops the button", () => {
    const msg = buildLoginLinkMessage({ to: "a@b.c", url: LOGIN_URL });
    // Once in the `href`, once in the paste-this fallback.
    expect(msg.html?.split(LOGIN_URL).length).toBe(3);
  });

  it("says minute, singular, at one", () => {
    const msg = buildLoginLinkMessage({ to: "a@b.c", url: LOGIN_URL, expiresInMinutes: 1 });
    expect(msg.text).toContain("next 1 minute.");
  });

  it("drops the lifetime sentence rather than printing a wrong one", () => {
    const msg = buildLoginLinkMessage({ to: "a@b.c", url: LOGIN_URL });
    expect(msg.text).toContain("It works once.");
    expect(msg.text).not.toContain("minute");
  });

  it("greets without a name when there isn't one", () => {
    expect(buildLoginLinkMessage({ to: "a@b.c", url: LOGIN_URL }).text).toContain("Hi,");
  });

  it("takes the mark's origin from the link itself, never from anywhere else", () => {
    const msg = buildLoginLinkMessage({ to: "a@b.c", url: LOGIN_URL });
    expect(msg.html).toContain('src="https://band.example/icon-192.png"');
  });

  it("renders without a mark rather than a broken one when the link is unparsable", () => {
    const msg = buildLoginLinkMessage({ to: "a@b.c", url: "not-a-url" });
    expect(msg.html).not.toContain("<img");
    // The wordmark is text, so the identity survives regardless.
    expect(msg.html).toContain(">bandplate<");
  });

  it("escapes a display name into the html", () => {
    const msg = buildLoginLinkMessage({
      to: "a@b.c",
      url: LOGIN_URL,
      displayName: '<script>alert("x")</script>',
    });
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).toContain("&lt;script&gt;");
  });
});

describe("buildInviteMessage", () => {
  it("names the address to sign in with, and links the sign-in page", () => {
    const msg = buildInviteMessage({
      to: "sam@example.com",
      displayName: "Sam",
      signInUrl: "https://band.example/login",
    });

    expect(msg.subject).toBe("You've been added to bandplate");
    expect(msg.text).toContain("Hi Sam,");
    expect(msg.text).toContain("(sam@example.com)");
    expect(msg.text).toContain("https://band.example/login");
    expect(msg.html).toContain('href="https://band.example/login"');
    expectRendersInEmailClients(msg.html ?? "");
  });

  it("carries no token — an invite is a notification, not a credential", () => {
    const msg = buildInviteMessage({
      to: "sam@example.com",
      displayName: "Sam",
      signInUrl: "https://band.example/login",
    });
    expect(msg.text).not.toMatch(/\/login\/\S/);
  });
});

describe("buildSetupTestMessage", () => {
  it("confirms mail works and points at the deployment", () => {
    const msg = buildSetupTestMessage({ to: "op@example.com", appOrigin: "https://band.example" });
    expect(msg.subject).toBe("bandplate is set up");
    expect(msg.text).toContain("Mail is working.");
    expect(msg.text).toContain("https://band.example");
    expect(msg.html).toContain('href="https://band.example"');
    expectRendersInEmailClients(msg.html ?? "");
  });

  it("still sends when no origin was configured — the proof matters, the button doesn't", () => {
    const msg = buildSetupTestMessage({ to: "op@example.com" });
    expect(msg.text).toContain("Mail is working.");
    expect(msg.html).not.toContain("<a ");
    expect(msg.html).not.toContain("<img");
  });
});
