// What a stash recording is CALLED, on every surface that names one: the row
// in the stash list, the local row the offline queue draws beside it, and the
// sheet the row opens.
//
// The recording's own name LEADS. A member records four ideas for the same
// song in one evening; four rows titled with that song told them apart by
// nothing, and the one word they had typed sat underneath in the muted run
// with the date. So the label is the title and the song is the second line.
//
// Pure, and here rather than repeated in three templates, because since
// migration 0011 there are three different reasons a song title can be missing
// and they do not mean the same thing to a reader:
//
//   - the recording has no song yet (it was made before its member decided),
//   - the recording names a song that is no longer in the library,
//   - the recording has a song, and that is the name.
//
// `StashRow.astro`, `StashPendingList.tsx` and `StashItemSheet.astro` all ask
// here.
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
 * The name to show. The member's own label first: it is the one thing they
 * wrote about this recording, and it is what tells two ideas for the same song
 * apart. The song is what a recording BELONGS to, not what it is called, so it
 * goes on the second line — unless there is no label, when the song is the
 * only name there is. With neither, the honest fallback for whichever of the
 * two "no title" cases this is.
 */
export function stashName(parts: StashNameParts, words: StashNameWords): string {
  if (parts.label) {
    return parts.label;
  }
  if (parts.songTitle) {
    return parts.songTitle;
  }
  return parts.songId ? words.unknownSong : words.noSong;
}

/**
 * The SECOND line: the song this recording is for, which is worth saying only
 * when it is not already the name above. A recording with no label is called
 * by its song, and printing it again underneath would say the same thing
 * twice; one with no song at all has nothing to add.
 */
export function stashNote(parts: StashNameParts, words: StashNameWords): string | null {
  if (!parts.label) {
    return null;
  }
  if (parts.songTitle) {
    return parts.songTitle;
  }
  return parts.songId ? words.unknownSong : null;
}

/**
 * The "Píseň" field's value: the song, or the app's lone em dash for no value
 * (`EMPTY_VALUE`). Never the label: the label is the recording's name, not its
 * song, and putting it here would answer a question nobody asked.
 */
export function stashSongField(parts: StashNameParts, words: StashNameWords): string {
  if (parts.songTitle) {
    return parts.songTitle;
  }
  return parts.songId ? words.unknownSong : EMPTY_VALUE;
}
