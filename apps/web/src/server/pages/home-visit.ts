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
// A member's very first visit has no previous one, so its baseline is
// computed (the later of their joining and 14 days ago) and then STORED as
// `lastVisitAt` like any other. Left computed on every load, "14 days ago"
// would slide forward with each reload, and a take published 14 days and one
// minute before the first load would drop off the card mid-visit.
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
  lastVisitAt: number;
  /** A take published strictly after this is new. */
  since: number;
}

/** The baseline for a member who has never visited: their joining, or 14 days ago. */
function firstVisitBaseline(memberCreatedAt: number, now: number): number {
  return Math.max(memberCreatedAt, now - FIRST_VISIT_WINDOW_MS);
}

export function decideHomeVisit(state: HomeVisitState, now: number): HomeVisitDecision {
  const startsNewVisit = state.lastSeenAt === null || now - state.lastSeenAt > VISIT_GAP_MS;
  // A new visit: the one that just ended ended at its last load. With no
  // previous visit at all, the first-visit baseline is frozen in its place.
  // Mid-visit, the stored baseline carries on; the fallback only covers a row
  // whose visit began without one being stored.
  const lastVisitAt = startsNewVisit
    ? (state.lastSeenAt ?? state.lastVisitAt ?? firstVisitBaseline(state.memberCreatedAt, now))
    : (state.lastVisitAt ?? firstVisitBaseline(state.memberCreatedAt, now));
  return { startsNewVisit, lastSeenAt: now, lastVisitAt, since: lastVisitAt };
}
