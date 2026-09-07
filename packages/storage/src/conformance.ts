// The storage conformance suite — one set of assertions, run against every
// `Storage` implementation (`S3Storage`/MinIO in `s3.conformance.test.ts`,
// `InMemoryStorage` in `in-memory.conformance.test.ts`). Every assertion
// here is something that can actually fail: no "did not throw" checks, and
// every negative case (wrong content-type, wrong length, expired URL) is
// paired with a positive case proving the same URL/flow succeeds when the
// mismatch is removed — so a suite that accidentally always passes (e.g. a
// broken `fetch` silently returning ok:false either way) is itself caught.
import type { Clock, Storage } from "@bandlib/core";
import { describe, expect, it } from "vitest";

export interface ConformanceFixture {
  storage: Storage;
  /** A working `Clock` the fixture's `storage` was built against — the suite advances/rewinds it to test quantisation and expiry deterministically. */
  clock: FakeClock;
}

export interface FakeClock extends Clock {
  set(ms: number): void;
}

export function createFakeClock(startAt: number): FakeClock {
  let now = startAt;
  return {
    now: () => now,
    set(ms: number) {
      now = ms;
    },
  };
}

async function readAll(res: Response): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await res.arrayBuffer());
}

function textBody(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

/**
 * @param label Shown in the describe block — identifies which implementation is under test.
 * @param setup Builds a fresh fixture. Called once per `it` (not once for
 *   the whole suite) so tests can't leak object-store state into each
 *   other via a shared key.
 * @param teardown Optional cleanup (e.g. closing `InMemoryStorage`'s server).
 */
export function runStorageConformanceSuite<F extends ConformanceFixture>(
  label: string,
  setup: () => Promise<F>,
  teardown?: (fixture: F) => Promise<void>,
): void {
  describe(`Storage conformance: ${label}`, () => {
    async function withFixture<T>(fn: (fixture: F) => Promise<T>): Promise<T> {
      const fixture = await setup();
      try {
        return await fn(fixture);
      } finally {
        await teardown?.(fixture);
      }
    }

    it("a presigned PUT accepts a body matching the declared content-type and length, and the object is retrievable after", async () => {
      await withFixture(async ({ storage }) => {
        const key = `conformance/${label}/put-ok-${Date.now()}`;
        const body = textBody("hello storage");
        const uploadUrl = await storage.signedUploadUrl(key, {
          contentType: "text/plain",
          contentLength: body.byteLength,
          expiresIn: 300,
        });

        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": "text/plain" },
          body: new Blob([body]),
        });
        expect(res.ok).toBe(true);

        const head = await storage.head(key);
        expect(head).not.toBeNull();
        expect(head?.size).toBe(body.byteLength);
      });
    });

    it("a presigned PUT rejects a body sent with the WRONG content-type", async () => {
      await withFixture(async ({ storage }) => {
        const key = `conformance/${label}/put-wrong-content-type-${Date.now()}`;
        const uploadUrl = await storage.signedUploadUrl(key, {
          contentType: "text/plain",
          expiresIn: 300,
        });

        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: new Blob([textBody("hello")]),
        });
        expect(res.ok).toBe(false);
        expect(await storage.head(key)).toBeNull();
      });
    });

    it("a presigned PUT rejects a body whose length does NOT match the declared content-length", async () => {
      await withFixture(async ({ storage }) => {
        const key = `conformance/${label}/put-wrong-length-${Date.now()}`;
        const uploadUrl = await storage.signedUploadUrl(key, {
          contentType: "text/plain",
          contentLength: 5,
          expiresIn: 300,
        });

        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": "text/plain" },
          body: new Blob([textBody("this body is much longer than 5 bytes")]),
        });
        expect(res.ok).toBe(false);
        expect(await storage.head(key)).toBeNull();
      });
    });

    it("a presigned GET honours Range and returns 206 with a correct Content-Range", async () => {
      await withFixture(async ({ storage }) => {
        const key = `conformance/${label}/range-${Date.now()}`;
        const body = textBody("0123456789ABCDEF"); // 16 bytes
        await storage.put(key, body, "application/octet-stream");

        const downloadUrl = await storage.signedDownloadUrl(key, { expiresIn: 300 });

        const full = await fetch(downloadUrl);
        expect(full.status).toBe(200);
        expect(await readAll(full)).toEqual(body);

        const partial = await fetch(downloadUrl, { headers: { range: "bytes=2-5" } });
        expect(partial.status).toBe(206);
        expect(partial.headers.get("content-range")).toBe("bytes 2-5/16");
        expect(await readAll(partial)).toEqual(body.slice(2, 6));
      });
    });

    it("an expired presigned GET is rejected", async () => {
      await withFixture(async ({ storage, clock }) => {
        const key = `conformance/${label}/expiry-${Date.now()}`;
        await storage.put(key, textBody("expires soon"), "text/plain");

        // Sign as if "now" were far in the past relative to the clock the
        // URL is actually checked against — the fake's own clock for
        // InMemoryStorage, real wall-clock time for S3Storage/MinIO
        // (which has no idea our test clock exists). Either way, a URL
        // signed to expire a long time ago must be rejected NOW.
        clock.set(Date.parse("2000-01-01T00:00:00.000Z"));
        const expiredUrl = await storage.signedDownloadUrl(key, { expiresIn: 1 });

        const res = await fetch(expiredUrl);
        expect(res.ok).toBe(false);
      });
    });

    it("a presigned GET signed to expire in the future is still usable", async () => {
      await withFixture(async ({ storage }) => {
        const key = `conformance/${label}/not-expired-${Date.now()}`;
        await storage.put(key, textBody("still good"), "text/plain");

        const url = await storage.signedDownloadUrl(key, { expiresIn: 300 });
        const res = await fetch(url);
        expect(res.ok).toBe(true);
      });
    });

    it("quantised signing produces an identical URL for two calls within the same window", async () => {
      await withFixture(async ({ storage, clock }) => {
        const key = `conformance/${label}/quantise-same-${Date.now()}`;
        // Anchor deliberately NOT on an hour boundary, so this also
        // proves the two calls land in the same bucket despite the clock
        // having moved between them, not just at t=0.
        const bucketStart = Date.parse("2025-06-01T10:00:00.000Z");
        clock.set(bucketStart + 5 * 60 * 1000); // 10:05
        const first = await storage.signedDownloadUrl(key, { expiresIn: 300 });

        clock.set(bucketStart + 40 * 60 * 1000); // 10:40 — same hour bucket
        const second = await storage.signedDownloadUrl(key, { expiresIn: 300 });

        expect(second).toBe(first);
      });
    });

    it("quantised signing produces a DIFFERENT URL once the clock crosses into the next window", async () => {
      await withFixture(async ({ storage, clock }) => {
        const key = `conformance/${label}/quantise-different-${Date.now()}`;
        const bucketStart = Date.parse("2025-06-01T10:00:00.000Z");
        clock.set(bucketStart + 5 * 60 * 1000); // 10:05
        const first = await storage.signedDownloadUrl(key, { expiresIn: 300 });

        clock.set(bucketStart + 65 * 60 * 1000); // 11:05 — next bucket
        const second = await storage.signedDownloadUrl(key, { expiresIn: 300 });

        expect(second).not.toBe(first);
      });
    });

    it("head() reports the exact size of a stored object, and null for a missing one", async () => {
      await withFixture(async ({ storage }) => {
        const key = `conformance/${label}/head-${Date.now()}`;
        const body = textBody("exactly twenty chars"); // 20 bytes
        await storage.put(key, body, "text/plain");

        const found = await storage.head(key);
        expect(found?.size).toBe(20);

        const missing = await storage.head(`${key}-does-not-exist`);
        expect(missing).toBeNull();
      });
    });

    it("delete removes multiple keys sharing a prefix, and leaves an unrelated key untouched", async () => {
      await withFixture(async ({ storage }) => {
        const stamp = Date.now();
        const prefix = `conformance/${label}/delete-${stamp}`;
        const a = `${prefix}/master/lossy.mp3`;
        const b = `${prefix}/stems/bass/lossy.mp3`;
        const unrelated = `conformance/${label}/delete-${stamp}-unrelated/master/lossy.mp3`;

        await storage.put(a, textBody("a"), "audio/mpeg");
        await storage.put(b, textBody("b"), "audio/mpeg");
        await storage.put(unrelated, textBody("u"), "audio/mpeg");

        await storage.delete([a, b]);

        expect(await storage.head(a)).toBeNull();
        expect(await storage.head(b)).toBeNull();
        expect(await storage.head(unrelated)).not.toBeNull();
      });
    });
  });
}
