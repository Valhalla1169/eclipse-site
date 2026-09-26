// The rulebook's Markdown, read safely (docs/adr/0016).
//
// parseMarkdown() is pure: it turns the text into a tree of { tag, props, children }
// nodes and strings. renderMarkdown() builds that tree with h(), so every part of the
// book's text becomes a text node, and only the tags and attributes made here exist.
// Raw HTML shows as text, an image as its alt text, and a link that does not go to a
// part of the page (#part), a page of the book (/rules/<slug>) or an https: address as
// its text only.
import { h } from "./dom.js";

export const CHAPTER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A heading's id starts with this, so no heading can take an id the page uses (main).
export const ANCHOR_PREFIX = "sec-";

const el = (tag, props = {}, children = []) => ({ tag, props, children });

export const textOf = (node) => (typeof node === "string" ? node : node.tag === "br" ? " " : node.children.map(textOf).join(""));

// GitHub's rule: lower case, no punctuation, a hyphen for each space.
export const headingSlug = (text) =>
  text
    .replace(/\s/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");

// ── Links ──────────────────────────────────────────────────────────────

const ANCHOR = /^[\p{L}\p{M}\p{N}\p{Pc}-]+$/u;
const BOOK_LINK = /^\/rules(?:\/([^/?#]+))?\/?(?:#(.*))?$/;

function anchorHref(anchor) {
  let decoded;
  try {
    decoded = decodeURIComponent(anchor);
  } catch {
    return null;
  }
  return ANCHOR.test(decoded) ? `#${ANCHOR_PREFIX}${decoded}` : null;
}

// The href for a link, or null when the book may not link there.
export function safeHref(destination) {
  if (destination.startsWith("#")) return anchorHref(destination.slice(1));
  const inBook = BOOK_LINK.exec(destination);
  if (inBook) {
    const [, slug, anchor] = inBook;
    if (slug !== undefined && !CHAPTER_SLUG.test(slug)) return null;
    const path = slug ? `/rules/${slug}` : "/rules";
    if (anchor === undefined) return path;
    const part = anchorHref(anchor);
    return part && path + part;
  }
  if (!/^https:\/\//i.test(destination)) return null;
  try {
    const url = new URL(destination);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const link = (href, children) => el("a", href.startsWith("https:") ? { href, rel: "noopener noreferrer" } : { href }, children);

// ── Inline text ────────────────────────────────────────────────────────

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (ch) => ch === undefined || /\s/u.test(ch);
const isPunct = (ch) => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
const unescape = (text) => text.replace(/\\([!-/:-@[-`{-~])/g, "$1");

// The match of a sticky pattern at i, or null.
function matchAt(text, i, pattern) {
  pattern.lastIndex = i;
  return pattern.exec(text);
}
const TICKS = /`+/y;
const STARS = /\*+/y;
const UNDERSCORES = /_+/y;
const AUTOLINK = /<(https:\/\/[^\s<>]+)>/iy;

const skip = (text, i, spaces = /[ \t\n]/) => {
  while (i < text.length && spaces.test(text[i])) i++;
  return i;
};

// Where the backtick run of `length` that closes a code span starts, or -1.
function closingTicks(text, from, length) {
  const run = /`+/g;
  run.lastIndex = from;
  for (let m = run.exec(text); m; m = run.exec(text)) if (m[0].length === length) return m.index;
  return -1;
}

// The ] that closes the [ at `open`, past escapes and code spans, or -1.
function closingBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "`") {
      const ticks = matchAt(text, i, TICKS)[0].length;
      const end = closingTicks(text, i + ticks, ticks);
      i = (end < 0 ? i : end) + ticks - 1;
    } else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i;
  }
  return -1;
}

// [label](destination "title") from the [ at `open`: { label, destination, end }, or null.
function readLink(text, open) {
  const close = closingBracket(text, open);
  if (close < 0 || text[close + 1] !== "(") return null;
  let i = skip(text, close + 2);
  let destination;
  if (text[i] === "<") {
    const end = text.indexOf(">", i);
    if (end < 0 || /[\n<]/.test(text.slice(i + 1, end))) return null;
    destination = text.slice(i + 1, end);
    i = end + 1;
  } else {
    const start = i;
    for (let depth = 0; i < text.length && !/\s/.test(text[i]); i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "(") depth++;
      else if (text[i] === ")" && depth-- === 0) break;
    }
    destination = text.slice(start, i);
  }
  const afterDestination = i;
  i = skip(text, i);
  if (i > afterDestination && /["'(]/.test(text[i])) {
    const quote = text[i] === "(" ? ")" : text[i];
    for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === "\\") i++;
    if (i >= text.length) return null;
    i = skip(text, i + 1);
  }
  if (text[i] !== ")") return null;
  return { label: text.slice(open + 1, close), destination: unescape(destination), end: i + 1 };
}

// Joins neighbouring strings, and turns runs of * and _ that paired with nothing back into text.
function tidy(items) {
  const out = [];
  for (const item of items) {
    const value = item.delim ? item.delim.repeat(item.count) : item;
    if (value === "") continue;
    if (typeof value === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += value;
    else out.push(value);
  }
  return out;
}

// CommonMark's rule for emphasis: each closing run pairs with the nearest opening run of
// the same character that may pair with it. `floors` remembers where a search found
// nothing, so a chapter full of lone stars is not searched from the start each time.
function emphasis(items) {
  const floors = new Map();
  const pairs = (opener, closer) =>
    opener.delim === closer.delim &&
    opener.count > 0 &&
    opener.canOpen &&
    !((opener.canClose || closer.canOpen) && (opener.length + closer.length) % 3 === 0 && (opener.length % 3 || closer.length % 3));
  let c = 0;
  while (c < items.length) {
    const closer = items[c];
    if (!closer.delim || !closer.canClose || closer.count === 0) {
      c++;
      continue;
    }
    const key = `${closer.delim}${closer.canOpen}${closer.length % 3}`;
    let o = c - 1;
    while (o >= 0 && !(items[o].delim && pairs(items[o], closer))) o = items[o] === floors.get(key) ? -1 : o - 1;
    if (o < 0) {
      floors.set(key, closer);
      c++;
      continue;
    }
    const opener = items[o];
    const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    opener.count -= used;
    closer.count -= used;
    items.splice(o + 1, c - o - 1, el(used === 2 ? "strong" : "em", {}, tidy(items.slice(o + 1, c))));
    c = o + 2;
  }
  return tidy(items);
}

function parseInline(text, inLink = false) {
  const items = [];
  let buffer = "";
  const push = (...nodes) => {
    if (buffer) items.push(buffer);
    buffer = "";
    items.push(...nodes);
  };
  let i = 0;
  let found;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "\n") {
      push(el("br"));
      i = skip(text, i + 2, /[ \t]/);
    } else if (ch === "\\" && ASCII_PUNCT.test(text[i + 1] || "")) {
      buffer += text[i + 1];
      i += 2;
    } else if (ch === "\n") {
      const hard = / {2,}$/.test(buffer);
      buffer = buffer.replace(/ +$/, "");
      if (hard) push(el("br"));
      else buffer += "\n";
      i = skip(text, i + 1, /[ \t]/);
    } else if (ch === "`") {
      const ticks = matchAt(text, i, TICKS)[0];
      const end = closingTicks(text, i + ticks.length, ticks.length);
      if (end < 0) {
        buffer += ticks;
        i += ticks.length;
      } else {
        const code = text.slice(i + ticks.length, end).replace(/\n/g, " ");
        push(el("code", {}, [/^ (?=.*[^ ]).* $/.test(code) ? code.slice(1, -1) : code]));
        i = end + ticks.length;
      }
    } else if (ch === "<" && !inLink && (found = matchAt(text, i, AUTOLINK))) {
      const href = safeHref(found[1]);
      if (href) push(link(href, [found[1]]));
      else buffer += found[0];
      i += found[0].length;
    } else if (ch === "!" && text[i + 1] === "[" && (found = readLink(text, i + 1))) {
      buffer += parseInline(found.label, true).map(textOf).join("");
      i = found.end;
    } else if (ch === "[" && !inLink && (found = readLink(text, i))) {
      const children = parseInline(found.label, true);
      const href = safeHref(found.destination);
      if (href) push(link(href, children));
      else push(...children);
      i = found.end;
    } else if (ch === "*" || ch === "_") {
      const run = matchAt(text, i, ch === "*" ? STARS : UNDERSCORES)[0];
      const before = text[i - 1];
      const after = text[i + run.length];
      const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
      const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
      push({
        delim: ch,
        length: run.length,
        count: run.length,
        canOpen: ch === "*" ? left : left && (!right || isPunct(before)),
        canClose: ch === "*" ? right : right && (!left || isPunct(after)),
      });
      i += run.length;
    } else {
      buffer += ch;
      i++;
    }
  }
  push();
  return emphasis(items);
}

// ── Blocks ─────────────────────────────────────────────────────────────

const isBlank = (line) => /^[ \t]*$/.test(line);
const indentOf = (line) => line.length - line.trimStart().length;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const DELIMITER_ROW = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

function fenceAt(line) {
  const m = FENCE.exec(line);
  return m && !(m[2][0] === "`" && m[3].includes("`")) ? m : null;
}
const listKind = (m) => (/\d/.test(m[2]) ? m[2].slice(-1) : m[2]);

// A list may start inside a paragraph only with an item that has text and, when
// numbered, is number 1.
function startsItem(line) {
  const m = ITEM.exec(line);
  return m && m[4].trim() !== "" && !RULE.test(line) && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1);
}
const interrupts = (line) => HEADING.test(line) || fenceAt(line) || RULE.test(line) || QUOTE.test(line) || startsItem(line);

// A table row's cells, split at each | that is not escaped.
function cells(row) {
  let text = row.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

const startsTable = (lines, i) =>
  lines[i].includes("|") && i + 1 < lines.length && DELIMITER_ROW.test(lines[i + 1]) && cells(lines[i]).length === cells(lines[i + 1]).length;

function heading(level, text, context) {
  const children = parseInline(text.trim());
  const id = context.uniqueId(headingSlug(children.map(textOf).join("")) || "section");
  return el(`h${level}`, { id: ANCHOR_PREFIX + id }, children);
}

function table(lines, i, context) {
  const align = cells(lines[i + 1]).map((cell) => (cell.endsWith(":") ? (cell.startsWith(":") ? "align-center" : "align-right") : undefined));
  const row = (line, tag) => {
    const values = cells(line);
    return el(
      "tr",
      {},
      align.map((className, k) => el(tag, { class: className, scope: tag === "th" ? "col" : undefined }, parseInline(values[k] || ""))),
    );
  };
  const parts = [el("thead", {}, [row(lines[i], "th")])];
  const body = [];
  for (i += 2; i < lines.length && !isBlank(lines[i]) && !interrupts(lines[i]); i++) body.push(row(lines[i], "td"));
  if (body.length) parts.push(el("tbody", {}, body));
  context.tables += 1;
  // A wide table scrolls in its own box, which the keyboard can reach.
  return { end: i, node: el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": `Table ${context.tables}` }, [el("table", {}, parts)]) };
}

function list(lines, i, context) {
  const first = ITEM.exec(lines[i]);
  const kind = listKind(first);
  const items = [];
  let loose = false;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || listKind(m) !== kind || RULE.test(lines[i])) break;
    const column = m[1].length + m[2].length + (m[3].length === 0 || m[3].length > 4 ? 1 : m[3].length);
    const body = [m[4]];
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (isBlank(line)) body.push("");
      else if (indentOf(line) >= column) body.push(line.slice(column));
      else if (!isBlank(body[body.length - 1]) && !interrupts(line) && !ITEM.test(line)) body.push(line.trimStart());
      else break;
    }
    let blankAfter = false;
    while (body.length > 1 && isBlank(body[body.length - 1])) {
      body.pop();
      blankAfter = true;
    }
    const parsed = blocks(body, context);
    items.push(parsed.nodes);
    const next = i < lines.length && ITEM.exec(lines[i]);
    if (parsed.gap || (blankAfter && next && listKind(next) === kind && !RULE.test(lines[i]))) loose = true;
  }
  // A tight list keeps its items' text out of paragraphs.
  const lis = items.map((nodes) => el("li", {}, loose ? nodes : nodes.flatMap((node) => (node.tag === "p" ? node.children : [node]))));
  const start = parseInt(first[2], 10);
  const node = kind === "." || kind === ")" ? el("ol", start === 1 ? {} : { start: String(start) }, lis) : el("ul", {}, lis);
  return { end: i, node };
}

// Lines of text into nodes. `gap` is true when a blank line separates two of them.
function blocks(lines, context) {
  const nodes = [];
  let gap = false;
  let blank = false;
  const add = (node) => {
    if (blank && nodes.length) gap = true;
    blank = false;
    nodes.push(node);
  };
  let i = 0;
  let m;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      blank = true;
      i++;
    } else if ((m = fenceAt(line))) {
      const [, indent, fence] = m;
      const closing = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
      const code = [];
      for (i++; i < lines.length && !closing.test(lines[i]); i++) code.push(lines[i].slice(Math.min(indent.length, indentOf(lines[i]))));
      i++;
      add(el("pre", {}, [el("code", {}, [code.join("\n")])]));
    } else if ((m = HEADING.exec(line))) {
      add(heading(m[1].length, m[2] || "", context));
      i++;
    } else if (RULE.test(line)) {
      add(el("hr"));
      i++;
    } else if (QUOTE.test(line)) {
      const inner = [];
      for (; i < lines.length; i++) {
        const quoted = QUOTE.exec(lines[i]);
        if (quoted) inner.push(quoted[1]);
        else if (!isBlank(lines[i]) && !isBlank(inner[inner.length - 1]) && !interrupts(lines[i])) inner.push(lines[i]);
        else break;
      }
      add(el("blockquote", {}, blocks(inner, context).nodes));
    } else if (ITEM.test(line)) {
      const found = list(lines, i, context);
      add(found.node);
      i = found.end;
    } else if (startsTable(lines, i)) {
      const found = table(lines, i, context);
      add(found.node);
      i = found.end;
    } else {
      const text = [line.trimStart()];
      let level = 0;
      for (i++; i < lines.length && !isBlank(lines[i]); i++) {
        const underline = UNDERLINE.exec(lines[i]);
        if (underline) {
          level = underline[1][0] === "=" ? 1 : 2;
          i++;
          break;
        }
        if (interrupts(lines[i]) || startsTable(lines, i)) break;
        text.push(lines[i].trimStart());
      }
      add(level ? heading(level, text.join("\n"), context) : el("p", {}, parseInline(text.join("\n").trimEnd())));
    }
  }
  return { nodes, gap };
}

export function parseMarkdown(markdown) {
  const lines = String(markdown)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, "    ")));
  const used = new Set();
  const context = {
    tables: 0,
    // GitHub's rule for a heading used twice: combat, then combat-1.
    uniqueId(base) {
      let id = base;
      for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      return id;
    },
  };
  return blocks(lines, context).nodes;
}

const build = (node) => (typeof node === "string" ? node : h(node.tag, node.props, ...node.children.map(build)));

export const renderMarkdown = (markdown) => parseMarkdown(markdown).map(build);
