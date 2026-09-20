// The help card and the "load a file" confirmation, as native <dialog> elements
// (focus stays inside while open, and Escape closes them).
import { h } from "../dom.js";

const section = (title, ...paragraphs) => [h("h4", {}, title), ...paragraphs.map((text) => h("p", {}, ...[text].flat()))];

function helpBody() {
  return h(
    "div",
    { class: "hb" },
    section(
      "Saving",
      ["Your sheet saves to your account by itself, a moment after you stop typing. The top right says when the last save happened. Press ", h("b", {}, "Save now"), " (or Ctrl+S) to save at once."],
      "You can open the same sheet on your phone or another computer. If you change it in two places at once, the sheet asks which version to keep.",
    ),
    section(
      "A copy on your own computer",
      ["Press ", h("b", {}, "Save a copy"), " to download a file ending in ", h("b", {}, ".eclipse"), ". That file is your character. Keep one somewhere safe, such as your Documents folder, for a backup."],
    ),
    section(
      "Loading a file",
      ["Press ", h("b", {}, "Load file"), " and pick your ", h("b", {}, ".eclipse"), " file, or drag the file onto this page. Loading replaces the sheet you see now. The sheet asks first, and you can save a copy of your current sheet before it replaces it."],
    ),
    section(
      "Filling it in",
      "Almost everything calculates itself. Type your attributes and skill levels and the sheet works out dice pools, action points, soak, encumbrance, and casting costs.",
      ["Click the boxes on the condition monitors to record damage. Everything that costs you dice feeds the big number on the Core page, so that number is what you subtract from every roll."],
      ["The ", h("b", {}, "Reference"), " tab has the rules you will reach for most, and it is searchable."],
    ),
    section("If something looks wrong", "Press Save a copy first, then reload the page. Tell your GM if a number still looks off."),
  );
}

export function createSheetDialogs() {
  const help = h(
    "dialog",
    { class: "helpcard", "aria-labelledby": "helpTitle" },
    h("div", { class: "hh" }, h("h2", { id: "helpTitle" }, "Using this character sheet"), h("button", { type: "button", "aria-label": "Close", onclick: () => help.close() }, "×")),
    helpBody(),
  );
  help.addEventListener("click", (event) => {
    if (event.target === help) help.close();
  });

  const confirm = h("dialog", { class: "helpcard", "aria-labelledby": "loadTitle" });
  let settle = () => {};
  confirm.addEventListener("close", () => settle(confirm.returnValue || "cancel"));

  const choose = (value) => () => {
    confirm.close(value);
  };

  return {
    elements: [help, confirm],
    help: () => help.showModal(),
    // Resolves to "load", "copy" (save a copy of the current sheet, then load) or "cancel".
    confirmLoad(fileName) {
      confirm.replaceChildren(
        h("div", { class: "hh" }, h("h2", { id: "loadTitle" }, "Load this file?")),
        h(
          "div",
          { class: "hb" },
          h("p", {}, "Loading ", h("b", {}, fileName), " replaces the sheet you see now with the one in the file."),
          h("p", {}, "Your current sheet is not kept unless you save a copy first."),
        ),
        h(
          "div",
          { class: "actions" },
          h("button", { class: "sbtn primary", type: "button", onclick: choose("copy") }, "Save a copy, then load"),
          h("button", { class: "sbtn", type: "button", onclick: choose("load") }, "Load without a copy"),
          h("button", { class: "sbtn", type: "button", onclick: choose("cancel") }, "Cancel"),
        ),
      );
      return new Promise((resolve) => {
        settle = resolve;
        confirm.returnValue = "";
        confirm.showModal();
      });
    },
  };
}
