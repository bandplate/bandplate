import type { notificationPrefsRepo } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import { selectRecipients } from "./recipients.js";

type NotificationPrefs = notificationPrefsRepo.NotificationPrefs;

const MEMBERS = [
  { id: "m1", status: "active", locale: "en" as const },
  { id: "m2", status: "active", locale: "cs" as const },
  { id: "m3", status: "invited", locale: "en" as const },
  { id: "m4", status: "disabled", locale: "en" as const },
];

describe("selectRecipients", () => {
  it("only ever includes active members", () => {
    const prefs = new Map<string, NotificationPrefs>();
    const out = selectRecipients(MEMBERS, prefs, "newTakes");
    expect(out.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("treats a member with no prefs row as all-on", () => {
    const prefs = new Map<string, NotificationPrefs>();
    const out = selectRecipients(MEMBERS, prefs, "weeklyUnvoted");
    expect(out.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("honours an explicit opt-out for the given type only", () => {
    const prefs = new Map<string, NotificationPrefs>([
      ["m1", { newTakes: false, weeklyUnvoted: true, songChanges: true }],
    ]);
    expect(selectRecipients(MEMBERS, prefs, "newTakes").map((m) => m.id)).toEqual(["m2"]);
    expect(
      selectRecipients(MEMBERS, prefs, "weeklyUnvoted")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["m1", "m2"]);
  });

  it("excludes ids in the exclude set even if active and opted in", () => {
    const prefs = new Map<string, NotificationPrefs>();
    const out = selectRecipients(MEMBERS, prefs, "songChanges", new Set(["m1"]));
    expect(out.map((m) => m.id)).toEqual(["m2"]);
  });

  it("carries each recipient's own locale through", () => {
    const prefs = new Map<string, NotificationPrefs>();
    const out = selectRecipients(MEMBERS, prefs, "newTakes");
    expect(out.find((m) => m.id === "m2")?.locale).toBe("cs");
  });
});
