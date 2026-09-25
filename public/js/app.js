// Eclipse SPA entry point: session, routes, and which view to show.
// Loaded as <script type="module"> after /vendor/supabase.js (see index.html).
import * as admin from "./admin.js";
import * as auth from "./auth.js";
import * as characters from "./characters.js";
import { activeByCampaign, copyOfRow, describeCharacters, displayName } from "./character-list.js";
import { charactersView, chooseCharacterView, deletedCharacterView } from "./character-views.js";
import * as data from "./data.js";
import { SheetFormatError, openSheet } from "./eclipse-rules.js";
import { h } from "./dom.js";
import { createRouter } from "./router.js";
import { historyView } from "./history-view.js";
import { FALLBACK_REFRESH_MS, createRosterPanel } from "./roster-view.js";
import { createSheetView } from "./sheet/index.js";
import { downloadText, fileNameForName, readSheetFile, serializeStored } from "./sheet/files.js";
import * as views from "./views.js";
import { cleanDisplayName, friendlyError, isUuid, normalizeCode, safeNextPath } from "./util.js";

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
  { name: "choose", pattern: "/campaign/:id/character" },
  { name: "dm", pattern: "/campaign/:id/dm" },
  { name: "dmsheet", pattern: "/campaign/:id/dm/:characterId" },
  { name: "dmhistory", pattern: "/campaign/:id/dm/:characterId/history" },
  { name: "dmsnapshot", pattern: "/campaign/:id/dm/:characterId/history/:historyId" },
  { name: "departed", pattern: "/campaign/:id/left/:copyId" },
];

const main = document.getElementById("main");
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
let disposeView = null; // set by a view that holds page-wide listeners, such as the sheet
let flushView = null; // set by a view that may hold unsaved changes

// options.wide: the sheet needs more room than the account pages. options.roomy: a grid
// of cards uses the full page width. options.dispose: runs when the view is replaced. options.flush: saves what is waiting and resolves
// to false if something could not be saved; mayLeave() calls it before the view is left.
function show(node, title, announce = true, { wide = false, roomy = false, dispose = null, flush = null } = {}) {
  if (disposeView) disposeView();
  disposeView = dispose;
  flushView = flush;
  main.inert = false;
  main.className = wide ? "page page-wide" : roomy ? "page page-roomy" : "page";
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

async function mayLeave(question = "Your latest changes are not saved yet. Leave this page and lose them?") {
  return !flushView || (await flushView()) || window.confirm(question);
}

// The view stays on screen until the next show(). Until then nothing can be typed into
// it, and a redirect on the way does not ask again.
function releaseView() {
  if (!flushView) return;
  flushView = null;
  main.inert = true;
}

function updateAccount() {
  const user = state.session && state.session.user;
  accountBox.hidden = !user;
  adminLink.hidden = !state.isAdmin;
  if (user) accountLink.textContent = (state.profile && state.profile.display_name) || user.email || "Account";
}

const loginPath = (path) => (path === "/" ? "/login" : `/login?next=${encodeURIComponent(path)}`);
const nextFrom = (search) => safeNextPath(new URLSearchParams(search).get("next"));

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
      await ensureAccount(user);
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

    // To anyone else the page does not exist. The database refuses them anyway.
    if (match.name === "admin") {
      if (!(await ensureReady({ path, initial }))) return;
      if (!state.isAdmin) return showHere(views.notFoundView(), "Not found");
      return showHere(
        views.adminView({
          loadAccounts: admin.listAccounts,
          loadPending: admin.listPendingApprovals,
          approveEmail: admin.approveEmail,
          revokeApproval: admin.revokeApproval,
          onCopy: (text) => navigator.clipboard.writeText(text),
        }),
        "Site admin",
      );
    }

    if (match.name === "home") {
      if (!(await ensureReady({ path, initial }))) return;
      showHere(views.loadingView("Loading your campaign..."));
      const [campaigns, canCreate, rows, assignments] = await Promise.all([
        data.listMyCampaigns(user.id),
        data.isCampaignCreator(user.id),
        characters.listCharacters(user.id),
        characters.listMyAssignments(user.id),
      ]);
      if (!alive()) return;
      return showHere(
        views.homeView({
          profile: state.profile,
          campaigns,
          activeByCampaign: activeByCampaign(rows, assignments),
          canCreate,
          onJoin: async (code) => router.go(`/join/${encodeURIComponent(code)}`),
          onLeave: async (campaignId) => {
            await data.leaveCampaign(campaignId);
            router.go("/", { replace: true });
          },
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
      showHere(views.loadingView("Checking the invite..."));
      const preview = await data.previewInvite(code);
      if (!alive()) return;
      const chooser = (campaignId) => `/campaign/${encodeURIComponent(campaignId)}/character`;
      // Already in: nothing to confirm, and re-opening a link is harmless.
      if (preview.already_member) return router.go(chooser(preview.campaign_id), { replace: true });
      return showHere(
        views.joinView({
          preview,
          onJoin: async () => {
            const joined = await data.joinCampaign(code);
            router.go(chooser(joined.campaign_id), { replace: true });
          },
        }),
        `Join ${preview.campaign_name}`,
      );
    }

    if (match.name === "characters") {
      if (!(await ensureReady({ path, initial }))) return;
      return await showCharacters({ user, alive, announce });
    }
    if (match.name === "character" || match.name === "history" || match.name === "snapshot") {
      if (!isUuid(match.params.characterId)) return showHere(views.notFoundView("We could not find that character."), "Not found");
      if (!(await ensureReady({ path, initial }))) return;
      const here = { user, characterId: match.params.characterId, alive, announce };
      if (match.name === "character") return await showSheet(here);
      if (match.name === "history") return await showHistory(here);
      return await showSnapshot({ ...here, historyId: match.params.historyId });
    }

    // choose and the DM's pages
    if (!isUuid(match.params.id)) return showHere(views.notFoundView("We could not find that campaign."), "Not found");
    if (!(await ensureReady({ path, initial }))) return;
    showHere(views.loadingView("Loading the campaign..."));
    const campaign = await data.getCampaign(match.params.id);
    if (!alive()) return;
    if (!campaign) return showHere(views.notFoundView("We could not find that campaign, or you are not a member of it."), "Not found");

    if (match.name === "choose") {
      if (campaign.dm_id === user.id) return showHere(views.dmHasNoSheetView({ campaign }), campaign.name);
      return await showChoose({ campaign, user, alive, announce });
    }

    // Everything else here is the DM's, and read only.
    if (campaign.dm_id !== user.id) {
      return showHere(views.notFoundView("Only the DM of this campaign can open this page."), "Not allowed");
    }
    const inCampaign = { campaign, alive, announce };
    if (match.name === "dmsheet") return await showPlayersSheet({ ...inCampaign, characterId: match.params.characterId });
    if (match.name === "dmhistory") return await showPlayersHistory({ ...inCampaign, characterId: match.params.characterId });
    if (match.name === "dmsnapshot") return await showPlayersSnapshot({ ...inCampaign, characterId: match.params.characterId, historyId: match.params.historyId });
    if (match.name === "departed") return await showDepartedSheet({ ...inCampaign, copyId: match.params.copyId });
    const prefill = { invite: null };
    const roster = createRosterPanel({
      campaign,
      api: { sync: data.syncRoster, subscribe: data.subscribeToRoster },
      download: downloadText,
      actions: {
        onRemove: (playerId) => data.removePlayer(campaign.id, playerId),
        onInviteAgain: (name) => prefill.invite && prefill.invite(name),
      },
    });
    return show(
      views.dmView({
        campaign,
        roster: roster.element,
        loadInvites: () => data.listInvites(campaign.id),
        createInvite: (options) => data.createInvite(campaign.id, options),
        replaceInvite: (id) => data.replaceInvite(id),
        registerPrefill: (fn) => {
          prefill.invite = fn;
        },
        revokeInvite: (id) => data.revokeInvite(id),
        onCopy: (text) => navigator.clipboard.writeText(text),
      }),
      campaign.name,
      announce,
      { dispose: roster.dispose, roomy: true },
    );
  } catch (err) {
    if (!alive()) return;
    console.error(err);
    showHere(views.errorView(friendlyError(err), () => router.refresh()), "Error");
  }
}

const characterPath = (id) => `/characters/${encodeURIComponent(id)}`;
const campaignPath = (campaign) => `/campaign/${encodeURIComponent(campaign.id)}`;
const isHistoryId = (value) => /^\d{1,15}$/.test(value);

const backBar = (href, label, ...more) => h("p", { class: "sheet-back" }, h("a", { class: "btn btn-quiet btn-small", href }, label), ...more);

// Opens a stored sheet, or says it cannot be read (and returns null). The stored copy
// is left exactly as it is.
function openStored(row, { ownSheet, title, announce }) {
  try {
    return openSheet(row);
  } catch (err) {
    if (!(err instanceof SheetFormatError)) throw err;
    console.error(err);
    show(views.sheetUnreadableView({ ownSheet }), title, announce);
    return null;
  }
}

async function loadCharacterList(user) {
  const [rows, assignments, campaigns] = await Promise.all([characters.listCharacters(user.id), characters.listMyAssignments(user.id), data.listMyCampaigns(user.id)]);
  return describeCharacters({ rows, assignments, campaigns });
}

// A person's characters, in or out of a campaign (ADR 0011).
async function showCharacters({ user, alive, announce }) {
  const draw = async (focus) => {
    const list = await loadCharacterList(user);
    if (!alive()) return;
    show(
      charactersView({
        list,
        onCreate: async () => router.go(characterPath((await characters.createCharacter(user.id)).id)),
        onCreateFromFile: async (file) => {
          const sheet = await readSheetFile(file);
          const made = await characters.createCharacter(user.id, { name: (sheet.id.name || "").trim().slice(0, 100), data: sheet });
          router.go(characterPath(made.id));
        },
        onCopy: async (id) => {
          const row = await characters.readCharacter(id);
          if (!row) throw new Error("that character was not found");
          await characters.createCharacter(user.id, copyOfRow(row));
          await draw(false);
        },
        onDelete: async (id) => {
          await characters.deleteCharacter(id);
          await draw(false);
        },
        onUndelete: async (id) => {
          await characters.undeleteCharacter(id);
          await draw(false);
        },
      }),
      "Your characters",
      focus,
      { roomy: true },
    );
  };
  return draw(announce);
}

// Which character the player uses in this campaign.
async function showChoose({ campaign, user, alive, announce }) {
  const list = await loadCharacterList(user);
  if (!alive()) return;
  const choose = async (id) => {
    await characters.chooseCharacter(campaign.id, id);
    router.go(characterPath(id));
  };
  return show(
    chooseCharacterView({
      campaign,
      list,
      onChoose: choose,
      onCreate: async () => choose((await characters.createCharacter(user.id)).id),
    }),
    campaign.name,
    announce,
    { roomy: true },
  );
}

// The player's own character sheet. Nothing is drawn until the row has loaded and been read.
async function showSheet({ user, characterId, alive, announce }) {
  const row = await characters.readCharacter(characterId);
  if (!alive()) return;
  if (!row || row.owner_id !== user.id) return show(views.notFoundView("We could not find that character."), "Not found", announce);
  if (row.deleted_at) return show(deletedCharacterView(), "Deleted character", announce);
  const opened = openStored(row, { ownSheet: true, title: "Character sheet", announce });
  if (!opened) return;
  const sheet = createSheetView({
    opened,
    row,
    persist: characters.saveCharacter,
    onOpenHistory: () => router.go(`${characterPath(row.id)}/history`),
  });
  return show(h("div", {}, backBar("/characters", "Back to my characters"), sheet.element), displayName(row), announce, { wide: true, dispose: sheet.dispose, flush: sheet.flush });
}

// The copies the database has kept of a sheet: its own copy for a download.
async function saveCopyOf(entry) {
  const snapshot = await characters.readSnapshot(entry.id);
  if (!snapshot) throw new Error("that version was not found");
  downloadText(fileNameForName(snapshot.character_name), serializeStored(snapshot));
}

// The copies the database has kept of the player's own sheet (ADR 0010).
async function showHistory({ user, characterId, alive, announce }) {
  const row = await characters.readCharacter(characterId);
  if (!alive()) return;
  if (!row || row.owner_id !== user.id) return show(views.notFoundView("We could not find that character."), "Not found", announce);
  const entries = await characters.listHistory(row.id);
  if (!alive()) return;
  return show(
    historyView({
      badge: displayName(row),
      intro:
        "The site keeps a copy of your sheet before your edits (at most one every 10 minutes) and before each rules update. Each copy below is the sheet as it was just before the time shown. Look at one, then put it back if you want it.",
      back: { href: characterPath(row.id), label: "Back to my sheet" },
      snapshotPath: (entry) => `${characterPath(row.id)}/history/${encodeURIComponent(entry.id)}`,
      entries,
      onSaveCopy: saveCopyOf,
    }),
    "Version history",
    announce,
  );
}

// One old copy, read only, with the choice to put it back.
async function showSnapshot({ user, characterId, historyId, alive, announce }) {
  if (!isHistoryId(historyId)) return show(views.notFoundView("We could not find that version."), "Not found", announce);
  const [row, snapshot] = await Promise.all([characters.readCharacter(characterId), characters.readSnapshot(Number(historyId))]);
  if (!alive()) return;
  if (!row || row.owner_id !== user.id || !snapshot || snapshot.character_id !== row.id) return show(views.notFoundView("We could not find that version of your sheet."), "Not found", announce);
  const opened = openStored(snapshot, { ownSheet: false, title: "Version history", announce });
  if (!opened) return;
  const when = new Date(snapshot.saved_at).toLocaleString();
  const view = createSheetView({
    opened,
    row: { id: snapshot.id, updated_at: snapshot.saved_at },
    readOnlyNotice: `This is your sheet as it was just before ${when}. It is read only, and your current sheet has not changed.`,
  });
  const status = h("span", { class: "status", role: "status", "aria-live": "polite" });
  const restore = h("button", { class: "btn btn-primary btn-small", type: "button" }, "Put this version back");
  restore.addEventListener("click", async () => {
    if (!window.confirm("Put this version back as your sheet? Your current sheet is kept in the history, so you can undo this.")) return;
    restore.disabled = true;
    status.textContent = "";
    try {
      await characters.restoreVersion(snapshot.id, row.updated_at);
      router.go(characterPath(row.id));
    } catch (err) {
      console.error(err);
      status.textContent = `The sheet was not changed. ${friendlyError(err)}`;
      restore.disabled = false;
    }
  });
  const bar = backBar(`${characterPath(row.id)}/history`, "Back to the history", " ", restore, " ", status);
  return show(h("div", {}, bar, view.element), displayName(row), announce, { wide: true, dispose: view.dispose });
}

// ── The DM's pages. Read only, and only for characters active in their campaign. ──

// The DM's read-only view of one player's sheet. It follows the row while it is open.
async function showPlayersSheet({ campaign, characterId, alive, announce }) {
  if (!isUuid(characterId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const assignment = await data.findAssignment(campaign.id, characterId);
  const row = assignment && (await characters.readCharacter(characterId));
  if (!alive()) return;
  if (!row) return show(views.notFoundView("We could not find that sheet in this campaign. The player may have chosen a different character."), "Not found", announce);
  const opened = openStored(row, { ownSheet: false, title: campaign.name, announce });
  if (!opened) return;
  const names = await data.readProfileNames([assignment.player_id]);
  if (!alive()) return;
  const playerName = names[assignment.player_id] || "a player";
  const view = createSheetView({
    opened,
    row,
    readOnlyNotice: `You are viewing ${playerName}'s sheet as the DM. It is read only, and it updates when they make changes.`,
  });
  const status = h("p", { class: "muted", role: "status" });

  let seen = row.updated_at;
  let unsubscribe = () => {};
  let poll = null;
  const stopWatching = () => {
    unsubscribe();
    clearInterval(poll);
  };
  const catchUp = async () => {
    try {
      const latest = await characters.readCharacter(characterId);
      if (!latest) {
        status.textContent = `${playerName} has chosen a different character, or has left. This sheet is no longer updated.`;
        stopWatching();
        return;
      }
      if (latest.updated_at === seen) return;
      seen = latest.updated_at;
      view.update(openSheet(latest));
    } catch (err) {
      console.error(err);
    }
  };
  unsubscribe = data.subscribeToRoster(campaign.id, catchUp, () => {});
  poll = setInterval(catchUp, FALLBACK_REFRESH_MS);
  const bar = backBar(`${campaignPath(campaign)}/dm`, "Back to the DM page", " ", h("a", { class: "btn btn-quiet btn-small", href: `${campaignPath(campaign)}/dm/${encodeURIComponent(characterId)}/history` }, "History"));
  return show(h("div", {}, bar, status, view.element), campaign.name, announce, {
    wide: true,
    dispose() {
      stopWatching();
      view.dispose();
    },
  });
}

// The copies kept of a player's sheet since it became active in the DM's campaign.
async function showPlayersHistory({ campaign, characterId, alive, announce }) {
  if (!isUuid(characterId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const assignment = await data.findAssignment(campaign.id, characterId);
  if (!assignment) return show(views.notFoundView("We could not find that sheet in this campaign."), "Not found", announce);
  const [entries, names] = await Promise.all([characters.listHistory(characterId), data.readProfileNames([assignment.player_id])]);
  if (!alive()) return;
  const sheetPath = `${campaignPath(campaign)}/dm/${encodeURIComponent(characterId)}`;
  return show(
    historyView({
      badge: `${names[assignment.player_id] || "A player"}'s sheet`,
      intro:
        "The site keeps a copy of a sheet before each edit (at most one every 10 minutes) and before each rules update. You see the copies kept since this character became active in your campaign. Each is the sheet as it was just before the time shown. You can only look: a DM never changes a sheet.",
      back: { href: sheetPath, label: "Back to the sheet" },
      snapshotPath: (entry) => `${sheetPath}/history/${encodeURIComponent(entry.id)}`,
      entries,
      onSaveCopy: saveCopyOf,
    }),
    "Version history",
    announce,
  );
}

async function showPlayersSnapshot({ campaign, characterId, historyId, alive, announce }) {
  if (!isUuid(characterId) || !isHistoryId(historyId)) return show(views.notFoundView("We could not find that version."), "Not found", announce);
  const assignment = await data.findAssignment(campaign.id, characterId);
  const snapshot = assignment && (await characters.readSnapshot(Number(historyId)));
  if (!alive()) return;
  if (!snapshot || snapshot.character_id !== characterId) return show(views.notFoundView("We could not find that version of the sheet."), "Not found", announce);
  const opened = openStored(snapshot, { ownSheet: false, title: "Version history", announce });
  if (!opened) return;
  const names = await data.readProfileNames([assignment.player_id]);
  if (!alive()) return;
  const when = new Date(snapshot.saved_at).toLocaleString();
  const view = createSheetView({
    opened,
    row: { id: snapshot.id, updated_at: snapshot.saved_at },
    readOnlyNotice: `This is ${names[assignment.player_id] || "a player"}'s sheet as it was just before ${when}. It is read only.`,
  });
  const bar = backBar(`${campaignPath(campaign)}/dm/${encodeURIComponent(characterId)}/history`, "Back to the history");
  return show(h("div", {}, bar, view.element), campaign.name, announce, { wide: true, dispose: view.dispose });
}

// The sheet as it was when a player left or was removed. It never changes.
async function showDepartedSheet({ campaign, copyId, alive, announce }) {
  if (!isHistoryId(copyId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const copy = await data.readDepartedSheet(Number(copyId));
  if (!alive()) return;
  if (!copy || copy.campaign_id !== campaign.id) return show(views.notFoundView("We could not find that sheet in this campaign."), "Not found", announce);
  const opened = openStored(copy, { ownSheet: false, title: campaign.name, announce });
  if (!opened) return;
  const names = await data.readProfileNames([copy.player_id]);
  if (!alive()) return;
  const when = new Date(copy.kept_at).toLocaleString();
  const view = createSheetView({
    opened,
    row: { id: copy.id, updated_at: copy.kept_at },
    readOnlyNotice: `This is ${names[copy.player_id] || "a player"}'s sheet as it was when ${copy.reason === "removed" ? "you removed them" : "they left"}, on ${when}. It is read only and it does not change.`,
  });
  return show(h("div", {}, backBar(`${campaignPath(campaign)}/dm`, "Back to the DM page"), view.element), campaign.name, announce, { wide: true, dispose: view.dispose });
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
      router.refresh("Your sign-in changed, and your latest changes are not saved yet. Leave this page and lose them?");
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
      await router.leave(signOut, "Your latest changes are not saved yet. Sign out and lose them?");
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
