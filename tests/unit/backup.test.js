import path from "node:path";
import { describe, expect, it } from "vitest";
import { authColumnsSql, compareCounts, summary } from "../../scripts/backup-check.mjs";
import { backupFileName, backupHeader, countRows, defaultFolder, dumpUrl, isInside, pgDumpArgs, readCopyBlocks, readCounts } from "../../scripts/backup.mjs";
import { pgTool } from "../../scripts/local-db.mjs";

describe("isInside: a backup folder must be outside the repo", () => {
  const repo = "E:\\GitHub\\eclipse-site";

  it("refuses the repo and every folder in it, in any letter case", () => {
    for (const folder of [repo, `${repo}\\backups`, `${repo}\\supabase\\.temp`, "e:\\github\\ECLIPSE-SITE\\x"]) {
      expect(isInside(folder, repo, path.win32)).toBe(true);
    }
  });

  it("accepts folders beside, above and on other drives", () => {
    for (const folder of ["E:\\GitHub\\eclipse-site-backups", "E:\\GitHub", "C:\\Users\\you\\Documents\\Eclipse backups", `${repo}\\..\\backups`]) {
      expect(isInside(folder, repo, path.win32)).toBe(false);
    }
  });

  it("works the same with POSIX paths", () => {
    expect(isInside("/home/you/eclipse-site/b", "/home/you/eclipse-site", path.posix)).toBe(true);
    expect(isInside("/home/you/eclipse-site/..backups", "/home/you/eclipse-site", path.posix)).toBe(true);
    expect(isInside("/home/you/eclipse-site-old", "/home/you/eclipse-site", path.posix)).toBe(false);
  });

  it("defaults to Documents\\Eclipse backups in the home folder", () => {
    expect(defaultFolder("C:\\Users\\you")).toBe(path.join("C:\\Users\\you", "Documents", "Eclipse backups"));
  });
});

describe("backupFileName", () => {
  it("names the file by the UTC time, with no characters Windows refuses", () => {
    expect(backupFileName(new Date("2026-09-25T13:45:12.345Z"))).toBe("eclipse-backup-2026-09-25-134512Z.sql");
  });

  it("sorts older files first", () => {
    const names = ["2026-12-01T00:00:00Z", "2026-09-25T23:59:59Z", "2026-09-25T09:00:00Z"].map((d) => backupFileName(new Date(d)));
    expect([...names].sort()).toEqual([names[2], names[1], names[0]]);
  });
});

describe("dumpUrl", () => {
  const pooler = "postgresql://postgres.abcref@aws-0-us-east-2.pooler.supabase.com:5432/postgres\n";

  it("uses the linked project's session pooler and requires TLS", () => {
    expect(dumpUrl(pooler, "abcref\n")).toBe("postgresql://postgres.abcref@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require");
  });

  it("refuses a URL with a password in it, or for another project", () => {
    expect(() => dumpUrl("postgresql://postgres.abcref:secret@host:5432/postgres", "abcref")).toThrow();
    expect(() => dumpUrl(pooler, "otherref")).toThrow();
    expect(() => dumpUrl("https://postgres.abcref@host/postgres", "abcref")).toThrow();
  });
});

describe("pgDumpArgs", () => {
  it("dumps only data, of the public schema and the accounts, and fails on a missing table", () => {
    const args = pgDumpArgs("postgresql://u@h/postgres", "out.sql");
    expect(args).toEqual(expect.arrayContaining(["--data-only", "--strict-names", "--table=public.*", "--table=auth.users", "--table=auth.identities", "--file=out.sql"]));
    expect(args.filter((a) => a.startsWith("--table="))).toHaveLength(3);
    expect(args.some((a) => /password/i.test(a))).toBe(false);
  });
});

const DUMP = [
  "SET client_encoding = 'UTF8';",
  "COPY auth.users (id, email, encrypted_password) FROM stdin;",
  "u1\ta@example.test\t$2a$10$hash",
  "u2\tb@example.test\t\\N",
  "\\.",
  "",
  "COPY public.characters (id, data) FROM stdin;",
  'c1\t{"notes": "line one\\nline two"}',
  "\\.",
  "COPY public.site_admins (user_id, note, added_at) FROM stdin;",
  "\\.",
  "SELECT pg_catalog.setval('public.character_history_id_seq', 7, true);",
].join("\r\n");

describe("readCopyBlocks and countRows", () => {
  it("counts the rows of each table, with CRLF or LF, and an empty table as 0", () => {
    const counts = { "auth.users": 2, "public.characters": 1, "public.site_admins": 0 };
    expect(countRows(DUMP)).toEqual(counts);
    expect(countRows(DUMP.replaceAll("\r\n", "\n"))).toEqual(counts);
  });

  it("reads each table's columns", () => {
    expect(readCopyBlocks(DUMP).map((b) => [b.table, b.columns])).toEqual([
      ["auth.users", ["id", "email", "encrypted_password"]],
      ["public.characters", ["id", "data"]],
      ["public.site_admins", ["user_id", "note", "added_at"]],
    ]);
  });

  it("lists the tables in name order, so every backup prints the same way", () => {
    expect(Object.keys(countRows(DUMP.replace("COPY auth.users", "COPY public.zz")))).toEqual(["public.characters", "public.site_admins", "public.zz"]);
  });
});

describe("the counts in the header", () => {
  const counts = { "auth.users": 2, "public.characters": 1 };
  const header = backupHeader(counts, new Date("2026-09-25T13:45:12Z"));

  it("round-trip through the file's header", () => {
    expect(readCounts(header + DUMP)).toEqual(counts);
  });

  it("are null in a file that npm run backup did not make, or when the line is broken", () => {
    expect(readCounts(DUMP)).toBeNull();
    expect(readCounts(header.replace('"public.characters":1}', '"public.char') + DUMP)).toBeNull();
  });

  // Loading must not run the triggers again (a second history snapshot, a second profile).
  it("turn off triggers and foreign-key checks before any data, and say the file is secret", () => {
    expect(header).toMatch(/SECRET/);
    expect(header).toContain("SET session_replication_role = replica;");
    expect(header.split("\n").every((l) => !l.startsWith("COPY"))).toBe(true);
  });
});

describe("authColumnsSql", () => {
  const blocks = readCopyBlocks(DUMP + "\r\nCOPY auth.identities (provider_id, user_id, identity_data) FROM stdin;\r\n\\.");

  it("adds the backup's auth columns the harness lacks, as text, and makes missing auth tables", () => {
    const existing = new Map([["auth.users", new Set(["id", "email"])]]);
    expect(authColumnsSql(blocks, existing).split("\n")).toEqual([
      'alter table auth."users" add column "encrypted_password" text;',
      'create table auth."identities" ("provider_id" text, "user_id" text, "identity_data" text);',
    ]);
  });

  it("changes nothing in public, and nothing when the auth tables already hold every column", () => {
    const existing = new Map([
      ["auth.users", new Set(["id", "email", "encrypted_password"])],
      ["auth.identities", new Set(["provider_id", "user_id", "identity_data"])],
    ]);
    expect(authColumnsSql(blocks, existing)).toBe("");
  });

  it("refuses a name that is not a plain identifier", () => {
    const odd = readCopyBlocks('COPY auth.users (id, "x"" text); drop table y; --") FROM stdin;\n\\.');
    expect(() => authColumnsSql(odd, new Map())).toThrow(/Unexpected name/);
  });
});

describe("compareCounts", () => {
  it("matches each table's loaded rows with the backup's count", () => {
    const rows = compareCounts({ "auth.users": 2, "public.characters": 3 }, { "auth.users": 2, "public.characters": 2, "public.new_table": 0 });
    expect(rows.map((r) => [r.table, r.ok, summary(r)])).toEqual([
      ["auth.users", true, "2"],
      ["public.characters", false, "3 in the backup, 2 loaded"],
      ["public.new_table", false, "not in the backup, 0 loaded"],
    ]);
  });

  it("fails a table the backup counted that the database does not have", () => {
    const [row] = compareCounts({ "public.gone": 1 }, {});
    expect([row.ok, summary(row)]).toEqual([false, "1 in the backup, but no such table"]);
  });
});

describe("pgTool", () => {
  it("uses PSQL or PG_DUMP when set, and otherwise the name on the PATH", () => {
    expect(pgTool("pg_dump", { PG_DUMP: "D:\\pg\\pg_dump.exe" })).toBe("D:\\pg\\pg_dump.exe");
    expect(pgTool("psql", { PSQL: "/usr/bin/psql" })).toBe("/usr/bin/psql");
    expect(pgTool("psql", { ProgramFiles: "Z:\\no-such-folder" })).toBe("psql");
  });
});
