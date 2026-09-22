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

### A link that opens a sheet needs the CAPTURE phase

`<ClientRouter />` listens for clicks on `document` too, and it decides
whether to navigate by reading `event.defaultPrevented` when its own listener
runs. Two bubble-phase listeners on the same node run in registration order,
which is bundling order, which is not yours to pick: the sheet opened, and
half a second later the router swapped the page out from under it. It looks
like the sheet "flashed".

So a delegated handler that has to WIN against the router registers with
`{capture: true}` — `RecordSheet.astro`'s does, and `ConfirmDialog.tsx`'s
always did. Only then is `preventDefault()` set before the router looks.

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

### A script tag written inside a frontmatter comment

Vite's dependency scan finds `<script>` in an `.astro` file with a regex, not
a parser, so a `// see the <script> below` in the frontmatter opens a "script"
there and esbuild parses the rest of the comment as JS. The dev server logs
`Failed to scan for dependencies … Expected ";"` pointing at a line of
English, and the page still works, so it reads as noise. Name the script in
words ("the inline script below") instead of writing the tag.

---

## "The typechecker is green and the page is 500"

### `astro check` does not parse `.astro` templates the way the renderer does

An unbalanced tag in a template — a `</div>` lost while moving a block — passed
`astro check` cleanly and threw `Expected ")" but found "}"` at request time.
The reported line is where the surrounding *expression* began, which can be two
hundred lines above the actual damage.

**Rule.** `pnpm typecheck` is not evidence that a page renders. Load it. If the
dev server's console is not in reach, a throwaway one puts the real message in
a file you can read:

```bash
cd apps/web && pnpm exec astro dev --port 4455 > /tmp/probe.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4455/the/page
grep -iA 12 error /tmp/probe.log
```

A 500 on one route while its siblings 302 means the module failed, not the
request — look for a syntax error, not a data problem.

---

## "I checked the DOM and the attribute is missing"

### Check that you selected the element you think you did

`input[name="slug"]` matched the page's *create* form long before it reached
the alias field further down, and reported the placeholder missing on an
element that never had one. Select by something unique to the thing under test
(`input[id^="alias-"]`) before concluding the code is wrong.

---

## "It looks like a modal that lost its backdrop"

### Every confirm in this app is a modal. The page is only the no-JS path

`ConfirmActionPage` draws a bare page — no nav, no header — and that is
correct, because with script **nobody ever sees it**: `ConfirmDialog`
intercepts the `data-confirm` trigger in the capture phase and opens the
dialog instead. Landing on that page with script enabled means the
interception did not happen, and the page will look like a modal that lost
its backdrop, because that is effectively what it is.

So the fix is never "make the page prettier" or "put the page in the shell".
The fix is to make the trigger a real `data-confirm` trigger.

**When the consequence is computed on the server** — merging two instruments
has to look at what the pair share before it can name the chord chart and the
audio file that will not survive — the dialog fetches it:

- `data-confirm-body-url` — fetched with `accept: application/json` on open,
  answering `{title?, body?, details?}`. The dialog opens immediately with a
  loading line rather than waiting on the round trip.
- `data-confirm-query-from` — a selector for a control whose `name=value` is
  appended to both the action and the body URL, for an action whose target is
  chosen after the page renders (a picker beside the button).

The same route serves both: JSON for the dialog, the bare page for no-JS.
`/admin/instruments/[id]/merge` is the worked example.

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

### D1 refuses more than 100 bound parameters; local libSQL takes 32,766

Same shape as the foreign keys above, the other way round: here the harness
is MORE lenient than production. `inArray(takes.id, ids)` binds one parameter
per id, so a batch lookup keyed by a list page's rows is fine in every test
and on the dev server, and on D1 the statement is rejected and the page is a
500. It went unnoticed while lists stopped at 25 rows; "load more" grows them
to 200, and `/takes?shown=100` would have been the first page to fall over.

**Rule.** Any `inArray` over a caller-sized list goes through `chunk()`
(`packages/db/src/repos/chunk.ts`), sized so the WHOLE statement stays at or
under 100: the ids plus every other value it binds. `bandTakeCondition()`
binds one (`'band'`), a `kind`/`status` filter binds one each, a member id
binds one. Export the chunk's query builder and pin the size with a
`.toSQL().params.length` test (`batch-param-limit.test.ts`); a comment
counting parameters has been wrong before.

**How to catch it.** A green run proves nothing, so watch what is bound:
`take-context.test.ts` wraps the libSQL client's `execute` and asserts no
statement carried more than 100 args while a 200-row page was assembled.

### In a D1 batch, two result columns with the same name become one

Pages send their reads as one `db.batch` (`packages/db/src/read.ts`), because
every D1 call from the Worker is a network round trip. Inside a batch D1
returns each row as an OBJECT keyed by column name, and Drizzle turns it back
into an array with `Object.keys`. A statement whose result has two columns of
the same name (`select().from(votes).innerJoin(takes, ...)` has two
`created_at`) keeps one of them, and every field after it maps off by one.
libSQL returns arrays and gets it right, and so does D1 outside a batch, so
the query works everywhere except in production's batch.

**Rule.** A batched statement selects one table's columns (a join is fine when
it selects only one side, like `select({ take: takes })`), or aliases. To
fetch votes with their takes, `/me` asks for the takes by a subquery of the
vote page's ids instead of joining.

The same object reorders a column named only by digits (an unaliased
`sql\`1\``): integer-like keys come first in `Object.keys`. And a relational
query (`db.query.x.findFirst()`) that matches no row crashes Drizzle's D1
batch mapper, so planned reads refuse relational queries outright.

**How to catch it.** `createTestDb`'s client refuses a batch whose result
repeats a column name or has an all-digit one, and `readOne`/`readAll` reject
a relational query at the type level and at run time.

### A drizzle-kit table rebuild silently drops a hand-added index

SQLite cannot alter a column in place, so a change like "make `takes.song_id`
nullable" makes `drizzle-kit generate` emit the 12-step rebuild: create
`__new_takes`, copy every row, `DROP TABLE takes`, rename. The rebuild is
correct — the rows survive — and it ends by recreating the indexes.

It recreates **the indexes drizzle-kit knows about**, which is the ones in the
snapshot, which is the ones expressible in the schema DSL.
`takes_push_pending_idx` is not one of them. It is a **partial** index,
hand-written into `0009_push_notifications.sql`:

```sql
CREATE INDEX `takes_push_pending_idx` ON `takes` (`event_id`,`published_at`)
  WHERE `push_batched_at` IS NULL AND `published_at` IS NOT NULL;
```

`DROP TABLE` takes it with the table, the generator has never heard of it, and
nothing puts it back. Nothing fails: the migration applies, every test passes,
and `notificationsRepo.listPendingTakeBatches` quietly goes back to scanning
the whole table.

**How it was caught.** By reading the generated SQL against `sqlite_master`
rather than trusting it: `takes` carries **seven** indexes after the stash
migration, and the generated file's `CREATE INDEX` lines numbered **six**.
`createTestDb()` cannot show this — it migrates an EMPTY database in one run,
so "the schema afterwards" is whatever the last migration built, never "what
the previous one built and this one lost".

**Rule.** Any migration that rebuilds a table re-adds every raw index by hand,
and says in its header comment that it had to. The test that pins it is
`migration-0010-stash.test.ts`: it runs 0000→0009 on a POPULATED database,
snapshots `select name from sqlite_master where tbl_name = 'takes'`, runs the
rebuild, and asserts every index is still there — plus that the partial index
still carries its `WHERE` clause, since a same-named index over the same
columns without it is a different index.

The general shape: after a rebuild, compare the whole row set (`select *`
before and after) and the whole index set, not the one column you changed.

---

## "It recorded fine and the player says 0:00"

### Chrome's MediaRecorder writes a WebM with no duration

The header has no Duration element, so `<audio>.duration` is `Infinity`, the
player's seek bar is disabled and its time reads 0:00, even though the file
plays. The recorder writes the measured length in with `fix-webm-duration`
before the blob is kept (`Recorder.tsx`, `needsDurationFix`). A WebM that
reaches the stash without going through that path (a file dropped onto the
upload panel) keeps the problem.

### A private take is invisible by construction, not by the page

`takes.visibility = 'private'` is filtered in SQL by every listing, count and
aggregate, each using one of the two conditions in
`packages/db/src/repos/take-visibility.ts` (`bandTakeCondition`,
`stashTakeCondition`) — with one documented exception: the votable/notify
filter (`takes.ts`'s `votableCondition`, the pending-batch queries in
`notifications.ts`) uses `owner_member_id IS NULL` instead, which is
equivalent only because a private take always has an owner — see
`take-visibility.ts`'s module comment. `stash-privacy.test.ts` calls every
exported read of the repos that touch `takes`, and fails on a new export
until someone classifies it, so a new listing cannot ship unchecked. Every
lookup BY ID asks `takesRepo.isVisibleTo` instead, and that half has no such
guard: a new route or loader that resolves a take by id and skips that call
leaks somebody's stash, and nothing else will fail. Grep for
`takesRepo.getById(` in the change and check each one.

---

## "Every page got slow, or the dev server died mid-session"

### A barrel import loads the whole icon set on every SSR request

`import { Calendar } from "@lucide/astro"` type-checks, works, and is the
obvious way to write it. It is also a barrel: importing anything from
`@lucide/astro`'s root pulls in all ~1,600 icon modules, and under SSR that
happens again on every request, not once at build time — about 1.5s added
per page load in dev, and the same cost baked into the server bundle in
production. Nothing errors. The page just gets slow, and "slow" doesn't
point at an import statement.

Import each icon from its own path instead, which pulls in only that icon:

```ts
import Calendar from "@lucide/astro/icons/calendar";
```

Same rule for `lucide-preact` in island components. See `NavIcon.astro` and
`Recorder.tsx` for the pattern across both.

### A dependency Vite discovers late re-optimizes mid-session and kills every island

Vite's dependency pre-bundling runs once at startup, against whatever it can
see from the entry points at that moment. A dependency that's only reached
from inside a Preact island (rather than anything imported at the top level)
can go undiscovered until the first request that actually renders that
island. When Vite finds it then, it re-optimizes and restarts its
dep-serving mid-session. Every island already on the page fails at once with
`504 Outdated Optimize Dep`, because the module graph they were served
against no longer matches what the server now has.

List the dependency in `optimizeDeps.include` in `astro.config.mjs` so it's
found up front instead of discovered late (see the `lucide-preact` entry
there, added for exactly this). If you hit the 504 before that fix lands,
`pnpm exec astro dev --force` clears the stale cache and recovers — no code
change needed, just the flag.
