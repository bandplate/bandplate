// The one thing the type system cannot tell you: whether the Czech is Czech.
//
// `satisfies` catches a missing key, an extra key and a function whose arity
// has drifted — all of it free, at `pnpm typecheck`. What it cannot catch is
// the commonest failure of a hand-written catalog: somebody adds an English
// key, copies the block into `cs/` to make the types pass, and never comes
// back. That entry typechecks perfectly and renders English at a Czech reader.
//
// So: walk every leaf of the English catalog and assert the Czech one differs.
// Function-valued entries are INVOKED with a fixed fixture and their outputs
// compared, which also exercises the plural branches.
//
// The allowlist is for words that are genuinely the same in both languages —
// loanwords, symbols, the empty string. It is deliberately explicit: adding to
// it is a decision somebody makes on purpose, not something a copy-paste can
// do by accident.
import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../locale.js";
import { messages } from "./index.js";

/**
 * Paths whose value is allowed to be identical across languages.
 *
 * Dotted, from the area down: `"voting.tally"` and so on. Every entry needs a
 * reason beside it.
 */
const IDENTICAL_IS_FINE = new Set<string>([
  // The empty-tally case is "" in every language — an unvoted take renders
  // nothing at all. See `en/voting.ts`.
  "voting.tally(unvoted)",
  // A song's title and a duration, joined by a comma. Neither half is words
  // to translate, and a comma is a comma.
  "stash.songAndLength(t)",
  // The bootstrap token is called that in both languages — it is the name of
  // an environment variable the deployer already typed.
  "auth.setupTokenLabel",
  // An em dash is an em dash.
  "me.ledgerNoAnswer",
  // Developer vocabulary the person reading this screen already uses: they
  // set up the server. Same word in Czech.
  "admin.colSlug",
  "admin.colRole",
  // The button glyphs every DAW in the country uses. Translating M and S
  // would make the mixer harder to read for the people it is built for.
  "mixer.muteShort",
  "mixer.soloShort",
  // A track colour named after the dye. Czech writes it the same way, and
  // inventing "modrofialová" to avoid an identical string would name the
  // colour worse in order to satisfy a test.
  "admin.trackColor.indigo",
  // An event kind this map has never heard of passes straight through in
  // every language — that is the point. See `en/events.ts`.
  "events.kindLabel(unknown)",
  // A date and a running time joined by a comma: the date is already in the
  // reader's language, and a comma is a comma.
  "home.stashLatestWhen(parts)",
  // With nothing left to vote on, the line is just the take count, which the
  // caller already rendered in the reader's language.
  "home.newTakesLine(voted)",
  // An event plate's name is already its own label plus its own count —
  // there is no English word in it to translate.
  "home.plateEventName(parts)",
  // "bpm" is the same symbol in both languages, and the number is the value.
  "songs.bpm(n)",
  // "Tempo" is the same word in Czech.
  "songs.tempoLabel",
  // The word every studio in the country uses for the file. The player says
  // it beside "stopa" for the stems, which is translated.
  "takes.masterLabel",
  // Same word in a Czech studio, and the player says it beside "stopa".
  "player.master",
  // The wordmark, unchanged in any language.
  // Same in a Czech studio, and the chord example is chords.
  "islands.uploadMaster",
  "islands.chartChordsPlaceholder",
  "takes.masterMix",
]);

/** Arguments to call a function-valued entry with, keyed by its dotted path. */
const FIXTURES: Record<string, { label: string; args: unknown[] }[]> = {
  "admin.revokedCount": [
    { label: "one", args: [1] },
    { label: "many", args: [7] },
  ],
  "auth.slowLede": [{ label: "seconds", args: ["45"] }],
  "mixer.pageTitle": [{ label: "take", args: ["Čoudy"] }],
  "stash.songSectionCount": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "many", args: [5] },
  ],
  "stash.recordFor": [{ label: "t", args: ["Čoudy"] }],
  "stash.pageTitle": [{ label: "t", args: ["Čoudy"] }],
  "stash.songAndLength": [{ label: "t", args: ["Čoudy", "2:47"] }],
  "stash.personalEvent": [{ label: "d", args: ["19. 9. 2026"] }],
  "stash.deleteTitle": [{ label: "t", args: ["Čoudy"] }],
  "mixer.mute": [{ label: "i", args: ["Bass"] }],
  "mixer.unmute": [{ label: "i", args: ["Bass"] }],
  "mixer.solo": [{ label: "i", args: ["Bass"] }],
  "mixer.unsolo": [{ label: "i", args: ["Bass"] }],
  "mixer.volume": [{ label: "i", args: ["Bass"] }],
  "mixer.trackFailed": [{ label: "i", args: ["Bass"] }],
  "mixer.onlyInMaster": [{ label: "list", args: ["Sax, Organ"] }],
  "admin.showArchived": [{ label: "count", args: [3] }],
  "admin.deleteInstrumentBody": [{ label: "label", args: ["Melodica"] }],
  "admin.instrumentInUse": [{ label: "parts", args: ["takes (3)"] }],
  "admin.removeAlias": [{ label: "slug", args: ["bass-di-2"] }],
  "admin.aliasTaken": [{ label: "label", args: ["Bass"] }],
  "admin.mergeConfirmTitle": [{ label: "pair", args: ["Gtr2", "Guitar"] }],
  "admin.mergeBody": [{ label: "pair", args: ["Gtr2", "Guitar"] }],
  "admin.mergeLosesChart": [{ label: "song", args: ["Čoudy"] }],
  "admin.mergeLosesStem": [{ label: "song", args: ["Čoudy", "27. 8. 2026"] }],
  "mixer.loopRegion": [{ label: "range", args: ["0:12", "0:34"] }],
  // Every Czech plural class, because "stopa/stopy/stop" is exactly the kind
  // of thing that gets one form and is never looked at again.
  "mixer.stemCount": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "other", args: [7] },
  ],
  "events.kindLabel": [
    { label: "rehearsal", args: ["rehearsal"] },
    { label: "concert", args: ["concert"] },
    { label: "session", args: ["session"] },
    { label: "personal", args: ["personal"] },
    { label: "unknown", args: ["jam"] },
  ],
  "events.personalOf": [{ label: "owner", args: ["Filip"] }],
  "events.takeCount": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "other", args: [7] },
  ],
  "events.takesInOrder": [
    { label: "one", args: [1] },
    { label: "other", args: [7] },
  ],
  "events.unarchiveConfirmTitle": [
    { label: "p", args: [{ kind: "rehearsal", date: "8 July 2026" }] },
  ],
  "events.archiveConfirmTitle": [
    { label: "p", args: [{ kind: "rehearsal", date: "8 July 2026" }] },
  ],
  "events.archiveConfirmWhat": [{ label: "p", args: [{ kind: "rehearsal", date: "8 July 2026" }] }],
  "events.duplicateWarnBody": [{ label: "p", args: [{ kind: "rehearsal", date: "8 July 2026" }] }],
  "events.duplicateFiledTwiceBody": [
    { label: "p", args: [{ kind: "rehearsal", date: "8 July 2026" }] },
  ],
  "events.archiveConsequence": [
    { label: "none", args: [{ takeCount: 0 }] },
    { label: "one", args: [{ takeCount: 1 }] },
    { label: "many", args: [{ takeCount: 6 }] },
  ],
  "home.unnamedEventTitle": [{ label: "parts", args: [{ kind: "Zkouška", date: "13. září" }] }],
  "home.newTakesLine": [
    { label: "voted", args: [{ takes: "3 nahrávky", unvoted: 0 }] },
    { label: "one", args: [{ takes: "3 nahrávky", unvoted: 1 }] },
    { label: "unvoted", args: [{ takes: "3 nahrávky", unvoted: 2 }] },
    { label: "many", args: [{ takes: "12 nahrávek", unvoted: 7 }] },
  ],
  "home.voteCount": [{ label: "n", args: [2] }],
  "home.stashLatestWhen": [{ label: "parts", args: [{ date: "21. 9. 2026", length: "0:47" }] }],
  "common.editingSheet": [{ label: "n", args: ["Čoudy"] }],
  "voting.favoriteAdd": [{ label: "n", args: ["Čoudy"] }],
  "voting.favoriteRemove": [{ label: "n", args: ["Čoudy"] }],
  "islands.chartUnnamedSection": [{ label: "i", args: [3] }],
  "islands.chartSectionNameLabel": [{ label: "i", args: [3] }],
  "islands.chartMoveUp": [{ label: "n", args: ["Sloka"] }],
  "islands.chartMoveDown": [{ label: "n", args: ["Sloka"] }],
  "islands.chartRemoveRow": [{ label: "n", args: ["Sloka"] }],
  "islands.chartChordsFor": [{ label: "n", args: ["Sloka"] }],
  "islands.chartWordsFor": [{ label: "n", args: ["Sloka"] }],
  "islands.chartUnknownNames": [
    { label: "one", args: [1] },
    { label: "many", args: [3] },
  ],
  "islands.uploadAdding": [
    { label: "one", args: [1] },
    { label: "many", args: [3] },
  ],
  "islands.uploadInstrumentFor": [{ label: "f", args: ["bass.flac"] }],
  "islands.uploadErrRefused": [{ label: "s", args: [413] }],
  "islands.confirmFailedStatus": [{ label: "s", args: [500] }],
  "player.solo": [{ label: "i", args: ["Bass"] }],
  "player.nowPlaying": [{ label: "t", args: ["Čoudy"] }],
  "player.nowPlayingSource": [{ label: "p", args: [{ title: "Čoudy", source: "Solo: Bass" }] }],
  "player.play": [{ label: "t", args: ["Čoudy"] }],
  "player.pause": [{ label: "t", args: ["Čoudy"] }],
  "player.position": [{ label: "p", args: [{ current: 3, total: 10 }] }],
  "player.openNowPlaying": [{ label: "t", args: ["Čoudy"] }],
  "player.seekValue": [{ label: "p", args: [{ at: "0:42", length: "3:10" }] }],
  "takes.count": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "other", args: [9] },
  ],
  "takes.heroFromEvent": [{ label: "p", args: [{ event: "Zkušebna", date: "27. 8. 2026" }] }],
  "takes.heroOfKind": [{ label: "p", args: [{ kind: "zkouška", date: "27. 8. 2026" }] }],
  "takes.heroRecorded": [{ label: "d", args: ["27. 8. 2026"] }],
  "takes.heroTitleByDate": [{ label: "d", args: ["27. 8. 2026"] }],
  "takes.pageTitle": [{ label: "t", args: ["Čoudy"] }],
  "takes.downloadAsset": [
    { label: "p", args: [{ label: "Master", format: "flac", size: "84.0 MB" }] },
  ],
  "takes.deleteAsset": [{ label: "l", args: ["Master"] }],
  "takes.deleteAssetConfirmTitle": [{ label: "l", args: ["master"] }],
  "takes.deleteConsequence": [
    { label: "none", args: [{ fileCount: 0, byteTotal: "0 B", totalVotes: 0 }] },
    { label: "some", args: [{ fileCount: 5, byteTotal: "312.0 MB", totalVotes: 3 }] },
    { label: "many", args: [{ fileCount: 9, byteTotal: "1.2 GB", totalVotes: 7 }] },
  ],
  "takes.deleteAssetConsequence": [
    {
      label: "keeps",
      args: [
        {
          label: "Master",
          format: "flac",
          tier: "lossless",
          bytes: "84.0 MB",
          isLastPlayable: false,
        },
      ],
    },
    {
      label: "last",
      args: [
        {
          label: "Master",
          format: "flac",
          tier: "lossless",
          bytes: "84.0 MB",
          isLastPlayable: true,
        },
      ],
    },
  ],
  "songs.countPlain": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "other", args: [7] },
  ],
  "songs.countMatching": [
    { label: "one", args: [1] },
    { label: "other", args: [7] },
  ],
  "songs.countArchived": [
    { label: "one", args: [1] },
    { label: "other", args: [7] },
  ],
  "songs.bpm": [{ label: "n", args: [120] }],
  "songs.unarchiveConfirmTitle": [{ label: "t", args: ["Čoudy"] }],
  "songs.archiveConfirmTitle": [{ label: "t", args: ["Čoudy"] }],
  "songs.deleteConfirmTitle": [{ label: "t", args: ["Čoudy"] }],
  "songs.showMoreTakes": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "other", args: [7] },
  ],
  "songs.archiveConsequence": [
    { label: "none", args: [{ takeCount: 0 }] },
    { label: "one", args: [{ takeCount: 1 }] },
    { label: "many", args: [{ takeCount: 6 }] },
  ],
  "songs.deleteConsequence": [
    { label: "none", args: [{ takeCount: 0, fileCount: 0, byteTotal: "0 B" }] },
    { label: "some", args: [{ takeCount: 3, fileCount: 5, byteTotal: "312.0 MB" }] },
  ],
  "home.plateTakeName": [{ label: "parts", args: [{ name: "Čoudy", date: "8. 7. 2026" }] }],
  "home.plateSongName": [{ label: "parts", args: [{ name: "Čoudy", detail: "3 taky" }] }],
  "home.plateEventName": [{ label: "parts", args: [{ name: "Zkouška", detail: "3 taky" }] }],
  "mail.greeting": [{ label: "n", args: ["Vařič"] }],
  "mail.loginLead": [{ label: "l", args: ["It works once."] }],
  "mail.loginLife": [
    { label: "one", args: [1] },
    { label: "many", args: [15] },
  ],
  "mail.inviteSubjectBy": [{ label: "n", args: ["Vařič"] }],
  "mail.inviteWhatBy": [{ label: "n", args: ["Vařič"] }],
  "push.newTakesByWeekday": [
    { label: "rehearsal", args: ["rehearsal", 4] },
    { label: "concert", args: ["concert", 4] },
    { label: "session", args: ["session", 4] },
  ],
  "push.newTakesByDate": [
    { label: "rehearsal", args: ["rehearsal", 12, 9] },
    { label: "concert", args: ["concert", 12, 9] },
    { label: "session", args: ["session", 12, 9] },
  ],
  "push.weeklyBody": [
    { label: "one", args: [1] },
    { label: "few", args: [3] },
    { label: "other", args: [7] },
  ],
  "push.songEditedBody": [{ label: "n", args: ["Čoudy"] }],
  "me.memberSince": [{ label: "d", args: ["8. února 2026"] }],
  "me.ledgerVotes": [
    { label: "one", args: [1] },
    { label: "many", args: [12] },
  ],
  "me.ledgerKeepers": [
    { label: "one", args: [1] },
    { label: "many", args: [7] },
  ],
  "me.allVotes": [{ label: "n", args: [12] }],
  "me.unvotedAfterCount": [
    { label: "one", args: [1] },
    { label: "many", args: [3] },
  ],
  "me.hearThem": [
    { label: "one", args: [1] },
    { label: "many", args: [3] },
  ],
  "me.languageCurrent": [{ label: "name", args: ["English"] }],
  "me.languageSwitch": [{ label: "name", args: ["Čeština"] }],
  "voting.tally": [
    { label: "unvoted", args: [{ keeperVotes: 0, totalVotes: 0, ratingScore: 0 }] },
    { label: "one", args: [{ keeperVotes: 1, totalVotes: 1, ratingScore: 1 }] },
    { label: "few", args: [{ keeperVotes: 1, totalVotes: 3, ratingScore: 1 / 3 }] },
    { label: "other", args: [{ keeperVotes: 3, totalVotes: 7, ratingScore: 3 / 7 }] },
  ],
};

type Leaf = { path: string; render: (locale: Locale) => string };

/** Every renderable string in the catalog, with the path that produced it. */
function leaves(): Leaf[] {
  const found: Leaf[] = [];

  const walk = (path: string, value: unknown): void => {
    if (typeof value === "string") {
      found.push({ path, render: (locale) => stringAt(locale, path) });
      return;
    }
    if (typeof value === "function") {
      const fixtures = FIXTURES[path];
      // A function with no fixture is a hole in this test, not a pass.
      expect(fixtures, `no FIXTURES entry for the function at "${path}"`).toBeDefined();
      for (const fixture of fixtures ?? []) {
        found.push({
          path: `${path}(${fixture.label})`,
          render: (locale) => callAt(locale, path, fixture.args),
        });
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        walk(path === "" ? key : `${path}.${key}`, child);
      }
    }
  };

  walk("", messages("en"));
  return found;
}

function resolve(locale: Locale, path: string): unknown {
  let node: unknown = messages(locale);
  for (const segment of path.split(".")) {
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function stringAt(locale: Locale, path: string): string {
  return String(resolve(locale, path));
}

function callAt(locale: Locale, path: string, args: unknown[]): string {
  const fn = resolve(locale, path) as (...a: unknown[]) => string;
  return fn(...args);
}

describe("message catalog parity", () => {
  const all = leaves();

  it("finds something to check", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(LOCALES.filter((locale) => locale !== "en"))(
    "%s says something of its own for every entry",
    (locale) => {
      const untranslated = all
        .filter(({ path }) => !IDENTICAL_IS_FINE.has(path))
        .filter(({ render }) => render("en") === render(locale))
        .map(({ path }) => path);

      expect(
        untranslated,
        `still reads as English in "${locale}" — translate it, or add the path to IDENTICAL_IS_FINE with a reason`,
      ).toEqual([]);
    },
  );

  it("every locale renders every entry as a string", () => {
    for (const locale of LOCALES) {
      for (const { path, render } of all) {
        expect(typeof render(locale), `${locale} / ${path}`).toBe("string");
      }
    }
  });
});
