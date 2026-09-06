// Copy-to-clipboard enhancement for the one-time token secret. Purely an
// enhancement: the secret is also rendered as plain selectable text next to
// this button, so a no-JS (or clipboard-permission-denied) visitor can
// still get it by selecting and copying manually.
import { useState } from "preact/hooks";

interface Props {
  value: string;
  label?: string;
}

export default function CopyButton({ value, label = "Copy" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable or denied — no-op; the value is already
      // selectable text on the page.
    }
  }

  return (
    <button
      type="button"
      class="bl-btn bl-btn-secondary bl-btn-sm bl-copy-btn"
      onClick={handleClick}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
