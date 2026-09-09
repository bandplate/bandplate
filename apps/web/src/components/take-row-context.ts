// `TakeRow.astro`'s `context` prop type — a plain `.ts` module rather than
// exported straight out of the `.astro` file's frontmatter. That's not a
// style preference: an exported top-level union whose members each contain
// a NESTED union (`TakeRowEventRef | undefined`) crashes Astro's
// server-build esbuild pass ("Unexpected '|'", a bogus location inside
// TakeRow.astro) even though `astro check`/`astro dev` both accept the
// exact same type happily — a real compiler bug, isolated by trial (see
// task-6-report.md for the minimal repro). Every equivalent type in a
// plain `.ts` file compiles fine, so the type lives here and `TakeRow.astro`
// imports it rather than exporting it itself.
export interface TakeRowEventRef {
  id: string;
  heldAt: number;
  kind: string;
  /**
   * Enough to NAME the event, not just link to it. A song's take list used to
   * end every row with "View this rehearsal" — a two-line call to action
   * carrying one bit of information, where the venue says which rehearsal it
   * actually was. Optional because a bare event has neither.
   */
  title?: string | null;
  venue?: string | null;
}

export interface TakeRowSongRef {
  slug: string;
  title: string;
}

// Every ref is nullable, not just optional-per-kind — a dangling
// songId/eventId (a join that came back empty) is defensive-programming
// territory, not something this component's type should rule out just
// because the schema's foreign keys make it rare. Matches Task 5's
// original `event?`/`song?` props, which handled `undefined` the same way.
export type TakeRowContext =
  | { kind: "song"; event: TakeRowEventRef | undefined }
  /**
   * `eventKind` is the RAW kind (`concert`, `rehearsal`, …), the same string
   * `TakeRowEventRef.kind` carries, so the mapping to a displayed word happens
   * in exactly one place. It is here even though this arm shows no event —
   * the row still has to know what kind of event it is under, to suppress a
   * take label that only repeats it. Without it a take labelled "live" printed
   * "live" as its note on every row of a concert's page, directly under a
   * heading already saying so.
   *
   * Required, not optional: it is always available on the page that renders
   * this arm, and requiring it is what stops the bug coming back quietly.
   */
  | { kind: "event"; song: TakeRowSongRef | undefined; eventKind: string }
  | { kind: "full"; song: TakeRowSongRef | undefined; event: TakeRowEventRef | undefined };
