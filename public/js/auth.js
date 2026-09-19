// Magic-link sign-in, the session, and the profile row.
import { sb } from "./supabase-client.js";

// Resolves once the client has finished initialising, which includes exchanging
// a ?code= from a magic-link redirect for a session. `error` is set when that
// exchange failed (for example, the link was opened in a different browser).
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
    ? "That sign-in link has expired. Request a new one."
    : "That sign-in link did not work. Request a new one.";
}

export function onAuthChange(callback) {
  const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
  return data.subscription;
}

export async function sendMagicLink(email, returnPath) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + returnPath },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getProfile(userId) {
  const { data, error } = await sb.from("profiles").select("id, display_name").eq("id", userId);
  if (error) throw error;
  return data[0] || null;
}

export async function createProfile(userId, displayName) {
  const { data, error } = await sb
    .from("profiles")
    .insert({ id: userId, display_name: displayName })
    .select("id, display_name");
  if (error) throw error;
  return data[0];
}
