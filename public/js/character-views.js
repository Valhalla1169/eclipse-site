// The pages about a person's characters: the list of them, and choosing which one is
// active in a campaign (docs/adr/0011). Text only ever goes in as text nodes (dom.js).
import { FULL_NOTE, MAX_CHARACTERS } from "./character-list.js";
import { h } from "./dom.js";
import { SheetFormatError } from "./eclipse-rules.js";
import { FILE_EXTENSION, downloadText, fileNameForName, serializeStored } from "./sheet/files.js";
import { friendlyError, timeAgo } from "./util.js";

// At the limit the "new character" buttons are off, and this note says why and what to do.
const FULL_NOTE_ID = "characters-full";
const fullNote = (list) => (list.full ? h("p", { class: "muted", id: FULL_NOTE_ID }, FULL_NOTE) : null);
const describedIfFull = (list) => (list.full ? FULL_NOTE_ID : null);

// Thrown by an action the person backed out of: nothing to report.
class CancelledError extends Error {}

// Runs an action for a button and reports a failure in `status`. On success the
// caller has already moved to the next page or drawn the list again.
function guarded(status, action) {
  return async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    status.replaceChildren();
    try {
      await action();
    } catch (error) {
      if (!(error instanceof CancelledError)) {
        console.error(error);
        status.replaceChildren(h("p", { class: "notice notice-error", role: "alert" }, h("strong", {}, "Error: "), error instanceof SheetFormatError ? error.message : friendlyError(error)));
      }
      button.disabled = false;
    }
  };
}

// A confirmation dialog for deleting an archived character forever (docs/adr/0018):
// it names what is lost, offers a backup download when `row` could be read, and
// keeps the confirm button off until the character's name is typed exactly.
function purgeDialog(entry, { row, onPurge }) {
  const titleId = `purgeTitle-${entry.id}`;
  const nameId = `purgeName-${entry.id}`;
  const dialogStatus = h("div", { class: "stack" });
  const saveStatus = h("span", { class: "status" });
  const nameField = h("input", { id: nameId, autocomplete: "off", spellcheck: "false", autofocus: true });
  const confirmButton = h("button", { class: "btn btn-primary", type: "button", disabled: true }, "Delete forever");
  const cancelButton = h("button", { class: "btn btn-quiet", type: "button" }, "Cancel");
  nameField.addEventListener("input", () => {
    confirmButton.disabled = nameField.value !== entry.name;
  });

  const dialog = h(
    "dialog",
    { class: "confirm-dialog", "aria-labelledby": titleId },
    h("h2", { id: titleId }, `Delete ${entry.name} forever?`),
    h("p", {}, "This removes the character, its saved history, and any copy your Keeper kept from when you left a campaign. Nothing can bring it back."),
    row
      ? h(
          "p",
          { class: "actions" },
          h(
            "button",
            {
              class: "btn btn-quiet btn-small",
              type: "button",
              onclick: () => {
                downloadText(fileNameForName(row.character_name), serializeStored(row));
                saveStatus.textContent = "Saved.";
              },
            },
            "Save a copy",
          ),
          saveStatus,
        )
      : null,
    h("div", { class: "field" }, h("label", { for: nameId }, `Type ${entry.name} to confirm`), nameField),
    dialogStatus,
    h("div", { class: "actions" }, confirmButton, cancelButton),
  );

  cancelButton.addEventListener("click", () => dialog.close("cancel"));

  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    dialogStatus.replaceChildren();
    try {
      await onPurge();
      dialog.close("confirmed");
    } catch (error) {
      console.error(error);
      dialogStatus.replaceChildren(h("p", { class: "notice notice-error", role: "alert" }, h("strong", {}, "Error: "), friendlyError(error)));
      confirmButton.disabled = nameField.value !== entry.name;
    }
  });

  return dialog;
}

// list: { live, deleted, full } from describeCharacters. notice: a one-shot success
// message shown once, such as after deleting a character forever. Actions: onCreate(),
// onCreateFromFile(file), onCopy(id), onDelete(id), onUndelete(id), onPurge(id, name),
// onLoadSheet(id) (resolves to the stored row, or null, for the purge dialog's backup).
export function charactersView({ list, notice, onCreate, onCreateFromFile, onCopy, onDelete, onUndelete, onPurge, onLoadSheet }) {
  const status = h("div", { class: "stack" });
  const fileInput = h("input", { type: "file", accept: `${FILE_EXTENSION},.json,application/json`, hidden: true, "aria-label": "Character file to make a character from" });
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    fileInput.value = "";
    if (file) guarded(status, () => onCreateFromFile(file))({ currentTarget: fromFile });
  });
  const fromFile = h("button", { class: "btn btn-quiet", type: "button", disabled: list.full, "aria-describedby": describedIfFull(list), onclick: () => fileInput.click() }, "New character from a file");

  const card = (entry) =>
    h(
      "li",
      { class: "character-card card stack" },
      h(
        "div",
        { class: "card-head" },
        h("h2", {}, entry.name),
        entry.campaign ? h("span", { class: "badge" }, `In ${entry.campaign.name}`) : null,
      ),
      h("p", { class: "muted small" }, `Saved ${timeAgo(entry.updatedAt)}`),
      h(
        "div",
        { class: "actions" },
        h("a", { class: "btn btn-primary btn-small", href: `/characters/${encodeURIComponent(entry.id)}` }, "Open"),
        h("button", { class: "btn btn-quiet btn-small", type: "button", disabled: list.full, onclick: guarded(status, () => onCopy(entry.id)) }, "Make a copy"),
        h(
          "button",
          {
            class: "btn btn-quiet btn-small",
            type: "button",
            disabled: Boolean(entry.campaign),
            onclick: guarded(status, async () => {
              if (!window.confirm(`Delete ${entry.name}? It is hidden, not removed. You can bring it back from the deleted characters below.`)) throw new CancelledError();
              await onDelete(entry.id);
            }),
          },
          "Delete",
        ),
      ),
      entry.campaign ? h("p", { class: "muted small" }, `To delete it, first choose a different character in ${entry.campaign.name}.`) : null,
    );

  const deletedCard = (entry) => {
    const purgeButton = h("button", { class: "btn btn-quiet btn-small", type: "button" }, "Delete forever");
    const item = h(
      "li",
      { class: "character-card card stack" },
      h("h2", {}, entry.name),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn btn-quiet btn-small", type: "button", disabled: list.full, onclick: guarded(status, () => onUndelete(entry.id)) }, "Bring back"),
        purgeButton,
      ),
    );

    purgeButton.addEventListener("click", async () => {
      purgeButton.disabled = true;
      let row = null;
      try {
        row = onLoadSheet ? await onLoadSheet(entry.id) : null;
      } catch (error) {
        console.error(error);
      }
      const dialog = purgeDialog(entry, { row, onPurge: () => onPurge(entry.id, entry.name) });
      item.append(dialog);
      dialog.addEventListener("close", () => {
        dialog.remove();
        purgeButton.disabled = false;
        if (dialog.returnValue !== "confirmed") purgeButton.focus();
      });
      dialog.showModal();
    });

    return item;
  };

  return h(
    "div",
    { class: "stack" },
    h("div", { class: "card-head" }, h("h1", {}, "Your characters"), h("span", { class: "badge" }, `${list.live.length} of ${MAX_CHARACTERS}`)),
    h("p", { class: "muted" }, "These characters are yours. You choose which one you play in each campaign. Nothing you delete is removed: you can bring it back."),
    h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", disabled: list.full, "aria-describedby": describedIfFull(list), onclick: guarded(status, onCreate) }, "New character"), fromFile, fileInput),
    fullNote(list),
    notice ? h("p", { class: "notice notice-success", role: "status" }, notice) : null,
    status,
    list.live.length ? h("ul", { class: "characters" }, ...list.live.map(card)) : h("p", { class: "muted" }, "You have no characters yet. Make your first one."),
    list.deleted.length
      ? h("details", { class: "card stack" }, h("summary", {}, `Deleted characters (${list.deleted.length})`), h("ul", { class: "characters" }, ...list.deleted.map(deletedCard)))
      : null,
  );
}

// Which character a player uses in a campaign. list is from describeCharacters.
// Actions: onChoose(id), onCreate() (a new character, chosen at once).
export function chooseCharacterView({ campaign, list, onChoose, onCreate }) {
  const status = h("div", { class: "stack" });
  const activeHere = (entry) => entry.campaign && entry.campaign.id === campaign.id;
  const row = (entry) => {
    const here = activeHere(entry);
    const elsewhere = entry.campaign && !here;
    return h(
      "li",
      { class: "character-card card stack" },
      h("div", { class: "card-head" }, h("h2", {}, entry.name), here ? h("span", { class: "badge" }, "Your character here") : elsewhere ? h("span", { class: "badge" }, `In ${entry.campaign.name}`) : null),
      h(
        "div",
        { class: "actions" },
        here
          ? h("a", { class: "btn btn-primary btn-small", href: `/characters/${encodeURIComponent(entry.id)}` }, "Open sheet")
          : h("button", { class: "btn btn-primary btn-small", type: "button", disabled: elsewhere, onclick: guarded(status, () => onChoose(entry.id)) }, "Use this character"),
      ),
      elsewhere ? h("p", { class: "muted small" }, `A character can be in one campaign at a time. To use it here, first choose a different character in ${entry.campaign.name}, or make a copy.`) : null,
    );
  };

  return h(
    "div",
    { class: "stack" },
    h("div", { class: "card-head" }, h("h1", {}, campaign.name), h("span", { class: "badge" }, "Player")),
    h("p", {}, "Choose the character you play in this campaign. Your Keeper can see this character's sheet. You can choose a different one later."),
    list.live.length ? h("ul", { class: "characters" }, ...list.live.map(row)) : h("p", { class: "muted" }, "You have no characters yet."),
    h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", disabled: list.full, "aria-describedby": describedIfFull(list), onclick: guarded(status, onCreate) }, "Make a new character for this campaign"), h("a", { class: "btn btn-quiet", href: "/characters" }, "All my characters")),
    fullNote(list),
    status,
  );
}

export function deletedCharacterView() {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Deleted character"),
    h("p", {}, "This character is deleted, so its sheet is not shown. Nothing was removed: you can bring it back from your list of characters."),
    h("p", {}, h("a", { class: "btn btn-primary", href: "/characters" }, "Open my characters")),
  );
}
