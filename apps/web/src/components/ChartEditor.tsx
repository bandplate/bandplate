// Chords & lyrics as SECTIONS, not as two boxes with two different formats.
//
// --- Why this exists ------------------------------------------------------
//
// The parser takes two conventions and neither field said so: chords want one
// line per section, `{ti(locale).chartFormatExample}`, while lyrics want the label alone on its
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
//
// There is no toggle and no paste box: rows are the editor. A song the parser
// CANNOT read stays in the text boxes — it opens there and edits there, and
// once its text is in a shape the parser recognises it opens as rows the next
// time. That is the only door in or out, deliberately, so there is one way to
// edit a chart rather than two that can disagree.
//
// The text boxes are also the no-JS path: the two `<textarea>`s ARE the form
// fields, always present and always in sync, so with scripting off you get
// exactly the editor that exists today. Nothing here is required to save.
import { islandsMessages, type Locale } from "@bandplate/i18n";
import { currentLocale } from "../client/locale.js";

/** Read at call time — see `client/locale.ts`. */
const ti = (fallback?: Locale) => islandsMessages(currentLocale(fallback));

/** A row's name for an accessible label, or "section 3" when it has none. */
function rowName(row: { label: string }, index: number, locale?: Locale): string {
  return row.label || ti(locale).chartUnnamedSection(index + 1);
}

import { ArrowDown, ArrowUp } from "lucide-preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type EditorRow,
  isKnownSection,
  moveRow,
  newRow,
  rowsToText,
} from "../client/chart-rows.js";

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
  /** Parsed server-side. Empty when the song has nothing yet. */
  initialRows: { label: string; chords: string; lyrics: string }[];
  /** True when the text could not be read as sections — see `songToRows`. */
  freeform: boolean;
  chordText: string;
  lyricsText: string;
  /** `KNOWN_SECTION_WORDS`, passed in so it cannot drift from the parser. */
  vocabulary: string[];
}

/** Whether a row holds anything a save would carry. */
function hasContent(row: EditorRow): boolean {
  return row.chords.trim() !== "" || row.lyrics.trim() !== "";
}

function ArrowIcon({ up }: { up: boolean }) {
  return up ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />;
}

export default function ChartEditor({
  initialRows,
  freeform,
  chordText,
  lyricsText,
  vocabulary,
  locale,
}: Props) {
  const [rows, setRows] = useState<EditorRow[]>(() =>
    initialRows.length > 0
      ? initialRows.map((r) => newRow(r.label, r.chords, r.lyrics))
      : [newRow()],
  );
  // A song whose text was not readable as sections IS text — there is nothing
  // to toggle, because guessing at a shape the parser itself declined to guess
  // is the one thing this editor must not do.
  const chordsRef = useRef<HTMLTextAreaElement>(null);
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const text = useMemo(() => rowsToText(rows), [rows]);

  // The rows are a VIEW; the two textareas are the form. Keep them in step so
  // the POST carries exactly what the rows say — and so switching to text
  // shows what the rows produced rather than what was there before.
  useEffect(() => {
    if (freeform) {
      return;
    }
    if (chordsRef.current) {
      chordsRef.current.value = text.chords;
    }
    if (lyricsRef.current) {
      lyricsRef.current.value = text.lyrics;
    }
  }, [text, freeform]);

  /**
   * Stop a save that would throw words away.
   *
   * `rowsToText` skips a row with no name, because both output conventions
   * begin with the label — there is nowhere to put the words. It did that
   * SILENTLY, so typing a verse into the row the editor opens with and pressing
   * Save discarded it with nothing said, and the song came back unchanged.
   *
   * The guard lives here rather than on the server because by the time a POST
   * arrives the words are already gone: the island writes the textareas, and it
   * wrote them empty. And it is a listener rather than `required` because every
   * form in this app is `novalidate` — see the input above.
   *
   * It reads the DOM rather than `rows`, deliberately. `<ClientRouter />`
   * replaces the document on navigation, and an island torn out that way never
   * unmounts — so this effect's cleanup never runs and its listener stays on
   * the form. Instrumenting an earlier version caught exactly that: a stale
   * instance answered first, holding rows from its own mount whose ids matched
   * nothing on screen. Reading the fields the member is actually looking at
   * cannot go stale, and the `document.contains` check below stands a detached
   * copy down before it can block a save the live editor has already fixed.
   */
  useEffect(() => {
    if (freeform) {
      return;
    }
    const root = rootRef.current;
    const form = root?.closest("form");
    if (!root || !form) {
      return;
    }
    const onSubmit = (event: Event) => {
      if (!document.contains(root)) {
        return;
      }
      for (const row of root.querySelectorAll(".bp-chart-row")) {
        const name = row.querySelector<HTMLInputElement>(".bp-chart-row-name");
        const chords = row.querySelector<HTMLTextAreaElement>(".bp-chart-row-chords");
        const words = row.querySelector<HTMLTextAreaElement>(".bp-chart-row-lyrics");
        if (name?.value.trim() !== "") {
          continue;
        }
        if (chords?.value.trim() === "" && words?.value.trim() === "") {
          continue;
        }
        event.preventDefault();
        // The row already says why; this puts the cursor where the fix is.
        name.focus();
        name.scrollIntoView({ block: "center" });
        return;
      }
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [freeform]);

  const update = useCallback((id: string, patch: Partial<EditorRow>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const unknownNames = rows.filter(
    (r) => r.label.trim() !== "" && !isKnownSection(r.label, vocabulary),
  );

  return (
    <div class={`bp-chart-editor${freeform ? " bp-chart-editor--text" : ""}`} ref={rootRef}>
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
            // A row with words but no name cannot be WRITTEN: both output
            // conventions start with the label (`{ti(locale).chartFormatExample}`, and the label
            // alone above its words), so `rowsToText` skips it — and used to
            // skip it silently, which meant typing a verse into the section
            // the editor opens with and pressing Save threw the words away
            // with nothing said. See the `required` below.
            const needsName = row.label.trim() === "" && hasContent(row);
            return (
              <li class="bp-chart-row" key={row.id}>
                <div class="bp-chart-row-head">
                  <input
                    class="bp-input bp-chart-row-name"
                    type="text"
                    list="bp-section-names"
                    placeholder={ti(locale).chartSectionNamePlaceholder}
                    aria-label={ti(locale).chartSectionNameLabel(index + 1)}
                    /* One attribute, both reasons: the name is unusable
                       either because the parser will not recognise it or
                       because there isn't one and the row has words to lose. */
                    aria-invalid={!known || needsName ? "true" : undefined}
                    value={row.label}
                    onInput={(e) => update(row.id, { label: e.currentTarget.value })}
                    id={`chart-name-${row.id}`}
                    /* SEMANTICS, not enforcement: every form in this app is
                       `novalidate` (the server's zod schemas are the one source
                       of truth, and errors render in the page rather than as
                       browser bubbles), so this never stops a submit on its
                       own. It is here so a screen reader announces the field as
                       required the moment the row has something to lose; the
                       stopping is done by the submit handler below. */
                    required={!freeform && needsName}
                    aria-describedby={needsName ? `${row.id}-needs-name` : undefined}
                  />
                  <div class="bp-chart-row-actions">
                    <button
                      type="button"
                      class="bp-btn bp-btn-quiet bp-btn-sm bp-chart-row-move"
                      aria-label={ti(locale).chartMoveUp(rowName(row, index, locale))}
                      disabled={index === 0}
                      onClick={() => setRows((c) => moveRow(c, index, -1))}
                    >
                      <ArrowIcon up />
                    </button>
                    <button
                      type="button"
                      class="bp-btn bp-btn-quiet bp-btn-sm bp-chart-row-move"
                      aria-label={ti(locale).chartMoveDown(rowName(row, index, locale))}
                      disabled={index === rows.length - 1}
                      onClick={() => setRows((c) => moveRow(c, index, 1))}
                    >
                      <ArrowIcon up={false} />
                    </button>
                    <button
                      type="button"
                      class="bp-btn bp-btn-quiet bp-btn-sm"
                      aria-label={ti(locale).chartRemoveRow(rowName(row, index, locale))}
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

                {/* Said as soon as there is something to lose, not held back
                    until Save — the point is that nobody reaches Save with a
                    row that cannot be written. */}
                {needsName && (
                  <p class="bp-field-error bp-m0" id={`${row.id}-needs-name`}>
                    Give this section a name and its words will be kept — the song page files words
                    under the part they belong to, so a nameless one has nowhere to go.
                  </p>
                )}

                {!known && (
                  <p class="bp-field-error bp-m0">
                    The song page won't recognise “{row.label.trim()}” as a section, so this part
                    won't line up. Try one of the names the box offers.
                  </p>
                )}

                <textarea
                  class="bp-textarea bp-chart-row-chords bp-mono"
                  rows={2}
                  placeholder={ti(locale).chartChordsPlaceholder}
                  aria-label={ti(locale).chartChordsFor(rowName(row, index, locale))}
                  value={row.chords}
                  onInput={(e) => update(row.id, { chords: e.currentTarget.value })}
                />
                <textarea
                  class="bp-textarea bp-chart-row-lyrics"
                  rows={4}
                  placeholder={ti(locale).chartLyricsPlaceholder}
                  aria-label={ti(locale).chartWordsFor(rowName(row, index, locale))}
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
            {ti(locale).chartAddSection}
          </button>
        </div>

        {unknownNames.length > 0 && (
          <p class="bp-sheet-hint bp-m0">
            {ti(locale).chartUnknownNames(unknownNames.length)} a name the song page won't
            recognise. You can save anyway — those parts just won't line their chords up with their
            words.
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
            {ti(locale).chartFormatHint}{" "}
            <code class="bp-mono">{ti(locale).chartFormatExample}</code>
          </p>
          <textarea
            class="bp-textarea bp-mono"
            id="song-chords"
            name="chordProgression"
            rows={8}
            ref={chordsRef}
            defaultValue={freeform ? chordText : text.chords}
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
            defaultValue={freeform ? lyricsText : text.lyrics}
          />
        </div>
      </div>

      {freeform && (
        <p class="bp-sheet-hint bp-m0">
          This song's text isn't written in sections the song page recognises, so it renders as
          plain text — nothing is lost, but the chords don't line up with the words. Give a part a
          name on its own line and put its chords after a colon (
          <code class="bp-mono">{ti(locale).chartFormatExample}</code>), save, and it opens as
          sections next time.
        </p>
      )}
    </div>
  );
}
