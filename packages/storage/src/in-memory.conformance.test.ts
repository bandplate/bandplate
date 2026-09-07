import {
  type ConformanceFixture,
  createFakeClock,
  runStorageConformanceSuite,
} from "./conformance.js";
import { createInMemoryStorage } from "./in-memory.js";

interface Fixture extends ConformanceFixture {
  close: () => Promise<void>;
}

// Runs the exact same assertions `s3.conformance.test.ts` runs against
// real MinIO — see `conformance.ts`'s header comment for why that matters:
// this proves the fake can't silently drift from real S3-compatible
// behavior. A fresh `InMemoryStorage` (and its backing HTTP server) is
// built per test and closed in the suite's own teardown, so no state or
// listening port leaks between tests.
runStorageConformanceSuite<Fixture>(
  "InMemoryStorage",
  async () => {
    const clock = createFakeClock(Date.now());
    const handle = await createInMemoryStorage({ clock });
    return {
      storage: handle.storage,
      clock,
      close: handle.close,
      // `InMemoryStorage`'s signed URLs carry a bare absolute epoch-second
      // `expires` param — see `in-memory.ts`'s `signedDownloadUrl`.
      parseSignedExpiryEpochSeconds: (url: string) =>
        Number(new URL(url).searchParams.get("expires")),
    };
  },
  async (fixture) => {
    await fixture.close();
  },
);
