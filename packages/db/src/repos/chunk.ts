// D1 allows at most 100 bound parameters per statement (see
// `global-constraints.md`), so any `inArray(...)` built from a caller-sized
// list has to be split before it reaches the database. `chunk` is the one
// place that splitting happens — every current caller uses ≤90, leaving
// headroom for a query's OTHER bound values (a join condition's literal, a
// second filter, ...). Verified with `toSQL().params.length` rather than
// assumed: `takesRepo.countUnvotedByMembers`'s query looked like "the id
// list is the only parameter" at a glance, but `eq(takes.state,
// "published")` binds one too, so a full 100-id chunk would have shipped
// 101 params. Chunking at 90 for every caller, not calculating the exact
// headroom each query needs, is deliberate — one number that is safe
// everywhere beats a per-call-site budget that has to be re-verified by
// hand whenever a query grows another condition.
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
