import { describe, expect, it } from "vitest";
import { CHAPTER_SLUG, headingSlug, parseMarkdown, safeHref, textOf } from "../../public/js/markdown.js";

// Made-up text only: the real rulebook is never in this repo (docs/adr/0016).
const node = (tag, props, ...children) => ({ tag, props, children });
const p = (...children) => node("p", {}, ...children);
const one = (markdown) => parseMarkdown(markdown)[0];
const para = (markdown) => one(markdown).children;

// Every tag and attribute the reader may make. Nothing else can reach the page.
const TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "em", "strong", "ul", "ol", "li", "div", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "hr", "br", "code", "pre", "a"]);
const PROPS = new Set(["id", "class", "href", "rel", "start", "scope", "tabindex", "role", "aria-label"]);
function* walk(nodes) {
  for (const n of nodes) {
    if (typeof n === "string") continue;
    yield n;
    yield* walk(n.children);
  }
}

describe("headings", () => {
  it("makes h1 to h6, each with an id for links", () => {
    expect(parseMarkdown("# One\n## Two\n###### Six")).toEqual([
      node("h1", { id: "sec-one" }, "One"),
      node("h2", { id: "sec-two" }, "Two"),
      node("h6", { id: "sec-six" }, "Six"),
    ]);
  });

  it("drops closing hashes, and needs a space after the hashes", () => {
    expect(one("## Rest and recovery ##")).toEqual(node("h2", { id: "sec-rest-and-recovery" }, "Rest and recovery"));
    expect(one("#hashtag")).toEqual(p("#hashtag"));
    expect(one("####### seven")).toEqual(p("####### seven"));
  });

  it("gives a heading used twice its own id, like GitHub", () => {
    expect(parseMarkdown("# Gear\n## Gear\n### Gear!").map((h) => h.props.id)).toEqual(["sec-gear", "sec-gear-1", "sec-gear-2"]);
  });

  it("reads underlined headings", () => {
    expect(parseMarkdown("Big\n===\nSmaller\n---")).toEqual([node("h1", { id: "sec-big" }, "Big"), node("h2", { id: "sec-smaller" }, "Smaller")]);
  });

  it("makes ids from the heading's text, never from its markup", () => {
    expect(one("# The *Long* Road: 2 days").props.id).toBe("sec-the-long-road-2-days");
    expect(headingSlug("Café & Crème")).toBe("café--crème");
    expect(one("# !!!").props.id).toBe("sec-section");
  });
});

describe("paragraphs and inline text", () => {
  it("splits paragraphs at blank lines and keeps line breaks inside one soft", () => {
    expect(parseMarkdown("First line\nsecond line\n\nNext")).toEqual([p("First line\nsecond line"), p("Next")]);
  });

  it("makes a hard break from two trailing spaces or a backslash", () => {
    expect(para("a  \nb\\\nc")).toEqual(["a", node("br", {}), "b", node("br", {}), "c"]);
  });

  it("reads bold and italics with stars and underscores", () => {
    expect(para("*a* _b_ **c** __d__ ***e***")).toEqual([
      node("em", {}, "a"),
      " ",
      node("em", {}, "b"),
      " ",
      node("strong", {}, "c"),
      " ",
      node("strong", {}, "d"),
      " ",
      node("em", {}, node("strong", {}, "e")),
    ]);
    expect(para("**bold with *italics* inside**")).toEqual([node("strong", {}, "bold with ", node("em", {}, "italics"), " inside")]);
  });

  it("leaves stars and underscores that are not emphasis alone", () => {
    expect(para("2 * 3 * 4, snake_case_name, a lone * and *unclosed")).toEqual(["2 * 3 * 4, snake_case_name, a lone * and *unclosed"]);
    expect(para("\\*not italic\\*")).toEqual(["*not italic*"]);
  });

  it("keeps inline code as it is", () => {
    expect(para("Roll `2d6 * 2` or `` a ` b ``")).toEqual(["Roll ", node("code", {}, "2d6 * 2"), " or ", node("code", {}, "a ` b")]);
    expect(para("`<b>not bold</b>`")).toEqual([node("code", {}, "<b>not bold</b>")]);
  });
});

describe("lists", () => {
  it("makes unordered and ordered lists, with the first number kept", () => {
    expect(one("- a\n- b")).toEqual(node("ul", {}, node("li", {}, "a"), node("li", {}, "b")));
    expect(one("1. a\n2. b")).toEqual(node("ol", {}, node("li", {}, "a"), node("li", {}, "b")));
    expect(one("3) c\n4) d")).toEqual(node("ol", { start: "3" }, node("li", {}, "c"), node("li", {}, "d")));
  });

  it("nests lists", () => {
    expect(one("- a\n  1. b\n  2. c\n     - d\n- e")).toEqual(
      node(
        "ul",
        {},
        node("li", {}, "a", node("ol", {}, node("li", {}, "b"), node("li", {}, "c", node("ul", {}, node("li", {}, "d"))))),
        node("li", {}, "e"),
      ),
    );
  });

  it("puts the items of a list with blank lines in paragraphs", () => {
    expect(one("- a\n\n- b\n\n  more")).toEqual(node("ul", {}, node("li", {}, p("a")), node("li", {}, p("b"), p("more"))));
  });

  it("starts a list inside a paragraph only at a bullet or at number 1", () => {
    expect(parseMarkdown("Steps:\n1. one\n2. two")).toEqual([p("Steps:"), node("ol", {}, node("li", {}, "one"), node("li", {}, "two"))]);
    expect(parseMarkdown("It fell in\n1990. Then it rose.")).toEqual([p("It fell in\n1990. Then it rose.")]);
  });

  it("tells a rule from a list", () => {
    expect(parseMarkdown("- - -\n* * *\n___")).toEqual([node("hr", {}), node("hr", {}), node("hr", {})]);
  });
});

describe("tables", () => {
  const table = one("| Weapon | Damage | Weight |\n|:--|:--:|--:|\n| Knife | 1d4 | 1 |\n| Club | 1d6 |\n| Pipe \\| bar | `2d4` | 3 | extra |");

  it("reads a GitHub table with a header row, in a box that scrolls", () => {
    expect(table.tag).toBe("div");
    expect(table.props).toEqual({ class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Table 1" });
    const [thead, tbody] = table.children[0].children;
    expect(thead.children[0].children.map((th) => [th.tag, th.props.scope, textOf(th)])).toEqual([
      ["th", "col", "Weapon"],
      ["th", "col", "Damage"],
      ["th", "col", "Weight"],
    ]);
    expect(tbody.children.map((tr) => tr.children.map(textOf))).toEqual([
      ["Knife", "1d4", "1"],
      ["Club", "1d6", ""],
      ["Pipe | bar", "2d4", "3"],
    ]);
  });

  it("aligns columns with classes, never with a style", () => {
    expect(table.children[0].children[1].children[0].children.map((td) => td.props.class)).toEqual([undefined, "align-center", "align-right"]);
  });

  it("numbers the tables of a page, so each box has its own name", () => {
    const labels = parseMarkdown("| a |\n|---|\n| 1 |\n\nText\n\n| b |\n|---|").map((n) => n.props["aria-label"]);
    expect(labels).toEqual(["Table 1", undefined, "Table 2"]);
  });

  it("needs as many cells in the header as in the line under it", () => {
    expect(parseMarkdown("a | b\n---")).toEqual([node("h2", { id: "sec-a--b" }, "a | b")]);
  });
});

describe("block quotes, rules and code blocks", () => {
  it("reads quotes, with a lazy line and a quote inside", () => {
    expect(one("> Stay *quiet*\nin the dark.\n> > Inside")).toEqual(node("blockquote", {}, p("Stay ", node("em", {}, "quiet"), "\nin the dark."), node("blockquote", {}, p("Inside"))));
  });

  it("reads rules", () => {
    expect(parseMarkdown("Above\n\n---\n\nBelow")).toEqual([p("Above"), node("hr", {}), p("Below")]);
  });

  it("keeps a fenced code block as it is, markup and all", () => {
    expect(one("```text\n# not a heading\n<script>x</script>\n```")).toEqual(node("pre", {}, node("code", {}, "# not a heading\n<script>x</script>")));
    expect(one("~~~\n**not bold**\n~~~")).toEqual(node("pre", {}, node("code", {}, "**not bold**")));
  });
});

describe("links", () => {
  it("links to a part of the page, to the book's pages and to https addresses", () => {
    expect(para("[a](#hunger) [b](/rules/combat-basics) [c](/rules/combat-basics#initiative) [d](/rules)")).toEqual([
      node("a", { href: "#sec-hunger" }, "a"),
      " ",
      node("a", { href: "/rules/combat-basics" }, "b"),
      " ",
      node("a", { href: "/rules/combat-basics#sec-initiative" }, "c"),
      " ",
      node("a", { href: "/rules" }, "d"),
    ]);
  });

  it("opens an https address with no opener and no referrer", () => {
    expect(para('[site](https://example.com/a?b=1 "A title") <https://example.com>')).toEqual([
      node("a", { href: "https://example.com/a?b=1", rel: "noopener noreferrer" }, "site"),
      " ",
      node("a", { href: "https://example.com/", rel: "noopener noreferrer" }, "https://example.com"),
    ]);
  });

  it("keeps emphasis inside a link's text", () => {
    expect(para("[see *this*](#x)")).toEqual([node("a", { href: "#sec-x" }, "see ", node("em", {}, "this"))]);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "<javascript:alert(1)>",
    "http://example.com",
    "//example.com",
    "data:text/html,hi",
    "mailto:a@example.com",
    "https://user:secret@example.com",
    "/admin",
    "/rules/../admin",
    "/rules/Combat",
    "/rules/a/b",
    "combat.md",
    '#"onmouseover=x',
    "#a%20b",
    "#%E0%A4%A",
  ])("shows a link to %s as its text only", (destination) => {
    expect(para(`[text](${destination})`)).toEqual(["text"]);
  });

  it("agrees with the slug rule the database checks", () => {
    for (const slug of ["combat", "combat-basics", "a1-b2"]) expect(safeHref(`/rules/${slug}`)).toBe(`/rules/${slug}`);
    for (const slug of ["Combat", "combat_basics", "-x", "x-", "a--b"]) {
      expect(CHAPTER_SLUG.test(slug)).toBe(false);
      expect(safeHref(`/rules/${slug}`)).toBeNull();
    }
  });
});

describe("what the reader never makes", () => {
  it("shows raw HTML as text", () => {
    expect(parseMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<div>raw</div>")).toEqual([
      p("<script>alert(1)</script>"),
      p("<img src=x onerror=alert(1)>"),
      p("<div>raw</div>"),
    ]);
  });

  it("shows an image as its alt text, and never loads it", () => {
    expect(para("A ![map of *the* ruins](https://example.com/map.png) here")).toEqual(["A map of the ruins here"]);
  });

  it("leaves entities as they are written", () => {
    expect(para("&lt;b&gt; &amp;")).toEqual(["&lt;b&gt; &amp;"]);
  });

  it("makes only its own tags and attributes, whatever the text", () => {
    const text = [
      "# T\n\n<iframe src=x></iframe>",
      "[x](javascript:alert(1)) ![y](https://example.com/y.png) <a href=x onclick=y>z</a>",
      "- <b>bold</b>\n  > <style>p{}</style>",
      "| <th onmouseover=x> |\n|---|\n| <td style=color:red> |",
      "```\n<script>\n```",
      "[a](#b) [c](https://example.com) <https://example.com>",
    ].join("\n\n");
    for (const n of walk(parseMarkdown(text))) {
      expect(TAGS.has(n.tag), n.tag).toBe(true);
      for (const [key, value] of Object.entries(n.props)) {
        expect(PROPS.has(key), key).toBe(true);
        if (value !== undefined) expect(typeof value).toBe("string");
      }
    }
  });
});
