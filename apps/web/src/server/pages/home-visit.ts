// "New since your last visit": what counts as a visit, and what "since" means.
//
// A visit is a stretch of activity, not a page load. If every load of home
// moved the baseline, the card announcing new takes would vanish the moment
// the member reloaded, or came back to home from the event it pointed at,
// which is exactly when they still want it. So a load only starts a NEW visit
// once more than `VISIT_GAP_MS` has passed since the current one began, and
// the baseline is when the PREVIOUS visit began.
//
// Pure, with no clock and no database: the loader reads the member's two
// columns, asks here, and writes back only when this says a visit started
// (`membersRepo.startHomeVisit`, a single UPDATE). Tested on its own in
// `home-visit.test.ts`.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How long a visit lasts from its first load before the next load starts another. */
export const VISIT_GAP_MS = 30 * MINUTE_MS;

/**
 * How far back a member's very first visit looks. Without a floor, someone
 * invited to a band with a year of recordings would be told all of it is new.
 */
export const FIRST_VISIT_WINDOW_MS = 14 * DAY_MS;

export interface HomeVisitState {
  /** `members.home_visit_started_at`: when the current visit began. */
  visitStartedAt: number | null;
  /** `members.home_last_visit_at`: when the visit before it began. */
  lastVisitAt: number | null;
  /** `members.created_at`. */
  memberCreatedAt: number;
}

export interface HomeVisitDecision {
  /** Whether this load starts a new visit, and so has to be written back. */
  startsNewVisit: boolean;
  /** The two columns after this load. Unchanged when no visit started. */
  visitStartedAt: number;
  lastVisitAt: number | null;
  /** A take published strictly after this is new. */
  since: number;
}

export function decideHomeVisit(state: HomeVisitState, now: number): HomeVisitDecision {
  const startsNewVisit = state.visitStartedAt === null || now - state.visitStartedAt > VISIT_GAP_MS;

  const visitStartedAt =
    startsNewVisit || state.visitStartedAt === null ? now : state.visitStartedAt;
  // The visit that just ended becomes the last visit. On a first-ever load
  // there was none, so this stays null and the floor below applies.
  const lastVisitAt = startsNewVisit ? state.visitStartedAt : state.lastVisitAt;

  const since = lastVisitAt ?? Math.max(state.memberCreatedAt, now - FIRST_VISIT_WINDOW_MS);

  return { startsNewVisit, visitStartedAt, lastVisitAt, since };
}
