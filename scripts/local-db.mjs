// The Postgres tools on this computer, and a throwaway database with the harness and
// every migration applied. `npm run test:db` and `npm run backup:check` start from it.
//
// Connection uses the standard libpq environment variables (PGHOST, PGPORT, PGUSER,
// PGPASSWORD). The user needs permission to create databases. PSQL and PG_DUMP name
// the binaries; without them the newest C:\Program Files\PostgreSQL\<n>\bin is used,
// then the PATH.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const testsDir = join(root, "supabase", "tests");
export const migrationsDir = join(root, "supabase", "migrations");

export function pgTool(name, env = process.env) {
  const chosen = env[name.toUpperCase()];
  if (chosen) return chosen;
  const installs = join(env.ProgramFiles || "C:\\Program Files", "PostgreSQL");
  const versions = existsSync(installs) ? readdirSync(installs).filter((v) => /^\d+$/.test(v)) : [];
  for (const version of versions.sort((a, b) => b - a)) {
    const exe = join(installs, version, "bin", `${name}.exe`);
    if (existsSync(exe)) return exe;
  }
  return name;
}

const psqlBin = pgTool("psql");

export function psql(args, { db = "postgres", stopOnError = true } = {}) {
  const flags = ["-X", "-q", "-d", db, ...(stopOnError ? ["-v", "ON_ERROR_STOP=1"] : []), ...args];
  return spawnSync(psqlBin, flags, { encoding: "utf8", cwd: root });
}

// Runs a psql call and throws with just its ERROR lines if it failed. DETAIL and
// CONTEXT lines can quote a whole row, so only ERROR lines are kept.
export function must(r, what) {
  if (r.status !== 0) {
    const errors = (r.stderr || "").split(/\r?\n/).filter((l) => l.includes("ERROR"));
    throw new Error(`Could not ${what}.\n${errors.join("\n") || (r.error ? r.error.message : "")}`);
  }
  return r.stdout;
}

export function die(message) {
  console.error(message);
  process.exit(1);
}

export function requirePostgres(script) {
  const probe = psql(["-At", "-c", "select current_setting('server_version')"]);
  if (probe.error || probe.status !== 0) {
    die(`Could not run psql (${probe.error ? probe.error.message : (probe.stderr || "").trim()}).\nSet PSQL and the PG* variables, for example:\n  PGHOST=127.0.0.1 PGUSER=postgres PSQL="C:/Program Files/PostgreSQL/17/bin/psql.exe" npm run ${script}`);
  }
  console.log(`PostgreSQL ${probe.stdout.trim()} (the live project runs 17)\n`);
}

// Makes the database and applies supabase/tests/local_auth_harness.sql (the platform's
// roles and default privileges), then supabase/migrations/*.sql. Returns how many
// migrations it applied; throws on the first file that fails.
export function createSchemaDb(name) {
  const created = psql(["-c", `create database ${name}`]);
  if (created.status !== 0) throw new Error("Could not create a test database:\n" + (created.error ? created.error.message : created.stderr));
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of [join(testsDir, "local_auth_harness.sql"), ...migrations.map((m) => join(migrationsDir, m))]) {
    const r = psql(["-f", file], { db: name });
    if (r.status !== 0) throw new Error(`FAILED to apply ${file}\n${(r.stderr || "").trim()}`);
  }
  return migrations.length;
}

export function dropDb(name) {
  psql(["-c", `drop database if exists ${name} with (force)`]);
}
