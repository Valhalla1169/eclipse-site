// Pure helpers: no DOM and no Supabase, so they can be unit-tested in Node.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{6,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 12;
// bcrypt, which Supabase Auth uses, ignores everything after 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

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

// Length matters, character mix does not, and nothing forces a change (NIST 800-63B).
// Returns a message for the person, or null when the password is acceptable. Supabase
// enforces the same minimum on the server; this only gives an early, clearer answer.
export function validatePassword(password, { email = "", displayName = "" } = {}) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters. A phrase of several words works well.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Use at most ${PASSWORD_MAX_BYTES} bytes. That is about ${PASSWORD_MAX_BYTES} letters.`;
  }
  const lower = password.toLowerCase();
  const personal = [email, email.split("@")[0], displayName].map((s) => s.toLowerCase()).filter((s) => s.length >= 4);
  if (personal.some((word) => lower.includes(word))) return "Do not put your name or email in your password.";
  return null;
}

// Where to go after signing in. Only a path on this site is allowed: anything else
// (another site, "//host", a backslash, a space) becomes the home page, so a crafted
// link cannot send a person elsewhere after they sign in.
export function safeNextPath(raw) {
  return typeof raw === "string" && /^\/(?!\/)[^\s\\\u0000-\u001f]*$/.test(raw) ? raw : "/";
}

const MESSAGE_BY_CODE = {
  invalid_credentials: "Email or password is wrong.",
  email_not_confirmed: "Confirm your email first. Use the link we sent you.",
  weak_password: `That password is too weak. Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  same_password: "The new password must be different from the old one.",
  user_already_exists: "We could not create that account. Try signing in instead.",
  email_exists: "We could not create that account. Try signing in instead.",
  otp_expired: "That link has expired. Ask for a new one.",
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  over_email_send_rate_limit: "Too many emails were sent. Wait a while and try again.",
};

// Turn an error from the network, Supabase Auth or Postgres into something a
// player can act on. The raw message is never shown: it can name tables and
// policies.
export function friendlyError(err) {
  const known = err && MESSAGE_BY_CODE[err.code];
  if (known) return known;
  const msg = String((err && err.message) || err || "");
  if (/invalid invite code/i.test(msg)) return "That invite code is not valid. Check it with your DM.";
  if (/you run this campaign/i.test(msg)) return "You are the DM of this campaign, so you cannot join it as a player.";
  if (/only the dm/i.test(msg)) return "Only the DM of this campaign can do that.";
  if (/already revoked|not found, already/i.test(msg)) return "That invite could not be revoked. It may already be revoked.";
  if ((err && err.status === 429) || /rate limit|too many/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/signups? (not allowed|are disabled)|not allowed for otp/i.test(msg)) return "New accounts are closed. Ask your DM to invite you.";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Could not reach the server. Check your connection and try again.";
  if (/changed since you opened it/i.test(msg)) return "Your sheet was changed somewhere else since you opened this page. Reload the page and try again.";
  if (/version was not found|no longer exists/i.test(msg)) return "That version could not be found, so it cannot be restored.";
  if (/not a member of this campaign/i.test(msg)) return "You are not in this campaign, so you cannot change this sheet.";
  if ((err && err.code === "PGRST301") || /jwt expired|invalid jwt/i.test(msg)) return "Your sign-in has ended. Sign in again.";
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

// "just now", "5 minutes ago", "2 days ago": how long ago something was saved.
export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (Number.isNaN(seconds)) return "at an unknown time";
  if (seconds < 45) return "just now";
  const unit = (count, name) => `${count} ${name}${count === 1 ? "" : "s"} ago`;
  if (seconds < 3600) return unit(Math.max(1, Math.round(seconds / 60)), "minute");
  if (seconds < 86400) return unit(Math.round(seconds / 3600), "hour");
  return unit(Math.round(seconds / 86400), "day");
}
