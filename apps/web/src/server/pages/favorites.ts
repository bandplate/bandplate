// `/favorites` page logic — mirrors `packages/api/src/routes/favorites.ts`.
// One generic endpoint (not nested under `/songs`, `/takes`, or `/events`)
// because the same toggle applies to all three target types from many
// different pages — see `apps/web/src/pages/favorites.astro`.
import type { Db } from "@bandlib/db";
import { eventsRepo, favoritesRepo, songsRepo, takesRepo } from "@bandlib/db";
import { z } from "zod";

const toggleFavoriteFormSchema = z.object({
  targetType: z.enum(["song", "take", "event"]),
  targetId: z.string().min(1),
});

export type ToggleFavoriteFromFormResult =
  | {
      kind: "ok";
      targetType: favoritesRepo.FavoriteTargetType;
      targetId: string;
      favorited: boolean;
    }
  | { kind: "invalid" }
  | { kind: "not_found" };

async function targetExists(
  db: Db,
  targetType: favoritesRepo.FavoriteTargetType,
  targetId: string,
): Promise<boolean> {
  switch (targetType) {
    case "song":
      return (await songsRepo.getById(db, targetId)) !== undefined;
    case "take":
      return (await takesRepo.getById(db, targetId)) !== undefined;
    case "event":
      return (await eventsRepo.getById(db, targetId)) !== undefined;
  }
}

/**
 * Reads `targetType`/`targetId` off a submitted `FormData` and toggles that
 * favorite for `memberId` — the caller's job to have derived that from the
 * session (see `pages/favorites.astro`), never from the form itself.
 */
export async function toggleFavoriteFromForm(
  db: Db,
  memberId: string,
  formData: FormData,
  now: number,
): Promise<ToggleFavoriteFromFormResult> {
  const parsed = toggleFavoriteFormSchema.safeParse({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
  });
  if (!parsed.success) {
    return { kind: "invalid" };
  }

  const exists = await targetExists(db, parsed.data.targetType, parsed.data.targetId);
  if (!exists) {
    return { kind: "not_found" };
  }

  const { favorited } = await favoritesRepo.toggle(db, {
    memberId,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    now,
  });

  return {
    kind: "ok",
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    favorited,
  };
}
