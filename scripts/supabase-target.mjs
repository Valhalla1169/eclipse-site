// Which Supabase project a script reaches, and how: the pinned CLI with YOUR CLI login
// (`npx supabase login`), so only someone with access to the project can use it.
//
// live: the project the repo is linked to (`npx supabase link`, kept in supabase/.temp).
// staging (ADR 0015): a new CLI folder outside the repo for each run, with
// supabase/staging.config.toml as its config.toml, a copy of the migrations, and
// --project-ref on every command. The folder holds no link, so a command in it cannot
// fall back to the live project.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../public/js/config.js";
import { stagingRef } from "./projects.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "supabase", "dist", "supabase.js");

export const LIVE = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
export const STAGING = JSON.parse(readFileSync(join(root, "supabase", "staging.json"), "utf8"));

let stagingDir;

function stagingTarget() {
  const ref = stagingRef(LIVE, STAGING);
  if (!stagingDir) {
    stagingDir = mkdtempSync(join(tmpdir(), "eclipse-staging-"));
    process.on("exit", () => rmSync(stagingDir, { recursive: true, force: true }));
    cpSync(join(root, "supabase", "migrations"), join(stagingDir, "supabase", "migrations"), { recursive: true });
    cpSync(join(root, "supabase", "staging.config.toml"), join(stagingDir, "supabase", "config.toml"));
  }
  return { name: "staging", ref, site: "http://localhost:8787", cwd: stagingDir, flags: ["--workdir", stagingDir, "--project-ref", ref] };
}

// name: "live" or "staging". `site` is where people make an account.
export function target(name) {
  if (name === "staging") return stagingTarget();
  if (name === "live") return { name, site: "https://eclipse.deyderae.dev", cwd: root, flags: [] };
  throw new Error("Unknown project: " + name);
}

// Runs the CLI against a target. `options` go to spawnSync.
export function supabase(to, args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args, ...to.flags], { encoding: "utf8", cwd: to.cwd, ...options });
}
