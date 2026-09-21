import { writeFile } from "node:fs/promises";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Load `.env` into `process.env`, not just `import.meta.env`.
//
// `server/config.ts` validates `process.env` — it has to, because the same
// code runs under `node dist/start.mjs` where there is no Vite. But Vite only
// exposes `.env` through `import.meta.env`, and only keys carrying its public
// prefix, so under `astro dev` a perfectly good `.env` reached nothing and
// startup failed with "Invalid configuration: BANDPLATE_DATABASE_URL Required".
// `.env.example` claimed since it was written that Astro loads this file
// automatically; this is what makes that claim true.
//
// `process.loadEnvFile` (Node >= 20.12) rather than a hand-rolled parser or a
// `vite` import: it is the same parser `node --env-file` uses, it is already
// in the runtime, and — verified, not assumed — it does NOT overwrite
// variables already present in the environment. So an explicit
// `BANDPLATE_DATABASE_URL=... pnpm dev` still wins over the file.
//
// Missing `.env` is the normal case in a deployment, where configuration comes
// from the real environment, so absence is not an error.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(new URL(".env", import.meta.url).pathname);
  } catch {
    // No .env here — configuration comes from the environment.
  }
}

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
    ? cloudflare({
        imageService: "compile",
        platformProxy: { enabled: true },
        // Custom entry (`src/worker.ts`) instead of the adapter's stock
        // one, so the built Worker also exports a `scheduled` handler for
        // `wrangler.toml`'s `[triggers] crons` (the notification tick,
        // every 10 minutes — see `worker.ts`'s own doc comment and
        // `docs/deploy-cloudflare.md`). It reproduces the stock `fetch`
        // handler verbatim, so ordinary request handling is unchanged.
        workerEntryPoint: { path: "./src/worker.ts" },
      })
    : node({ mode: "standalone" });

export default defineConfig({
  output: "server",
  devToolbar: { enabled: false },
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
    // Optimized up front, not discovered when the first island imports it.
    // A late discovery makes Vite re-optimize mid-session, and the open page
    // then fails every island with "504 Outdated Optimize Dep".
    optimizeDeps: {
      include: ["lucide-preact"],
    },
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
