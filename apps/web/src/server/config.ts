// Composition-root configuration — the only place `apps/web` reads
// `process.env` directly. Validated once, with zod, at first access
// (`loadConfig()` is memoized); every other module gets a typed, already-
// validated `RuntimeConfig`. Every failure message names the offending
// environment variable, per the task-4 brief ("failing fast at startup with
// a message naming the offending variable").
//
// This file is Node-only (reads `process.env`) — that's fine, it's the
// composition root the brief calls out as the one place `apps/web` may use
// Node APIs. Nothing here is imported by `packages/core`/`db`/`api`.
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  auth?: { user: string; pass: string };
}

export interface RuntimeConfig {
  databaseUrl: string;
  appOrigin: string;
  bootstrapToken: string;
  cookieSecure: boolean;
  trustedProxyDepth: number;
  allowDevMailer: boolean;
  smtp?: SmtpConfig;
  isProduction: boolean;
}

const BOOLEAN_STRING = z
  .string()
  .refine((v) => v === "true" || v === "false", { message: 'must be "true" or "false"' });

const NON_NEGATIVE_INT_STRING = z
  .string()
  .refine((v) => /^\d+$/.test(v), { message: "must be a non-negative integer" });

const EnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    BANDLIB_DATABASE_URL: z.string().trim().min(1, "is required"),
    BANDLIB_APP_ORIGIN: z.string().trim().min(1).optional(),
    BANDLIB_BOOTSTRAP_TOKEN: z.string().trim().min(1, "is required"),
    BANDLIB_COOKIE_SECURE: BOOLEAN_STRING.optional(),
    BANDLIB_TRUSTED_PROXY_DEPTH: NON_NEGATIVE_INT_STRING.optional(),
    BANDLIB_SMTP_HOST: z.string().trim().min(1).optional(),
    BANDLIB_SMTP_PORT: NON_NEGATIVE_INT_STRING.optional(),
    BANDLIB_SMTP_USER: z.string().trim().min(1).optional(),
    BANDLIB_SMTP_PASS: z.string().min(1).optional(),
    BANDLIB_SMTP_FROM: z.string().trim().min(1).optional(),
    BANDLIB_SMTP_SECURE: BOOLEAN_STRING.optional(),
    BANDLIB_ALLOW_DEV_MAILER: BOOLEAN_STRING.optional(),
  })
  .superRefine((env, ctx) => {
    const isProduction = env.NODE_ENV === "production";

    // BANDLIB_APP_ORIGIN silently defaulted to localhost in every
    // environment used to fail closed (every mutating browser request 403s
    // on the API's Origin check) with no clue why. It's now required
    // outright in production; dev/test keep the localhost default.
    if (isProduction && !env.BANDLIB_APP_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BANDLIB_APP_ORIGIN"],
        message:
          "is required in production (NODE_ENV=production) — set it to the exact public " +
          "origin this app is served from, e.g. https://bandlib.example. Without it, every " +
          "mutating request fails the API's Origin/CSRF check with a 403 and no obvious cause.",
      });
    }

    // SMTP is all-or-nothing: host/port/from are the minimum needed to
    // construct a transport, and a half-configured SMTP block is almost
    // certainly a typo'd variable name rather than an intentional setup.
    const smtpFields = {
      BANDLIB_SMTP_HOST: env.BANDLIB_SMTP_HOST,
      BANDLIB_SMTP_PORT: env.BANDLIB_SMTP_PORT,
      BANDLIB_SMTP_FROM: env.BANDLIB_SMTP_FROM,
    };
    const smtpProvided = Object.values(smtpFields).some((v) => v !== undefined);
    const smtpComplete = Object.values(smtpFields).every((v) => v !== undefined);
    if (smtpProvided && !smtpComplete) {
      for (const [name, value] of Object.entries(smtpFields)) {
        if (value === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message:
              "is required once any BANDLIB_SMTP_* variable is set — SMTP config is all-or-nothing " +
              "(BANDLIB_SMTP_HOST, BANDLIB_SMTP_PORT, BANDLIB_SMTP_FROM).",
          });
        }
      }
    }
    if ((env.BANDLIB_SMTP_USER === undefined) !== (env.BANDLIB_SMTP_PASS === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BANDLIB_SMTP_USER"],
        message: "BANDLIB_SMTP_USER and BANDLIB_SMTP_PASS must be set together, or not at all.",
      });
    }

    // The app is email-only after bootstrap. Refuse to start with no way to
    // deliver login links at all, rather than silently starting broken.
    const allowDevMailer = env.BANDLIB_ALLOW_DEV_MAILER === "true";
    if (!smtpComplete && !allowDevMailer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BANDLIB_ALLOW_DEV_MAILER"],
        message:
          "No mailer is configured. The app has no way to deliver login links after bootstrap, " +
          "which is a lockout waiting to happen. Set BANDLIB_SMTP_HOST/PORT/FROM (and optionally " +
          "USER/PASS) for a real deployment, or BANDLIB_ALLOW_DEV_MAILER=true for local dev only " +
          "(prints login links to the console instead of emailing them).",
      });
    }
  });

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "Invalid configuration.";
  }
  const path = issue.path.join(".") || "(unknown)";
  return `Invalid configuration: ${path} ${issue.message}`;
}

let cached: RuntimeConfig | undefined;

/**
 * Parse and validate `process.env` into a `RuntimeConfig`. Memoized — the
 * environment is read once per process. Throws `ConfigError` (message names
 * the offending variable) on the first problem found.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  if (cached) {
    return cached;
  }

  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(formatZodError(parsed.error));
  }
  const data = parsed.data;
  const isProduction = data.NODE_ENV === "production";

  const smtp: SmtpConfig | undefined =
    data.BANDLIB_SMTP_HOST && data.BANDLIB_SMTP_PORT && data.BANDLIB_SMTP_FROM
      ? {
          host: data.BANDLIB_SMTP_HOST,
          port: Number(data.BANDLIB_SMTP_PORT),
          secure: data.BANDLIB_SMTP_SECURE === "true",
          from: data.BANDLIB_SMTP_FROM,
          auth:
            data.BANDLIB_SMTP_USER && data.BANDLIB_SMTP_PASS
              ? { user: data.BANDLIB_SMTP_USER, pass: data.BANDLIB_SMTP_PASS }
              : undefined,
        }
      : undefined;

  cached = {
    databaseUrl: data.BANDLIB_DATABASE_URL,
    appOrigin: data.BANDLIB_APP_ORIGIN ?? "http://localhost:4321",
    bootstrapToken: data.BANDLIB_BOOTSTRAP_TOKEN,
    cookieSecure: data.BANDLIB_COOKIE_SECURE !== "false",
    trustedProxyDepth: data.BANDLIB_TRUSTED_PROXY_DEPTH
      ? Number(data.BANDLIB_TRUSTED_PROXY_DEPTH)
      : 1,
    allowDevMailer: data.BANDLIB_ALLOW_DEV_MAILER === "true",
    smtp,
    isProduction,
  };
  return cached;
}

/** Test-only: clear the memoized config so a test can reload with different env. */
export function resetConfigForTesting(): void {
  cached = undefined;
}
