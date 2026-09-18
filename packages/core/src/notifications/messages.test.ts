import { describe, expect, it } from "vitest";
import { encodePayload, newTakesMessage, songMessage, weeklyMessage } from "./messages.js";

describe("newTakesMessage", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");

  it("names the event by title when one is set, regardless of kind", () => {
    const msg = newTakesMessage(
      "en",
      {
        id: "ev1",
        kind: "rehearsal",
        title: "Chorus retake",
        heldAt: Date.parse("2026-09-16T18:00:00Z"),
      },
      14,
      now,
    );
    expect(msg.title).toBe("New takes");
    expect(msg.body).toBe("Chorus retake (14)");
    expect(msg.url).toBe("/events/ev1");
    expect(msg.tag).toBe("takes:ev1");
  });

  it("names an untitled event by kind and weekday, in Prague time, in English", () => {
    // 2026-09-16T23:30:00Z is a Wednesday in UTC; Prague is CEST (UTC+2), so
    // locally it is already Thursday 01:30.
    const msg = newTakesMessage(
      "en",
      { id: "ev2", kind: "rehearsal", title: null, heldAt: Date.parse("2026-09-16T23:30:00Z") },
      14,
      now,
    );
    expect(msg.body).toBe("From Thursday's rehearsal (14)");
  });

  it("gives an untitled rehearsal the Czech feminine genitive, capitalized", () => {
    const msg = newTakesMessage(
      "cs",
      { id: "ev3", kind: "rehearsal", title: null, heldAt: Date.parse("2026-09-16T23:30:00Z") },
      14,
      now,
    );
    expect(msg.body).toBe("Ze čtvrteční zkoušky (14)");
  });

  it("gives an untitled concert the Czech masculine genitive, with the preposition the WEEKDAY takes", () => {
    const msg = newTakesMessage(
      "cs",
      { id: "ev4", kind: "concert", title: null, heldAt: Date.parse("2026-09-16T23:30:00Z") },
      14,
      now,
    );
    // Thursday ("čtvrtečního") takes "ze", regardless of "koncertu" itself
    // starting with a consonant that alone would take "z".
    expect(msg.body).toBe("Ze čtvrtečního koncertu (14)");
  });

  it("gives an untitled session the neuter genitive of studio, matching the UI's word for a session", () => {
    const msg = newTakesMessage(
      "cs",
      { id: "ev5", kind: "session", title: null, heldAt: Date.parse("2026-09-16T23:30:00Z") },
      14,
      now,
    );
    expect(msg.body).toBe("Ze čtvrtečního studia (14)");
  });

  it("picks the preposition 'z' for a weekday whose word starts cleanly — Friday rehearsal", () => {
    // 2026-09-11T10:00:00Z is Friday in Prague, 6 days before `now`.
    const msg = newTakesMessage(
      "cs",
      { id: "ev8", kind: "rehearsal", title: null, heldAt: Date.parse("2026-09-11T10:00:00Z") },
      1,
      now,
    );
    expect(msg.body).toBe("Z páteční zkoušky (1)");
  });

  it("picks the preposition 'ze' for a weekday whose word needs it — Saturday concert", () => {
    // 2026-09-12T10:00:00Z is Saturday in Prague, 5 days before `now`.
    const msg = newTakesMessage(
      "cs",
      { id: "ev9", kind: "concert", title: null, heldAt: Date.parse("2026-09-12T10:00:00Z") },
      1,
      now,
    );
    expect(msg.body).toBe("Ze sobotního koncertu (1)");
  });

  it("falls back to a date, not a weekday, when the event is more than 6 days old", () => {
    // now = 2026-09-17T12:00:00Z; an event 9 calendar days earlier in Prague.
    const heldAt = Date.parse("2026-09-08T10:00:00Z");
    const msg = newTakesMessage("cs", { id: "ev6", kind: "concert", title: null, heldAt }, 3, now);
    expect(msg.body).toBe("Z koncertu 8. 9. (3)");
  });

  it("gives an untitled, dated session the neuter genitive of studio", () => {
    const heldAt = Date.parse("2026-09-08T10:00:00Z");
    const msg = newTakesMessage("cs", { id: "ev10", kind: "session", title: null, heldAt }, 3, now);
    expect(msg.body).toBe("Ze studia 8. 9. (3)");
  });

  it("still uses the weekday at exactly 6 days old", () => {
    const heldAt = Date.parse("2026-09-11T10:00:00Z"); // 6 days before 2026-09-17
    const msg = newTakesMessage("cs", { id: "ev7", kind: "concert", title: null, heldAt }, 1, now);
    expect(msg.body).not.toMatch(/\d+\. \d+\./);
  });

  it("treats an empty-string title the same as no title, falling back to weekday/date", () => {
    const msg = newTakesMessage(
      "en",
      { id: "ev11", kind: "rehearsal", title: "", heldAt: Date.parse("2026-09-16T23:30:00Z") },
      14,
      now,
    );
    expect(msg.body).toBe("From Thursday's rehearsal (14)");
  });
});

describe("weeklyMessage", () => {
  it("says take/is singular for one, in English", () => {
    const msg = weeklyMessage("en", 1);
    expect(msg.title).toBe("Takes waiting for your vote");
    expect(msg.body).toBe("1 take is waiting for your vote.");
    expect(msg.url).toBe("/takes?unvoted=1");
    expect(msg.tag).toBe("weekly");
  });

  it("says takes/are plural for more than one, in English", () => {
    expect(weeklyMessage("en", 7).body).toBe("7 takes are waiting for your vote.");
  });

  it("uses the Czech singular plural class at 1", () => {
    expect(weeklyMessage("cs", 1).body).toBe("Čeká na tebe 1 nahrávka k hlasování.");
  });

  it("uses the Czech 2-4 plural class at 3", () => {
    expect(weeklyMessage("cs", 3).body).toBe("Čekají na tebe 3 nahrávky k hlasování.");
  });

  it("uses the Czech 5+ plural class at 7", () => {
    expect(weeklyMessage("cs", 7).body).toBe("Čeká na tebe 7 nahrávek k hlasování.");
  });
});

describe("songMessage", () => {
  it("announces a new song with its title as the body, in English", () => {
    const msg = songMessage("en", { slug: "our-song", title: "Our Song" }, "created");
    expect(msg.title).toBe("New song");
    expect(msg.body).toBe("Our Song");
    expect(msg.url).toBe("/songs/our-song");
    expect(msg.tag).toBe("song:our-song");
  });

  it("announces a chart edit with the title folded into the body, in English", () => {
    const msg = songMessage("en", { slug: "our-song", title: "Our Song" }, "edited");
    expect(msg.title).toBe("Song updated");
    expect(msg.body).toBe("Chords or lyrics: Our Song");
  });

  it("announces a new song in Czech", () => {
    const msg = songMessage("cs", { slug: "nase-pisen", title: "Naše píseň" }, "created");
    expect(msg.title).toBe("Nová skladba");
    expect(msg.body).toBe("Naše píseň");
  });

  it("announces a chart edit in Czech", () => {
    const msg = songMessage("cs", { slug: "nase-pisen", title: "Naše píseň" }, "edited");
    expect(msg.title).toBe("Změna ve skladbě");
    expect(msg.body).toBe("Akordy nebo text: Naše píseň");
  });
});

describe("encodePayload", () => {
  it("encodes as versioned JSON with the four fields", () => {
    const json = encodePayload({ title: "T", body: "B", url: "/u", tag: "tg" });
    expect(JSON.parse(json)).toEqual({ v: 1, title: "T", body: "B", url: "/u", tag: "tg" });
  });

  it("throws when the encoded payload exceeds 3000 UTF-8 bytes", () => {
    const huge = { title: "T", body: "x".repeat(3100), url: "/u", tag: "tg" };
    expect(() => encodePayload(huge)).toThrow();
  });

  it("does not throw right at the boundary", () => {
    // Build a payload whose JSON encoding is exactly <= 3000 bytes.
    const shell = JSON.stringify({ v: 1, title: "", body: "", url: "", tag: "" });
    const budget = 3000 - shell.length;
    const msg = { title: "", body: "x".repeat(budget), url: "", tag: "" };
    expect(() => encodePayload(msg)).not.toThrow();
  });

  it("throws on a multibyte body that is under the character count but over the byte budget", () => {
    // "č" is 2 bytes in UTF-8 — 1600 of them is 3200 bytes, over the limit,
    // even though `body.length` (1600) alone would look safely under 3000.
    const msg = { title: "T", body: "č".repeat(1600), url: "/u", tag: "tg" };
    expect(() => encodePayload(msg)).toThrow();
  });
});
