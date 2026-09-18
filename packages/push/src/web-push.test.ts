import type { PushTarget } from "@bandplate/core";
// Uses real VAPID keys and a real (fake-subscriber) EC key pair so
// `buildPushPayload` runs its actual signing/encryption — only `fetch` is
// stubbed. This is what proves the outgoing request shape, not just our own
// code's belief about it.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type VapidConfig, generateVapidKeys } from "./vapid.js";
import { createWebPushSender } from "./web-push.js";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fakeSubscriberTarget(
  endpoint = "https://push.example.com/subscriber-1",
): Promise<PushTarget> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    p256dh: toBase64Url(new Uint8Array(rawPublicKey)),
    auth: toBase64Url(auth),
  };
}

describe("createWebPushSender", () => {
  let vapid: VapidConfig;
  let target: PushTarget;

  beforeAll(async () => {
    const keys = await generateVapidKeys();
    vapid = { ...keys, subject: "mailto:ops@example.com" };
    target = await fakeSubscriberTarget();
  });

  it.each([201, 200, 202])("maps status %d to ok", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);

    const result = await sender.send(target, JSON.stringify({ title: "hi" }), { ttlSeconds: 60 });

    expect(result).toEqual({ kind: "ok" });
  });

  it.each([404, 410])("maps status %d to gone", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);

    const result = await sender.send(target, JSON.stringify({ title: "hi" }), { ttlSeconds: 60 });

    expect(result).toEqual({ kind: "gone" });
  });

  it("maps a 500 to failed, with the status and a snippet of the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("server exploded", { status: 500 }));
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);

    const result = await sender.send(target, JSON.stringify({ title: "hi" }), { ttlSeconds: 60 });

    expect(result).toMatchObject({ kind: "failed", status: 500 });
    expect(result.kind === "failed" && result.reason).toContain("server exploded");
  });

  it("never throws: a fetch rejection comes back as a failed result instead", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);

    const result = await sender.send(target, JSON.stringify({ title: "hi" }), { ttlSeconds: 60 });

    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.reason).toContain("network down");
  });

  it("never throws: a non-https endpoint (rejected by the library) comes back as failed too", async () => {
    const fetchImpl = vi.fn();
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);
    const httpTarget = await fakeSubscriberTarget("http://push.example.com/insecure");

    const result = await sender.send(httpTarget, JSON.stringify({ title: "hi" }), {
      ttlSeconds: 60,
    });

    expect(result.kind).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a vapid authorization header naming this sender's public key, aes128gcm encoding, and the ttl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);

    await sender.send(target, JSON.stringify({ title: "hi", body: "there", url: "/", tag: "t" }), {
      ttlSeconds: 86400,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(target.endpoint);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(headers.authorization).toContain(`k=${vapid.publicKey}`);
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe("86400");
  });

  it("sanitises and truncates a topic to at most 32 URL-safe characters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const sender = createWebPushSender(vapid, fetchImpl as unknown as typeof fetch);

    await sender.send(target, JSON.stringify({ title: "hi" }), {
      ttlSeconds: 60,
      topic: "not a valid topic! ".repeat(5),
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const topic = headers.topic;
    expect(topic).toBeDefined();
    expect(topic?.length).toBeLessThanOrEqual(32);
    expect(topic).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("defaults fetchImpl to the global fetch when none is given", () => {
    const sender = createWebPushSender(vapid);
    expect(sender).toBeDefined();
  });
});
