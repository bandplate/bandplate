import { beforeEach, describe, expect, it, vi } from "vitest";
// A static import, not `await import()` inside the test: the mock below is
// hoisted above it either way, but a dynamic import made the first test pay
// for loading `./smtp.js` and the whole `@bandplate/core` barrel inside its
// 5 s timeout. That was ~0.7 s on an idle machine and blew the budget when
// `pnpm test` ran the other packages alongside. Module loading belongs to
// collection, which the test timeout does not cover.
import { createSmtpMailer } from "./smtp.js";

const sendMail = vi.fn().mockResolvedValue(undefined);

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
}));

describe("smtp mailer", () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  it("escapes HTML-significant characters in displayName and url before interpolating into the HTML body", async () => {
    const mailer = createSmtpMailer({
      host: "smtp.example",
      port: 587,
      from: "bandplate@example.com",
    });

    await mailer.sendLoginLink("alex@example.com", 'https://band.example/login/abc?x=1&y="2"', {
      displayName: '<script>alert("hi")</script>',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0]?.[0] as { html: string; text: string };

    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
    expect(call.html).not.toMatch(/href="https:\/\/band\.example\/login\/abc\?x=1&y="2""/);
    expect(call.html).toContain("&amp;y=&quot;2&quot;");

    // The plaintext body is untouched (no HTML context to escape for).
    expect(call.text).toContain('<script>alert("hi")</script>');
  });
});
