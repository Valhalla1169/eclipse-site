// Bring the staging project that `npm run dev` uses (ADR 0015) up to date with this repo.
//
//   npm run staging check     what a push would change (read-only)
//   npm run staging push      push new migrations, then supabase/staging.config.toml
//
// It only ever reaches staging (supabase-target.mjs). The live project is `npx supabase
// db push` and `config push` from the repo, as before.
import { target, supabase } from "./supabase-target.mjs";

// The migrations go first: the settings turn on a sign-up hook that a migration makes.
const STEPS = {
  check: [["db", "push", "--dry-run"], ["config", "diff"]],
  push: [["db", "push", "--yes"], ["config", "push", "--yes"]],
};

const command = process.argv[2];
if (!STEPS[command]) {
  console.log("Usage: npm run staging check | push");
  process.exit(command ? 1 : 0);
}

const staging = target("staging");
console.log(`Staging project ${staging.ref}`);
for (const args of STEPS[command]) {
  const r = supabase(staging, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
