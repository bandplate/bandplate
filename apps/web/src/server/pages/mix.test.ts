// `/takes/[id]/mix` composition — which tracks the mixer gets, which of them
// are the requesting member's own, and what it has to admit it cannot mute.
// Against a real test database, like the other loader tests here.
import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getMixData } from "./mix.js";

describe("getMixData", () => {
  let db: Db;
  const now = Date.UTC(2026, 6, 8, 19, 30);

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function member(email: string) {
    return membersRepo.create(db, {
      displayName: email,
      slug: email,
      email,
      createdAt: now,
    });
  }

  async function take(instrumentIds: string[] = []) {
    const song = await songsRepo.create(db, {
      title: "Dub Corner",
      slug: "dub-corner",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      durationMs: 240_000,
      createdAt: now,
      updatedAt: now,
      instrumentIds,
    });
  }

  function asset(
    takeId: string,
    over: Partial<Parameters<typeof assetsRepo.createMany>[1][number]> = {},
  ) {
    const key = `test/${takeId}/${over.kind ?? "stem"}-${over.instrumentId ?? "master"}-${over.tier ?? "lossy"}`;
    return {
      takeId,
      kind: "stem" as const,
      tier: "lossy" as const,
      format: "mp3" as const,
      storageKey: key,
      contentType: "audio/mpeg",
      bytes: 1000,
      status: "ready" as const,
      createdAt: now,
      ...over,
    };
  }

  it("returns undefined for an unknown take — a 404, not a throw", async () => {
    const me = await member("a@example.com");
    expect(
      await getMixData(db, "00000000-0000-0000-0000-000000000000", me.id, "en"),
    ).toBeUndefined();
  });

  it("returns undefined for a take with one stem — the Solo drawer is already that tool", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const t = await take([bass.id]);
    await assetsRepo.createMany(db, [asset(t.id, { instrumentId: bass.id })]);

    expect(await getMixData(db, t.id, me.id, "en")).toBeUndefined();
  });

  it("returns undefined for a take with only a master — there is nothing to balance", async () => {
    const me = await member("a@example.com");
    const t = await take();
    await assetsRepo.createMany(db, [asset(t.id, { kind: "master", instrumentId: null })]);

    expect(await getMixData(db, t.id, me.id, "en")).toBeUndefined();
  });

  it("ignores stems that are not ready yet — half an upload is not a track", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar" });
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id, status: "pending" }),
    ]);

    expect(await getMixData(db, t.id, me.id, "en")).toBeUndefined();
  });

  it("orders stems by the instrument vocabulary, not by asset creation", async () => {
    const me = await member("a@example.com");
    const vox = await instrumentsRepo.create(db, { slug: "vox", label: "Vocal", sortOrder: 9 });
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass", sortOrder: 1 });
    const t = await take([vox.id, bass.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { instrumentId: vox.id }),
      asset(t.id, { instrumentId: bass.id }),
    ]);

    const mix = await getMixData(db, t.id, me.id, "en");
    expect(mix?.tracks.map((track) => track.label)).toEqual(["Bass", "Vocal"]);
  });

  it("leaves the master out entirely — it would double the band it sits beside", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass", sortOrder: 1 });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar", sortOrder: 2 });
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { kind: "master", instrumentId: null }),
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    const mix = await getMixData(db, t.id, me.id, "en");
    expect(mix?.tracks.map((track) => track.kind)).toEqual(["stem", "stem"]);
  });

  it("marks the member's own instruments, and never the master", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass", sortOrder: 1 });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar", sortOrder: 2 });
    await membersRepo.setInstruments(db, me.id, [bass.id]);
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { kind: "master", instrumentId: null }),
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    const mix = await getMixData(db, t.id, me.id, "en");
    expect(mix?.tracks.map((track) => [track.label, track.mine])).toEqual([
      ["Bass", true],
      ["Guitar", false],
    ]);
    expect(mix?.canMuteMine).toBe(true);
  });

  it("hides the preset when none of the tracks are yours", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar" });
    const sax = await instrumentsRepo.create(db, { slug: "sax", label: "Sax" });
    await membersRepo.setInstruments(db, me.id, [sax.id]);
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    expect((await getMixData(db, t.id, me.id, "en"))?.canMuteMine).toBe(false);
  });

  it("names instruments that were played but have no stem — muting cannot remove them", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar" });
    const sax = await instrumentsRepo.create(db, { slug: "sax", label: "Sax" });
    // Sax played, but only ever captured in the master.
    const t = await take([bass.id, gtr.id, sax.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    expect((await getMixData(db, t.id, me.id, "en"))?.onlyInMaster).toEqual(["Sax"]);
  });

  it("carries each instrument's colour through, which is what paints the lane", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass", sortOrder: 1 });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar", sortOrder: 2 });
    await instrumentsRepo.update(db, bass.id, { color: "sky" });
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    const mix = await getMixData(db, t.id, me.id, "en");
    // null is a real presentation — the neutral — not a missing value.
    expect(mix?.tracks.map((track) => track.color)).toEqual(["sky", null]);
  });

  it("falls back to the longest asset when the take has no duration of its own", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar" });
    const song = await songsRepo.create(db, {
      title: "No Duration",
      slug: "no-duration",
      createdAt: now,
      updatedAt: now,
    });
    const event = await eventsRepo.create(db, {
      kind: "rehearsal",
      heldAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const t = await takesRepo.create(db, {
      songId: song.id,
      eventId: event.id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
      instrumentIds: [bass.id, gtr.id],
    });
    await assetsRepo.createMany(db, [
      // A stem is allowed to be SHORTER than the take, so the axis is the
      // longest, never the first.
      asset(t.id, { instrumentId: bass.id, durationMs: 12_000 }),
      asset(t.id, { instrumentId: gtr.id, durationMs: 240_000 }),
    ]);

    expect((await getMixData(db, t.id, me.id, "en"))?.durationMs).toBe(240_000);
  });

  it("names the take by its song, and carries the take page's own lede", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar" });
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    const mix = await getMixData(db, t.id, me.id, "en");
    expect(mix?.title).toBe("Dub Corner");
    // The take page's own sentence, word for word. This take's event has no
    // name, so the kind becomes an adjective rather than being dropped into a
    // frame that cannot decline it.
    expect(mix?.lede).toBe("A rehearsal take, July 8, 2026");
  });

  it("speaks the requested language", async () => {
    const me = await member("a@example.com");
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Bass" });
    const gtr = await instrumentsRepo.create(db, { slug: "gtr", label: "Guitar" });
    const t = await take([bass.id, gtr.id]);
    await assetsRepo.createMany(db, [
      asset(t.id, { kind: "master", instrumentId: null }),
      asset(t.id, { instrumentId: bass.id }),
      asset(t.id, { instrumentId: gtr.id }),
    ]);

    const mix = await getMixData(db, t.id, me.id, "cs");
    expect(mix?.lede).toBe("Nahrávka (zkouška), 8. července 2026");
  });
});
