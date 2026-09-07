import {
  DEFAULT_TRUSTED_PROXY_DEPTH,
  LOGIN_EMAIL_LIMIT,
  LOGIN_EMAIL_WINDOW_MS,
  LOGIN_IP_LIMIT,
  LOGIN_IP_WINDOW_MS,
  extractClientIp,
} from "@bandlib/api";
// `/login` page logic — extracted into a plain function so it's testable
// without booting Astro. Reuses the exact rate-limit policy the JSON API's
// `/auth/login` route uses (see `packages/api/src/routes/auth.ts`) and the
// same `requestLogin` core service, which is what actually enforces
// "always resolve the same way for an unknown/disabled/whitelisted
// address" — this function has no branch to leak that signal even if it
// wanted to.
import type { AuthDeps, RateLimiter } from "@bandlib/core";
import { requestLogin } from "@bandlib/core";
import { z } from "zod";

const emailSchema = z.string().trim().min(1).max(320);

export type LoginPostResult =
  | { kind: "sent" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "invalid"; error: string };

export interface LoginPostDeps {
  auth: AuthDeps;
  rateLimiter: RateLimiter;
  appOrigin: string;
  trustedProxyDepth?: number;
  /**
   * Workers profile only — see `requestLogin`'s `deferMailSend` doc
   * comment in `@bandlib/core`. The caller (`login/index.astro`) builds
   * this per-request from `Astro.locals.runtime.ctx.waitUntil`, which is
   * only available under the Cloudflare adapter. Left unset on the
   * Node/container profile.
   */
  deferMailSend?: (send: () => Promise<void>) => void;
}

export async function handleLoginPost(
  deps: LoginPostDeps,
  formData: FormData,
  headers: Pick<Headers, "get">,
): Promise<LoginPostResult> {
  const raw = formData.get("email");
  const parsed = emailSchema.safeParse(typeof raw === "string" ? raw : "");
  if (!parsed.success) {
    return { kind: "invalid", error: "Enter your email address." };
  }

  const ip = extractClientIp(headers, deps.trustedProxyDepth ?? DEFAULT_TRUSTED_PROXY_DEPTH);
  const emailKey = `login:email:${parsed.data.toLowerCase()}`;
  const ipKey = `login:ip:${ip}`;

  const [emailLimit, ipLimit] = await Promise.all([
    deps.rateLimiter.check(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW_MS),
    deps.rateLimiter.check(ipKey, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    const retryAfterMs = Math.max(emailLimit.retryAfterMs, ipLimit.retryAfterMs);
    return { kind: "rate_limited", retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  await requestLogin({ ...deps.auth, deferMailSend: deps.deferMailSend }, parsed.data, {
    requestedIp: ip === "unknown" ? null : ip,
    buildLoginUrl: (rawToken) => `${deps.appOrigin}/login/${rawToken}`,
  });

  return { kind: "sent" };
}
