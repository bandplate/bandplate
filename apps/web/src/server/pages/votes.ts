// `/takes/[id]/vote` page logic — mirrors `packages/api/src/routes/votes.ts`
// (see that file's header comment for why both exist). This is what the
// Astro route actually calls: a plain `<form method="post">` submission
// (no JS) and the `VoteFavorite` island's `fetch` (JS) both hit the same
// URL, so this one function is the single place "cast a keeper vote" is
// implemented for the browser-facing app.
import type { Db } from "@bandlib/db";
import { takesRepo, votesRepo } from "@bandlib/db";
import { z } from "zod";

const castVoteFormSchema = z.object({
  keeper: z.enum(["true", "false"]),
});

export interface VoteTally {
  takeId: string;
  keeperVotes: number;
  totalVotes: number;
  ratingScore: number;
}

export type CastVoteFromFormResult =
  | { kind: "ok"; keeper: boolean; tally: VoteTally }
  | { kind: "invalid" }
  | { kind: "not_found" };

/**
 * Reads `keeper` off a submitted `FormData`, validates it, casts the vote
 * AS `memberId` on `takeId` (both the caller's job to have derived — see
 * `pages/takes/[id]/vote.astro`, which takes `takeId` from the trusted URL
 * path segment and `memberId` from the session, never from the form
 * itself), and returns the take's fresh aggregate tally so the caller can
 * render/redirect with up-to-date numbers without a second round trip.
 */
export async function castVoteFromForm(
  db: Db,
  memberId: string,
  takeId: string,
  formData: FormData,
  now: number,
): Promise<CastVoteFromFormResult> {
  const parsed = castVoteFormSchema.safeParse({ keeper: formData.get("keeper") });
  if (!parsed.success) {
    return { kind: "invalid" };
  }

  const take = await takesRepo.getById(db, takeId);
  if (!take) {
    return { kind: "not_found" };
  }

  const keeper = parsed.data.keeper === "true";
  await votesRepo.castVote(db, { takeId, memberId, keeper, now });

  const updated = await takesRepo.getById(db, takeId);
  return {
    kind: "ok",
    keeper,
    tally: {
      takeId,
      keeperVotes: updated?.keeperVotes ?? 0,
      totalVotes: updated?.totalVotes ?? 0,
      ratingScore: updated?.ratingScore ?? 0,
    },
  };
}
