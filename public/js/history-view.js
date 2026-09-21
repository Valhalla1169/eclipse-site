// The version history page: the copies the database has kept of a player's sheet
// (docs/adr/0004, 0010). Looking at a copy and putting one back are separate steps.
import { h } from "./dom.js";
import { reasonLabel } from "./history.js";
import { friendlyError, timeAgo } from "./util.js";

// badge: who the sheet is. intro: what the list is. back: { href, label }.
// snapshotPath(entry) is where "Look at it" goes. onSaveCopy(entry) downloads that
// version as an .eclipse file.
export function historyView({ badge, intro, back, snapshotPath, entries, onSaveCopy }) {
  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });

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
        h("a", { class: "btn btn-primary btn-small", href: snapshotPath(entry) }, "Look at it"),
        h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: (event) => saveCopy(event, entry) }, "Save a copy"),
      ),
    );

  return h(
    "div",
    { class: "stack" },
    h("div", { class: "card-head" }, h("h1", {}, "Version history"), h("span", { class: "badge" }, badge)),
    h("p", { class: "muted" }, intro),
    h("p", {}, h("a", { class: "btn btn-quiet", href: back.href }, back.label)),
    status,
    entries.length
      ? h("ul", { class: "history" }, ...entries.map(item))
      : h("p", { class: "muted" }, "There are no earlier versions yet. The first one is kept the next time the sheet changes."),
  );
}
