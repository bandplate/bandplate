import type { Db } from "@bandplate/db";
import { eventsRepo, membersRepo, shareLinksRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createShareLink, resolveShareCode } from "./share.js";

const NOW = new Date(2026, 6, 8, 12).getTime();

describe("share links, end to end against the repos", () => {
  let db: Db;
  let songId: string;
  let eventId: string;
  let takeId: string;
  let privateTakeId: string;

  beforeEach(async () => {
    db = await createTestDb();
    const owner = await membersRepo.create(db, {
      displayName: "Owner",
      slug: "owner",
      email: "owner@example.com",
      createdAt: NOW,
    });
    songId = (
      await songsRepo.create(db, { title: "Čoudy", slug: "coudy", createdAt: NOW, updatedAt: NOW })
    ).id;
    eventId = (
      await eventsRepo.create(db, {
        kind: "rehearsal",
        heldAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
    takeId = (
      await takesRepo.create(db, {
        songId,
        eventId,
        label: "take 2",
        state: "published",
        recordedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
    const personal = await eventsRepo.findOrCreatePersonal(db, {
      memberId: owner.id,
      dayKey: "2026-07-08",
      heldAt: NOW,
      now: NOW,
    });
    privateTakeId = (
      await takesRepo.create(db, {
        songId,
        eventId: personal.id,
        recordedAt: NOW,
        visibility: "private",
        ownerMemberId: owner.id,
        createdAt: NOW,
        updatedAt: NOW,
      })
    ).id;
  });

  async function codeOf(kind: string, id: string): Promise<string> {
    const result = await createShareLink(db, { kind, id }, NOW);
    if (result.kind !== "ok") {
      throw new Error(`expected a link, got ${result.kind}`);
    }
    return result.url.replace(/^\/s\//, "");
  }

  it("returns a /s/<code> path, and the same one the second time", async () => {
    const first = await createShareLink(db, { kind: "song", id: songId }, NOW);
    const second = await createShareLink(db, { kind: "song", id: songId }, NOW + 1);
    expect(first.kind).toBe("ok");
    expect(first).toEqual(second);
    if (first.kind === "ok") {
      expect(first.url).toMatch(/^\/s\/[0-9A-Za-z]{10}$/);
    }
  });

  it("resolves each kind to its canonical page", async () => {
    expect((await resolveShareCode(db, await codeOf("song", songId), "cs"))?.path).toBe(
      "/songs/coudy",
    );
    expect((await resolveShareCode(db, await codeOf("event", eventId), "cs"))?.path).toBe(
      `/events/${eventId}`,
    );
    expect((await resolveShareCode(db, await codeOf("take", takeId), "cs"))?.path).toBe(
      `/takes/${takeId}`,
    );
  });

  it("refuses a private take, for anyone, and a target that does not exist", async () => {
    expect(await createShareLink(db, { kind: "take", id: privateTakeId }, NOW)).toEqual({
      kind: "not_found",
    });
    expect(await createShareLink(db, { kind: "song", id: "nope" }, NOW)).toEqual({
      kind: "not_found",
    });
  });

  it("refuses a malformed request", async () => {
    expect(await createShareLink(db, { kind: "member", id: songId }, NOW)).toEqual({
      kind: "invalid",
    });
    expect(await createShareLink(db, { kind: "song", id: "" }, NOW)).toEqual({ kind: "invalid" });
  });

  it("a code that names a private take resolves to nothing, preview included", async () => {
    // The endpoint never makes one, so write it straight through the repo:
    // what is under test is the redirect's own check, not the endpoint's.
    const code = await shareLinksRepo.getOrCreate(db, "take", privateTakeId, NOW);
    expect(await resolveShareCode(db, code, "cs")).toBeUndefined();
  });

  it("an archived event is not shareable, and an old code for it resolves to nothing", async () => {
    const code = await codeOf("event", eventId);
    await eventsRepo.update(db, eventId, { archivedAt: NOW + 1, updatedAt: NOW + 1 });
    expect(await createShareLink(db, { kind: "event", id: eventId }, NOW)).toEqual({
      kind: "not_found",
    });
    expect(await resolveShareCode(db, code, "cs")).toBeUndefined();
  });

  it("a deleted target's code resolves to nothing", async () => {
    const code = await codeOf("take", takeId);
    await takesRepo.remove(db, takeId);
    expect(await resolveShareCode(db, code, "cs")).toBeUndefined();
  });

  it("an unknown or malformed code resolves to nothing", async () => {
    expect(await resolveShareCode(db, "zzzzzzzzzz", "cs")).toBeUndefined();
    expect(await resolveShareCode(db, "../etc", "cs")).toBeUndefined();
    expect(await resolveShareCode(db, undefined, "cs")).toBeUndefined();
  });

  it("the preview a signed-out visitor sees says only the title and one line", async () => {
    const resolved = await resolveShareCode(db, await codeOf("take", takeId), "cs");
    expect(resolved?.preview).toEqual({
      title: "Čoudy",
      description: "Take 2, zkouška, 8. července 2026",
    });
  });

  describe("public links", () => {
    it("a new link is a members' link, and says whether it could be public", async () => {
      expect(await createShareLink(db, { kind: "take", id: takeId }, NOW)).toMatchObject({
        kind: "ok",
        public: false,
        canBePublic: true,
      });
      expect(await createShareLink(db, { kind: "song", id: songId }, NOW)).toMatchObject({
        kind: "ok",
        public: false,
        canBePublic: false,
      });
    });

    it("turns a take's link public and back, keeping the same code", async () => {
      const on = await createShareLink(db, { kind: "take", id: takeId, public: "1" }, NOW);
      expect(on).toMatchObject({ kind: "ok", public: true });
      const code = on.kind === "ok" ? on.url.slice(3) : "";
      expect((await resolveShareCode(db, code, "cs"))?.public).toBe(true);
      // Asking again without `public` reports the state rather than changing it.
      expect(await createShareLink(db, { kind: "take", id: takeId }, NOW)).toMatchObject({
        public: true,
      });

      const off = await createShareLink(db, { kind: "take", id: takeId, public: "0" }, NOW);
      expect(off).toMatchObject({ kind: "ok", url: on.kind === "ok" ? on.url : "", public: false });
      expect((await resolveShareCode(db, code, "cs"))?.public).toBe(false);
    });

    it("an event's link can be public", async () => {
      expect(
        await createShareLink(db, { kind: "event", id: eventId, public: "1" }, NOW),
      ).toMatchObject({ kind: "ok", public: true });
    });

    it("refuses to make a song public, and a private take stays not found", async () => {
      expect(await createShareLink(db, { kind: "song", id: songId, public: "1" }, NOW)).toEqual({
        kind: "invalid",
      });
      expect(
        await createShareLink(db, { kind: "take", id: privateTakeId, public: "1" }, NOW),
      ).toEqual({ kind: "not_found" });
      expect(await createShareLink(db, { kind: "take", id: takeId, public: "yes" }, NOW)).toEqual({
        kind: "invalid",
      });
    });

    it("a song link made public by hand still is not public", async () => {
      const code = await codeOf("song", songId);
      await shareLinksRepo.setPublic(db, "song", songId, NOW);
      expect((await resolveShareCode(db, code, "cs"))?.public).toBe(false);
    });
  });
});
