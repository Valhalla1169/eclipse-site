// Prove that a backup loads: make a throwaway database with the harness and every
// migration, load the file, compare each table's rows with the counts that
// `npm run backup` wrote into the file, and drop the database.
//
//   npm run backup:check "C:\Users\you\Documents\Eclipse backups\eclipse-backup-....sql"
//
// It uses the same local Postgres and variables as `npm run test:db` (local-db.mjs). It
// never starts a server and never touches the Supabase project.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMain } from "./account-lists.mjs";
import { readCopyBlocks, readCounts } from "./backup.mjs";
import { createSchemaDb, die, dropDb, psql, requirePostgres } from "./local-db.mjs";

function bare(name) {
  const m = /^"?([a-z_][a-z0-9_]*)"?$/.exec(name);
  if (!m) throw new Error(`Unexpected name in the backup: ${name}`);
  return m[1];
}

// The harness's auth tables have only the columns the migrations use. The backup's
// other auth columns are added as text, so its accounts load too.
// existing: Map of "auth.<table>" to a Set of its column names.
export function authColumnsSql(blocks, existing) {
  const sql = [];
  for (const { table, columns } of blocks.filter((b) => b.table.startsWith("auth."))) {
    const name = bare(table.slice("auth.".length));
    const cols = columns.map(bare);
    const has = existing.get(`auth.${name}`);
    if (!has) sql.push(`create table auth."${name}" (${cols.map((c) => `"${c}" text`).join(", ")});`);
    else for (const c of cols.filter((c) => !has.has(c))) sql.push(`alter table auth."${name}" add column "${c}" text;`);
  }
  return sql.join("\n");
}

// One row per table that is in the backup or in the public schema.
export function compareCounts(expected, found) {
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(found)])].sort();
  return tables.map((table) => ({ table, expected: expected[table] ?? null, found: found[table] ?? null, ok: expected[table] === found[table] }));
}

export function summary({ expected, found, ok }) {
  if (ok) return String(found);
  if (expected === null) return `not in the backup, ${found} loaded`;
  if (found === null) return `${expected} in the backup, but no such table`;
  return `${expected} in the backup, ${found} loaded`;
}

// psql's DETAIL and CONTEXT lines can quote a row, so only the ERROR lines are shown.
function must(r, what) {
  if (r.status !== 0) {
    const errors = (r.stderr || "").split(/\r?\n/).filter((l) => l.includes("ERROR"));
    throw new Error(`Could not ${what}.\n${errors.join("\n") || (r.error ? r.error.message : "")}`);
  }
  return r.stdout;
}

const rowsOf = (stdout) => stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));

function check(file, text, expected) {
  const db = `eclipse_backup_check_${process.pid}`;
  try {
    const migrations = createSchemaDb(db);
    const existing = new Map();
    const columns = must(psql(["-At", "-c", "select table_schema || '.' || table_name || '|' || column_name from information_schema.columns where table_schema = 'auth'"], { db }), "read the auth tables");
    for (const [table, column] of rowsOf(columns)) existing.set(table, (existing.get(table) || new Set()).add(column));
    const extra = authColumnsSql(readCopyBlocks(text), existing);
    if (extra) must(psql(["-c", extra], { db }), "add the backup's auth columns");

    must(psql(["--single-transaction", "-f", file], { db }), "load the backup");
    console.log(`loaded the backup after the harness and ${migrations} migrations\n\nrows per table:`);

    const counted = must(
      psql(["-At", "-c", "select format('%I.%I', schemaname, tablename) || '|' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), false, true, '')))[1] from pg_tables where schemaname in ('public', 'auth')"], { db }),
      "count the rows",
    );
    const found = Object.fromEntries(
      rowsOf(counted)
        .filter(([table]) => table.startsWith("public.") || Object.hasOwn(expected, table))
        .map(([table, n]) => [table, Number(n)]),
    );
    return compareCounts(expected, found);
  } finally {
    dropDb(db);
  }
}

if (isMain(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) die('Usage: npm run backup:check "<backup file>"');
  const file = resolve(process.env.INIT_CWD || process.cwd(), arg);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    die(`Could not read ${file} (${err.message}).`);
  }
  const expected = readCounts(text);
  if (!expected) die(`${file} has no row counts that can be read in its header. Check a file that npm run backup made.`);

  requirePostgres("backup:check");
  let results;
  try {
    results = check(file, text, expected);
  } catch (err) {
    die(err.message);
  }
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.table.padEnd(28)} ${summary(r)}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} table(s) do not match.` : "\nThe backup loads, and every table has the rows the backup counted.");
  process.exit(failed ? 1 : 0);
}
