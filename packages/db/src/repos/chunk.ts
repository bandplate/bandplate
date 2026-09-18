// D1 allows at most 100 bound parameters per statement, so any
// `inArray(...)` built from a caller-sized
// list has to be split before it reaches the database. `chunk` is the one
// place that splitting happens — but the size each caller passes is ITS OWN
// responsibility to get right: `size` has to be small enough that the
// TOTAL bound parameters of the query it feeds — the chunked id list PLUS
// every other bound value in that same statement (a join condition's
// literal, a second filter, ...) — stays at or under 100. The id list is
// not always the only parameter: `takesRepo.countUnvotedByMembers` looked
// like it was at a glance, but `eq(takes.state, "published")` binds one
// too, which is why that caller chunks at 90 while
// `notificationPrefsRepo.listForMembers` (whose `inArray(...)` really is
// its query's only parameter) chunks at the full 100. Don't assume either
// way — each caller pins its own choice with a `.toSQL().params.length`
// test against a full-size chunk, and that test, not a comment here, is
// the source of truth for whether a given size is safe.
export function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
