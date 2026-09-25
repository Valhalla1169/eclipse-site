// The site admin's calls (docs/adr/0014): who may make an account. Each runs as the
// signed-in person, and the database refuses anyone who is not a site admin. Reads are
// GET requests, so a page that only looks sends no POST.
import { sb } from "./supabase-client.js";

async function call(name, args, { read = false } = {}) {
  const { data, error } = await sb.rpc(name, args, { get: read });
  if (error) throw error;
  return data;
}

// Only for showing the Admin link and page. The database decides what an admin can do.
export const isSiteAdmin = async () => (await call("is_site_admin", undefined, { read: true })) === true;

// Resolves to the email as stored: trimmed and lower-cased.
export const approveEmail = (email) => call("approve_email", { p_email: email });

export const revokeApproval = (email) => call("revoke_approval", { p_email: email });

// [{ user_id, email, display_name, created_at, last_sign_in_at, is_admin }], oldest first.
export const listAccounts = () => call("list_accounts", undefined, { read: true });

// [{ email, approved_at, approved_by_name }]: approved emails with no account yet.
export const listPendingApprovals = () => call("list_pending_approvals", undefined, { read: true });
