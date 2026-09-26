import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHAPTER_SLUG } from "../../public/js/markdown.js";
import { LIMITS, chapterFile, chapterTitle, databaseError, pushSql, readArgs, readBook, sqlText } from "../../scripts/rulebook.mjs";

// Made-up chapters only: the real rulebook is never in this repo (docs/adr/0016).
describe("chapterFile: the file name gives the chapter's place and address", () => {
  it("reads the number and the words", () => {
    expect(chapterFile("05_combat_basics.md")).toEqual({ position: 5, slug: "combat-basics" });
    expect(chapterFile("0_intro.md")).toEqual({ position: 0, slug: "intro" });
    expect(chapterFile("12_Rest-And_Recovery.MD")).toEqual({ position: 12, slug: "rest-and-recovery" });
  });

  it("makes only addresses that the site and the database accept", () => {
    for (const name of ["05_combat_basics.md", "9999_a1_b2.md", "7_x-y.md"]) expect(CHAPTER_SLUG.test(chapterFile(name).slug)).toBe(true);
  });

  it("refuses any other name", () => {
    for (const name of ["combat.md", "5-combat.md", "05_.md", "05__x.md", "05_x_.md", "05_x.txt", "12345_x.md", "05_x y.md", "05_x.md.bak", "05_../x.md", "README.md"]) {
      expect(chapterFile(name), name).toBeNull();
    }
  });
});

describe("chapterTitle", () => {
  it("is the text of the first # heading, without its markup", () => {
    expect(chapterTitle("Intro text\n\n## Not this\n\n# The *Long* Road\n\n# Later")).toBe("The Long Road");
  });

  it("is not a # line inside a code block, and is empty without a heading", () => {
    expect(chapterTitle("```\n# comment\n```\n\n# Real")).toBe("Real");
    expect(chapterTitle("## Only a smaller heading")).toBe("");
  });
});

describe("sqlText: no chapter text can break out of the SQL", () => {
  const nasty = ["'); drop table public.characters; --", "$$ $body$ $tag$", "back\\slash\\'", "é ✓ 𝔘 \u2028", "\n\r\t", "", "'".repeat(100)];

  it.each(nasty)("keeps %j as base64 in one string", (value) => {
    const sql = sqlText(value);
    const [, encoded] = /^convert_from\(decode\('([A-Za-z0-9+/=]*)', 'base64'\), 'UTF8'\)$/.exec(sql);
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(value);
  });
});

describe("pushSql", () => {
  const book = {
    title: "A Made-up Book",
    version: "test 1",
    chapters: [
      { position: 1, slug: "first", title: "First", body: "# First\n\n'); delete from public.characters; --" },
      { position: 2, slug: "second", title: "Second", body: "# Second\n\n$$ end $$" },
    ],
  };
  const sql = pushSql(book);

  it("replaces the whole book in one transaction", () => {
    const statements = sql.split(";\n").map((s) => s.trim().split(/\s+/).slice(0, 3).join(" "));
    expect(statements.slice(0, 5)).toEqual(["begin", "delete from public.rulebook_pages", "insert into public.rulebook_pages", "insert into public.rulebook", "commit"]);
  });

  it("holds no chapter text in the open", () => {
    expect(sql).not.toMatch(/delete from public\.characters|Made-up|\$\$/);
  });

  it("sends every chapter, with its place, address, title and text", () => {
    const [encoded] = /(?<=decode\(')[A-Za-z0-9+/=]+/.exec(sql);
    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))).toEqual(book.chapters);
  });
});

describe("databaseError", () => {
  // The CLI's answer when a row breaks a check, as the Management API sends it.
  const output = String.raw`{"message":"Failed to run sql query: ERROR:  23514: new row for relation \"rulebook_pages\" violates check constraint \"rulebook_pages_slug_check\"\nDETAIL:  Failing row contains (1, Bad Slug, x, secret made-up text)."}`;

  it("keeps the error and drops the row it quotes", () => {
    expect(databaseError(output)).toBe('23514: new row for relation "rulebook_pages" violates check constraint "rulebook_pages_slug_check"');
    expect(databaseError(output)).not.toContain("secret");
  });

  it("is null when the database gave no error, such as when the login failed", () => {
    expect(databaseError("Access token not provided. Supply an access token by running supabase login")).toBeNull();
  });
});

describe("readArgs", () => {
  it("reads push <folder>, with staging as an optional last word", () => {
    expect(readArgs(["push", "D:\\Book"])).toEqual({ folder: "D:\\Book", project: "live" });
    expect(readArgs(["push", "D:\\Book", "staging"])).toEqual({ folder: "D:\\Book", project: "staging" });
  });

  // A typo must never fall back to the live project.
  it("refuses anything else", () => {
    for (const words of [[], ["push"], ["pull", "x"], ["push", "x", "stagin"], ["push", "x", "live"], ["push", "x", "staging", "y"]]) {
      expect(readArgs(words), words.join(" ")).toBeNull();
    }
  });
});

describe("readBook", () => {
  // Each test's own folder holds book/ and, beside it, repo/.
  let dirs = [];
  let dir;
  const folder = (files) => {
    dir = mkdtempSync(join(tmpdir(), "eclipse-rulebook-test-"));
    dirs.push(dir);
    mkdirSync(join(dir, "repo"));
    const book = join(dir, "book");
    mkdirSync(book);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(book, name), text);
    return book;
  };
  const elsewhere = () => join(dir, "repo");
  const info = JSON.stringify({ title: "A Made-up Book", version: "test 1" });
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it("reads the chapters in their order, and the book's title and version", () => {
    const book = folder({ "book.json": info, "10_last.md": "# Last\nEnd.", "02_second_part.md": "\uFEFF# Second Part\nMiddle.", "notes.txt": "not a chapter" });
    expect(readBook(book, elsewhere())).toEqual({
      title: "A Made-up Book",
      version: "test 1",
      chapters: [
        { file: "02_second_part.md", position: 2, slug: "second-part", title: "Second Part", body: "# Second Part\nMiddle." },
        { file: "10_last.md", position: 10, slug: "last", title: "Last", body: "# Last\nEnd." },
      ],
    });
  });

  it("refuses a folder inside the repo", () => {
    const book = folder({ "book.json": info, "01_a.md": "# A" });
    expect(() => readBook(book, dir)).toThrow(/inside this repo/);
  });

  it("names every problem, and uploads nothing", () => {
    const book = folder({
      "book.json": JSON.stringify({ title: "", version: "1" }),
      "notes.md": "# Notes",
      "01_a.md": "No heading here",
      "02_b.md": "# B",
      "02_c.md": "# C",
      "03_b.md": "# B again",
      "04_big.md": `# Big\n${"x".repeat(LIMITS.bodyBytes)}`,
      "05_bad.md": Buffer.from([0x23, 0x20, 0xff, 0xfe]),
    });
    let message = "";
    try {
      readBook(book, elsewhere());
    } catch (err) {
      message = err.message;
    }
    for (const part of ["Nothing was uploaded", "book.json: the title", "notes.md: name it", "01_a.md: it needs a \"# \" heading", "02_b.md and 02_c.md have the same number", "02_b.md and 03_b.md have the same address", "04_big.md: it is", "05_bad.md: it is not UTF-8"]) {
      expect(message).toContain(part);
    }
  });

  it("needs book.json and at least one chapter", () => {
    expect(() => readBook(folder({ "01_a.md": "# A" }), elsewhere())).toThrow(/book\.json is missing/);
    expect(() => readBook(folder({ "book.json": info }), elsewhere())).toThrow(/no chapter file/);
  });
});
