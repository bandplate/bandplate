// Storage port — the only seam between deploy profiles for object storage.
// Both profiles use the SAME implementation: `packages/storage`'s
// `S3Storage`, against MinIO/R2's S3-compatible API via `aws4fetch`. The
// Workers profile points it at R2's S3 endpoint and changes no code (see
// `packages/storage`'s header comment for why NOT the R2 binding). Nothing outside `packages/storage` (and its
// implementations) constructs a presigned URL or talks to a bucket
// directly — routes and repos only ever see this interface.
//
// Deliberately small: no multipart upload. Every file this app handles
// (a rehearsal recording, a stem, a peaks.json) is tens of MB, far below
// the 5 GB ceiling a single presigned PUT supports. If multipart is ever
// needed it is an additive extension to this interface, not a redesign.

export interface StoredObject {
  key: string;
  /** Size in bytes. */
  size: number;
  contentType?: string;
  etag?: string;
  /** Epoch ms. */
  lastModified?: number;
}

export interface SignedUploadUrlOptions {
  contentType: string;
  /** When given, the signed URL enforces this exact Content-Length. */
  contentLength?: number;
  /** Seconds until the URL expires. */
  expiresIn: number;
  /** Base64-encoded SHA-256 of the body, when the caller wants integrity enforced by the signature. */
  checksumSha256?: string;
}

export interface SignedDownloadUrlOptions {
  /**
   * Minimum seconds of validity guaranteed from the moment this call
   * returns — NOT the raw signed TTL. Because the signing timestamp is
   * quantised (see `signedDownloadUrl` below), the actual signed TTL is
   * this value plus one full quantisation window, so the guarantee holds
   * even for a caller unlucky enough to land right before the window
   * rolls over. Pass the audio route's actual minimum-needed lifetime
   * here (e.g. 5 real hours) — the implementation adds the headroom.
   */
  expiresIn: number;
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface Storage {
  /** A presigned PUT URL that enforces the declared content-type (and length, when given). */
  signedUploadUrl(key: string, options: SignedUploadUrlOptions): Promise<string>;
  /**
   * A presigned GET URL. Implementations MUST quantise the signing
   * timestamp (see `packages/storage`'s `S3Storage` for the exact
   * bucketing) so that repeated calls within the same window return a
   * byte-identical URL — that's what lets the browser's HTTP cache treat
   * repeated page loads as a cache hit instead of re-downloading the whole
   * file. A caller must not be able to get this wrong by calling this
   * method "normally"; there is no unquantised escape hatch.
   */
  signedDownloadUrl(key: string, options: SignedDownloadUrlOptions): Promise<string>;
  /** `null` when the object does not exist. */
  head(key: string): Promise<StoredObject | null>;
  delete(keys: string[]): Promise<void>;
  /**
   * Escape hatch for small, non-audio writes (e.g. a generated peaks.json)
   * where a direct server-side PUT is simpler than a presigned URL round
   * trip. Never used for audio — audio always goes browser/uploader ->
   * presigned URL -> bucket, so the app process never streams audio bytes.
   */
  put(key: string, body: Uint8Array<ArrayBuffer> | Blob, contentType: string): Promise<void>;
}
