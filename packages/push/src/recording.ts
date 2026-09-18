// Test double for `PushSender`: records every send instead of doing
// anything with it. Used by this package's own tests, and by later tasks'
// E2E/route tests to assert on exactly what would have been sent — mirrors
// `@bandplate/mail`'s `createCapturingMailer`.
import type { PushResult, PushSendOptions, PushSender, PushTarget } from "@bandplate/core";

export interface RecordedPush {
  target: PushTarget;
  payload: string;
  options: PushSendOptions;
}

export function createRecordingPushSender(
  results?: (target: PushTarget) => PushResult,
): PushSender & { sent: RecordedPush[] } {
  const sent: RecordedPush[] = [];

  return {
    sent,
    async send(target, payload, options): Promise<PushResult> {
      sent.push({ target, payload, options });
      return results ? results(target) : { kind: "ok" };
    },
  };
}
