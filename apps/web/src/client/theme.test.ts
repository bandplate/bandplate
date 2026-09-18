import { describe, expect, it } from "vitest";
import {
  THEME_COOKIE_NAME,
  isThemeChoice,
  rootThemeAttribute,
  themeColorMetas,
  themeCookieString,
} from "./theme.js";

describe("isThemeChoice", () => {
  it("accepts the three choices", () => {
    expect(isThemeChoice("light")).toBe(true);
    expect(isThemeChoice("dark")).toBe(true);
    expect(isThemeChoice("system")).toBe(true);
  });

  it("refuses anything else, including a missing value", () => {
    expect(isThemeChoice("sepia")).toBe(false);
    expect(isThemeChoice("")).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});

describe("rootThemeAttribute", () => {
  it("pins an explicit choice", () => {
    expect(rootThemeAttribute("light")).toBe("light");
    expect(rootThemeAttribute("dark")).toBe("dark");
  });

  // No attribute at all is what lets `prefers-color-scheme` decide; writing
  // "system" would match neither theme block and strand the page in light.
  it("leaves system to the media query", () => {
    expect(rootThemeAttribute("system")).toBeUndefined();
  });
});

describe("themeColorMetas", () => {
  it("one colour for a pinned theme, with no media query to overrule it", () => {
    expect(themeColorMetas("dark")).toEqual([{ content: "#150c07" }]);
    expect(themeColorMetas("light")).toEqual([{ content: "#f2e8d8" }]);
  });

  it("both colours, each behind its media query, for system", () => {
    expect(themeColorMetas("system")).toEqual([
      { content: "#f2e8d8", media: "(prefers-color-scheme: light)" },
      { content: "#150c07", media: "(prefers-color-scheme: dark)" },
    ]);
  });
});

describe("themeCookieString", () => {
  it("is readable by the server on every path for a year", () => {
    expect(themeCookieString("dark", false)).toBe(
      `${THEME_COOKIE_NAME}=dark; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });

  it("is Secure over https", () => {
    expect(themeCookieString("light", true)).toBe(
      `${THEME_COOKIE_NAME}=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });
});
