import { createApp } from "@bandlib/api";
import type { APIRoute } from "astro";

export const prerender = false;

const app = createApp();

// Hono routes inside @bandlib/api are declared relative (e.g. "/health"),
// but Astro mounts this catch-all under /api/*. Strip the /api prefix
// before delegating so Hono's router matches.
export const ALL: APIRoute = async ({ request }) => {
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

  return app.fetch(new Request(url, init));
};
