// The single Supabase client for the whole app. Anon key only: every request
// runs as the signed-in user, so RLS and grants decide what it can see.
//
// The library is the vendored bundle at /vendor/supabase.js (npm run vendor),
// loaded by index.html before this module runs. It exposes window.supabase.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const lib = window.supabase;
if (!lib || typeof lib.createClient !== "function") {
  throw new Error("Supabase client library did not load (/vendor/supabase.js)");
}

export const sb = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // PKCE keeps tokens out of the URL, at the cost that a magic link must be
    // opened in the same browser that asked for it. Switching to "implicit"
    // works across devices but puts the tokens in the URL fragment.
    flowType: "pkce",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
