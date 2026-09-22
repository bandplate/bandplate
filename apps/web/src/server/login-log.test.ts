import { describe, expect, it } from "vitest";
import { loginRequestLogLine } from "./login-log.js";

describe("loginRequestLogLine", () => {
  it("names no address for a sent link", () => {
    expect(loginRequestLogLine("sent")).toBe("[login] link sent to a member");
  });

  it("names no address for an unknown/disabled member", () => {
    const line = loginRequestLogLine("unknown");
    expect(line).toContain("no link sent");
    expect(line).not.toMatch(/@/);
  });

  it("never contains an '@' for either outcome", () => {
    expect(loginRequestLogLine("sent")).not.toContain("@");
    expect(loginRequestLogLine("unknown")).not.toContain("@");
  });
});
