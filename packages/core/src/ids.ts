// UUIDv7 generation — runtime-agnostic (Web Crypto only, no node:crypto).
//
// Layout (RFC 9562):
//   48 bits  unix_ts_ms   big-endian milliseconds since epoch
//    4 bits  version      fixed 0111 (7)
//   12 bits  rand_a       random, monotonic counter for same-ms collisions
//    2 bits  variant      fixed 10
//   62 bits  rand_b       random
//
// Monotonicity within the same millisecond is achieved by carrying a
// per-millisecond counter seeded from randomness: when two calls land in the
// same ms, the counter is incremented so the generated string still sorts
// after the previous one.

const RANDOM_BYTES_LENGTH = 10; // rand_a (12 bits, packed into 2 bytes) + rand_b (62 bits, 8 bytes)

let lastTimestampMs = -1;
// 12-bit counter (0..4095) used to keep same-millisecond IDs monotonically
// increasing. Seeded randomly per millisecond, then incremented.
let counter = 0;

function randomUint12(): number {
  const buf = new Uint8Array(2);
  globalThis.crypto.getRandomValues(buf);
  return (((buf[0] ?? 0) << 8) | (buf[1] ?? 0)) & 0x0fff;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Generate a UUIDv7 string. IDs generated within the same millisecond are
 * monotonically sortable as strings (a counter is carried across calls in
 * that millisecond).
 */
export function uuidv7(): string {
  const nowMs = Date.now();

  if (nowMs > lastTimestampMs) {
    lastTimestampMs = nowMs;
    counter = randomUint12();
  } else {
    // nowMs <= lastTimestampMs: either genuinely the same millisecond, or
    // the wall clock hasn't caught up yet with a `lastTimestampMs` we
    // previously bumped forward below (or even ticked slightly backward,
    // e.g. an NTP adjustment). Either way, never move the timestamp
    // backward — keep incrementing off `lastTimestampMs`, which is exactly
    // what preserves monotonicity when a tight loop generates thousands of
    // IDs faster than the clock resolution.
    counter = (counter + 1) & 0x0fff;
    // If the 12-bit counter wraps, bump the timestamp forward by 1ms so
    // ordering is preserved rather than silently wrapping back to 0.
    if (counter === 0) {
      lastTimestampMs += 1;
    }
  }

  const ts = lastTimestampMs;
  const bytes = new Uint8Array(16);

  // 48-bit big-endian timestamp (bytes 0-5).
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts >>> 24) & 0xff;
  bytes[3] = (ts >>> 16) & 0xff;
  bytes[4] = (ts >>> 8) & 0xff;
  bytes[5] = ts & 0xff;

  // Version (4 bits) + top 4 bits of the 12-bit counter (byte 6).
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  // Remaining 8 bits of the counter (byte 7).
  bytes[7] = counter & 0xff;

  // Remaining random bytes: variant bits go into the top of byte 8, the
  // rest (bytes 8-15) are random.
  const rand = new Uint8Array(RANDOM_BYTES_LENGTH - 2);
  globalThis.crypto.getRandomValues(rand);
  bytes[8] = 0x80 | ((rand[0] ?? 0) & 0x3f);
  for (let i = 1; i < rand.length; i++) {
    bytes[8 + i] = rand[i] ?? 0;
  }

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
