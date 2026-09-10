// The vote/favorite enhancement island — one hydrated component for the
// whole site, mounted once in `AppLayout.astro` (`client:load`,
// `transition:persist`), the same shape `Player.tsx` already established:
// every `VoteToggle`/`FavoriteToggle` renders PLAIN markup (a real
// `<form method="post">`, works with no JS at all), and this component
// delegates `submit` from `document` rather than binding per-row listeners
// — Astro replaces `<body>` on every view-transition navigation, so a
// listener bound to a specific element goes stale the moment the member
// navigates (see `Player.tsx`'s header comment for the identical
// reasoning, and `ConfirmDialog.tsx` for the same delegation pattern).
// One shared island keeps the JS budget to one chunk regardless of how
// many vote/favorite controls are on a page.
//
// Optimistic-with-rollback, never a spinner on a tap (brief's explicit
// requirement): `handleSubmit` applies the new state to every matching
// control/tally ON THE PAGE (a take can appear twice — see
// `TakeRow.astro`'s `transitionName` comment for why favorites/needs-vote
// sections can repeat a row) BEFORE the `fetch` resolves, remembers the
// PREVIOUS state, and reverts every one of those same elements plus shows
// a toast if the request fails. Forcing a failure to prove this is real
// (not just "looks right because it usually succeeds"): see
// task-8-report.md for how it was tested against the built server.
import { votingMessages } from "@bandplate/i18n";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import {
  type Tally,
  computeOptimisticTally,
  formatVoteTallyClient,
} from "../client/vote-favorite-actions.js";

interface ToastMessage {
  id: number;
  text: string;
}

let toastIdCounter = 0;

function readVoteForm(form: HTMLFormElement): { takeId: string; keeper: boolean } | null {
  const takeId = form.dataset.takeId;
  const keeperInput = form.querySelector<HTMLInputElement>('input[name="keeper"]');
  if (!takeId || !keeperInput) {
    return null;
  }
  return { takeId, keeper: keeperInput.value === "true" };
}

function readFavoriteForm(form: HTMLFormElement): { targetType: string; targetId: string } | null {
  const targetType = form.dataset.targetType;
  const targetId = form.dataset.targetId;
  if (!targetType || !targetId) {
    return null;
  }
  return { targetType, targetId };
}

/** Reads the CURRENT tally shown next to a take's vote controls — the
 *  optimistic update's starting point. Falls back to all-zero if no tally
 *  element is on the page for this take (a caller that renders `VoteToggle`
 *  without also rendering `[data-vote-tally-for]`, which doesn't happen
 *  today, but this keeps the function total rather than throwing).
 *
 *  The counts come off `data-*`, NOT out of the rendered sentence. This used
 *  to run `/(\d+) of (\d+).*\((\d+)%\)/` over `textContent`, which meant the
 *  optimistic-vote path only worked while `formatVoteTally` kept saying
 *  "3 of 5 votes say keeper (60%)" in that exact English shape. Translate the
 *  sentence and voting would have broken in the browser with every test still
 *  green. Numbers are the contract; the sentence is presentation.
 *
 *  `ratingScore` is derived rather than read for the same reason it isn't
 *  rendered as an attribute — it is a function of the other two, and storing
 *  it would let the two disagree. */
function readCurrentTally(takeId: string): Tally {
  const el = document.querySelector<HTMLElement>(`[data-vote-tally-for="${CSS.escape(takeId)}"]`);
  const keeperVotes = Number(el?.dataset.keeperVotes);
  const totalVotes = Number(el?.dataset.totalVotes);
  if (!Number.isFinite(keeperVotes) || !Number.isFinite(totalVotes)) {
    return { keeperVotes: 0, totalVotes: 0, ratingScore: 0 };
  }
  return { keeperVotes, totalVotes, ratingScore: totalVotes > 0 ? keeperVotes / totalVotes : 0 };
}

/** Reads the current member's own vote on a take from the DOM (whichever
 *  vote button is currently `aria-pressed="true"`), so a rollback has a
 *  real previous value to restore, not a guess. */
function readCurrentMyVote(takeId: string): boolean | undefined {
  const pressed = document.querySelector<HTMLButtonElement>(
    `[data-vote-form][data-take-id="${CSS.escape(takeId)}"] button[aria-pressed="true"]`,
  );
  if (!pressed) {
    return undefined;
  }
  const form = pressed.closest<HTMLFormElement>("[data-vote-form]");
  const keeperInput = form?.querySelector<HTMLInputElement>('input[name="keeper"]');
  return keeperInput?.value === "true";
}

/** Applies a vote state (this member's own pressed button + the shared
 *  tally text) to EVERY occurrence of this take on the page. */
function applyVoteState(takeId: string, myVote: boolean | undefined, tally: Tally): void {
  for (const form of document.querySelectorAll<HTMLFormElement>(
    `[data-vote-form][data-take-id="${CSS.escape(takeId)}"]`,
  )) {
    const keeperInput = form.querySelector<HTMLInputElement>('input[name="keeper"]');
    const button = form.querySelector<HTMLButtonElement>("button");
    if (!keeperInput || !button) {
      continue;
    }
    const thisButtonValue = keeperInput.value === "true";
    const pressed = myVote !== undefined && myVote === thisButtonValue;
    button.setAttribute("aria-pressed", String(pressed));
  }
  for (const el of document.querySelectorAll<HTMLElement>(
    `[data-vote-tally-for="${CSS.escape(takeId)}"]`,
  )) {
    // Both halves, together: the sentence a member reads and the counts the
    // NEXT optimistic update reads back. Writing only the text would leave
    // `readCurrentTally` seeing the pre-vote numbers, so a second vote on the
    // same take would compute its optimistic tally from a stale base.
    el.dataset.keeperVotes = String(tally.keeperVotes);
    el.dataset.totalVotes = String(tally.totalVotes);
    el.textContent = formatVoteTallyClient(tally.keeperVotes, tally.totalVotes, tally.ratingScore);
  }
}

/** Applies a favorite state to EVERY occurrence of this target on the page. */
function applyFavoriteState(targetType: string, targetId: string, favorited: boolean): void {
  const selector = `[data-favorite-form][data-target-type="${CSS.escape(targetType)}"][data-target-id="${CSS.escape(targetId)}"]`;
  for (const form of document.querySelectorAll<HTMLFormElement>(selector)) {
    const button = form.querySelector<HTMLButtonElement>("button");
    if (!button) {
      continue;
    }
    button.setAttribute("aria-pressed", String(favorited));
    const label = button.dataset.label ?? "";
    const tv = votingMessages(currentLocale());
    const actionLabel = favorited ? tv.favoriteRemove(label) : tv.favoriteAdd(label);
    button.setAttribute("aria-label", actionLabel);
    button.setAttribute("title", actionLabel);
  }
}

export default function VoteFavorite() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // `useCallback` with an empty dependency list: a stable function identity
  // is what lets the delegated-submit effect below list it as a real
  // dependency (`useExhaustiveDependencies`) WITHOUT re-registering the
  // `document` listener on every render — it only ever reads `setToasts`
  // (React's own stable setter) and the `toastTimers` ref (stable by
  // definition), never anything that changes across renders.
  const showToast = useCallback((text: string): void => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, text }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimers.current.delete(id);
    }, 5000);
    toastTimers.current.set(id, timer);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of toastTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    async function onSubmit(event: SubmitEvent) {
      const form = (event.target as HTMLElement | null)?.closest<HTMLFormElement>(
        "[data-vote-form], [data-favorite-form]",
      );
      if (!form) {
        return;
      }
      event.preventDefault();

      if (form.matches("[data-vote-form]")) {
        const parsed = readVoteForm(form);
        if (!parsed) {
          return;
        }
        const { takeId, keeper } = parsed;
        const previousMyVote = readCurrentMyVote(takeId);
        const previousTally = readCurrentTally(takeId);
        const optimisticTally = computeOptimisticTally(previousTally, previousMyVote, keeper);

        // Optimistic — applied BEFORE the request settles. Never a spinner
        // on a tap.
        applyVoteState(takeId, keeper, optimisticTally);

        try {
          const res = await fetch(form.action, {
            method: "POST",
            credentials: "same-origin",
            headers: { accept: "application/json" },
            body: new FormData(form),
          });
          if (!res.ok) {
            throw new Error(`vote request failed (${res.status})`);
          }
          const body = (await res.json()) as { keeper: boolean; tally: Tally };
          // Reconcile with the server's own numbers (defends against a
          // concurrent vote from someone else landing between the
          // optimistic guess and this response).
          applyVoteState(takeId, body.keeper, body.tally);
        } catch {
          applyVoteState(takeId, previousMyVote, previousTally);
          showToast(votingMessages(currentLocale()).saveFailed);
        }
        return;
      }

      const parsed = readFavoriteForm(form);
      if (!parsed) {
        return;
      }
      const { targetType, targetId } = parsed;
      const button = form.querySelector<HTMLButtonElement>("button");
      const previousFavorited = button?.getAttribute("aria-pressed") === "true";
      const optimisticFavorited = !previousFavorited;

      applyFavoriteState(targetType, targetId, optimisticFavorited);

      // The form's own hidden `favorited` field was computed once, at
      // server-render time — correct for a single no-JS submit, but stale
      // for a second JS-driven click on the same control with no page
      // reload in between (its value never changes on its own). Overwrite
      // it with the SAME desired state just applied to the DOM above, so
      // the request always carries the true next state, not a fixed
      // render-time guess — see `favoritesRepo.setFavorited`'s comment for
      // why the desired state (not a flip) is what the server needs.
      const requestBody = new FormData(form);
      requestBody.set("favorited", String(optimisticFavorited));

      try {
        const res = await fetch(form.action, {
          method: "POST",
          credentials: "same-origin",
          headers: { accept: "application/json" },
          body: requestBody,
        });
        if (!res.ok) {
          throw new Error(`favorite request failed (${res.status})`);
        }
        const responseBody = (await res.json()) as { favorited: boolean };
        applyFavoriteState(targetType, targetId, responseBody.favorited);
      } catch {
        applyFavoriteState(targetType, targetId, previousFavorited);
        showToast(votingMessages(currentLocale()).favoriteFailed);
      }
    }

    document.addEventListener("submit", onSubmit);
    return () => document.removeEventListener("submit", onSubmit);
  }, [showToast]);

  return (
    // `<output>` carries an implicit `role="status"` (and so an implicit
    // `aria-live="polite"` region) per the HTML AAM spec — the semantic
    // element Biome's a11y lint wants in place of `<div role="status">`.
    // `aria-live="polite"` is still stated explicitly rather than relied on
    // implicitly: never `.focus()`ed (a toast must not steal focus from
    // whatever the member was doing) and never `assertive`, which would
    // interrupt a screen reader mid-sentence for a non-urgent "couldn't
    // save" message.
    <output class="bp-toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <p class="bp-toast" key={toast.id}>
          {toast.text}
        </p>
      ))}
    </output>
  );
}
