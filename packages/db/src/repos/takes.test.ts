import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema } from "../client.js";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as events from "./events.js";
import * as instruments from "./instruments.js";
import * as songs from "./songs.js";
import * as takes from "./takes.js";

describe("takes.listByInstruments", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;
  let drumsId: string;
  let guitarId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();

    const song = await songs.create(db, {
      title: "AND Semantics Song",
      slug: "and-semantics-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;

    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;

    bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
    drumsId = (await instruments.create(db, { slug: "drums", label: "Drums" })).id;
    guitarId = (await instruments.create(db, { slug: "guitar", label: "Guitar" })).id;
  });

  it("matches a take with {bass, drums} when querying for {bass} alone", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [bassId]);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("matches a take with {bass, drums} when querying for {bass, drums}", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [bassId, drumsId]);
    expect(result.map((t) => t.id)).toContain(take.id);
  });

  it("does NOT match a take with only {bass} when querying for {bass, drums} (AND, not OR)", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const result = await takes.listByInstruments(db, [bassId, drumsId]);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("does not match on an unrelated instrument", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId, drumsId],
    });

    const result = await takes.listByInstruments(db, [guitarId]);
    expect(result.map((t) => t.id)).not.toContain(take.id);
  });

  it("returns an empty array for an empty instrument list", async () => {
    const result = await takes.listByInstruments(db, []);
    expect(result).toEqual([]);
  });
});

describe("takes.create atomicity", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let bassId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const now = Date.now();

    const song = await songs.create(db, {
      title: "Atomicity Song",
      slug: "atomicity-song",
      createdAt: now,
      updatedAt: now,
    });
    songId = song.id;

    const event = await events.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    eventId = event.id;

    bassId = (await instruments.create(db, { slug: "bass", label: "Bass" })).id;
  });

  it("produces the take and all its take_instruments rows together", async () => {
    const now = Date.now();
    const take = await takes.create(db, {
      songId,
      eventId,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bassId],
    });

    const persisted = await takes.getById(db, take.id);
    expect(persisted).toBeDefined();

    const linked = await takes.listByInstruments(db, [bassId]);
    expect(linked.map((t) => t.id)).toContain(take.id);
  });

  /**
   * Proves the batch is atomic in the way that matters: a take insert paired
   * with a take_instruments insert that violates a foreign key must leave
   * BOTH statements rolled back, never a take with zero take_instruments
   * rows. If takes.create still issued two separate round trips (insert
   * take, then insert take_instruments), the take row from the first
   * statement would survive here even though the second one failed — which
   * is exactly the silent-orphan bug the fix eliminates.
   */
  it("rolls back the take insert too when the take_instruments insert fails", async () => {
    const now = Date.now();
    const clientRef = "atomic-rollback-probe";

    await expect(
      takes.create(db, {
        songId,
        eventId,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
        clientRef,
        instrumentIds: ["nonexistent-instrument-id"],
      }),
    ).rejects.toThrow();

    const rows = await db.select().from(schema.takes).where(eq(schema.takes.clientRef, clientRef));
    expect(rows).toEqual([]);
  });
});
