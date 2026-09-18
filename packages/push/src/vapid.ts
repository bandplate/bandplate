// VAPID key handling for Web Push (RFC 8292). `publicKey` is the
// base64url encoding of the 65-byte uncompressed P-256 point (87 chars),
// `privateKey` is the base64url encoding of the raw 32-byte scalar `d` (43
// chars) — the same shape `@block65/webcrypto-web-push`'s `vapidHeaders`
// expects to re-import as a JWK.
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PUBLIC_KEY_LENGTH = 87;
const PRIVATE_KEY_LENGTH = 43;

/** [] means the config is valid; otherwise each entry is a human-readable problem. */
export function validateVapidConfig(config: VapidConfig): string[] {
  const problems: string[] = [];

  if (config.publicKey.length !== PUBLIC_KEY_LENGTH || !BASE64URL.test(config.publicKey)) {
    problems.push(
      `publicKey must be ${PUBLIC_KEY_LENGTH} base64url characters (the uncompressed P-256 point), got ${config.publicKey.length} characters`,
    );
  }

  if (config.privateKey.length !== PRIVATE_KEY_LENGTH || !BASE64URL.test(config.privateKey)) {
    problems.push(
      `privateKey must be ${PRIVATE_KEY_LENGTH} base64url characters (the raw scalar d), got ${config.privateKey.length} characters`,
    );
  }

  if (!(config.subject.startsWith("mailto:") || config.subject.startsWith("https:"))) {
    problems.push(
      `subject must start with "mailto:" or "https:", got ${JSON.stringify(config.subject)}`,
    );
  }

  return problems;
}

/** A short, stable identifier for a public key — first 16 chars, for logs/diagnostics. */
export function vapidKeyId(publicKey: string): string {
  return publicKey.slice(0, 16);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generates a fresh VAPID key pair. Used interactively by `scripts/generate-vapid-keys.ts`. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);

  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  if (!jwk.d) {
    throw new Error('generateVapidKeys: exported JWK had no "d" (private scalar)');
  }

  return {
    publicKey: bytesToBase64Url(new Uint8Array(rawPublicKey)),
    // JWK octet-sequence members are already base64url per RFC 7518 §6.2.1.2.
    privateKey: jwk.d,
  };
}
