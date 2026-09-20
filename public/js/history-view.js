// The version history page: the copies the database has kept of a player's sheet
// (docs/adr/0004, 0010). Looking at a copy and putting one back are separate steps.
import { h } from "./dom.js";
import { reasonLabel } from "./history.js";
import { friendlyError, timeAgo } from "./util.js";

// onSaveCopy(entry) downloads that version as an .eclipse file.
export function historyView({ campaign, entries, onSaveCopy }) {
  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const id = encodeURIComponent(campaign.id);

  const saveCopy = async (event, entry) => {
    const button = event.currentTarget;
    button.disabled = true;
    status.textContent = "";
    try {
      await onSaveCopy(entry);
    } catch (error) {
      console.error(error);
      status.textContent = `Could not save that copy. ${friendlyError(error)}`;
    } finally {
      button.disabled = false;
    }
  };

  const item = (entry) =>
    h(
      "li",
      { class: "history-item card" },
      h(
        "div",
        {},
        h("strong", {}, new Date(entry.saved_at).toLocaleString()),
        h("p", { class: "muted small" }, `${timeAgo(entry.saved_at)}. ${reasonLabel(entry.reason)}.`),
        h("p", { class: "muted small" }, entry.character_name ? `Named ${entry.character_name}` : "No name yet"),
      ),
      h(
        "div",
        { class: "actions" },
        h("a", { class: "btn btn-primary btn-small", href: `/campaign/${id}/play/history/${encodeURIComponent(entry.id)}` }, "Look at it"),
        h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: (event) => saveCopy(event, entry) }, "Save a copy"),
      ),
    );

  return h(
    "div",
    { class: "stack" },
    h("div", { class: "card-head" }, h("h1", {}, "Version history"), h("span", { class: "badge" }, campaign.name)),
    h(
      "p",
      { class: "muted" },
      "The site keeps a copy of your sheet before your edits (at most one every 10 minutes) and before each rules update. Each copy below is the sheet as it was just before the time shown. Look at one, then put it back if you want it.",
    ),
    h("p", {}, h("a", { class: "btn btn-quiet", href: `/campaign/${id}/play` }, "Back to my sheet")),
    status,
    entries.length
      ? h("ul", { class: "history" }, ...entries.map(item))
      : h("p", { class: "muted" }, "There are no earlier versions yet. The first one is kept the next time your sheet changes."),
  );
}
