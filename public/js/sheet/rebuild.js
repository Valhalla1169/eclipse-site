// Redraws the parts of the sheet whose rows come and go: worn items, containers,
// lists, casting rows and log entries. Everything else is drawn once and updated
// in place by render.js.
import { containerPanels, wornRows } from "./equipment-page.js";
import { ladderRows, powerRows, ritualRows, schoolPickers, schoolSlotNote, spellRows } from "./casting-page.js";
import { logEntries } from "./log-reference-pages.js";
import { LISTS, listRows } from "./testament-page.js";
import { fillInputs, growAll } from "./render.js";

export const rebuildWorn = (root, sheet) => root.querySelector("#wornRows").replaceChildren(...wornRows(sheet));
export const rebuildContainers = (root, sheet) => root.querySelector("#containers").replaceChildren(...containerPanels(sheet));
export const rebuildList = (root, sheet, key) => root.querySelector(`#${LISTS[key].body}`).replaceChildren(...listRows(sheet, key));
export const rebuildLists = (root, sheet) => Object.keys(LISTS).forEach((key) => rebuildList(root, sheet, key));

export function rebuildCasting(root, sheet) {
  root.querySelector("#spellRows").replaceChildren(...spellRows(sheet));
  root.querySelector("#powerRows").replaceChildren(...powerRows(sheet));
  root.querySelector("#ritualRows").replaceChildren(...ritualRows(sheet));
  root.querySelector("#ladderRows").replaceChildren(...ladderRows());
  for (const which of ["v", "p"]) {
    root.querySelector(`#${which}_schools`).replaceChildren(...schoolPickers(sheet, which));
    root.querySelector(`#${which}_slotnote`).textContent = schoolSlotNote(sheet, which);
  }
}

export function rebuildLog(root, sheet) {
  root.querySelector("#logEntries").replaceChildren(...logEntries(sheet));
  fillInputs(root, sheet);
  growAll(root);
  filterLog(root, sheet);
}

export function filterLog(root, sheet) {
  const query = root.querySelector("#logSearch").value.trim().toLowerCase();
  let shown = 0;
  sheet.log.forEach((entry, i) => {
    const el = root.querySelector(`[data-entry="${i}"]`);
    if (!el) return;
    const haystack = `${entry.t || ""} ${entry.d || ""} ${entry.b || ""}`.toLowerCase();
    const hit = !query || query.split(/\s+/).every((word) => haystack.includes(word));
    el.classList.toggle("hide", !hit);
    if (hit) shown += 1;
  });
  const total = sheet.log.length;
  root.querySelector("#logCount").textContent = query ? `${shown} of ${total}` : `${total} ${total === 1 ? "entry" : "entries"}`;
  root.querySelector("#logEmpty").classList.toggle("hide", shown > 0);
}
