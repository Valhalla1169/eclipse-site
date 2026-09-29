// The page chrome every view shares: swapping the view on screen, and the leave
// gate that asks before a view with unsaved changes is replaced (CLAUDE.md,
// "Leaving a view"). Route modules import show() to draw what they build.
import { confirmAction } from "./confirm-dialog.js";

const main = document.getElementById("main");

let disposeView = null; // set by a view that holds page-wide listeners, such as the sheet
let flushView = null; // set by a view that may hold unsaved changes

// options.wide: the sheet needs more room than the account pages. options.roomy: a grid
// of cards uses the full page width. options.full: the rulebook uses the window's width.
// options.dispose: runs when the view is replaced. options.flush: saves what is waiting and resolves
// to false if something could not be saved; mayLeave() calls it before the view is left.
export function show(node, title, announce = true, { wide = false, roomy = false, full = false, dispose = null, flush = null } = {}) {
  if (disposeView) disposeView();
  disposeView = dispose;
  flushView = flush;
  main.inert = false;
  main.className = full ? "page page-full" : wide ? "page page-wide" : roomy ? "page page-roomy" : "page";
  main.replaceChildren(node);
  document.title = title ? `${title} - Eclipse` : "Eclipse";
  // After an in-app navigation, move focus to the new heading so keyboard and
  // screen-reader users are told the view changed, the way a full page load
  // would. Not on the first render: focusing <h1> there would make Tab skip the
  // skip link and the header.
  const heading = main.querySelector("h1");
  if (heading && announce) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

export async function mayLeave(
  question = "Your latest changes are not saved yet. Leave this page and lose them?",
  confirmLabel = "Leave page",
) {
  return !flushView || (await flushView()) || confirmAction(question, confirmLabel);
}

// The view stays on screen until the next show(). Until then nothing can be typed into
// it, and a redirect on the way does not ask again.
export function releaseView() {
  if (!flushView) return;
  flushView = null;
  main.inert = true;
}
