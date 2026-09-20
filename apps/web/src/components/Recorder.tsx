// `/record`'s one island: choose the song, record, listen back, keep it.
//
// Every decision is in `client/recorder-logic.ts`. This file owns what cannot
// be tested in node: the microphone, the MediaRecorder, the level meter's
// AudioContext, the wake lock, the review <audio>, and the IndexedDB write.
//
// SAVE NEVER TOUCHES THE NETWORK. The recording is written to IndexedDB and
// the page moves to the stash; the sync runner (booted by every page) uploads
// it whenever there is signal. A member in a tunnel loses nothing.
import { type Locale, stashMessages } from "@bandplate/i18n";
import fixWebmDuration from "fix-webm-duration";
import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";
import { currentLocale } from "../client/locale.js";
import {
  type RecorderError,
  type SongOption,
  formatElapsed,
  initialRecorderState,
  levelFromTimeDomain,
  needsDurationFix,
  pickRecorderMime,
  pickerGroups,
  recordCtaLabel,
  reduceRecorder,
  shapeForMime,
  shouldDrawWaveform,
  waveformBars,
} from "../client/recorder-logic.js";
import { putPending } from "../client/stash-db.js";
import { newPendingItem } from "../client/stash-sync-logic.js";

interface Props {
  locale: Locale;
  /** The signed-in member: the recording is theirs, on a browser others may share. */
  memberId: string;
  /** The whole library, by title. */
  songs: SongOption[];
  /** The band's most recently played songs, most recent first. */
  recentIds: string[];
  preselectedSongId: string | null;
  /** Where × goes when nothing is being recorded. */
  closeHref: string;
}

const WAVE_BARS = 64;
const STASH_HREF = "/takes?stash=1";

function micError(err: unknown): RecorderError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-mic";
  }
  return "unsupported";
}

async function decodeBars(blob: Blob): Promise<number[] | null> {
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return waveformBars(buffer.getChannelData(0), WAVE_BARS);
  } catch {
    // No picture is an honest answer; the review still plays.
    return null;
  } finally {
    // A phone allows only a handful of live AudioContexts; a failed decode
    // must not keep one.
    void context?.close().catch(() => undefined);
  }
}

/**
 * Asks the browser not to evict this origin's storage under pressure: the
 * IndexedDB queue may hold the only copy of a recording. Best effort, and
 * bounded, because the page leaves right after and a browser that asks the
 * member must not hold the save up.
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    const storage = navigator.storage;
    if (!storage?.persist || (await storage.persisted?.())) {
      return;
    }
    await Promise.race([storage.persist(), new Promise((resolve) => setTimeout(resolve, 1000))]);
  } catch {
    // No answer is an answer: the recording is saved either way.
  }
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export default function Recorder({
  locale,
  memberId,
  songs,
  recentIds,
  preselectedSongId,
  closeHref,
}: Props) {
  const t = stashMessages(currentLocale(locale));
  const [state, dispatch] = useReducer(reduceRecorder, preselectedSongId, initialRecorderState);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [bars, setBars] = useState<number[] | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const blobRef = useRef<Blob | null>(null);
  const recordedAtRef = useRef(0);
  const durationRef = useRef(0);
  /** `performance.now()` at the moment recording began, for a stop nobody pressed. */
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const meterRef = useRef<{ context: AudioContext; frame: number } | null>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const song = songs.find((s) => s.id === state.songId);
  const recording = state.phase === "recording" || state.phase === "confirm-discard";

  const releaseInput = useCallback(() => {
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.frame);
      void meterRef.current.context.close();
      meterRef.current = null;
    }
    ringRef.current?.style.setProperty("--bp-rec-level", "0");
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    void wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) {
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      // The browser drops the lock whenever the page is hidden. Forget it
      // then, so coming back to the page takes a new one.
      sentinel.addEventListener("release", () => {
        if (wakeRef.current === sentinel) {
          wakeRef.current = null;
        }
      });
      wakeRef.current = sentinel;
    } catch {
      // Battery saver, or a browser that says no. The note on screen already
      // says recording carries on if the screen goes dark.
    }
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const context = new AudioContext();
    void context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      // A CSS custom property, not state: sixty re-renders a second for one
      // ring would be the whole island's budget.
      ringRef.current?.style.setProperty("--bp-rec-level", levelFromTimeDomain(samples).toFixed(3));
      if (meterRef.current) {
        meterRef.current.frame = requestAnimationFrame(draw);
      }
    };
    meterRef.current = { context, frame: requestAnimationFrame(draw) };
  }, []);

  const finishRecording = useCallback(async () => {
    const mime = mimeRef.current;
    const raw = new Blob(chunksRef.current, { type: shapeForMime(mime)?.contentType ?? mime });
    chunksRef.current = [];
    releaseInput();
    if (discardRef.current) {
      return;
    }
    // The recorder can stop on its own: a phone call, Siri, a headset pulled
    // out ends the tracks and `onstop` fires with nobody pressing Stop. Tell
    // the state machine now; after a pressed Stop it is already finishing and
    // this is a no-op.
    const now = performance.now();
    dispatch({ type: "stop", now });
    if (durationRef.current === 0) {
      durationRef.current = Math.max(0, now - startedAtRef.current);
    }
    let blob = raw;
    if (needsDurationFix(mime)) {
      try {
        blob = await fixWebmDuration(raw, durationRef.current, { logger: false });
      } catch {
        // An unseekable review beats a lost recording: keep the raw bytes.
        blob = raw;
      }
    }
    blobRef.current = blob;
    setReviewUrl(URL.createObjectURL(blob));
    setProgress(0);
    // A long take is not decoded at all (see `shouldDrawWaveform`); the review
    // then shows no waveform, and play still works.
    setBars(shouldDrawWaveform(durationRef.current) ? await decodeBars(blob) : null);
    dispatch({ type: "finished" });
  }, [releaseInput]);

  const startRecording = useCallback(async () => {
    dispatch({ type: "start" });
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "failed", error: "unsupported" });
      return;
    }
    const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime || !shapeForMime(mime)) {
      dispatch({ type: "failed", error: "unsupported" });
      return;
    }
    let stream: MediaStream;
    try {
      // Music, not a phone call: the voice-call processing would duck a
      // drum kit to nothing and "suppress" the guitar as noise.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      dispatch({ type: "failed", error: micError(err) });
      return;
    }
    streamRef.current = stream;
    mimeRef.current = mime;
    chunksRef.current = [];
    discardRef.current = false;
    let recorder: MediaRecorder;
    try {
      // Either can throw on a browser that claimed the type and then refuses
      // it (NotSupportedError), or on a stream that died in between.
      recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        void finishRecording();
      };
      // A chunk a second, so a recording is never one enormous final buffer.
      recorder.start(1000);
    } catch {
      releaseInput();
      dispatch({ type: "failed", error: "unsupported" });
      return;
    }
    recorderRef.current = recorder;
    recordedAtRef.current = Date.now();
    durationRef.current = 0;
    startedAtRef.current = performance.now();
    dispatch({ type: "started", at: startedAtRef.current });
    startMeter(stream);
    void acquireWakeLock();
  }, [acquireWakeLock, finishRecording, releaseInput, startMeter]);

  const stop = useCallback(() => {
    const now = performance.now();
    durationRef.current = state.startedAt === null ? 0 : Math.max(0, now - state.startedAt);
    dispatch({ type: "stop", now });
    recorderRef.current?.stop();
  }, [state.startedAt]);

  const discard = useCallback(() => {
    discardRef.current = true;
    recorderRef.current?.stop();
    dispatch({ type: "discard" });
  }, []);

  const redo = useCallback(() => {
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl);
    }
    setReviewUrl(null);
    setBars(null);
    setPlaying(false);
    blobRef.current = null;
    void startRecording();
  }, [reviewUrl, startRecording]);

  const save = useCallback(async () => {
    const blob = blobRef.current;
    const shape = shapeForMime(mimeRef.current);
    // No `song` check: a recording with no song yet is the point of
    // "Zatím bez písně", and the stash takes it as it is.
    if (!blob || !shape) {
      return;
    }
    dispatch({ type: "save" });
    try {
      await putPending(
        newPendingItem({
          localId: crypto.randomUUID(),
          memberId,
          songId: song?.id ?? null,
          songTitle: song?.title ?? null,
          label: label.trim() || null,
          recordedAt: recordedAtRef.current,
          durationMs: Math.round(state.elapsedMs),
          mime: mimeRef.current,
          format: shape.format,
          blob,
        }),
      );
    } catch {
      dispatch({ type: "failed", error: "save-failed" });
      return;
    }
    await requestPersistentStorage();
    // Saved means safe: leave. The stash page's sync takes it from here.
    window.location.assign(STASH_HREF);
  }, [label, memberId, song, state.elapsedMs]);

  // The clock. From the state machine's own start time, so a throttled
  // background timer cannot make the recording look shorter than it is.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const id = setInterval(() => dispatch({ type: "tick", now: performance.now() }), 250);
    return () => clearInterval(id);
  }, [recording]);

  // A wake lock is dropped whenever the page is hidden; take it back.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !wakeRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recording, acquireWakeLock]);

  // Leaving with an unsaved recording asks first.
  useEffect(() => {
    const unsaved = recording || state.phase === "review" || state.phase === "finishing";
    if (!unsaved) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [recording, state.phase]);

  useEffect(() => () => releaseInput(), [releaseInput]);
  useEffect(
    () => () => {
      if (reviewUrl) {
        URL.revokeObjectURL(reviewUrl);
      }
    },
    [reviewUrl],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((event: MouseEvent) => {
    const audio = audioRef.current;
    const target = event.currentTarget as HTMLElement | null;
    if (!audio || !target || !Number.isFinite(audio.duration)) {
      return;
    }
    const box = target.getBoundingClientRect();
    audio.currentTime =
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * audio.duration;
  }, []);

  const errorText: Record<RecorderError, string> = {
    denied: t.errDenied,
    "no-mic": t.errNoMic,
    unsupported: t.errUnsupported,
    "save-failed": t.errSaveFailed,
  };

  // --- step 1: the song -------------------------------------------------------
  if (state.phase === "pick") {
    const groups = pickerGroups(songs, recentIds, query);
    const groupHeading = { recent: t.recentSongs, all: t.allSongs, matches: null };
    return (
      <div class="bp-rec bp-rec--pick">
        <div class="bp-rec-head">
          <a href={closeHref} class="bp-rec-close" aria-label={t.close}>
            <CloseIcon />
          </a>
        </div>
        <div class="bp-rec-intro">
          <p class="bp-eyebrow bp-m0">{t.stepOne}</p>
          <h1 class="bp-rec-heading">{t.pickTitle}</h1>
        </div>
        {songs.length === 0 ? (
          // Not "add a song first": the CTA below records without one, and
          // copy that told the member to go elsewhere would contradict it.
          <p class="bp-rec-empty bp-m0">{t.noSongsRecordAnyway}</p>
        ) : (
          <>
            <label class="bp-visually-hidden" for="rec-song-search">
              {t.searchLabel}
            </label>
            <div class="bp-rec-search-row">
              <input
                id="rec-song-search"
                class="bp-input bp-rec-search"
                type="search"
                placeholder={t.searchLabel}
                autocomplete="off"
                value={query}
                onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
              />
              {/* The way past the picker. Pressed, it clears any selection, so
                  the CTA below it reads "Nahrávat bez písně" and means it. */}
              <button
                type="button"
                class="bp-btn bp-btn-secondary bp-btn-sm bp-rec-skip-song"
                aria-pressed={state.songChosen && state.songId === null ? "true" : "false"}
                onClick={() => dispatch({ type: "select", songId: null })}
              >
                {t.noSongYet}
              </button>
            </div>
            {groups.map((group) => {
              const heading = groupHeading[group.kind];
              return (
                <section
                  key={group.kind}
                  class="bp-rec-group"
                  aria-label={heading ?? t.searchLabel}
                >
                  {heading && <h2 class="bp-eyebrow bp-rec-group-title">{heading}</h2>}
                  {group.songs.length > 0 ? (
                    <ul class="bp-rec-songs">
                      {group.songs.map((option) => (
                        <li key={option.id}>
                          <button
                            type="button"
                            class="bp-rec-song"
                            aria-pressed={option.id === state.songId ? "true" : "false"}
                            onClick={() => dispatch({ type: "select", songId: option.id })}
                          >
                            {option.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="bp-rec-empty bp-m0">{t.noSongMatch}</p>
                  )}
                </section>
              );
            })}
          </>
        )}
        {/* Always there: with nothing selected it records without a song,
            which is a choice the member is allowed to make, not a dead end. */}
        <div class="bp-rec-foot">
          <button
            type="button"
            class="bp-btn bp-btn-primary bp-rec-cta"
            onClick={() => void startRecording()}
          >
            <MicIcon />
            {recordCtaLabel(song, { recordFor: t.recordFor, withoutSong: t.recordWithoutSong })}
          </button>
        </div>
      </div>
    );
  }

  // --- step 2: listen back, keep it --------------------------------------------
  if (state.phase === "review" || state.phase === "saving") {
    return (
      <div class="bp-rec bp-rec--review">
        <div class="bp-rec-intro">
          <p class="bp-eyebrow bp-m0">{t.stepTwo}</p>
          <h1 class="bp-rec-heading">{song?.title ?? t.noSongYet}</h1>
          <p class="bp-rec-length bp-m0">{formatElapsed(state.elapsedMs)}</p>
        </div>
        <div class="bp-rec-player">
          {reviewUrl && (
            <button
              type="button"
              class="bp-rec-play"
              aria-pressed={playing ? "true" : "false"}
              aria-label={playing ? t.reviewPause : t.reviewPlay}
              onClick={togglePlay}
            >
              <svg
                class="bp-rec-play-icon"
                aria-hidden="true"
                width="24"
                height="24"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M4 2.5v11l10-5.5-10-5.5z" />
              </svg>
              <svg
                class="bp-rec-pause-icon"
                aria-hidden="true"
                width="24"
                height="24"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" />
              </svg>
            </button>
          )}
          {bars && (
            <button type="button" class="bp-rec-wave" aria-label={t.reviewSeek} onClick={seek}>
              {bars.map((bar, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional and never reorder
                  key={index}
                  class={index / bars.length < progress ? "bp-rec-bar is-played" : "bp-rec-bar"}
                  style={{ height: `${Math.max(6, bar * 100)}%` }}
                />
              ))}
            </button>
          )}
          {reviewUrl && (
            // biome-ignore lint/a11y/useMediaCaption: a member's own rehearsal idea has no dialogue to caption
            <audio
              ref={audioRef}
              src={reviewUrl}
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const audio = event.currentTarget as HTMLAudioElement;
                setProgress(
                  Number.isFinite(audio.duration) && audio.duration > 0
                    ? audio.currentTime / audio.duration
                    : 0,
                );
              }}
            />
          )}
        </div>
        <div class="bp-rec-field">
          <label class="bp-field-label" for="rec-label">
            {t.labelField}
          </label>
          <input
            id="rec-label"
            class="bp-input"
            maxLength={200}
            placeholder={t.labelPlaceholder}
            value={label}
            onInput={(event) => setLabel((event.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <p class="bp-rec-private bp-m0">{t.privateNote}</p>
        <div class="bp-rec-foot">
          {state.error && (
            <p class="bp-field-error bp-m0" role="alert">
              {errorText[state.error]}
            </p>
          )}
          <div class="bp-rec-actions">
            <button
              type="button"
              class="bp-btn bp-btn-secondary"
              onClick={redo}
              disabled={state.phase === "saving"}
            >
              {t.redo}
            </button>
            <button
              type="button"
              class="bp-btn bp-btn-primary"
              onClick={() => void save()}
              disabled={state.phase === "saving"}
            >
              {t.save}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- the stage: armed, starting, recording, finishing, error -------------------
  return (
    <div class="bp-rec bp-rec--stage">
      <div class="bp-rec-head">
        {state.phase === "recording" ? (
          <button
            type="button"
            class="bp-rec-close"
            aria-label={t.cancel}
            onClick={() => dispatch({ type: "cancel" })}
          >
            <CloseIcon />
          </button>
        ) : state.phase === "armed" || state.phase === "starting" || state.phase === "error" ? (
          // `starting` too: a permission prompt nobody answers must not trap
          // the member on a page with no way out.
          <a href={closeHref} class="bp-rec-close" aria-label={t.close}>
            <CloseIcon />
          </a>
        ) : (
          <span class="bp-rec-close-slot" />
        )}
        <p class="bp-rec-song-title bp-m0">{song?.title ?? t.noSongYet}</p>
        <span class="bp-rec-close-slot" />
      </div>
      <div class="bp-rec-center">
        {/* Always laid out, shown only while live, so the timer does not jump when it starts. */}
        <p
          class={recording ? "bp-rec-live is-live bp-m0" : "bp-rec-live bp-m0"}
          aria-hidden={recording ? undefined : "true"}
        >
          <span class="bp-rec-dot" aria-hidden="true" />
          {t.recordingInto}
        </p>
        <p class="bp-rec-timer bp-m0" role="timer" aria-label={t.timerLabel}>
          {formatElapsed(state.elapsedMs)}
        </p>
        <div class="bp-rec-ring" ref={ringRef}>
          <svg class="bp-rec-meter" aria-hidden="true" viewBox="0 0 260 260">
            <circle class="bp-rec-meter-track" cx="130" cy="130" r="124" pathLength={100} />
            <circle class="bp-rec-meter-arc" cx="130" cy="130" r="124" pathLength={100} />
          </svg>
          {recording ? (
            <button type="button" class="bp-rec-stop" aria-label={t.stop} onClick={stop}>
              <span class="bp-rec-stop-square" aria-hidden="true" />
            </button>
          ) : state.phase === "armed" || state.phase === "error" ? (
            <button
              type="button"
              class="bp-rec-stop"
              aria-label={t.start}
              onClick={() => void startRecording()}
            >
              <span class="bp-rec-start-dot" aria-hidden="true" />
            </button>
          ) : (
            <span class="bp-rec-stop is-busy" aria-hidden="true" />
          )}
        </div>
        <p class="bp-rec-hint bp-m0">{t.levelHint}</p>
        {state.phase === "confirm-discard" && (
          <div class="bp-rec-confirm" role="alertdialog" aria-label={t.discardQuestion}>
            <p class="bp-m0">{t.discardQuestion}</p>
            <div class="bp-rec-actions">
              <button
                type="button"
                class="bp-btn bp-btn-secondary"
                onClick={() => dispatch({ type: "keep-going" })}
              >
                {t.keepRecording}
              </button>
              <button type="button" class="bp-btn bp-btn-danger" onClick={discard}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
                {t.discard}
              </button>
            </div>
          </div>
        )}
        {state.phase === "finishing" && <p class="bp-field-hint bp-m0">{t.finishing}</p>}
        {state.phase === "error" && state.error && (
          <p class="bp-field-error bp-m0" role="alert">
            {errorText[state.error]}
          </p>
        )}
        {state.phase === "armed" && songs.length > 1 && !preselectedSongId && (
          <button
            type="button"
            class="bp-btn bp-btn-secondary bp-btn-sm"
            onClick={() => dispatch({ type: "change-song" })}
          >
            {t.pickTitle}
          </button>
        )}
      </div>
      <p class="bp-rec-note bp-m0">{t.screenNote}</p>
    </div>
  );
}
