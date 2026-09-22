import type { Db, instrumentsRepo, PageArgs } from "@bandplate/db";
import {
  membersRepo,
  notificationPrefsRepo,
  readValue,
  runRead,
  runReads,
  takesRepo,
  votesRepo,
} from "@bandplate/db";
// `/me` — the signed-in member's own page: who they are, and what they have
// done. Not a shelf: home already IS the shelf of exactly the things this page
// used to list again under Songs / Events / Takes, and rendering the same rows
// on two pages is what made both of them long.
//
// The device/session list is gone too. It showed raw user-agent strings and a
// status badge to answer a question no member in a five-piece band asks, and
// signing out lives in the shell where it is always reachable. The one thing it
// could do that nothing else can is revoke a session on a device you no longer
// hold — deliberately traded away; recovery is a DB operation, as it already is
// for everything else about a member's credentials.
//
// Instruments (Task 6 review round 1's "data-model gap"): closed via the
// `memberInstruments` join table — see its schema comment for why a join
// table rather than a JSON column. `membersRepo.listInstrumentsForMember`
// includes archived instruments on purpose, so a member who plays one the
// band has since dropped still sees it here.
import { isLocale, type Locale } from "@bandplate/i18n";
import { buildFullContextRead, type TakeWithFullContext } from "./take-context.js";

export interface VoteWithTake {
  vote: votesRepo.Vote;
  take: TakeWithFullContext | undefined;
}

export interface MeData {
  member: membersRepo.Member;
  instruments: instrumentsRepo.Instrument[];
  /** ONE PAGE of votes, most recently changed first. */
  votes: VoteWithTake[];
  /** How many votes this member has cast in all. */
  voteTotal: number;
  /**
   * How many published takes this member has never voted on. Home used to
   * render these as a queue; nothing on the page everyone opens should nag, so
   * what is left is a count here — on the page you visit to see your own state,
   * where it is something you went looking for. A number, not a list.
   */
  unvotedCount: number;
  /**
   * The four figures the profile ledger shows, beside `voteTotal` and
   * `unvotedCount`.
   *
   * `agreementPct` is `null` when nothing this member voted on has been
   * settled yet — which is NOT the same as 0% and must not render as one. The
   * page shows a dash for it.
   */
  keeperCount: number;
  agreementPct: number | null;
  /**
   * The member's push toggles, when the caller asked for them (the page does
   * only where push is configured). Read here rather than by the page so they
   * ride in the same batch as everything else.
   */
  notificationPrefs: notificationPrefsRepo.NotificationPrefs | undefined;
}

export interface MeDataOptions {
  withNotificationPrefs?: boolean;
}

/**
 * Rows per page in the vote history.
 *
 * This is the listing that grows most reliably: one row per take a member has
 * ever judged, forever, with nothing that ever removes one.
 */
export const VOTES_PER_PAGE = 20;

/**
 * Two round trips, each one batch. The first asks everything keyed by the
 * member alone, including the takes behind this page of votes (by the page's
 * own subquery, so it does not wait for the votes to come back). The second
 * is those takes' context.
 */
export async function getMeData(
  db: Db,
  memberId: string,
  votesPage: PageArgs = { limit: VOTES_PER_PAGE, offset: 0 },
  options: MeDataOptions = {},
): Promise<MeData | undefined> {
  const found = await runReads(db, {
    member: membersRepo.buildGetByIdRead(db, memberId),
    instruments: membersRepo.buildListInstrumentsForMemberRead(db, memberId),
    votes: votesRepo.buildListByMemberRead(db, memberId, { page: votesPage }),
    voteTakes: votesRepo.buildTakesOfMemberPageRead(db, memberId, { page: votesPage }),
    unvoted: takesRepo.buildListUnvotedByMemberRead(db, memberId),
    record: votesRepo.buildVotingRecordRead(db, memberId),
    notificationPrefs: options.withNotificationPrefs
      ? notificationPrefsRepo.buildGetRead(db, memberId)
      : readValue(undefined),
  });
  const { member, instruments, votes, unvoted, record } = found;
  if (!member) {
    return undefined;
  }

  const withContext = await runRead(db, buildFullContextRead(db, found.voteTakes, memberId));
  const byTakeId = new Map(withContext.map((t) => [t.id, t]));

  return {
    member,
    instruments,
    votes: votes.rows.map((vote) => ({ vote, take: byTakeId.get(vote.takeId) })),
    voteTotal: votes.total,
    unvotedCount: unvoted.length,
    keeperCount: record.keepers,
    // Rounded here, once, rather than in the template: the page renders a
    // number, and the decision about what "no answer yet" looks like belongs
    // with the data rather than with the markup.
    agreementPct:
      record.resolved === 0 ? null : Math.round((record.agreed / record.resolved) * 100),
    notificationPrefs: found.notificationPrefs,
  };
}

// ---------------------------------------------------------------------------
// Setting your own language
// ---------------------------------------------------------------------------

export type SetLocaleResult = { kind: "ok"; locale: Locale } | { kind: "invalid" };

/**
 * `/me`'s language picker, and the first thing on this page that WRITES.
 *
 * Deliberately not routed through `updateMemberWithGuards`. That function
 * returns `{kind: "self"}` whenever `id === actingMemberId`, which is exactly
 * right for `role` and `status` — an admin must not be able to demote or
 * disable themselves and lock the band out — and exactly wrong here, where
 * acting on yourself is the entire feature. `updateMemberInstruments` already
 * sits outside it for the same reason.
 *
 * The member id comes from the SESSION, never from the form, matching
 * `castVoteFromForm`'s contract: a form field naming whose language to change
 * would be an authorization decision made by the browser.
 *
 * Returns the locale it wrote so the caller can set the cookie too — a member
 * who signs out has to land on a sign-in page in the language they just chose,
 * and by then there is no member row to consult.
 */
export async function setLocaleFromForm(
  db: Db,
  memberId: string,
  formData: FormData,
): Promise<SetLocaleResult> {
  const raw = formData.get("locale");
  if (!isLocale(raw)) {
    return { kind: "invalid" };
  }
  await membersRepo.update(db, memberId, { locale: raw });
  return { kind: "ok", locale: raw };
}
