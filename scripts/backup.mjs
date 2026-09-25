// Save a copy of the live data to a file on this computer, outside the repo.
//
//   npm run backup                    (to Documents\Eclipse backups)
//   npm run backup D:\Eclipse         (to another folder)
//
// The file holds every row in the public schema and the accounts (auth.users and
// auth.identities, with emails and password hashes), so keep it secret. The schema is
// not in it: that comes from supabase/migrations. `npm run backup:check <file>` proves
// that a file loads.
//
// pg_dump connects to the linked project's session pooler (supabase/.temp, written by
// `npx supabase link`) and asks for the database password. `npx supabase db dump` needs
// no password, but it runs pg_dump in Docker.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path, { join, resolve } from "node:path";
import { isMain } from "./account-lists.mjs";
import { die, pgTool, root } from "./local-db.mjs";

export const defaultFolder = (home = homedir()) => join(home, "Documents", "Eclipse backups");

export function isInside(folder, parent, p = path) {
  const rel = p.relative(parent, folder);
  return !(rel === ".." || rel.startsWith(".." + p.sep) || p.isAbsolute(rel));
}

// UTC, so the names sort by time: eclipse-backup-2026-09-25-134512Z.sql
export function backupFileName(date) {
  const iso = date.toISOString();
  return `eclipse-backup-${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}Z.sql`;
}

export function dumpUrl(poolerUrl, projectRef) {
  const url = new URL(poolerUrl.trim());
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.password || url.username !== `postgres.${projectRef.trim()}`) {
    throw new Error("not this project's session pooler");
  }
  url.searchParams.set("sslmode", "require");
  return url.href;
}

export const pgDumpArgs = (url, file) => [
  "--data-only",
  "--encoding=UTF8",
  "--strict-names",
  "--table=public.*",
  "--table=auth.users",
  "--table=auth.identities",
  `--file=${file}`,
  `--dbname=${url}`,
];

const COPY = /^COPY (\S+) \((.*)\) FROM stdin;$/;

// The tables in a pg_dump file, with their columns and their number of rows.
export function readCopyBlocks(text) {
  const blocks = [];
  let open = null;
  for (const line of text.split(/\r?\n/)) {
    if (open) {
      if (line === "\\.") open = null;
      else open.rows++;
    } else {
      const m = COPY.exec(line);
      if (m) blocks.push((open = { table: m[1], columns: m[2].split(", "), rows: 0 }));
    }
  }
  return blocks;
}

export const countRows = (text) =>
  Object.fromEntries(
    readCopyBlocks(text)
      .map((b) => [b.table, b.rows])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

const COUNTS = "-- eclipse-backup-counts: ";

export function backupHeader(counts, date) {
  return [
    `-- Eclipse backup from npm run backup, ${date.toISOString()}.`,
    "-- SECRET: it holds every email and password hash. Load it after the migrations:",
    "--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>",
    COUNTS + JSON.stringify(counts),
    "",
    "-- Load the rows as they are: no triggers and no foreign-key checks.",
    "SET session_replication_role = replica;",
    "",
    "",
  ].join("\n");
}

export function readCounts(text) {
  const line = text.slice(0, 4096).split(/\r?\n/).find((l) => l.startsWith(COUNTS));
  try {
    return line ? JSON.parse(line.slice(COUNTS.length)) : null;
  } catch {
    return null;
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// pg_dump writes <file>.partial; the file is written only when the dump is whole.
export function backup({ url, folder, pgDump = pgTool("pg_dump"), now = new Date() }) {
  if (isInside(folder, root)) throw new Error(`${folder} is inside the repo. Keep backups outside it: they hold secrets, and the repo is public.`);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, backupFileName(now));
  const partial = file + ".partial";
  try {
    console.log("pg_dump asks for the database password of the Supabase project.\n");
    const r = spawnSync(pgDump, pgDumpArgs(url, partial), { stdio: "inherit" });
    if (r.error) throw new Error(`Could not run ${pgDump} (${r.error.message}). Install PostgreSQL 17 or newer, or set PG_DUMP to its pg_dump.`);
    if (r.status !== 0) throw new Error("pg_dump failed, so no backup was made.");
    const dump = readFileSync(partial);
    const counts = countRows(dump.toString("utf8"));
    writeFileSync(file, Buffer.concat([Buffer.from(backupHeader(counts, now)), dump]), { flag: "wx" });
    return { file, size: statSync(file).size, counts };
  } finally {
    rmSync(partial, { force: true });
  }
}

function linkedUrl() {
  const read = (name) => readFileSync(join(root, "supabase", ".temp", name), "utf8");
  try {
    return dumpUrl(read("pooler-url"), read("project-ref"));
  } catch {
    throw new Error("Could not find the linked project's session pooler in supabase/.temp. Run: npx supabase link");
  }
}

if (isMain(import.meta.url)) {
  try {
    const arg = process.argv[2];
    const folder = arg ? resolve(process.env.INIT_CWD || process.cwd(), arg) : defaultFolder();
    const { file, size, counts } = backup({ url: linkedUrl(), folder });
    console.log(`\nSaved ${file} (${formatSize(size)})\n\nRows per table:`);
    for (const [table, rows] of Object.entries(counts)) console.log(`  ${table.padEnd(28)} ${rows}`);
    console.log(`\nKeep it secret. Check it with: npm run backup:check "${file}"`);
  } catch (err) {
    die(err.message);
  }
}
