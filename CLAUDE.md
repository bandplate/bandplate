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

## Design system

The code is the source of truth: `packages/ui/src/tokens/dubplate.css` (the
palette and the roles), `theme.css` (the type scale) and `components.css`.
There is also a Claude Design System artifact built from them, **"Bandplate —
Dubplate"** (<https://claude.ai/artifact/RZMkRozzyQpdgCL6pfknpi>), with the
tokens, the brand book and previews of the real components. It is the
maintainer's and private: the link opens only for those it is shared with.
Where it opens, use it for design canvases instead of copying hexes by hand.

It does not update itself. When a change touches the tokens or a component's
look, say so, so it can be re-synced; a system that has drifted from the code
is worse than none.

Two rules that the last clean-up bought: **one name per colour** (a palette
value says what a colour is, a `--bp-color-*` role says what it is for, and a
feature does not mint a near-copy of an existing colour), and **two button
sizes** (`bp-btn-sm` 44px in a page's body, `bp-btn-xs` 32px in the header
tier; there is no separate pill).

## Writing copy (and Czech especially)

**The em dash is not a clause splice.** An LLM reaches for `—` to weld two
sentences together, and it is the single loudest tell that a string was
generated rather than written. Almost always the sentence wanted a full stop,
sometimes a comma, occasionally a colon:

```
Zatím žádní členové — přidej prvního nahoře.     ->  ... členové. Přidej ...
Který pokus to byl — třetí, s dechy.             ->  Který pokus to byl: třetí ...
... hráli dvakrát — ale jestli je to ta samá     ->  ... dvakrát, ale jestli ...
Bez ikony — zobrazí se iniciály                  ->  Bez ikony se zobrazí iniciály
```

`—` **is** correct as a typographic separator, and those stay: a title join
(`Správa — Členové`, `Hraje: ${title} — ${source}`), a fragment appended to a
legend (`Nástroje — všechny naráz`), and the lone `—` that means "no value".
The test is simple: if you can replace it with a full stop and the text reads
better, it was a splice.

**Czech is tykání, everywhere.** `nahrajte`, `zkuste`, `vaše` are the register
slipping into vykání, which is the default an LLM falls back to. Every
imperative is second person singular: *nahraj*, *zkus*, *tvoje*.

**Do not translate the English shape.** `That tempo looks wrong` became
`Tohle tempo nevypadá dobře`, which is English wearing Czech words — a number
does not "look" anything. `Takové tempo nedává smysl.` Same for
`nevypadal dobře` about a form submission: `Tomu výběru nerozumím.`

Other tells worth checking before you add a string: `prosím` (the app never
begs), `jednoduše` / `prostě` / `zkrátka` as filler, `zde` where `tady` is the
register, `je možné / je potřeba` where a plain verb does the work, and
exclamation marks.

To audit: strip trailing `//` comments, then look at what is left inside the
quotes. The `// en:` echo lines legitimately keep the English punctuation, so
a naive `grep "—"` over `cs/` is mostly false positives. The longer version of
this, with the glossary and the plural rules, is in
[`docs/i18n.md`](docs/i18n.md).

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

`pnpm typecheck && pnpm lint && pnpm test` before every commit. **All three
exit 0.** There is no error baseline to match any more; a lint error is a
lint error.

One exclusion in `biome.json` is load-bearing, and it is not a licence to add
more. `design-canvas` is skipped because it is design scratch, not app
source.

Biome 2's CSS parser (`css.parser.tailwindDirectives: true` handles
`@theme`/`@custom-variant`) parses `@starting-style` and
`@-moz-document url-prefix()` cleanly, so `packages/ui/src/tokens/*.css` is
fully linted and formatted now; the file-wide exclusion that used to cover
`components.css` under Biome 1.9 is gone. `components.css` itself is now
just an ordered list of `@import`s into `packages/ui/src/tokens/components/`
(one file per component family, numbered so the order — which is the
cascade order — stays obvious; see that directory's own files rather than
one 9,500-line one). Three rules stay off across that directory, via a
rule-scoped override rather than a blanket one: `noDescendingSpecificity`
(the files are organized by component, not by cascade order — enforcing
ascending specificity would mean reshuffling for no behavior change),
`noDuplicateProperties` (the repeated `min-height: 100vh` / `100dvh` pairs
are a deliberate older-browser fallback, not a mistake), and
`noImportantStyles` (the `prefers-reduced-motion` block's `!important` is
what makes the override win regardless of what else targets the same
element).
