// Eclipse SPA entry point: session, the router table, and shared startup. Each
// area's route handlers live in their own module (account-routes.js,
// character-routes.js, campaign-routes.js, rulebook-routes.js); this file only
// decides which one a path goes to, and gates routes that need a signed-in person.
// Loaded as <script type="module"> after /vendor/supabase.js (see index.html).
import * as accountRoutes from "./account-routes.js";
import * as admin from "./admin.js";
import * as auth from "./auth.js";
import * as campaignRoutes from "./campaign-routes.js";
import * as characterRoutes from "./character-routes.js";
import * as data from "./data.js";
import { createRouter } from "./router.js";
import { mayLeave, releaseView, show } from "./shell.js";
import * as rulebookRoutes from "./rulebook-routes.js";
import * as views from "./views.js";
import { cleanDisplayName, friendlyError, isUuid, normalizeCode } from "./util.js";

const ROUTES = [
  { name: "home", pattern: "/" },
  { name: "login", pattern: "/login" },
  { name: "signup", pattern: "/signup" },
  { name: "forgot", pattern: "/forgot-password" },
  { name: "reset", pattern: "/reset-password" },
  { name: "account", pattern: "/account" },
  { name: "admin", pattern: "/admin" },
  { name: "join", pattern: "/join/:code" },
  { name: "characters", pattern: "/characters" },
  { name: "character", pattern: "/characters/:characterId" },
  { name: "history", pattern: "/characters/:characterId/history" },
  { name: "snapshot", pattern: "/characters/:characterId/history/:historyId" },
  { name: "rules", pattern: "/rules" },
  { name: "chapter", pattern: "/rules/:slug" },
  { name: "choose", pattern: "/campaign/:id/character" },
  { name: "dm", pattern: "/campaign/:id/keeper" },
  { name: "dmsheet", pattern: "/campaign/:id/keeper/:characterId" },
  { name: "dmhistory", pattern: "/campaign/:id/keeper/:characterId/history" },
  { name: "dmsnapshot", pattern: "/campaign/:id/keeper/:characterId/history/:historyId" },
  { name: "departed", pattern: "/campaign/:id/left/:copyId" },
];

const accountBox = document.getElementById("account");
const accountLink = document.getElementById("account-name");
const adminLink = document.getElementById("admin-link");
const signOutButton = document.getElementById("sign-out");

const state = {
  session: null,
  profile: null, // the signed-in user's profile row
  isAdmin: false, // a site admin (docs/adr/0014), for the Admin link and page
  accountChecked: false, // true once the database has been asked, so a null profile means "not loaded yet"
  authNotice: null, // one-shot message from a failed or expired emailed link
};

let router;
let renderToken = 0; // a newer navigation invalidates an older, slower render

function updateAccount() {
  const user = state.session && state.session.user;
  accountBox.hidden = !user;
  adminLink.hidden = !state.isAdmin;
  if (user) accountLink.textContent = (state.profile && state.profile.display_name) || user.email || "Account";
}

const loginPath = (path) => (path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);

// Once per sign-in: the profile, and whether the person is a site admin. The database
// creates the profile when the account is made; this also covers the rare account that has none.
async function ensureAccount(user) {
  if (state.accountChecked) return;
  const [existing, isAdmin] = await Promise.all([auth.getProfile(user.id), admin.isSiteAdmin()]);
  const name =
    cleanDisplayName(user.user_metadata && user.user_metadata.display_name) ||
    cleanDisplayName(String(user.email || "").split("@")[0]) ||
    "Player";
  state.profile = existing || (await auth.createProfile(user.id, name));
  state.isAdmin = isAdmin;
  state.accountChecked = true;
  updateAccount();
}

// Returns true when the person is signed in. Otherwise it sends them to log in and
// back to `path` afterwards, and returns false.
async function ensureReady({ path, initial }) {
  const user = state.session && state.session.user;
  if (!user) {
    router.go(loginPath(path), { replace: true, initial });
    return false;
  }
  await ensureAccount(user);
  return true;
}

async function onRoute({ path, search, match, initial }) {
  releaseView();
  const token = ++renderToken;
  const alive = () => token === renderToken;
  const announce = !initial;
  const showHere = (node, title) => show(node, title, announce);
  const user = state.session && state.session.user;
  try {
    if (!match) return showHere(views.notFoundView(), "Not found");

    if (match.name === "login" || match.name === "signup") {
      return accountRoutes.showSignIn({ match, search, user, state, router, announce, initial });
    }
    if (match.name === "forgot") return accountRoutes.showForgotPassword({ announce });
    if (match.name === "reset") return await accountRoutes.showResetPassword({ user, state, router, ensureAccount, announce });

    if (match.name === "account") {
      if (!(await ensureReady({ path, initial }))) return;
      return accountRoutes.showAccount({ state, user, router, updateAccount, announce });
    }

    // To anyone else the page does not exist. The database refuses them anyway.
    if (match.name === "admin") {
      if (!(await ensureReady({ path, initial }))) return;
      if (!state.isAdmin) return showHere(views.notFoundView(), "Not found");
      return accountRoutes.showAdmin({ announce });
    }

    if (match.name === "home") {
      if (!(await ensureReady({ path, initial }))) return;
      return await campaignRoutes.showHome({ user, state, router, alive, announce });
    }

    if (match.name === "join") {
      const code = normalizeCode(match.params.code);
      if (!code) return showHere(views.notFoundView("That invite link does not look right. Ask your Keeper to send it again."), "Invalid invite");
      if (!(await ensureReady({ path: `/join/${code}`, initial }))) return;
      return await campaignRoutes.showJoin({ code, router, alive, announce });
    }

    if (match.name === "characters") {
      if (!(await ensureReady({ path, initial }))) return;
      return await characterRoutes.showCharacters({ user, router, alive, announce });
    }
    if (match.name === "character" || match.name === "history" || match.name === "snapshot") {
      if (!isUuid(match.params.characterId)) return showHere(views.notFoundView("We could not find that character."), "Not found");
      if (!(await ensureReady({ path, initial }))) return;
      const here = { user, characterId: match.params.characterId, router, alive, announce };
      if (match.name === "character") return await characterRoutes.showSheet(here);
      if (match.name === "history") return await characterRoutes.showHistory(here);
      return await characterRoutes.showSnapshot({ ...here, historyId: match.params.historyId });
    }

    if (match.name === "rules" || match.name === "chapter") {
      if (!(await ensureReady({ path, initial }))) return;
      return await rulebookRoutes.showRulebook({ slug: match.params.slug, alive, announce });
    }

    // choose and the Keeper's pages
    if (!isUuid(match.params.id)) return showHere(views.notFoundView("We could not find that campaign."), "Not found");
    if (!(await ensureReady({ path, initial }))) return;
    showHere(views.loadingView("Loading the campaign..."));
    const campaign = await data.getCampaign(match.params.id);
    if (!alive()) return;
    if (!campaign) return showHere(views.notFoundView("We could not find that campaign, or you are not a member of it."), "Not found");

    if (match.name === "choose") {
      if (campaign.dm_id === user.id) return showHere(views.dmHasNoSheetView({ campaign }), campaign.name);
      return await characterRoutes.showChoose({ campaign, user, router, alive, announce });
    }

    // Everything else here is the Keeper's, and read only.
    if (campaign.dm_id !== user.id) {
      return showHere(views.notFoundView("Only the Keeper of this campaign can open this page."), "Not allowed");
    }
    const inCampaign = { campaign, alive, announce };
    if (match.name === "dmsheet") return await campaignRoutes.showPlayersSheet({ ...inCampaign, characterId: match.params.characterId });
    if (match.name === "dmhistory") return await campaignRoutes.showPlayersHistory({ ...inCampaign, characterId: match.params.characterId });
    if (match.name === "dmsnapshot") return await campaignRoutes.showPlayersSnapshot({ ...inCampaign, characterId: match.params.characterId, historyId: match.params.historyId });
    if (match.name === "departed") return await campaignRoutes.showDepartedSheet({ ...inCampaign, copyId: match.params.copyId });
    return campaignRoutes.showKeeperHome(inCampaign);
  } catch (err) {
    if (!alive()) return;
    console.error(err);
    showHere(views.errorView(friendlyError(err), () => router.refresh()), "Error");
  }
}

async function boot() {
  // Emailed links come back with ?error=... when expired or already used.
  const urlError = auth.takeAuthErrorFromUrl();
  const { session, error } = await auth.loadSession();
  state.session = session;
  if (urlError) state.authNotice = urlError;
  else if (error && !session) {
    state.authNotice =
      "That link could not be completed here. If you just confirmed your email, sign in now. Otherwise open the newest link in the same browser where you asked for it.";
  }
  updateAccount();

  auth.onAuthChange((event, sessionNow) => {
    // Do not call Supabase from inside this callback (the library can deadlock):
    // defer, and only re-render when the signed-in person actually changed.
    setTimeout(() => {
      const before = state.session && state.session.user ? state.session.user.id : null;
      const after = sessionNow && sessionNow.user ? sessionNow.user.id : null;
      state.session = sessionNow;
      if (before === after) return;
      state.profile = null;
      state.isAdmin = false;
      state.accountChecked = false;
      updateAccount();
      router.refresh("Your sign-in changed, and your latest changes are not saved yet. Leave this page and lose them?", "Continue");
    }, 0);
  });

  const signOut = async () => {
    releaseView();
    try {
      await auth.signOut("local");
    } catch (err) {
      console.error(err);
    }
    router.go("/login", { replace: true });
  };
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      // Signing out ends the session that saves use, so the leave check saves first.
      await router.leave(signOut, "Your latest changes are not saved yet. Sign out and lose them?", "Sign out");
    } finally {
      signOutButton.disabled = false;
    }
  });

  // The sheet's sticky Reference bar sits just under the sticky header.
  const header = document.querySelector(".site-header");
  new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`)).observe(header);

  router = createRouter({ table: ROUTES, onRoute, beforeLeave: mayLeave });
  router.start();
}

boot().catch((err) => {
  console.error(err);
  show(views.errorView("The app could not start. Reload the page to try again."), "Error");
});
