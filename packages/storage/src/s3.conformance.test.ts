// Runs `conformance.ts`'s suite against a REAL MinIO container — not the
// `InMemoryStorage` fake — via `S3Storage`/`aws4fetch`. This is the test
// that actually proves the S3-compatible signing works (SigV4 query auth,
// content-type/length enforcement, Range, expiry), since `InMemoryStorage`
// re-implements that logic itself rather than exercising it.
//
// Manages its own MinIO container (Node-only tooling — `*.test.ts` files
// are dev-only, never shipped; see `in-memory.ts`'s header comment for the
// same exception applied to `packages/db/scripts/migrate.ts`). Skips with
// a LOUD, failing message (not a silent pass) if Docker isn't available —
// per the task brief: "If it is unavailable, say so plainly rather than
// faking the storage tests."
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { AwsClient } from "aws4fetch";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  type ConformanceFixture,
  createFakeClock,
  runStorageConformanceSuite,
} from "./conformance.js";
import { createS3Storage } from "./s3.js";

/**
 * Reverses `s3.ts`'s `toAmzDatetime` (`YYYYMMDDTHHMMSSZ`) back to epoch
 * seconds — needed to parse `X-Amz-Date` out of a signed URL for the
 * padding-math conformance test (see `parseSignedExpiryEpochSeconds`
 * below and `conformance.ts`'s fix-round-1 item 6 test).
 */
function parseAmzDateToEpochSeconds(amzDate: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (!match) {
    throw new Error(`unexpected X-Amz-Date format: ${amzDate}`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return (
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) / 1000
  );
}

function parseSignedExpiryEpochSeconds(url: string): number {
  const parsed = new URL(url);
  const amzDate = parsed.searchParams.get("X-Amz-Date");
  const amzExpires = parsed.searchParams.get("X-Amz-Expires");
  if (!amzDate || !amzExpires) {
    throw new Error(`signed URL missing X-Amz-Date/X-Amz-Expires: ${url}`);
  }
  return parseAmzDateToEpochSeconds(amzDate) + Number(amzExpires);
}

const CONTAINER_NAME = "bandplate-storage-conformance-test-minio";
const BUCKET = "bandplate-test";
const ACCESS_KEY_ID = "minioadmin";
const SECRET_ACCESS_KEY = "minioadmin12345";
const REGION = "us-east-1";

function dockerAvailable(): boolean {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not allocate a free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(endpoint: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/minio/health/ready`);
      if (res.ok) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`MinIO did not become ready within ${timeoutMs}ms: ${String(lastError)}`);
}

async function createBucket(endpoint: string): Promise<void> {
  const client = new AwsClient({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    service: "s3",
    region: REGION,
  });
  const res = await client.fetch(`${endpoint}/${BUCKET}`, { method: "PUT" });
  // 409 = bucket already owned by you (a leftover container from a prior
  // interrupted run) — fine, not a failure.
  if (!res.ok && res.status !== 409) {
    throw new Error(`failed to create test bucket: ${res.status} ${await res.text()}`);
  }
}

const hasDocker = dockerAvailable();

describe.skipIf(!hasDocker)("Storage conformance: S3Storage (MinIO)", () => {
  let endpoint: string;

  beforeAll(async () => {
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
    const port = await getFreePort();
    endpoint = `http://127.0.0.1:${port}`;
    execFileSync("docker", [
      "run",
      "-d",
      "--name",
      CONTAINER_NAME,
      "-p",
      `${port}:9000`,
      "-e",
      `MINIO_ROOT_USER=${ACCESS_KEY_ID}`,
      "-e",
      `MINIO_ROOT_PASSWORD=${SECRET_ACCESS_KEY}`,
      "minio/minio",
      "server",
      "/data",
    ]);
    await waitForReady(endpoint, 30_000);
    await createBucket(endpoint);
  }, 60_000);

  afterAll(() => {
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
  });

  runStorageConformanceSuite<ConformanceFixture>("S3Storage (MinIO)", async () => {
    const clock = createFakeClock(Date.now());
    const storage = createS3Storage({
      endpoint,
      // Same endpoint for both here — the container is reachable at this
      // 127.0.0.1 address from both "the app" (this test process) and
      // "the browser" (the `fetch()` calls the conformance suite itself
      // makes). The public/internal split this class exists to support is
      // exercised for real by the compose stack (`deploy/node/compose.yml`,
      // `minio:9000` internal vs `localhost:9000` public) and verified
      // manually against the built server — see task-7-report.md.
      publicEndpoint: endpoint,
      bucket: BUCKET,
      region: REGION,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      clock,
    });
    return { storage, clock, parseSignedExpiryEpochSeconds };
  });
});

if (!hasDocker) {
  // `describe.skipIf` renders these as "skipped", easy to miss in a big
  // test run — this makes the gap impossible to overlook: a real *failing*
  // assertion that names exactly what's missing, per the task brief's "say
  // so plainly rather than faking the storage tests."
  describe("Storage conformance: S3Storage (MinIO)", () => {
    it("requires Docker — see the skipped suite above for what didn't run", () => {
      throw new Error(
        "Docker is not available in this environment: the S3Storage/MinIO conformance suite " +
          "could not run. This is a real gap in verification, not a pass — install/start Docker " +
          "and re-run `pnpm --filter @bandplate/storage test`.",
      );
    });
  });
}
