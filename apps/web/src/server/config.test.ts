// "Config validation: a missing required variable fails startup with a
// message naming it; no-mailer-configured fails startup." Every test here
// asserts a specific failure (a thrown `ConfigError` whose message names
// the exact variable), not just "it throws" — a passing assertion here
// means the message is actually useful to the operator reading it.
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, resetConfigForTesting } from "./config.js";

const S3_ENV = {
  S3_ENDPOINT: "http://minio:9000",
  S3_PUBLIC_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "bandplate-test",
  S3_REGION: "auto",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

const BASE_ENV = {
  BANDPLATE_DATABASE_URL: "file:./test.db",
  BANDPLATE_BOOTSTRAP_TOKEN: "test-token",
  BANDPLATE_ALLOW_DEV_MAILER: "true",
  ...S3_ENV,
};

beforeEach(() => {
  resetConfigForTesting();
});

describe("loadConfig", () => {
  it("fails, naming BANDPLATE_DATABASE_URL, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDPLATE_DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_DATABASE_URL/);
  });

  it("fails, naming BANDPLATE_BOOTSTRAP_TOKEN, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDPLATE_BOOTSTRAP_TOKEN;
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_BOOTSTRAP_TOKEN/);
  });

  it("fails, naming BANDPLATE_APP_ORIGIN, when running in production without it set", () => {
    const env = { ...BASE_ENV, NODE_ENV: "production" };
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_APP_ORIGIN/);
  });

  it("defaults BANDPLATE_APP_ORIGIN to localhost outside production", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.appOrigin).toBe("http://localhost:4321");
  });

  it("accepts an explicit BANDPLATE_APP_ORIGIN in production", () => {
    // NOT `...BASE_ENV` here — it carries BANDPLATE_ALLOW_DEV_MAILER=true,
    // which is now itself rejected once NODE_ENV=production (see the
    // BANDPLATE_ALLOW_DEV_MAILER tests below). A real SMTP config isolates
    // this test to the one thing it's actually checking: the app origin.
    const config = loadConfig({
      BANDPLATE_DATABASE_URL: "file:./test.db",
      BANDPLATE_BOOTSTRAP_TOKEN: "test-token",
      NODE_ENV: "production",
      BANDPLATE_APP_ORIGIN: "https://bandplate.example",
      BANDPLATE_SMTP_HOST: "smtp.example.com",
      BANDPLATE_SMTP_PORT: "587",
      BANDPLATE_SMTP_FROM: "bandplate@example.com",
      ...S3_ENV,
    });
    expect(config.appOrigin).toBe("https://bandplate.example");
  });

  it("fails when no mailer is configured (no SMTP, no dev-mailer opt-in)", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDPLATE_ALLOW_DEV_MAILER;
    expect(() => loadConfig(env)).toThrow(
      /no way to deliver login links|BANDPLATE_ALLOW_DEV_MAILER/i,
    );
  });

  it("fails, naming the missing field, when SMTP config is partially set", () => {
    const env = { ...BASE_ENV, BANDPLATE_SMTP_HOST: "smtp.example.com" };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).BANDPLATE_ALLOW_DEV_MAILER;
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_SMTP_PORT|BANDPLATE_SMTP_FROM/);
  });

  it("accepts a complete SMTP config and builds an SmtpConfig", () => {
    const config = loadConfig({
      BANDPLATE_DATABASE_URL: "file:./test.db",
      BANDPLATE_BOOTSTRAP_TOKEN: "test-token",
      BANDPLATE_SMTP_HOST: "smtp.example.com",
      BANDPLATE_SMTP_PORT: "587",
      BANDPLATE_SMTP_FROM: "bandplate@example.com",
      BANDPLATE_SMTP_USER: "user",
      BANDPLATE_SMTP_PASS: "pass",
      ...S3_ENV,
    });
    expect(config.smtp).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "bandplate@example.com",
      auth: { user: "user", pass: "pass" },
    });
  });

  it("defaults trustedProxyDepth to 1 and cookieSecure to true", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.trustedProxyDepth).toBe(1);
    expect(config.cookieSecure).toBe(true);
  });

  it("honors BANDPLATE_COOKIE_SECURE=false and a custom BANDPLATE_TRUSTED_PROXY_DEPTH", () => {
    const config = loadConfig({
      ...BASE_ENV,
      BANDPLATE_COOKIE_SECURE: "false",
      BANDPLATE_TRUSTED_PROXY_DEPTH: "0",
    });
    expect(config.cookieSecure).toBe(false);
    expect(config.trustedProxyDepth).toBe(0);
  });

  it("fails when BANDPLATE_ALLOW_DEV_MAILER=true and NODE_ENV=production", () => {
    const env = {
      ...BASE_ENV,
      NODE_ENV: "production",
      BANDPLATE_APP_ORIGIN: "https://bandplate.example",
      BANDPLATE_ALLOW_DEV_MAILER: "true",
    };
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_ALLOW_DEV_MAILER/);
  });

  it("accepts BANDPLATE_ALLOW_DEV_MAILER=true outside production", () => {
    const config = loadConfig({ ...BASE_ENV, BANDPLATE_ALLOW_DEV_MAILER: "true" });
    expect(config.allowDevMailer).toBe(true);
  });

  it("still starts in production with a real SMTP config and no dev-mailer flag", () => {
    const config = loadConfig({
      BANDPLATE_DATABASE_URL: "file:./test.db",
      BANDPLATE_BOOTSTRAP_TOKEN: "test-token",
      NODE_ENV: "production",
      BANDPLATE_APP_ORIGIN: "https://bandplate.example",
      BANDPLATE_SMTP_HOST: "smtp.example.com",
      BANDPLATE_SMTP_PORT: "587",
      BANDPLATE_SMTP_FROM: "bandplate@example.com",
      ...S3_ENV,
    });
    expect(config.isProduction).toBe(true);
    expect(config.allowDevMailer).toBe(false);
  });

  it("rejects a BANDPLATE_APP_ORIGIN with a trailing slash", () => {
    const env = { ...BASE_ENV, BANDPLATE_APP_ORIGIN: "https://bandplate.example/" };
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_APP_ORIGIN/);
  });

  it("rejects a BANDPLATE_APP_ORIGIN with a path", () => {
    const env = { ...BASE_ENV, BANDPLATE_APP_ORIGIN: "https://bandplate.example/app" };
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_APP_ORIGIN/);
  });

  it("rejects a BANDPLATE_APP_ORIGIN that isn't a URL at all", () => {
    const env = { ...BASE_ENV, BANDPLATE_APP_ORIGIN: "not a url" };
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_APP_ORIGIN/);
  });

  it("accepts a bare BANDPLATE_APP_ORIGIN with a port", () => {
    const config = loadConfig({ ...BASE_ENV, BANDPLATE_APP_ORIGIN: "http://localhost:5000" });
    expect(config.appOrigin).toBe("http://localhost:5000");
  });

  it("fails, naming S3_ENDPOINT, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).S3_ENDPOINT;
    expect(() => loadConfig(env)).toThrow(/S3_ENDPOINT/);
  });

  it("fails, naming S3_PUBLIC_ENDPOINT, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).S3_PUBLIC_ENDPOINT;
    expect(() => loadConfig(env)).toThrow(/S3_PUBLIC_ENDPOINT/);
  });

  it("fails, naming S3_BUCKET, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).S3_BUCKET;
    expect(() => loadConfig(env)).toThrow(/S3_BUCKET/);
  });

  it("fails, naming S3_REGION, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).S3_REGION;
    expect(() => loadConfig(env)).toThrow(/S3_REGION/);
  });

  it("fails, naming S3_ACCESS_KEY_ID, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).S3_ACCESS_KEY_ID;
    expect(() => loadConfig(env)).toThrow(/S3_ACCESS_KEY_ID/);
  });

  it("fails, naming S3_SECRET_ACCESS_KEY, when it is missing", () => {
    const env = { ...BASE_ENV };
    // biome-ignore lint/performance/noDelete: test-only env manipulation
    delete (env as Record<string, string | undefined>).S3_SECRET_ACCESS_KEY;
    expect(() => loadConfig(env)).toThrow(/S3_SECRET_ACCESS_KEY/);
  });

  it("builds an S3Config with endpoint and publicEndpoint kept distinct", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.s3).toEqual({
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      bucket: "bandplate-test",
      region: "auto",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    });
  });

  it("defaults the installation's language to English when unset", () => {
    expect(loadConfig({ ...BASE_ENV }).defaultLocale).toBe("en");
  });

  it("takes BANDPLATE_DEFAULT_LOCALE when it names a language the app ships", () => {
    expect(loadConfig({ ...BASE_ENV, BANDPLATE_DEFAULT_LOCALE: "cs" }).defaultLocale).toBe("cs");
  });

  // `cz` is the COUNTRY code; `cs` is the language. Getting this wrong would
  // otherwise fall back to English and look exactly like the setting doing
  // nothing at all.
  it("fails, naming the variable and the accepted values, on a language it does not ship", () => {
    expect(() => loadConfig({ ...BASE_ENV, BANDPLATE_DEFAULT_LOCALE: "cz" })).toThrow(
      /BANDPLATE_DEFAULT_LOCALE.*en, cs/,
    );
  });

  it("memoizes: a second call returns the same object without re-reading env", () => {
    const first = loadConfig({ ...BASE_ENV });
    const second = loadConfig({ ...BASE_ENV, BANDPLATE_DATABASE_URL: "file:./different.db" });
    expect(second).toBe(first);
    expect(second.databaseUrl).toBe("file:./test.db");
  });

  // --- VAPID (Web Push) — optional, all-or-nothing, mirrors SMTP above ---

  const VAPID_ENV = {
    BANDPLATE_VAPID_PUBLIC_KEY:
      "BCqYw5fp3IEnFM4W6Hv-XAyPWUbqedCa2pW2wEDz3YrqHbwD0IQ4F4YfIE5rI_BCU8vBhAOHav848fAiJlMiJ7g",
    BANDPLATE_VAPID_PRIVATE_KEY: "r3yxmvzci4jgTxiS9hKtpQLEzHOp0qWpvFsc8k6kobw",
    BANDPLATE_VAPID_SUBJECT: "mailto:band@example.com",
  };

  it("leaves push undefined when no BANDPLATE_VAPID_* variable is set", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.push).toBeUndefined();
  });

  it("builds a VapidConfig when all three BANDPLATE_VAPID_* variables are set", () => {
    const config = loadConfig({ ...BASE_ENV, ...VAPID_ENV });
    expect(config.push).toEqual({
      publicKey: VAPID_ENV.BANDPLATE_VAPID_PUBLIC_KEY,
      privateKey: VAPID_ENV.BANDPLATE_VAPID_PRIVATE_KEY,
      subject: VAPID_ENV.BANDPLATE_VAPID_SUBJECT,
    });
  });

  it("fails, naming the missing field, when VAPID config is partially set", () => {
    const env = {
      ...BASE_ENV,
      BANDPLATE_VAPID_PUBLIC_KEY: VAPID_ENV.BANDPLATE_VAPID_PUBLIC_KEY,
    };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(
      /BANDPLATE_VAPID_PRIVATE_KEY.*BANDPLATE_VAPID_SUBJECT|BANDPLATE_VAPID_SUBJECT.*BANDPLATE_VAPID_PRIVATE_KEY/,
    );
  });

  it("fails, naming BANDPLATE_VAPID_PUBLIC_KEY, when it is malformed", () => {
    const env = { ...BASE_ENV, ...VAPID_ENV, BANDPLATE_VAPID_PUBLIC_KEY: "too-short" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_VAPID_PUBLIC_KEY/);
  });

  it("fails, naming BANDPLATE_VAPID_SUBJECT, when it doesn't start with mailto: or https:", () => {
    const env = { ...BASE_ENV, ...VAPID_ENV, BANDPLATE_VAPID_SUBJECT: "band@example.com" };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/BANDPLATE_VAPID_SUBJECT/);
  });
});
