// The cross-tab half of "stash sync survives a member switch across tabs".
//
// A shared browser's session cookie is one cookie for every tab: sign out in
// tab 2 and sign in as someone else, and tab 1's NEXT request already
// authenticates as them — but tab 1's own JS (the sync runner's
// `currentMemberId`, the pending list's `memberId` prop) knows nothing of
// this until it next loads a page. The cookie is httpOnly, so nothing here
// can read it directly; `localStorage` plus the `storage` event is the
// signal every other open tab of the same origin actually receives.
//
// `encodeMemberSignal` / `decodeMemberSignal` are the decidable half — what a
// signal payload looks like, and what to do with one that is missing or
// garbage (an older deploy's tab, a hand-edited value). `broadcastMemberSignal`
// and `onMemberSignal` are the DOM-touching glue around them; see
// `docs/frontend-traps.md` and `stash-sync-logic.ts` for why the split.
export const MEMBER_SIGNAL_KEY = "bandplate-member-signal";

interface MemberSignalPayload {
  memberId: string | null;
  /** Breaks a tie between two signals written in the same millisecond. Not read back today; kept for a future ordering need. */
  at: number;
}

export function encodeMemberSignal(memberId: string | null): string {
  const payload: MemberSignalPayload = { memberId, at: Date.now() };
  return JSON.stringify(payload);
}

/**
 * The member a signal names, or `null` for "nobody" AND for anything that is
 * not a signal at all — absent (the `storage` event's `newValue` when the key
 * was deleted), malformed, or written by a deploy that shaped it differently.
 * Never throws: a signal this module cannot read is exactly as informative as
 * no signal, not a crash.
 */
export function decodeMemberSignal(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "memberId" in parsed &&
      (typeof (parsed as { memberId: unknown }).memberId === "string" ||
        (parsed as { memberId: unknown }).memberId === null)
    ) {
      return (parsed as MemberSignalPayload).memberId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Tells every OTHER open tab of this origin who is signed in now. Called on
 * every full page load (`startStashSync`) and right before a sign-out form
 * submits (`AppLayout.astro`) — the latter because `<ClientRouter />` may
 * turn that submit into a soft navigation that never re-runs the page's own
 * `startStashSync` call.
 *
 * Writing `localStorage` in THIS tab fires no `storage` event here (the spec
 * only fires it in other tabs), which is exactly what is wanted: this tab
 * already knows.
 */
export function broadcastMemberSignal(memberId: string | null): void {
  try {
    localStorage.setItem(MEMBER_SIGNAL_KEY, encodeMemberSignal(memberId));
  } catch {
    // Private browsing with site data blocked, or a full quota: this tab's
    // own state is unaffected, only OTHER tabs miss the signal. Nothing to
    // recover — the server-side check on upload is the backstop.
  }
}

/** Runs `onChange` with the new member id whenever another tab broadcasts one. */
export function onMemberSignal(onChange: (memberId: string | null) => void): void {
  window.addEventListener("storage", (event) => {
    if (event.key !== MEMBER_SIGNAL_KEY) {
      return;
    }
    onChange(decodeMemberSignal(event.newValue));
  });
}
