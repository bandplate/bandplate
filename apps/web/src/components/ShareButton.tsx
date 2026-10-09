// The icon-only Share button on a song, event or take page. Rendered through
// `ShareButton.astro`, which passes the icon in as children (`@lucide/astro`,
// one icon per import: `lucide-preact` only offers its barrel).
//
// The decisions are `client/share-action.ts`'s and tested there. What this
// file does is the timing: ask for the short link once the page is idle, so
// that a tap can call `navigator.share` straight away, inside the gesture,
// which is the only place iOS Safari allows it. See that module's header.
import { islandsMessages, type Locale } from "@bandplate/i18n";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { copyText } from "../client/clipboard.js";
import { currentLocale } from "../client/locale.js";
import {
  afterShareError,
  shareMechanism,
  shareUrl,
  shortPathFrom,
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
 * both would otherwise POST the same thing.
 */
const pending = new Map<string, Promise<string | undefined>>();

function requestShortPath(kind: Props["kind"], targetId: string): Promise<string | undefined> {
  const key = `${kind}:${targetId}`;
  const known = pending.get(key);
  if (known) {
    return known;
  }
  const body = new FormData();
  body.set("kind", kind);
  body.set("id", targetId);
  const request = fetch("/share", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    body,
  })
    .then((res) => (res.ok ? res.json() : undefined))
    .then(shortPathFrom)
    // A failed request is not an error worth showing: the button shares the
    // page's own address instead, which works for any signed-in member.
    .catch(() => undefined);
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
  const shortPath = useRef<string | undefined>(undefined);
  const [toast, setToast] = useState<{ id: number; text: string } | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const cancel = whenIdle(() => {
      void requestShortPath(kind, targetId).then((path) => {
        if (live) {
          shortPath.current = path;
        }
      });
    });
    return () => {
      live = false;
      cancel();
      window.clearTimeout(toastTimer.current);
    };
  }, [kind, targetId]);

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

  function handleClick() {
    // Everything up to `navigator.share` is synchronous: no await may sit
    // between the tap and the call, or iOS drops the gesture.
    const url = shareUrl(shortPath.current, window.location);
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

  const label = ti(locale).share;
  return (
    <>
      <button
        type="button"
        class={`bp-btn bp-btn-secondary bp-btn-${size} bp-btn-icon`}
        aria-label={label}
        title={label}
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
    </>
  );
}
