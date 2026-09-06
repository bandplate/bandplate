import type { Db } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createInstrument,
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
