// What a `/s/<code>` link points at, decided without a database: whether the
// target may be shared at all, which page it opens, and the two lines a
// link preview may show about it to someone who is NOT signed in.
//
// Pure on purpose. The loader (`server/pages/share.ts`) reads the facts; this
// module is the only place the rules live, so the node tests below can pin
// them, and the one rule that matters most (a private take is never shared,
// not even its title) cannot drift between the endpoint that makes a code,
// the redirect that follows one, and the preview a crawler sees.
import { formatLongDate, type Locale, messages } from "@bandplate/i18n";
import { eventLabel, factsLine, takeNote } from "./format.js";

interface EventFacts {
  id: string;
  kind: string;
  title: string | null;
  venue: string | null;
  heldAt: number;
}

/**
 * Everything the rules below need about one target, as read by the loader.
 * Deliberately no member names, votes, notes, chords or lyrics: what is not
 * here cannot leak into a preview.
 */
export type ShareTargetFacts =
  | {
      kind: "song";
      song: { id: string; slug: string; title: string };
      /** Band takes only, the count the song page shows. */
      takeCount: number;
    }
  | {
      kind: "event";
      event: EventFacts;
      /** Band takes only. A personal day with none is nobody's page. */
      takeCount: number;
    }
  | {
      kind: "take";
      take: {
        id: string;
        visibility: "private" | "band";
        label: string | null;
        recordedAt: number;
      };
      song: { title: string } | undefined;
      event: EventFacts | undefined;
    };

/**
 * The page a target opens, or undefined when it may not be shared.
 *
 * Undefined for a private (stash) take, always: its own owner reaches it at
 * `/stash/<id>`, and nobody else can open it at all, so a link to it would be
 * a link that works for one person. Undefined for a personal event with no
 * band take, which `/events/[id]` answers with a 404 for everyone.
 */
export function sharePath(facts: ShareTargetFacts | undefined): string | undefined {
  if (!facts) {
    return undefined;
  }
  switch (facts.kind) {
    case "song":
      return `/songs/${facts.song.slug}`;
    case "event":
      if (facts.event.kind === "personal" && facts.takeCount === 0) {
        return undefined;
      }
      return `/events/${facts.event.id}`;
    case "take":
      if (facts.take.visibility !== "band") {
        return undefined;
      }
      return `/takes/${facts.take.id}`;
  }
}

export interface SharePreview {
  title: string;
  description: string;
}

/** An event's name, or, when it has none, its kind and date: "Zkouška, 8. července 2026". */
function eventTitle(event: EventFacts, locale: Locale): string {
  return (
    eventLabel(event) ||
    factsLine(
      [messages(locale).events.kindLabel(event.kind), formatLongDate(locale, event.heldAt)],
      locale,
    )
  );
}

/**
 * The title and one factual line a link preview shows to someone who is not
 * signed in. Undefined exactly when `sharePath` is, so a code that does not
 * open a page also says nothing about it.
 *
 * - Song: its title, and how many takes it has.
 * - Event: its name (or kind and date), and its kind and date.
 * - Take: its song's title, and the take's label, the event and the date.
 */
export function sharePreview(
  facts: ShareTargetFacts | undefined,
  locale: Locale,
): SharePreview | undefined {
  if (!facts || sharePath(facts) === undefined) {
    return undefined;
  }
  const t = messages(locale);
  switch (facts.kind) {
    case "song":
      return { title: facts.song.title, description: t.takes.count(facts.takeCount) };
    case "event": {
      const { event } = facts;
      return {
        title: eventTitle(event, locale),
        description: factsLine(
          [t.events.kindLabel(event.kind), formatLongDate(locale, event.heldAt)],
          locale,
        ),
      };
    }
    case "take": {
      const { take, song, event } = facts;
      const date = formatLongDate(locale, event ? event.heldAt : take.recordedAt);
      const kindLabel = event ? t.events.kindLabel(event.kind) : "";
      return {
        title: song ? song.title : t.takes.heroTitleByDate(date),
        description: factsLine(
          [takeNote(take.label, kindLabel), event ? eventLabel(event) || kindLabel : null, date],
          locale,
        ),
      };
    }
  }
}
