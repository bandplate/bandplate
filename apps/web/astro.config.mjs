import { readFile } from "node:fs/promises";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { checkCronWiring, cronsOf } from "./scripts/cron-wiring.ts";

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
// `cloudflare` (increment 7's Workers profile: `astro build` produces the
// Worker under `dist/server/` and its static assets under `dist/client/`,
// deployed with `wrangler deploy` — see `docs/deploy-cloudflare.md`). The
// Node profile's own config (`security.checkOrigin: false` and why, below)
// is unchanged either way.
//
// `imageService: "compile"` keeps Sharp (a native binary, unusable inside a
// Worker) out of the Worker bundle and needs no binding: images are
// transformed at build time only and served as-is at runtime. The adapter's
// default since 13, `cloudflare-binding`, would instead add an `IMAGES`
// binding that `wrangler deploy` provisions in the deployer's account. This
// app serves no optimized images through Astro's image pipeline, so neither
// choice changes what a member sees.
/** `dist/server/`, captured in `astro:config:done` for the cron-wiring check. */
let serverDir;

const adapterKind = process.env.BANDPLATE_ADAPTER === "cloudflare" ? "cloudflare" : "node";
const adapter =
  adapterKind === "cloudflare"
    ? cloudflare({
        imageService: "compile",
        // No entry-point option here any more: since `@astrojs/cloudflare`
        // 13 the Worker's entry is `wrangler.toml`'s `main`, which for this
        // app must be `./src/worker.ts` (the stock `fetch` plus a
        // `scheduled` handler for `[triggers] crons`; see that file's own
        // comment and `wrangler.toml.example`).
      })
    : node({ mode: "standalone" });

export default defineConfig({
  output: "server",
  devToolbar: { enabled: false },
  // Sign-in sessions are ours (the `bp_session` cookie, resolved in
  // `middleware.ts` against the `sessions` table); nothing reads
  // `Astro.session`. Left on, Astro wires a session driver anyway: the Node
  // adapter a filesystem one, and the Cloudflare adapter a `SESSION` KV
  // binding that `wrangler deploy` would auto-provision in the deployer's
  // account. Off means neither exists and no session code is bundled.
  session: false,
  adapter,
  // No `.assetsignore` hook any more. Up to `@astrojs/cloudflare` 12 the
  // server bundle was built INTO the assets directory (`dist/_worker.js/`,
  // plus `dist/_routes.json`), and without an ignore file `wrangler deploy`
  // uploaded auth logic, SQL and admin handlers as public static files; a
  // build hook wrote `.assetsignore` to stop that. Since 13 the Cloudflare
  // Vite plugin builds the Worker into `dist/server/` and the assets into
  // `dist/client/`, the only directory the generated
  // `dist/server/wrangler.json` points `assets.directory` at, and writes its
  // own `dist/client/.assetsignore` (`wrangler.json`, `.dev.vars`). Our old
  // hook would now overwrite that file with names that no longer exist.
  // Verified under `wrangler dev --local` on the 14.3.2 build: `/login` 200,
  // `/favicon.svg` 200 from assets, while `/_worker.js/index.js`,
  // `/_routes.json`, `/entry.mjs` and `/wrangler.json` are not assets at all
  // and fall through to the app, whose member guard redirects them to
  // `/login` (302).
  integrations: [
    preact({ compat: true }),
    // Fails the Cloudflare build when `wrangler.toml` declares a cron but the
    // built Worker has no `scheduled` handler, which is what a missing
    // `main` gives you, silently. See `scripts/cron-wiring.ts` for the decision and why.
    adapterKind === "cloudflare" && {
      name: "bandplate-cron-wiring",
      hooks: {
        "astro:config:done": ({ config }) => {
          serverDir = config.build.server;
        },
        "astro:build:done": async () => {
          const wranglerJson = JSON.parse(
            await readFile(new URL("wrangler.json", serverDir), "utf-8"),
          );
          const entrySource = await readFile(new URL("entry.mjs", serverDir), "utf-8");
          const result = checkCronWiring({ crons: cronsOf(wranglerJson), entrySource });
          if (!result.ok) {
            throw new Error(result.reason);
          }
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
  // `url.origin` does not follow the `Host`/`X-Forwarded-*` headers the
  // request arrived with (Astro only trusts those for hosts listed in
  // `security.allowedDomains`) — so in the *built* server behind a proxy
  // every real form POST (`Origin: https://bandplate.example`, say) gets
  // rejected with a 403 before it ever reaches a page. This does not
  // reproduce under `astro dev`. Re-verified on Astro 7.3.3 with the check
  // switched on: a POST with `Host: bandplate.example`, `X-Forwarded-Proto:
  // https` and the matching `Origin` got "Cross-site POST form submissions
  // are forbidden" (403).
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
