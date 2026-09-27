// One entry per sheet field the generic binder knows about: its path in the
// sheet (dot-separated, e.g. "base.end" or "weapons.0.name"), its kind, and a
// label for tooling. A page tags one input with data-f="<path>"; bindings.js
// writes it and render.js reads it, both from this list, so a field needs one
// entry here instead of a line in blank(), a page builder, bindings.js and
// render.js each (docs/adr/0019).
//
// Fields move here page by page. A page not yet converted keeps its own
// data-* code in bindings.js and render.js; both live side by side until
// every page has moved.
import { ATTRS, MONITORS, SPECIALS } from "../eclipse-content.js";
import { ALL_SKILLS, chooseProfession, chooseRace, int, intOrBlank } from "../eclipse-rules.js";

// How an input's value becomes a stored value. A checkbox also says how a
// stored value becomes its checked state; the others share one display rule
// in render.js's fillFields (a field's own fallback or hideZero flag aside).
export const KINDS = {
  // Kept exactly as typed.
  text: { toStored: (el) => el.value },
  // Always a whole number; blank reads as 0.
  number: { toStored: (el) => int(el.value) },
  // Blank stays blank; anything else is a whole number.
  blankNumber: { toStored: (el) => intOrBlank(el.value) },
  // A checkbox.
  checkbox: { toStored: (el) => el.checked, toDisplay: (v) => !!v, isCheckbox: true },
};

// Reads a path off a sheet. A missing step reads as undefined.
export function pathGet(sheet, path) {
  return path.split(".").reduce((v, key) => (v == null ? undefined : v[key]), sheet);
}

// Writes a path into a sheet, making an object for a step that is missing (so
// a row a page has not drawn yet can still be written into, the same as a
// row of a growing list gets one the first time something writes to it).
export function pathSet(sheet, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let target = sheet;
  for (const key of keys) {
    if (target[key] === undefined || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[last] = value;
}

// One field per row of a list. `count` is how many rows to cover: a
// fixed-size list (Core's weapons, mods, soakMods) passes its length from
// blank(); a list that grows or shrinks would pass the live sheet's current
// length instead, built again each time its rows are drawn.
export function rows(listPath, count, subFields) {
  return Array.from({ length: count }, (_, i) => subFields.map((f) => ({ ...f, path: `${listPath}.${i}.${f.path}` }))).flat();
}

const baseField = (attr) => ({ path: `base.${attr.k}`, kind: "number", label: `${attr.n} base` });
// A zero Oth shows blank, so an untouched row reads clean.
const othField = (attr) => ({ path: `oth.${attr.k}`, kind: "number", label: `${attr.n} other`, hideZero: true });

// Core page (docs/adr/0019): identity, attributes, skills, gear, dial modifiers.
export const CORE_FIELDS = [
  { path: "id.name", kind: "text", label: "Survivor name" },
  // Race and profession pick a row from a content table, which can carry other
  // fields with it (chooseRace sets Sanity; chooseProfession sets the master skill).
  { path: "id.race", kind: "text", label: "Race", fallback: "human", apply: chooseRace },
  { path: "id.prof", kind: "text", label: "Profession", apply: chooseProfession },
  { path: "id.master", kind: "text", label: "Master skill" },
  { path: "id.bg", kind: "text", label: "Background" },
  { path: "id.grit", kind: "text", label: "Grit banked" },
  ...[...ATTRS, ...SPECIALS].map(baseField),
  ...[...ATTRS, ...SPECIALS].map(othField),
  ...ALL_SKILLS.map((name) => ({ path: `skills.${name}`, kind: "blankNumber", label: `${name} level` })),
  ...ALL_SKILLS.map((name) => ({ path: `sother.${name}`, kind: "blankNumber", label: `${name} other` })),
  { path: "armor.name", kind: "text", label: "Armor name" },
  { path: "armor.b", kind: "text", label: "Armor ballistic AV" },
  { path: "armor.i", kind: "text", label: "Armor impact AV" },
  { path: "armor.ap", kind: "text", label: "Armor AP penalty" },
  { path: "armor.soaked", kind: "text", label: "Armor damage soaked" },
  { path: "shield.name", kind: "text", label: "Shield name" },
  { path: "shield.b", kind: "text", label: "Shield ballistic AV" },
  { path: "shield.i", kind: "text", label: "Shield impact AV" },
  { path: "shield.ap", kind: "text", label: "Shield AP cost" },
  { path: "shield.soaked", kind: "text", label: "Shield damage soaked" },
  { path: "applyPen", kind: "checkbox", label: "Apply dice penalty" },
  { path: "useShieldSoak", kind: "checkbox", label: "Raise shield for soak" },
  { path: "dy.aided", kind: "checkbox", label: "Stabilized by an ally" },
  ...MONITORS.map((m) => ({ path: `notes.${m.track}`, kind: "text", label: `${m.name} notes`, after: null })),
  ...rows("mods", 3, [
    { path: "n", kind: "text", label: "Modifier source", after: null },
    { path: "v", kind: "blankNumber", label: "Modifier value" },
  ]),
  ...rows("soakMods", 1, [
    { path: "n", kind: "text", label: "Soak source name", after: null },
    { path: "b", kind: "blankNumber", label: "Soak source ballistic" },
    { path: "i", kind: "blankNumber", label: "Soak source impact" },
    { path: "p", kind: "blankNumber", label: "Soak source personnel" },
  ]),
  ...rows("weapons", 4, [
    { path: "name", kind: "text", label: "Weapon name" },
    { path: "skill", kind: "text", label: "Weapon skill" },
    { path: "ap", kind: "text", label: "Weapon AP" },
    { path: "dmg", kind: "text", label: "Weapon damage" },
    { path: "range", kind: "text", label: "Weapon range" },
    { path: "mode", kind: "text", label: "Weapon mode" },
    { path: "loaded", kind: "text", label: "Weapon loaded" },
    { path: "reserve", kind: "text", label: "Weapon reserve" },
    { path: "note", kind: "text", label: "Weapon notes" },
  ]),
  // A field with no "after" redraws the whole sheet after every change (most
  // feed a computed total somewhere); one that only feeds itself says so.
].map((f) => ({ after: "render", ...f }));

export const FIELD_BY_PATH = new Map(CORE_FIELDS.map((f) => [f.path, f]));
