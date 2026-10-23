import type { Db } from "@bandplate/db";
import {
  assetsRepo,
  eventsRepo,
  instrumentsRepo,
  membersRepo,
  shareLinksRepo,
  songsRepo,
  takesRepo,
} from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { loadPublicShare } from "./public-share.js";
import { createShareLink } from "./share.js";

const NOW = new Date(2026, 6, 8, 12).getTime();

/** Words that are in the database and must never reach a stranger. */
const SECRETS = ["Klub 007", "the bridge drags", "tuning was off", "Owner Name"];

describe("loadPublicShare", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let takeId: string;
  let silentTakeId: string;
  let masterId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const owner = await membersRepo.create(db, {
      displayName: "Owner Name",
      slug: "owner",
      email: "owner@example.com",
      createdAt: NOW,
    });
    songId = (
      await songsRepo.create(db, { title: "Čoudy", slug: "coudy", createdAt: NOW, updatedAt: NOW })
    ).id;
    eventId = (
      await eventsRepo.create(db, {
        kind: "concert",
        title: "Dezerter",
        venue: "Klub 007",
        notes: "tuning was off",
        heldAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
    const bass = await instrumentsRepo.create(db, { slug: "bass", label: "Basa" });
    takeId = (
      await takesRepo.create(db, {
        songId,
        eventId,
        label: "take 2",
        notes: "the bridge drags",
        durationMs: 224_000,
        recordedAt: NOW,
        instrumentIds: [bass.id],
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
    silentTakeId = (
      await takesRepo.create(db, {
        songId,
        eventId,
        recordedAt: NOW + 1,
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
    // A stash recording on the same event: never listed, never played.
    await takesRepo.create(db, {
      songId,
      eventId,
      visibility: "private",
      ownerMemberId: owner.id,
      recordedAt: NOW + 2,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const [master] = await assetsRepo.createMany(db, [
      {
        takeId,
        kind: "master",
        tier: "lossy",
        format: "mp3",
        storageKey: `takes/${takeId}/master/lossy.mp3`,
        contentType: "audio/mpeg",
        bytes: 1000,
        status: "ready",
        createdAt: NOW,
        readyAt: NOW,
      },
    ]);
    masterId = master?.id ?? "";
  });

  async function publicCode(kind: "take" | "event" | "song", id: string): Promise<string> {
    const result = await createShareLink(db, { kind, id }, NOW);
    if (result.kind !== "ok") {
      throw new Error(`expected a link, got ${result.kind}`);
    }
    await shareLinksRepo.setPublic(db, kind, id, NOW);
    return result.url.slice(3);
  }

  it("shows a public take: its song, label, facts and master", async () => {
    const view = await loadPublicShare(db, await publicCode("take", takeId), "cs");
    expect(view).toMatchObject({
      kind: "take",
      title: "Čoudy",
      note: "take 2",
      facts: { event: "Dezerter", date: "8. července 2026", duration: "3:44", verdict: null },
      play: { takeId, assetId: masterId, title: "Čoudy" },
    });
    expect(view?.kind === "take" && view.facts.instruments.map((i) => i.label)).toEqual(["Basa"]);
  });

  it("gives a take with no ready master no play control", async () => {
    const view = await loadPublicShare(db, await publicCode("take", silentTakeId), "cs");
    expect(view?.kind === "take" && view.play).toBeUndefined();
  });

  it("shows a public event: its band takes in order, never a stash recording", async () => {
    const view = await loadPublicShare(db, await publicCode("event", eventId), "cs");
    expect(view).toMatchObject({ kind: "event", title: "Dezerter", eventKind: "concert" });
    if (view?.kind !== "event") {
      throw new Error("expected an event");
    }
    expect(view.takes.map((row) => row.take.id)).toEqual([takeId, silentTakeId]);
    expect(view.takes.map((row) => row.playableAssetId)).toEqual([masterId, undefined]);
    expect(view.summary).toContain("8. července 2026");
  });

  it("does not repeat the date under an untitled event, whose heading already says it", async () => {
    await eventsRepo.update(db, eventId, { title: null, updatedAt: NOW });
    const view = await loadPublicShare(db, await publicCode("event", eventId), "cs");
    expect(view?.kind === "event" && view.title).toBe("8. července 2026");
    expect(view?.kind === "event" && view.summary).not.toContain("července");
  });

  it("carries no venue, notes or member name, for a take or an event", async () => {
    for (const code of [await publicCode("take", takeId), await publicCode("event", eventId)]) {
      const serialized = JSON.stringify(await loadPublicShare(db, code, "cs"));
      for (const secret of SECRETS) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it("opens nothing for a members' link, a turned-off one, a song or an unknown code", async () => {
    const members = await createShareLink(db, { kind: "take", id: takeId }, NOW);
    const membersCode = members.kind === "ok" ? members.url.slice(3) : "";
    expect(await loadPublicShare(db, membersCode, "cs")).toBeUndefined();

    const eventCode = await publicCode("event", eventId);
    await shareLinksRepo.setPublic(db, "event", eventId, null);
    expect(await loadPublicShare(db, eventCode, "cs")).toBeUndefined();

    expect(await loadPublicShare(db, await publicCode("song", songId), "cs")).toBeUndefined();
    expect(await loadPublicShare(db, "zzzzzzzzzz", "cs")).toBeUndefined();
    expect(await loadPublicShare(db, undefined, "cs")).toBeUndefined();
  });

  it("an event archived after it was made public opens nothing", async () => {
    const code = await publicCode("event", eventId);
    await eventsRepo.update(db, eventId, { archivedAt: NOW + 1, updatedAt: NOW + 1 });
    expect(await loadPublicShare(db, code, "cs")).toBeUndefined();
  });
});
