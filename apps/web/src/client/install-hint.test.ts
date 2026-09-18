import { describe, expect, it } from "vitest";
import { decideInstallHint, isIos } from "./install-hint.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
// iPadOS asks for the desktop site by default and says it is a Mac. Touch
// points are the only thing that gives it away.
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

const base = {
  standalone: false,
  promptAvailable: false,
  maxTouchPoints: 0,
  iosSignInWorks: true,
};

describe("isIos", () => {
  it("an iPhone is iOS", () => expect(isIos(IPHONE, 5)).toBe(true));
  it("an iPad pretending to be a Mac is iOS", () => expect(isIos(IPAD_AS_MAC, 5)).toBe(true));
  it("a real Mac is not", () => expect(isIos(IPAD_AS_MAC, 0)).toBe(false));
  it("Android is not", () => expect(isIos(ANDROID, 5)).toBe(false));
});

describe("decideInstallHint", () => {
  it("already installed -> nothing, on any platform", () => {
    expect(
      decideInstallHint({ ...base, standalone: true, userAgent: IPHONE, maxTouchPoints: 5 }),
    ).toBe("none");
    expect(
      decideInstallHint({ ...base, standalone: true, promptAvailable: true, userAgent: ANDROID }),
    ).toBe("none");
  });

  it("the browser offered a prompt -> a real button", () => {
    expect(decideInstallHint({ ...base, promptAvailable: true, userAgent: ANDROID })).toBe(
      "prompt",
    );
  });

  it("iOS has no prompt API -> the Share steps", () => {
    expect(decideInstallHint({ ...base, userAgent: IPHONE, maxTouchPoints: 5 })).toBe("ios-steps");
  });

  it("iOS but sign-in by code doesn't exist yet -> nothing", () => {
    expect(
      decideInstallHint({
        ...base,
        userAgent: IPHONE,
        maxTouchPoints: 5,
        iosSignInWorks: false,
      }),
    ).toBe("none");
  });

  // Firefox, or Chrome before it decides the site is installable, or a
  // desktop that already dismissed it: no button that cannot work.
  it("no prompt and not iOS -> nothing", () => {
    expect(decideInstallHint({ ...base, userAgent: ANDROID })).toBe("none");
  });
});
