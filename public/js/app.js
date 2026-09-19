// Eclipse SPA entry point: session, routes, and which view to show.
// Loaded as <script type="module"> after /vendor/supabase.js (see index.html).
import * as auth from "./auth.js";
import * as data from "./data.js";
import { createRouter } from "./router.js";
import * as views from "./views.js";
import { friendlyError, isUuid, normalizeCode } from "./util.js";

const ROUTES = [
  { name: "home", pattern: "/" },
  { name: "join", pattern: "/join/:code" },
  { name: "play", pattern: "/campaign/:id/play" },
  { name: "dm", pattern: "/campaign/:id/dm" },
];

const main = document.getElementById("main");
const accountBox = document.getElementById("account");
const accountName = document.getElementById("account-name");
const signOutButton = document.getElementById("sign-out");

const state = {
  session: null,
  profile: null, // null until loaded; false-y means "not created yet" once checked
  profileChecked: false,
  authNotice: null, // one-shot message from a failed or expired sign-in link
};

let router;
let renderToken = 0; // a newer navigation invalidates an older, slower render

function show(node, title, announce = true) {
  main.replaceChildren(node);
  document.title = title ? `${title} - Eclipse` : "Eclipse";
  // After an in-app navigation, move focus to the new heading so keyboard and
  // screen-reader users are told the view changed, the way a full page load
  // would. Not on the first render: focusing <h1> there would make Tab start
  // after the header and skip the skip link.
  const heading = main.querySelector("h1");
  if (heading && announce) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

function updateAccount() {
  const user = state.session && state.session.user;
  accountBox.hidden = !user;
  if (user) accountName.textContent = (state.profile && state.profile.display_name) || user.email || "Signed in";
}

// Returns true when the person is signed in and has a profile. Otherwise it
// shows the sign-in or profile screen itself and returns false.
async function ensureReady({ returnPath, intro, heading, announce }) {
  const user = state.session && state.session.user;
  if (!user) {
    const authNotice = state.authNotice;
    state.authNotice = null;
    show(
      views.signInView({ heading, intro, authNotice, onSubmit: (email) => auth.sendMagicLink(email, returnPath) }),
      "Sign in",
      announce,
    );
    return false;
  }
  if (!state.profileChecked) {
    state.profile = await auth.getProfile(user.id);
    state.profileChecked = true;
    updateAccount();
  }
  if (!state.profile) {
    show(
      views.profileView({
        onSubmit: async (name) => {
          state.profile = await auth.createProfile(user.id, name);
          updateAccount();
          router.go(returnPath, { replace: true });
        },
      }),
      "Choose a name",
      announce,
    );
    return false;
  }
  return true;
}

async function onRoute({ path, match, initial }) {
  const token = ++renderToken;
  const alive = () => token === renderToken;
  const announce = !initial;
  const showHere = (node, title) => show(node, title, announce);
  try {
    if (!match) return showHere(views.notFoundView(), "Not found");

    if (match.name === "home") {
      if (!(await ensureReady({ announce, returnPath: "/" }))) return;
      const userId = state.session.user.id;
      showHere(views.loadingView("Loading your campaign..."));
      const campaigns = await data.listMyCampaigns(userId);
      if (!alive()) return;
      return showHere(
        views.homeView({
          profile: state.profile,
          campaigns,
          onCopy: (text) => navigator.clipboard.writeText(text),
          onJoin: async (code) => router.go(`/join/${encodeURIComponent(code)}`),
          onCreate: async (name) => {
            await data.createCampaign(userId, name);
            router.go("/", { replace: true });
          },
        }),
        campaigns.length === 1 ? "Your campaign" : "Home",
      );
    }

    if (match.name === "join") {
      const code = normalizeCode(match.params.code);
      if (!code) return showHere(views.notFoundView("That invite link does not look right. Ask your DM to send it again."), "Invalid invite");
      if (!(await ensureReady({ announce, returnPath: `/join/${code}`, heading: "Sign in to join", intro: "Sign in and you will be added to the campaign." }))) return;
      showHere(views.loadingView("Joining the campaign..."));
      const joined = await data.joinCampaign(code);
      if (!alive()) return;
      return router.go(`/campaign/${encodeURIComponent(joined.campaign_id)}/play`, { replace: true });
    }

    // play and dm
    if (!isUuid(match.params.id)) return showHere(views.notFoundView("We could not find that campaign."), "Not found");
    if (!(await ensureReady({ announce, returnPath: path }))) return;
    showHere(views.loadingView("Loading the campaign..."));
    const campaign = await data.getCampaign(match.params.id);
    if (!alive()) return;
    if (!campaign) return showHere(views.notFoundView("We could not find that campaign, or you are not a member of it."), "Not found");

    if (match.name === "dm") {
      if (campaign.dm_id !== state.session.user.id) {
        return showHere(views.notFoundView("Only the DM of this campaign can open this page."), "Not allowed");
      }
      const inviteCode = await data.getInviteCode(campaign.id);
      if (!alive()) return;
      return showHere(views.campaignStubView({ campaign, kind: "dm", inviteCode }), campaign.name);
    }
    return showHere(views.campaignStubView({ campaign, kind: "play" }), campaign.name);
  } catch (err) {
    if (!alive()) return;
    console.error(err);
    showHere(views.errorView(friendlyError(err), () => onRoute(router.current())), "Error");
  }
}

async function boot() {
  // Sign-in links come back with ?error=... when expired or already used.
  const urlError = auth.takeAuthErrorFromUrl();
  const { session, error } = await auth.loadSession();
  state.session = session;
  if (urlError) state.authNotice = urlError;
  else if (error && !session) {
    state.authNotice =
      "That sign-in link could not be completed. Open the newest link in the same browser where you asked for it, or request a new one.";
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
      await auth.signOut();
    } catch (err) {
      console.error(err);
    } finally {
      signOutButton.disabled = false;
    }
    router.go("/", { replace: true });
  });

  router = createRouter({ table: ROUTES, onRoute });
  router.start();
}

boot().catch((err) => {
  console.error(err);
  show(views.errorView("The app could not start. Reload the page to try again."), "Error");
});
