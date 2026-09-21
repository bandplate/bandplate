// @bandplate/mail — Mailer implementations. This barrel is Workers-safe: it
// never imports `smtp.ts` (the only Node-dependent module in this package),
// directly or transitively. See `smtp.ts`'s doc comment and `factory.ts`.

export * from "./capturing.js";
export * from "./console.js";
export * from "./factory.js";
export * from "./http.js";
export * from "./null.js";
