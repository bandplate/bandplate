// The M8 write half of `server/pages/events.ts`.
import type { Db } from "@bandplate/db";
import { eventsRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countArchivedEvents,
  createEvent,
  listEventsForArchive,
  parseEventsListArchivedFilter,
  setEventArchived,
  updateEvent,
} from "./events.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const REHEARSAL = {
  kind: "rehearsal",
  heldAt: "2026-07-08",
  venue: "The Attic",
  title: "",
  notes: "",
};

describe("createEvent", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates the event and files it at LOCAL midnight on the day typed", async () => {
    const result = await createEvent(db, 1000, formData(REHEARSAL));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.event.kind).toBe("rehearsal");
    expect(result.event.venue).toBe("The Attic");
    expect(result.event.title).toBeNull();

    // The bug this guards: `new Date("2026-07-08")` is UTC midnight, which in
    // any timezone east of the meridian is still 7 July locally — the event
    // would file itself under the wrong day for the person who typed it.
    const held = new Date(result.event.heldAt);
    expect(held.getFullYear()).toBe(2026);
    expect(held.getMonth()).toBe(6);
    expect(held.getDate()).toBe(8);
    expect(held.getHours()).toBe(0);
  });

  it("has no clientRef — that key belongs to the bridge", async () => {
    const result = await createEvent(db, 1000, formData(REHEARSAL));
    if (result.kind !== "ok") return;
    expect(result.event.clientRef).toBeNull();
  });

  it("reports an event of the same kind already on that day, and still creates", async () => {
    const first = await createEvent(db, 1000, formData(REHEARSAL));
    if (first.kind !== "ok") return;

    const second = await createEvent(db, 2000, formData(REHEARSAL));

    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    // A warning, not a refusal: an afternoon and an evening rehearsal on one
    // day is real. See `createEvent`'s doc comment.
    expect(second.sameDay.map((e) => e.id)).toEqual([first.event.id]);
    expect(await eventsRepo.listRecent(db)).toHaveLength(2);
  });

  it("does not warn about a different kind on the same day", async () => {
    await createEvent(db, 1000, formData(REHEARSAL));
    const concert = await createEvent(db, 2000, formData({ ...REHEARSAL, kind: "concert" }));
    if (concert.kind !== "ok") return;
    expect(concert.sameDay).toEqual([]);
  });

  it("does not warn about the same kind on the neighbouring day", async () => {
    await createEvent(db, 1000, formData(REHEARSAL));
    const next = await createEvent(db, 2000, formData({ ...REHEARSAL, heldAt: "2026-07-09" }));
    if (next.kind !== "ok") return;
    expect(next.sameDay).toEqual([]);
  });

  it("rejects a missing date against the date field", async () => {
    const result = await createEvent(db, 1000, formData({ ...REHEARSAL, heldAt: "" }));
    expect(result).toEqual({
      kind: "invalid",
      error: "Enter the date it was held.",
      field: "heldAt",
    });
  });

  it("rejects a date that isn't one", async () => {
    const result = await createEvent(db, 1000, formData({ ...REHEARSAL, heldAt: "8 July" }));
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("heldAt");
  });

  it("rejects an unknown kind against the kind field", async () => {
    const result = await createEvent(db, 1000, formData({ ...REHEARSAL, kind: "wedding" }));
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.field).toBe("kind");
  });
});

describe("updateEvent", () => {
  let db: Db;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    const created = await createEvent(db, 1000, formData(REHEARSAL));
    if (created.kind !== "ok") throw new Error("seed failed");
    id = created.event.id;
  });

  it("saves the edited fields and bumps updatedAt", async () => {
    const result = await updateEvent(
      db,
      2000,
      id,
      formData({ ...REHEARSAL, kind: "concert", venue: "The Cellar", notes: "sold out" }),
    );

    expect(result.kind).toBe("ok");
    const after = await eventsRepo.getById(db, id);
    expect(after?.kind).toBe("concert");
    expect(after?.venue).toBe("The Cellar");
    expect(after?.notes).toBe("sold out");
    expect(after?.updatedAt).toBe(2000);
  });

  it("clears a venue that was emptied", async () => {
    await updateEvent(db, 2000, id, formData({ ...REHEARSAL, venue: "" }));
    expect((await eventsRepo.getById(db, id))?.venue).toBeNull();
  });

  it("reports not_found for an id that isn't there", async () => {
    const result = await updateEvent(db, 2000, "nope", formData(REHEARSAL));
    expect(result).toEqual({ kind: "not_found" });
  });
});

describe("archiving events", () => {
  let db: Db;
  let id: string;

  beforeEach(async () => {
    db = await createTestDb();
    const created = await createEvent(db, 1000, formData(REHEARSAL));
    if (created.kind !== "ok") throw new Error("seed failed");
    id = created.event.id;
    await createEvent(db, 1000, formData({ ...REHEARSAL, heldAt: "2026-08-12" }));
  });

  it("takes an event out of the archive listing and into the archived view", async () => {
    await setEventArchived(db, 3000, id, true);

    expect(await listEventsForArchive(db, [])).toHaveLength(1);
    const archived = await listEventsForArchive(db, [], true);
    expect(archived.map((e) => e.id)).toEqual([id]);
    expect(await countArchivedEvents(db)).toBe(1);
  });

  it("puts it back", async () => {
    await setEventArchived(db, 3000, id, true);
    await setEventArchived(db, 4000, id, false);

    expect(await listEventsForArchive(db, [])).toHaveLength(2);
    expect(await countArchivedEvents(db)).toBe(0);
  });

  it("reports not_found rather than silently succeeding", async () => {
    expect(await setEventArchived(db, 3000, "nope", true)).toEqual({ kind: "not_found" });
  });
});

describe("parseEventsListArchivedFilter", () => {
  it("reads only an explicit 1", () => {
    expect(parseEventsListArchivedFilter(new URLSearchParams("archived=1"))).toBe(true);
    expect(parseEventsListArchivedFilter(new URLSearchParams("archived=0"))).toBe(false);
    expect(parseEventsListArchivedFilter(new URLSearchParams(""))).toBe(false);
  });
});
