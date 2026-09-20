import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The rendering rule (CLAUDE.md): text from people or the database only ever goes
// in as text, and nothing needs an inline style or handler (the CSP blocks them).
const root = new URL("../../public/js/", import.meta.url);

function files(dir = "") {
  return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name, "/")) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : [],
  );
}
const sources = files().map((name) => [name.replaceAll("\\", "/"), readFileSync(new URL(name, root), "utf8")]);

describe("public/js", () => {
  it.each(sources)("%s writes no markup from strings, except staticHtml in dom.js", (name, text) => {
    const hits = text.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/g) || [];
    expect(hits, name).toEqual(name === "dom.js" ? ["innerHTML"] : []);
  });

  it.each(sources)("%s sets no style attribute and no inline handler", (name, text) => {
    expect(text, name).not.toMatch(/setAttribute\(\s*["']style["']/);
    expect(text, name).not.toMatch(/\bstyle\s*=\s*["'\]|\bstyle:\s*["'`{]/);
    expect(text, name).not.toMatch(/\bon(click|input|change|load|error)\s*=\s*["']/i);
  });

  it("keeps the reference cards free of scripts, styles and handlers", () => {
    const text = readFileSync(new URL("sheet/reference-data.js", root), "utf8");
    expect(text).not.toMatch(/<script|<style|<iframe|<img|\sstyle=|\son[a-z]+=|javascript:/i);
  });
});
