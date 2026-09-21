import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Resolves the colour tokens in public/style.css and public/sheet.css for each
// palette, then checks WCAG contrast (DESIGN.md section 4): 4.5:1 for small
// text, 3:1 for the graphics and borders that carry meaning.
const read = (file) => readFileSync(new URL(`../../public/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function blocks(css) {
  const found = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = {};
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declarations[name] = value.trim();
    found.push({ selector: selector.trim(), declarations });
  }
  return found;
}

const site = blocks(read("style.css"));
const sheet = blocks(read("sheet.css"));
const THEMES = ["latte", "frappe", "macchiato", "mocha"];

function tokensFor(theme) {
  const pick = (list, selector) => Object.assign({}, ...list.filter((b) => b.selector === selector).map((b) => b.declarations));
  return {
    ...pick(site, ":root"),
    ...pick(site, `[data-theme="${theme}"]`),
    ...pick(sheet, ".sheet"),
    ...pick(sheet, `[data-theme="${theme}"] .sheet`),
  };
}

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

// Splits "a, b, c" at top-level commas only.
function splitArguments(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function resolve(value, tokens) {
  const text = value.trim();
  if (text.startsWith("#")) return hex(text);
  const reference = text.match(/^var\((--[\w-]+)\)$/);
  if (reference) {
    if (!(reference[1] in tokens)) throw new Error(`unknown token ${reference[1]}`);
    return resolve(tokens[reference[1]], tokens);
  }
  const mix = text.match(/^color-mix\(in srgb,(.*)\)$/);
  if (mix) {
    const [first, second] = splitArguments(mix[1]);
    const [, firstColour, percent] = first.match(/^(.*?)\s+(\d+(?:\.\d+)?)%$/);
    const p = Number(percent) / 100;
    const a = resolve(firstColour, tokens);
    const b = resolve(second, tokens);
    return a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
  }
  throw new Error(`cannot resolve ${text}`);
}

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

const ACCENTS = ["corona", "rift", "blood", "bile", "ok", "hunger", "psy"];
// Where sheet text sits: panel, table stripe and heading, input well, page.
const TEXT_SURFACES = ["--slab", "--slab2", "--well", "--void"];
const GRAPHIC_SURFACES = ["--slab", "--well", "--void"];

describe.each(THEMES)("footer icon colour in %s", (theme) => {
  const tokens = tokensFor(theme);

  it("is 3:1 on the footer band and the hover fill", () => {
    for (const surface of ["--crust", "--mantle"]) {
      expect(contrast(resolve("var(--icon)", tokens), resolve(`var(${surface})`, tokens)), `--icon on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe.each(THEMES)("sheet colours in %s", (theme) => {
  const tokens = tokensFor(theme);
  const colour = (name) => resolve(`var(${name})`, tokens);

  it.each(["--bone", "--bone-dim", ...ACCENTS.map((a) => `--${a}-t`)])("text token %s is 4.5:1 on every surface", (name) => {
    for (const surface of TEXT_SURFACES) {
      expect(contrast(colour(name), colour(surface)), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ACCENTS.map((a) => `--${a}`))("graphic token %s is 3:1 on the panel, the well and the page", (name) => {
    for (const surface of GRAPHIC_SURFACES) {
      expect(contrast(colour(name), colour(surface)), `${name} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws form and button borders at 3:1", () => {
    for (const surface of ["--slab", "--well"]) {
      expect(contrast(colour("--field"), colour(surface)), `--field on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});
