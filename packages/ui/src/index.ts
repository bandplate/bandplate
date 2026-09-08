// @bandplate/ui — design token layer.
//
// This package's primary content is CSS (see src/tokens/). Consumers import
// the token stylesheets directly, e.g.:
//   import "@bandplate/ui/tokens/theme.css";
//
// This module is a placeholder for future JS/TS token helpers (e.g. typed
// theme name constants) and keeps the package a valid TS project.
export const THEME_NAMES = ["light", "dark"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
