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
import { type Locale, islandsMessages } from "@bandplate/i18n";
import { currentLocale } from "../client/locale.js";

/** Read at call time, never captured: this island is `transition:persist`. */
const ti = (fallback?: Locale) => islandsMessages(currentLocale(fallback));
import { TriangleAlert } from "lucide-preact";
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
  /**
   * Where to fetch the consequence from, when it cannot be a static string.
   *
   * Most confirms state their consequence in the markup, because the trigger
   * already knows it. Some cannot: merging two instruments has to look at
   * what the pair actually share before it can say which chord chart and
   * which audio file the merge destroys. That answer lives on the server, so
   * the dialog opens first and asks.
   */
  bodyUrl?: string;
  /**
   * A submit button whose own form IS the action: confirming submits that
   * form, fields and all, rather than posting an empty body to
   * `data-confirm-action`. For a write whose inputs the member has just
   * chosen in a sheet (a song picked for a recording) — a URL cannot carry
   * those, and the form already does.
   */
  submitter?: HTMLButtonElement;
  /** Lines under the body, one per thing that will not survive. */
  details?: string[];
  /**
   * A single prominent line, for the answer that is GOOD news.
   *
   * Not a `details` entry: that list is muted, small and scrollable, which is
   * right for a tally of losses and wrong for "nothing is lost" — the one
   * sentence someone opening a destructive dialog most wants to find.
   */
  note?: string;
}

export default function ConfirmDialog({ locale }: { locale?: Locale } = {}) {
  // `locale` is the SSR fallback for the markup below. Everything inside the
  // delegated listener runs in the browser, where `<html lang>` is readable,
  // so those calls take no fallback and the effect keeps its empty deps.
  void locale;
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
      const submitter =
        target instanceof HTMLButtonElement &&
        target.type === "submit" &&
        target.form &&
        !target.dataset.confirmAction
          ? target
          : undefined;
      // A form that is not ready to send is not ready to confirm: let the
      // browser's own validation speak (a song not yet picked, say) instead
      // of asking "are you sure?" about a submission that cannot happen.
      if (submitter && !submitter.form?.checkValidity()) {
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
      if (!action && !submitter) {
        return;
      }
      // A trigger whose action depends on a control beside it — a picker
      // choosing what to merge into — names that control here, and its
      // `name=value` is appended to both the action and the body URL. The
      // alternative was a `data-confirm-action` the markup cannot know,
      // because the value is chosen after the page renders.
      const from = target.dataset.confirmQueryFrom;
      const control = from ? document.querySelector<HTMLSelectElement>(from) : null;
      const query = control?.name
        ? `?${encodeURIComponent(control.name)}=${encodeURIComponent(control.value)}`
        : "";

      const bodyUrl = target.dataset.confirmBodyUrl;
      setState({
        title: target.dataset.confirmTitle ?? ti().confirmTitle,
        body: target.dataset.confirmBody ?? (bodyUrl ? ti().confirmLoading : ti().confirmBody),
        action: action ? `${action}${query}` : "",
        submitter,
        cta: target.dataset.confirmCta ?? ti().confirmCta,
        redirect: target.dataset.confirmRedirect,
        danger: target.dataset.confirmTone !== "neutral",
        bodyUrl: bodyUrl ? `${bodyUrl}${query}` : undefined,
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

  /**
   * Fetch the consequence for a dialog that could not state it in markup.
   *
   * The dialog is already open while this runs: waiting for a round trip
   * before showing anything would make the press feel broken on a slow
   * connection, and the title is already true. `live` guards the case where
   * it is closed and reopened before the answer lands.
   */
  useEffect(() => {
    const url = state?.bodyUrl;
    if (!url) {
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch(url, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        const payload = (await res.json()) as {
          title?: string;
          body?: string;
          details?: string[];
          note?: string;
        };
        if (!live) {
          return;
        }
        setState((current) =>
          current && current.bodyUrl === url
            ? {
                ...current,
                title: payload.title ?? current.title,
                body: payload.body ?? current.body,
                details: payload.details,
                note: payload.note,
              }
            : current,
        );
      } catch {
        if (live) {
          // The confirm stays usable: the server re-checks the consequence on
          // POST anyway, so a failed preview must not block the action — it
          // just means this dialog cannot show the detail.
          setState((current) =>
            current && current.bodyUrl === url ? { ...current, body: ti().confirmBody } : current,
          );
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [state?.bodyUrl]);

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
    if (state.submitter?.form) {
      // The form's own submission, so the page's handler sees exactly what
      // it would have seen without this dialog, and a failure renders where
      // every other form error on that page renders.
      state.submitter.form.requestSubmit(state.submitter);
      return;
    }
    try {
      const res = await fetch(state.action, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "text/plain" },
      });
      if (!res.ok) {
        throw new Error(ti().confirmFailedStatus(res.status));
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
      setError(err instanceof Error ? err.message : ti().confirmFailed);
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
          {state.note && <p class="bp-dialog-note">{state.note}</p>}
          {state.details && state.details.length > 0 && (
            /* A list, not a sentence: each line is a different thing that
               will not survive, and running them together is how someone
               approves one without reading the others. */
            <ul class="bp-dialog-details">
              {state.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
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
              {ti().confirmCancel}
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
                <TriangleAlert aria-hidden="true" />
              )}
              {pending ? ti().confirmWorking : state.cta}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
