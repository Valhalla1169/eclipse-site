// What the owner's tools share. They change the tables that no client can write:
// public.campaign_creators (`npm run creators`, ADR 0005), public.site_admins and
// public.approved_emails (`npm run admins`, ADR 0014), and the rulebook
// (`npm run rulebook`, ADR 0016).
//
// They run SQL on the live project, or on the staging project when the last word is
// `staging` (how: supabase-target.mjs).
//
// Arguments are plain words, so the same works in any shell, with or without npm:
// node scripts/creators.mjs add you@example.com staging
// (In PowerShell the "--" separator that older instructions used gets dropped, so it
// is not needed here.)
import { fileURLToPath } from "node:url";
import { supabase, target } from "./supabase-target.mjs";

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

// Pull the rows out of the CLI's JSON: a list of rows, or { rows } when the CLI sees
// that an agent runs it. The result is on stdout; stderr carries progress lines
// ("Initialising login role...") that must not be parsed.
export function parseRows(stdout) {
  const start = stdout.search(/[[{]/);
  const end = Math.max(stdout.lastIndexOf("]"), stdout.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("no JSON in the CLI output");
  const data = JSON.parse(stdout.slice(start, end + 1));
  return (Array.isArray(data) ? data : data.rows) || [];
}

// project: "live" or "staging".
export const runSql = (sql, project = "live") => query([sql], project);

// For SQL longer than a command line can hold (about 32 KB on Windows).
export const runSqlFile = (file, project = "live") => query(["--file", file], project);

function query(source, project) {
  const r = supabase(target(project), ["db", "query", "--linked", "--output-format", "json", ...source]);
  if (r.status !== 0) {
    throw new Error(`The Supabase CLI failed. Are you logged in (npx supabase login)${project === "live" ? " and linked to the live project" : ""}?\n` + ((r.stderr || "") + (r.stdout || "")).trim().slice(-600));
  }
  try {
    return parseRows(r.stdout || "");
  } catch (err) {
    throw new Error("Could not read the Supabase CLI's answer (" + err.message + ").\n" + (r.stdout || "").trim().slice(-400));
  }
}

// PowerShell can drop the "--" that separates npm's flags from ours, and npm then
// swallows a "--print-sql" flag itself, so also accept it as a plain word. The last
// other word may be `staging`; without it the project is live.
export function readArgs(argv) {
  const args = argv.slice(2);
  const printSql = args.includes("--print-sql") || args.includes("print-sql");
  const words = args.filter((a) => a !== "--print-sql" && a !== "print-sql");
  const project = words.at(-1) === "staging" ? "staging" : "live";
  if (project === "staging") words.pop();
  const [command, email] = words;
  return { command, email, printSql, project };
}

export const isMain = (moduleUrl) => process.argv[1] === fileURLToPath(moduleUrl);

// The usage line, print-sql and errors. run({ command, email, project }) does the work.
export function main({ commands, usage, sqlFor, run }) {
  const args = readArgs(process.argv);
  try {
    if (!commands.includes(args.command)) {
      console.log(usage);
      process.exit(args.command ? 1 : 0);
    }
    if (args.printSql) {
      console.log(sqlFor(args.command, args.email));
      return;
    }
    if (args.project === "staging") console.log(`On the staging project (${target("staging").ref}).`);
    run(args);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// list, add or remove for one list. `words` says what to print for each outcome.
export function runListCommand(list, { command, email, project }, words) {
  if (command === "list") {
    const rows = runSql(listSql(list, "list"), project);
    if (!rows.length) console.log(words.empty);
    for (const r of rows) console.log(`${r.email}   (added ${String(r.added_at).slice(0, 10)}${r.note ? ", " + r.note : ""})`);
  } else if (command === "add") {
    const found = runSql(listSql(list, "lookup", email), project);
    if (!found.length) {
      console.log(words.noAccount(email));
      process.exit(1);
    }
    if (found[0].listed) {
      console.log(words.already(email));
    } else {
      runSql(listSql(list, "add", email), project);
      console.log(words.added(email));
    }
  } else {
    const rows = runSql(listSql(list, "remove", email), project);
    console.log(rows.length ? words.removed(email) : words.notListed(email));
  }
}
