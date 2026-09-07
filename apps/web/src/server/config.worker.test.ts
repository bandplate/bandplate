// Fix round 1, Critical 1: `wrangler.toml`'s `[vars]` ships with
// placeholder values that pass a plain `.min(1)` string check silently.
// The first real symptom is a same-origin check 403ing every mutating
// request with no clue why — see `config.worker.ts`'s own comment. Every
// test here asserts a specific failure (a thrown `ConfigError` whose
// message names the exact variable and, for the placeholder cases,
// mentions the shipped placeholder), not just "it throws" — mirroring
// `config.test.ts`'s own stated bar for what a passing assertion here is
// supposed to mean.
import { describe, expect, it } from "vitest";
import { ConfigError } from "./config.js";
import { type CloudflareEnv, loadWorkersConfig } from "./config.worker.js";

const VALID_ENV: CloudflareEnv = {
  // A minimal fake D1 binding — `loadWorkersConfig` only checks
  // truthiness before delegating everything else to zod.
  DB: {} as CloudflareEnv["DB"],
  BANDLIB_APP_ORIGIN: "https://bandlib.mydomain.example.org",
  BANDLIB_BOOTSTRAP_TOKEN: "test-bootstrap-token",
  MAIL_PROVIDER: "resend",
  MAIL_API_KEY: "test-mail-key",
  MAIL_FROM: "bandlib@mydomain.example.org",
  S3_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  S3_PUBLIC_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
  S3_BUCKET: "bandlib",
  S3_REGION: "auto",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

describe("loadWorkersConfig", () => {
  it("accepts a fully-configured, non-placeholder env", () => {
    const config = loadWorkersConfig(VALID_ENV);
    expect(config.appOrigin).toBe(VALID_ENV.BANDLIB_APP_ORIGIN);
    expect(config.s3.endpoint).toBe(VALID_ENV.S3_ENDPOINT);
  });

  it("fails, naming DB, when the D1 binding is missing", () => {
    const env = { ...VALID_ENV, DB: undefined as unknown as CloudflareEnv["DB"] };
    expect(() => loadWorkersConfig(env)).toThrow(ConfigError);
    expect(() => loadWorkersConfig(env)).toThrow(/DB/);
  });

  // --- CRITICAL 1: placeholder [vars] must fail fast, not 403 silently ---

  it("fails, naming BANDLIB_APP_ORIGIN, when it is left at the shipped wrangler.toml placeholder", () => {
    const env = { ...VALID_ENV, BANDLIB_APP_ORIGIN: "https://bandlib.example" };
    expect(() => loadWorkersConfig(env)).toThrow(ConfigError);
    expect(() => loadWorkersConfig(env)).toThrow(/BANDLIB_APP_ORIGIN/);
    expect(() => loadWorkersConfig(env)).toThrow(/placeholder/);
  });

  it("fails, naming MAIL_FROM, when it is left at the shipped wrangler.toml placeholder", () => {
    const env = { ...VALID_ENV, MAIL_FROM: "bandlib@bandlib.example" };
    expect(() => loadWorkersConfig(env)).toThrow(/MAIL_FROM/);
    expect(() => loadWorkersConfig(env)).toThrow(/placeholder/);
  });

  it("fails, naming S3_ENDPOINT, when it is left at the shipped <account-id> placeholder", () => {
    const env = { ...VALID_ENV, S3_ENDPOINT: "https://<account-id>.r2.cloudflarestorage.com" };
    expect(() => loadWorkersConfig(env)).toThrow(/S3_ENDPOINT/);
    expect(() => loadWorkersConfig(env)).toThrow(/placeholder/);
  });

  it("fails, naming S3_PUBLIC_ENDPOINT, when it is left at the shipped <account-id> placeholder", () => {
    const env = {
      ...VALID_ENV,
      S3_PUBLIC_ENDPOINT: "https://<account-id>.r2.cloudflarestorage.com",
    };
    expect(() => loadWorkersConfig(env)).toThrow(/S3_PUBLIC_ENDPOINT/);
    expect(() => loadWorkersConfig(env)).toThrow(/placeholder/);
  });

  it("does not reject a real domain that doesn't match the shipped placeholder shape", () => {
    const env = { ...VALID_ENV, BANDLIB_APP_ORIGIN: "https://bandlib.io" };
    expect(() => loadWorkersConfig(env)).not.toThrow();
  });
});
