// A character's sheet shown read only: the player's own history, and every view
// the Keeper gets (ADR 0009, 0010, 0011).
import { h } from "./dom.js";
import { SheetFormatError, openSheet } from "./eclipse-rules.js";
import { createSheetView } from "./sheet/index.js";
import { show } from "./shell.js";
import { sheetUnreadableView } from "./views.js";

export const backBar = (href, label, ...more) => h("p", { class: "sheet-back" }, h("a", { class: "btn btn-quiet btn-small", href }, label), ...more);

// Opens a stored sheet, or says it cannot be read (and returns null). The stored copy
// is left exactly as it is.
export function openStored(row, { ownSheet, title, announce }) {
  try {
    return openSheet(row);
  } catch (err) {
    if (!(err instanceof SheetFormatError)) throw err;
    console.error(err);
    show(sheetUnreadableView({ ownSheet }), title, announce);
    return null;
  }
}

// Opens a loaded row read only and shows it under a back bar. Returns the view, or null.
// sheetRow: the row the view reads `updated_at` from; a history or departed copy has
// none of its own, so its caller builds one.
// describe(opened) runs after the sheet opens and returns { readOnlyNotice,
// back: { href, label, more }, extra (nodes above the sheet), dispose(view) }.
// alive() is checked again after describe(), in case the route changed meanwhile.
export async function showReadOnlySheet(source, { ownSheet, title, announce, alive, sheetRow = source, describe }) {
  const opened = openStored(source, { ownSheet, title, announce });
  if (!opened) return null;
  const { readOnlyNotice, back, extra = [], dispose } = await describe(opened);
  if (alive && !alive()) return null;
  const view = createSheetView({ opened, row: sheetRow, readOnlyNotice });
  const bar = backBar(back.href, back.label, ...(back.more || []));
  show(h("div", {}, bar, ...extra, view.element), title, announce, {
    wide: true,
    dispose: dispose ? dispose(view) : view.dispose,
  });
  return view;
}
