// Formatting helpers shared by the admin pages. Timestamps render in
// JetBrains Mono (technical data, per the brief) via the `bl-mono` class
// wherever these are used — not decoration on ordinary labels.
const formatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTimestamp(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return "—";
  }
  return formatter.format(new Date(ms)).replace(",", "");
}

// Human-readable dates for the member-facing pages (song/event lists and
// detail heroes) — plain sentence-case English, not the technical
// yyyy-mm-dd `formatTimestamp` above uses for admin tables.
const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatLongDate(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return "—";
  }
  return longDateFormatter.format(new Date(ms));
}

export function formatShortDate(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return "—";
  }
  return shortDateFormatter.format(new Date(ms));
}

/**
 * The kind badge already names the kind ("rehearsal"/"concert"/"session") —
 * an untitled event must not repeat it as a second, capitalised word (e.g.
 * "rehearsal Rehearsal"). When there's a real title and/or venue, show
 * those; when there's neither (the common untitled-rehearsal case), the
 * badge plus date is the whole row and that's enough. Shared by
 * `/events` and `/` (Task 6's home "recent events" section) rather than
 * duplicated in both.
 */
export function eventLabel(event: { title: string | null; venue: string | null }): string {
  return [event.title, event.venue].filter(Boolean).join(" — ");
}

/** Byte count as a human `MB`/`KB`/`B` figure — `/takes/[id]`'s asset list. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * The vote-tally sentence — shared by `/takes/[id]`'s own metadata row and
 * `VoteToggle.astro`'s compact row display, so the two never drift apart
 * in wording. `VoteFavorite.tsx`'s client-side re-render (after a
 * successful optimistic vote, before the next full navigation) mirrors
 * this exact wording by hand, since it runs in the browser rather than
 * importing this module — see that file's own comment.
 */
export function formatVoteTally(
  keeperVotes: number,
  totalVotes: number,
  ratingScore: number,
): string {
  if (totalVotes === 0) {
    return "No votes yet.";
  }
  return `${keeperVotes} of ${totalVotes} ${totalVotes === 1 ? "vote says" : "votes say"} keeper (${Math.round(ratingScore * 100)}%).`;
}

/** `durationMs` as `m:ss` (or `h:mm:ss` past an hour) — takes are minutes long, never sub-second. */
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) {
    return "—";
  }
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
