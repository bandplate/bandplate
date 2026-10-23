// The icon-only Share button on a song, event or take page. Rendered through
// `ShareButton.astro`, which passes the icon in as children (`@lucide/astro`,
// one icon per import).
//
// The decisions are `client/share-action.ts`'s and tested there. What this
// file does is the timing: ask for the short link once the page is idle, so
// that a tap can call `navigator.share` straight away, inside the gesture,
// which is the only place iOS Safari allows it. See that module's header.
//
// A take's or an event's link can be made PUBLIC. For those, the tap opens a
// small sheet first, with the switch and what a stranger would and would not
// see, and the sheet's own Share button is the tap that reaches
// `navigator.share`. The switch is a separate press with its own request, so
// nothing awaits between a tap and the share sheet either way. A song (never
// public), or a link whose state has not arrived yet, shares at once as it
// always did.
import { islandsMessages, type Locale } from "@bandplate/i18n";
import { Copy, Share2, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { copyText } from "../client/clipboard.js";
import { currentLocale } from "../client/locale.js";
import {
  afterShareError,
  type ShareState,
  shareMechanism,
  shareStateFrom,
  shareUrl,
  tapOpensSheet,
} from "../client/share-action.js";

/** Read at call time — see `client/locale.ts`. */
const ti = (fallback?: Locale) => islandsMessages(currentLocale(fallback));

interface Props {
  kind: "song" | "event" | "take";
  targetId: string;
  /** What `navigator.share` names the link: the song's title, the event's name, the take's title. */
  title: string;
  /** `sm` in a page's body, `xs` in the header tier (the two button sizes). */
  size: "sm" | "xs";
  /** The page's language, for the server render; see `CopyButton.tsx`. */
  locale?: Locale;
  children?: ComponentChildren;
}

/**
 * One request per target per page, however many buttons ask. A detail page
 * renders two (the hero's and the phone header's, one of them hidden), and
 * both would otherwise POST the same thing. A switch press replaces the
 * entry with its answer, so the other button opens on the new state.
 */
const pending = new Map<string, Promise<ShareState | undefined>>();

function postShare(
  kind: Props["kind"],
  targetId: string,
  makePublic?: boolean,
): Promise<ShareState | undefined> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("id", targetId);
  if (makePublic !== undefined) {
    body.set("public", makePublic ? "1" : "0");
  }
  return (
    fetch("/share", {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      body,
    })
      .then((res) => (res.ok ? res.json() : undefined))
      .then(shareStateFrom)
      // A failed request is not an error worth showing here: the button
      // shares the page's own address instead, which works for any
      // signed-in member. A failed SWITCH says so in the sheet.
      .catch(() => undefined)
  );
}

function requestShareState(kind: Props["kind"], targetId: string): Promise<ShareState | undefined> {
  const key = `${kind}:${targetId}`;
  const known = pending.get(key);
  if (known) {
    return known;
  }
  const request = postShare(kind, targetId);
  pending.set(key, request);
  return request;
}

/** `requestIdleCallback` where there is one (not Safari), a short timeout where not. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 200);
  return () => window.clearTimeout(handle);
}

const TOAST_MS = 2500;

export default function ShareButton({ kind, targetId, title, size, locale, children }: Props) {
  // Both: the ref for the tap, which must read it synchronously, and the
  // state for the sheet, which renders it.
  const stateRef = useRef<ShareState | undefined>(undefined);
  const [state, setState] = useState<ShareState | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();

  function remember(next: ShareState | undefined) {
    stateRef.current = next;
    setState(next);
  }

  useEffect(() => {
    let live = true;
    const cancel = whenIdle(() => {
      void requestShareState(kind, targetId).then((next) => {
        if (live) {
          remember(next);
        }
      });
    });
    return () => {
      live = false;
      cancel();
      window.clearTimeout(toastTimer.current);
    };
  }, [kind, targetId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function announce(text: string) {
    window.clearTimeout(toastTimer.current);
    // A fresh id each time, so pressing twice announces twice.
    setToast({ id: Date.now(), text });
    toastTimer.current = window.setTimeout(() => setToast(undefined), TOAST_MS);
  }

  async function copy(url: string) {
    const ok = await copyText(url);
    announce(ok ? ti(locale).shareCopied : ti(locale).shareCopyFailed);
  }

  /** Synchronous up to `navigator.share`: no await may sit between the tap and the call, or iOS drops the gesture. */
  function shareNow() {
    const url = shareUrl(stateRef.current?.shortPath, window.location);
    if (shareMechanism(navigator) === "share") {
      navigator.share({ title, url }).catch((error: unknown) => {
        if (afterShareError(error) === "copy") {
          void copy(url);
        }
      });
      return;
    }
    void copy(url);
  }

  function handleClick() {
    if (!tapOpensSheet(stateRef.current)) {
      shareNow();
      return;
    }
    setSwitchFailed(false);
    setOpen(true);
    // The other copy of this button may have flipped the switch since.
    void requestShareState(kind, targetId).then(remember);
  }

  function toggle() {
    const current = stateRef.current;
    if (!current || switching) {
      return;
    }
    setSwitching(true);
    setSwitchFailed(false);
    const request = postShare(kind, targetId, !current.isPublic);
    void request.then((next) => {
      setSwitching(false);
      if (next) {
        pending.set(`${kind}:${targetId}`, request);
        remember(next);
      } else {
        setSwitchFailed(true);
      }
    });
  }

  const t = ti(locale);
  const label = t.share;
  const isPublic = state?.isPublic === true;
  const linkUrl = state ? shareUrl(state.shortPath, window.location) : "";
  return (
    <>
      <button
        type="button"
        class={`bp-btn bp-btn-secondary bp-btn-${size} bp-btn-icon`}
        aria-label={label}
        title={label}
        aria-haspopup={tapOpensSheet(state) ? "dialog" : undefined}
        onClick={handleClick}
      >
        {children}
      </button>
      {/* The same toast the votes use, so "Link copied" looks like every
          other passing note in the app. `<output>` is an implicit polite live
          region; it is never focused. */}
      <output class="bp-toast-region" aria-live="polite">
        {toast && (
          <p class="bp-toast" key={toast.id}>
            {toast.text}
          </p>
        )}
      </output>
      {state?.canBePublic && (
        // A click on the backdrop lands on the dialog element itself, which
        // has no padding of its own for that reason (see the Hraje sheet);
        // Escape is the keyboard way out, as is the close button.
        // biome-ignore lint/a11y/useKeyWithClickEvents: see comment above
        <dialog
          ref={dialogRef}
          class="bp-share-sheet"
          aria-labelledby={`${id}-title`}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div class="bp-share-sheet-body">
            <div class="bp-share-sheet-head">
              <div class="bp-share-sheet-heading">
                <h2 id={`${id}-title`} class="bp-share-sheet-title">
                  {kind === "event" ? t.shareSheetEvent : t.shareSheetTake}
                </h2>
                <span class="bp-share-sheet-sub">{title}</span>
              </div>
              <button
                type="button"
                class="bp-btn bp-btn-secondary bp-btn-xs bp-btn-icon"
                aria-label={t.shareClose}
                onClick={() => setOpen(false)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            <div class="bp-share-switch-row">
              <div class="bp-share-switch-text">
                <span id={`${id}-switch`} class="bp-share-switch-label">
                  {t.sharePublicLabel}
                </span>
                <span class="bp-share-switch-hint">
                  {isPublic ? t.sharePublicOn : t.sharePublicOff}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                class="bp-switch"
                aria-checked={isPublic}
                aria-labelledby={`${id}-switch`}
                aria-busy={switching}
                disabled={switching}
                onClick={toggle}
              >
                <span class="bp-switch-thumb" aria-hidden="true" />
              </button>
            </div>
            {switchFailed && (
              <p class="bp-share-sheet-error bp-m0" role="status">
                {t.shareSwitchFailed}
              </p>
            )}

            {isPublic ? (
              <div class="bp-share-facts">
                <div class="bp-take-panel-cell">
                  <span class="bp-take-panel-label">{t.shareOthersSeeLabel}</span>
                  <span>{kind === "event" ? t.shareOthersSeeEvent : t.shareOthersSeeTake}</span>
                </div>
                <div class="bp-take-panel-cell">
                  <span class="bp-take-panel-label">{t.shareOthersMissLabel}</span>
                  <span>{t.shareOthersMiss}</span>
                </div>
              </div>
            ) : (
              <div class="bp-share-facts">
                <div class="bp-take-panel-cell">
                  <span class="bp-take-panel-label">{t.shareNowLabel}</span>
                  <span>{t.shareMembersOnly}</span>
                </div>
              </div>
            )}

            {/* Mono: a machine string someone may read out or type. */}
            {isPublic && <p class="bp-share-link bp-m0">{linkUrl}</p>}

            <div class="bp-share-actions">
              <button
                type="button"
                class="bp-btn bp-btn-primary bp-btn-sm"
                onClick={() => {
                  shareNow();
                  setOpen(false);
                }}
              >
                <Share2 size={16} aria-hidden="true" />
                {t.share}
              </button>
              <button
                type="button"
                class="bp-btn bp-btn-secondary bp-btn-sm"
                onClick={() => {
                  void copy(linkUrl);
                  setOpen(false);
                }}
              >
                <Copy size={16} aria-hidden="true" />
                {t.copy}
              </button>
            </div>

            {isPublic && <p class="bp-share-sheet-note bp-m0">{t.shareTurnOffNote}</p>}
          </div>
        </dialog>
      )}
    </>
  );
}
