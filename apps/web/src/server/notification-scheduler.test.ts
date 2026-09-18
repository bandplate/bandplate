// Only `shouldStartNotificationScheduler` — the pure decidable piece of
// `notification-scheduler.ts` — is unit tested here. `startNotificationScheduler`
// itself (timers, a `globalThis` singleton) is exercised indirectly by the
// built-server route tests: they boot with no VAPID env and rely on the
// scheduler NOT starting, which only holds if this function returns `false`
// correctly. See those tests' own comments.
import { describe, expect, it } from "vitest";
import { shouldStartNotificationScheduler } from "./notification-scheduler.js";

describe("shouldStartNotificationScheduler", () => {
  it("runs when BANDPLATE_SCHEDULER is unset", () => {
    expect(shouldStartNotificationScheduler(undefined)).toBe(true);
  });

  it("runs for any value other than the literal 'off'", () => {
    expect(shouldStartNotificationScheduler("on")).toBe(true);
    expect(shouldStartNotificationScheduler("")).toBe(true);
    expect(shouldStartNotificationScheduler("OFF")).toBe(true);
  });

  it("does not run when BANDPLATE_SCHEDULER is exactly 'off'", () => {
    expect(shouldStartNotificationScheduler("off")).toBe(false);
  });
});
