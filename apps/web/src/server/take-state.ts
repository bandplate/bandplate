// Shared take-state vocabulary — `TakeRow.astro`'s badge and
// `/takes/[id]`'s own state line must agree on the same words, so this is
// the one place that mapping lives rather than two copies drifting apart.
import type { takesRepo } from "@bandplate/db";

export const TAKE_STATE_LABEL: Record<takesRepo.TakeState, string> = {
  uploading: "uploading",
  new: "new",
  published: "published",
  keeper: "keeper",
  rejected: "rejected",
  purged: "purged",
};
