import type { PushTarget } from "@bandplate/core";
import { describe, expect, it } from "vitest";
import { createRecordingPushSender } from "./recording.js";

const target: PushTarget = {
  endpoint: "https://push.example.com/sub-1",
  p256dh: "p256dh-value",
  auth: "auth-value",
};

describe("createRecordingPushSender", () => {
  it("records what was sent and defaults to an ok result", async () => {
    const sender = createRecordingPushSender();
    const result = await sender.send(target, '{"title":"hi"}', { ttlSeconds: 60 });

    expect(result).toEqual({ kind: "ok" });
    expect(sender.sent).toEqual([
      { target, payload: '{"title":"hi"}', options: { ttlSeconds: 60 } },
    ]);
  });

  it("accumulates multiple sends in order", async () => {
    const sender = createRecordingPushSender();
    await sender.send(target, "a", { ttlSeconds: 1 });
    await sender.send(target, "b", { ttlSeconds: 2 });

    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0]?.payload).toBe("a");
    expect(sender.sent[1]?.payload).toBe("b");
  });

  it("uses the results callback, keyed on the target, to decide what to return", async () => {
    const goneTarget: PushTarget = { ...target, endpoint: "https://push.example.com/dead" };
    const sender = createRecordingPushSender((t) =>
      t.endpoint === goneTarget.endpoint ? { kind: "gone" } : { kind: "ok" },
    );

    await expect(sender.send(target, "a", { ttlSeconds: 60 })).resolves.toEqual({ kind: "ok" });
    await expect(sender.send(goneTarget, "a", { ttlSeconds: 60 })).resolves.toEqual({
      kind: "gone",
    });
  });

  it("still records the send even when the results callback reports failure", async () => {
    const sender = createRecordingPushSender(() => ({
      kind: "failed",
      status: 500,
      reason: "boom",
    }));
    await sender.send(target, "a", { ttlSeconds: 60 });
    expect(sender.sent).toHaveLength(1);
  });
});
