// Short share links: making a code (`POST /share`, from the Share button) and
// following one (`GET /s/<code>`). The rules about what may be shared and
// what a preview may say are `server/share-target.ts`'s; this module only
// reads the facts those rules need.
import { isShareCode } from "@bandplate/core";
import { type Db, eventsRepo, shareLinksRepo, songsRepo, takesRepo } from "@bandplate/db";
import type { Locale } from "@bandplate/i18n";
import { z } from "zod";
import {
  mayBePublic,
  type SharePreview,
  type ShareTargetFacts,
  sharePath,
  sharePreview,
} from "../share-target.js";

/**
 * The facts about one target, or undefined when there is no such row.
 *
 * Takes go through `takesRepo.getById` WITHOUT `isVisibleTo`, deliberately:
 * the rule here is stricter than "visible to this member". A private take is
 * visible to its owner and still never shareable, and `sharePath` refuses it
 * on `visibility` alone, for everyone.
 */
export async function loadShareTarget(
  db: Db,
  kind: shareLinksRepo.ShareKind,
  id: string,
): Promise<ShareTargetFacts | undefined> {
  switch (kind) {
    case "song": {
      const [song, takeCount] = await Promise.all([
        songsRepo.getById(db, id),
        takesRepo.countBySong(db, id),
      ]);
      return song ? { kind, song, takeCount } : undefined;
    }
    case "event": {
      const [event, takeCount] = await Promise.all([
        eventsRepo.getById(db, id),
        takesRepo.countByEvent(db, id),
      ]);
      return event ? { kind, event, takeCount } : undefined;
    }
    case "take": {
      const take = await takesRepo.getById(db, id);
      if (!take) {
        return undefined;
      }
      const [song, event] = await Promise.all([
        take.songId ? songsRepo.getById(db, take.songId) : undefined,
        eventsRepo.getById(db, take.eventId),
      ]);
      return { kind, take, song, event };
    }
  }
}

const createShareSchema = z.object({
  kind: z.enum(["song", "event", "take"]),
  id: z.string().min(1).max(200),
  /** Absent: leave the link as it is. "1" makes it public, "0" a members' link again. */
  public: z.enum(["1", "0"]).optional(),
});

export type CreateShareLinkResult =
  | {
      kind: "ok";
      url: string;
      /** Whether a signed-out visitor gets the page itself. */
      public: boolean;
      /** Whether this target's link may be made public at all (`mayBePublic`). */
      canBePublic: boolean;
    }
  | { kind: "invalid" }
  | { kind: "not_found" };

/**
 * The target's short link, made on first use, and made public or not when
 * asked. `not_found` both for a target that does not exist and for one that
 * may not be shared (a private take, a personal day nobody can open), so the
 * two cannot be told apart. Asking to make public what may not be (a song)
 * is `invalid`: the button never offers it, so only a hand-made request gets
 * there.
 */
export async function createShareLink(
  db: Db,
  input: { kind: unknown; id: unknown; public?: unknown },
  now: number,
): Promise<CreateShareLinkResult> {
  const parsed = createShareSchema.safeParse({ ...input, public: input.public ?? undefined });
  if (!parsed.success) {
    return { kind: "invalid" };
  }
  const { kind, id } = parsed.data;
  const wanted = parsed.data.public === undefined ? undefined : parsed.data.public === "1";
  const facts = await loadShareTarget(db, kind, id);
  if (sharePath(facts) === undefined) {
    return { kind: "not_found" };
  }
  const canBePublic = mayBePublic(facts);
  if (wanted !== undefined && !canBePublic) {
    return { kind: "invalid" };
  }
  const existing = await shareLinksRepo.getByTarget(db, kind, id);
  const code = existing?.code ?? (await shareLinksRepo.getOrCreate(db, kind, id, now));
  if (wanted !== undefined) {
    await shareLinksRepo.setPublic(db, kind, id, wanted ? now : null);
  }
  const isPublic = wanted ?? (existing !== undefined && existing.publicAt !== null);
  return { kind: "ok", url: `/s/${code}`, public: isPublic, canBePublic };
}

export interface ResolvedShare {
  kind: shareLinksRepo.ShareKind;
  targetId: string;
  /** Where a signed-in member is sent: the target's current page. */
  path: string;
  /** What a signed-out visitor's link preview may say. */
  preview: SharePreview;
  /**
   * Whether a signed-out visitor gets the page itself rather than a sign-in
   * card: the link was made public AND its target still may be. A link made
   * public before its event was archived is a members' link from then on.
   */
  public: boolean;
}

/**
 * What a code opens, or undefined for a code that is malformed, unknown,
 * names a deleted target, or names one that may not be shared. The four look
 * the same from outside, on purpose.
 */
export async function resolveShareCode(
  db: Db,
  code: string | undefined,
  locale: Locale,
): Promise<ResolvedShare | undefined> {
  if (!isShareCode(code)) {
    return undefined;
  }
  const link = await shareLinksRepo.resolve(db, code);
  if (!link) {
    return undefined;
  }
  const facts = await loadShareTarget(db, link.kind, link.targetId);
  const path = sharePath(facts);
  const preview = sharePreview(facts, locale);
  if (path === undefined || preview === undefined) {
    return undefined;
  }
  return {
    kind: link.kind,
    targetId: link.targetId,
    path,
    preview,
    public: link.publicAt !== null && mayBePublic(facts),
  };
}
