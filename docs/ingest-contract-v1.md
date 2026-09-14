# bandplate ingest API — contract v1

**Status: frozen. Implemented on both sides.** This document is the interface
between two independently built projects:

- **bandplate** (this repo) — implements the server side, under `/api/ingest/v1/`.
- **[reapertoire](https://github.com/bandplate/reapertoire)** (separate repo) —
  renders takes locally in REAPER and pushes them here.

It is a plain HTTP contract, so reapertoire is a reference client rather than a
requirement: anything that can speak what follows can feed a bandplate library.

Either side may be built first. Where this document and an implementation
disagree, this document wins until it is deliberately revised. Revisions bump the
version prefix (`/api/ingest/v1/` → `/v2/`); the server keeps serving `v1` until
every bridge has moved.

The server publishes a machine-readable OpenAPI 3.1 document at
`/api/ingest/v1/openapi.json`, generated from the same Zod schemas that validate
requests, so a typed client can be generated rather than hand-written.

---

## 1. Division of responsibility

**The bridge owns:**
- Cutting the rehearsal recording into takes (Reaper regions).
- Rendering: one lossy master mix per take, optionally one lossy stem per
  instrument, optionally a lossless master.
- Mapping messy Reaper track names (`BASS DI 2`, `OH L/R`) onto bandplate
  instrument slugs. **The server will not guess this** — see §6.
- Computing waveform peaks (cheap where the raw audio already is; expensive in a
  browser) — see §5.
- Persisting its own `clientRef` values so a re-run is idempotent — see §3.
- Retrying uploads, including refreshing expired presigned URLs.

**The server owns:**
- Identity: resolving a submitted song title to a song row, or creating a stub.
- Storage keys, presigned URLs, and checksum enforcement.
- Deciding when a take is complete enough to publish.

The bridge never talks to the object store directly except through presigned URLs
the server hands it. It never needs storage credentials.

### There is now a second front door

Since M8 a member can create songs, events and takes in the browser and upload
audio to them. That surface is **not** this contract and does not use these
endpoints — `/ingest/v1/*` stays bearer-only, closed to a session cookie.

What a bridge author needs to know about it:

- **Events and takes can exist that this contract never created.** A manual
  event carries `clientRef: null`, so `POST /events` will not match it and will
  create a second event for the same day. That is a known, accepted split with
  an admin repair in the UI ("this day is filed twice → move its takes here"),
  which hands the surviving event the bridge's `clientRef` so later pushes
  converge. The server deliberately does **not** guess a match from
  `(kind, date)`: that would silently merge an afternoon and an evening
  rehearsal, and nobody would find out.
- **A song or event you match may have been archived**, and matching it
  un-archives it — the band has evidently just played it. `POST /events` with a
  known `clientRef` and `resolveSong`'s every matching branch do this. A bridge
  needs no change; the behaviour is mentioned because it is a write on what
  looks like a read.
- **A take can exist with no assets at all.** The manual path creates the take
  first and adds audio afterwards, which this contract forbids
  (`assets` requires at least one entry). Anything reading takes must not
  assume a take has files.
- **`takes.durationMs` may already be set, measured** rather than declared —
  the browser reads it off an `<audio>` element before uploading. A re-declared
  take does not overwrite it.

---

## 2. Authentication

All ingest endpoints require a **service token**:

```
Authorization: Bearer bpk_{tokenId}_{secret}
```

Tokens are issued from the bandplate admin UI (`/admin/tokens`), carry an explicit
scope set, and are revocable. The secret is shown **once** at creation and is
stored only as a hash — if it is lost, issue a new token.

An ingest token needs `ingest:write`. That is the only scope any ingest route
checks (`requireServiceScopes("ingest:write")` on every one of them) — grant
nothing else, so a token that leaks out of a script on a laptop cannot read
votes or touch members.

Ingest requests are exempt from the browser Origin/CSRF check — they carry no
cookies and no ambient authority.

**Errors:** `401` for a missing, malformed, unknown, or revoked token. `403` when
the token is valid but lacks a required scope; the body names the missing scope.

---

## 3. Idempotency — the design assumption

Every ingest run must be safely repeatable. Rehearsals get re-rendered, uploads
die halfway, laptops sleep. Re-running the bridge over the same Reaper project
must converge on the same server state, never duplicate it.

The mechanism is a **`clientRef`**: an opaque string the bridge generates once,
persists next to the Reaper project, and reuses forever.

- `events.clientRef` — one per Reaper project. Generate a UUID on first ingest and
  write it to a sidecar file beside the `.rpp`.
- `takes.clientRef` — stable per take within a project. Prefer the Reaper region
  GUID; fall back to `{projectRef}/item-{n}` only if you must, and understand that
  reordering regions then re-identifies takes.

Both are unique server-side. Re-posting an existing `clientRef` returns the
existing row with `created: false` — it is a lookup, not an error. An event
re-post may additionally carry `updateMetadata` to correct its descriptive
fields; see §4. A take's song and instruments are never re-derived (§6).

Storage keys are derived from the take id, so a re-uploaded file **overwrites**
rather than orphaning:

```
takes/{takeId}/master/{tier}.{ext}
takes/{takeId}/stems/{instrumentSlug}/{tier}.{ext}
takes/{takeId}/peaks/master.json
takes/{takeId}/peaks/stems/{instrumentSlug}.json
```

---

## 4. The three phases

### Phase 1 — declare the event

```http
POST /api/ingest/v1/events
Content-Type: application/json

{
  "clientRef": "5e2c8f1a-...",
  "kind": "rehearsal",
  "heldAt": "2026-09-05T19:30:00+02:00",
  "venue": "Zkušebna Vysočany",
  "notes": "new tune runthroughs",
  "title": null
}
```

```json
200 { "eventId": "0192f...", "created": true }
```

Re-posting a known `clientRef` is a **lookup**: the body's other fields are
ignored and the existing row comes back with `created: false`. Send
`"updateMetadata": true` to make it a **correction** instead — `kind`,
`title`, `heldAt`, `venue` and `notes` are then written to the existing event,
and the response carries `updated: true`.

Off by default on purpose, so a bridge re-running over an old session cannot
quietly revert something a person fixed here. On, the whole record is applied:
a field omitted is **cleared**, not kept, because the bridge sends the session
as it stands and a note deleted there has to disappear here too.

`clientRef` is never touched either way. Which row the bridge writes to is
identity, not metadata.

`kind` is one of `rehearsal | concert | session`. It matters: concerts are
surfaced differently in the UI and are excluded from automatic retention culling.
Get it right at ingest rather than fixing it by hand later.

`heldAt` is an ISO-8601 timestamp **with offset**. The server stores epoch
milliseconds; the offset is how it knows what you meant.

### Phase 2 — declare a take and its assets, receive upload URLs

```http
POST /api/ingest/v1/takes

{
  "clientRef": "reaper:region-guid:{A1B2C3D4-...}",
  "eventClientRef": "5e2c8f1a-...",
  "song": {
    "externalRef": "reaper:region-guid:{A1B2C3D4-...}",
    "title": "Dub Corner",
    "createIfMissing": true
  },
  "recordedAt": "2026-09-05T20:14:33+02:00",
  "durationMs": 254300,
  "label": "take 3",
  "instruments": ["bass", "drums", "gtr-rhythm", "organ", "vox-lead"],
  "assets": [
    { "kind": "master", "tier": "lossy", "format": "opus",
      "bytes": 4103221, "sha256": "…", "durationMs": 254300,
      "sampleRate": 48000, "channels": 2 },
    { "kind": "stem", "instrument": "bass", "tier": "lossy", "format": "opus",
      "bytes": 3980112, "sha256": "…" },
    { "kind": "peaks", "tier": "lossy", "format": "json", "bytes": 4210 }
  ]
}
```

```json
200 {
  "takeId": "0192f...",
  "songId": "0192a...", "songCreated": true, "songMatch": "created-stub",
  "state": "uploading",
  "uploads": [
    { "assetId": "0192b…", "kind": "master", "instrument": null, "tier": "lossy",
      "storageKey": "takes/0192f…/master/lossy.opus",
      "status": "pending",
      "method": "PUT",
      "url": "https://…?X-Amz-Signature=…",
      "headers": { "Content-Type": "audio/ogg", "x-amz-checksum-sha256": "…" },
      "expiresAt": "2026-09-05T21:14:00Z" },
    { "assetId": "0192c…", "kind": "stem", "instrument": "bass",
      "status": "ready" }
  ]
}
```

**`instruments`** is what was *played and captured* on this take. It is the
filter axis in the UI ("every take with horns on it") and is deliberately
**not** the same as which stems exist — a take can capture the whole band in the
master mix and have isolated files for only three players.

**`sha256` is optional** on every asset, including `peaks`. Send it whenever
you have it — it's the strongest retry/corruption signal the server has (see
below) — but a bridge that genuinely cannot compute it can omit it; the
server then matches a retry on `bytes` alone. **`tier` on `peaks` is
optional too**, defaulting to `"lossy"`; the examples in this document always
send both, which is the recommended shape, not a hard requirement.

**Retry semantics.** Re-posting the same `takes.clientRef` returns the existing
take with freshly signed URLs. Per asset:
- declared `bytes` match a row already `ready`, **and** either `sha256` was
  omitted or it matches too → returned as `status: "ready"` with **no** `url`;
  skip it.
- `bytes` or `sha256` differ from what's on the row → the slot resets to
  `pending` and a new URL is issued.
- for a `master`/`stem`, a **different `format`** also forces a reset, even if
  `bytes`/`sha256` happen to coincide — the upload then goes to a **new**
  storage key (the extension is part of the key), and the server deletes the
  superseded object so the take never ends up with two masters.
- for `peaks` specifically, a **different `tier`** updates the existing row's
  metadata in place; `peaks`' storage key never varies by tier, so this never
  moves the object or creates a second row.
- otherwise (same key, hash mismatch) the upload overwrites the same key.

This is what lets a bridge crash mid-session and resume without re-uploading
gigabytes.

**Upload.** `PUT` the bytes to `url` with exactly the `headers` given. The
`x-amz-checksum-sha256` header makes the object store itself reject a corrupt
upload, so corruption surfaces at upload time rather than at playback.

**Expiry.** Presigned PUT URLs live **1 hour**. A slow uplink pushing an entire
session will outlive that — on `403`, re-POST the take (or
`GET /api/ingest/v1/takes/{takeId}/uploads`) for fresh URLs and continue. Treat
this as normal operation, not an error path.

**Size.** Single `PUT` only; no multipart in v1. Files are expected in the tens of
MB, far below the 5 GB single-PUT ceiling. If lossless multitrack masters ever
push past ~200 MB on a flaky uplink, multipart is a documented extension:
`POST /api/ingest/v1/assets/{id}/multipart` returning per-part URLs plus a
complete endpoint. Not implemented in v1.

### Phase 3 — commit

```http
POST /api/ingest/v1/takes/{takeId}/commit
{ "publish": true }
```

```json
200 { "takeId": "…", "state": "published",
      "assets": [ { "assetId": "…", "status": "ready", "bytes": 4103221 } ] }
```

```json
409 { "code": "assets_incomplete",
      "missing": [ { "assetId": "…", "storageKey": "…" } ] }
```

The server `HEAD`s every pending key, compares content-length against what was
declared, flips matching assets to `ready`, enforces that **at least one** master
or stem exists, and publishes. `publish: false` leaves the take in `new` — use
that if you want to review before the band sees it.

Committing an already-published take is a no-op returning `200` — it does not
un-publish or re-run the incomplete-assets check. It **does** still `HEAD`
any not-yet-`ready` asset first, so a take re-declared with a changed hash
(§3/§4 — the band re-rendered the master) converges back to fully playable
once the new bytes are uploaded and commit is called again, even though the
take was already published the whole time. Commit is safe to retry.

---

## 5. Waveform peaks

Send a `kind: "peaks"` asset: JSON, a single array of **1000 integers in the
range -128..127**, representing min/max-folded amplitude across the take. The
file is the bare array -- not an object wrapping one.

A waveform describes **one source**, so a peaks asset carries the same
`instrument` field a stem does: omit it for the take's master, or name a stem's
slug for that stem's own shape. The slug is validated against the vocabulary
like any other. One take may therefore hold several peaks assets, one per
source; they occupy separate slots and separate storage keys
(`takes/{takeId}/peaks/master.json`, `takes/{takeId}/peaks/stems/{slug}.json`).
Sending only the master's is fine -- a source with no waveform simply draws
without one.

The bridge already has the decoded audio, so this costs it almost nothing. A
browser computing the same thing would have to download and decode the whole
file. The slot exists in v1 even though the UI may render a plain progress bar at
first — retrofitting it later would mean re-running the bridge across the entire
back catalogue.

---

## 6. Song identity

Resolution order, first match wins:

1. `song.externalRef` matches a stored alias → that song. Most stable: it survives
   the band renaming the tune. Always send it if you have a region GUID.
2. Normalized `song.title` matches a song's normalized title → that song, **and**
   the `externalRef` is recorded as a new alias so future ingests hit case 1.
3. Normalized `song.title` matches an existing alias → that song.
4. No match and `createIfMissing: true` → a **stub song** is created
   (`songMatch: "created-stub"`), flagged in the UI as needing tempo, key, chords
   and lyrics filled in by a human.
5. No match and `createIfMissing: false` → `409 song_not_found` with fuzzy
   candidates, so the bridge can prompt.

A sixth value, `songMatch: "existing"`, is returned whenever `takes.clientRef`
already matched an existing take (§3/§4's retry path) — song identity is
resolved **once**, on a take's first successful declaration, and never
re-derived from a later retry's `song` object even if it differs. This is the
dominant case in practice: every re-POST of an already-declared take (fresh
upload URLs, a changed-hash re-upload, a plain retry) reports `"existing"`,
not `"created-stub"` — that only fires once, on the take's first declaration.

Normalization lowercases, strips diacritics (NFKD — this matters for Czech:
`Přítel` → `pritel`), collapses whitespace, and strips a trailing take/version
suffix (`(take 3)`, `[take 12]`, `- take 2`).

---

## 7. Instrument vocabulary

`instruments` and each stem's `instrument` are **slugs from the server's
vocabulary**, which an admin manages in the bandplate UI.

`GET /api/ingest/v1/instruments` returns the live list — use it to build the
bridge's mapping UI rather than hardcoding.

An unknown slug is rejected with `422` listing the valid ones. This is the
default and it is deliberate: Reaper track names are messy, and letting
`BASS DI 2` silently become a new instrument would corrupt the filter
vocabulary within one rehearsal. Ship a user-editable mapping file (Reaper
track name → bandplate slug) in the bridge.

**`createMissingInstruments: true`** on the take declaration opts out of that
refusal, the same way `song.createIfMissing` does for songs (§6 case 4). Each
unrecognised slug becomes a **stub instrument**: the slug as given, a label
derived from it (`drums-subkick` → `Drums Subkick`), no icon, no colour, and
a flag that marks it unfinished in the admin UI until a human writes a real
label and picks the rest. The response lists what it created:

```json
{ "takeId": "...", "songMatch": "created-stub", "createdInstruments": ["melodica"] }
```

`createdInstruments` is always present and is `[]` on the ordinary run. Watch
it: a slug appearing there that nobody meant to add is a mapping file that has
drifted, and it is far cheaper to see that on the run that caused it than as a
strange row in the admin table weeks later.

The stub is what makes this safe rather than the refusal — an auto-created row
arrives visibly unfinished instead of posing as curated vocabulary. A bridge
that ships a mapping file should still leave the flag off and keep the 422.

**Aliases.** An instrument can carry additional slugs, managed in the admin UI,
and ingest resolves those exactly as it resolves the instrument's own. Two uses,
which are one use from opposite ends: a session that names a track `gtr2` keeps
working without anyone editing a mapping file, and an instrument merged into
another leaves its slug behind so the next run resolves it rather than
re-creating the row the merge removed.

Aliases resolve but are **not advertised**: `GET /api/ingest/v1/instruments` and
a `422`'s `validSlugs` both list canonical slugs only. An alias exists to keep an
older bridge working, not to become a second vocabulary to build against. An
alias of an *archived* instrument does not resolve at all — archiving means "not
a choice for new takes", and an alias must not be a side door around that.

An admin can also **merge** one instrument into another, which moves everything
that referenced it and leaves its slug behind as an alias. That last part is
what a bridge cares about: a slug your session has always sent keeps resolving
after the band tidies its vocabulary, and no run has to be reconfigured.

---

## 8. Other endpoints

- `GET /api/ingest/v1/instruments` — live vocabulary (see §7).
- `GET /api/ingest/v1/takes/{takeId}/uploads` — fresh presigned URLs for any
  still-pending assets, without re-declaring the take.
- `DELETE /api/ingest/v1/takes/{takeId}` — undo a mistaken push. Permitted only
  while `state` is `uploading` or `new`; a published take must be rejected through
  the UI instead.

---

## 9. Errors

All errors are `{ "error": { "code": "...", "message": "..." } }`, except `409`
responses which carry extra structured context alongside (`missing`,
`candidates`).

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed request, e.g. a missing `takeId` path parameter |
| 401 | `unauthorized` | Missing, malformed, unknown, or revoked token |
| 403 | `forbidden` | Valid token, missing scope (names the scope) |
| 404 | `event_not_found` | `takes.eventClientRef` doesn't match a declared event; `POST /events` first |
| 404 | `not_found` | No take with the given id (`GET .../uploads`, `POST .../commit`, `DELETE`) |
| 409 | `song_not_found` | No match and `createIfMissing: false`; lists candidates |
| 409 | `assets_incomplete` | Commit before all assets uploaded; lists missing |
| 409 | `take_not_deletable` | `DELETE` on a take that isn't `uploading` or `new`; reject a published take through the UI instead |
| 422 | `unknown_instrument` | Slug not in vocabulary; lists valid slugs |
| 422 | `validation_failed` | Body failed schema validation |

There is no rate limiting on the ingest surface in v1 — no `429` is returned.
A future revision may add one; don't build retry-on-429 handling around a
code that doesn't exist yet.

---

## 10. Recommended bridge sequence

```
for each Reaper project:
  POST /events                     (idempotent on clientRef)
  for each region:
    POST /takes                    (idempotent; returns per-asset status)
    for each upload with status=pending:
      PUT bytes to its presigned url
      on 403 → re-POST /takes for fresh urls, continue
    POST /takes/{id}/commit
```

Every step is safe to repeat. A bridge that crashes anywhere and restarts from
the top converges on the same state without duplicating a row or re-uploading a
completed file.
