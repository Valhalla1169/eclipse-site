// Copies pinned third-party files into public/vendor/ and public/fonts/.
//
// The site has no bundler and its CSP allows scripts and fonts from 'self' only,
// so the Supabase client and the sheet fonts are committed as plain files instead
// of loaded from a CDN. Byte-for-byte copies, never edited: bump the version in
// package.json, run `npm install` then `npm run vendor`, and commit the result.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
const vendorDir = join(root, "public", "vendor");
const fontsDir = join(root, "public", "fonts");

const versionOf = (pkgDir) => JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;

const supabaseDir = join(modules, "@supabase", "supabase-js");
mkdirSync(vendorDir, { recursive: true });
copyFileSync(join(supabaseDir, "dist", "umd", "supabase.js"), join(vendorDir, "supabase.js"));
// MIT requires the notice to travel with the code.
copyFileSync(join(supabaseDir, "LICENSE"), join(vendorDir, "LICENSE-supabase-js.txt"));
console.log(`vendored @supabase/supabase-js ${versionOf(supabaseDir)} -> public/vendor/`);

// Latin subset only. Every family is under the SIL Open Font License, which
// requires the license text to travel with the font files.
const FONTS = [
  { pkg: "chakra-petch", weights: [400, 500, 600, 700] },
  { pkg: "ibm-plex-mono", weights: [400, 500, 600] },
  { pkg: "ibm-plex-sans-condensed", weights: [400, 500, 600, 700] },
];
mkdirSync(fontsDir, { recursive: true });
for (const { pkg, weights } of FONTS) {
  const pkgDir = join(modules, "@fontsource", pkg);
  for (const weight of weights) {
    const file = `${pkg}-latin-${weight}-normal.woff2`;
    copyFileSync(join(pkgDir, "files", file), join(fontsDir, file));
  }
  copyFileSync(join(pkgDir, "LICENSE"), join(fontsDir, `LICENSE-${pkg}.txt`));
  console.log(`vendored @fontsource/${pkg} ${versionOf(pkgDir)} -> public/fonts/`);
}
