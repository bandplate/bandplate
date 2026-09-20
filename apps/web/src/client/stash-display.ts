// What a stash recording is CALLED, on every surface that names one: the row
// in the stash list, the local row the offline queue draws beside it, and the
// heading of the recording's own page.
//
// Pure, and here rather than repeated in three templates, because since
// migration 0011 there are three different reasons a song title can be missing
// and they do not mean the same thing to a reader:
//
//   - the recording has no song yet (it was made before its member decided),
//   - the recording names a song that is no longer in the library,
//   - the recording has a song, and that is the name.
//
// `StashRow.astro`, `StashPendingList.tsx` and `/stash/[id]` all ask here.
import { EMPTY_VALUE } from "@bandplate/i18n";

export interface StashNameParts {
  /** NULL when no song was chosen. */
  songId: string | null | undefined;
  /** The song's title, when it was found. */
  songTitle: string | null | undefined;
  /** What the member typed on the review screen. */
  label: string | null | undefined;
}

export interface StashNameWords {
  /** "Bez písně" — a recording waiting for its song, and with no label either. */
  noSong: string;
  /** "Neznámá píseň" — the song id is filed, the song is gone. */
  unknownSong: string;
}

/**
 * The name to show. A song, if there is one; otherwise the member's own label,
 * which is the only thing they actually wrote about this recording; otherwise
 * the honest fallback for whichever of the two "no title" cases this is.
 */
export function stashName(parts: StashNameParts, words: StashNameWords): string {
  if (parts.songTitle) {
    return parts.songTitle;
  }
  if (parts.label) {
    return parts.label;
  }
  return parts.songId ? words.unknownSong : words.noSong;
}

/**
 * The "Píseň" field's value: the song, or the app's lone em dash for no value
 * (`EMPTY_VALUE`). Never the label: the label is the recording's name, not its
 * song, and putting it here would answer a question nobody asked.
 */
/**
 * The label as a SECOND line of information, which it is only when it is not
 * already the row's name. A songless recording is called by its label, and
 * printing it again underneath would say the same thing twice.
 */
export function stashNote(parts: StashNameParts, words: StashNameWords): string | null {
  const label = parts.label ?? null;
  return label && stashName(parts, words) === label ? null : label;
}

export function stashSongField(parts: StashNameParts, words: StashNameWords): string {
  if (parts.songTitle) {
    return parts.songTitle;
  }
  return parts.songId ? words.unknownSong : EMPTY_VALUE;
}
