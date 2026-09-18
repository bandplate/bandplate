// `/me`'s Notifications section. Renders nothing on the server and nothing
// until mounted — same reasoning as `InstallHint.tsx`: whether this browser
// can even do push, and whether it already has a live subscription, is only
// knowable client-side, and an empty heading is worse than no section.
//
// Registers `/sw.js` on mount (harmless if it's already the controller —
// `register()` with the same script URL is a no-op update check), then
// computes `PushUiState` via `decidePushUiState` (see `client/push-state.ts`
// for the branch order). While the state is `"on"`, every mount also:
//   - re-POSTs the current subscription, so a device that opens `/me` now
//     and then again in three months keeps its row from going stale for no
//     reason a member would ever notice;
//   - checks the subscription's own key against this deployment's current
//     `publicKey` (`subscriptionMatchesKey`) and, on a mismatch (a VAPID key
//     rotation since this device last subscribed), unsubscribes and
//     re-subscribes under the current key before POSTing.
//
// The three checkboxes are real `<input type="checkbox">` + `<label>`,
// JS-only by nature (subscribing at all is JS-only — there is no form this
// could degrade to), each PUTting the whole `NotificationPrefs` object on
// change per `notificationPrefsRepo.set`'s "writes all three every time"
// contract, with a quiet saved/failed line rather than a toast — this is a
// preference, not an action worth interrupting the page for.
import { useEffect, useState } from "preact/hooks";
import { isIos } from "../client/install-hint.js";
import {
  base64UrlToUint8Array,
  decidePushUiState,
  subscriptionMatchesKey,
} from "../client/push-state.js";

export interface NotificationPrefsValue {
  newTakes: boolean;
  weeklyUnvoted: boolean;
  songChanges: boolean;
}

interface Props {
  heading: string;
  publicKey: string;
  prefs: NotificationPrefsValue;
  turnOnLabel: string;
  turnOffLabel: string;
  iosNeedsInstallText: string;
  deniedText: string;
  unsupportedText: string;
  newTakesLabel: string;
  weeklyUnvotedLabel: string;
  songChangesLabel: string;
  savedText: string;
  saveFailedText: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

async function postSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  await fetch("/api/push/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

async function subscribe(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  // `BufferSource` wants a plain `ArrayBuffer`-backed view; `Uint8Array`'s own
  // type parameter is the wider `ArrayBufferLike` (which also covers
  // `SharedArrayBuffer`), so TypeScript can't see that `.buffer` is always the
  // former here. It always is — `base64UrlToUint8Array` builds the array with
  // `new Uint8Array(binary.length)`, never over an existing buffer.
  const applicationServerKey = base64UrlToUint8Array(publicKey).buffer as ArrayBuffer;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
}

export default function NotificationSettings(props: Props) {
  const [state, setState] = useState<
    "unsupported" | "ios-needs-install" | "denied" | "off" | "on" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(props.prefs);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Mount-time detection, registration, and the "keep it fresh / on the
  // current key" upkeep described above. Runs once per mount — this island
  // isn't `transition:persist` (nothing about it needs to survive a soft
  // navigation the way the player does), so `/me` reloading is what re-runs
  // it, which is exactly when it's worth re-checking anyway.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ios = isIos(navigator.userAgent, navigator.maxTouchPoints);
      const hasServiceWorker = "serviceWorker" in navigator;
      const hasPushManager = "PushManager" in window;
      const hasNotification = "Notification" in window;
      const permission: NotificationPermission = hasNotification
        ? Notification.permission
        : "denied";

      let subscription: PushSubscription | null = null;
      if (hasServiceWorker && hasPushManager) {
        try {
          const registration = await navigator.serviceWorker.register("/sw.js");
          const ready = await navigator.serviceWorker.ready.catch(() => registration);
          subscription = await ready.pushManager.getSubscription();
        } catch {
          subscription = null;
        }
      }

      let nextState = decidePushUiState({
        hasServiceWorker,
        hasPushManager,
        hasNotification,
        permission,
        standalone,
        ios,
        subscribed: subscription !== null,
      });

      if (nextState === "on" && subscription) {
        const keyMatches = subscriptionMatchesKey(
          subscription.options.applicationServerKey,
          props.publicKey,
        );
        if (!keyMatches) {
          try {
            await subscription.unsubscribe();
            const registration = await navigator.serviceWorker.ready;
            subscription = await subscribe(registration, props.publicKey);
            await postSubscription(subscription);
          } catch {
            nextState = "off";
            subscription = null;
          }
        } else {
          // Best effort — keeps the row from going stale. A failure here
          // just means the device tries again next time `/me` loads.
          postSubscription(subscription).catch(() => {});
        }
      }

      if (!cancelled) {
        setState(nextState);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [props.publicKey]);

  async function handleTurnOn() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(
          decidePushUiState({
            hasServiceWorker: true,
            hasPushManager: true,
            hasNotification: true,
            permission,
            standalone:
              window.matchMedia("(display-mode: standalone)").matches ||
              (navigator as Navigator & { standalone?: boolean }).standalone === true,
            ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
            subscribed: false,
          }),
        );
        return;
      }
      const subscription = await subscribe(registration, props.publicKey);
      await postSubscription(subscription);
      setState("on");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function handleTurnOff() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function handlePrefChange(key: keyof NotificationPrefsValue, checked: boolean) {
    const next = { ...prefs, [key]: checked };
    setPrefs(next);
    setSaveState("saving");
    try {
      const res = await fetch("/api/push/prefs", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        throw new Error(`prefs save failed (${res.status})`);
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  if (state === null) {
    return null;
  }

  return (
    <section>
      <h2 class="bp-section-title bp-profile-section">{props.heading}</h2>
      {state === "unsupported" && <p class="bp-field-hint bp-m0">{props.unsupportedText}</p>}
      {state === "denied" && <p class="bp-field-hint bp-m0">{props.deniedText}</p>}
      {state === "ios-needs-install" && (
        <p class="bp-field-hint bp-m0">{props.iosNeedsInstallText}</p>
      )}
      {state === "off" && (
        <button
          type="button"
          class="bp-btn bp-btn-quiet bp-btn-sm"
          disabled={busy}
          onClick={handleTurnOn}
        >
          {props.turnOnLabel}
        </button>
      )}
      {state === "on" && (
        <>
          <button
            type="button"
            class="bp-btn bp-btn-quiet bp-btn-sm"
            disabled={busy}
            onClick={handleTurnOff}
          >
            {props.turnOffLabel}
          </button>
          <fieldset class="bp-checkbox-group">
            <legend class="bp-visually-hidden">{props.heading}</legend>
            <div class="bp-checkbox-item">
              <input
                type="checkbox"
                id="notify-new-takes"
                checked={prefs.newTakes}
                onChange={(event) =>
                  handlePrefChange("newTakes", (event.target as HTMLInputElement).checked)
                }
              />
              <label for="notify-new-takes">{props.newTakesLabel}</label>
            </div>
            <div class="bp-checkbox-item">
              <input
                type="checkbox"
                id="notify-weekly-unvoted"
                checked={prefs.weeklyUnvoted}
                onChange={(event) =>
                  handlePrefChange("weeklyUnvoted", (event.target as HTMLInputElement).checked)
                }
              />
              <label for="notify-weekly-unvoted">{props.weeklyUnvotedLabel}</label>
            </div>
            <div class="bp-checkbox-item">
              <input
                type="checkbox"
                id="notify-song-changes"
                checked={prefs.songChanges}
                onChange={(event) =>
                  handlePrefChange("songChanges", (event.target as HTMLInputElement).checked)
                }
              />
              <label for="notify-song-changes">{props.songChangesLabel}</label>
            </div>
          </fieldset>
          {saveState === "saved" && <p class="bp-field-hint bp-m0">{props.savedText}</p>}
          {saveState === "error" && <p class="bp-field-error">{props.saveFailedText}</p>}
        </>
      )}
    </section>
  );
}
