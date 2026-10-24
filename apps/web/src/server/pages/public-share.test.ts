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
import {
  loadPublicShare,
  PREVIEW_SONGS_MAX_CHARS,
  publicEventDescription,
} from "./public-share.js";
import { createShareLink, resolveShareCode } from "./share.js";

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
        state: "published",
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
        state: "keeper",
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

  it("never shows or lists a draft take", async () => {
    const draftId = (
      await takesRepo.create(db, {
        songId,
        eventId,
        state: "new",
        recordedAt: NOW + 3,
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
    // The band may share a draft among itself; it cannot be made public.
    expect(await createShareLink(db, { kind: "take", id: draftId, public: "1" }, NOW)).toEqual({
      kind: "invalid",
    });
    const members = await createShareLink(db, { kind: "take", id: draftId }, NOW);
    expect(members).toMatchObject({ kind: "ok", canBePublic: false });
    await shareLinksRepo.setPublic(db, "take", draftId, NOW);
    const code = members.kind === "ok" ? members.url.slice(3) : "";
    expect(await loadPublicShare(db, code, "cs")).toBeUndefined();

    const view = await loadPublicShare(db, await publicCode("event", eventId), "cs");
    expect(view?.kind === "event" && view.takes.map((row) => row.take.id)).not.toContain(draftId);
    expect(view?.kind === "event" && view.summary).toContain("2 nahrávky");
  });

  it("names what was played in a public event's preview, and nothing a draft or a members' link would", async () => {
    const secretSong = await songsRepo.create(db, {
      title: "Tajná",
      slug: "tajna",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await takesRepo.create(db, {
      songId: secretSong.id,
      eventId,
      state: "new",
      recordedAt: NOW + 3,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const code = await publicCode("event", eventId);
    const view = await loadPublicShare(db, code, "cs");
    // Two takes of one song: named once, and nothing "more" to count.
    expect(view?.preview.description).toMatch(/8\. července 2026: Čoudy$/);
    expect(view?.preview.description).not.toContain("Tajná");

    const members = await createShareLink(db, { kind: "event", id: eventId }, NOW);
    await shareLinksRepo.setPublic(db, "event", eventId, null);
    const resolved = await resolveShareCode(db, code, "cs");
    expect(members.kind).toBe("ok");
    expect(resolved?.preview.description).not.toContain("Čoudy");
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

describe("publicEventDescription", () => {
  const base = "Zkouška, 22. října 2026";

  it("is the base line alone when nothing has a name", () => {
    expect(publicEventDescription(base, [], "cs")).toBe(base);
    expect(publicEventDescription(base, [undefined, "  "], "cs")).toBe(base);
  });

  it("names every song when they fit", () => {
    expect(publicEventDescription(base, ["Čoudy", "Sloka", "Čoudy"], "cs")).toBe(
      `${base}: Čoudy, Sloka`,
    );
  });

  it("counts the songs left out, with an unnamed take as one more", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G", "A", undefined];
    expect(publicEventDescription(base, names, "cs")).toBe(`${base}: A, B, C, D, E a 3 další`);
    expect(publicEventDescription(base, [...names, "H", "I"], "cs")).toBe(
      `${base}: A, B, C, D, E a 5 dalších`,
    );
    expect(publicEventDescription(base, ["A", "B", "C", "D", "E", "F"], "en")).toBe(
      `${base}: A, B, C, D, E and 1 more`,
    );
  });

  it("stops before the list runs past what a messenger shows", () => {
    const long = "x".repeat(70);
    const result = publicEventDescription(base, [`${long}1`, `${long}2`, `${long}3`], "cs");
    expect(result).toBe(`${base}: ${long}1, ${long}2 a 1 další`);
    expect(result.length - base.length).toBeLessThan(PREVIEW_SONGS_MAX_CHARS + 20);
  });

  it("always names the first song, however long", () => {
    const huge = "y".repeat(PREVIEW_SONGS_MAX_CHARS + 10);
    expect(publicEventDescription(base, [huge, "B"], "cs")).toBe(`${base}: ${huge} a 1 další`);
  });
});
