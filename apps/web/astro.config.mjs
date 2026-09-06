import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [preact({ compat: true })],
  vite: {
    plugins: [tailwindcss()],
  },
  // Astro's built-in Origin/CSRF guard (`security.checkOrigin`, on by
  // default since Astro 5) compares `request.headers.get("origin")`
  // against `url.origin`. Under the standalone Node adapter used here,
  // `url.origin` resolves to `http://localhost` regardless of the `Host`
  // header the request actually arrived on — so in the *built* server
  // every real form POST (`Origin: https://bandlib.example`, say) gets
  // rejected with a 403 before it ever reaches a page. This does not
  // reproduce under `astro dev`, which resolves `url.origin` correctly.
  //
  // We disable Astro's check and rely instead on our own
  // `server/csrf.ts#isSameOrigin`, which compares the `Origin` header
  // against `BANDLIB_APP_ORIGIN` (the configured public origin, not a
  // value derived from the request/adapter). Every mutating page route
  // calls it explicitly before acting on a POST — verified by grepping
  // every `.astro` file that branches on `request.method`:
  // login/index, login/[token], setup, logout, admin/members/index,
  // admin/members/[id]/revoke-sessions, admin/instruments/index,
  // admin/instruments/[id]/archive, admin/tokens/index,
  // admin/tokens/[id]/revoke — all ten call `isSameOrigin` before
  // mutating. The one route that does *not* go through this shared
  // handler, `pages/api/[...path].ts`, delegates to the Hono app in
  // `@bandlib/api`, which has its own independent
  // `originCheckMiddleware` (also keyed off `BANDLIB_APP_ORIGIN`, not
  // adapter-derived `url.origin`) — see `packages/api/src/index.ts`.
  // So disabling Astro's check does not leave any mutating route
  // unguarded.
  security: {
    checkOrigin: false,
  },
});
