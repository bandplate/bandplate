// S3Storage — the one `Storage` implementation (see the port's doc comment
// in `@bandplate/core` for why there is deliberately only one). Built on
// `aws4fetch`: pure Web Crypto + `fetch`, nothing Node-specific, so this
// same class runs unmodified under the container profile (against MinIO)
// today and under a future Workers profile (against R2's S3-compatible
// endpoint) in increment 7 — see this file's closing comment for why that
// increment reuses this class rather than the R2 binding.
import type {
  Clock,
  SignedDownloadUrlOptions,
  SignedUploadUrlOptions,
  Storage,
  StoredObject,
} from "@bandplate/core";
import { systemClock } from "@bandplate/core";
import { AwsClient } from "aws4fetch";
import { QUANTISE_BUCKET_MS, quantiseToHourBucket } from "./quantise.js";

export interface S3StorageConfig {
  /**
   * The endpoint THIS PROCESS uses to reach the bucket — e.g.
   * `http://minio:9000` behind Docker Compose, where `minio` only
   * resolves on the compose network. Used for `head`/`delete`/`put`,
   * which this process calls directly.
   */
  endpoint: string;
  /**
   * The endpoint a BROWSER can reach — e.g. `http://localhost:9000` in
   * local dev, or the bucket's real public/CDN origin in production. Used
   * to build `signedUploadUrl`/`signedDownloadUrl`, which are handed to
   * the browser. Defaults to `endpoint` when omitted (fine when the
   * server and the browser can resolve the same origin, e.g. a real S3/R2
   * endpoint reachable from both) — but behind Docker, `endpoint` and
   * `publicEndpoint` MUST differ, or every presigned URL 404s/hangs in the
   * browser (see the brief's "Config" section — this is the trap it calls
   * out by name).
   */
  publicEndpoint?: string;
  bucket: string;
  /** `auto` for R2. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Defaults to the real clock. Tests inject a fake one to control quantisation deterministically. */
  clock?: Clock;
}

/** `YYYYMMDDTHHMMSSZ`, matching aws4fetch's own default `datetime` formatting (and what SigV4 requires). */
function toAmzDatetime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** Every path segment individually percent-encoded, slashes preserved. */
function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function createS3Storage(config: S3StorageConfig): Storage {
  const clock = config.clock ?? systemClock;
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });

  // Path-style URLs (`{base}/{bucket}/{key}`), not virtual-hosted
  // (`{bucket}.{base}`) — the one form guaranteed to work identically
  // against MinIO, R2's S3-compatible endpoint, and a bare `http://host:port`
  // local dev endpoint with no DNS/wildcard-certificate setup required.
  function objectUrl(base: string, key: string): URL {
    return new URL(`${base.replace(/\/+$/, "")}/${config.bucket}/${encodeKeyPath(key)}`);
  }

  async function signedUploadUrl(key: string, options: SignedUploadUrlOptions): Promise<string> {
    const url = objectUrl(config.publicEndpoint ?? config.endpoint, key);
    url.searchParams.set("X-Amz-Expires", String(options.expiresIn));

    // `allHeaders: true` is load-bearing: aws4fetch excludes content-type
    // and content-length from the signature BY DEFAULT (they're in its
    // own `UNSIGNABLE_HEADERS` set, meant for the "signing an outgoing
    // request" case, not presigned URLs). Without this, a presigned PUT
    // would accept ANY content-type/length — exactly the enforcement the
    // brief's conformance suite asserts.
    const headers: Record<string, string> = { "content-type": options.contentType };
    if (options.contentLength !== undefined) {
      headers["content-length"] = String(options.contentLength);
    }
    if (options.checksumSha256) {
      headers["x-amz-checksum-sha256"] = options.checksumSha256;
    }

    const signed = await client.sign(url.toString(), {
      method: "PUT",
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url.toString();
  }

  async function signedDownloadUrl(
    key: string,
    options: SignedDownloadUrlOptions,
  ): Promise<string> {
    // Quantised signing time: every call within the same 1-hour bucket
    // signs against the exact same `X-Amz-Date`, so the whole URL
    // (signature included) comes out byte-identical — that's what makes
    // it a browser cache hit on a second page load instead of a fresh
    // download. See `quantise.ts` and the brief's "Serving audio" section.
    const datetime = toAmzDatetime(quantiseToHourBucket(clock.now()));

    const url = objectUrl(config.publicEndpoint ?? config.endpoint, key);
    if (options.responseContentType) {
      url.searchParams.set("response-content-type", options.responseContentType);
    }
    if (options.responseContentDisposition) {
      url.searchParams.set("response-content-disposition", options.responseContentDisposition);
    }
    // `options.expiresIn` is the MINIMUM guaranteed remaining validity
    // from now (see the port's doc comment) — the signed TTL has to be
    // measured from the quantised (possibly up-to-one-bucket-old)
    // timestamp above, not from "now", so pad it by a full bucket width to
    // make the guarantee hold even for a caller landing right before the
    // bucket rolls over.
    const signedTtlSeconds = options.expiresIn + QUANTISE_BUCKET_MS / 1000;
    url.searchParams.set("X-Amz-Expires", String(signedTtlSeconds));

    const signed = await client.sign(url.toString(), {
      method: "GET",
      aws: { signQuery: true, datetime },
    });
    return signed.url.toString();
  }

  async function head(key: string): Promise<StoredObject | null> {
    const url = objectUrl(config.endpoint, key);
    const res = await client.fetch(url.toString(), { method: "HEAD" });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`S3Storage.head(${key}) failed: ${res.status} ${res.statusText}`);
    }
    const size = Number(res.headers.get("content-length") ?? "0");
    const lastModifiedHeader = res.headers.get("last-modified");
    return {
      key,
      size,
      contentType: res.headers.get("content-type") ?? undefined,
      etag: res.headers.get("etag")?.replace(/"/g, "") ?? undefined,
      lastModified: lastModifiedHeader ? Date.parse(lastModifiedHeader) : undefined,
    };
  }

  async function del(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        const url = objectUrl(config.endpoint, key);
        const res = await client.fetch(url.toString(), { method: "DELETE" });
        // S3-compatible DELETE is idempotent and returns 204 whether or
        // not the object existed — anything else is a real failure.
        if (!res.ok && res.status !== 404) {
          throw new Error(`S3Storage.delete(${key}) failed: ${res.status} ${res.statusText}`);
        }
      }),
    );
  }

  async function put(
    key: string,
    body: Uint8Array<ArrayBuffer> | Blob,
    contentType: string,
  ): Promise<void> {
    const url = objectUrl(config.endpoint, key);
    const payload = body instanceof Blob ? body : new Blob([body]);
    const res = await client.fetch(url.toString(), {
      method: "PUT",
      headers: { "content-type": contentType },
      body: payload,
    });
    if (!res.ok) {
      throw new Error(`S3Storage.put(${key}) failed: ${res.status} ${res.statusText}`);
    }
  }

  return { signedUploadUrl, signedDownloadUrl, head, delete: del, put };
}

// --- Why not the Workers R2 binding (increment 7) --------------------------
//
// R2's binding API (`env.MY_BUCKET.put/get/...`) cannot presign a URL at
// all — presigning is an S3-compatible-endpoint-only feature. Building the
// audio-serving flow around the binding would mean a SECOND `Storage`
// implementation with different semantics (the binding streams bytes
// through the Worker itself; this port's whole design is "the app never
// streams audio bytes"), exercised only by the Workers profile and never by
// the container profile's own tests. `createS3Storage` against R2's
// S3-compatible endpoint (same SigV4 signing MinIO and real S3 use) is the
// one path both profiles run, so the same conformance suite exercises what
// increment 7 actually ships.
