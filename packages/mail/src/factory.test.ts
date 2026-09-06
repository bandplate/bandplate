import { describe, expect, it } from "vitest";
import { createCapturingMailer } from "./capturing.js";
import { createMailer } from "./factory.js";

describe("createMailer", () => {
  it("refuses to construct a console mailer without allowDevMailer", () => {
    expect(() => createMailer("console", { allowDevMailer: false })).toThrow(/allowDevMailer/);
  });

  it("refuses to construct a null mailer without allowDevMailer", () => {
    expect(() => createMailer("null", { allowDevMailer: false })).toThrow(/allowDevMailer/);
  });

  it("constructs a console mailer when explicitly allowed", async () => {
    const mailer = createMailer("console", { allowDevMailer: true });
    await expect(mailer.sendLoginLink("a@example.com", "https://x/y")).resolves.toBeUndefined();
  });

  it("constructs a null mailer when explicitly allowed, and it discards everything", async () => {
    const mailer = createMailer("null", { allowDevMailer: true });
    await expect(
      mailer.send({ to: "a@example.com", subject: "s", text: "t" }),
    ).resolves.toBeUndefined();
  });
});

describe("createCapturingMailer", () => {
  it("records sendLoginLink calls", async () => {
    const mailer = createCapturingMailer();
    await mailer.sendLoginLink("a@example.com", "https://x/y", { displayName: "Alex" });
    expect(mailer.sent).toEqual([
      {
        kind: "login-link",
        to: "a@example.com",
        url: "https://x/y",
        opts: { displayName: "Alex" },
      },
    ]);
  });

  it("records send calls", async () => {
    const mailer = createCapturingMailer();
    await mailer.send({ to: "a@example.com", subject: "hi", text: "body" });
    expect(mailer.sent).toEqual([
      { kind: "message", to: "a@example.com", subject: "hi", text: "body" },
    ]);
  });

  it("clear empties the captured list", async () => {
    const mailer = createCapturingMailer();
    await mailer.send({ to: "a@example.com", subject: "hi", text: "body" });
    mailer.clear();
    expect(mailer.sent).toHaveLength(0);
  });
});
