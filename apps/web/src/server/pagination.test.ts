// What a listing's URL means, and what the footer under it offers. The repo
// half (limit/offset, totals, ordering) is pinned in `packages/db`.
import { MAX_PAGE_SIZE, type PageArgs } from "@bandplate/db";
import { describe, expect, it } from "vitest";
import {
  type CounterView,
  firstGuess,
  hasFooter,
  listMoreLabels,
  listRequest,
  listView,
  loadList,
  MAX_SHOWN,
  type MoreView,
  moreAnchorId,
  pageCounterLabels,
  parsePageNumber,
  sanitizeShown,
  toPageArgs,
} from "./pagination.js";

const url = (search: string) => new URL(`https://bandplate.test/takes${search}`);

function view(search: string, total: number, pageSize = 25) {
  const u = url(search);
  return listView({ url: u, request: listRequest(u.searchParams, pageSize), total });
}
function more(search: string, total: number, pageSize = 25): MoreView {
  const v = view(search, total, pageSize);
  if (v.mode !== "more") throw new Error(`expected "more", got ${v.mode}`);
  return v;
}
function counter(search: string, total: number, pageSize = 25): CounterView {
  const v = view(search, total, pageSize);
  if (v.mode !== "counter") throw new Error(`expected "counter", got ${v.mode}`);
  return v;
}

describe("parsePageNumber", () => {
  it("reads a page number", () => {
    expect(parsePageNumber(new URLSearchParams("page=4"))).toBe(4);
  });

  it("defaults to page one", () => {
    expect(parsePageNumber(new URLSearchParams(""))).toBe(1);
  });

  it.each(["page=0", "page=-3", "page=abc", "page=2.5", "page="])(
    "treats %s as page one rather than an error",
    (query) => {
      expect(parsePageNumber(new URLSearchParams(query))).toBe(1);
    },
  );

  it("caps an absurd page number", () => {
    expect(parsePageNumber(new URLSearchParams("page=999999999999"))).toBe(1_000_000);
  });
});

describe("sanitizeShown", () => {
  it("defaults to one batch", () => {
    expect(sanitizeShown(undefined, 25)).toBe(25);
  });

  it("never shows less than one batch", () => {
    expect(sanitizeShown(3, 25)).toBe(25);
  });

  it("rounds up to a whole number of batches", () => {
    expect(sanitizeShown(30, 25)).toBe(50);
    expect(sanitizeShown(50, 25)).toBe(50);
  });

  it("stops at the ceiling", () => {
    expect(sanitizeShown(100_000, 25)).toBe(MAX_SHOWN);
    // 200 is not a multiple of 15; the ceiling wins over the rounding.
    expect(sanitizeShown(199, 15)).toBe(MAX_SHOWN);
  });

  it("fits under the repos' page-size cap", () => {
    expect(MAX_SHOWN).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });
});

describe("listRequest", () => {
  it.each(["shown=abc", "shown=-4", "shown=0", "shown=2.5"])(
    "reads junk in %s as one batch",
    (query) => {
      expect(listRequest(new URLSearchParams(query), 25).shown).toBe(25);
    },
  );

  it("leaves absent parameters absent", () => {
    expect(listRequest(new URLSearchParams(""), 25)).toEqual({
      pageSize: 25,
      page: undefined,
      shown: undefined,
    });
  });
});

describe("toPageArgs", () => {
  it("turns a 1-based page into limit/offset", () => {
    expect(toPageArgs(1, 25)).toEqual({ limit: 25, offset: 0 });
    expect(toPageArgs(3, 25)).toEqual({ limit: 25, offset: 50 });
  });

  it("clamps an oversized page", () => {
    expect(toPageArgs(1, 100_000).limit).toBe(MAX_PAGE_SIZE);
  });
});

describe("a list that fits under the ceiling grows", () => {
  it("shows one batch from the top by default", () => {
    const v = more("", 187);
    expect(v.args).toEqual({ limit: 25, offset: 0 });
    expect(v.shown).toBe(25);
  });

  it("asks for one batch more, landing on the first new row", () => {
    const v = more("?shown=100", 187);
    expect(v.args).toEqual({ limit: 100, offset: 0 });
    expect(v.nextHref).toBe("/takes?shown=125#dalsi-101");
    expect(v.nextCount).toBe(25);
  });

  it("keeps every filter and the sort on both links", () => {
    const v = more("?instrument=bass&instrument=drums&sort=rating&shown=50", 187);
    expect(v.nextHref).toBe(
      "/takes?instrument=bass&instrument=drums&sort=rating&shown=75#dalsi-51",
    );
    expect(v.allHref).toBe(
      "/takes?instrument=bass&instrument=drums&sort=rating&shown=187#dalsi-51",
    );
  });

  it("offers only what is left when the last batch is short", () => {
    const v = more("?shown=175", 187);
    expect(v.nextCount).toBe(12);
  });

  it("offers 'all' only while more than one batch remains", () => {
    expect(more("?shown=150", 187).allHref).toBeDefined(); // 37 left
    expect(more("?shown=175", 187).allHref).toBeUndefined(); // 12 left
    expect(more("?shown=25", 50).allHref).toBeUndefined(); // exactly one batch left
  });

  it("offers nothing more once everything is shown", () => {
    const v = more("?shown=200", 187);
    expect(v.shown).toBe(187);
    expect(v.nextHref).toBeUndefined();
    expect(v.allHref).toBeUndefined();
    expect(hasFooter(v)).toBe(true);
  });

  it("has no footer at all when the list fits in its first batch", () => {
    expect(hasFooter(more("", 25))).toBe(false);
    expect(hasFooter(more("", 0))).toBe(false);
    expect(hasFooter(more("", 26))).toBe(true);
  });

  it("grows right up to the ceiling itself", () => {
    const v = more("?shown=175", MAX_SHOWN);
    expect(v.nextHref).toBe("/takes?shown=200#dalsi-176");
  });

  // An old numbered link must still show the rows it pointed at.
  describe("an old ?page= link", () => {
    it("shows every batch up to that page", () => {
      const v = more("?sort=rating&page=3", 187);
      expect(v.args).toEqual({ limit: 75, offset: 0 });
      expect(v.shown).toBe(75);
    });

    it("drops the page parameter from the links it offers", () => {
      expect(more("?sort=rating&page=3", 187).nextHref).toBe(
        "/takes?sort=rating&shown=100#dalsi-76",
      );
    });

    it("is clamped to the ceiling rather than redirected", () => {
      const v = more("?page=99", 60);
      expect(v.args.limit).toBe(MAX_SHOWN);
      expect(v.shown).toBe(60);
      expect(v.redirectTo).toBeUndefined();
    });
  });

  describe("anchors", () => {
    it("sits at every batch boundary, named for the row it starts", () => {
      const v = more("?shown=75", 187);
      expect(moreAnchorId(v, 0)).toBeUndefined();
      expect(moreAnchorId(v, 24)).toBeUndefined();
      expect(moreAnchorId(v, 25)).toBe("dalsi-26");
      expect(moreAnchorId(v, 50)).toBe("dalsi-51");
    });

    it("exists for the row every link lands on", () => {
      const before = more("?shown=50", 187);
      for (const href of [before.nextHref, before.allHref]) {
        const target = new URL(href ?? "", "https://bandplate.test");
        const after = more(target.search, 187);
        expect(moreAnchorId(after, before.shown)).toBe(target.hash.slice(1));
      }
    });
  });
});

describe("a list past the ceiling pages under a counter", () => {
  it("reports the range this page covers", () => {
    const v = counter("?page=2", 225);
    expect([v.from, v.to, v.pageCount]).toEqual([26, 50, 9]);
    expect(v.args).toEqual({ limit: 25, offset: 25 });
  });

  it("ends the range at the total on the last page", () => {
    const v = counter("?page=9", 225);
    expect([v.from, v.to]).toEqual([201, 225]);
    expect(v.nextHref).toBeUndefined();
  });

  it("has no previous link on the first page", () => {
    const v = counter("", 225);
    expect(v.page).toBe(1);
    expect(v.prevHref).toBeUndefined();
    expect(v.nextHref).toBe("/takes?page=2");
  });

  // Two addresses for one page is one of them getting shared, indexed and
  // bookmarked wrongly.
  it("links page one as the bare URL", () => {
    expect(counter("?sort=rating&page=2", 225).prevHref).toBe("/takes?sort=rating");
  });

  it("carries every other query parameter across a page change", () => {
    expect(counter("?instrument=bass&instrument=drums&sort=rating", 225).nextHref).toBe(
      "/takes?instrument=bass&instrument=drums&sort=rating&page=2",
    );
  });

  it("reads a ?shown= link as the page its last batch is on, and drops it", () => {
    const v = counter("?sort=rating&shown=100", 225);
    expect(v.page).toBe(4);
    expect(v.nextHref).toBe("/takes?sort=rating&page=5");
  });

  it("always has a footer", () => {
    expect(hasFooter(counter("", MAX_SHOWN + 1))).toBe(true);
  });

  describe("a page past the end", () => {
    it("asks to redirect to the last real page, filters intact", () => {
      expect(counter("?sort=rating&page=99", 225).redirectTo).toBe("/takes?sort=rating&page=9");
    });

    it("renders as that last page", () => {
      const v = counter("?page=99", 225);
      expect(v.page).toBe(9);
      expect([v.from, v.to]).toEqual([201, 225]);
    });

    it("does not redirect when the request is in range", () => {
      expect(counter("?page=2", 225).redirectTo).toBeUndefined();
    });
  });

  it("plants no anchors", () => {
    expect(moreAnchorId(counter("", 225), 25)).toBeUndefined();
  });
});

describe("firstGuess", () => {
  it("guesses a counter page for a ?page= link", () => {
    expect(firstGuess(listRequest(new URLSearchParams("page=3"), 25))).toEqual({
      limit: 25,
      offset: 50,
    });
  });

  it("guesses a grown list otherwise", () => {
    expect(firstGuess(listRequest(new URLSearchParams("shown=60"), 25))).toEqual({
      limit: 75,
      offset: 0,
    });
  });
});

describe("loadList", () => {
  function fakeLoader(total: number) {
    const calls: PageArgs[] = [];
    const load = async (args: PageArgs) => {
      calls.push(args);
      return { total, rows: args };
    };
    return { calls, load };
  }

  it("queries the bare URL once, whichever mode it turns out to be", async () => {
    for (const total of [10, 187, 225]) {
      const { calls, load } = fakeLoader(total);
      await loadList(url(""), 25, load, (r) => r.total);
      expect(calls).toHaveLength(1);
    }
  });

  it("re-queries an old ?page= link on a list that now grows", async () => {
    const { calls, load } = fakeLoader(187);
    const { result, list } = await loadList(url("?page=3"), 25, load, (r) => r.total);
    expect(calls).toEqual([
      { limit: 25, offset: 50 },
      { limit: 75, offset: 0 },
    ]);
    expect(result.rows).toEqual({ limit: 75, offset: 0 });
    expect(list.mode).toBe("more");
  });

  it("re-queries a ?shown= link on a list that has outgrown the ceiling", async () => {
    const { calls, load } = fakeLoader(225);
    const { list } = await loadList(url("?shown=100"), 25, load, (r) => r.total);
    expect(calls.at(-1)).toEqual({ limit: 25, offset: 75 });
    expect(list.mode).toBe("counter");
  });

  it("does not re-query a counter page that guessed right", async () => {
    const { calls, load } = fakeLoader(225);
    await loadList(url("?page=4"), 25, load, (r) => r.total);
    expect(calls).toHaveLength(1);
  });
});

describe("labels", () => {
  it("says how far a grown list has got, in the member's language", () => {
    const labels = listMoreLabels(more("?shown=100", 187), "take", "cs");
    expect(labels.count).toBe("Zobrazeno 100 z 187 nahrávek");
    expect(labels.more).toBe("Zobrazit dalších 25 nahrávek");
    expect(labels.all).toBe("Zobrazit všech 187 nahrávek");
  });

  it("says 'all' once everything is shown", () => {
    expect(listMoreLabels(more("?shown=200", 187), "song", "en").count).toBe("All 187 songs");
  });

  it("names the counter's position for a screen reader", () => {
    const labels = pageCounterLabels(counter("?page=4", 225), "take", "cs");
    expect(labels.nav).toBe("Stránkování, strana 4 z 9");
    expect(labels.range).toBe("76–100 z 225 nahrávek");
    expect(labels.previous).toBe("Předchozí strana");
  });
});
