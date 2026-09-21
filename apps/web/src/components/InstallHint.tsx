// `/me`'s install section. Renders nothing on the server and nothing until
// mounted: whether the page is installed, and on what, is only knowable in
// the browser, and an empty heading is worse than no section.
import { useStore } from "@nanostores/preact";
import { useEffect, useState } from "preact/hooks";
import { decideInstallHint, type InstallHint as Hint } from "../client/install-hint.js";
import { $installPrompt } from "../client/install-prompt.js";

interface Props {
  heading: string;
  action: string;
  iosSteps: string;
}

export default function InstallHint({ heading, action, iosSteps }: Props) {
  const prompt = useStore($installPrompt);
  const [hint, setHint] = useState<Hint>("none");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setHint(
      decideInstallHint({
        standalone,
        promptAvailable: prompt !== null,
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        // Sign-in by code hasn't shipped yet; see install-hint.ts's header.
        iosSignInWorks: false,
      }),
    );
  }, [prompt]);

  if (hint === "none") {
    return null;
  }

  const install = async () => {
    if (!prompt) {
      return;
    }
    // Clear before awaiting, and keep a local reference: a prompt is
    // single-use whatever the answer, and a second tap while the first is
    // still pending must not see it as available again.
    $installPrompt.set(null);
    try {
      await prompt.prompt();
    } catch {
      // Already shown once, dismissed some other way, or the browser
      // revoked it — nothing to do; there is no button left to re-disable.
    }
  };

  return (
    <section>
      <h2 class="bp-section-title bp-profile-section">{heading}</h2>
      {hint === "prompt" ? (
        <button type="button" class="bp-btn bp-btn-quiet bp-btn-sm" onClick={install}>
          {action}
        </button>
      ) : (
        <p class="bp-field-hint bp-m0">{iosSteps}</p>
      )}
    </section>
  );
}
