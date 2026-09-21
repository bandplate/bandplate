/// <reference path="../.astro/types.d.ts" />
import type { MemberPrincipal } from "@bandplate/core";
import type { Locale } from "@bandplate/i18n";

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
       * Set by `@astrojs/cloudflare`'s request handler, present only under
       * the Cloudflare adapter (`BANDPLATE_ADAPTER=cloudflare`, see
       * `astro.config.mjs`), `undefined` under the Node adapter. The real
       * `ExecutionContext`: `waitUntil` takes the login-link mail send out of
       * the request path (see `pages/login/index.astro`). Bindings are not
       * here any more; `app.workers.ts` reads them from `cloudflare:workers`.
       */
      cfContext?: import("@cloudflare/workers-types").ExecutionContext;
    }
  }
}
