import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The S3 conformance suite manages its own MinIO container and needs
    // real wall-clock time for the container to boot and for the expiry
    // test's real (short) waits.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
