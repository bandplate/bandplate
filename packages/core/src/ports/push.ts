// Push port. Implementations (Web Push over Web Crypto, a recording test
// double) live in `@bandplate/push` — this package only declares the shape
// the domain depends on, matching `mailer.ts`'s split.

/** A single browser subscription, as returned by the Push API. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The notification content, already resolved to the recipient's locale. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushSendOptions {
  /** How long the push service should hold the message, in whole seconds. */
  ttlSeconds: number;
  urgency?: "low" | "normal";
  topic?: string;
}

/**
 * `"gone"` means the subscription itself is dead (404/410) — the caller
 * should delete it. `"failed"` means the send didn't succeed for some other
 * reason (bad status, thrown error) and the subscription should be left
 * alone; `status`/`reason` are diagnostic only, never parsed by callers.
 */
export type PushResult =
  | { kind: "ok" }
  | { kind: "gone" }
  | { kind: "failed"; status?: number; reason?: string };

export interface PushSender {
  /** Send one push. Never throws — failures come back as a `PushResult`. */
  send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushResult>;
}
