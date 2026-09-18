// D1 allows at most 100 bound parameters per statement (see
// `global-constraints.md`), so any `inArray(...)` built from a caller-sized
// list has to be split before it reaches the database. `chunk` is the one
// place that splitting happens — used by `pushSubscriptionsRepo.listForMembers`
// (≤90, leaving headroom for a query's other bound values) and
// `takesRepo.countUnvotedByMembers` (≤100, the id list is the query's only
// parameter).
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
