import type { Context } from "hono";
import type { AppEnv } from "./types.js";

/**
 * The member a request acts as, or `undefined` for a service token or nobody.
 * A private take is visible to exactly one member, so anything that is not a
 * member sees none — see `takesRepo.isVisibleTo`.
 */
export function viewerMemberId(c: Context<AppEnv>): string | undefined {
  const principal = c.get("principal");
  return principal?.kind === "member" ? principal.memberId : undefined;
}
