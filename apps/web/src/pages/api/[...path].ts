import type { APIRoute } from "astro";
import { getApiApp } from "../../server/app.js";

export const prerender = false;

// Hono routes inside @bandplate/api are declared relative (e.g. "/health"),
// but Astro mounts this catch-all under /api/*. Strip the /api prefix
// before delegating so Hono's router matches. The app itself (env reads,
// db connection, mailer selection) is built once by the shared composition
// root in `server/app.ts` — see that module for why env validation and the
// SMTP import are deferred rather than run at module load.
export const ALL: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Required by undici when forwarding a streaming body.
    (init as { duplex?: string }).duplex = "half";
  }

  const app = await getApiApp();
  // Workers profile only: forwarding the `ExecutionContext`
  // (`locals.cfContext`, set by `@astrojs/cloudflare`) is what makes Hono
  // populate `c.executionCtx` inside the mounted app — required for
  // `POST /auth/login`'s `c.executionCtx.waitUntil(...)` (see
  // `AuthRouteDeps.enableDeferredMailSend` in `@bandplate/api`). No `env`:
  // the API never reads `c.env`, its dependencies are injected. Under the
  // Node adapter `locals.cfContext` is `undefined`, so `app.fetch` is
  // called with just the request, exactly as before.
  if (locals.cfContext) {
    return app.fetch(new Request(url, init), undefined, locals.cfContext);
  }
  return app.fetch(new Request(url, init));
};
