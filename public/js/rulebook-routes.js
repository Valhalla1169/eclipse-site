// Route handler for the rulebook (docs/adr/0016): one page, every chapter, opening the
// one a link named and scrolling to it, including a part the browser looked for before
// the page was drawn.
import * as rulebook from "./rulebook.js";
import { bookView, openChapter } from "./rulebook-view.js";
import { show } from "./shell.js";
import * as views from "./views.js";

export async function showRulebook({ slug, alive, announce }) {
  show(views.loadingView("Loading the rulebook..."), "Rulebook", announce, { full: true });
  const { book, chapters } = await rulebook.readWholeBook();
  if (!alive()) return;
  const current = slug !== undefined ? chapters.find((chapter) => chapter.slug === slug) : undefined;
  const notFoundSlug = slug !== undefined && !current ? slug : null;
  const node = bookView({ book, chapters, currentSlug: current ? slug : null, notFoundSlug });
  show(node, book ? book.title : "Rulebook", announce, { full: true });
  if (current) openChapter(node, slug, location.hash, { focus: announce });
}
