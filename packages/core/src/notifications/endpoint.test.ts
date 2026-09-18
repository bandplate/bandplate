import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./endpoint.js";

describe("isAllowedPushEndpoint", () => {
  it("allows Chrome/FCM", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc123")).toBe(true);
  });

  it("allows Firefox's push service, with a subdomain", () => {
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(
      true,
    );
  });

  it("allows Safari's web push endpoint", () => {
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QAB1abc")).toBe(true);
  });

  it("allows a *.push.apple.com subdomain other than web.push.apple.com", () => {
    expect(isAllowedPushEndpoint("https://api.push.apple.com/3/device/abc")).toBe(true);
  });

  it("allows Edge/Windows notification service", () => {
    expect(isAllowedPushEndpoint("https://xxx.notify.windows.com/w/abc")).toBe(true);
  });

  it("rejects plain http even to an allowed host", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(isAllowedPushEndpoint("https://localhost:8787/fake-push")).toBe(false);
  });

  it("rejects a bare IP address", () => {
    expect(isAllowedPushEndpoint("https://203.0.113.7/fake-push")).toBe(false);
  });

  it("rejects an unrelated host", () => {
    expect(isAllowedPushEndpoint("https://evil.example.com/fcm/send/abc")).toBe(false);
  });

  it("rejects a host that merely contains an allowed one", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example.com/x")).toBe(false);
  });

  it("rejects garbage that isn't a URL at all", () => {
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});
