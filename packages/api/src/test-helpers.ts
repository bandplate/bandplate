// Test-only helper: builds a fully wired app (in-memory libSQL, capturing
// mailer, fake advanceable clock, in-memory rate limiter, in-memory
// storage) for `app.request()` tests. Not part of the runtime library
// surface.
import { type Clock, type Storage, createInMemoryRateLimiter } from "@bandlib/core";
import type { Db } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { type CapturingMailer, createCapturingMailer } from "@bandlib/mail";
import { createInMemoryStorage } from "@bandlib/storage/testing";
import type { Hono } from "hono";
import { type AppConfig, buildRoutedApp } from "./index.js";
import type { GuardedRouter } from "./route-registry.js";
import type { AppEnv } from "./types.js";

export const TEST_APP_ORIGIN = "https://band.example";
export const TEST_BOOTSTRAP_TOKEN = "test-bootstrap-token";

export interface FakeClock extends Clock {
  advance(ms: number): void;
}

export function createFakeClock(startAt = 1_700_000_000_000): FakeClock {
  let now = startAt;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

export interface TestApp {
  app: Hono<AppEnv>;
  router: GuardedRouter;
  db: Db;
  mailer: CapturingMailer;
  clock: FakeClock;
  config: AppConfig;
  storage: Storage;
  /** Stops the in-memory storage fake's backing HTTP server, if one was ever actually started (see `createLazyInMemoryStorage` below) — safe to call even for a test that never touched storage at all. Call in `afterEach` for a test file that exercises the audio route. */
  closeStorage: () => Promise<void>;
}

/**
 * `InMemoryStorage` starts a real `node:http` server (see its own header
 * comment on why: it has to be conformance-testable against the exact
 * same assertions as real MinIO). `buildTestApp` is called ~65 times
 * across 8 test files, but only `audio.test.ts` — the one file that
 * actually exercises the audio route — ever needs a real storage backend;
 * the other 7 never call anything on `TestApp.storage` and never call
 * `closeStorage` either. Eagerly starting a server on every call leaked
 * one live listening socket per test in those files (fix round 1, item
 * 7). Deferring the real `createInMemoryStorage()` call until the first
 * actual `Storage` method invocation means those 7 files never start a
 * server at all — nothing to leak — while `audio.test.ts` (and anything
 * else that legitimately calls into storage) behaves identically to
 * before, module the one-time lazy-init cost on first use.
 */
function createLazyInMemoryStorage(): { storage: Storage; close: () => Promise<void> } {
  type Handle = Awaited<ReturnType<typeof createInMemoryStorage>>;
  let handlePromise: Promise<Handle> | undefined;
  function ensure(): Promise<Handle> {
    if (!handlePromise) {
      handlePromise = createInMemoryStorage();
    }
    return handlePromise;
  }
  const storage: Storage = {
    signedUploadUrl: async (...args) => (await ensure()).storage.signedUploadUrl(...args),
    signedDownloadUrl: async (...args) => (await ensure()).storage.signedDownloadUrl(...args),
    head: async (...args) => (await ensure()).storage.head(...args),
    delete: async (...args) => (await ensure()).storage.delete(...args),
    put: async (...args) => (await ensure()).storage.put(...args),
  };
  return {
    storage,
    close: async () => {
      if (!handlePromise) {
        return;
      }
      const handle = await handlePromise;
      await handle.close();
    },
  };
}

export async function buildTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const db = await createTestDb();
  const mailer = createCapturingMailer();
  const clock = createFakeClock();
  const rateLimiter = createInMemoryRateLimiter(clock);
  // Deliberately NOT `{ clock }` — `clock` here is the app's fake,
  // freely-advanceable auth-flow clock (tests move it to exercise
  // token/session expiry), which starts pinned at a fixed historical
  // instant, not real time. `InMemoryStorage`'s own expiry check is
  // necessarily judged against REAL wall-clock time (an actual `fetch()`
  // against its presigned URL happens at real "now", exactly like a real
  // request to MinIO would) — signing against a clock frozen in the past
  // would make every presigned URL this test app hands out already
  // expired by the time a test fetches it. Quantisation/expiry semantics
  // themselves are already covered thoroughly by
  // `@bandlib/storage`'s own conformance suite; this just needs a
  // working default.
  const storageHandle = createLazyInMemoryStorage();
  const config: AppConfig = {
    appOrigin: TEST_APP_ORIGIN,
    bootstrapToken: TEST_BOOTSTRAP_TOKEN,
    cookieSecure: true,
    ...overrides,
  };

  // `requestLogin`'s timing-side-channel clamp defaults to a real wait
  // (see `AppDeps.sleep`) — tests inject a no-op `sleep` so HTTP-level
  // login tests stay fast. The clamp's actual behavior (that both branches
  // request at least the floor) is unit-tested directly against
  // `requestLogin` in `@bandlib/core`, with a `sleep` fake that records
  // the requested duration.
  const { app, router } = buildRoutedApp({
    db,
    mailer,
    clock,
    rateLimiter,
    storage: storageHandle.storage,
    config,
    sleep: async () => {},
  });
  return {
    app,
    router,
    db,
    mailer,
    clock,
    config,
    storage: storageHandle.storage,
    closeStorage: storageHandle.close,
  };
}

/** Extract the raw login token from the last captured login-link email. */
export function extractLoginToken(mailer: CapturingMailer): string {
  const last = mailer.sent.at(-1);
  if (!last || last.kind !== "login-link") {
    throw new Error("expected a login link to have been captured");
  }
  const token = last.url.split("/").pop();
  if (!token) {
    throw new Error("could not extract a token from the captured login link url");
  }
  return token;
}

/** Extract the `bl_session=...` cookie value from a Set-Cookie header. */
export function extractSessionCookieValue(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error("no Set-Cookie header present");
  }
  const match = setCookieHeader.match(/bl_session=([^;]+)/);
  if (!match?.[1]) {
    throw new Error(`no bl_session cookie found in: ${setCookieHeader}`);
  }
  return match[1];
}
