// The page-number half of paging: what a URL means, and what the control
// under a listing renders. The repo half (limit/offset, totals, ordering) is
// pinned in `packages/db`.
import { describe, expect, it } from "vitest";
import { pageRequest, pageView, parsePageNumber, toPageArgs } from "./pagination.js";

const url = (search: string) => new URL(`https://bandplate.test/takes${search}`);

describe("parsePageNumber", () => {
  it("reads a page number", () => {
    expect(parsePageNumber(new URLSearchParams("page=4"))).toBe(4);
  });

  it("is page one when absent", () => {
    expect(parsePageNumber(new URLSearchParams(""))).toBe(1);
  });

  // A listing is a GET surface people link to and edit by hand. There is
  // nothing here to reject with a 400 — every one of these is page one.
  it.each(["page=0", "page=-3", "page=abc", "page=2.5", "page=", "page=Infinity"])(
    "falls back to page one for ?%s",
    (query) => {
      expect(parsePageNumber(new URLSearchParams(query))).toBe(1);
    },
  );

  it("caps an absurd page number so it never becomes an offset", () => {
    // Unclamped, `?page=1e12` multiplied by a page size is an OFFSET the
    // database walks row by row.
    expect(parsePageNumber(new URLSearchParams("page=999999999999"))).toBe(1_000_000);
  });
});

describe("toPageArgs", () => {
  it("turns a 1-based page into a zero-based offset", () => {
    expect(toPageArgs(1, 25)).toEqual({ limit: 25, offset: 0 });
    expect(toPageArgs(3, 25)).toEqual({ limit: 25, offset: 50 });
  });

  it("clamps a page size past the repo ceiling", () => {
    expect(toPageArgs(1, 100_000).limit).toBe(100);
  });
});

describe("pageRequest", () => {
  it("returns both halves from one URL", () => {
    expect(pageRequest(new URLSearchParams("page=2"), 20)).toEqual({
      page: 2,
      args: { limit: 20, offset: 20 },
    });
  });
});

describe("pageView", () => {
  it("reports the range this page covers", () => {
    const view = pageView({ url: url(""), page: 2, perPage: 25, total: 63 });
    expect([view.from, view.to]).toEqual([26, 50]);
    expect(view.pageCount).toBe(3);
  });

  it("ends the range at the total on a short last page", () => {
    const view = pageView({ url: url(""), page: 3, perPage: 25, total: 63 });
    expect([view.from, view.to]).toEqual([51, 63]);
  });

  it("reports an empty listing as 0–0 on one page", () => {
    const view = pageView({ url: url(""), page: 1, perPage: 25, total: 0 });
    expect([view.from, view.to, view.pageCount]).toEqual([0, 0, 1]);
    expect(view.prevHref).toBeUndefined();
    expect(view.nextHref).toBeUndefined();
  });

  // Two addresses for one page is one of them getting shared, indexed and
  // bookmarked wrongly.
  it("links page one as the bare URL, with no page parameter", () => {
    const view = pageView({ url: url("?sort=rating&page=2"), page: 2, perPage: 25, total: 60 });
    expect(view.prevHref).toBe("/takes?sort=rating");
  });

  it("carries every other query parameter across a page change", () => {
    const view = pageView({
      url: url("?instrument=bass&instrument=drums&sort=rating"),
      page: 1,
      perPage: 25,
      total: 200,
    });
    expect(view.nextHref).toBe("/takes?instrument=bass&instrument=drums&sort=rating&page=2");
  });

  it("marks exactly one item as current", () => {
    const view = pageView({ url: url(""), page: 3, perPage: 10, total: 100 });
    const current = view.items.filter((i) => i.kind === "page" && i.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ page: 3 });
  });

  it("always offers the first and last page, however deep the listing", () => {
    const view = pageView({ url: url(""), page: 25, perPage: 10, total: 1000 });
    const numbers = view.items.flatMap((i) => (i.kind === "page" ? [i.page] : []));
    expect(numbers[0]).toBe(1);
    expect(numbers.at(-1)).toBe(100);
    expect(numbers).toContain(25);
  });

  it("elides the runs between, with a gap on each side", () => {
    const view = pageView({ url: url(""), page: 25, perPage: 10, total: 1000 });
    expect(view.items.filter((i) => i.kind === "gap")).toHaveLength(2);
    expect(view.items.flatMap((i) => (i.kind === "page" ? [String(i.page)] : ["…"]))).toEqual([
      "1",
      "…",
      "23",
      "24",
      "25",
      "26",
      "27",
      "…",
      "100",
    ]);
  });

  // An ellipsis standing for a single page is a lie that costs a click.
  it("renders a one-page gap as that page rather than an ellipsis", () => {
    const view = pageView({ url: url(""), page: 4, perPage: 10, total: 80 });
    expect(view.items.flatMap((i) => (i.kind === "page" ? [String(i.page)] : ["…"]))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  it("shows every page with no gaps when they all fit", () => {
    const view = pageView({ url: url(""), page: 1, perPage: 10, total: 30 });
    expect(view.items.filter((i) => i.kind === "gap")).toHaveLength(0);
  });

  describe("a page past the end", () => {
    it("asks to redirect to the last real page, filters intact", () => {
      const view = pageView({ url: url("?sort=rating&page=99"), page: 99, perPage: 25, total: 60 });
      expect(view.redirectTo).toBe("/takes?sort=rating&page=3");
    });

    it("renders as that last page rather than as an empty control", () => {
      const view = pageView({ url: url("?page=99"), page: 99, perPage: 25, total: 60 });
      expect(view.page).toBe(3);
      expect([view.from, view.to]).toEqual([51, 60]);
    });

    it("does not redirect when the request is in range", () => {
      const view = pageView({ url: url("?page=2"), page: 2, perPage: 25, total: 60 });
      expect(view.redirectTo).toBeUndefined();
    });

    it("sends page 2 of an emptied listing back to the bare URL", () => {
      const view = pageView({ url: url("?page=2"), page: 2, perPage: 25, total: 0 });
      expect(view.redirectTo).toBe("/takes");
    });
  });
});
