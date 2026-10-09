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
});
