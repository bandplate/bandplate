import type { Db } from "@bandplate/db";
import { eventsRepo, songsRepo, takesRepo } from "@bandplate/db";
import { createTestDb } from "@bandplate/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getTakeForAdminAction, setTakeState } from "./admin-takes.js";

describe("admin keeper / reject", () => {
  let db: Db;
  let songId: string;
  let eventId: string;

  beforeEach(async () => {
    db = await createTestDb();
    songId = (
      await songsRepo.create(db, {
        title: "Neon Skyline",
        slug: "neon-skyline",
        createdAt: 1,
        updatedAt: 1,
      })
    ).id;
    eventId = (
      await eventsRepo.create(db, { kind: "rehearsal", heldAt: 1000, createdAt: 1, updatedAt: 1 })
    ).id;
  });

  async function take(over: Partial<takesRepo.CreateTakeInput> = {}) {
    return takesRepo.create(db, {
      songId,
      eventId,
      recordedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      ...over,
    });
  }

  it("marks a band take keeper or rejected", async () => {
    const band = await take();
    expect(await getTakeForAdminAction(db, band.id)).toMatchObject({ take: { id: band.id } });
    expect(await setTakeState(db, band.id, "keeper", 2000)).toEqual({ kind: "ok" });
    expect((await takesRepo.getById(db, band.id))?.state).toBe("keeper");
    expect(await setTakeState(db, band.id, "rejected", 3000)).toEqual({ kind: "ok" });
    expect((await takesRepo.getById(db, band.id))?.state).toBe("rejected");
  });

  it("refuses a member's personal take, private or already added to its song", async () => {
    for (const visibility of ["private", "band"] as const) {
      const personal = await take({ ownerMemberId: "m-filip", visibility });
      const before = (await takesRepo.getById(db, personal.id))?.state;

      expect(await getTakeForAdminAction(db, personal.id)).toBeUndefined();
      expect(await setTakeState(db, personal.id, "keeper", 2000)).toEqual({ kind: "not_found" });
      expect(await setTakeState(db, personal.id, "rejected", 2000)).toEqual({
        kind: "not_found",
      });
      expect((await takesRepo.getById(db, personal.id))?.state).toBe(before);
    }
  });

  it("reports not_found for a take that does not exist", async () => {
    expect(await getTakeForAdminAction(db, "nope")).toBeUndefined();
    expect(await setTakeState(db, "nope", "keeper", 2000)).toEqual({ kind: "not_found" });
  });
});
