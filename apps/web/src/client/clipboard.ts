// Copying text, with the fallback `navigator.clipboard` needs. Shared by
// `CopyButton` (a token secret) and `ShareButton` (a link). DOM only, so no
// node test; see `CopyButton.tsx`'s header for why the fallback exists.

/**
 * The pre-`navigator.clipboard` path: a throwaway textarea, selected and
 * copied synchronously inside the click's own task. Returns whether it
 * worked. Deliberately not `position: fixed; opacity: 0` — a zero-size
 * off-screen textarea is what browsers reliably still allow `select()` on.
 */
export function copyViaExecCommand(value: string): boolean {
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

/** `navigator.clipboard` first, then the synchronous fallback. Whether either worked. */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyViaExecCommand(value);
  }
}
