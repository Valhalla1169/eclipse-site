// Small builders shared by the sheet's pages.
import { h } from "../dom.js";

export const panel = (props, heading, ...children) => h("section", { ...props, class: `panel ${props.class || ""}`.trim() }, heading, ...children);

// A panel heading: a title, then extras such as a note or a toggle.
export const heading = (title, ...extras) => h("h2", {}, title, ...extras);
export const note = (text, props = {}) => h("span", { class: "note", ...props }, text);

// A table header row. Each column is [label, widthClass?, centered?].
export const headRow = (...columns) =>
  h(
    "thead",
    {},
    h("tr", {}, ...columns.map(([label, width, centered]) => h("th", { class: [width, centered && "c"].filter(Boolean).join(" ") || null }, label))),
  );

export const addRow = (target, label) => h("button", { class: "addrow", type: "button", "data-add": target }, label);
export const removeButton = (attrs) => h("button", { class: "rm", type: "button", "aria-label": "Remove row", ...attrs }, "×");

// The panel's own page-level container for one tab.
export const tabPanel = (id, labelledBy, ...children) =>
  h("div", { class: "page-panel", id, role: "tabpanel", "aria-labelledby": labelledBy, tabindex: "-1" }, ...children);
