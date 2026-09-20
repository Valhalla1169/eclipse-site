import { describe, expect, it } from "vitest";
import { parseRows, sqlFor } from "../../scripts/creators.mjs";

describe("parseRows", () => {
  const json = '{\n  "boundary": "b",\n  "rows": [{"email":"a@b.co"}],\n  "warning": "untrusted"\n}';

  it("reads the rows from the CLI's JSON", () => {
    expect(parseRows(json)).toEqual([{ email: "a@b.co" }]);
  });

  // Regression: the first version parsed stdout and stderr glued together, so the
  // CLI's progress line made JSON.parse throw and the command failed for everyone.
  it("ignores progress text before and after the JSON", () => {
    expect(parseRows("Initialising login role...\n" + json)).toEqual([{ email: "a@b.co" }]);
    expect(parseRows(json + "\nsome trailing status line\n")).toEqual([{ email: "a@b.co" }]);
  });

  it("returns an empty list when there are no rows, and throws when there is no JSON", () => {
    expect(parseRows('{"rows": []}')).toEqual([]);
    expect(() => parseRows("no json here")).toThrow();
  });
});

describe("sqlFor", () => {
  it("builds the three statements around the same account lookup", () => {
    for (const command of ["lookup", "add", "remove"]) {
      expect(sqlFor(command, "Someone@Example.com")).toContain("lower(email) = lower('Someone@Example.com')");
    }
    expect(sqlFor("add", "a@b.co")).toMatch(/^insert into public\.campaign_creators/);
    expect(sqlFor("remove", "a@b.co")).toMatch(/^delete from public\.campaign_creators/);
    expect(sqlFor("list")).toMatch(/^select u\.email/);
  });

  // The address is interpolated into SQL, so anything but plain email characters must
  // be refused before a statement is built.
  it("refuses anything that is not a plain email address", () => {
    for (const bad of ["a@b.co'; drop table public.characters; --", 'a@b.co" or 1=1', "a b@c.de", "a@b", "x@y.co;select 1", "\\@a.bc", "", undefined]) {
      expect(() => sqlFor("add", bad)).toThrow(/plain email/);
    }
  });

  it("rejects an unknown command", () => {
    expect(() => sqlFor("drop", "a@b.co")).toThrow(/Unknown command/);
  });
});
