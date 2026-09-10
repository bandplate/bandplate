/// <reference path="../.astro/types.d.ts" />
import type { MemberPrincipal } from "@bandplate/core";
import type { Locale } from "@bandplate/i18n";
import type { CloudflareEnv } from "./server/config.worker.js";

declare global {
  namespace App {
    interface Locals {
      /** Resolved by `src/middleware.ts` from the `bp_session` cookie. `undefined` for an anonymous visitor. */
      principal: MemberPrincipal | undefined;
      /**
       * The language to render this request in, resolved by `src/middleware.ts`.
       *
       * Never `undefined`: a request with no member, no cookie and no
       * `Accept-Language` still has a language, and it is English. Pages read
       * this rather than reaching for the principal, because the three
       * signed-out pages have no principal and still have to be readable.
       */
      locale: Locale;
      /**
       * Set by `@astrojs/cloudflare`'s own middleware — present only
       * under the Cloudflare adapter (`BANDPLATE_ADAPTER=cloudflare`, see
       * `astro.config.mjs`), `undefined` under the Node adapter. `env` is
       * this Worker's bindings/secrets (see `CloudflareEnv`); `ctx` is the
       * real `ExecutionContext` (`ctx.waitUntil`, used to take the
       * login-link mail send out of the request path — see
       * `pages/login/index.astro`).
       */
      runtime?: {
        env: CloudflareEnv;
        ctx: import("@cloudflare/workers-types").ExecutionContext;
      };
    }
  }
}
