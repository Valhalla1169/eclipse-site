// Copies the pinned browser bundle of @supabase/supabase-js into public/vendor/.
//
// The site has no bundler and its CSP allows scripts from 'self' only, so the
// client library is committed as a plain file instead of loaded from a CDN.
// Byte-for-byte copy, never edited: bump the version in package.json, run
// `npm install` then `npm run vendor`, and commit the result.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "@supabase", "supabase-js");
const outDir = join(root, "public", "vendor");

const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
mkdirSync(outDir, { recursive: true });
copyFileSync(join(pkgDir, "dist", "umd", "supabase.js"), join(outDir, "supabase.js"));
// MIT requires the notice to travel with the code.
copyFileSync(join(pkgDir, "LICENSE"), join(outDir, "LICENSE-supabase-js.txt"));

console.log(`vendored @supabase/supabase-js ${version} -> public/vendor/`);
