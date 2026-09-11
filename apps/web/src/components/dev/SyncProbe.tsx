// Does playing N audio files at once actually keep them together?
//
// This is a MEASURING INSTRUMENT, not a feature. Everything about a stem
// mixer hangs on one number nobody in this project has measured: how far
// apart N `HTMLMediaElement`s drift over the length of a real take, and how
// finely `currentTime` can even be read. Decoding every stem to an
// `AudioBuffer` — the way you get sample-locked playback — costs ~170MB per
// stem for an eight-minute take, so ~1GB for one take, which is not an
// option. Streaming elements plus software drift correction is, IF the
// numbers say so.
//
// It lives under `/dev` (gated exactly like `/dev/ui`) rather than being a
// throwaway, so the answer can be re-checked on a new browser version or
// after any change to the correction law rather than remembered from a
// screenshot.
//
// No drift CORRECTION here on purpose: this commit measures the disease.
// The servo lands with `mixer-sync.ts` and is wired in behind `?rate=1`
// once it exists, so that the same page proves the controller against the
// same instrument that justified building it.
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/**
 * How often the report is recomputed. Slow on purpose — the numbers this
 * produces are about minutes, and reading `currentTime` off eight elements
 * sixty times a second would put the instrument's own cost into the
 * measurement.
 */
const SAMPLE_INTERVAL_MS = 250;

/** Nothing below the poll interval can be observed; see `minStepMs`. */
const QUANTISATION_POLL = "requestAnimationFrame (~16.7ms at 60Hz)";

interface Source {
  assetId: string;
  kind: "master" | "stem";
  label: string;
}

/** One element's running tallies. Mutated in place by event handlers — this is an instrument, not a model. */
interface TrackProbe {
  source: Source;
  el: HTMLAudioElement;
  analyser: AnalyserNode | null;
  /** Set lazily on `loadedmetadata`: Safari has historically returned permanent silence for an element whose MESN was created before it loaded. */
  wired: boolean;
  waiting: number;
  stalled: number;
  errors: number;
  ended: boolean;
  /** Smallest non-zero change ever seen in `currentTime`. The servo's noise floor. */
  minStepMs: number | null;
  lastPolled: number | null;
  /** `(ctxTime, errorVsLeader)` pairs, for the least-squares drift fit. */
  fit: { n: number; sx: number; sy: number; sxx: number; sxy: number };
}

interface Row {
  label: string;
  currentTime: number;
  errorMs: number;
  driftPpm: number | null;
  minStepMs: number | null;
  rms: number;
  waiting: number;
  stalled: number;
  errors: number;
  ended: boolean;
  readyState: number;
}

interface Report {
  elapsedS: number;
  spreadMs: number;
  spreadMaxMs: number;
  rows: Row[];
}

function emptyFit(): TrackProbe["fit"] {
  return { n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 };
}

/** Least-squares slope of error against context time, in parts per million. `null` until there is enough spread in x to mean anything. */
function driftPpm(fit: TrackProbe["fit"]): number | null {
  const denom = fit.n * fit.sxx - fit.sx * fit.sx;
  if (fit.n < 8 || Math.abs(denom) < 1e-9) {
    return null;
  }
  return ((fit.n * fit.sxy - fit.sx * fit.sy) / denom) * 1e6;
}

function rmsOf(analyser: AnalyserNode | null, scratch: Float32Array<ArrayBuffer>): number {
  if (!analyser) {
    return 0;
  }
  analyser.getFloatTimeDomainData(scratch);
  let sum = 0;
  for (let i = 0; i < scratch.length; i++) {
    const v = scratch[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / scratch.length);
}

export default function SyncProbe() {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "running" | "error">("idle");
  const [note, setNote] = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);

  const probesRef = useRef<TrackProbe[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef<number>(0);
  const spreadMaxRef = useRef<number>(0);
  // Backed by an explicit ArrayBuffer: `new Float32Array(n)` is typed over
  // ArrayBufferLike, which the Web Audio lib signature refuses. Length matches
  // `fftSize` so the analyser fills the whole window.
  const scratchRef = useRef(new Float32Array(new ArrayBuffer(2048 * 4)));

  // `?take=<id>` plays that take's real sources — the actual workload.
  // `?asset=<id>&n=7` plays N copies of ONE file, which is the crueller test:
  // identical signals comb-filter audibly the instant they separate, so drift
  // stops being a number on a screen and becomes something you can hear.
  const params = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  const takeId = params?.get("take") ?? "";
  const assetId = params?.get("asset") ?? "";
  const wantMesn = params?.get("mesn") !== "0";
  const wantN = Number(params?.get("n") ?? "0");

  const teardown = useCallback(() => {
    for (const p of probesRef.current) {
      p.el.pause();
      p.el.removeAttribute("src");
      p.el.load();
    }
    probesRef.current = [];
    const ctx = ctxRef.current;
    ctxRef.current = null;
    // Chrome caps simultaneous AudioContexts at around six. Leaking one per
    // run bricks the page after a handful of runs, which looks like a browser
    // bug rather than ours.
    if (ctx && ctx.state !== "closed") {
      void ctx.close();
    }
  }, []);

  useEffect(() => teardown, [teardown]);

  const load = useCallback(async () => {
    teardown();
    setReport(null);
    setPhase("loading");
    spreadMaxRef.current = 0;

    let sources: Source[];
    try {
      if (takeId) {
        const res = await fetch(`/api/takes/${takeId}/sources`);
        if (!res.ok) {
          throw new Error(`/sources answered ${res.status}`);
        }
        const body = (await res.json()) as { sources?: Source[] };
        sources = body.sources ?? [];
        if (wantN > 0) {
          sources = sources.slice(0, wantN);
        }
      } else if (assetId) {
        const n = wantN > 0 ? wantN : 7;
        sources = Array.from({ length: n }, (_, i) => ({
          assetId,
          kind: "stem" as const,
          label: `copy ${i + 1}`,
        }));
      } else {
        throw new Error("give it ?take=<takeId> or ?asset=<assetId>&n=7");
      }
    } catch (cause) {
      setPhase("error");
      setNote(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    if (sources.length === 0) {
      setPhase("error");
      setNote("that take has nothing playable on it");
      return;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const probes: TrackProbe[] = sources.map((source) => {
      const el = new Audio();
      // Mandatory, and the single thing most likely to make this whole
      // exercise silently produce nothing: the src is same-origin but 302s to
      // R2, and without this the response is opaque, the element is tainted,
      // and `createMediaElementSource` outputs silence with no error at all.
      // The per-track RMS column exists to catch exactly that.
      el.crossOrigin = "anonymous";
      el.preload = "metadata";
      el.src = `/api/assets/${source.assetId}/audio`;

      const probe: TrackProbe = {
        source,
        el,
        analyser: null,
        wired: false,
        waiting: 0,
        stalled: 0,
        errors: 0,
        ended: false,
        minStepMs: null,
        lastPolled: null,
        fit: emptyFit(),
      };

      el.addEventListener("waiting", () => {
        probe.waiting++;
      });
      el.addEventListener("stalled", () => {
        probe.stalled++;
      });
      el.addEventListener("error", () => {
        probe.errors++;
      });
      el.addEventListener("ended", () => {
        probe.ended = true;
      });
      // Lazily, on `loadedmetadata`, never at construction: Safari has
      // historically returned permanent silence for THAT ELEMENT ONLY when
      // the MESN was created before the element had loaded — the worst kind
      // of partial failure, because six of seven stems still play.
      el.addEventListener("loadedmetadata", () => {
        if (probe.wired || !wantMesn || ctxRef.current !== ctx) {
          return;
        }
        probe.wired = true;
        const node = ctx.createMediaElementSource(el);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        probe.analyser = analyser;
        node.connect(analyser);
        analyser.connect(ctx.destination);
      });

      el.load();
      return probe;
    });

    probesRef.current = probes;
    setPhase("ready");
    setNote(
      wantMesn
        ? `${probes.length} tracks, routed through MediaElementAudioSourceNode`
        : `${probes.length} tracks, bare elements (no Web Audio)`,
    );
  }, [assetId, takeId, teardown, wantMesn, wantN]);

  const start = useCallback(() => {
    const ctx = ctxRef.current;
    const probes = probesRef.current;
    if (!ctx || probes.length === 0) {
      return;
    }
    // Every element must be touched inside the gesture — the unlock is per
    // element per document, and Safari loses the gesture across an `await`.
    // So: no await, no fetch, no Promise.all before this loop.
    void ctx.resume();
    for (const p of probes) {
      p.el.preservesPitch = false;
      p.el.playbackRate = 1;
      void p.el.play().catch(() => {
        p.errors++;
      });
    }
    startedAtRef.current = performance.now();
    setPhase("running");
  }, []);

  const stop = useCallback(() => {
    for (const p of probesRef.current) {
      p.el.pause();
    }
    setPhase("ready");
  }, []);

  // The quantisation poll. Separate from the report interval and deliberately
  // as fast as the browser will run it, because the thing being measured IS
  // the step size: WebKit represents media time as a rational against the
  // media's own timescale, and for mp3 that granule is one frame — 1152
  // samples, 26.1ms at 44.1kHz. A servo cannot see an error smaller than
  // that, which is why this number decides whether a mixer is worth building.
  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    let raf = 0;
    const poll = () => {
      for (const p of probesRef.current) {
        const t = p.el.currentTime;
        const last = p.lastPolled;
        if (last !== null && t !== last) {
          const stepMs = Math.abs(t - last) * 1000;
          // Guard against a seek or a stall being counted as a granule.
          if (stepMs > 0 && stepMs < 200 && (p.minStepMs === null || stepMs < p.minStepMs)) {
            p.minStepMs = stepMs;
          }
        }
        p.lastPolled = t;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    const tick = () => {
      const ctx = ctxRef.current;
      const probes = probesRef.current;
      if (!ctx || probes.length === 0) {
        return;
      }
      // Read every clock in ONE synchronous pass, so the comparison between
      // them is not itself a measurement of how long the loop took.
      const times = probes.map((p) => p.el.currentTime);
      const ctxTime = ctx.currentTime;
      const leader = times[0] ?? 0;

      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (const [i, t] of times.entries()) {
        const p = probes[i];
        // An element that has reached its own end freezes its clock, so its
        // apparent error grows without bound. Counting it would make the
        // spread meaningless and, in the real mixer, would trigger an endless
        // resync loop. A stem is allowed to be shorter than the take.
        if (!p || p.ended) {
          continue;
        }
        if (t < lo) {
          lo = t;
        }
        if (t > hi) {
          hi = t;
        }
        if (i > 0) {
          const err = t - leader;
          p.fit.n++;
          p.fit.sx += ctxTime;
          p.fit.sy += err;
          p.fit.sxx += ctxTime * ctxTime;
          p.fit.sxy += ctxTime * err;
        }
      }

      const spreadMs = Number.isFinite(hi - lo) ? (hi - lo) * 1000 : 0;
      if (spreadMs > spreadMaxRef.current) {
        spreadMaxRef.current = spreadMs;
      }

      setReport({
        elapsedS: (performance.now() - startedAtRef.current) / 1000,
        spreadMs,
        spreadMaxMs: spreadMaxRef.current,
        rows: probes.map((p, i) => ({
          label: p.source.label,
          currentTime: times[i] ?? 0,
          errorMs: ((times[i] ?? 0) - leader) * 1000,
          driftPpm: i === 0 ? null : driftPpm(p.fit),
          minStepMs: p.minStepMs,
          rms: rmsOf(p.analyser, scratchRef.current),
          waiting: p.waiting,
          stalled: p.stalled,
          errors: p.errors,
          ended: p.ended,
          readyState: p.el.readyState,
        })),
      });
    };
    // `setInterval`, not rAF: rAF stops dead in a background tab, and a run
    // this page is designed for lasts longer than anyone watches it.
    const id = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [phase]);

  const copyJson = useCallback(() => {
    void navigator.clipboard?.writeText(
      JSON.stringify(
        {
          agent: navigator.userAgent,
          take: takeId || null,
          asset: assetId || null,
          mesn: wantMesn,
          quantisationPoll: QUANTISATION_POLL,
          report,
        },
        null,
        2,
      ),
    );
  }, [assetId, report, takeId, wantMesn]);

  return (
    <div class="bp-stack">
      <p class="bp-field-hint">
        <code>?take=&lt;takeId&gt;</code> plays that take's real sources.{" "}
        <code>?asset=&lt;assetId&gt;&amp;n=7</code> plays N copies of one file — the crueller test,
        because identical signals comb-filter audibly the moment they separate.{" "}
        <code>&amp;mesn=0</code> bypasses Web Audio, to tell "elements drift" apart from "Web Audio
        routing adds drift".
      </p>

      <div class="bp-solo-drawer">
        <button type="button" class="bp-btn bp-btn-secondary" onClick={() => void load()}>
          Load
        </button>
        <button
          type="button"
          class="bp-btn bp-btn-primary"
          disabled={phase !== "ready"}
          onClick={start}
        >
          Play all
        </button>
        <button
          type="button"
          class="bp-btn bp-btn-secondary"
          disabled={phase !== "running"}
          onClick={stop}
        >
          Stop
        </button>
        <button
          type="button"
          class="bp-btn bp-btn-quiet"
          disabled={report === null}
          onClick={copyJson}
        >
          Copy JSON
        </button>
      </div>

      <p class="bp-field-hint">
        {phase} — {note}
      </p>

      {report && (
        <>
          <p>
            <strong>spread now {report.spreadMs.toFixed(1)} ms</strong> · worst so far{" "}
            {report.spreadMaxMs.toFixed(1)} ms · elapsed {report.elapsedS.toFixed(0)} s
          </p>
          <div style={{ overflowX: "auto" }}>
            <table class="bp-table">
              <thead>
                <tr>
                  <th>track</th>
                  <th>t</th>
                  <th>err (ms)</th>
                  <th>drift (ppm)</th>
                  <th>min step (ms)</th>
                  <th>RMS</th>
                  <th>wait/stall/err</th>
                  <th>ready</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.label}>
                    <td>
                      {row.label}
                      {row.ended ? " (ended)" : ""}
                    </td>
                    <td>{row.currentTime.toFixed(3)}</td>
                    <td>{row.errorMs.toFixed(1)}</td>
                    <td>{row.driftPpm === null ? "—" : row.driftPpm.toFixed(0)}</td>
                    <td>{row.minStepMs === null ? "—" : row.minStepMs.toFixed(1)}</td>
                    {/* A flat zero here with audio apparently playing is the
                        tainted-MESN failure: crossOrigin or the bucket's CORS
                        rule. Nothing else on this page will tell you. */}
                    <td>{row.rms.toFixed(4)}</td>
                    <td>
                      {row.waiting}/{row.stalled}/{row.errors}
                    </td>
                    <td>{row.readyState}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="bp-field-hint">
            "min step" is the smallest non-zero change ever seen in <code>currentTime</code>, polled
            by {QUANTISATION_POLL} — so a value at the poll interval means "finer than this page can
            see", not "this fine". It is the floor on any drift correction.
          </p>
        </>
      )}
    </div>
  );
}
