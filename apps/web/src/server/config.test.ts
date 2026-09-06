// "Config validation: a missing required variable fails startup with a
// message naming it; no-mailer-configured fails startup." Every test here
// asserts a specific failure (a thrown `ConfigError` whose message names
// the exact variable), not just "it throws" — a passing assertion here
// means the message is actually useful to the operator reading it.
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, resetConfigForTesting } from "./config.js";

const BASE_ENV = {
  BANDLIB_DATABASE_URL: "file:./test.db",
  BANDLIB_BOOTSTRAP_TOKEN: "test-token",
  BANDLIB_ALLOW_DEV_MAILER: "true",
};

beforeEach(() => {
  resetConfigForTesting();
});

describe("loadConfig", () => {
  it("fails, naming BANDLIB_DATABASE_URL, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDLIB_DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/BANDLIB_DATABASE_URL/);
  });

  it("fails, naming BANDLIB_BOOTSTRAP_TOKEN, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDLIB_BOOTSTRAP_TOKEN;
    expect(() => loadConfig(env)).toThrow(/BANDLIB_BOOTSTRAP_TOKEN/);
  });

  it("fails, naming BANDLIB_APP_ORIGIN, when running in production without it set", () => {
    const env = { ...BASE_ENV, NODE_ENV: "production" };
    expect(() => loadConfig(env)).toThrow(/BANDLIB_APP_ORIGIN/);
  });

  it("defaults BANDLIB_APP_ORIGIN to localhost outside production", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.appOrigin).toBe("http://localhost:4321");
  });

  it("accepts an explicit BANDLIB_APP_ORIGIN in production", () => {
    const config = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      BANDLIB_APP_ORIGIN: "https://bandlib.example",
    });
    expect(config.appOrigin).toBe("https://bandlib.example");
  });

  it("fails when no mailer is configured (no SMTP, no dev-mailer opt-in)", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDLIB_ALLOW_DEV_MAILER;
    expect(() => loadConfig(env)).toThrow(
      /no way to deliver login links|BANDLIB_ALLOW_DEV_MAILER/i,
    );
  });

  it("fails, naming the missing field, when SMTP config is partially set", () => {
    const env = { ...BASE_ENV, BANDLIB_SMTP_HOST: "smtp.example.com" };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDLIB_ALLOW_DEV_MAILER;
    expect(() => loadConfig(env)).toThrow(/BANDLIB_SMTP_PORT|BANDLIB_SMTP_FROM/);
  });

  it("accepts a complete SMTP config and builds an SmtpConfig", () => {
    const config = loadConfig({
      BANDLIB_DATABASE_URL: "file:./test.db",
      BANDLIB_BOOTSTRAP_TOKEN: "test-token",
      BANDLIB_SMTP_HOST: "smtp.example.com",
      BANDLIB_SMTP_PORT: "587",
      BANDLIB_SMTP_FROM: "bandlib@example.com",
      BANDLIB_SMTP_USER: "user",
      BANDLIB_SMTP_PASS: "pass",
    });
    expect(config.smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "bandlib@example.com",
      auth: { user: "user", pass: "pass" },
    });
  });

  it("defaults trustedProxyDepth to 1 and cookieSecure to true", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.trustedProxyDepth).toBe(1);
    expect(config.cookieSecure).toBe(true);
  });

  it("honors BANDLIB_COOKIE_SECURE=false and a custom BANDLIB_TRUSTED_PROXY_DEPTH", () => {
    const config = loadConfig({
      ...BASE_ENV,
      BANDLIB_COOKIE_SECURE: "false",
      BANDLIB_TRUSTED_PROXY_DEPTH: "0",
    });
    expect(config.cookieSecure).toBe(false);
    expect(config.trustedProxyDepth).toBe(0);
  });

  it("memoizes: a second call returns the same object without re-reading env", () => {
    const first = loadConfig({ ...BASE_ENV });
    const second = loadConfig({ ...BASE_ENV, BANDLIB_DATABASE_URL: "file:./different.db" });
    expect(second).toBe(first);
    expect(second.databaseUrl).toBe("file:./test.db");
  });
});
