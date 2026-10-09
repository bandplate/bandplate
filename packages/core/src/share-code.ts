// The code in a short share link, `/s/<code>`. Runtime-agnostic (Web Crypto
// only), like `ids.ts` next door.
//
// Seven base62 characters: 62^7 is about 3.5 * 10^12 (~41.7 bits). The link
// is the only thing standing between a signed-out visitor and a target's
// title in a link preview, so it has to be unguessable rather than merely
// short; at band scale (hundreds of shared things) a random guess lands on
// a real code about once in ten billion tries.

export const SHARE_CODE_LENGTH = 7;

export const SHARE_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The largest multiple of 62 a byte can hold (4 * 62). A byte at or above it
 * is thrown away rather than folded in with `% 62`, which would make the
 * first eight characters of the alphabet a little likelier than the rest.
 */
const UNBIASED_BYTE_LIMIT = 248;

/** Fills a buffer with random bytes. `crypto.getRandomValues` unless a test swaps it. */
export type RandomBytes = (buffer: Uint8Array<ArrayBuffer>) => void;

const webCryptoBytes: RandomBytes = (buffer) => {
  globalThis.crypto.getRandomValues(buffer);
};

/** A fresh random share code, without modulo bias. */
export function generateShareCode(randomBytes: RandomBytes = webCryptoBytes): string {
  let code = "";
  // Most draws keep 7 of 8 bytes (248/256 survive), so one buffer of 16 is
  // nearly always enough; the loop only matters for an unlucky run.
  const buffer = new Uint8Array(16);
  while (code.length < SHARE_CODE_LENGTH) {
    randomBytes(buffer);
    for (const byte of buffer) {
      if (byte >= UNBIASED_BYTE_LIMIT) {
        continue;
      }
      code += SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length];
      if (code.length === SHARE_CODE_LENGTH) {
        break;
      }
    }
  }
  return code;
}

const SHARE_CODE_SHAPE = new RegExp(`^[0-9A-Za-z]{${SHARE_CODE_LENGTH}}$`);

/** Whether a string could be a share code at all, checked before any lookup. */
export function isShareCode(value: string | undefined | null): value is string {
  return typeof value === "string" && SHARE_CODE_SHAPE.test(value);
}
