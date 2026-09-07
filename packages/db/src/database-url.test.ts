import { describe, expect, it } from "vitest";
import { type DatabaseUrlEnv, resolveDatabaseUrl } from "./database-url.js";

describe("resolveDatabaseUrl", () => {
  const cases: Array<{ name: string; env: DatabaseUrlEnv; expected: string }> = [
    {
      name: "prefers BANDPLATE_DATABASE_URL when both are set",
      env: { BANDPLATE_DATABASE_URL: "file:./bandplate.db", DATABASE_URL: "file:./bare.db" },
      expected: "file:./bandplate.db",
    },
    {
      name: "uses BANDPLATE_DATABASE_URL alone",
      env: { BANDPLATE_DATABASE_URL: "file:./bandplate.db" },
      expected: "file:./bandplate.db",
    },
    {
      name: "falls back to the bare DATABASE_URL",
      env: { DATABASE_URL: "file:./bare.db" },
      expected: "file:./bare.db",
    },
    {
      name: "falls back to DATABASE_URL when BANDPLATE_DATABASE_URL is an empty string",
      env: { BANDPLATE_DATABASE_URL: "", DATABASE_URL: "file:./bare.db" },
      expected: "file:./bare.db",
    },
  ];

  it.each(cases)("$name", ({ env, expected }) => {
    expect(resolveDatabaseUrl(env)).toBe(expected);
  });

  const missingCases: Array<{ name: string; env: DatabaseUrlEnv }> = [
    { name: "neither variable set", env: {} },
    {
      name: "both explicitly undefined",
      env: { BANDPLATE_DATABASE_URL: undefined, DATABASE_URL: undefined },
    },
    { name: "both empty strings", env: { BANDPLATE_DATABASE_URL: "", DATABASE_URL: "" } },
  ];

  it.each(missingCases)("throws, naming both env vars, when $name", ({ env }) => {
    expect(() => resolveDatabaseUrl(env)).toThrow(/BANDPLATE_DATABASE_URL.*DATABASE_URL/);
  });

  it("includes the caller-supplied action in the error message", () => {
    expect(() => resolveDatabaseUrl({}, "running migrations")).toThrow(/running migrations/);
    expect(() => resolveDatabaseUrl({}, "running the seed")).toThrow(/running the seed/);
  });

  it("defaults the action to a generic message when omitted", () => {
    expect(() => resolveDatabaseUrl({})).toThrow(/connecting to the database/);
  });
});
