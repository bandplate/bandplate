// When a song's chart actually changed, for notification purposes.
//
// Saving a chart re-writes the whole `chordProgression`/`lyrics` pair on
// every save, even when nothing meaningful changed — a save triggered by
// clicking into a text area and back out, or an editor that normalizes line
// endings on the way through. Notifying on every SAVE would mean notifying
// on saves nobody would call a change, so `chartChanged` compares the
// CONTENT, not the bytes.

/** How long after one chart-changing edit to wait before notifying, so a flurry of edits becomes one message. */
export const SONG_THROTTLE_MS = 21_600_000; // 6 hours

/**
 * How old the newest change in a claimed window may be before the tick
 * gives up on sending it — same 24h horizon as `NEW_TAKES_MAX_AGE_MS`. A
 * claim can sit unsent for a while (a DB outage, a deploy gap, the tick
 * itself down); once the change behind it is this old, "someone edited a
 * song" has stopped being news, so the claim is honored silently (counted
 * in `skippedStale`) rather than sent.
 */
export const SONG_MAX_AGE_MS = 86_400_000; // 24 hours

type Chart = { chordProgression: string | null; lyrics: string | null };

/**
 * Normalizes one field for comparison: `null` and `""` are the same "no
 * content" value, CRLF becomes LF (a Windows editor or a copy-paste from one
 * shouldn't register as an edit), and trailing whitespace is stripped both
 * per line and for the whole string (a save that only added trailing spaces
 * changed nothing anyone can see).
 */
function normalize(value: string | null): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

/** Whether a save actually changed what the chart says, ignoring line-ending and whitespace noise. */
export function chartChanged(before: Chart, after: Chart): boolean {
  return (
    normalize(before.chordProgression) !== normalize(after.chordProgression) ||
    normalize(before.lyrics) !== normalize(after.lyrics)
  );
}

/**
 * Which single notification a throttle window's worth of edits gets.
 *
 * A song can only be CREATED once, and "new song" is the more useful thing
 * to say than "song updated" when both happened inside the same window (a
 * song created and then immediately chart-edited before the throttle fires)
 * — so `"created"` wins whenever it is present, regardless of order.
 */
export function songNotificationKind(kinds: ("created" | "edited")[]): "created" | "edited" {
  return kinds.includes("created") ? "created" : "edited";
}
