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

Two exclusions in `biome.json` are load-bearing, and neither is a licence to
add more. `packages/ui/src/tokens/components.css` is skipped because Biome
1.9's CSS parser rejects `@starting-style` and `@-moz-document url-prefix()`
— both correct, both deliberate — and one unparseable file used to abort the
whole run, which is how 16 phantom "errors" hid two real ones. `design-canvas`
is skipped because it is design scratch, not app source. Revisit the CSS one
when Biome's CSS support catches up.
