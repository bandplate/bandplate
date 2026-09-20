// What a stash recording's two sheets are called, in one place.
//
// Three surfaces have to agree on these strings or a row opens nothing:
// `StashItemSheet.astro` renders them, `StashRow.astro` and the island point
// their triggers at them, and `stash-sheets.ts` finds them in a freshly
// fetched page. `RecordSheet` prefixes the element's own id with `sheet-`;
// these are the names, not the element ids.
export function stashSheetId(takeId: string): string {
  return `stash-${takeId}`;
}

export function stashRenameSheetId(takeId: string): string {
  return `stash-rename-${takeId}`;
}

/** The element ids `RecordSheet` gives them, which is what a lookup needs. */
export function stashSheetElementIds(takeId: string): [string, string] {
  return [`sheet-${stashSheetId(takeId)}`, `sheet-${stashRenameSheetId(takeId)}`];
}
