import { describe, expect, it } from "vitest";
import { parseRows, readArgs } from "../../scripts/account-lists.mjs";
import { sqlFor as adminsSql } from "../../scripts/admins.mjs";
import { sqlFor as creatorsSql } from "../../scripts/creators.mjs";

describe("parseRows", () => {
  const json = '{\n  "boundary": "b",\n  "rows": [{"email":"a@b.co"}],\n  "warning": "untrusted"\n}';

  it("reads the rows from the CLI's JSON", () => {
    expect(parseRows(json)).toEqual([{ email: "a@b.co" }]);
  });

  // The CLI can print progress lines before and after its answer.
  it("ignores progress text before and after the JSON", () => {
    expect(parseRows("Initialising login role...\n" + json)).toEqual([{ email: "a@b.co" }]);
    expect(parseRows(json + "\nsome trailing status line\n")).toEqual([{ email: "a@b.co" }]);
  });

  it("returns an empty list when there are no rows, and throws when there is no JSON", () => {
    expect(parseRows('{"rows": []}')).toEqual([]);
    expect(() => parseRows("no json here")).toThrow();
  });

  // Outside an agent, `db query --output-format json` prints the rows as a plain list.
  it("reads a plain list of rows", () => {
    expect(parseRows('[\n  {\n    "email": "a@b.co"\n  }\n]\n')).toEqual([{ email: "a@b.co" }]);
    expect(parseRows("[]\n")).toEqual([]);
  });
});

describe("readArgs", () => {
  it("takes plain words, so PowerShell and npm pass them through", () => {
    expect(readArgs(["node", "admins.mjs", "approve", "a@b.co", "print-sql"])).toEqual({ command: "approve", email: "a@b.co", printSql: true, project: "live" });
    expect(readArgs(["node", "admins.mjs", "--print-sql", "list"])).toEqual({ command: "list", email: undefined, printSql: true, project: "live" });
    expect(readArgs(["node", "creators.mjs", "add", "a@b.co"])).toEqual({ command: "add", email: "a@b.co", printSql: false, project: "live" });
  });

  it("uses the staging project only when the last word is staging", () => {
    expect(readArgs(["node", "admins.mjs", "list", "staging"])).toEqual({ command: "list", email: undefined, printSql: false, project: "staging" });
    expect(readArgs(["node", "admins.mjs", "approve", "a@b.co", "staging"])).toEqual({ command: "approve", email: "a@b.co", printSql: false, project: "staging" });
    expect(readArgs(["node", "creators.mjs", "add", "a@b.co", "staging", "print-sql"])).toEqual({ command: "add", email: "a@b.co", printSql: true, project: "staging" });
    expect(readArgs(["node", "creators.mjs", "add", "staging", "a@b.co"]).project).toBe("live");
  });

  // Without an email, "staging" is not taken as one.
  it("leaves no email when staging follows the command", () => {
    const args = readArgs(["node", "admins.mjs", "approve", "staging"]);
    expect(args).toEqual({ command: "approve", email: undefined, printSql: false, project: "staging" });
    expect(() => adminsSql(args.command, args.email)).toThrow(/plain email/);
  });
});

describe.each([
  ["creators", creatorsSql, "campaign_creators"],
  ["admins", adminsSql, "site_admins"],
])("npm run %s", (script, sqlFor, table) => {
  it("builds list, lookup, add and remove on its own table, around the same account lookup", () => {
    for (const command of ["lookup", "add", "remove"]) {
      expect(sqlFor(command, "Someone@Example.com")).toContain("lower(email) = lower('Someone@Example.com')");
    }
    expect(sqlFor("add", "a@b.co")).toMatch(new RegExp(`^insert into public\\.${table} \\(user_id, note\\) select id, 'added with npm run ${script}'`));
    expect(sqlFor("remove", "a@b.co")).toMatch(new RegExp(`^delete from public\\.${table} `));
    expect(sqlFor("list")).toMatch(new RegExp(`^select u\\.email, .* from public\\.${table} c `));
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

describe("npm run admins approve", () => {
  it("approves the email lower-cased, and approving it again renews the approval", () => {
    expect(adminsSql("approve", "Owner@Example.com")).toBe(
      "insert into public.approved_emails (email) values (lower('Owner@Example.com')) on conflict (email) do update set approved_at = default, expires_at = default returning email, expires_at",
    );
  });

  it("refuses anything that is not a plain email address", () => {
    for (const bad of ["a@b.co'); delete from public.site_admins; --", "a@b", ""]) {
      expect(() => adminsSql("approve", bad)).toThrow(/plain email/);
    }
  });
});
