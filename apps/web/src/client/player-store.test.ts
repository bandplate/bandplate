import { afterEach, describe, expect, it } from "vitest";
import { audioUrl, peaksUrl, shareScope, sourcesUrl } from "./player-store.js";

describe("the player's asset URLs", () => {
  afterEach(() => {
    shareScope.set(null);
  });

  it("go through the member API by default", () => {
    expect(audioUrl("a1")).toBe("/api/assets/a1/audio");
    expect(peaksUrl("a1")).toBe("/api/assets/a1/peaks");
    expect(sourcesUrl("t1")).toBe("/api/takes/t1/sources");
  });

  it("go through a public link's own routes on its page", () => {
    shareScope.set("Kp3xW9aQ2m");
    expect(audioUrl("a1")).toBe("/api/public/Kp3xW9aQ2m/assets/a1/audio");
    expect(peaksUrl("a1")).toBe("/api/public/Kp3xW9aQ2m/assets/a1/peaks");
    expect(sourcesUrl("t1")).toBe("/api/public/Kp3xW9aQ2m/takes/t1/sources");
  });
});
