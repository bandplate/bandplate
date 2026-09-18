// Light, dark, or whatever the device says.
//
// A preference of the BROWSER, not of the member: someone may want dark on the
// phone in a rehearsal room and light on the laptop at home, so this lives in a
// cookie rather than on the member row the way the language does. A cookie and
// not `localStorage` because the server has to know it before first paint: the
// attribute goes on `<html>` in the response, so there is no light flash before
// a script could run.
//
// Pure, and imported from both sides: `Layout.astro` renders with it and
// `/me`'s picker applies a choice in place with it, so the two can never
// disagree about what "dark" means.

export const THEMES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export const THEME_COOKIE_NAME = "bp_theme";
export const THEME_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The browser chrome colour for each ground. Same values as `--bp-bone` and
 * `--bp-lacquer` in `packages/ui/src/tokens/dubplate.css`; a `<meta>` cannot
 * read a custom property, so they are repeated here by hand.
 */
const GROUND = { light: "#f2e8d8", dark: "#150c07" } as const;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** What `<html data-theme>` carries. None for system: the media query decides. */
export function rootThemeAttribute(choice: ThemeChoice): "light" | "dark" | undefined {
  return choice === "system" ? undefined : choice;
}

export interface ThemeColorMeta {
  content: string;
  media?: string;
}

/**
 * The `<meta name="theme-color">` set. A pinned theme gets ONE tag with no
 * media query, or a dark-mode phone would paint a dark status bar over a page
 * the member asked to see light.
 */
export function themeColorMetas(choice: ThemeChoice): ThemeColorMeta[] {
  if (choice !== "system") {
    return [{ content: GROUND[choice] }];
  }
  return [
    { content: GROUND.light, media: "(prefers-color-scheme: light)" },
    { content: GROUND.dark, media: "(prefers-color-scheme: dark)" },
  ];
}

/** For `document.cookie`. Attributes match `setThemeCookie` on the server. */
export function themeCookieString(choice: ThemeChoice, secure: boolean): string {
  const base = `${THEME_COOKIE_NAME}=${choice}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  return secure ? `${base}; Secure` : base;
}
