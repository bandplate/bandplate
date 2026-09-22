// The upload panel — direction U2 from the canvas: an "Add files" action
// beside the Files heading, the same shape "Add song" and "Add take" already
// took, plus a drop target that only appears while something is being dragged
// over the strip.
//
// Mounted on `/takes/[id]` alone, not in `AppLayout`: the site-wide islands
// (`Player`, `VoteFavorite`, `ConfirmDialog`) are there because they serve
// every page, and an upload queue serves exactly one. No `transition:persist`
// either — an in-flight upload dies with the document regardless, and a
// persisted shell would show a frozen progress bar after a navigation.
//
// XMLHttpRequest, not fetch. `fetch` has no upload-progress event at all
// (streaming request bodies are Chromium-only and need HTTP/2), and
// `xhr.upload.onprogress` is universal. Reaching for `fetch` here is the
// obvious wrong move, which is why this comment exists.
//
// This is the app's FIRST JS-only capability. Everything else works with
// scripting off; a presigned PUT is a cross-origin PUT with signed headers and
// an HTML form can only POST multipart to its own action. The page renders a
// plain notice in its place under `@media (scripting: none)` — and deleting a
// file stays an ordinary confirm page precisely so the destructive half never
// depends on script.
import { type Locale, islandsMessages } from "@bandplate/i18n";
import { formatBytes as i18nFormatBytes } from "@bandplate/i18n";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";

/** Read at call time — see `client/locale.ts`. */
const ti = (fallback?: Locale) => islandsMessages(currentLocale(fallback));
import { Plus } from "lucide-preact";
import {
  type AssetKind,
  type UploadEvent,
  type UploadItem,
  blockedReason,
  canStart,
  defaultKind,
  isSettled,
  makeItem,
  needsDecision,
  readAudioShape,
  reduceItem,
} from "../client/upload-actions.js";

interface InstrumentOption {
  id: string;
  label: string;
}

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
  takeId: string;
  takeHasMaster: boolean;
  instruments: InstrumentOption[];
}

/** Two at a time. A phone on bad wifi should not stall six uploads at once. */
const CONCURRENCY = 2;

let itemIdCounter = 0;

/**
 * The same file size the rest of the app quotes.
 *
 * This was a second implementation on 1024-based units while the server's was
 * on 1000, so one file could be "84.0 MB" in the upload queue and "88.1 MB" in
 * the asset list once it landed. SI won: it is what macOS, every file manager
 * the band will compare against, and a hosting bill all count in.
 */
function formatBytes(bytes: number): string {
  return i18nFormatBytes(currentLocale(), bytes);
}

/**
 * A file's length, read before a single byte is sent.
 *
 * Nothing else in this app has ever known how long a take is — ingest
 * declares whatever the bridge was told and the seed invents a number. A
 * browser can simply measure it.
 *
 * Never blocks the upload: an undecodable file, a slow decode, a browser that
 * refuses, all resolve to null and the upload goes ahead without a duration.
 */
function measureDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    // `duration` is Infinity or NaN for anything it could not read.
    audio.addEventListener("loadedmetadata", () => {
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    });
    audio.addEventListener("error", () => finish(null));
    setTimeout(() => finish(null), 5_000);
    audio.preload = "metadata";
    audio.src = url;
  });
}

/** The PUT itself, with progress. The one place XHR is unavoidable. */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      // The bucket signs the exact content-length and type, so a wrong-sized
      // or wrong-typed body is refused here rather than stored badly.
      reject(new Error(ti().uploadErrRefused(xhr.status)));
    });
    // No locale fallback needed in here: an XHR only ever runs in the
    // browser, so `<html lang>` is always readable.
    xhr.addEventListener("error", () => reject(new Error(ti().uploadErrConnection)));
    xhr.addEventListener("abort", () => reject(new Error(ti().uploadErrStopped)));
    // The browser sets Content-Length itself and forbids overriding it.
    xhr.send(file);
  });
}

export default function AssetUploader({ takeId, takeHasMaster, instruments, locale }: Props) {
  // `locale` is the SSR fallback for the markup. The upload callbacks below
  // only ever run after a click, in the browser, so they read `<html lang>`
  // directly and stay out of the dependency arrays.
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Files live outside state: they are large, never rendered, and putting them
  // in state would copy the array on every progress tick.
  const filesRef = useRef(new Map<string, File>());
  const runningRef = useRef(new Set<string>());

  const dispatch = useCallback((id: string, event: UploadEvent) => {
    setItems((current) => current.map((i) => (i.id === id ? reduceItem(i, event) : i)));
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted: UploadItem[] = [];
      const rejected: UploadItem[] = [];
      for (const file of files) {
        const id = `u${++itemIdCounter}`;
        const shape = readAudioShape(file.name, file.type);
        if (!shape) {
          rejected.push({
            ...makeItem(id, file.name, file.size, { format: "mp3", tier: "lossy" }, "master"),
            phase: "failed",
            message: ti().uploadErrNotAudio,
          });
          continue;
        }
        filesRef.current.set(id, file);
        // A take that already holds a master, or a queue that is about to
        // give it one, means everything after the first is a stem.
        const willHaveMaster =
          takeHasMaster ||
          accepted.some((i) => i.kind === "master") ||
          items.some((i) => i.kind === "master");
        accepted.push(makeItem(id, file.name, file.size, shape, defaultKind(willHaveMaster)));
      }
      setItems((current) => [...current, ...accepted, ...rejected]);
    },
    [items, takeHasMaster],
  );

  /** Declare → PUT → verify, for one item. */
  const run = useCallback(
    async (item: UploadItem, replace: boolean) => {
      const file = filesRef.current.get(item.id);
      if (!file) {
        dispatch(item.id, { type: "failed", message: ti().uploadErrGone });
        return;
      }
      try {
        const durationMs = await measureDuration(file);
        dispatch(item.id, { type: "measured", durationMs });

        const declared = await fetch(`/api/takes/${takeId}/assets`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: item.kind,
            instrumentId: item.kind === "stem" ? item.instrumentId : undefined,
            tier: item.tier,
            format: item.format,
            bytes: item.bytes,
            durationMs,
            replace,
          }),
        });

        if (declared.status === 409) {
          const body = await declared.json().catch(() => null);
          const existing = body?.error?.existing;
          if (existing) {
            dispatch(item.id, { type: "occupied", existing });
            return;
          }
        }
        if (!declared.ok) {
          const body = await declared.json().catch(() => null);
          dispatch(item.id, {
            type: "failed",
            message: body?.error?.message ?? ti().uploadErrRejected,
          });
          return;
        }

        const slot = await declared.json();
        dispatch(item.id, { type: "declared", assetId: slot.assetId });

        await putWithProgress(slot.url, slot.headers, file, (progress) =>
          dispatch(item.id, { type: "progress", progress }),
        );

        dispatch(item.id, { type: "verifying" });
        const verified = await fetch(`/api/assets/${slot.assetId}/verify`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ durationMs }),
        });
        if (!verified.ok) {
          const body = await verified.json().catch(() => null);
          dispatch(item.id, {
            type: "failed",
            message: body?.error?.message ?? ti().uploadErrUnfinished,
          });
          return;
        }
        dispatch(item.id, { type: "ready" });
      } catch (err) {
        dispatch(item.id, {
          type: "failed",
          message: err instanceof Error ? err.message : ti().uploadErrGeneric,
        });
      }
    },
    [dispatch, takeId],
  );

  // The pump: start whatever is startable, up to the concurrency cap.
  // `runningRef` rather than state so a re-render mid-flight cannot start the
  // same item twice.
  useEffect(() => {
    const inFlight = items.filter((i) =>
      ["measuring", "declaring", "uploading", "verifying"].includes(i.phase),
    ).length;
    let slots = CONCURRENCY - inFlight;
    for (const item of items) {
      if (slots <= 0) break;
      if (item.phase !== "queued" || !canStart(item) || runningRef.current.has(item.id)) {
        continue;
      }
      runningRef.current.add(item.id);
      slots -= 1;
      void run(item, false).finally(() => runningRef.current.delete(item.id));
    }
  }, [items, run]);

  // Once everything has landed, reload so the server-rendered file list, the
  // player and the publish strip all reflect it. `replace`, not `reload`: this
  // document may itself be a POST response, the same reasoning `ConfirmDialog`
  // documents.
  const settledRef = useRef(false);
  useEffect(() => {
    const anyReady = items.some((i) => i.phase === "ready");
    if (items.length > 0 && anyReady && isSettled(items) && !settledRef.current) {
      settledRef.current = true;
      window.location.replace(window.location.href);
    }
  }, [items]);

  const retry = useCallback(
    (item: UploadItem, replace: boolean) => {
      dispatch(item.id, { type: "retry" });
      runningRef.current.add(item.id);
      void run({ ...item, phase: "queued" }, replace).finally(() =>
        runningRef.current.delete(item.id),
      );
    },
    [dispatch, run],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length > 0) {
        addFiles(dropped);
      }
    },
    [addFiles],
  );

  const moving = items.filter((i) =>
    ["measuring", "declaring", "uploading", "verifying"].includes(i.phase),
  ).length;
  const waiting = items.filter((i) => needsDecision(i)).length;
  const summary =
    items.length === 0
      ? ""
      : moving > 0
        ? ti(locale).uploadAdding(moving)
        : waiting > 0
          ? `${waiting} ${waiting === 1 ? "file needs" : "files need"} your attention.`
          : ti(locale).uploadFilesAdded;

  return (
    <div
      class={`bp-uploader${dragging ? " bp-uploader--over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer actually leaves the panel, not on every child
        // it crosses on the way.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <div class="bp-uploader-head">
        {/* The heading is rendered HERE, not by the page, so it and the action
            share one row and cannot drift apart. It is server-rendered like the
            rest of the island, so it survives a failure to hydrate. */}
        <h2 class="bp-strip-label">{ti(locale).uploadFilesHeading}</h2>
        {/* `-xs`, which is the variant written for exactly this: an action
            beside a section heading rather than acting on the page, and ALONE
            — the condition that variant requires, since its hit area reaches
            past its fill and two of them would collide. A 44px pill next to an
            11px eyebrow read as the section's subject rather than its
            afterthought. The TARGET is still 44px; only the paint shrinks. */}
        <button
          type="button"
          class="bp-btn bp-btn-secondary bp-btn-xs"
          onClick={() => inputRef.current?.click()}
        >
          <Plus size={15} aria-hidden="true" />
          {ti(locale).uploadAddFiles}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".mp3,.flac,.wav,.opus,.ogg,audio/*"
          class="bp-visually-hidden"
          onChange={(event) => {
            const input = event.currentTarget;
            addFiles(Array.from(input.files ?? []));
            // Cleared so picking the same file twice in a row still fires.
            input.value = "";
          }}
        />
      </div>

      {dragging && <p class="bp-uploader-drop">Drop to add</p>}

      {/* ONE polite announcement for the whole queue, phrased in counts rather
          than percentages so it changes a handful of times per upload instead
          of a hundred. Per-file live regions would talk over each other.
          `<output>` rather than a `<p role="status">`: it carries that role
          implicitly and is the element the role exists to describe. */}
      <output class="bp-visually-hidden">{summary}</output>

      {items.length > 0 && (
        <ul class="bp-uploader-queue">
          {items.map((item) => {
            const blocked = blockedReason(item);
            return (
              <li class="bp-uploader-item" key={item.id}>
                <div class="bp-uploader-item-top">
                  <span class="bp-uploader-name">{item.fileName}</span>
                  <span class="bp-uploader-state">
                    {item.phase === "measuring" && ti(locale).uploadPhaseReading}
                    {item.phase === "declaring" && ti(locale).uploadPhaseStarting}
                    {item.phase === "uploading" && `${item.progress}%`}
                    {item.phase === "verifying" && ti(locale).uploadPhaseChecking}
                    {item.phase === "ready" && ti(locale).uploadPhaseDone}
                    {item.phase === "slot-occupied" && ti(locale).uploadPhaseAlreadyThere}
                    {item.phase === "failed" && ti(locale).uploadPhaseUnfinished}
                    {item.phase === "queued" &&
                      (blocked
                        ? ti(locale).uploadPhaseWaitingOnYou
                        : ti(locale).uploadPhaseWaiting)}
                  </span>
                </div>

                {(item.phase === "uploading" || item.phase === "verifying") && (
                  /* Decorative, and `aria-hidden` on purpose. `role="progressbar"`
                     would want a tab stop on every file in the queue, and an
                     announcement on every percent is hostile — the percentage is
                     already in the row's own text beside the name, which a screen
                     reader reads on arrival, and the coarse summary below covers
                     the rest. */
                  <div class="bp-uploader-bar" aria-hidden="true">
                    <i style={{ width: `${item.progress}%` }} />
                  </div>
                )}

                {item.phase !== "ready" && item.phase !== "failed" && (
                  <div class="bp-uploader-controls">
                    <div class="bp-pills">
                      {(["master", "stem"] as AssetKind[]).map((kind) => (
                        <label class="bp-btn-check" key={kind}>
                          <input
                            type="radio"
                            name={`kind-${item.id}`}
                            checked={item.kind === kind}
                            disabled={item.phase !== "queued" && item.phase !== "slot-occupied"}
                            onChange={() => dispatch(item.id, { type: "kind", kind })}
                          />
                          <span class="bp-btn bp-btn-quiet bp-btn-xs">
                            {kind === "master" ? "Master" : "Stem"}
                          </span>
                        </label>
                      ))}
                    </div>
                    {item.kind === "stem" && (
                      <select
                        class="bp-select bp-uploader-select"
                        aria-label={ti(locale).uploadInstrumentFor(item.fileName)}
                        value={item.instrumentId ?? ""}
                        disabled={item.phase !== "queued" && item.phase !== "slot-occupied"}
                        onChange={(event) =>
                          dispatch(item.id, {
                            type: "instrument",
                            instrumentId: event.currentTarget.value || null,
                          })
                        }
                      >
                        <option value="">{ti(locale).uploadWhichInstrument}</option>
                        {instruments.map((instrument) => (
                          <option value={instrument.id} key={instrument.id}>
                            {instrument.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <span class="bp-uploader-meta">
                      {formatBytes(item.bytes)} · {item.format} · {item.tier}
                    </span>
                  </div>
                )}

                {blocked && item.phase === "queued" && (
                  <p class="bp-field-error bp-m0">{blocked}</p>
                )}

                {item.phase === "slot-occupied" && item.occupiedBy && (
                  <>
                    <p class="bp-field-error bp-m0">
                      This take already has a {item.kind === "master" ? "" : "stem for that "}
                      {item.occupiedBy.tier} {item.kind} ({item.occupiedBy.format},{" "}
                      {formatBytes(item.occupiedBy.bytes)}).
                    </p>
                    <div class="bp-uploader-controls">
                      <button
                        type="button"
                        class="bp-btn bp-btn-secondary bp-btn-sm"
                        onClick={() => retry(item, true)}
                      >
                        {ti(locale).uploadReplace}
                      </button>
                      <button
                        type="button"
                        class="bp-btn bp-btn-quiet bp-btn-sm"
                        onClick={() =>
                          setItems((current) => current.filter((i) => i.id !== item.id))
                        }
                      >
                        {ti(locale).uploadSkip}
                      </button>
                    </div>
                  </>
                )}

                {item.phase === "failed" && (
                  <>
                    <p class="bp-field-error bp-m0">{item.message}</p>
                    <div class="bp-uploader-controls">
                      {filesRef.current.has(item.id) && (
                        <button
                          type="button"
                          class="bp-btn bp-btn-secondary bp-btn-sm"
                          onClick={() => retry(item, false)}
                        >
                          {ti(locale).uploadRetry}
                        </button>
                      )}
                      <button
                        type="button"
                        class="bp-btn bp-btn-quiet bp-btn-sm"
                        onClick={() =>
                          setItems((current) => current.filter((i) => i.id !== item.id))
                        }
                      >
                        {ti(locale).uploadRemove}
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
