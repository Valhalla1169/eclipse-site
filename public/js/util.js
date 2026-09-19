// Pure helpers: no DOM and no Supabase, so they can be unit-tested in Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{6,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

// Invite codes are upper-case alphanumerics (the database enforces the same
// shape). Typed or pasted codes get trimmed and upper-cased first.
export function normalizeCode(raw) {
  const code = String(raw ?? "").trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

export function cleanDisplayName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 40 ? name : null;
}

export function cleanCampaignName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 80 ? name : null;
}

// Turn an error from the network, Supabase Auth or Postgres into something a
// player can act on. The raw message is never shown: it can name tables and
// policies.
export function friendlyError(err) {
  const msg = String((err && err.message) || err || "");
  const status = err && (err.status || err.code);
  if (/invalid invite code/i.test(msg)) return "That invite code is not valid. Check it with your DM.";
  if (/you run this campaign/i.test(msg)) return "You are the DM of this campaign, so you cannot join it as a player.";
  if (/only the dm/i.test(msg)) return "Only the DM of this campaign can do that.";
  if (/already revoked|not found, already/i.test(msg)) return "That invite could not be revoked. It may already be revoked.";
  if (status === 429 || /rate limit|too many/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/signups? (not allowed|are disabled)|not allowed for otp/i.test(msg)) return "New accounts are closed. Ask your DM to invite you.";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Could not reach the server. Check your connection and try again.";
  if (/permission denied|row-level security|42501/i.test(msg)) return "You do not have access to that.";
  return "Something went wrong. Please try again.";
}

// What an invite is doing right now, for the DM's list.
export function inviteStatus(invite, now = Date.now()) {
  if (invite.revoked_at) return "revoked";
  if (invite.use_count >= invite.max_uses) return "used up";
  if (new Date(invite.expires_at).getTime() <= now) return "expired";
  return "active";
}
