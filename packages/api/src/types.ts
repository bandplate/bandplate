import type { Principal } from "@bandlib/core";

/**
 * Hono's `Env` generic for this app: the one piece of per-request state the
 * middleware chain shares with route handlers is the resolved principal
 * (`undefined` for an anonymous caller).
 */
export interface AppEnv {
  Variables: {
    principal: Principal | undefined;
  };
}
