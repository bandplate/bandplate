// The M8 write half of `server/pages/events.ts`.
import type { Db } from "@bandplate/db";
import { eventsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countArchivedEvents,
  createEvent,
  getEventPageData,
  listEventsForArchive,
  mergeEvents,
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
      error: "heldAtRequired",
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

    expect((await listEventsForArchive(db, [], false, { limit: 25, offset: 0 })).rows).toHaveLength(
      1,
    );
    const { rows: archived } = await listEventsForArchive(db, [], true, { limit: 25, offset: 0 });
    expect(archived.map((e) => e.id)).toEqual([id]);
    expect(await countArchivedEvents(db)).toBe(1);
  });

  it("puts it back", async () => {
    await setEventArchived(db, 3000, id, true);
    await setEventArchived(db, 4000, id, false);

    expect((await listEventsForArchive(db, [], false, { limit: 25, offset: 0 })).rows).toHaveLength(
      2,
    );
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

describe("mergeEvents", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function seedPair() {
    // The exact shape the duplicate takes: a member made the rehearsal, then
    // the bridge pushed its own with a clientRef.
    const manual = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    const fromBridge = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1000,
      clientRef: "reaper-abc",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const song = await songsRepo.create(db, {
      title: "Neon Skyline",
      slug: "neon-skyline",
      createdAt: 1000,
      updatedAt: 1000,
    });
    const onManual = await takesRepo.create(db, {
      songId: song.id,
      eventId: manual.id,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
    });
    return { manual, fromBridge, onManual };
  }

  it("moves the takes, archives the shell, and hands over the bridge's key", async () => {
    const { manual, fromBridge, onManual } = await seedPair();

    const result = await mergeEvents(db, 5000, fromBridge.id, manual.id);

    expect(result).toEqual({ kind: "ok", keptId: fromBridge.id, movedTakes: 1 });
    expect((await takesRepo.getById(db, onManual.id))?.eventId).toBe(fromBridge.id);
    // Archived, not deleted — a favourite pointing at it still resolves.
    expect((await eventsRepo.getById(db, manual.id))?.archivedAt).toBe(5000);
    expect((await takesRepo.listByEvent(db, manual.id, { order: "asc" })).rows).toEqual([]);
  });

  it("gives the survivor the key when it had none", async () => {
    const { manual, fromBridge } = await seedPair();

    // The other direction: keep the MANUAL event. Without inheriting the key,
    // the bridge's next push would recreate the split it just repaired.
    await mergeEvents(db, 5000, manual.id, fromBridge.id);

    expect((await eventsRepo.getById(db, manual.id))?.clientRef).toBe("reaper-abc");
    expect(await eventsRepo.getByClientRef(db, "reaper-abc")).toMatchObject({ id: manual.id });
  });

  it("leaves a key the survivor already has alone", async () => {
    const { manual, fromBridge } = await seedPair();
    await eventsRepo.setClientRef(db, manual.id, "reaper-manual", 2000);

    await mergeEvents(db, 5000, fromBridge.id, manual.id);

    expect((await eventsRepo.getById(db, fromBridge.id))?.clientRef).toBe("reaper-abc");
  });

  it("refuses to merge an event into itself", async () => {
    const { manual } = await seedPair();
    expect(await mergeEvents(db, 5000, manual.id, manual.id)).toEqual({ kind: "same_event" });
  });

  it("reports not_found when either side is missing", async () => {
    const { manual } = await seedPair();
    expect(await mergeEvents(db, 5000, manual.id, "nope")).toEqual({ kind: "not_found" });
    expect(await mergeEvents(db, 5000, "nope", manual.id)).toEqual({ kind: "not_found" });
  });

  it("never merges a personal event, from either side", async () => {
    const { manual } = await seedPair();
    const personal = await eventsRepo.findOrCreatePersonal(db, {
      memberId: "m-filip",
      dayKey: "1970-01-01",
      heldAt: 1000,
      now: 1000,
    });

    expect(await mergeEvents(db, 5000, manual.id, personal.id)).toEqual({ kind: "not_found" });
    expect(await mergeEvents(db, 5000, personal.id, manual.id)).toEqual({ kind: "not_found" });
    // Nothing moved, nothing archived.
    expect((await eventsRepo.getById(db, personal.id))?.archivedAt).toBeNull();
    expect((await eventsRepo.getById(db, manual.id))?.archivedAt).toBeNull();
    expect(await takesRepo.countByEvent(db, manual.id)).toBe(1);
  });
});

/** What the event page's same-day warning lists, through its own loader. */
async function sameDayOf(db: Db, event: eventsRepo.Event) {
  const url = new URL(`/events/${event.id}`, "http://band.test");
  return (await getEventPageData(db, { url, id: event.id, memberId: "m-viewer" })).sameDay;
}

describe("the event page's same-day events", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("finds another event of the same kind on the same day, and not itself", async () => {
    const morning = await createEvent(db, 1000, formData(REHEARSAL));
    const evening = await createEvent(db, 2000, formData(REHEARSAL));
    if (morning.kind !== "ok" || evening.kind !== "ok") throw new Error("seed failed");

    const found = await sameDayOf(db, morning.event);
    expect(found.map((e) => e.id)).toEqual([evening.event.id]);
  });

  it("ignores a different kind, a different day, and an archived one", async () => {
    const base = await createEvent(db, 1000, formData(REHEARSAL));
    if (base.kind !== "ok") throw new Error("seed failed");
    await createEvent(db, 2000, formData({ ...REHEARSAL, kind: "concert" }));
    await createEvent(db, 2000, formData({ ...REHEARSAL, heldAt: "2026-07-09" }));
    const archived = await createEvent(db, 2000, formData(REHEARSAL));
    if (archived.kind !== "ok") throw new Error("seed failed");
    await setEventArchived(db, 3000, archived.event.id, true);

    expect(await sameDayOf(db, base.event)).toEqual([]);
  });

  it("never offers a personal event a same-day duplicate", async () => {
    // Two members' stash days on one date are two days, not a split one.
    const filip = await eventsRepo.findOrCreatePersonal(db, {
      memberId: "m-filip",
      dayKey: "1970-01-01",
      heldAt: 1000,
      now: 1000,
    });
    await eventsRepo.findOrCreatePersonal(db, {
      memberId: "m-jana",
      dayKey: "1970-01-01",
      heldAt: 2000,
      now: 2000,
    });

    expect(await sameDayOf(db, filip)).toEqual([]);
  });
});
