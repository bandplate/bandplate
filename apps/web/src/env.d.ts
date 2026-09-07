/// <reference path="../.astro/types.d.ts" />
import type { MemberPrincipal } from "@bandplate/core";
import type { CloudflareEnv } from "./server/config.worker.js";

declare global {
  namespace App {
    interface Locals {
      /** Resolved by `src/middleware.ts` from the `bp_session` cookie. `undefined` for an anonymous visitor. */
      principal: MemberPrincipal | undefined;
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
