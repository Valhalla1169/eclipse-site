// Accounts: sign-up, password and magic-link sign-in, recovery, and the profile row.
// Passwords are only ever sent to Supabase Auth over TLS. Nothing here stores, hashes
// or logs one.
import { sb } from "./supabase-client.js";
import { isUnapprovedEmail } from "./util.js";

const absolute = (path) => location.origin + path;

// Resolves once the client has finished initialising, which includes exchanging
// a ?code= from an emailed link for a session. `error` is set when that exchange
// failed (for example, the link was opened in a different browser).
export async function loadSession() {
  const { data, error } = await sb.auth.getSession();
  return { session: data ? data.session : null, error };
}

// Supabase redirects back with ?error=...&error_description=... (or the same in
// the URL fragment) when a link is expired or already used. Read it once and
// clean the URL so a refresh does not show it again.
export function takeAuthErrorFromUrl() {
  const merged = new URLSearchParams(location.search);
  for (const [k, v] of new URLSearchParams(location.hash.replace(/^#/, ""))) merged.set(k, v);
  if (!merged.has("error") && !merged.has("error_code")) return null;
  const code = merged.get("error_code") || merged.get("error") || "";
  history.replaceState({}, "", location.pathname);
  return /expired/i.test(code) || /expired/i.test(merged.get("error_description") || "")
    ? "That link has expired. Ask for a new one."
    : "That link did not work. Ask for a new one.";
}

export function onAuthChange(callback) {
  const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
  return data.subscription;
}

// With email confirmation on, no session comes back until the emailed link is used.
// An email no site admin approved is answered like any other: see isUnapprovedEmail.
export async function signUp({ email, password, displayName, next }) {
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: absolute(next) },
  });
  if (error && !isUnapprovedEmail(error)) throw error;
  return { signedIn: Boolean(data.session) };
}

export async function signInWithPassword(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// A link for a new email makes its account, so an email no site admin approved is refused.
export async function sendMagicLink(email, returnPath) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: absolute(returnPath) } });
  if (error && !isUnapprovedEmail(error)) throw error;
}

export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: absolute("/reset-password") });
  if (error) throw error;
}

// Right after a recovery link, or a recent sign-in, no code is needed. Otherwise
// Auth answers "reauthentication_needed": call requestReauthentication(), then pass
// the emailed code as `nonce`.
export async function updatePassword(password, nonce) {
  const { error } = await sb.auth.updateUser(nonce ? { password, nonce } : { password });
  if (error) throw error;
}

export async function requestReauthentication() {
  const { error } = await sb.auth.reauthenticate();
  if (error) throw error;
}

// Both the old and the new address must confirm (a project setting).
export async function updateEmail(email) {
  const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: absolute("/account") });
  if (error) throw error;
}

// scope: "local" this browser, "others" every other session, "global" everywhere.
export async function signOut(scope = "local") {
  const { error } = await sb.auth.signOut({ scope });
  if (error) throw error;
}

export async function getProfile(userId) {
  const { data, error } = await sb.from("profiles").select("id, display_name").eq("id", userId);
  if (error) throw error;
  return data[0] || null;
}

// Normally the database creates the profile when the account is made. This only
// covers an account whose profile is missing.
export async function createProfile(userId, displayName) {
  const { data, error } = await sb
    .from("profiles")
    .insert({ id: userId, display_name: displayName })
    .select("id, display_name");
  if (error) throw error;
  return data[0];
}

export async function updateDisplayName(userId, displayName) {
  const { error } = await sb.from("profiles").update({ display_name: displayName }).eq("id", userId);
  if (error) throw error;
}
