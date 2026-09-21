// Copy-to-clipboard enhancement for the one-time token secret. Purely an
// enhancement: the secret is also rendered as plain selectable text next to
// this button, so a no-JS (or clipboard-permission-denied) visitor can
// still get it by selecting and copying manually.
//
// --- Why this is more than one `writeText` call --------------------------
//
// The value here is a credential shown EXACTLY ONCE. There is no "copy it
// again" — a failed copy means creating a second token and revoking the
// first. That asymmetry is why this component does two things a simpler
// copy button doesn't:
//
//  1. It FALLS BACK. `navigator.clipboard.writeText` rejects in more
//     situations than its ubiquity suggests: a document that isn't focused,
//     a permissions policy, a browser extension holding the clipboard, an
//     insecure context behind a reverse proxy that terminates TLS upstream
//     (a real self-hosting shape for this app). The `execCommand` path is
//     deprecated and synchronous and works in every one of those cases.
//
//  2. It FAILS LOUDLY. The previous version swallowed the rejection and
//     left the label reading "Copy" — indistinguishable from a button the
//     member hadn't pressed yet, and easy to read as "it copied" while the
//     clipboard still held whatever was there before. For a
//     shown-once secret that is the worst possible failure mode: the
//     member navigates away believing they have it.
import { type Locale, islandsMessages } from "@bandplate/i18n";
import { useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";

/** Read at call time — see `client/locale.ts`. */
const ti = (fallback?: Locale) => islandsMessages(currentLocale(fallback));

interface Props {
  /**
   * The page's language, for the SERVER render.
   *
   * `client:load` renders on the server, where there is no `document` to read
   * `<html lang>` from — and Preact's `hydrate()` does NOT patch an attribute
   * that differs, so an English server pass STICKS in the DOM rather than
   * being corrected on the client. The prop is the fallback only; the live
   * `lang` still wins in the browser, which is what keeps this right after a
   * language change.
   */
  locale?: Locale;
  value: string;
  label?: string;
}

/**
 * The pre-`navigator.clipboard` path: a throwaway textarea, selected and
 * copied synchronously inside the click's own task. Returns whether it
 * worked. Deliberately not `position: fixed; opacity: 0` — a zero-size
 * off-screen textarea is what browsers reliably still allow `select()` on.
 */
function copyViaExecCommand(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export default function CopyButton({ value, label, locale }: Props) {
  // Not a default in the signature: that would be evaluated before `locale`
  // is in scope, and on the server it would resolve to English.
  const copyLabel = label ?? ti(locale).copy;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
      return;
    } catch {
      // Fall through to the synchronous path below.
    }

    if (copyViaExecCommand(value)) {
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
      return;
    }

    // No timeout on the failure state: it must stay on screen until the
    // member does something about it, because the thing they need is still
    // sitting above the button and about to disappear.
    setState("failed");
  }

  /*
   * NO live region of its own, deliberately. Every caller renders this inside
   * a `<Banner>`, which is already `role="status"` — so the whole subtree,
   * button label included, sits in a polite live region and any text change
   * here is announced once. Adding `role="status"` (or `role="alert"`) to
   * anything below would nest a live region inside a live region, which
   * announces twice on most screen readers. If this component ever grows a
   * caller outside a banner, that caller owns the announcement.
   */
  return (
    <>
      <button
        type="button"
        class="bp-btn bp-btn-secondary bp-btn-sm bp-copy-btn"
        onClick={handleClick}
      >
        {state === "copied"
          ? ti(locale).copied
          : state === "failed"
            ? ti(locale).copyFailed
            : copyLabel}
      </button>
      {state === "failed" && (
        <p class="bp-field-error bp-m0">
          Your browser blocked the clipboard. Select the secret above and copy it manually — it will
          not be shown again.
        </p>
      )}
    </>
  );
}
