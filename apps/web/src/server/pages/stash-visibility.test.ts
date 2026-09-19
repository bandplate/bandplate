// The web half of "a stash take is its owner's alone": every loader and form
// handler that resolves a take BY ID. Listings are covered in the db package.
import type { Db } from "@bandplate/db";
import { eventsRepo, favoritesRepo, membersRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getEventDetail, updateEvent } from "./events.js";
import { toggleFavoriteFromForm } from "./favorites.js";
import { getFavorites } from "./home.js";
import { attachFullContext } from "./take-context.js";
import { getTakeDetail, setTakePublished, updateTake } from "./takes.js";
import { castVoteFromForm } from "./votes.js";

describe("stash takes in the web app", () => {
  let db: Db;
  let ownerId: string;
  let otherId: string;
  let songId: string;
  let eventId: string;
  let takeId: string;

  beforeEach(async () => {
    db = await createTestDb();
    ownerId = (
      await membersRepo.create(db, {
        displayName: "Filip",
        slug: "filip",
        email: "filip@example.com",
        createdAt: 1,
      })
    ).id;
    otherId = (
      await membersRepo.create(db, {
        displayName: "Jana",
        slug: "jana",
        email: "jana@example.com",
        createdAt: 1,
      })
    ).id;
    songId = (
      await songsRepo.create(db, { title: "Čoudy", slug: "coudy", createdAt: 1, updatedAt: 1 })
    ).id;
    eventId = (
      await eventsRepo.findOrCreatePersonal(db, {
        memberId: ownerId,
        dayKey: "2026-09-19",
        heldAt: 1,
        now: 1,
      })
    ).id;
    takeId = (
      await takesRepo.create(db, {
        songId,
        eventId,
        recordedAt: 1,
        visibility: "private",
        ownerMemberId: ownerId,
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
  });

  it("the take page resolves for its owner and not for anyone else", async () => {
    expect((await getTakeDetail(db, takeId, ownerId))?.take.id).toBe(takeId);
    expect(await getTakeDetail(db, takeId, otherId)).toBeUndefined();
  });

  it("the band's publish and edit forms refuse a private take — it leaves the stash only one way", async () => {
    expect((await setTakePublished(db, 5, takeId, true)).kind).toBe("not_found");
    const form = new FormData();
    form.set("songId", songId);
    form.set("recordedAt", "2026-09-19");
    expect((await updateTake(db, 5, takeId, form)).kind).toBe("not_found");
    expect((await takesRepo.getById(db, takeId))?.visibility).toBe("private");
  });

  it("nobody else can pin it, and a pin of it never shows for anyone else", async () => {
    const form = new FormData();
    form.set("targetType", "take");
    form.set("targetId", takeId);
    expect((await toggleFavoriteFromForm(db, otherId, form, 5)).kind).toBe("not_found");
    // Even a pin row that got there some other way is not rendered.
    await favoritesRepo.toggle(db, {
      memberId: otherId,
      targetType: "take",
      targetId: takeId,
      now: 5,
    });
    expect((await getFavorites(db, otherId)).takes).toEqual([]);
  });

  it("a published personal recording is not voted on", async () => {
    await takesRepo.publishFromStash(db, takeId, ownerId, 5);
    const form = new FormData();
    form.set("keeper", "true");
    expect((await castVoteFromForm(db, otherId, takeId, form, 6)).kind).toBe("not_found");
    expect((await takesRepo.getById(db, takeId))?.totalVotes).toBe(0);
  });

  it("the personal event page exists only once it holds a band take, and names its owner", async () => {
    expect(await getEventDetail(db, eventId, otherId)).toBeUndefined();
    await takesRepo.publishFromStash(db, takeId, ownerId, 5);
    const detail = await getEventDetail(db, eventId, otherId);
    expect(detail?.takes.map((t) => t.id)).toEqual([takeId]);
    expect(detail?.owner?.displayName).toBe("Filip");
  });

  it("a listed personal recording carries its owner's name", async () => {
    await takesRepo.publishFromStash(db, takeId, ownerId, 5);
    const take = await takesRepo.getById(db, takeId);
    if (!take) throw new Error("gone");
    const [row] = await attachFullContext(db, [take], otherId);
    expect(row?.ownerName).toBe("Filip");
  });

  it("a personal event's own fields can never be edited through the band's edit form — not even by its owner, and not by a hand-built POST that never sees the hidden button", async () => {
    const before = await eventsRepo.getById(db, eventId);
    const form = new FormData();
    form.set("kind", "rehearsal");
    form.set("heldAt", "2026-09-20");
    const result = await updateEvent(db, 6, eventId, form);
    expect(result.kind).toBe("not_found");
    const after = await eventsRepo.getById(db, eventId);
    expect(after).toEqual(before);
  });
});
