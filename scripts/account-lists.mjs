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
import { fileURLToPath } from "node:url";
import { supabase, target } from "./supabase-target.mjs";

// npm reads "--staging" and "-staging" as a setting of its own, npm_config_staging, and
// does not give the word to the script, which would then use the live project.
const OUR_WORDS = ["staging", "live", "print-sql"];

// The words after the script's name: { words, project, printSql }. A last word
// `staging` picks the staging project, and is taken off `words`. Throws, with `example`
// as the right form, when npm took one of our words or a word starts with "-".
export function readWords(args, example, env = process.env) {
  const taken = Object.keys(env)
    .map((key) => /^npm_config_(.+)$/i.exec(key)?.[1].toLowerCase().replaceAll("_", "-"))
    .find((word) => OUR_WORDS.includes(word));
  const dashed = args.find((arg) => arg.startsWith("-"));
  if (taken || dashed) {
    const why = taken ? `npm used "${taken}" as its own setting, because a "-" was before it, and did not give it to this script` : `"${dashed}" starts with "-"`;
    throw new Error(`${why}. Nothing was run. Write each word with no "-", for example:\n  ${example}`);
  }
  const printSql = args.includes("print-sql");
  const words = args.filter((arg) => arg !== "print-sql");
  const project = words.at(-1) === "staging" ? "staging" : "live";
  if (project === "staging") words.pop();
  return { words, project, printSql };
}

// Said before a command reaches a project, so a wrong project shows at once.
export function announce(project) {
  console.log(project === "staging" ? `On the staging project (${target("staging").ref}).` : "On the live project.");
}

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

// The CLI stopped with an error, so the SQL did not run to its end.
export class CliFailed extends Error {}

export const LOGIN_HINT = "Are you logged in (npx supabase login), and for the live project, linked to it (npx supabase link)?";

function query(source, project) {
  const r = supabase(target(project), ["db", "query", "--linked", "--output-format", "json", ...source]);
  if (r.status !== 0) {
    throw new CliFailed(`The Supabase CLI failed. ${LOGIN_HINT}\n` + ((r.stderr || "") + (r.stdout || "")).trim().slice(-600));
  }
  try {
    return parseRows(r.stdout || "");
  } catch (err) {
    throw new Error("Could not read the Supabase CLI's answer (" + err.message + ").\n" + (r.stdout || "").trim().slice(-400));
  }
}

// <command> [email] [staging] [print-sql], or null when a word is left over, so that a
// mistyped `staging` never falls back to the live project.
export function readArgs(argv, example, env = process.env) {
  const { words, project, printSql } = readWords(argv.slice(2), example, env);
  const [command, email, ...rest] = words;
  return rest.length ? null : { command, email, printSql, project };
}

export const isMain = (moduleUrl) => process.argv[1] === fileURLToPath(moduleUrl);

// The usage line, print-sql and errors. run({ command, email, project }) does the work.
export function main({ commands, usage, example, sqlFor, run }) {
  try {
    const args = readArgs(process.argv, example);
    if (!args || !commands.includes(args.command)) {
      console.log(usage);
      process.exit(process.argv.length > 2 ? 1 : 0);
    }
    if (args.printSql) {
      console.log(sqlFor(args.command, args.email));
      return;
    }
    announce(args.project);
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
