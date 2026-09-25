// npm run dev [port]: the site on http://localhost:8787 (or the port given), talking to
// the staging project (ADR 0015).
//
// public/ names only the live project, so this serves a copy of it in
// .wrangler/dev-public that changes two files (devRewrites in projects.mjs). The copy
// follows every edit to public/ while it runs.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { devRewrites } from "./projects.mjs";
import { LIVE, root, STAGING } from "./supabase-target.mjs";

const port = process.argv[2] || "8787";
if (!/^\d{2,5}$/.test(port)) {
  console.log("Usage: npm run dev [port]");
  process.exit(1);
}

const src = join(root, "public");
const out = join(root, ".wrangler", "dev-public");
const rewrites = devRewrites(LIVE, STAGING);
const rewritten = new Set(Object.keys(rewrites).map((path) => resolve(src, path)));

// The rewritten files are never copied as they are; writeRewrites writes them.
function copy(path) {
  const from = join(src, path);
  if (existsSync(from)) cpSync(from, join(out, path), { recursive: true, filter: (f) => !rewritten.has(resolve(f)) });
  else rmSync(join(out, path), { recursive: true, force: true });
}

function writeRewrites() {
  for (const [path, rewrite] of Object.entries(rewrites)) {
    const text = rewrite(readFileSync(join(src, path), "utf8"));
    const to = join(out, path);
    if (existsSync(to) && readFileSync(to, "utf8") === text) continue;
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
}

let wrangler;

function stop(err) {
  console.error(`\nnpm run dev stopped: ${err.message}`);
  wrangler?.kill();
  process.exit(1);
}

function update(path) {
  try {
    copy(path);
  } catch (err) {
    console.warn(`npm run dev could not copy public/${path} (${err.message}). Save it again.`);
  }
  try {
    writeRewrites();
  } catch (err) {
    stop(err);
  }
}

rmSync(out, { recursive: true, force: true });
update("");

// An editor can send several events for one save.
const waiting = new Map();
const watcher = watch(src, { recursive: true }, (_event, file) => {
  const path = file || "";
  clearTimeout(waiting.get(path));
  waiting.set(
    path,
    setTimeout(() => {
      waiting.delete(path);
      update(path);
    }, 50),
  );
});

wrangler = spawn(process.execPath, [join(root, "node_modules", "wrangler", "bin", "wrangler.js"), "dev", "--assets", out, "--port", port], { stdio: "inherit", cwd: root });
wrangler.on("exit", (code) => {
  watcher.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => wrangler.kill(signal));
