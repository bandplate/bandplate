// `/me`'s install section. Renders nothing on the server and nothing until
// mounted: whether the page is installed, and on what, is only knowable in
// the browser, and an empty heading is worse than no section.
import { useStore } from "@nanostores/preact";
import { useEffect, useState } from "preact/hooks";
import { type InstallHint as Hint, decideInstallHint } from "../client/install-hint.js";
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
    await prompt.prompt();
    // A prompt is single-use whatever the answer.
    $installPrompt.set(null);
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
