// Holds the one `beforeinstallprompt` event a document gets.
//
// The event fires ONCE, early, and not again until the next full load. An
// island that listens for it itself is hydrated too late on a fast page and
// never sees it, so the listener lives here, imported by AppLayout's
// top-level <script>, which runs as soon as the document does. The island
// reads the store. Same module instance for both: Vite bundles it once.
import { atom } from "nanostores";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const $installPrompt = atom<BeforeInstallPromptEvent | null>(null);

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep Chrome's own mini-infobar out of the way; `/me` offers it instead.
    event.preventDefault();
    $installPrompt.set(event as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => $installPrompt.set(null));
}
