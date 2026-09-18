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
//     rotation since this device last subscribed), unsubscribes, deletes the
//     OLD endpoint's server row, and re-subscribes under the current key
//     before POSTing the new one — in that order, so a member who never
//     returns doesn't leave two rows (or an orphaned one) for the same
//     device.
//
// Every write to the server is checked, not fired-and-forgotten: a failed
// subscribe/unsubscribe/pref save says so in a quiet line rather than
// silently leaving the UI claiming something the server doesn't agree with.
// A failed subscribe also unsubscribes the browser-side `PushSubscription`
// it just created — otherwise the NEXT mount finds a live subscription with
// no matching server row and reports "on" for a device that was never
// actually registered.
//
// The three checkboxes are real `<input type="checkbox">` + `<label>`,
// JS-only by nature (subscribing at all is JS-only — there is no form this
// could degrade to), each PUTting the whole `NotificationPrefs` object on
// change per `notificationPrefsRepo.set`'s "writes all three every time"
// contract. A checkbox flipped again before the previous PUT resolves fires
// a second request; `isCurrentRequest` (see `client/push-state.ts`) makes
// sure only the LATEST request's response ever touches the checkbox or the
// saved/failed line, so a slow, stale response can't revert a change the
// member already made. A failed PUT reverts the checkbox to what it was
// before this change, since the server never actually saved the flip.
import { useEffect, useRef, useState } from "preact/hooks";
import { isIos } from "../client/install-hint.js";
import {
  base64UrlToUint8Array,
  decidePushUiState,
  isCurrentRequest,
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
  turnOnFailedText: string;
  turnOffFailedText: string;
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

/** Throws when the server didn't actually accept the subscription. */
async function postSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  if (!res.ok) {
    throw new Error(`subscribe POST failed (${res.status})`);
  }
}

/** Throws when the server didn't actually confirm the removal. */
async function deleteSubscription(endpoint: string): Promise<void> {
  const res = await fetch("/api/push/subscriptions", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    throw new Error(`unsubscribe DELETE failed (${res.status})`);
  }
}

function currentStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Subscribes this browser and POSTs the result. On a server rejection (the
 * 10-device cap, an invalid key, a 5xx — anything `postSubscription` throws
 * on), the freshly created browser-side subscription is unsubscribed again
 * before re-throwing, so the caller is never left in a state where the
 * browser believes it's subscribed but the server holds no matching row.
 */
async function subscribeAndPost(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  // `BufferSource` wants a plain `ArrayBuffer`-backed view; `Uint8Array`'s own
  // type parameter is the wider `ArrayBufferLike` (which also covers
  // `SharedArrayBuffer`), so TypeScript can't see that `.buffer` is always the
  // former here. It always is — `base64UrlToUint8Array` builds the array with
  // `new Uint8Array(binary.length)`, never over an existing buffer.
  const applicationServerKey = base64UrlToUint8Array(publicKey).buffer as ArrayBuffer;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  try {
    await postSubscription(subscription);
  } catch (err) {
    await subscription.unsubscribe().catch(() => {});
    throw err;
  }
  return subscription;
}

export default function NotificationSettings(props: Props) {
  const [state, setState] = useState<
    "unsupported" | "ios-needs-install" | "denied" | "off" | "on" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const [turnOffFailed, setTurnOffFailed] = useState(false);
  const [prefs, setPrefs] = useState(props.prefs);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Bumped on every `PUT /push/prefs` fired; a response is only applied
  // when its own captured sequence number still equals this ref's current
  // value — see `isCurrentRequest`'s doc comment.
  const prefsRequestSeq = useRef(0);

  // Mount-time detection, registration, and the "keep it fresh / on the
  // current key" upkeep described above. Runs once per mount — this island
  // isn't `transition:persist` (nothing about it needs to survive a soft
  // navigation the way the player does), so `/me` reloading is what re-runs
  // it, which is exactly when it's worth re-checking anyway.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const standalone = currentStandalone();
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
          const oldEndpoint = subscription.endpoint;
          try {
            await subscription.unsubscribe();
            // Best effort — the old row is orphaned either way once the
            // browser has forgotten the subscription; failing to delete it
            // here just means it ages out server-side instead.
            await deleteSubscription(oldEndpoint).catch(() => {});
            const registration = await navigator.serviceWorker.ready;
            subscription = await subscribeAndPost(registration, props.publicKey);
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
    // MUST be the first statement, with no `await` ahead of it: iOS/Safari
    // only honors `Notification.requestPermission()` when it's called
    // synchronously inside a user-gesture handler. Awaiting anything first
    // (even `serviceWorker.ready`, which usually resolves instantly) can
    // make the browser treat this call as no longer gesture-initiated, and
    // the permission prompt then silently never appears.
    const permissionPromise = Notification.requestPermission();
    setBusy(true);
    setTurnOnFailed(false);
    try {
      const permission = await permissionPromise;
      if (permission !== "granted") {
        setState(
          decidePushUiState({
            hasServiceWorker: true,
            hasPushManager: true,
            hasNotification: true,
            permission,
            standalone: currentStandalone(),
            ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
            subscribed: false,
          }),
        );
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      await subscribeAndPost(registration, props.publicKey);
      setState("on");
    } catch {
      setState("off");
      setTurnOnFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleTurnOff() {
    setBusy(true);
    setTurnOffFailed(false);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await deleteSubscription(endpoint);
      }
      setState("off");
    } catch {
      // The browser-side unsubscribe may have already gone through even
      // though the DELETE failed (offline, a 5xx) — ask the browser what's
      // actually true rather than assuming, so the UI never claims "on"
      // when the device really did drop its subscription, or "off" when it
      // didn't.
      let stillSubscribed = false;
      try {
        const registration = await navigator.serviceWorker.ready;
        stillSubscribed = (await registration.pushManager.getSubscription()) !== null;
      } catch {
        stillSubscribed = false;
      }
      setState(stillSubscribed ? "on" : "off");
      setTurnOffFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function handlePrefChange(key: keyof NotificationPrefsValue, checked: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: checked };
    setPrefs(next);
    setSaveState("saving");
    const seq = ++prefsRequestSeq.current;

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
      if (isCurrentRequest(seq, prefsRequestSeq.current)) {
        setSaveState("saved");
      }
    } catch {
      if (isCurrentRequest(seq, prefsRequestSeq.current)) {
        // The server never saved this flip — put the checkbox back rather
        // than leave the UI claiming a preference that isn't actually set.
        setPrefs(previous);
        setSaveState("error");
      }
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
        <>
          <button
            type="button"
            class="bp-btn bp-btn-quiet bp-btn-sm"
            disabled={busy}
            onClick={handleTurnOn}
          >
            {props.turnOnLabel}
          </button>
          {turnOnFailed && <p class="bp-field-error">{props.turnOnFailedText}</p>}
        </>
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
          {turnOffFailed && <p class="bp-field-error">{props.turnOffFailedText}</p>}
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
