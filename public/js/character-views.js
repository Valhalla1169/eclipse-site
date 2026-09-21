// The pages about a person's characters: the list of them, and choosing which one is
// active in a campaign (docs/adr/0011). Text only ever goes in as text nodes (dom.js).
import { MAX_CHARACTERS } from "./character-list.js";
import { h } from "./dom.js";
import { SheetFormatError } from "./eclipse-rules.js";
import { FILE_EXTENSION } from "./sheet/files.js";
import { friendlyError, timeAgo } from "./util.js";

const FULL_NOTE = `You have ${MAX_CHARACTERS} characters, the most one person can have. Delete one to make room.`;

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

// list: { live, deleted, full } from describeCharacters. Actions: onCreate(),
// onCreateFromFile(file), onCopy(id), onDelete(id), onUndelete(id).
export function charactersView({ list, onCreate, onCreateFromFile, onCopy, onDelete, onUndelete }) {
  const status = h("div", { class: "stack" });
  const fileInput = h("input", { type: "file", accept: `${FILE_EXTENSION},.json,application/json`, hidden: true, "aria-label": "Character file to make a character from" });
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    fileInput.value = "";
    if (file) guarded(status, () => onCreateFromFile(file))({ currentTarget: fromFile });
  });
  const fromFile = h("button", { class: "btn btn-quiet", type: "button", disabled: list.full, onclick: () => fileInput.click() }, "New character from a file");

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

  const deletedCard = (entry) =>
    h(
      "li",
      { class: "character-card card stack" },
      h("h2", {}, entry.name),
      h("div", { class: "actions" }, h("button", { class: "btn btn-quiet btn-small", type: "button", disabled: list.full, onclick: guarded(status, () => onUndelete(entry.id)) }, "Bring back")),
    );

  return h(
    "div",
    { class: "stack" },
    h("div", { class: "card-head" }, h("h1", {}, "Your characters"), h("span", { class: "badge" }, `${list.live.length} of ${MAX_CHARACTERS}`)),
    h("p", { class: "muted" }, "These characters are yours. You choose which one you play in each campaign. Nothing you delete is removed: you can bring it back."),
    h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", disabled: list.full, onclick: guarded(status, onCreate) }, "New character"), fromFile, fileInput),
    list.full ? h("p", { class: "muted" }, FULL_NOTE) : null,
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
    h("p", {}, "Choose the character you play in this campaign. Your DM can see this character's sheet. You can choose a different one later."),
    list.live.length ? h("ul", { class: "characters" }, ...list.live.map(row)) : h("p", { class: "muted" }, "You have no characters yet."),
    h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", disabled: list.full, onclick: guarded(status, onCreate) }, "Make a new character for this campaign"), h("a", { class: "btn btn-quiet", href: "/characters" }, "All my characters")),
    list.full ? h("p", { class: "muted" }, FULL_NOTE) : null,
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
