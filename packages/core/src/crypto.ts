// Token/hash primitives for the auth layer. Web Crypto only (no node:crypto)
// so this runs unmodified on Cloudflare Workers.
//
// Raw tokens (login links, session cookies, service-token secrets) are never
// persisted and never logged — only the SHA-256 hash produced by
// `hashToken` reaches the database. Callers must keep that invariant; this
// module cannot enforce it by itself.

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Encode bytes as base64url, no padding (RFC 4648 §5). */
function toBase64Url(bytes: Uint8Array): string {
  // Web Crypto has no native base64url encoder, so build it from the
  // standard alphabet 6 bits at a time — avoids depending on `btoa` (not
  // guaranteed for arbitrary byte values) or any Node buffer API.
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL_CHARS[(value >>> bits) & 0x3f];
    }
  }

  if (bits > 0) {
    out += BASE64URL_CHARS[(value << (6 - bits)) & 0x3f];
  }

  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/** Generate a fresh random token: 32 random bytes, base64url-encoded, no padding. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** SHA-256 hash of a raw token, hex-encoded. The only form that reaches the database. */
export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time comparison of two equal-length hex strings. Used for the
 * bootstrap token so a mismatch can't be timed character-by-character.
 * Deliberately walks the full length instead of early-returning on the
 * first differing byte; a length mismatch alone is not secret-dependent
 * (hex digests of hashed input are always the same length) so it is safe to
 * check separately.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}
