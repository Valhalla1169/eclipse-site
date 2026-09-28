// Route handlers for the rulebook (docs/adr/0016): the contents, and one chapter,
// including jumping to a part the browser looked for before the chapter was drawn.
import { CHAPTER_SLUG } from "./markdown.js";
import * as rulebook from "./rulebook.js";
import { chapterView, contentsView } from "./rulebook-view.js";
import { show } from "./shell.js";
import * as views from "./views.js";

// A link to a part of a chapter. The browser looked for that part before the chapter was drawn.
function showPart(announce) {
  let id = "";
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  const part = id && document.getElementById(id);
  if (!part || !part.closest(".chapter")) return;
  if (announce) {
    part.setAttribute("tabindex", "-1");
    part.focus({ preventScroll: true });
  }
  part.scrollIntoView();
}

export async function showRulebook({ slug, alive, announce }) {
  if (slug !== undefined && !CHAPTER_SLUG.test(slug)) return show(views.notFoundView("That chapter is not in the rulebook."), "Not found", announce);
  show(views.loadingView("Loading the rulebook..."), "Rulebook", announce);
  const [book, chapters, chapter] = await Promise.all([slug ? null : rulebook.readBook(), rulebook.listChapters(), slug ? rulebook.readChapter(slug) : null]);
  if (!alive()) return;
  if (!slug) return show(contentsView({ book, chapters }), book ? book.title : "Rulebook", announce);
  if (!chapter) return show(views.notFoundView("That chapter is not in the rulebook."), "Not found", announce);
  show(chapterView({ chapter, chapters }), chapter.title, announce);
  showPart(announce);
}
