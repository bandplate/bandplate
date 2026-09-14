# Working in this repo

## Read this first

**[`docs/frontend-traps.md`](docs/frontend-traps.md)** — things in this stack
that fail silently: a nested `<form>` the parser drops, an inline style that
swallows its own declarations, a re-export that type-checks and throws, a test
harness stricter than production. Every entry cost someone real time. Check it
before debugging anything that "should obviously work".

## Verifying UI

**A string in the response is not proof.** `grep` shows what the server sent;
it cannot show what the parser kept or what CSS accepted. Check the parsed DOM
(`DOMParser`, or the running page) and the computed style. Two bugs in one
afternoon looked fine in the HTML and were absent from the DOM.

## Conventions worth knowing before you write

- **Decidable logic lives in pure `.ts` modules** with node-only vitest tests;
  DOM and audio side effects live in the `.tsx`. There is no jsdom in this
  repo, so logic left in a component is logic nothing can check. See
  `apps/web/src/client/player-actions.ts`'s own header.
- **Foreign keys are never enforced** (`PRAGMA foreign_keys` stays off, to
  match D1). `ON DELETE cascade` in the schema is documentation. Delete
  dependent rows explicitly, as `songsRepo.remove` and `takesRepo.remove` do.
- **Both locales in the same commit.** The parity test fails the build
  otherwise, so there is no "translate it later". A new function key needs a
  `FIXTURES` entry; anything identical in Czech needs `IDENTICAL_IS_FINE` with
  a reason. See `docs/i18n.md`.
- **Mono type means "a computer reads this"** — chord charts and machine
  strings only. Timecode is Chivo with `tabular-nums`.
- **No fake affordances.** A control that cannot work is not rendered; the
  page says what is in the way instead.

## The gate

`pnpm typecheck && pnpm lint && pnpm test` before every commit. Lint has a
known baseline of **18** pre-existing errors — match it, do not "fix" it as a
side effect of unrelated work.
