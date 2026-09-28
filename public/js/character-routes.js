// Route handlers for a person's own characters (docs/adr/0011): the list, the sheet,
// its history, and which character is active in a campaign.
import { copyOfRow, describeCharacters, displayName } from "./character-list.js";
import { charactersView, chooseCharacterView, deletedCharacterView } from "./character-views.js";
import * as characters from "./characters.js";
import { confirmAction } from "./confirm-dialog.js";
import * as data from "./data.js";
import { h } from "./dom.js";
import { downloadText, fileNameForName, readSheetFile, serializeStored } from "./sheet/files.js";
import { backBar, openStored, showReadOnlySheet } from "./sheet-page.js";
import { createSheetView } from "./sheet/index.js";
import { show } from "./shell.js";
import { historyView } from "./history-view.js";
import { friendlyError } from "./util.js";
import * as views from "./views.js";

export const characterPath = (id) => `/characters/${encodeURIComponent(id)}`;
export const isHistoryId = (value) => /^\d{1,15}$/.test(value);

async function loadCharacterList(user) {
  const [rows, assignments, campaigns] = await Promise.all([characters.listCharacters(user.id), characters.listMyAssignments(user.id), data.listMyCampaigns(user.id)]);
  return describeCharacters({ rows, assignments, campaigns });
}

// A person's characters, in or out of a campaign (ADR 0011).
export async function showCharacters({ user, router, alive, announce }) {
  const draw = async (focus, notice) => {
    const list = await loadCharacterList(user);
    if (!alive()) return;
    show(
      charactersView({
        list,
        notice,
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
        onPurge: async (id, name) => {
          await characters.purgeCharacter(id);
          await draw(false, `${name} is deleted forever.`);
        },
        onLoadSheet: characters.readCharacter,
      }),
      "Your characters",
      focus,
      { roomy: true },
    );
  };
  return draw(announce);
}

// Which character the player uses in this campaign.
export async function showChoose({ campaign, user, router, alive, announce }) {
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
export async function showSheet({ user, characterId, router, alive, announce }) {
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

// The copies the database has kept of a sheet: its own copy for a download. Shared
// with the Keeper's history page (campaign-routes.js), which reads the same copies.
export async function saveCopyOf(entry) {
  const snapshot = await characters.readSnapshot(entry.id);
  if (!snapshot) throw new Error("that version was not found");
  downloadText(fileNameForName(snapshot.character_name), serializeStored(snapshot));
}

// The copies the database has kept of the player's own sheet (ADR 0010).
export async function showHistory({ user, characterId, alive, announce }) {
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
export async function showSnapshot({ user, characterId, historyId, router, alive, announce }) {
  if (!isHistoryId(historyId)) return show(views.notFoundView("We could not find that version."), "Not found", announce);
  const [row, snapshot] = await Promise.all([characters.readCharacter(characterId), characters.readSnapshot(Number(historyId))]);
  if (!alive()) return;
  if (!row || row.owner_id !== user.id || !snapshot || snapshot.character_id !== row.id) return show(views.notFoundView("We could not find that version of your sheet."), "Not found", announce);
  const when = new Date(snapshot.saved_at).toLocaleString();
  const status = h("span", { class: "status", role: "status", "aria-live": "polite" });
  const restore = h("button", { class: "btn btn-primary btn-small", type: "button" }, "Put this version back");
  restore.addEventListener("click", async () => {
    if (!(await confirmAction("Put this version back as your sheet? Your current sheet is kept in the history, so you can undo this.", "Put version back"))) return;
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
  return showReadOnlySheet(snapshot, {
    ownSheet: false,
    title: "Version history",
    announce,
    alive,
    sheetRow: { id: snapshot.id, updated_at: snapshot.saved_at },
    describe: async () => ({
      readOnlyNotice: `This is your sheet as it was just before ${when}. It is read only, and your current sheet has not changed.`,
      back: { href: `${characterPath(row.id)}/history`, label: "Back to the history", more: [" ", restore, " ", status] },
    }),
  });
}
