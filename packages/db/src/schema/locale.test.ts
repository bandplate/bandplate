// The one thing that hardcoding `members.locale`'s enum gives up.
//
// The values really live in `@bandplate/i18n`'s `LOCALES`/`DEFAULT_LOCALE`.
// The schema spells them out instead, because `drizzle-kit generate` loads the
// schema file through a CJS require and cannot resolve that package's
// ESM-style `./locale.js` specifiers — importing there breaks the migration
// command outright.
//
// So the coupling is real but implicit, which is exactly the situation
// `column-order-guard.ts` exists for elsewhere in this package: make it loud.
// Add a language to `LOCALES` without a migration adding it to the column and
// this fails, rather than a member picking a language the database rejects at
// write time.
import { DEFAULT_LOCALE, LOCALES } from "@bandplate/i18n";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { members } from "./sqlite/index.js";

describe("members.locale matches @bandplate/i18n", () => {
  const column = getTableColumns(members).locale;

  it("accepts exactly the locales the app speaks", () => {
    expect([...(column.enumValues ?? [])].sort()).toEqual([...LOCALES].sort());
  });

  it("defaults to the app's default locale", () => {
    expect(column.default).toBe(DEFAULT_LOCALE);
  });
});
