// Runs the database test suites against a throwaway database on any Postgres.
//
//   npm run test:db
//
// Connection uses the standard libpq environment variables (PGHOST, PGPORT,
// PGUSER, PGPASSWORD). Set PSQL to the psql binary if it is not on your PATH. The
// user needs permission to create databases. Use a Postgres 17 to match the live
// Supabase project. Nothing touches your Supabase project: this makes its own
// database, applies the harness and every migration, runs every suite, and drops it.
//
// Order: supabase/tests/local_auth_harness.sql (mirrors the platform's roles and
// default privileges), supabase/migrations/*.sql, then every *.test.sql. Each suite
// is self-asserting: it raises on failure and psql exits non-zero.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const psqlBin = process.env.PSQL || "psql";
const dbName = `eclipse_test_${process.pid}`;
const isSql = (name) => name.endsWith(".sql");

function psql(args, { db = "postgres", stopOnError = true } = {}) {
  const flags = ["-X", "-q", "-d", db, ...(stopOnError ? ["-v", "ON_ERROR_STOP=1"] : []), ...args];
  return spawnSync(psqlBin, flags, { encoding: "utf8", cwd: root });
}

function die(message) {
  console.error(message);
  process.exit(1);
}

const probe = psql(["-At", "-c", "select current_setting('server_version')"]);
if (probe.error || probe.status !== 0) {
  die(`Could not run psql (${probe.error ? probe.error.message : (probe.stderr || "").trim()}).\nSet PSQL and the PG* variables, for example:\n  PGHOST=127.0.0.1 PGUSER=postgres PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" npm run test:db`);
}
console.log(`PostgreSQL ${probe.stdout.trim()} (the live project runs 17)\n`);

const testsDir = join(root, "supabase", "tests");
const migrationsDir = join(root, "supabase", "migrations");
const migrations = readdirSync(migrationsDir).filter(isSql).sort();
const suites = readdirSync(testsDir).filter((f) => f.endsWith(".test.sql")).sort();

let failed = 0;
try {
  const created = psql(["-c", `create database ${dbName}`]);
  if (created.status !== 0) die("Could not create a test database:\n" + created.stderr);

  for (const file of [join(testsDir, "local_auth_harness.sql"), ...migrations.map((m) => join(migrationsDir, m))]) {
    const r = psql(["-f", file], { db: dbName });
    if (r.status !== 0) {
      console.error(`FAILED to apply ${file}\n${(r.stderr || "").trim()}`);
      failed++;
      break;
    }
  }
  if (!failed) console.log(`applied the harness and ${migrations.length} migrations\n`);

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
  psql(["-c", `drop database if exists ${dbName} with (force)`]);
}

console.log(failed ? `\n${failed} failure(s)` : `\nall ${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
