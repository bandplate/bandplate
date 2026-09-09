// Chords & lyrics as SECTIONS, not as two boxes with two different formats.
//
// --- Why this exists ------------------------------------------------------
//
// The parser takes two conventions and neither field said so: chords want one
// line per section, `Verse: Am Dm7`, while lyrics want the label alone on its
// own line with the words beneath. Getting it wrong produced NOTHING — the
// chart fell back to two plain blocks with no explanation, and the only way to
// find out was to save and go look at the song page.
//
// A row removes the format from the question. A section has a name, its chords
// and its words; the app writes the text in whichever convention each column
// needs. There is no colon rule to remember because there is no colon.
//
// --- What it does NOT take away -------------------------------------------
//
// Two things the free-text editor could do that rows cannot, both kept:
//
//  1. FREE TEXT SURVIVES. `buildSongChart` degrades on purpose — a song
//     written in a convention it does not recognise renders as plain text
//     rather than being mangled. A row IS a label, so it cannot hold that.
//     `songToRows` refuses rather than guessing, this editor opens straight
//     into the text boxes for such a song, and the toggle is always there.
//     No song loses its shape by being opened.
//  2. PASTING STILL WORKS. `parsePastedChart` splits a chart from anywhere
//     else into rows — the cost E3 was chosen despite.
//
// The text boxes are also the no-JS path: the two `<textarea>`s ARE the form
// fields, always present and always in sync, so with scripting off you get
// exactly the editor that exists today. Nothing here is required to save.
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type EditorRow,
  isKnownSection,
  moveRow,
  newRow,
  parsePastedChart,
  rowsToText,
} from "../client/chart-rows.js";

interface Props {
  /** Parsed server-side. Empty when the song has nothing yet. */
  initialRows: { label: string; chords: string; lyrics: string }[];
  /** True when the text could not be read as sections — see `songToRows`. */
  freeform: boolean;
  chordText: string;
  lyricsText: string;
  /** `KNOWN_SECTION_WORDS`, passed in so it cannot drift from the parser. */
  vocabulary: string[];
}

function ArrowIcon({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {up ? <path d="M12 19V5M6 11l6-6 6 6" /> : <path d="M12 5v14M6 13l6 6 6-6" />}
    </svg>
  );
}

export default function ChartEditor({
  initialRows,
  freeform,
  chordText,
  lyricsText,
  vocabulary,
}: Props) {
  const [rows, setRows] = useState<EditorRow[]>(() =>
    initialRows.length > 0
      ? initialRows.map((r) => newRow(r.label, r.chords, r.lyrics))
      : [newRow()],
  );
  // A song whose text was not readable as sections opens as TEXT. Anything
  // else would mean guessing at a shape the parser itself declined to guess.
  const [asText, setAsText] = useState(freeform);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState("");
  const chordsRef = useRef<HTMLTextAreaElement>(null);
  const lyricsRef = useRef<HTMLTextAreaElement>(null);

  const text = useMemo(() => rowsToText(rows), [rows]);

  // The rows are a VIEW; the two textareas are the form. Keep them in step so
  // the POST carries exactly what the rows say — and so switching to text
  // shows what the rows produced rather than what was there before.
  useEffect(() => {
    if (asText) {
      return;
    }
    if (chordsRef.current) {
      chordsRef.current.value = text.chords;
    }
    if (lyricsRef.current) {
      lyricsRef.current.value = text.lyrics;
    }
  }, [text, asText]);

  const update = useCallback((id: string, patch: Partial<EditorRow>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const unknownNames = rows.filter(
    (r) => r.label.trim() !== "" && !isKnownSection(r.label, vocabulary),
  );

  return (
    <div class={`bp-chart-editor${asText ? " bp-chart-editor--text" : ""}`}>
      <div class="bp-chart-rows-pane">
        <div class="bp-sheet-field">
          <span class="bp-eyebrow">Chords &amp; lyrics</span>
          <p class="bp-sheet-hint bp-m0">
            One section at a time. The song page lines each section's chords up with its words.
          </p>
        </div>

        <ul class="bp-chart-rows">
          {rows.map((row, index) => {
            const known = row.label.trim() === "" || isKnownSection(row.label, vocabulary);
            return (
              <li class="bp-chart-row" key={row.id}>
                <div class="bp-chart-row-head">
                  <input
                    class="bp-input bp-chart-row-name"
                    type="text"
                    list="bp-section-names"
                    placeholder="Verse"
                    aria-label={`Section ${index + 1} name`}
                    aria-invalid={known ? undefined : "true"}
                    value={row.label}
                    onInput={(e) => update(row.id, { label: e.currentTarget.value })}
                  />
                  <div class="bp-chart-row-actions">
                    <button
                      type="button"
                      class="bp-btn bp-btn-quiet bp-btn-sm bp-chart-row-move"
                      aria-label={`Move ${row.label || `section ${index + 1}`} up`}
                      disabled={index === 0}
                      onClick={() => setRows((c) => moveRow(c, index, -1))}
                    >
                      <ArrowIcon up />
                    </button>
                    <button
                      type="button"
                      class="bp-btn bp-btn-quiet bp-btn-sm bp-chart-row-move"
                      aria-label={`Move ${row.label || `section ${index + 1}`} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => setRows((c) => moveRow(c, index, 1))}
                    >
                      <ArrowIcon up={false} />
                    </button>
                    <button
                      type="button"
                      class="bp-btn bp-btn-quiet bp-btn-sm"
                      aria-label={`Remove ${row.label || `section ${index + 1}`}`}
                      onClick={() =>
                        setRows((c) => {
                          const next = c.filter((r) => r.id !== row.id);
                          return next.length > 0 ? next : [newRow()];
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {!known && (
                  <p class="bp-field-error bp-m0">
                    The song page won't recognise “{row.label.trim()}” as a section, so this part
                    won't line up. Try one of the names the box offers.
                  </p>
                )}

                <textarea
                  class="bp-textarea bp-chart-row-chords bp-mono"
                  rows={2}
                  placeholder="Am Dm7"
                  aria-label={`Chords for ${row.label || `section ${index + 1}`}`}
                  value={row.chords}
                  onInput={(e) => update(row.id, { chords: e.currentTarget.value })}
                />
                <textarea
                  class="bp-textarea bp-chart-row-lyrics"
                  rows={4}
                  placeholder="The words for this section"
                  aria-label={`Words for ${row.label || `section ${index + 1}`}`}
                  value={row.lyrics}
                  onInput={(e) => update(row.id, { lyrics: e.currentTarget.value })}
                />
              </li>
            );
          })}
        </ul>

        {/* Every name the parser accepts, OFFERED rather than described. The
            list comes from the parser itself — see `KNOWN_SECTION_WORDS`. */}
        <datalist id="bp-section-names">
          {vocabulary.map((word) => (
            <option value={word.charAt(0).toUpperCase() + word.slice(1)} key={word} />
          ))}
        </datalist>

        <div class="bp-chart-actions">
          <button
            type="button"
            class="bp-btn bp-btn-secondary bp-btn-sm"
            onClick={() => setRows((c) => [...c, newRow()])}
          >
            Add a section
          </button>
          <button
            type="button"
            class="bp-btn bp-btn-quiet bp-btn-sm"
            onClick={() => setImporting((v) => !v)}
          >
            Paste a chart
          </button>
        </div>

        {importing && (
          <div class="bp-sheet-field">
            <label class="bp-eyebrow" for="bp-chart-paste">
              Paste a chart
            </label>
            <p class="bp-sheet-hint bp-m0">
              However it is written elsewhere — this splits it into sections you can correct.
            </p>
            <textarea
              class="bp-textarea bp-mono"
              id="bp-chart-paste"
              rows={6}
              value={pasted}
              onInput={(e) => setPasted(e.currentTarget.value)}
            />
            <div class="bp-chart-actions">
              <button
                type="button"
                class="bp-btn bp-btn-secondary bp-btn-sm"
                disabled={pasted.trim() === ""}
                onClick={() => {
                  const parsed = parsePastedChart(pasted, vocabulary);
                  if (parsed.length > 0) {
                    setRows(parsed);
                  }
                  setPasted("");
                  setImporting(false);
                }}
              >
                Split it into sections
              </button>
              <button
                type="button"
                class="bp-btn bp-btn-quiet bp-btn-sm"
                onClick={() => setImporting(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {unknownNames.length > 0 && (
          <p class="bp-sheet-hint bp-m0">
            {unknownNames.length === 1 ? "One section has" : `${unknownNames.length} sections have`}{" "}
            a name the song page won't recognise. You can save anyway — those parts just won't line
            their chords up with their words.
          </p>
        )}
      </div>

      {/* The form's REAL fields, and the whole no-JS editor. Hidden while the
          rows are in charge, and always carrying what the rows say. */}
      <div class="bp-chart-text-pane">
        <div class="bp-sheet-field">
          <label class="bp-eyebrow" for="song-chords">
            Chords
          </label>
          <p class="bp-sheet-hint bp-m0">
            One section per line: <code class="bp-mono">Verse: Am Dm7</code>
          </p>
          <textarea
            class="bp-textarea bp-mono"
            id="song-chords"
            name="chordProgression"
            rows={8}
            ref={chordsRef}
            defaultValue={asText ? chordText : text.chords}
          />
        </div>
        <div class="bp-sheet-field">
          <label class="bp-eyebrow" for="song-lyrics">
            Lyrics
          </label>
          <p class="bp-sheet-hint bp-m0">
            The section name alone on its own line, the words beneath it. No colon.
          </p>
          <textarea
            class="bp-textarea"
            id="song-lyrics"
            name="lyrics"
            rows={10}
            ref={lyricsRef}
            defaultValue={asText ? lyricsText : text.lyrics}
          />
        </div>
      </div>

      <div class="bp-chart-actions">
        <button
          type="button"
          class="bp-btn bp-btn-quiet bp-btn-sm bp-chart-toggle"
          onClick={() => setAsText((v) => !v)}
        >
          {asText ? "Edit as sections" : "Edit as plain text"}
        </button>
      </div>

      {asText && freeform && (
        <p class="bp-sheet-hint bp-m0">
          This song's text isn't written in sections the song page recognises, so it renders as
          plain text. Switch to sections to give it structure — nothing is lost either way.
        </p>
      )}
    </div>
  );
}
