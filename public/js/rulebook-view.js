// The rulebook's one page (docs/adr/0016): every chapter, each behind its own closed
// <details>, so the browser's own Find can search the whole book at once. The book's
// text goes through the Markdown reader, which makes text nodes only.
import { h } from "./dom.js";
import { renderMarkdown } from "./markdown.js";
import { notice } from "./views.js";

const chapterPath = (slug) => `/rules/${encodeURIComponent(slug)}`;
const chapterId = (slug) => `chapter-${slug}`;
// A link this page handles itself: /rules, or /rules/<slug>, each with an optional #part.
const BOOK_PATH = /^\/rules(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?\/?$/;

const chapterLink = (chapter) => h("li", {}, h("a", { href: chapterPath(chapter.slug), "data-chapter-link": chapter.slug }, chapter.title));

// The id a #hash names, or "" when it names none (a missing or malformed hash).
function anchorId(hash) {
  if (!hash) return "";
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return "";
  }
}

// Opens a chapter's <details>, scrolls it (or a part named by `hash`) into view, and,
// when asked, moves focus there. Used both for a fresh load of /rules/<slug> and for an
// in-page jump to a chapter (docs/adr/0016).
export function openChapter(root, slug, hash, { focus = false } = {}) {
  const details = root.querySelector(`#${chapterId(slug)}`);
  if (!details) return;
  details.open = true;
  // getElementById, not a CSS selector: `hash` may hold anything a stray URL puts there.
  const id = anchorId(hash);
  const part = id && document.getElementById(id);
  const target = (part && details.contains(part) && part) || details.querySelector("summary");
  if (focus) {
    if (target.tagName !== "SUMMARY") target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
  target.scrollIntoView();
}

function setCurrent(root, slug) {
  for (const a of root.querySelectorAll("[data-chapter-link]")) {
    if (slug && a.dataset.chapterLink === slug) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
}

// book: { title, version }, or null before one is uploaded. chapters: [{ slug, title, body }]
// in the book's order. currentSlug marks the open chapter's link, for a fresh load of
// /rules/<slug>; notFoundSlug shows a notice that a requested chapter does not exist.
export function bookView({ book, chapters, currentSlug = null, notFoundSlug = null }) {
  if (!book || !chapters.length) {
    return h(
      "section",
      { class: "card stack" },
      h("h1", {}, "Rulebook"),
      h("p", {}, "The rulebook is not on the site yet."),
      h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
    );
  }

  const entries = chapters.map((chapter) =>
    h(
      "details",
      { class: "chapter-entry", id: chapterId(chapter.slug) },
      h("summary", {}, h("h2", {}, chapter.title)),
      h("div", { class: "chapter" }, renderMarkdown(chapter.body, { chapterSlug: chapter.slug })),
    ),
  );

  const root = h(
    "div",
    { class: "stack" },
    notFoundSlug ? notice("error", "That chapter is not in the rulebook.") : null,
    h("h1", {}, book.title),
    h("p", { class: "muted" }, `Version ${book.version}`),
    h(
      "div",
      { class: "book" },
      h("details", { class: "chapters-menu" }, h("summary", {}, "Chapters"), h("ol", { class: "contents" }, chapters.map(chapterLink))),
      h("nav", { class: "book-nav", "aria-label": "Chapters" }, h("ol", { class: "contents" }, chapters.map(chapterLink))),
      h(
        "div",
        { class: "book-main" },
        h(
          "div",
          { class: "book-toolbar" },
          h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => entries.forEach((entry) => (entry.open = true)) }, "Open all"),
          h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => entries.forEach((entry) => (entry.open = false)) }, "Close all"),
        ),
        entries,
      ),
    ),
  );

  if (currentSlug) setCurrent(root, currentSlug);

  // A click on a chapter link, in the chapter list or inside a chapter's own text, opens
  // and scrolls to that chapter in place: the router never rebuilds this page for it
  // (CLAUDE.md, "Views"). Anything else (an outside link, a chapter this book does not
  // have) is left for the router to handle as usual.
  root.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    const match = BOOK_PATH.exec(url.pathname);
    if (!match) return;
    const slug = match[1];
    if (slug && !chapters.some((chapter) => chapter.slug === slug)) return;
    event.preventDefault();
    const menu = link.closest(".chapters-menu");
    if (slug) {
      openChapter(root, slug, url.hash, { focus: true });
      setCurrent(root, slug);
      history.replaceState({}, "", `/rules/${slug}${url.hash}`);
    } else {
      setCurrent(root, null);
      const heading = root.querySelector("h1");
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      heading.scrollIntoView();
      history.replaceState({}, "", "/rules");
    }
    if (menu) menu.open = false;
  });

  return root;
}
