// Fix round 1, Important 1: `getRuntime()`'s memoized `runtimePromise` is
// awaited by EVERY caller of `getApiApp`/`getAppDeps`/`getAuthDeps` — i.e.
// every request, for the life of the process. `maybeStartNotificationScheduler`
// used to run unguarded inside the `.then()` that produces that promise: an
// uncaught throw there (a bad VAPID config, a bug in the scheduler itself)
// would reject the cached promise instead of resolving it, permanently
// wedging the whole app over a scheduler fault that has nothing to do with
// whether requests can be served. This proves the fix: `getApiApp()` still
// resolves even when starting the scheduler throws.
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VAPID_ENV = {
  BANDPLATE_VAPID_PUBLIC_KEY:
    "BEl62iUYgUivxIkv69yViEuiBIa40HI8DLJTS7YkH8XmpsyZkKfxNZMs4XdI3VBhz6Tdm6esJPhZXe" + "wvVGpz-Uw",
  BANDPLATE_VAPID_PRIVATE_KEY: "r3yxmvzci4jgTxiS9hKtpQLEzHOp0qWpvFsc8k6kobw",
  BANDPLATE_VAPID_SUBJECT: "mailto:band@example.com",
};

let dbPath: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  dbPath = join(tmpdir(), `bandplate-app-test-${crypto.randomUUID()}.sqlite`);
  Object.assign(process.env, {
    BANDPLATE_DATABASE_URL: `file:${dbPath}`,
    BANDPLATE_BOOTSTRAP_TOKEN: "test-token",
    BANDPLATE_ALLOW_DEV_MAILER: "true",
    S3_ENDPOINT: "http://minio:9000",
    S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "bandplate-test",
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    ...VAPID_ENV,
  });
});

afterEach(async () => {
  process.env = originalEnv;
  vi.doUnmock("./notification-scheduler.js");
  vi.resetModules();
  await rm(dbPath, { force: true });
});

describe("getRuntime", () => {
  it("still resolves getApiApp() when starting the notification scheduler throws", async () => {
    vi.doMock("./notification-scheduler.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./notification-scheduler.js")>();
      return {
        ...actual,
        startNotificationScheduler: () => {
          throw new Error("boom: scheduler start failed");
        },
      };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getApiApp, resetRuntimeForTesting } = await import("./app.js");
    const { resetConfigForTesting } = await import("./config.js");
    resetConfigForTesting();
    resetRuntimeForTesting();

    await expect(getApiApp()).resolves.toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[scheduler] failed to start"));

    resetRuntimeForTesting();
    resetConfigForTesting();
    errorSpy.mockRestore();
  });
});
