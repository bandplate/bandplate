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
