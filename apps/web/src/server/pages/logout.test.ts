import { describe, expect, it } from "vitest";
import { pushEndpointFromForm } from "./logout.js";

function formWith(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

describe("pushEndpointFromForm", () => {
  it("a real endpoint -> that endpoint", () => {
    expect(pushEndpointFromForm(formWith({ pushEndpoint: "https://push.example.com/a" }))).toBe(
      "https://push.example.com/a",
    );
  });

  it("the field absent (no-JS submit) -> null, never an error", () => {
    expect(pushEndpointFromForm(new FormData())).toBeNull();
  });

  it("the field present but empty (no subscription on this device) -> null", () => {
    expect(pushEndpointFromForm(formWith({ pushEndpoint: "" }))).toBeNull();
  });

  it("whitespace only -> null, not treated as a real endpoint", () => {
    expect(pushEndpointFromForm(formWith({ pushEndpoint: "   " }))).toBeNull();
  });
});
