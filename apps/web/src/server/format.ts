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
