// Manage the site admins (public.site_admins), and approve an email by hand
// (public.approved_emails), ADR 0014.
//
//   npm run admins list
//   npm run admins add you@example.com
//   npm run admins remove you@example.com
//   npm run admins approve you@example.com
//   npm run admins add you@example.com print-sql           (show the SQL, run nothing)
//   npm run admins approve you@example.com staging         (on the staging project)
//
// A site admin approves emails on the Admin page of the site. `approve` is for when no
// admin can: the owner's own email, before any account exists. `add` needs the account.
// How it runs: account-lists.mjs.
import { isMain, listSql, main, requireEmail, runListCommand, runSql } from "./account-lists.mjs";
import { target } from "./supabase-target.mjs";

const ADMINS = { table: "site_admins", script: "admins" };

// `approve` approves the email for 7 days, or renews its approval.
export function sqlFor(command, email) {
  if (command === "approve") {
    return `insert into public.approved_emails (email) values (lower('${requireEmail(email)}')) on conflict (email) do update set approved_at = default, expires_at = default returning email, expires_at`;
  }
  return listSql(ADMINS, command, email);
}

if (isMain(import.meta.url)) {
  main({
    commands: ["list", "add", "remove", "approve"],
    usage: "Usage: npm run admins list | add <email> | remove <email> | approve <email>   (add staging for the staging project, or print-sql to only show the SQL)",
    sqlFor,
    run(args) {
      if (args.command === "approve") {
        const [row] = runSql(sqlFor("approve", args.email), args.project);
        console.log(`${args.email} is approved until ${String(row.expires_at).slice(0, 16)}. Make the account now at ${target(args.project).site}/signup with exactly that email, and confirm it.`);
        return;
      }
      const staging = args.project === "staging" ? " staging" : "";
      runListCommand(ADMINS, args, {
        empty: "Nobody is a site admin yet.",
        noAccount: (email) => `No Eclipse account uses ${email} yet. Run "npm run admins approve ${email}${staging}", make the account, then run this again.`,
        already: (email) => `${email} is already a site admin.`,
        added: (email) => `${email} is now a site admin.`,
        removed: (email) => `${email} is no longer a site admin.`,
        notListed: (email) => `${email} was not a site admin.`,
      });
    },
  });
}
