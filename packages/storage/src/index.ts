// @bandplate/storage — the one `Storage` implementation (S3-compatible,
// against MinIO in the container profile / R2 in a future Workers
// profile). This barrel is Workers-safe: it never imports `in-memory.ts`
// (the only Node-dependent module in this package — a real local HTTP
// server backing `InMemoryStorage`'s test-only fake), directly or
// transitively. See `barrel-is-workers-safe.test.ts` and `in-memory.ts`'s
// own header comment.

export * from "./quantise.js";
export * from "./s3.js";
