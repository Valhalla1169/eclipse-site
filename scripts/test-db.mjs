// Runs the database test suites against a throwaway database on any Postgres.
//
//   npm run test:db
//
// Use a Postgres 17 to match the live Supabase project. Connection and binaries: see
// local-db.mjs. Nothing touches your Supabase project: this makes its own database,
// applies the harness and every migration, runs every suite, and drops it.
//
// Each suite (supabase/tests/*.test.sql) is self-asserting: it raises on failure and
// psql exits non-zero.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createSchemaDb, dropDb, psql, requirePostgres, testsDir } from "./local-db.mjs";

const dbName = `eclipse_test_${process.pid}`;
const suites = readdirSync(testsDir).filter((f) => f.endsWith(".test.sql")).sort();

requirePostgres("test:db");

let failed = 0;
try {
  try {
    console.log(`applied the harness and ${createSchemaDb(dbName)} migrations\n`);
  } catch (err) {
    console.error(err.message);
    failed++;
  }

  for (const suite of failed ? [] : suites) {
    const r = psql(["-f", join(testsDir, suite)], { db: dbName });
    const output = (r.stdout || "") + (r.stderr || "");
    const checks = (output.match(/NOTICE:\s+ok /g) || []).length;
    if (r.status === 0) {
      console.log(`ok    ${suite.padEnd(28)} ${checks} checks`);
    } else {
      failed++;
      console.log(`FAIL  ${suite.padEnd(28)} ${checks} checks passed before it failed`);
      const lines = output.split("\n").filter((l) => /ERROR|ASSERTION|DETAIL/.test(l));
      console.log(lines.slice(0, 6).map((l) => "      " + l.replace(/^psql:[^ ]+ /, "")).join("\n"));
    }
  }
} finally {
  dropDb(dbName);
}

console.log(failed ? `\n${failed} failure(s)` : `\nall ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
