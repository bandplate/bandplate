import { writeFile } from "node:fs/promises";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Adapter selected per build via `BANDPLATE_ADAPTER` — `node` (default,
// what the user runs today: `astro build && node dist/start.mjs`) or
// `cloudflare` (increment 7's Workers profile: `astro build` produces a
// Worker script under `dist/_worker.js/`, deployed with `wrangler deploy`
// — see `docs/deploy-cloudflare.md`). Nothing else in this file branches
// on it: the Node profile's own config (`security.checkOrigin: false` and
// why, below) is unchanged either way.
//
// `imageService: "compile"` avoids pulling in Sharp (a native binary,
// unusable inside a Worker) for the Cloudflare build; this app serves no
// remote/optimized images through Astro's image pipeline, so the
// compile-time-only service is a strict downgrade in capability we don't
// use, not a behavior change.
const adapterKind = process.env.BANDPLATE_ADAPTER === "cloudflare" ? "cloudflare" : "node";
const adapter =
  adapterKind === "cloudflare"
    ? cloudflare({ imageService: "compile", platformProxy: { enabled: true } })
    : node({ mode: "standalone" });

export default defineConfig({
  output: "server",
  adapter,
  integrations: [
    preact({ compat: true }),
    // CRITICAL: without this, the entire server bundle (`dist/_worker.js/`
    // — auth logic, SQL, CSRF handling, admin handlers) uploads as PUBLIC
    // STATIC ASSETS on every Workers deploy, served *before* the Worker
    // itself gets a chance to run. Astro's Cloudflare adapter emits
    // `dist/_routes.json` (Pages-mode routing metadata) but no
    // `.assetsignore`, and `wrangler`'s asset-upload ignore list is
    // hard-coded to `.assetsignore`/`_redirects`/`_headers` only — so
    // `_worker.js/**` and `_routes.json` get uploaded and served as plain
    // files unless something tells Wrangler not to. This writes that file
    // as part of the build itself so it can't be forgotten by a
    // self-deployer. Verified: `GET /_worker.js/index.js` and
    // `GET /_routes.json` both 404 under `wrangler dev --local` with this
    // in place (previously both returned 200 with real source/JSON), and
    // the app still serves every route correctly.
    adapterKind === "cloudflare" && {
      name: "bandplate-cloudflare-assetsignore",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          await writeFile(new URL(".assetsignore", dir), "_worker.js\n_routes.json\n");
        },
      },
    },
  ].filter(Boolean),
  vite: {
    plugins: [
      tailwindcss(),
      // Swaps `server/app.ts` (the Node composition root — SMTP, libSQL)
      // for `server/app.workers.ts` (D1, http mailer) for THIS build's
      // Vite graph only, when targeting Cloudflare. Every importer keeps
      // writing the same relative `.../server/app.js` specifier — a
      // `resolveId` hook (not a plain alias: Rollup's alias `replacement`
      // for a RegExp `find` substitutes only the matched substring, which
      // isn't what a full-file swap needs) intercepts any request whose
      // specifier ends with `server/app.js`, regardless of each
      // importer's relative depth, and resolves it straight to the
      // Workers file instead. See `app.workers.ts`'s doc comment for why
      // this file split exists at all (keeping nodemailer's `node:*`
      // imports fully out of the Worker bundle, not just unreachable at
      // runtime).
      adapterKind === "cloudflare" && {
        name: "bandplate-workers-app-runtime",
        enforce: "pre",
        resolveId(source, importer) {
          if (/(^|\/)server\/app\.js$/.test(source) && importer) {
            return new URL("./src/server/app.workers.ts", import.meta.url).pathname;
          }
          return null;
        },
      },
    ].filter(Boolean),
  },
  // Astro's built-in Origin/CSRF guard (`security.checkOrigin`, on by
  // default since Astro 5) compares `request.headers.get("origin")`
  // against `url.origin`. Under the standalone Node adapter used here,
  // `url.origin` resolves to `http://localhost` regardless of the `Host`
  // header the request actually arrived on — so in the *built* server
  // every real form POST (`Origin: https://bandplate.example`, say) gets
  // rejected with a 403 before it ever reaches a page. This does not
  // reproduce under `astro dev`, which resolves `url.origin` correctly.
  //
  // We disable Astro's check and rely instead on our own
  // `server/csrf.ts#isSameOrigin`, which compares the `Origin` header
  // against `BANDPLATE_APP_ORIGIN` (the configured public origin, not a
  // value derived from the request/adapter). Every mutating page route
  // calls it explicitly before acting on a POST — verified by grepping
  // every `.astro` file that branches on `request.method`:
  // login/index, login/[token], setup, logout, admin/members/index,
  // admin/members/[id]/revoke-sessions, admin/instruments/index,
  // admin/instruments/[id]/archive, admin/tokens/index,
  // admin/tokens/[id]/revoke — all ten call `isSameOrigin` before
  // mutating. The one route that does *not* go through this shared
  // handler, `pages/api/[...path].ts`, delegates to the Hono app in
  // `@bandplate/api`, which has its own independent
  // `originCheckMiddleware` (also keyed off `BANDPLATE_APP_ORIGIN`, not
  // adapter-derived `url.origin`) — see `packages/api/src/index.ts`.
  // So disabling Astro's check does not leave any mutating route
  // unguarded.
  security: {
    checkOrigin: false,
  },
});
