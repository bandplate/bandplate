import { beforeEach, describe, expect, it } from "vitest";
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
