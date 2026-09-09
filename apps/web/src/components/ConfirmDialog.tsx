// Site-wide confirmation-dialog island. Islands may enhance, never enable:
// the real "are you sure" step is always the dedicated confirm PAGE that
// `data-confirm-action` points at (a plain `<form method="post">`, works
// with no JS at all). Once this island hydrates, it intercepts clicks on
// any `[data-confirm]` trigger and shows the same title/body/action as a
// modal instead, so a JS-capable browser doesn't need the extra page
// navigation — but nothing here is load-bearing for the action itself.
//
// Uses the native <dialog> element deliberately: `showModal()` gives a real
// focus trap, Escape-to-close, and — per the HTML spec's "dialog closing
// steps" — automatic focus restoration to whatever was focused before it
// opened (the trigger), for free, in every evergreen browser. Hand-rolling
// that is a common source of a11y bugs; the platform already does it.
import { useEffect, useRef, useState } from "preact/hooks";

interface ConfirmState {
  title: string;
  body: string;
  action: string;
  cta: string;
  /**
   * Where to go afterwards, when reloading the current page would land on
   * something that no longer exists. Optional: most confirms act ON the page
   * they were fired from and it survives — archiving a song leaves the song
   * page standing, with a banner. DELETING it does not.
   */
  redirect: string | undefined;
  /**
   * `false` when nothing is destroyed. The CTA used to be `.bp-btn-danger`
   * unconditionally, so "put it back" and "promote to keeper" arrived in the
   * danger colour — which teaches people to ignore it, and that colour has one
   * job. Mirrors `ConfirmActionPage`'s `tone`, and defaults the same way: a
   * trigger that says nothing is treated as destructive, so a new destructive
   * action cannot be dressed as a safe one by forgetting an attribute.
   */
  danger: boolean;
}

export default function ConfirmDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<ConfirmState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-confirm]");
      if (!target) {
        return;
      }
      // Capture phase, and stop the event dead. `<ClientRouter />` has its own
      // document-level click listener for links, registered when the layout
      // script runs — before this island hydrates — so in the bubble phase it
      // gets there first and navigates to the confirm PAGE before
      // `preventDefault()` here has run. That is why these confirms silently
      // stopped being modals the moment admin moved from its own layout (no
      // ClientRouter) into `AppLayout` (which has one).
      event.preventDefault();
      event.stopPropagation();
      setError(null);
      setPending(false);
      // Close whatever modal the trigger lives in first — a record sheet, say.
      // `showModal()` on this dialog while another one is open leaves it in
      // the inert subtree behind that one: the click was intercepted, nothing
      // appeared, and the only visible outcome was that the destructive
      // action seemed to do nothing. Confirming is also the end of whatever
      // that sheet was for, so closing it is right rather than merely
      // expedient.
      const owner = target.closest("dialog");
      if (owner instanceof HTMLDialogElement && owner.open) {
        owner.close();
      }
      const action =
        target.dataset.confirmAction ??
        (target instanceof HTMLAnchorElement ? target.href : undefined);
      if (!action) {
        return;
      }
      setState({
        title: target.dataset.confirmTitle ?? "Are you sure?",
        body: target.dataset.confirmBody ?? "This can't be undone.",
        action,
        cta: target.dataset.confirmCta ?? "Confirm",
        redirect: target.dataset.confirmRedirect,
        danger: target.dataset.confirmTone !== "neutral",
      });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (state && !dialog.open) {
      dialog.showModal();
    } else if (!state && dialog.open) {
      dialog.close();
    }
  }, [state]);

  function handleClose() {
    setState(null);
    setPending(false);
    setError(null);
  }

  async function handleConfirm() {
    if (!state) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(state.action, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "text/plain" },
      });
      if (!res.ok) {
        throw new Error(`That didn't work (status ${res.status}). Try again.`);
      }
      // `location.reload()` repeats the ORIGINAL request that loaded the
      // current document, method included — and on the token-creation
      // page, that document is itself the response to a `<form
      // method="post">` submission (the raw-secret page, rendered
      // directly rather than via a redirect — see admin-tokens.ts). If a
      // JS-enabled admin creates a token and then confirms an unrelated
      // dialog (e.g. revoking a different token) on that same page,
      // `reload()` would resubmit the create-token POST — either a
      // browser confirmation prompt or, if silently allowed, a second,
      // unwanted token. `location.replace()` with the same URL always
      // does a fresh GET navigation instead, regardless of how the
      // current document was loaded.
      // Somewhere else when the trigger named one, because the page this was
      // fired from may not exist any more — deleting a song from its own page
      // used to reload straight into a 404. The no-JS confirm pages already
      // redirect somewhere sensible; this is the same destination, said in the
      // markup so both paths agree.
      window.location.replace(state.redirect ?? window.location.href);
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="bp-dialog"
      aria-modal="true"
      aria-labelledby="bp-confirm-title"
      onClose={handleClose}
      onCancel={handleClose}
    >
      {state && (
        <>
          <h2 id="bp-confirm-title">{state.title}</h2>
          <p>{state.body}</p>
          {error && (
            <p class="bp-field-error" role="alert">
              {error}
            </p>
          )}
          <div class="bp-dialog-actions">
            <button
              type="button"
              class="bp-btn bp-btn-secondary"
              onClick={handleClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              class={`bp-btn ${state.danger ? "bp-btn-danger" : "bp-btn-primary"}`}
              onClick={handleConfirm}
              disabled={pending}
            >
              {state.danger && (
                /* Colour cannot be the only marker: solid danger against solid
                   accent measures 1.03:1 in the light theme. Same icon and
                   same reason as `ConfirmActionPage`'s. */
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 4.5v9" />
                  <path d="M12 18h.01" />
                  <path d="M10.3 3.2 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.2a2 2 0 0 0-3.4 0z" />
                </svg>
              )}
              {pending ? "Working…" : state.cta}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
