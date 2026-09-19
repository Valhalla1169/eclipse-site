// Manage who is allowed to create campaigns (the public.campaign_creators table).
//
//   npm run creators -- list
//   npm run creators -- add you@example.com
//   npm run creators -- remove you@example.com
//   npm run creators -- add you@example.com --print-sql     (show the SQL, run nothing)
//
// The allowlist has no client write access at all (ADR 0005), so this is the only
// way to change it. It runs SQL against the linked Supabase project through the
// pinned CLI using YOUR CLI login (`npx supabase login` / `link` first), so only
// someone with access to the project can use it.
//
// `add` needs the person to have signed in to Eclipse at least once, because the
// allowlist is keyed by their account.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "supabase", "dist", "supabase.js");

// The email is interpolated into SQL, so accept only plain email characters
// (no quotes, semicolons, backslashes or whitespace can get through).
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

export function sqlFor(command, email) {
  if (command === "list") {
    return "select u.email, c.added_at, c.note from public.campaign_creators c join auth.users u on u.id = c.user_id order by c.added_at";
  }
  if (!EMAIL.test(email || "")) throw new Error("Give a plain email address, for example: add you@example.com");
  const who = `lower(email) = lower('${email}')`;
  if (command === "lookup") {
    return `select u.id, exists (select 1 from public.campaign_creators c where c.user_id = u.id) as allowed from auth.users u where ${who.replace("email", "u.email")}`;
  }
  if (command === "add") {
    return `insert into public.campaign_creators (user_id, note) select id, 'added with npm run creators' from auth.users where ${who} on conflict (user_id) do nothing returning user_id`;
  }
  if (command === "remove") {
    return `delete from public.campaign_creators where user_id in (select id from auth.users where ${who}) returning user_id`;
  }
  throw new Error("Unknown command: " + command);
}

function run(sql) {
  const r = spawnSync(process.execPath, [cli, "db", "query", "--linked", sql], { encoding: "utf8", cwd: root });
  const out = (r.stdout || "") + (r.stderr || "");
  const start = out.indexOf("{");
  if (r.status !== 0 || start < 0) throw new Error("The Supabase CLI failed. Are you logged in and linked?\n" + out.trim().slice(-600));
  return JSON.parse(out.slice(start)).rows || [];
}

const [command, email, flag] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (!["list", "add", "remove"].includes(command)) {
      console.log("Usage: npm run creators -- list | add <email> | remove <email> [--print-sql]");
      process.exit(command ? 1 : 0);
    }
    if (flag === "--print-sql" || email === "--print-sql") {
      console.log(sqlFor(command === "list" ? "list" : command, email === "--print-sql" ? undefined : email));
      process.exit(0);
    }
    if (command === "list") {
      const rows = run(sqlFor("list"));
      if (!rows.length) console.log("Nobody is on the allowlist yet, so nobody can create a campaign.");
      for (const r of rows) console.log(`${r.email}   (added ${String(r.added_at).slice(0, 10)}${r.note ? ", " + r.note : ""})`);
    } else if (command === "add") {
      const found = run(sqlFor("lookup", email));
      if (!found.length) {
        console.error(`No Eclipse account uses ${email} yet. Ask them to sign in once at the site, then run this again.`);
        process.exit(1);
      }
      if (found[0].allowed) {
        console.log(`${email} is already allowed to create campaigns.`);
      } else {
        run(sqlFor("add", email));
        console.log(`${email} can now create campaigns.`);
      }
    } else {
      const rows = run(sqlFor("remove", email));
      console.log(rows.length ? `${email} can no longer create campaigns. Their existing campaigns are untouched.` : `${email} was not on the allowlist.`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
