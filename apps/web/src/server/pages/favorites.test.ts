import { favoritesRepo, membersRepo, songsRepo } from "@bandlib/db";
import type { Db } from "@bandlib/db";
import { createTestDb } from "@bandlib/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { toggleFavoriteFromForm } from "./favorites.js";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

async function seedSong(db: Db) {
  const now = Date.now();
  return songsRepo.create(db, {
    title: "Favorite Form Song",
    slug: "favorite-form-song",
    createdAt: now,
    updatedAt: now,
  });
}

async function seedMember(db: Db, email: string) {
  return membersRepo.create(db, { displayName: email, slug: email, email, createdAt: Date.now() });
}

describe("toggleFavoriteFromForm", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("toggles a favorite on, then off, on repeated calls", async () => {
    const song = await seedSong(db);
    const memberId = (await seedMember(db, "toggle@example.com")).id;

    const first = await toggleFavoriteFromForm(
      db,
      memberId,
      formData({ targetType: "song", targetId: song.id }),
      1000,
    );
    expect(first).toEqual({ kind: "ok", targetType: "song", targetId: song.id, favorited: true });

    const second = await toggleFavoriteFromForm(
      db,
      memberId,
      formData({ targetType: "song", targetId: song.id }),
      2000,
    );
    expect(second).toEqual({ kind: "ok", targetType: "song", targetId: song.id, favorited: false });
  });

  it("uses memberId as GIVEN, never anything from the form — the form has no memberId field at all", async () => {
    const song = await seedSong(db);
    const realMember = await seedMember(db, "real@example.com");
    const otherMember = await seedMember(db, "someone-else@example.com");
    const fd = formData({ targetType: "song", targetId: song.id });
    fd.set("memberId", otherMember.id);

    await toggleFavoriteFromForm(db, realMember.id, fd, 1000);

    expect(await favoritesRepo.isFavorited(db, realMember.id, "song", song.id)).toBe(true);
    expect(await favoritesRepo.isFavorited(db, otherMember.id, "song", song.id)).toBe(false);
  });

  it("is invalid for an unknown targetType", async () => {
    const member = await seedMember(db, "invalid-type@example.com");
    const result = await toggleFavoriteFromForm(
      db,
      member.id,
      formData({ targetType: "album", targetId: "x" }),
      1000,
    );
    expect(result.kind).toBe("invalid");
  });

  it("is not_found for a targetId that doesn't exist", async () => {
    const member = await seedMember(db, "not-found@example.com");
    const result = await toggleFavoriteFromForm(
      db,
      member.id,
      formData({ targetType: "song", targetId: "not-a-real-song" }),
      1000,
    );
    expect(result.kind).toBe("not_found");
  });
});
