# Traps

Things in this stack that fail **silently**: the markup ships, the build is
green, the test suite passes, and the thing simply does not work. Every entry
here cost someone real time. They are grouped by what they look like when you
hit them, because that is how you will arrive.

The common thread: **a string in the response is not proof of anything.**
`grep` tells you what the server sent; it cannot tell you what the browser
built, what the parser kept, or what CSS accepted. Check the parsed DOM and
the computed style.

---

## "The control is there and pressing it does nothing"

### A `<form>` inside a `<form>` is dropped by the HTML parser

Not an error. Not a warning. The nested form never enters the DOM, so its
submit button belongs to the *outer* form — or to nothing — and the press
either does the wrong thing or does nothing.

This bites hardest in a `RecordSheet`, where the whole body is one big edit
form and it is natural to drop a second little form inside it.

**Rule.** Anything that is its own submission goes *outside*, and the control
references it by id:

```astro
<form method="post" id={`drop-alias-${alias.id}`} class="bp-sheet-aux">
  <input type="hidden" name="intent" value="remove-alias" />
</form>
...
<button type="submit" form={`drop-alias-${alias.id}`}>&times;</button>
```

**How to catch it.** `html.includes('bp-merge-form')` said present;
`new DOMParser().parseFromString(html, 'text/html').querySelector('.bp-merge-form')`
said absent. Only the second is the truth.

---

## "My CSS declaration is just... gone"

### A double-quoted font stack inside `style=""` closes the attribute

```html
<!-- everything after `font-family:` is discarded -->
<a style='...;font-family:"Chivo", Helvetica;font-weight:600;background:#eee;'>
```

The first `"` inside the value ends the attribute. The element renders with
whatever came *before* the font — so a styled button falls back to a bare
link. Use single quotes for font names inside inline styles.

### `min()` and `max()` take lengths, not keywords

`min-width: min(100%, max-content)` is not CSS. The declaration is dropped and
the property keeps its old value, so the layout behaves exactly as it did
before your "fix" — which reads like the rule never applied, not like it was
invalid.

### `flex-wrap: wrap` will not wrap an item that can shrink to zero

A flex line breaks on each item's *hypothetical* size. An item with
`flex: 1; min-width: 0` can always shrink, so the row never wraps — it just
squeezes, and your heading breaks across three lines instead.

Give the item a floor it can state: `flex-basis: max-content` (with
`min-width: 0` left alone, so it still wraps its own text once it is alone on
a line) rather than a fixed `min-width`, which is only ever right for one
string.

---

## "It built fine and then threw at runtime"

### `export { X } from "./x.js"` does not bind `X` locally

It re-exports. Code *in the same module* that uses `X` sees an undefined
identifier, and `astro check` reported zero errors while the page threw
`ReferenceError`. Import it and re-export separately:

```ts
import { MIN_MIXER_STEMS } from "../../client/mixer-tracks.js";
export { MIN_MIXER_STEMS };
```

---

## "The comment broke the page"

### `{/* … */}` is not valid between attributes

It is valid in children position. In an attribute list it is a parse error —
and the message you get points at the element's *closing* tag with
"Unterminated string literal", which is nowhere near the problem.

Put the explanation above the element, or compute the value in frontmatter
with the comment beside it. The second is usually better anyway.

---

## "It looks like a modal that lost its backdrop"

### A confirm page reached on purpose must render inside the shell

`ConfirmActionPage` defaults to a bare page with no nav and no header. That is
correct for what it was built for: a **no-JS fallback** that nobody with
script ever reaches, because `ConfirmDialog` intercepts the `data-confirm`
trigger first.

A confirm page that is the **primary path** — one whose consequence has to be
computed on the server, so it cannot be a static `data-confirm-body` string —
must pass `inShell` and render inside `AppLayout`. Otherwise the reader clicks
a button and lands on a card floating in the dark.

`/admin/instruments/[id]/merge` is the one that is primary, and why: it lists
the charts and audio files the merge would destroy.

---

## "The test passes but production is broken"

### `createTestDb()` turns foreign keys ON; production and D1 do not

`PRAGMA foreign_keys` is deliberately off in the real database so behaviour
matches D1, which does not enforce them either. The test harness is
**stricter** than the thing it tests.

So a green test can never be your evidence that an orphan case is handled. A
delete that would orphan rows is *refused by the harness* and *accepted in
production*. The guard has to be in code — count the references and re-check
them at the moment of writing — and that is what `deleteInstrument` and
`instrumentsRepo.remove` do.

The same applies to every `ON DELETE cascade` in the schema: it is
documentation, not behaviour. Delete dependent rows explicitly.
