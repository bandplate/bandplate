/// <reference path="../.astro/types.d.ts" />
import type { MemberPrincipal } from "@bandlib/core";

declare global {
  namespace App {
    interface Locals {
      /** Resolved by `src/middleware.ts` from the `bl_session` cookie. `undefined` for an anonymous visitor. */
      principal: MemberPrincipal | undefined;
    }
  }
}
