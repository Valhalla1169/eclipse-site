// Page 6, Log: the player's own notes. Page 5, Reference: the searchable rules cards.
import { h, staticHtml } from "../dom.js";
import { REFERENCE, REF_CATS } from "./reference-data.js";
import { tabPanel } from "./ui.js";

export const logEntries = (sheet) =>
  sheet.log.map((_, i) =>
    h(
      "article",
      { class: "entry", "data-entry": i },
      h(
        "div",
        { class: "entry-head" },
        h("input", { class: "etitle", "data-lg": `${i}.t`, "aria-label": `Entry ${i + 1} title` }),
        h("input", { class: "edate", "data-lg": `${i}.d`, placeholder: "session / date", "aria-label": `Entry ${i + 1} session or date` }),
        h("button", { class: "rm", type: "button", "data-rmlog": i, "aria-label": `Remove entry ${i + 1}` }, "×"),
      ),
      h(
        "div",
        { class: "entry-body" },
        h("textarea", { "data-lg": `${i}.b`, placeholder: "Names, places, promises, debts, anything you want to remember.", "aria-label": `Entry ${i + 1} text` }),
      ),
    ),
  );

export function buildLogPage(sheet) {
  return tabPanel(
    "page6",
    "tab6",
    h(
      "div",
      { class: "logtools" },
      h("button", { id: "logAdd", type: "button" }, "+ New entry"),
      h("input", { id: "logSearch", type: "search", placeholder: "Search your notes. Names, places, anything you wrote.", "aria-label": "Search your notes" }),
      h("span", { class: "logcount", id: "logCount", "aria-live": "polite" }),
    ),
    h("div", { class: "logcols", id: "logEntries" }, logEntries(sheet)),
    h("p", { class: "logempty hide", id: "logEmpty" }, "Nothing here yet."),
  );
}

export function buildReferencePage() {
  return tabPanel(
    "page5",
    "tab5",
    h(
      "div",
      { class: "reftools" },
      h("input", { id: "refSearch", type: "search", placeholder: "Search the rules. Try dodge, botch, rot, starving, haggle.", "aria-label": "Search the rules" }),
      h("div", { class: "chips", id: "refChips" }, ["All", ...REF_CATS].map((category) => h("button", { class: "chip", type: "button", "data-cat": category, "aria-pressed": String(category === "All") }, category))),
      h("span", { class: "refcount", id: "refCount", "aria-live": "polite" }),
    ),
    h(
      "div",
      { class: "refcols", id: "refCards" },
      REFERENCE.map((card, i) => h("article", { class: "rc", "data-ref": i }, h("h2", {}, h("span", {}, card.t), h("span", { class: "cat" }, card.c)), h("div", { class: "body" }, staticHtml(card.html)))),
    ),
    h("p", { class: "refempty hide", id: "refEmpty" }, "Nothing matches that. Try a shorter word."),
  );
}
