// The sheet a stash row opens, for a recording the page did not know about
// when it was rendered.
//
// A recording that goes up while the stash is open keeps its row (see
// `syncedStash`): the island draws it, and it plays from the bytes in hand.
// What it does not have is a SHEET — those are server-rendered, one per row,
// because that is what keeps them working with no script. A row that opened a
// page while every other row opened a sheet would tell the member which
// recording they had just made, which is exactly what this must not do.
//
// So the island asks the server for the stash view again and takes the two
// dialogs for that one take out of it. A scoped fetch, not a reload: the row
// keeps its place, the player keeps playing, and nothing else on the page
// moves.
import { stashSheetElementIds } from "./stash-sheet-ids.js";

/** Where the page keeps its stash sheets — outside the row list, which has its own stagger. */
const CONTAINER = "[data-stash-sheets]";

/** Takes whose sheets THIS module put in the document, so it can take them out again. */
const added = new Set<string>();

function hasSheet(takeId: string): boolean {
  return Boolean(document.getElementById(stashSheetElementIds(takeId)[0]));
}

/**
 * Puts the sheets for `takeId` into the page, unless they are already there.
 * Answers whether the page now has them — a caller that gets `false` has a row
 * whose name is still an honest link to the recording's own page.
 */
export async function ensureStashSheets(takeId: string): Promise<boolean> {
  if (typeof document === "undefined") {
    return false;
  }
  if (hasSheet(takeId)) {
    return true;
  }
  const container = document.querySelector(CONTAINER);
  if (!container) {
    return false;
  }
  try {
    const res = await fetch("/takes?stash=1", {
      credentials: "same-origin",
      headers: { accept: "text/html" },
    });
    if (!res.ok) {
      return false;
    }
    const fetched = new DOMParser().parseFromString(await res.text(), "text/html");
    const sheets = stashSheetElementIds(takeId)
      .map((id) => fetched.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    // Both, or neither: half a sheet is a Rename button that opens nothing.
    if (sheets.length !== 2 || hasSheet(takeId)) {
      return hasSheet(takeId);
    }
    for (const sheet of sheets) {
      container.append(document.importNode(sheet, true));
    }
    added.add(takeId);
    return true;
  } catch {
    // Offline, or the fetch was cut off. The row's link still opens the page.
    return false;
  }
}

/** Takes out what this module put in, when the view that asked for it goes. */
export function dropStashSheets(): void {
  for (const takeId of added) {
    for (const id of stashSheetElementIds(takeId)) {
      document.getElementById(id)?.remove();
    }
  }
  added.clear();
}
