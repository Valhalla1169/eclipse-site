// What the owner's tools share. They change the lists that no client can write:
// public.campaign_creators (`npm run creators`, ADR 0005), and public.site_admins and
// public.approved_emails (`npm run admins`, ADR 0014).
//
// They run SQL against the linked Supabase project through the pinned CLI using YOUR
// CLI login (`npx supabase login` / `link` first), so only someone with access to the
// project can use them.
//
// Arguments are plain words, so the same works in any shell, with or without npm:
// node scripts/creators.mjs add you@example.com
// (In PowerShell the "--" separator that older instructions used gets dropped, so it
// is not needed here.)
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "supabase", "dist", "supabase.js");

// The email is interpolated into SQL, so accept only plain email characters
// (no quotes, semicolons, backslashes or whitespace can get through).
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

export function requireEmail(email) {
  if (!EMAIL.test(email || "")) throw new Error("Give a plain email address, for example: add you@example.com");
  return email;
}

// list: { table, script }, a table keyed by user_id. The statements for list, lookup,
// add and remove.
export function listSql(list, command, email) {
  const table = `public.${list.table}`;
  if (command === "list") {
    return `select u.email, c.added_at, c.note from ${table} c join auth.users u on u.id = c.user_id order by c.added_at`;
  }
  if (!["lookup", "add", "remove"].includes(command)) throw new Error("Unknown command: " + command);
  const account = `select id from auth.users where lower(email) = lower('${requireEmail(email)}')`;
  if (command === "lookup") {
    return `select u.id, exists (select 1 from ${table} c where c.user_id = u.id) as listed from auth.users u where u.id in (${account})`;
  }
  if (command === "add") {
    return `insert into ${table} (user_id, note) select id, 'added with npm run ${list.script}' from (${account}) a on conflict (user_id) do nothing returning user_id`;
  }
  return `delete from ${table} where user_id in (${account}) returning user_id`;
}

// Pull the JSON object out of the CLI's output. The result is on stdout; stderr
// carries progress lines ("Initialising login role...") that must not be parsed.
export function parseRows(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in the CLI output");
  return JSON.parse(stdout.slice(start, end + 1)).rows || [];
}

export function runSql(sql) {
  const r = spawnSync(process.execPath, [cli, "db", "query", "--linked", sql], { encoding: "utf8", cwd: root });
  if (r.status !== 0) {
    throw new Error("The Supabase CLI failed. Are you logged in and linked to the project?\n" + ((r.stderr || "") + (r.stdout || "")).trim().slice(-600));
  }
  try {
    return parseRows(r.stdout || "");
  } catch (err) {
    throw new Error("Could not read the Supabase CLI's answer (" + err.message + ").\n" + (r.stdout || "").trim().slice(-400));
  }
}

// PowerShell can drop the "--" that separates npm's flags from ours, and npm then
// swallows a "--print-sql" flag itself, so also accept it as a plain word.
export function readArgs(argv) {
  const args = argv.slice(2);
  const printSql = args.includes("--print-sql") || args.includes("print-sql");
  const [command, email] = args.filter((a) => a !== "--print-sql" && a !== "print-sql");
  return { command, email, printSql };
}

export const isMain = (moduleUrl) => process.argv[1] === fileURLToPath(moduleUrl);

// The usage line, print-sql and errors. run({ command, email }) does the work.
export function main({ commands, usage, sqlFor, run }) {
  const args = readArgs(process.argv);
  try {
    if (!commands.includes(args.command)) {
      console.log(usage);
      process.exit(args.command ? 1 : 0);
    }
    if (args.printSql) console.log(sqlFor(args.command, args.email));
    else run(args);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// list, add or remove for one list. `words` says what to print for each outcome.
export function runListCommand(list, { command, email }, words) {
  if (command === "list") {
    const rows = runSql(listSql(list, "list"));
    if (!rows.length) console.log(words.empty);
    for (const r of rows) console.log(`${r.email}   (added ${String(r.added_at).slice(0, 10)}${r.note ? ", " + r.note : ""})`);
  } else if (command === "add") {
    const found = runSql(listSql(list, "lookup", email));
    if (!found.length) {
      console.log(words.noAccount(email));
      process.exit(1);
    }
    if (found[0].listed) {
      console.log(words.already(email));
    } else {
      runSql(listSql(list, "add", email));
      console.log(words.added(email));
    }
  } else {
    const rows = runSql(listSql(list, "remove", email));
    console.log(rows.length ? words.removed(email) : words.notListed(email));
  }
}
