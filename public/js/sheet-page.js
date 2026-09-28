// A character's sheet shown read only: the player's own history, and every view
// the Keeper gets (ADR 0009, 0010, 0011). Four route handlers open a stored sheet,
// read who it belongs to, and show it the same way, so that shape lives here once.
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

// Opens `source` read only and shows it with a back bar: the shape every read-only
// sheet page shares (check an id, load, open the sheet, read whose it is, show it
// with a back bar) once the id has been checked and the row has been loaded.
//
// sheetRow is what createSheetView stamps saves with; for a live character it is
// `source` itself, but a history or departed copy has no `updated_at` of its own, so
// the caller gives it one built from when the copy was saved or kept.
//
// describe(opened) runs only once the sheet has opened (it may read the player's
// name first, as the original code did) and returns:
//   readOnlyNotice: the sentence shown above the sheet,
//   back: { href, label, more: [...] } for the back bar,
//   extra: more nodes between the back bar and the sheet (a status line),
//   dispose(view): the view's dispose(), wrapped with anything else to clean up
//     (a live subscription).
// alive() is rechecked after describe() awaits, in case the route changed underneath
// it. Returns the sheet view, or null when nothing was shown.
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
