// Eclipse SPA entry point: session, routes, and which view to show.
// Loaded as <script type="module"> after /vendor/supabase.js (see index.html).
import * as auth from "./auth.js";
import * as characters from "./characters.js";
import * as data from "./data.js";
import { SheetFormatError, openSheet } from "./eclipse-rules.js";
import { h } from "./dom.js";
import { createRouter } from "./router.js";
import { FALLBACK_REFRESH_MS, createRosterPanel } from "./roster-view.js";
import { createSheetView } from "./sheet/index.js";
import { downloadText } from "./sheet/files.js";
import * as views from "./views.js";
import { cleanDisplayName, friendlyError, isUuid, normalizeCode, safeNextPath } from "./util.js";

const ROUTES = [
  { name: "home", pattern: "/" },
  { name: "login", pattern: "/login" },
  { name: "signup", pattern: "/signup" },
  { name: "forgot", pattern: "/forgot-password" },
  { name: "reset", pattern: "/reset-password" },
  { name: "account", pattern: "/account" },
  { name: "join", pattern: "/join/:code" },
  { name: "play", pattern: "/campaign/:id/play" },
  { name: "dm", pattern: "/campaign/:id/dm" },
  { name: "dmsheet", pattern: "/campaign/:id/dm/:characterId" },
];

const main = document.getElementById("main");
const accountBox = document.getElementById("account");
const accountLink = document.getElementById("account-name");
const signOutButton = document.getElementById("sign-out");

const state = {
  session: null,
  profile: null, // the signed-in user's profile row
  profileChecked: false, // true once the database has been asked, so a null profile means "not loaded yet"
  authNotice: null, // one-shot message from a failed or expired emailed link
};

let router;
let renderToken = 0; // a newer navigation invalidates an older, slower render
let disposeView = null; // set by a view that holds page-wide listeners, such as the sheet

// options.wide: the sheet needs more room than the account pages. options.dispose:
// runs when the view is replaced.
function show(node, title, announce = true, { wide = false, dispose = null } = {}) {
  if (disposeView) disposeView();
  disposeView = dispose;
  main.className = wide ? "page page-wide" : "page";
  main.replaceChildren(node);
  document.title = title ? `${title} - Eclipse` : "Eclipse";
  // After an in-app navigation, move focus to the new heading so keyboard and
  // screen-reader users are told the view changed, the way a full page load
  // would. Not on the first render: focusing <h1> there would make Tab skip the
  // skip link and the header.
  const heading = main.querySelector("h1");
  if (heading && announce) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

function updateAccount() {
  const user = state.session && state.session.user;
  accountBox.hidden = !user;
  if (user) accountLink.textContent = (state.profile && state.profile.display_name) || user.email || "Account";
}

const loginPath = (path) => (path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);
const nextFrom = (search) => safeNextPath(new URLSearchParams(search).get("next"));

// The database creates the profile when the account is made. This covers the rare
// account that has none.
async function ensureProfile(user) {
  if (state.profileChecked) return;
  const existing = await auth.getProfile(user.id);
  const name =
    cleanDisplayName(user.user_metadata && user.user_metadata.display_name) ||
    cleanDisplayName(String(user.email || "").split("@")[0]) ||
    "Player";
  state.profile = existing || (await auth.createProfile(user.id, name));
  state.profileChecked = true;
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
  await ensureProfile(user);
  return true;
}

async function onRoute({ path, search, match, initial }) {
  const token = ++renderToken;
  const alive = () => token === renderToken;
  const announce = !initial;
  const showHere = (node, title) => show(node, title, announce);
  const user = state.session && state.session.user;
  try {
    if (!match) return showHere(views.notFoundView(), "Not found");

    if (match.name === "login" || match.name === "signup") {
      const next = nextFrom(search);
      if (user) return router.go(next, { replace: true, initial });
      const intro = next.startsWith("/join/") ? "Sign in or create an account to join the campaign." : undefined;
      if (match.name === "signup") {
        return showHere(
          views.signupView({
            next,
            intro,
            onSubmit: async (details) => {
              const result = await auth.signUp({ ...details, next });
              if (result.signedIn) router.go(next, { replace: true });
              return result;
            },
          }),
          "Create an account",
        );
      }
      const authNotice = state.authNotice;
      state.authNotice = null;
      return showHere(
        views.loginView({
          intro,
          authNotice,
          next,
          onPassword: async (email, password) => {
            await auth.signInWithPassword(email, password);
            router.go(next, { replace: true });
          },
          onMagicLink: (email) => auth.sendMagicLink(email, next),
        }),
        "Sign in",
      );
    }

    if (match.name === "forgot") return showHere(views.forgotPasswordView({ onSubmit: auth.sendPasswordReset }), "Reset your password");

    if (match.name === "reset") {
      // The emailed link signs the person in. No session means the link was bad.
      if (!user) return showHere(views.linkExpiredView(), "Link expired");
      await ensureProfile(user);
      return showHere(
        views.resetPasswordView({
          email: user.email,
          displayName: state.profile.display_name,
          onSubmit: async (password) => {
            await auth.updatePassword(password);
            await auth.signOut("others");
            router.go("/", { replace: true });
          },
        }),
        "New password",
      );
    }

    if (match.name === "account") {
      if (!(await ensureReady({ path, initial }))) return;
      return showHere(
        views.accountView({
          profile: state.profile,
          email: user.email,
          onRename: async (name) => {
            await auth.updateDisplayName(user.id, name);
            state.profile = { ...state.profile, display_name: name };
            updateAccount();
          },
          onChangeEmail: auth.updateEmail,
          onChangePassword: auth.updatePassword,
          onReauthenticate: auth.requestReauthentication,
          onSignOutOthers: () => auth.signOut("others"),
          onSignOutEverywhere: async () => {
            await auth.signOut("global");
            router.go("/login", { replace: true });
          },
        }),
        "Your account",
      );
    }

    if (match.name === "home") {
      if (!(await ensureReady({ path, initial }))) return;
      showHere(views.loadingView("Loading your campaign..."));
      const [campaigns, canCreate] = await Promise.all([data.listMyCampaigns(user.id), data.isCampaignCreator(user.id)]);
      if (!alive()) return;
      return showHere(
        views.homeView({
          profile: state.profile,
          campaigns,
          canCreate,
          onJoin: async (code) => router.go(`/join/${encodeURIComponent(code)}`),
          onCreate: async (name) => {
            await data.createCampaign(user.id, name);
            router.go("/", { replace: true });
          },
        }),
        campaigns.length === 1 ? "Your campaign" : "Home",
      );
    }

    if (match.name === "join") {
      const code = normalizeCode(match.params.code);
      if (!code) return showHere(views.notFoundView("That invite link does not look right. Ask your DM to send it again."), "Invalid invite");
      if (!(await ensureReady({ path: `/join/${code}`, initial }))) return;
      showHere(views.loadingView("Joining the campaign..."));
      const joined = await data.joinCampaign(code);
      if (!alive()) return;
      return router.go(`/campaign/${encodeURIComponent(joined.campaign_id)}/play`, { replace: true });
    }

    // play and dm
    if (!isUuid(match.params.id)) return showHere(views.notFoundView("We could not find that campaign."), "Not found");
    if (!(await ensureReady({ path, initial }))) return;
    showHere(views.loadingView("Loading the campaign..."));
    const campaign = await data.getCampaign(match.params.id);
    if (!alive()) return;
    if (!campaign) return showHere(views.notFoundView("We could not find that campaign, or you are not a member of it."), "Not found");

    if (match.name === "dm" || match.name === "dmsheet") {
      if (campaign.dm_id !== user.id) {
        return showHere(views.notFoundView("Only the DM of this campaign can open this page."), "Not allowed");
      }
      if (match.name === "dmsheet") return showPlayersSheet({ campaign, characterId: match.params.characterId, alive, announce });
      const roster = createRosterPanel({ campaign, api: { sync: data.syncRoster, fetchFresh: data.fetchRosterFresh, subscribe: data.subscribeToCharacters }, download: downloadText });
      return show(
        views.dmView({
          campaign,
          roster: roster.element,
          loadInvites: () => data.listInvites(campaign.id),
          createInvite: (options) => data.createInvite(campaign.id, options),
          revokeInvite: (id) => data.revokeInvite(id),
          onCopy: (text) => navigator.clipboard.writeText(text),
        }),
        campaign.name,
        announce,
        { dispose: roster.dispose },
      );
    }
    // play: the player's own sheet. Nothing is drawn until the row has loaded and been read.
    if (campaign.dm_id === user.id) return showHere(views.dmHasNoSheetView({ campaign }), campaign.name);
    const row = await characters.loadCharacter(campaign.id, user.id);
    if (!alive()) return;
    let opened;
    try {
      opened = openSheet(row);
    } catch (err) {
      if (!(err instanceof SheetFormatError)) throw err;
      console.error(err);
      return showHere(views.sheetUnreadableView({ campaign }), campaign.name);
    }
    const sheet = createSheetView({ campaign, opened, row, persist: characters.saveCharacter });
    return show(sheet.element, campaign.name, announce, { wide: true, dispose: sheet.dispose });
  } catch (err) {
    if (!alive()) return;
    console.error(err);
    showHere(views.errorView(friendlyError(err), () => onRoute(router.current())), "Error");
  }
}

// The DM's read-only view of one player's sheet. It follows the row while it is open.
async function showPlayersSheet({ campaign, characterId, alive, announce }) {
  if (!isUuid(characterId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const row = await characters.readCharacter(characterId);
  if (!alive()) return;
  if (!row || row.campaign_id !== campaign.id) return show(views.notFoundView("We could not find that sheet in this campaign."), "Not found", announce);
  let opened;
  try {
    opened = openSheet(row);
  } catch (err) {
    if (!(err instanceof SheetFormatError)) throw err;
    console.error(err);
    return show(views.sheetUnreadableView({ campaign, ownSheet: false }), campaign.name, announce);
  }
  const names = await data.readProfileNames([row.owner_id]);
  if (!alive()) return;
  const view = createSheetView({ campaign, opened, row, viewer: "dm", playerName: names[row.owner_id] || "a player" });

  let seen = row.updated_at;
  const catchUp = async () => {
    try {
      const latest = await characters.readCharacter(characterId);
      if (!latest || latest.updated_at === seen) return;
      seen = latest.updated_at;
      view.update(openSheet(latest));
    } catch (err) {
      console.error(err);
    }
  };
  const unsubscribe = data.subscribeToCharacters(campaign.id, catchUp, () => {});
  const poll = setInterval(catchUp, FALLBACK_REFRESH_MS);
  const back = h("a", { class: "btn btn-quiet btn-small", href: `/campaign/${encodeURIComponent(campaign.id)}/dm` }, "Back to the DM page");
  return show(h("div", {}, h("p", { class: "sheet-back" }, back), view.element), campaign.name, announce, {
    wide: true,
    dispose() {
      unsubscribe();
      clearInterval(poll);
      view.dispose();
    },
  });
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
      state.profileChecked = false;
      updateAccount();
      onRoute(router.current());
    }, 0);
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      await auth.signOut("local");
    } catch (err) {
      console.error(err);
    } finally {
      signOutButton.disabled = false;
    }
    router.go("/login", { replace: true });
  });

  router = createRouter({ table: ROUTES, onRoute });
  router.start();
}

boot().catch((err) => {
  console.error(err);
  show(views.errorView("The app could not start. Reload the page to try again."), "Error");
});
