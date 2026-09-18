import { describe, expect, it } from "vitest";
import { base64UrlToUint8Array, decidePushUiState, subscriptionMatchesKey } from "./push-state.js";

const base = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default" as const,
  standalone: false,
  ios: false,
  subscribed: false,
};

describe("decidePushUiState", () => {
  it("iOS outside standalone -> needs install, even with every API present and granted", () => {
    expect(decidePushUiState({ ...base, ios: true, permission: "granted", subscribed: true })).toBe(
      "ios-needs-install",
    );
  });

  it("iOS inside standalone falls through to the normal checks", () => {
    expect(decidePushUiState({ ...base, ios: true, standalone: true })).toBe("off");
  });

  it("no service worker -> unsupported", () => {
    expect(decidePushUiState({ ...base, hasServiceWorker: false })).toBe("unsupported");
  });

  it("no PushManager -> unsupported", () => {
    expect(decidePushUiState({ ...base, hasPushManager: false })).toBe("unsupported");
  });

  it("no Notification API -> unsupported", () => {
    expect(decidePushUiState({ ...base, hasNotification: false })).toBe("unsupported");
  });

  it("permission denied -> denied", () => {
    expect(decidePushUiState({ ...base, permission: "denied" })).toBe("denied");
  });

  it("subscribed and granted -> on", () => {
    expect(decidePushUiState({ ...base, permission: "granted", subscribed: true })).toBe("on");
  });

  it("subscribed but permission reverted to default -> off, not on", () => {
    // A subscription can outlive a permission revoked out of band (the OS,
    // or the browser's own site settings) — `on` requires both.
    expect(decidePushUiState({ ...base, permission: "default", subscribed: true })).toBe("off");
  });

  it("granted but not subscribed yet -> off", () => {
    expect(decidePushUiState({ ...base, permission: "granted", subscribed: false })).toBe("off");
  });

  it("default permission, not subscribed -> off", () => {
    expect(decidePushUiState(base)).toBe("off");
  });
});

describe("base64UrlToUint8Array", () => {
  it("round-trips through btoa/atob with base64url's substitutions", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 16, 32]);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    const base64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(base64UrlToUint8Array(base64url)).toEqual(bytes);
  });
});

describe("subscriptionMatchesKey", () => {
  const bytes = new Uint8Array([10, 20, 30, 40]);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const publicKey = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("null key -> no match", () => {
    expect(subscriptionMatchesKey(null, publicKey)).toBe(false);
  });

  it("identical bytes -> match", () => {
    expect(subscriptionMatchesKey(bytes.buffer, publicKey)).toBe(true);
  });

  it("different length -> no match", () => {
    const shorter = new Uint8Array([10, 20, 30]);
    expect(subscriptionMatchesKey(shorter.buffer, publicKey)).toBe(false);
  });

  it("same length, different bytes -> no match", () => {
    const different = new Uint8Array([10, 20, 30, 41]);
    expect(subscriptionMatchesKey(different.buffer, publicKey)).toBe(false);
  });
});
