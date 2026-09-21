// Web Push over Web Crypto — the real `PushSender`, built on
// `@block65/webcrypto-web-push` (verified in workerd delivering to a real
// Android device). `buildPushPayload` does
// the actual encryption/signing and returns a fetch `RequestInit`; this
// module's only job is the status-code-to-`PushResult` mapping and making
// sure `send` truly never throws.
import type { PushResult, PushSender, PushSendOptions, PushTarget } from "@bandplate/core";
import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { VapidConfig } from "./vapid.js";

// RFC 8030 §5.3's push-message-topic header is capped by push services at
// 32 URL-safe characters; anything else is stripped, then truncated.
const MAX_TOPIC_LENGTH = 32;
const TOPIC_UNSAFE = /[^A-Za-z0-9_-]/g;

function sanitizeTopic(topic: string): string {
  return topic.replace(TOPIC_UNSAFE, "-").slice(0, MAX_TOPIC_LENGTH);
}

const BODY_SNIPPET_LENGTH = 200;

export function createWebPushSender(
  vapid: VapidConfig,
  fetchImpl: typeof fetch = fetch,
): PushSender {
  return {
    async send(target: PushTarget, payload: string, options: PushSendOptions): Promise<PushResult> {
      try {
        // JSON.parse's return type is `any`, which is what lets this satisfy
        // the library's `Jsonifiable` constraint without us re-declaring it.
        const data = JSON.parse(payload);

        const init = await buildPushPayload(
          {
            data,
            options: {
              ttl: options.ttlSeconds,
              urgency: options.urgency,
              topic: options.topic === undefined ? undefined : sanitizeTopic(options.topic),
            },
          },
          {
            endpoint: target.endpoint,
            expirationTime: null,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        );

        const res = await fetchImpl(target.endpoint, init as RequestInit);

        if (res.status === 200 || res.status === 201 || res.status === 202) {
          return { kind: "ok" };
        }
        if (res.status === 404 || res.status === 410) {
          return { kind: "gone" };
        }

        const body = await res.text().catch(() => "");
        return { kind: "failed", status: res.status, reason: body.slice(0, BODY_SNIPPET_LENGTH) };
      } catch (err) {
        return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
