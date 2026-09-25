// Manage who is allowed to create campaigns (the public.campaign_creators table, ADR 0005).
//
//   npm run creators list
//   npm run creators add you@example.com
//   npm run creators remove you@example.com
//   npm run creators add you@example.com print-sql          (show the SQL, run nothing)
//
// The allowlist has no client write access at all, so this is the only way to change
// it. How it runs: account-lists.mjs.
//
// `add` needs the person to have an account, because the allowlist is keyed by it.
import { isMain, listSql, main, runListCommand } from "./account-lists.mjs";

const CREATORS = { table: "campaign_creators", script: "creators" };

export const sqlFor = (command, email) => listSql(CREATORS, command, email);

if (isMain(import.meta.url)) {
  main({
    commands: ["list", "add", "remove"],
    usage: "Usage: npm run creators list | add <email> | remove <email>   (add print-sql to only show the SQL)",
    sqlFor,
    run: (args) =>
      runListCommand(CREATORS, args, {
        empty: "Nobody is on the allowlist yet, so nobody can create a campaign.",
        noAccount: (email) => `No Eclipse account uses ${email} yet. Ask them to make one (a site admin approves the email first), then run this again.`,
        already: (email) => `${email} is already allowed to create campaigns.`,
        added: (email) => `${email} can now create campaigns.`,
        removed: (email) => `${email} can no longer create campaigns. Their existing campaigns are untouched.`,
        notListed: (email) => `${email} was not on the allowlist.`,
      }),
  });
}
