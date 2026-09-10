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
]);

/** Arguments to call a function-valued entry with, keyed by its dotted path. */
const FIXTURES: Record<string, { label: string; args: unknown[] }[]> = {
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
        .filter(({ path, render }) => render("en") === render(locale))
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
