// The one thing this app takes from the `cloudflare:workers` runtime module:
// the Worker's bindings, which `@astrojs/cloudflare` 13+ no longer passes
// per request as `locals.runtime.env`. Declared here rather than by pulling
// in `@cloudflare/workers-types`' own declaration, because that file's
// globals (`Request`, `Response`, `caches`, ...) would replace the DOM ones
// every page and island in this app is typed against. Only
// `server/app.workers.ts` imports it, and only the Cloudflare build ever
// includes that file.
declare module "cloudflare:workers" {
  export const env: import("./server/config.worker.js").CloudflareEnv;
}
