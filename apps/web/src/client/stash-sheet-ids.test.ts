import { describe, expect, it } from "vitest";
import { stashRenameSheetId, stashSheetElementIds, stashSheetId } from "./stash-sheet-ids.js";

describe("a stash recording's sheet ids", () => {
  it("names the two sheets after the take", () => {
    expect(stashSheetId("t-1")).toBe("stash-t-1");
    expect(stashRenameSheetId("t-1")).toBe("stash-rename-t-1");
  });

  it("gives the element ids `RecordSheet` actually renders", () => {
    // What `stash-sheets.ts` looks up in a freshly fetched page, and what the
    // triggers on the row point at. Three surfaces, one source.
    expect(stashSheetElementIds("t-1")).toEqual(["sheet-stash-t-1", "sheet-stash-rename-t-1"]);
  });

  it("keeps the two apart for a take whose id starts like another's", () => {
    expect(stashSheetElementIds("t-1")[0]).not.toBe(stashSheetElementIds("t-10")[0]);
  });
});
