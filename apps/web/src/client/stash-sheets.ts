// The sheets a stash row opens, for recordings the page did not know about
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
// dialogs for each of those takes out of it. A scoped fetch, not a reload: the
// rows keep their places, the player keeps playing, and nothing else on the
// page moves. ONE fetch, however many recordings need a sheet — the response
// is the whole stash either way.
//
// One instance per island, not one per document: the ids it has added are
// only removable by the island that added them, and `<ClientRouter />` leaves
// a retired island alive with the document long gone. A module-level set
// would let a retired island's cleanup remove a server-rendered sheet of the
// same id on the page that is actually up.
import { stashSheetElementIds } from "./stash-sheet-ids.js";

/** Where the page keeps its stash sheets — outside the row list, which has its own stagger. */
const CONTAINER = "[data-stash-sheets]";

function hasSheet(takeId: string): boolean {
  return Boolean(document.getElementById(stashSheetElementIds(takeId)[0]));
}

export interface StashSheets {
  /**
   * Puts the sheets for these takes into the page, for whichever of them the
   * page does not have yet. A take whose sheets do not arrive keeps a row
   * whose name is still an honest link to the recording's own page, so there
   * is nothing to report and nothing to retry.
   */
  ensure(takeIds: readonly string[]): Promise<void>;
  /** Takes out what this instance put in, when the view that asked for it goes. */
  drop(): void;
}

export function createStashSheets(): StashSheets {
  /** Takes whose sheets THIS instance put in the document, so it can take them out again. */
  const added = new Set<string>();
  /** The one fetch in flight, so a take that lands mid-fetch joins it instead of starting a second. */
  let inFlight: Promise<void> | null = null;

  async function fetchInto(container: Element, takeIds: string[]): Promise<void> {
    const res = await fetch("/takes?stash=1", {
      credentials: "same-origin",
      headers: { accept: "text/html" },
    });
    if (!res.ok) {
      return;
    }
    const fetched = new DOMParser().parseFromString(await res.text(), "text/html");
    for (const takeId of takeIds) {
      const sheets = stashSheetElementIds(takeId)
        .map((id) => fetched.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);
      // Both, or neither: half a sheet is a Rename button that opens nothing.
      if (sheets.length !== 2 || hasSheet(takeId)) {
        continue;
      }
      for (const sheet of sheets) {
        container.append(document.importNode(sheet, true));
      }
      added.add(takeId);
    }
  }

  return {
    async ensure(takeIds: readonly string[]): Promise<void> {
      if (typeof document === "undefined") {
        return;
      }
      // Whatever is already on its way may be bringing these too.
      if (inFlight) {
        await inFlight;
      }
      const missing = takeIds.filter((takeId) => !hasSheet(takeId));
      if (missing.length === 0) {
        return;
      }
      const container = document.querySelector(CONTAINER);
      if (!container) {
        return;
      }
      // Offline, or the fetch was cut off: the rows' links still open the
      // pages. Swallowed here so one failed fetch cannot reject every caller
      // waiting on `inFlight`.
      const run = fetchInto(container, missing).catch(() => undefined);
      inFlight = run;
      try {
        await run;
      } finally {
        if (inFlight === run) {
          inFlight = null;
        }
      }
    },

    drop(): void {
      for (const takeId of added) {
        for (const id of stashSheetElementIds(takeId)) {
          document.getElementById(id)?.remove();
        }
      }
      added.clear();
    },
  };
}
