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
      event.preventDefault();
      setError(null);
      setPending(false);
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
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
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
      window.location.replace(window.location.href);
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="bl-dialog"
      aria-modal="true"
      aria-labelledby="bl-confirm-title"
      onClose={handleClose}
      onCancel={handleClose}
    >
      {state && (
        <>
          <h2 id="bl-confirm-title">{state.title}</h2>
          <p>{state.body}</p>
          {error && (
            <p class="bl-field-error" role="alert">
              {error}
            </p>
          )}
          <div class="bl-dialog-actions">
            <button
              type="button"
              class="bl-btn bl-btn-secondary"
              onClick={handleClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              class="bl-btn bl-btn-danger"
              onClick={handleConfirm}
              disabled={pending}
            >
              {pending ? "Working…" : state.cta}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
