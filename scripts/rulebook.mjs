// Upload the rulebook (docs/adr/0016). Its text is never in this repo: the repo is
// public, and the book is not.
//
//   npm run rulebook push <folder>             to the live project
//   npm run rulebook push <folder> staging     to the staging project
//
// The folder holds book.json, {"title": "...", "version": "..."}, and one Markdown file
// for each chapter. A file's name gives the chapter's place and address:
// 05_combat_basics.md is place 5, at /rules/combat-basics. Its first "# " heading is its
// title.
//
// It replaces the whole book in one transaction, so a reader sees the old book or the
// new one, never part of each. It prints counts and titles, never the text. How it
// reaches the project: account-lists.mjs.
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseMarkdown, textOf } from "../public/js/markdown.js";
import { isMain, runSqlFile } from "./account-lists.mjs";
import { formatSize, isInside } from "./backup.mjs";
import { root } from "./supabase-target.mjs";

// The same limits as the checks in supabase/migrations/0012_rulebook.sql.
export const LIMITS = { bodyBytes: 262144, title: 200, version: 100 };

const CHAPTER_FILE = /^(\d{1,4})_([a-z0-9]+(?:[_-][a-z0-9]+)*)\.md$/i;

// "05_combat_basics.md" -> { position: 5, slug: "combat-basics" }, or null.
export function chapterFile(name) {
  const m = CHAPTER_FILE.exec(name);
  return m && { position: Number(m[1]), slug: m[2].toLowerCase().replaceAll("_", "-") };
}

// The text of the first "# " heading, read the way the site reads it.
export function chapterTitle(markdown) {
  const heading = parseMarkdown(markdown).find((node) => node.tag === "h1");
  return heading ? textOf(heading).replace(/\s+/g, " ").trim() : "";
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function readText(file) {
  try {
    return decoder.decode(readFileSync(file)).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

function readInfo(folder) {
  let info = null;
  try {
    info = JSON.parse(readText(join(folder, "book.json")));
  } catch {
    // reported below
  }
  if (!info || typeof info !== "object") return { problem: 'book.json is missing, or is not {"title": "...", "version": "..."}.' };
  const title = String(info.title ?? "").trim();
  const version = String(info.version ?? "").trim();
  if (!title || title.length > LIMITS.title) return { problem: `book.json: the title must be 1 to ${LIMITS.title} characters.` };
  if (!version || version.length > LIMITS.version) return { problem: `book.json: the version must be 1 to ${LIMITS.version} characters.` };
  return { title, version };
}

// The book in `folder`, checked: { title, version, chapters: [{ file, position, slug, title, body }] }
// in their order. Throws with every problem it finds.
export function readBook(folder, repo = root) {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${folder} is not a folder.`);
  if (isInside(realpathSync(folder), realpathSync(repo))) {
    throw new Error(`${folder} is inside this repo. The book's text must never be in it: the repo is public.`);
  }
  const { title, version, problem } = readInfo(folder);
  const problems = problem ? [problem] : [];
  const chapters = [];
  const names = readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".md") && statSync(join(folder, name)).isFile());
  for (const file of names.sort()) {
    const place = chapterFile(file);
    const body = readText(join(folder, file));
    const heading = body === null ? "" : chapterTitle(body);
    if (!place) problems.push(`${file}: name it <number>_<words>.md, for example 05_combat_basics.md.`);
    else if (body === null) problems.push(`${file}: it is not UTF-8 text.`);
    else if (body.includes("\0")) problems.push(`${file}: it holds a NUL character.`);
    else if (Buffer.byteLength(body) > LIMITS.bodyBytes) problems.push(`${file}: it is ${formatSize(Buffer.byteLength(body))}, over the ${formatSize(LIMITS.bodyBytes)} a chapter can hold.`);
    else if (!heading || heading.length > LIMITS.title) problems.push(`${file}: it needs a "# " heading of 1 to ${LIMITS.title} characters, the chapter's title.`);
    else chapters.push({ file, ...place, title: heading, body });
  }
  for (const key of ["position", "slug"]) {
    const seen = new Map();
    for (const chapter of chapters) {
      if (seen.has(chapter[key])) problems.push(`${seen.get(chapter[key])} and ${chapter.file} have the same ${key === "slug" ? "address" : "number"}.`);
      else seen.set(chapter[key], chapter.file);
    }
  }
  if (!names.length) problems.push(`There is no chapter file (like 01_introduction.md) in ${folder}.`);
  if (problems.length) throw new Error(`Nothing was uploaded. Fix these first:\n  ${problems.join("\n  ")}`);
  chapters.sort((a, b) => a.position - b.position);
  return { title, version, chapters };
}

// Text in base64, so nothing in a chapter can end the string or add a statement.
export const sqlText = (value) => `convert_from(decode('${Buffer.from(value, "utf8").toString("base64")}', 'base64'), 'UTF8')`;

// One transaction replaces the book, then one row says what the project now holds.
export function pushSql({ title, version, chapters }) {
  const pages = JSON.stringify(chapters.map(({ position, slug, title, body }) => ({ position, slug, title, body })));
  return [
    "begin;",
    "delete from public.rulebook_pages;",
    "insert into public.rulebook_pages (position, slug, title, body)",
    `  select position, slug, title, body from jsonb_to_recordset(${sqlText(pages)}::jsonb)`,
    "    as page (position integer, slug text, title text, body text);",
    `insert into public.rulebook (title, version) values (${sqlText(title)}, ${sqlText(version)})`,
    "  on conflict (id) do update set title = excluded.title, version = excluded.version;",
    "commit;",
    "select b.title, b.version, count(p.slug) as chapters, coalesce(sum(octet_length(p.body)), 0) as bytes",
    "  from public.rulebook b left join public.rulebook_pages p on true group by b.title, b.version;",
  ].join("\n");
}

// Only the database's own error line: the lines after it can quote a chapter's text.
export function databaseError(output) {
  const m = /ERROR:\s+(.*?)(?:\\n|\n|DETAIL|"\}|$)/.exec(output);
  return m ? m[1].replaceAll('\\"', '"').trim() : null;
}

// ["push", folder] or ["push", folder, "staging"]; anything else is null.
export function readArgs(words) {
  const [command, folder, project, ...rest] = words;
  if (command !== "push" || !folder || rest.length || (project !== undefined && project !== "staging")) return null;
  return { folder, project: project || "live" };
}

function push({ folder, project }) {
  const book = readBook(folder);
  if (project === "staging") console.log("On the staging project.");
  console.log(`${book.title}, version ${book.version}: ${book.chapters.length} chapters.`);
  for (const chapter of book.chapters) console.log(`  ${String(chapter.position).padStart(4)}  /rules/${chapter.slug}  ${chapter.title}`);
  const dir = mkdtempSync(join(tmpdir(), "eclipse-rulebook-"));
  try {
    const file = join(dir, "push.sql");
    writeFileSync(file, pushSql(book));
    let stored;
    try {
      [stored] = runSqlFile(file, project);
    } catch (err) {
      throw new Error(`The upload failed, so the book on the project did not change.\n${databaseError(err.message) || err.message}`);
    }
    if (!stored || Number(stored.chapters) !== book.chapters.length) throw new Error("The project did not answer with the new book. Check it on the site.");
    console.log(`Uploaded: ${stored.chapters} chapters, ${formatSize(Number(stored.bytes))} of text.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const args = readArgs(process.argv.slice(2));
  if (!args) {
    console.log("Usage: npm run rulebook push <folder>   (add staging for the staging project)");
    process.exit(process.argv.length > 2 ? 1 : 0);
  }
  try {
    push({ ...args, folder: resolve(process.env.INIT_CWD || process.cwd(), args.folder) });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
