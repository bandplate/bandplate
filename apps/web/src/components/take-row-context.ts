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
  | { kind: "event"; song: TakeRowSongRef | undefined }
  | { kind: "full"; song: TakeRowSongRef | undefined; event: TakeRowEventRef | undefined };
