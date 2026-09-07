// Workers-profile configuration — the counterpart to `config.ts` (which
// reads `process.env`, the Node/container profile's only source of
// truth). Under `@astrojs/cloudflare`, bindings and secrets arrive per
// request as `context.locals.runtime.env` — there is no `process.env`
// bag with bindings on it — so this validates that object shape instead.
// Both parse into the exact same `RuntimeConfig` (imported, not
// redeclared) that `server/app.ts`'s composition root already consumes,
// so nothing downstream (the composition root, `AppDeps`, every repo/
// route) needs to know which profile built it.
import { z } from "zod";
import { ConfigError, type RuntimeConfig } from "./config.js";

/**
 * The bindings/vars this Worker declares in `wrangler.toml` — see
 * `docs/deploy-cloudflare.md` for what a self-deployer sets. `DB` is the
 * one real binding (D1); everything else is a plain secret string,
 * deliberately — R2 is reached over its S3-compatible endpoint via
 * `@bandplate/storage`'s `S3Storage`, never the R2 binding (see that
 * package's own doc comment on why), and mail goes through
 * `@bandplate/mail`'s `createHttpMailer`, never SMTP (Workers has no TCP
 * sockets). Both need only string secrets, which is exactly what
 * `wrangler secret put` sets.
 */
export interface CloudflareEnv {
  DB: import("@cloudflare/workers-types").D1Database;
  BANDPLATE_APP_ORIGIN?: string;
  BANDPLATE_BOOTSTRAP_TOKEN: string;
  BANDPLATE_TRUSTED_PROXY_DEPTH?: string;
  MAIL_PROVIDER?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  S3_ENDPOINT: string;
  S3_PUBLIC_ENDPOINT: string;
  S3_BUCKET: string;
  S3_REGION: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
}

export interface WorkersRuntimeConfig extends RuntimeConfig {
  mail: { provider: "resend" | "postmark"; apiKey: string; from: string };
}

// CRITICAL: `wrangler.toml`'s `[vars]` ships with placeholder values
// (`https://bandplate.example`, `bandplate@bandplate.example`,
// `https://<account-id>.r2.cloudflarestorage.com`) that a self-deployer
// must replace. Every one of them is a non-empty, well-formed-looking
// string, so a plain `.min(1)` (or even the origin-shape check above)
// passes them straight through — and the *first* symptom is not an
// error, it's a same-origin check silently rejecting every form POST
// (`isSameOrigin` compares the real `Origin` header against a
// `bandplate.example` that never arrives), which looks exactly like a
// working app whose submit buttons just don't do anything. Refuse to
// start on the known placeholder shapes instead, naming the offending
// variable — the same fail-fast treatment every other misconfiguration
// here already gets.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  // `bandplate.example` / `bandplate@bandplate.example` — the doc's own
  // "e.g." example values, verbatim, left uncustomized.
  /\bbandplate\.example\b/i,
  // `<account-id>` and similar angle-bracket template slots.
  /<[a-z0-9_-]+>/i,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const NOT_A_PLACEHOLDER = {
  message:
    "is still set to the placeholder value shipped in wrangler.toml — replace it with your " +
    "real value before deploying (see docs/deploy-cloudflare.md's numbered [vars] step). " +
    "Left as-is, this fails silently instead: e.g. a placeholder BANDPLATE_APP_ORIGIN makes " +
    "every form POST 403 with no visible error.",
};

const EnvSchema = z.object({
  BANDPLATE_APP_ORIGIN: z
    .string()
    .trim()
    .min(1)
    .refine(
      (v) => {
        try {
          return new URL(v).origin === v;
        } catch {
          return false;
        }
      },
      { message: "must be a bare origin — scheme + host only, e.g. https://bandplate.example" },
    )
    .refine((v) => !isPlaceholder(v), NOT_A_PLACEHOLDER),
  BANDPLATE_BOOTSTRAP_TOKEN: z.string().trim().min(1, "is required"),
  BANDPLATE_TRUSTED_PROXY_DEPTH: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v), { message: "must be a non-negative integer" })
    .optional(),
  // Every Workers deploy is public-internet-facing behind Cloudflare's
  // own TLS-terminating edge, so unlike the Node profile (which has a
  // non-TLS local-dev mode), the session cookie is always `Secure` here —
  // no `BANDPLATE_COOKIE_SECURE` escape hatch to misconfigure.
  MAIL_PROVIDER: z.enum(["resend", "postmark"], {
    errorMap: () => ({ message: 'is required and must be "resend" or "postmark"' }),
  }),
  MAIL_API_KEY: z.string().min(1, "is required — the app has no non-email way in after bootstrap"),
  MAIL_FROM: z
    .string()
    .trim()
    .min(1, "is required")
    .refine((v) => !isPlaceholder(v), NOT_A_PLACEHOLDER),
  S3_ENDPOINT: z
    .string()
    .trim()
    .min(1, "is required")
    .refine((v) => !isPlaceholder(v), NOT_A_PLACEHOLDER),
  S3_PUBLIC_ENDPOINT: z
    .string()
    .trim()
    .min(1, "is required")
    .refine((v) => !isPlaceholder(v), NOT_A_PLACEHOLDER),
  S3_BUCKET: z.string().trim().min(1, "is required"),
  S3_REGION: z.string().trim().min(1, 'is required — use "auto" for R2'),
  S3_ACCESS_KEY_ID: z.string().trim().min(1, "is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "is required"),
});

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid configuration.";
  }
  const path = issue.path.join(".") || "(unknown)";
  return `Invalid configuration: ${path} ${issue.message}`;
}

/**
 * Parses `env` (from `context.locals.runtime.env`) into a
 * `WorkersRuntimeConfig`. Not memoized here — `server/app.ts`'s
 * `initWorkersRuntime` is what memoizes the built runtime, once per
 * isolate (env bindings are stable for the life of a deployment, so
 * re-validating on every cold start of the same isolate would be
 * redundant but never wrong; this function itself stays a pure parse).
 */
export function loadWorkersConfig(env: CloudflareEnv): WorkersRuntimeConfig {
  if (!env.DB) {
    throw new ConfigError(
      'Invalid configuration: DB is required — no D1 binding named "DB" found. ' +
        "Check wrangler.toml's [[d1_databases]] entry.",
    );
  }
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(formatZodError(parsed.error));
  }
  const data = parsed.data;
  return {
    // No `databaseUrl` on Workers — the D1 binding IS the connection,
    // there's no libSQL URL to speak of. `RuntimeConfig.databaseUrl` is
    // unused by the Workers composition root; kept only so this satisfies
    // the shared `RuntimeConfig` shape without a second interface.
    databaseUrl: "",
    appOrigin: data.BANDPLATE_APP_ORIGIN,
    bootstrapToken: data.BANDPLATE_BOOTSTRAP_TOKEN,
    cookieSecure: true,
    trustedProxyDepth: data.BANDPLATE_TRUSTED_PROXY_DEPTH
      ? Number(data.BANDPLATE_TRUSTED_PROXY_DEPTH)
      : 1,
    allowDevMailer: false,
    smtp: undefined,
    s3: {
      endpoint: data.S3_ENDPOINT,
      publicEndpoint: data.S3_PUBLIC_ENDPOINT,
      bucket: data.S3_BUCKET,
      region: data.S3_REGION,
      accessKeyId: data.S3_ACCESS_KEY_ID,
      secretAccessKey: data.S3_SECRET_ACCESS_KEY,
    },
    isProduction: true,
    mail: { provider: data.MAIL_PROVIDER, apiKey: data.MAIL_API_KEY, from: data.MAIL_FROM },
  };
}
