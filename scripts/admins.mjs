// Manage the site admins (public.site_admins), and approve an email by hand
// (public.approved_emails), ADR 0014.
//
//   npm run admins list
//   npm run admins add you@example.com
//   npm run admins remove you@example.com
//   npm run admins approve you@example.com
//   npm run admins add you@example.com print-sql           (show the SQL, run nothing)
//
// A site admin approves emails on the Admin page of the site. `approve` is for when no
// admin can: the owner's own email, before any account exists. `add` needs the account.
// How it runs: account-lists.mjs.
import { isMain, listSql, main, requireEmail, runListCommand, runSql } from "./account-lists.mjs";

const ADMINS = { table: "site_admins", script: "admins" };

export function sqlFor(command, email) {
  if (command === "approve") {
    return `insert into public.approved_emails (email) values (lower('${requireEmail(email)}')) on conflict (email) do nothing returning email`;
  }
  return listSql(ADMINS, command, email);
}

if (isMain(import.meta.url)) {
  main({
    commands: ["list", "add", "remove", "approve"],
    usage: "Usage: npm run admins list | add <email> | remove <email> | approve <email>   (add print-sql to only show the SQL)",
    sqlFor,
    run(args) {
      if (args.command === "approve") {
        const rows = runSql(sqlFor("approve", args.email));
        console.log(rows.length ? `${args.email} is approved. Make the account at https://eclipse.deyderae.dev/signup with exactly that email.` : `${args.email} was already approved.`);
        return;
      }
      runListCommand(ADMINS, args, {
        empty: "Nobody is a site admin yet.",
        noAccount: (email) => `No Eclipse account uses ${email} yet. Run "npm run admins approve ${email}", make the account, then run this again.`,
        already: (email) => `${email} is already a site admin.`,
        added: (email) => `${email} is now a site admin.`,
        removed: (email) => `${email} is no longer a site admin.`,
        notListed: (email) => `${email} was not a site admin.`,
      });
    },
  });
}
