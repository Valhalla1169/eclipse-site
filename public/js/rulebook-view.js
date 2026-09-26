// The rulebook's pages (docs/adr/0016): the contents, and one chapter at a time. The
// book's text goes through the Markdown reader, which makes text nodes only.
import { h } from "./dom.js";
import { renderMarkdown } from "./markdown.js";

const chapterPath = (slug) => `/rules/${encodeURIComponent(slug)}`;

// book: { title, version }, or null before one is uploaded. chapters: [{ slug, title }] in order.
export function contentsView({ book, chapters }) {
  if (!book || !chapters.length) {
    return h(
      "section",
      { class: "card stack" },
      h("h1", {}, "Rulebook"),
      h("p", {}, "The rulebook is not on the site yet."),
      h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
    );
  }
  return h(
    "div",
    { class: "stack" },
    h("h1", {}, book.title),
    h("p", { class: "muted" }, `Version ${book.version}`),
    h(
      "nav",
      { class: "card stack", "aria-labelledby": "contents-title" },
      h("h2", { id: "contents-title" }, "Contents"),
      h("ol", { class: "contents" }, ...chapters.map((chapter) => h("li", {}, h("a", { href: chapterPath(chapter.slug) }, chapter.title)))),
    ),
  );
}

// chapter: { slug, title, body }. chapters: the contents, for the chapters either side.
export function chapterView({ chapter, chapters }) {
  const at = chapters.findIndex((entry) => entry.slug === chapter.slug);
  const step = (entry, label, rel) =>
    entry && h("a", { class: `btn btn-quiet chapter-${rel}`, href: chapterPath(entry.slug), rel }, h("span", { class: "chapter-step" }, label), " ", entry.title);
  return h(
    "div",
    { class: "stack" },
    h("p", {}, h("a", { class: "btn btn-quiet btn-small", href: "/rules" }, "Contents")),
    h("article", { class: "chapter" }, renderMarkdown(chapter.body)),
    h(
      "nav",
      { class: "chapter-nav", "aria-label": "Chapters" },
      at > 0 ? step(chapters[at - 1], "Previous", "prev") : null,
      h("a", { class: "btn btn-quiet", href: "/rules" }, "Contents"),
      at >= 0 ? step(chapters[at + 1], "Next", "next") : null,
    ),
  );
}
