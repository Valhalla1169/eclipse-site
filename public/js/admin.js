// The site admin's calls (docs/adr/0014): who may make an account. Each runs as the
// signed-in person, and the database refuses anyone who is not a site admin. Reads are
// GET requests, so a page that only looks sends no POST.
import { sb } from "./supabase-client.js";

async function call(name, args, { read = false } = {}) {
  const { data, error } = await sb.rpc(name, args, { get: read });
  if (error) throw error;
  return data;
}

// Only for showing the Admin link and page. A failed check counts as "not an admin", so
// it never stops a page: the database checks every admin action itself.
export async function isSiteAdmin() {
  try {
    return (await call("is_site_admin", undefined, { read: true })) === true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// Approves an email for 7 days, or renews its approval. Resolves to { email, has_account,
// expires_at }: the email as stored (trimmed, lower-cased), and has_account true when it
// already has an account, which needs no approval.
export const approveEmail = async (email) => (await call("approve_email", { p_email: email }))[0];

export const revokeApproval = (email) => call("revoke_approval", { p_email: email });

// [{ user_id, email, display_name, created_at, last_sign_in_at, email_confirmed_at, is_admin }],
// oldest first. email_confirmed_at is null until the account's email is confirmed.
export const listAccounts = () => call("list_accounts", undefined, { read: true });

// [{ email, approved_at, expires_at, approved_by_name }]: approvals that no confirmed account
// uses, expired ones too.
export const listPendingApprovals = () => call("list_pending_approvals", undefined, { read: true });
