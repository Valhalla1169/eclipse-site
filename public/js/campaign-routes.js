// Route handlers for a campaign: the home page, joining by invite, and the Keeper's
// pages (the roster, invites, and every read-only view of a player's sheet).
import { activeByCampaign } from "./character-list.js";
import { isHistoryId, saveCopyOf } from "./character-routes.js";
import * as characters from "./characters.js";
import * as data from "./data.js";
import { h } from "./dom.js";
import { historyView } from "./history-view.js";
import { createInvitePanel } from "./invite-panel.js";
import { FALLBACK_REFRESH_MS, createRosterPanel } from "./roster-view.js";
import { downloadText } from "./sheet/files.js";
import { openSheet } from "./eclipse-rules.js";
import { showReadOnlySheet } from "./sheet-page.js";
import { show } from "./shell.js";
import { isUuid } from "./util.js";
import * as views from "./views.js";

export const campaignPath = (campaign) => `/campaign/${encodeURIComponent(campaign.id)}`;

// The signed-in person's home page: every campaign they are in (ADR 0014 says at
// most 4), or a way to join or create one.
export async function showHome({ user, state, router, alive, announce }) {
  show(views.loadingView("Loading your campaign..."), null, announce);
  const [campaigns, canCreate, rows, assignments] = await Promise.all([
    data.listMyCampaigns(user.id),
    data.isCampaignCreator(user.id),
    characters.listCharacters(user.id),
    characters.listMyAssignments(user.id),
  ]);
  if (!alive()) return;
  return show(
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
    announce,
  );
}

// Confirming an invite link (ADR 0012): nothing joins until the player presses the button.
export async function showJoin({ code, router, alive, announce }) {
  show(views.loadingView("Checking the invite..."), null, announce);
  const preview = await data.previewInvite(code);
  if (!alive()) return;
  const chooser = (campaignId) => `/campaign/${encodeURIComponent(campaignId)}/character`;
  // Already in: nothing to confirm, and re-opening a link is harmless.
  if (preview.already_member) return router.go(chooser(preview.campaign_id), { replace: true });
  return show(
    views.joinView({
      preview,
      onJoin: async () => {
        const joined = await data.joinCampaign(code);
        router.go(chooser(joined.campaign_id), { replace: true });
      },
    }),
    `Join ${preview.campaign_name}`,
    announce,
  );
}

// ── The Keeper's pages. Read only, and only for characters active in their campaign. ──

// The Keeper's read-only view of one player's sheet. It follows the row while it is open.
export async function showPlayersSheet({ campaign, characterId, alive, announce }) {
  if (!isUuid(characterId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const assignment = await data.findAssignment(campaign.id, characterId);
  const row = assignment && (await characters.readCharacter(characterId));
  if (!alive()) return;
  if (!row) return show(views.notFoundView("We could not find that sheet in this campaign. The player may have chosen a different character."), "Not found", announce);
  const status = h("p", { class: "muted", role: "status" });

  let seen = row.updated_at;
  let unsubscribe = () => {};
  let poll = null;
  const stopWatching = () => {
    unsubscribe();
    clearInterval(poll);
  };

  const view = await showReadOnlySheet(row, {
    ownSheet: false,
    title: campaign.name,
    announce,
    alive,
    describe: async () => {
      const names = await data.readProfileNames([assignment.player_id]);
      const playerName = names[assignment.player_id] || "a player";
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
      return {
        readOnlyNotice: `You are viewing ${playerName}'s sheet as the Keeper. It is read only, and it updates when they make changes.`,
        back: { href: `${campaignPath(campaign)}/keeper`, label: "Back to the Keeper page", more: [" ", h("a", { class: "btn btn-quiet btn-small", href: `${campaignPath(campaign)}/keeper/${encodeURIComponent(characterId)}/history` }, "History")] },
        extra: [status],
        dispose: (sheetView) => () => {
          stopWatching();
          sheetView.dispose();
        },
      };
    },
  });
  return view;
}

// The copies kept of a player's sheet since it became active in the Keeper's campaign.
export async function showPlayersHistory({ campaign, characterId, alive, announce }) {
  if (!isUuid(characterId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const assignment = await data.findAssignment(campaign.id, characterId);
  if (!assignment) return show(views.notFoundView("We could not find that sheet in this campaign."), "Not found", announce);
  const [entries, names] = await Promise.all([characters.listHistory(characterId), data.readProfileNames([assignment.player_id])]);
  if (!alive()) return;
  const sheetPath = `${campaignPath(campaign)}/keeper/${encodeURIComponent(characterId)}`;
  return show(
    historyView({
      badge: `${names[assignment.player_id] || "A player"}'s sheet`,
      intro:
        "The site keeps a copy of a sheet before each edit (at most one every 10 minutes) and before each rules update. You see the copies kept since this character became active in your campaign. Each is the sheet as it was just before the time shown. You can only look: a Keeper never changes a sheet.",
      back: { href: sheetPath, label: "Back to the sheet" },
      snapshotPath: (entry) => `${sheetPath}/history/${encodeURIComponent(entry.id)}`,
      entries,
      onSaveCopy: saveCopyOf,
    }),
    "Version history",
    announce,
  );
}

export async function showPlayersSnapshot({ campaign, characterId, historyId, alive, announce }) {
  if (!isUuid(characterId) || !isHistoryId(historyId)) return show(views.notFoundView("We could not find that version."), "Not found", announce);
  const assignment = await data.findAssignment(campaign.id, characterId);
  const snapshot = assignment && (await characters.readSnapshot(Number(historyId)));
  if (!alive()) return;
  if (!snapshot || snapshot.character_id !== characterId) return show(views.notFoundView("We could not find that version of the sheet."), "Not found", announce);
  const when = new Date(snapshot.saved_at).toLocaleString();
  return showReadOnlySheet(snapshot, {
    ownSheet: false,
    title: "Version history",
    announce,
    alive,
    sheetRow: { id: snapshot.id, updated_at: snapshot.saved_at },
    describe: async () => {
      const names = await data.readProfileNames([assignment.player_id]);
      return {
        readOnlyNotice: `This is ${names[assignment.player_id] || "a player"}'s sheet as it was just before ${when}. It is read only.`,
        back: { href: `${campaignPath(campaign)}/keeper/${encodeURIComponent(characterId)}/history`, label: "Back to the history" },
      };
    },
  });
}

// The sheet as it was when a player left or was removed. It never changes.
export async function showDepartedSheet({ campaign, copyId, alive, announce }) {
  if (!isHistoryId(copyId)) return show(views.notFoundView("We could not find that sheet."), "Not found", announce);
  const copy = await data.readDepartedSheet(Number(copyId));
  if (!alive()) return;
  if (!copy || copy.campaign_id !== campaign.id) return show(views.notFoundView("We could not find that sheet in this campaign."), "Not found", announce);
  const when = new Date(copy.kept_at).toLocaleString();
  return showReadOnlySheet(copy, {
    ownSheet: false,
    title: campaign.name,
    announce,
    alive,
    sheetRow: { id: copy.id, updated_at: copy.kept_at },
    describe: async () => {
      const names = await data.readProfileNames([copy.player_id]);
      return {
        readOnlyNotice: `This is ${names[copy.player_id] || "a player"}'s sheet as it was when ${copy.reason === "removed" ? "you removed them" : "they left"}, on ${when}. It is read only and it does not change.`,
        back: { href: `${campaignPath(campaign)}/keeper`, label: "Back to the Keeper page" },
      };
    },
  });
}

// The Keeper's main page: the roster (roster-view.js) and invite management
// (invite-panel.js, ADR 0005, 0012).
export function showKeeperHome({ campaign, announce }) {
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
  const invites = createInvitePanel({
    loadInvites: () => data.listInvites(campaign.id),
    createInvite: (options) => data.createInvite(campaign.id, options),
    replaceInvite: (id) => data.replaceInvite(id),
    revokeInvite: (id) => data.revokeInvite(id),
    onCopy: (text) => navigator.clipboard.writeText(text),
    registerPrefill: (fn) => {
      prefill.invite = fn;
    },
  });
  show(
    h(
      "div",
      { class: "stack" },
      h("div", { class: "card-head" }, h("h1", {}, campaign.name), h("span", { class: "badge" }, "Keeper view")),
      roster.element,
      invites.element,
    ),
    campaign.name,
    announce,
    { dispose: roster.dispose, roomy: true },
  );
}
