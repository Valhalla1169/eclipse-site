// Rehearse a rules change against real sheets before it ships (docs/adr/0013): load a
// backup into a throwaway database, run the current openSheet on every stored sheet —
// characters, a departed player's kept copy, and every history snapshot — and report
// any that throw, come back read-only, or lose data. This is the tool ADR 0013 said was
// still missing; the per-step unit test it already asks for stays the way to check that
// a migration does the RIGHT rename, not just a harmless one.
//
//   npm run rehearse "C:\Users\you\Documents\Eclipse backups\eclipse-backup-....sql"
//
// Uses the same local Postgres and variables as `npm run test:db`, and backup-check.mjs's
// own loadBackup (harness, every migration, then the file's rows), so a rehearsal proves
// exactly what a real deploy would see. Never touches the Supabase project.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MIGRATIONS, MIGRATION_REWRITES, SCHEMA_VERSION, openSheet, storedVersion } from "../public/js/eclipse-rules.js";
import { isMain } from "./account-lists.mjs";
import { loadBackup } from "./backup-check.mjs";
import { die, dropDb, must, psql, requirePostgres } from "./local-db.mjs";

const SOURCES = ["characters", "departed_sheets", "character_history"];

// A leaf value counts as lost if it was in the stored data and cannot be found anywhere
// in the sheet openSheet returns. Searching the whole tree, not just the same key, lets
// a migration step rename or move a field — the value just moves with it — while still
// catching a step that drops one outright. Blanks, booleans and the small numbers 0 and
// 1 are skipped: they turn up all over a sheet on their own, so losing one means nothing
// and checking it only invites false alarms. A field a step names in MIGRATION_REWRITES
// gets a new value on purpose, so its old value is not counted as lost.
function isInteresting(value) {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return value !== 0 && value !== 1;
  return false;
}

const valueKey = (value) => `${typeof value}:${value}`;

function walkLeaves(value, path, visit) {
  if (Array.isArray(value)) value.forEach((item, i) => walkLeaves(item, `${path}[${i}]`, visit));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) walkLeaves(item, path ? `${path}.${key}` : key, visit);
  } else if (value !== null && value !== undefined) visit(path, value);
}

// Paths in `before` whose value cannot be found anywhere in `after`.
export function findLostValues(before, after) {
  const foundElsewhere = new Set();
  walkLeaves(after, "", (_, value) => foundElsewhere.add(valueKey(value)));
  const lost = [];
  walkLeaves(before, "", (path, value) => {
    if (isInteresting(value) && !foundElsewhere.has(valueKey(value))) lost.push(path);
  });
  return lost;
}

// The paths that the steps from version `from` up to `to` give a new value on purpose.
function rewrittenPaths(rewrites, from, to) {
  return new Set(Object.entries(rewrites).flatMap(([version, paths]) => (Number(version) >= from && Number(version) < to ? paths : [])));
}

// Runs the rules on one stored row. `source` is the table it came from; id and name are
// for the report; schema_version and data are the stored columns.
export function rehearseSheet(
  { source, id, name, schema_version, data },
  { current = SCHEMA_VERSION, steps = MIGRATIONS, rewrites = MIGRATION_REWRITES } = {},
) {
  const base = { source, id, name, schema_version };
  try {
    const { sheet, readOnly, schemaVersion } = openSheet({ data, schema_version }, { current, steps });
    if (readOnly) return { ...base, status: "read-only", detail: `stored version ${schema_version} is newer than the code's ${schemaVersion}` };
    const rewritten = rewrittenPaths(rewrites, storedVersion(schema_version), current);
    const lost = findLostValues(data, sheet).filter((path) => !rewritten.has(path));
    if (lost.length) return { ...base, status: "lost-data", detail: lost };
    return { ...base, status: "ok" };
  } catch (err) {
    return { ...base, status: "throws", detail: err.message };
  }
}

// One line: how many sheets came from each source, at each stored version, and how many failed.
export function summaryLine(results) {
  const bySource = new Map();
  for (const r of results) {
    const versions = bySource.get(r.source) ?? new Map();
    versions.set(r.schema_version, (versions.get(r.schema_version) ?? 0) + 1);
    bySource.set(r.source, versions);
  }
  const parts = [...bySource].map(
    ([source, versions]) => `${source} ${[...versions].sort(([a], [b]) => a - b).map(([v, n]) => `v${v}: ${n}`).join(", ")}`,
  );
  const failed = results.filter((r) => r.status !== "ok").length;
  return `${results.length} sheet(s) rehearsed - ${parts.join("; ")}${failed ? `; ${failed} failed` : "; none failed"}.`;
}

function fetchSheets(db, table) {
  const sql = `select coalesce(json_agg(row_to_json(t)), '[]'::json) from (select id::text as id, character_name, schema_version, data from public.${table} order by id) t;`;
  return JSON.parse(must(psql(["-At", "-c", sql], { db }), `read ${table}`).trim());
}

function rehearse(file, text) {
  const { db } = loadBackup(file, text, { prefix: "eclipse_rehearse" });
  try {
    const results = [];
    for (const source of SOURCES) {
      for (const row of fetchSheets(db, source)) {
        results.push(rehearseSheet({ source, id: row.id, name: row.character_name, schema_version: row.schema_version, data: row.data }));
      }
    }
    return results;
  } finally {
    dropDb(db);
  }
}

if (isMain(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) die('Usage: npm run rehearse "<backup file>"');
  const file = resolve(process.env.INIT_CWD || process.cwd(), arg);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    die(`Could not read ${file} (${err.message}).`);
  }

  requirePostgres("rehearse");
  let results;
  try {
    results = rehearse(file, text);
  } catch (err) {
    die(err.message);
  }

  for (const r of results) {
    if (r.status === "ok") continue;
    const detail = Array.isArray(r.detail) ? r.detail.join(", ") : r.detail;
    console.log(`FAIL  ${r.source.padEnd(18)} id=${r.id} name="${r.name}" v${r.schema_version} ${r.status}: ${detail}`);
  }
  console.log(`\n${summaryLine(results)}`);
  process.exit(results.some((r) => r.status !== "ok") ? 1 : 0);
}
