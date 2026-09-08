// InMemoryStorage — a `Storage` fake for tests that don't want a real
// MinIO container. Conformance-tested by the exact same suite that runs
// against `S3Storage`/MinIO (see `conformance.ts`), so it can't silently
// drift from real S3-compatible behavior — a fake that only satisfies the
// TypeScript interface, with no real HTTP round trip behind its "signed"
// URLs, would prove nothing about Range handling, expiry, or content-type
// enforcement. To make that real, this starts an actual local HTTP server
// (`node:http`) backing the URLs it returns.
//
// This is the one deliberate `node:*` import in any EXPORTED entry point
// under `packages/storage` — confined to this file, reachable only from
// the package's `./testing` subpath (mirroring `@bandplate/db`'s
// `./testing` export), never from the main barrel a Workers build would
// pull in. `S3Storage` itself (the thing that actually ships) stays
// Web-Crypto/`fetch`-only — see `barrel-is-workers-safe.test.ts`, which
// asserts the main barrel never reaches this module. (`*.test.ts` files
// are separately free to use Node APIs regardless — e.g.
// `s3.conformance.test.ts` manages a real MinIO container via
// `node:child_process` — the same "dev tooling, not shipped" exception
// `packages/db/scripts/migrate.ts` already relies on; the point of this
// module being the "one" case is that it's an entry point, not a script.)
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  Clock,
  SignedDownloadUrlOptions,
  SignedUploadUrlOptions,
  Storage,
  StoredObject,
} from "@bandplate/core";
import { systemClock } from "@bandplate/core";
import { QUANTISE_BUCKET_MS, quantiseToHourBucket } from "./quantise.js";

interface StoredEntry {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  lastModified: number;
}

// Not a secret in any real sense (this is a throwaway in-process fake) —
// just the HMAC key that makes a query-string param tamper-evident enough
// to conformance-test expiry/content-type enforcement the same way a real
// SigV4 signature does.
const SIGNING_KEY = "in-memory-storage-fake-signing-key";

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString("hex");
}

async function sha256Base64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  // A plain `Uint8Array` no longer satisfies `BufferSource` under
  // TypeScript 5.7's DOM lib types (its `buffer` widened to
  // `ArrayBufferLike`, which includes `SharedArrayBuffer`) — copy into a
  // freshly allocated `ArrayBuffer`-backed view to satisfy `subtle.digest`.
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Buffer.from(digest).toString("base64");
}

export interface InMemoryStorageHandle {
  storage: Storage;
  /** Stops the backing HTTP server. Call in `afterAll`/`afterEach`. */
  close(): Promise<void>;
}

export interface InMemoryStorageOptions {
  /** Defaults to the real clock. Tests inject a fake one to control quantisation deterministically. */
  clock?: Clock;
}

export async function createInMemoryStorage(
  options: InMemoryStorageOptions = {},
): Promise<InMemoryStorageHandle> {
  const clock = options.clock ?? systemClock;
  const objects = new Map<string, StoredEntry>();

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      res.writeHead(500).end(String(err));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", origin);
    const key = decodeURIComponent(url.pathname.replace(/^\/objects\//, ""));
    const op = url.searchParams.get("op");
    const expires = Number(url.searchParams.get("expires") ?? "0");
    const sig = url.searchParams.get("sig");

    const expectedSig = await hmac(canonicalString(url));
    if (sig !== expectedSig) {
      res.writeHead(403).end("signature mismatch");
      return;
    }
    if (Date.now() > expires * 1000) {
      res.writeHead(403).end("expired");
      return;
    }

    if (op === "put" && req.method === "PUT") {
      await handlePut(req, res, url, key);
      return;
    }
    if (op === "get" && req.method === "GET") {
      handleGet(req, res, url, key);
      return;
    }
    res.writeHead(400).end("bad request");
  }

  async function handlePut(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: URL,
    key: string,
  ): Promise<void> {
    const declaredContentType = url.searchParams.get("contentType") ?? "";
    const declaredContentLength = url.searchParams.get("contentLength");
    const declaredChecksum = url.searchParams.get("checksumSha256");

    const actualContentType = req.headers["content-type"] ?? "";
    if (actualContentType !== declaredContentType) {
      res.writeHead(403).end("content-type mismatch");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const bytes = new Uint8Array(Buffer.concat(chunks));

    if (declaredContentLength !== null && bytes.byteLength !== Number(declaredContentLength)) {
      res.writeHead(403).end("content-length mismatch");
      return;
    }
    if (declaredChecksum !== null && (await sha256Base64(bytes)) !== declaredChecksum) {
      res.writeHead(403).end("checksum mismatch");
      return;
    }

    objects.set(key, { bytes, contentType: actualContentType, lastModified: Date.now() });
    res.writeHead(200).end();
  }

  function handleGet(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: URL,
    key: string,
  ): void {
    const entry = objects.get(key);
    if (!entry) {
      res.writeHead(404).end("not found");
      return;
    }
    // S3's own spelling for these two, not camelCase. The fake exists so the
    // conformance suite can run the same assertions against it and real MinIO;
    // a caller that reads the presigned URL's query string — the download route
    // asserts on `response-content-disposition` — would pass against one and
    // fail against the other if the fake invented its own parameter names.
    const contentType = url.searchParams.get("response-content-type") ?? entry.contentType;
    const disposition = url.searchParams.get("response-content-disposition");
    const headers: Record<string, string> = {
      "content-type": contentType,
      "accept-ranges": "bytes",
    };
    if (disposition) {
      headers["content-disposition"] = disposition;
    }

    const range = req.headers.range;
    const total = entry.bytes.byteLength;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416).end();
        return;
      }
      const [, startStr, endStr] = match;
      const start = startStr ? Number(startStr) : 0;
      const end = endStr ? Number(endStr) : total - 1;
      const clampedEnd = Math.min(end, total - 1);
      const slice = entry.bytes.subarray(start, clampedEnd + 1);
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${clampedEnd}/${total}`,
        "content-length": String(slice.byteLength),
      });
      res.end(Buffer.from(slice));
      return;
    }

    res.writeHead(200, { ...headers, "content-length": String(total) });
    res.end(Buffer.from(entry.bytes));
  }

  // A stable, order-independent canonical string of every query param
  // EXCEPT `sig` itself — same idea as SigV4's canonical query string,
  // scaled down: whatever's in the URL is exactly what's authenticated.
  function canonicalString(url: URL): string {
    const params = [...url.searchParams.entries()].filter(([k]) => k !== "sig");
    params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `${url.pathname}?${params.map(([k, v]) => `${k}=${v}`).join("&")}`;
  }

  async function signedUploadUrl(key: string, opts: SignedUploadUrlOptions): Promise<string> {
    const url = new URL(`${origin}/objects/${encodeURIComponent(key)}`);
    url.searchParams.set("op", "put");
    url.searchParams.set("contentType", opts.contentType);
    if (opts.contentLength !== undefined) {
      url.searchParams.set("contentLength", String(opts.contentLength));
    }
    if (opts.checksumSha256) {
      url.searchParams.set("checksumSha256", opts.checksumSha256);
    }
    url.searchParams.set("expires", String(Math.floor(clock.now() / 1000) + opts.expiresIn));
    url.searchParams.set("sig", await hmac(canonicalString(url)));
    return url.toString();
  }

  async function signedDownloadUrl(key: string, opts: SignedDownloadUrlOptions): Promise<string> {
    // Same quantisation policy as `S3Storage` — see `quantise.ts`.
    const bucketStartSec = Math.floor(quantiseToHourBucket(clock.now()) / 1000);
    const url = new URL(`${origin}/objects/${encodeURIComponent(key)}`);
    url.searchParams.set("op", "get");
    if (opts.responseContentType) {
      url.searchParams.set("response-content-type", opts.responseContentType);
    }
    if (opts.responseContentDisposition) {
      url.searchParams.set("response-content-disposition", opts.responseContentDisposition);
    }
    // Same padding as `S3Storage` — see its `signedDownloadUrl` comment
    // and the port's doc comment on `expiresIn`.
    const signedTtlSeconds = opts.expiresIn + QUANTISE_BUCKET_MS / 1000;
    url.searchParams.set("expires", String(bucketStartSec + signedTtlSeconds));
    url.searchParams.set("sig", await hmac(canonicalString(url)));
    return url.toString();
  }

  async function head(key: string): Promise<StoredObject | null> {
    const entry = objects.get(key);
    if (!entry) {
      return null;
    }
    return {
      key,
      size: entry.bytes.byteLength,
      contentType: entry.contentType,
      lastModified: entry.lastModified,
    };
  }

  async function del(keys: string[]): Promise<void> {
    for (const key of keys) {
      objects.delete(key);
    }
  }

  async function put(
    key: string,
    body: Uint8Array<ArrayBuffer> | Blob,
    contentType: string,
  ): Promise<void> {
    const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
    objects.set(key, { bytes, contentType, lastModified: Date.now() });
  }

  const storage: Storage = { signedUploadUrl, signedDownloadUrl, head, delete: del, put };

  return {
    storage,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
