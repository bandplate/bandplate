// "New since your last visit": what counts as a visit, and what "since" means.
//
// A visit is a stretch of activity, not a page load. If every load of home
// moved the baseline, the card announcing new takes would vanish the moment
// the member reloaded, or came back to home from the event it pointed at,
// which is exactly when they still want it. So a visit lasts for as long as
// home keeps being loaded, and ends after `VISIT_GAP_MS` with no load at all.
// Someone actively using the app never loses the card mid-session, however
// long the session runs.
//
// The baseline is when the PREVIOUS visit ended: its last load. A take
// published after that is one this member has not been around for.
//
// Pure, with no clock and no database: the loader reads the member's two
// columns, asks here, and writes the answer back on every load
// (`membersRepo.recordHomeLoad`, a single UPDATE). Tested on its own in
// `home-visit.test.ts`.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How long home can go unloaded before the visit is over. */
export const VISIT_GAP_MS = 30 * MINUTE_MS;

/**
 * How far back a member's very first visit looks. Without a floor, someone
 * invited to a band with a year of recordings would be told all of it is new.
 */
export const FIRST_VISIT_WINDOW_MS = 14 * DAY_MS;

export interface HomeVisitState {
  /** `members.home_last_seen_at`: the latest home load. */
  lastSeenAt: number | null;
  /** `members.home_last_visit_at`: when the previous visit ended. */
  lastVisitAt: number | null;
  /** `members.created_at`. */
  memberCreatedAt: number;
}

export interface HomeVisitDecision {
  /** Whether this load starts a new visit. */
  startsNewVisit: boolean;
  /** The two columns after this load. `lastSeenAt` is always this load. */
  lastSeenAt: number;
  lastVisitAt: number | null;
  /** A take published strictly after this is new. */
  since: number;
}

export function decideHomeVisit(state: HomeVisitState, now: number): HomeVisitDecision {
  const startsNewVisit = state.lastSeenAt === null || now - state.lastSeenAt > VISIT_GAP_MS;
  // The visit that just ended ended at its last load. On a first-ever load
  // there was none, so this stays null and the floor below applies.
  const lastVisitAt = startsNewVisit ? state.lastSeenAt : state.lastVisitAt;
  const since = lastVisitAt ?? Math.max(state.memberCreatedAt, now - FIRST_VISIT_WINDOW_MS);
  return { startsNewVisit, lastSeenAt: now, lastVisitAt, since };
}
