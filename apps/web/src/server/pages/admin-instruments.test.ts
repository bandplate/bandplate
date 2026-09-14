import {
  type Db,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addInstrumentAlias,
  aliasesByInstrument,
  createInstrument,
  deleteInstrument,
  listInstruments,
  setInstrumentArchived,
  updateInstrument,
} from "./admin-instruments.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

describe("admin instruments page logic", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates an instrument from a plain form submission", async () => {
    const result = await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    expect(result.kind).toBe("ok");
    expect(await listInstruments(db)).toHaveLength(1);
  });

  it("tags a missing slug's error to the slug field", async () => {
    const result = await createInstrument(db, formData({ slug: "", label: "Bass" }));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("slug");
    }
  });

  it("tags a missing label's error to the label field", async () => {
    const result = await createInstrument(db, formData({ slug: "bass", label: "" }));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.field).toBe("label");
    }
  });

  it("archiving keeps the row (never deletes it) so past takes keep resolving it", async () => {
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");

    const result = await setInstrumentArchived(db, instrument.id, true, 5_000);
    expect(result.kind).toBe("ok");

    const [archived] = await listInstruments(db);
    expect(archived?.id).toBe(instrument.id);
    expect(archived?.archivedAt).toBe(5_000);
  });

  it("unarchiving clears archivedAt", async () => {
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");
    await setInstrumentArchived(db, instrument.id, true, 5_000);

    await setInstrumentArchived(db, instrument.id, false, 9_000);

    const [unarchived] = await listInstruments(db);
    expect(unarchived?.archivedAt).toBeNull();
  });

  it("rename + reorder via updateInstrument", async () => {
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");

    const result = await updateInstrument(
      db,
      instrument.id,
      formData({ label: "Bass guitar", sortOrder: "3" }),
    );
    expect(result.kind).toBe("ok");

    const [updated] = await listInstruments(db);
    expect(updated?.label).toBe("Bass guitar");
    expect(updated?.sortOrder).toBe(3);
  });

  it("saving the sheet is what finishes a stub", async () => {
    // Ingest creates these; nothing in the admin does, so the flag has one
    // direction of travel and the edit form is the end of it.
    const created = await instrumentsRepo.create(db, {
      slug: "melodica",
      label: "Melodica",
      isStub: true,
    });

    const result = await updateInstrument(db, created.id, formData({ label: "Melodica" }));
    expect(result.kind).toBe("ok");

    const updated = await instrumentsRepo.getById(db, created.id);
    expect(updated?.isStub).toBe(false);
  });

  it("leaves an ordinary instrument alone — nothing in the admin MAKES a stub", async () => {
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");
    expect(instrument.isStub).toBe(false);

    await updateInstrument(db, instrument.id, formData({ label: "Bass guitar" }));
    expect((await instrumentsRepo.getById(db, instrument.id))?.isStub).toBe(false);
  });

  it("deletes an instrument nothing points at", async () => {
    await createInstrument(db, formData({ slug: "melodica", label: "Melodica" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");

    expect((await deleteInstrument(db, instrument.id)).kind).toBe("ok");
    expect(await listInstruments(db)).toHaveLength(0);
  });

  it("refuses while a take still references it, and says what is in the way", async () => {
    // The case the whole guard exists for: FKs are never enforced here
    // (`PRAGMA foreign_keys` stays off for D1 parity), so the database would
    // accept this delete and leave the take pointing at nothing.
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");

    // Real song and event rows: `createTestDb` turns foreign keys ON, which
    // production and D1 do not. Worth knowing when reading this guard — the
    // harness is STRICTER than the thing it is testing, so a test can never
    // be the evidence that the orphan case is handled.
    const song = await songsRepo.create(db, {
      title: "Song",
      slug: "song",
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: 1_000,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: 1_000,
      createdAt: 1_000,
      updatedAt: 1_000,
      instrumentIds: [instrument.id],
    });

    const result = await deleteInstrument(db, instrument.id);
    expect(result.kind).toBe("in_use");
    if (result.kind !== "in_use") throw new Error("expected in_use");
    expect(result.usage.takes).toBe(1);
    expect(result.usage.members).toBe(0);
    // Still there. A refused delete must change nothing at all.
    expect(await listInstruments(db)).toHaveLength(1);
  });

  it("counts a member's instrument as use", async () => {
    await createInstrument(db, formData({ slug: "sax", label: "Sax" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");

    const member = await membersRepo.create(db, {
      email: "player@example.test",
      displayName: "Player",
      slug: "player",
      createdAt: 1_000,
    });
    await membersRepo.setInstruments(db, member.id, [instrument.id]);

    const result = await deleteInstrument(db, instrument.id);
    expect(result.kind).toBe("in_use");
    if (result.kind !== "in_use") throw new Error("expected in_use");
    expect(result.usage.members).toBe(1);
  });

  it("records another slug for an instrument", async () => {
    await createInstrument(db, formData({ slug: "gtr", label: "Guitar" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");

    expect((await addInstrumentAlias(db, instrument.id, formData({ slug: "gtr2" }))).kind).toBe(
      "ok",
    );
    expect((await aliasesByInstrument(db)).get(instrument.id)?.map((a) => a.slug)).toEqual([
      "gtr2",
    ]);
    // Resolvable by either name — the property ingest depends on.
    expect((await instrumentsRepo.findBySlug(db, "gtr2"))?.id).toBe(instrument.id);
    expect((await instrumentsRepo.findBySlug(db, "gtr"))?.id).toBe(instrument.id);
  });

  it("refuses a slug another instrument already owns, and names it", async () => {
    // Instruments and aliases share ONE namespace across two tables, which
    // the UNIQUE index can only half enforce.
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    await createInstrument(db, formData({ slug: "gtr", label: "Guitar" }));
    const guitar = (await listInstruments(db)).find((i) => i.slug === "gtr");
    if (!guitar) throw new Error("expected the guitar");

    const result = await addInstrumentAlias(db, guitar.id, formData({ slug: "bass" }));
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") throw new Error("expected taken");
    expect(result.byLabel).toBe("Bass");
  });

  it("refuses a slug that is already someone's alias", async () => {
    await createInstrument(db, formData({ slug: "bass", label: "Bass" }));
    await createInstrument(db, formData({ slug: "gtr", label: "Guitar" }));
    const bass = (await listInstruments(db)).find((i) => i.slug === "bass");
    const guitar = (await listInstruments(db)).find((i) => i.slug === "gtr");
    if (!bass || !guitar) throw new Error("expected both");

    await addInstrumentAlias(db, bass.id, formData({ slug: "di-2" }));
    const result = await addInstrumentAlias(db, guitar.id, formData({ slug: "di-2" }));
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") throw new Error("expected taken");
    expect(result.byLabel).toBe("Bass");
  });

  it("takes its aliases with it when the instrument is deleted", async () => {
    // An ORPHANED alias is worse than a leaked one, because it still
    // resolves: the next ingest run would map a slug onto a deleted
    // instrument. The schema says `ON DELETE cascade` and that cascade never
    // runs in production, so the repo does it explicitly.
    await createInstrument(db, formData({ slug: "melodica", label: "Melodica" }));
    const [instrument] = await listInstruments(db);
    if (!instrument) throw new Error("expected an instrument");
    await addInstrumentAlias(db, instrument.id, formData({ slug: "melodika" }));

    expect((await deleteInstrument(db, instrument.id)).kind).toBe("ok");
    expect(await instrumentsRepo.listAllAliases(db)).toEqual([]);
    expect(await instrumentsRepo.findBySlug(db, "melodika")).toBeUndefined();
  });

  it("reports not_found for an unknown instrument id", async () => {
    const result = await setInstrumentArchived(
      db,
      "00000000-0000-0000-0000-000000000000",
      true,
      1_000,
    );
    expect(result.kind).toBe("not_found");
  });
});
