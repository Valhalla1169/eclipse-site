// One entry per sheet field the generic binder knows about: its path in the
// sheet (dot-separated, e.g. "base.end" or "weapons.0.name"), its kind, and a
// label for tooling. A page tags one input with data-f="<path>"; bindings.js
// writes it and render.js reads it, both from this list, so a field needs one
// entry here instead of a line in blank(), a page builder, bindings.js and
// render.js each (docs/adr/0019).
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

// Testament page (docs/adr/0019): vitals, the profession and background prose,
// personality and the four-part story. None of it feeds a computed number
// elsewhere, so a write only needs saving (after: null), same as the old vi/tx
// writers it replaces.
export const TESTAMENT_FIELDS = [
  { path: "vitals.age", kind: "text", label: "Age" },
  { path: "vitals.height", kind: "text", label: "Height" },
  { path: "vitals.weight", kind: "text", label: "Weight" },
  { path: "vitals.visual", kind: "text", label: "Visual description" },
  { path: "prof.kit", kind: "text", label: "Starting kit item", grow: true },
  { path: "prof.knowledge", kind: "text", label: "Professional knowledge", grow: true },
  { path: "prof.contact", kind: "text", label: "Professional contact", grow: true },
  { path: "bg.gear", kind: "text", label: "Background starting gear", grow: true },
  { path: "bg.benefit", kind: "text", label: "Background mechanical benefit", grow: true },
  { path: "bg.connection", kind: "text", label: "Background connection", grow: true },
  { path: "persona.traits", kind: "text", label: "Personality traits", grow: true },
  { path: "persona.drives", kind: "text", label: "Personality drives", grow: true },
  { path: "persona.fears", kind: "text", label: "Personality fears", grow: true },
  { path: "persona.manner", kind: "text", label: "Mannerisms and voice", grow: true },
  { path: "story.before", kind: "text", label: "Testament: before", grow: true },
  { path: "story.eclipse", kind: "text", label: "Testament: the first year", grow: true },
  { path: "story.now", kind: "text", label: "Testament: now", grow: true },
  { path: "story.threads", kind: "text", label: "Testament: loose threads", grow: true },
].map((f) => ({ after: null, ...f }));

// Equipment page (docs/adr/0019): supplies, and the fixed set of carried slots
// (armor, shield, the four weapons from Core) that the Worn table shows a row
// for once named. wornW holds each slot's unit weight; wornX holds the rest
// (quantity, quality, trade value, notes) a player fills in here.
const SUP_FIELDS = [
  { path: "sup.rations", kind: "text", label: "Rations quantity" },
  { path: "sup.medQ", kind: "text", label: "Medical supplies quantity" },
  { path: "sup.medW", kind: "text", label: "Medical supplies unit weight" },
  { path: "sup.cmpQ", kind: "text", label: "Components quantity" },
  { path: "sup.cmpW", kind: "text", label: "Components unit weight" },
  { path: "sup.ammoQ", kind: "text", label: "Ammunition quantity" },
  { path: "sup.ammoW", kind: "text", label: "Ammunition unit weight" },
  { path: "sup.tv", kind: "text", label: "Supplies trade value" },
];
// Stored keys never change: "armor", "shield", "w0".."w3" (the Core weapon rows).
const CARRIED_SLOTS = [
  { key: "armor", label: "Armor" },
  { key: "shield", label: "Shield" },
  { key: "w0", label: "Weapon 1" },
  { key: "w1", label: "Weapon 2" },
  { key: "w2", label: "Weapon 3" },
  { key: "w3", label: "Weapon 4" },
];
export const EQUIPMENT_FIELDS = [
  ...SUP_FIELDS,
  ...CARRIED_SLOTS.map(({ key, label }) => ({ path: `wornW.${key}`, kind: "text", label: `${label} unit weight` })),
  ...CARRIED_SLOTS.flatMap(({ key, label }) => [
    { path: `wornX.${key}.q`, kind: "text", label: `${label} quantity` },
    { path: `wornX.${key}.ql`, kind: "text", label: `${label} quality` },
    { path: `wornX.${key}.tv`, kind: "text", label: `${label} trade value` },
    { path: `wornX.${key}.note`, kind: "text", label: `${label} notes` },
  ]),
].map((f) => ({ after: "render", ...f }));

// Casting page (docs/adr/0019): MP and PP spent, and the free Veil healing
// cast. Stored keys never change (they predate this ADR).
export const CASTING_FIELDS = [
  { path: "cast.mpSpent", kind: "text", label: "MP spent" },
  { path: "cast.ppSpent", kind: "text", label: "PP spent" },
  { path: "cast.freeHeal", kind: "checkbox", label: "Free Veil healing cast used" },
].map((f) => ({ after: "render", ...f }));

// Every fixed field the generic binder knows by its exact path, across every
// converted page.
export const FIELD_BY_PATH = new Map([...CORE_FIELDS, ...TESTAMENT_FIELDS, ...EQUIPMENT_FIELDS, ...CASTING_FIELDS].map((f) => [f.path, f]));

// The Log page's entries (docs/adr/0019): one row's fields, relative to the
// row (rows() joins them to a path once a row's index is known). Stored keys
// never change: "t" (title), "d" (session or date), "b" (the entry's text).
export const LOG_FIELDS = [
  { path: "t", kind: "text", label: "Entry title", after: "log" },
  { path: "d", kind: "text", label: "Entry session or date", after: "log" },
  { path: "b", kind: "text", label: "Entry text", after: "log", grow: true },
];

// The Testament page's growing lists: advantages, flaws, languages, the people
// a survivor knows. Stored keys never change (they predate this ADR).
export const ADV_FIELDS = [
  { path: "n", kind: "text", label: "Advantage name", after: null },
  { path: "t", kind: "text", label: "Advantage tier", after: null },
  { path: "e", kind: "text", label: "Advantage effect", after: null, grow: true },
];
export const FLAW_FIELDS = [
  { path: "n", kind: "text", label: "Flaw name", after: null },
  { path: "t", kind: "text", label: "Flaw severity", after: null },
  { path: "e", kind: "text", label: "Flaw effect", after: null, grow: true },
];
export const LANG_FIELDS = [
  { path: "n", kind: "text", label: "Language name", after: null },
  { path: "e", kind: "text", label: "Language origin", after: null, grow: true },
];
export const PEOPLE_FIELDS = [
  { path: "n", kind: "text", label: "Person name", after: null },
  { path: "r", kind: "text", label: "Person, to you", after: null },
  { path: "e", kind: "text", label: "Person, last known", after: null, grow: true },
];

// The Equipment page's growing lists: an item a player types in directly (a
// worn extra, or one of a container's own items — the same shape either way),
// and the containers themselves. Stored keys never change.
export const ITEM_FIELDS = [
  { path: "n", kind: "text", label: "Item name" },
  { path: "q", kind: "text", label: "Item quantity" },
  { path: "w", kind: "text", label: "Item unit weight" },
  { path: "ql", kind: "text", label: "Item quality" },
  { path: "tv", kind: "text", label: "Item trade value" },
  { path: "note", kind: "text", label: "Item notes" },
].map((f) => ({ after: "render", ...f }));
export const CONTAINER_FIELDS = [
  { path: "name", kind: "text", label: "Container name" },
  { path: "type", kind: "text", label: "Container type" },
  { path: "empty", kind: "text", label: "Container empty weight" },
  { path: "cap", kind: "text", label: "Container capacity" },
  { path: "ap", kind: "text", label: "Container AP" },
].map((f) => ({ after: "render", ...f }));

// The Casting page's growing lists: spells and powers share one row shape;
// a ritual's row swaps "t" (cast type) for "tt" (time invested). Stored keys
// never change (they predate this ADR).
export const SPELL_FIELDS = [
  { path: "n", kind: "text", label: "Spell name" },
  { path: "s", kind: "text", label: "Spell school" },
  { path: "l", kind: "text", label: "Spell level" },
  { path: "t", kind: "text", label: "Spell type" },
  { path: "e", kind: "text", label: "Spell effect", grow: true },
].map((f) => ({ after: "render", ...f }));
export const POWER_FIELDS = [
  { path: "n", kind: "text", label: "Power name" },
  { path: "s", kind: "text", label: "Power school" },
  { path: "l", kind: "text", label: "Power level" },
  { path: "t", kind: "text", label: "Power type" },
  { path: "e", kind: "text", label: "Power effect", grow: true },
].map((f) => ({ after: "render", ...f }));
export const RITUAL_FIELDS = [
  { path: "n", kind: "text", label: "Ritual name" },
  { path: "s", kind: "text", label: "Ritual school" },
  { path: "l", kind: "text", label: "Ritual level" },
  { path: "tt", kind: "text", label: "Ritual time invested" },
  { path: "e", kind: "text", label: "Ritual notes", grow: true },
].map((f) => ({ after: "render", ...f }));

// A page whose rows come and go describes its list once, here, instead of a
// count anyone has to keep in sync: `list` is the array's path, `fields` is
// one field per relative path in a row. A `#` segment in `list` stands for a
// whole-number index the list itself doesn't name yet, for a list nested in
// another (a container's own items).
export const GROWING_LISTS = [
  { list: "log", fields: LOG_FIELDS },
  { list: "adv", fields: ADV_FIELDS },
  { list: "flaw", fields: FLAW_FIELDS },
  { list: "lang", fields: LANG_FIELDS },
  { list: "people", fields: PEOPLE_FIELDS },
  { list: "wornExtra", fields: ITEM_FIELDS },
  { list: "containers", fields: CONTAINER_FIELDS },
  { list: "containers.#.items", fields: ITEM_FIELDS },
  { list: "spells", fields: SPELL_FIELDS },
  { list: "powers", fields: POWER_FIELDS },
  { list: "rituals", fields: RITUAL_FIELDS },
];

// A growing list whose own rows are plain values, not objects with named
// fields: "vSchools.0" holds a school's name directly, there is no field
// path to join it to. One kind covers every row.
export const VALUE_LISTS = [
  { list: "vSchools", kind: "text", label: "Veil school known", after: null },
  { list: "pSchools", kind: "text", label: "Psyche school known", after: null },
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternSegment = (segment) => (segment === "#" ? "\\d+" : escapeRegExp(segment));
const rowPattern = (list, fieldPath) =>
  new RegExp(`^${list.split(".").map(patternSegment).join("\\.")}\\.\\d+\\.${fieldPath.split(".").map(escapeRegExp).join("\\.")}$`);
const valuePattern = (list) => new RegExp(`^${list.split(".").map(patternSegment).join("\\.")}\\.\\d+$`);

const GROWING_FIELD_PATTERNS = GROWING_LISTS.flatMap(({ list, fields }) => fields.map((field) => ({ field, pattern: rowPattern(list, field.path) })));
const VALUE_LIST_PATTERNS = VALUE_LISTS.map(({ list, ...field }) => ({ field, pattern: valuePattern(list) }));

// Finds a field's definition by its exact path: a fixed field first (a Map
// lookup, so "constructor" and the like find nothing), then a growing list's
// row pattern (its list, a whole-number index, one of the row's own fields),
// then a value list's row pattern (its list, a whole-number index, nothing
// more). Neither pattern reads a sheet, so an index with no row drawn yet
// still resolves, and two sheets shown at once each resolve their own fields
// independently.
export function lookupField(path) {
  const fixed = FIELD_BY_PATH.get(path);
  if (fixed) return fixed;
  const row = GROWING_FIELD_PATTERNS.find(({ pattern }) => pattern.test(path));
  if (row) return { ...row.field, path };
  const value = VALUE_LIST_PATTERNS.find(({ pattern }) => pattern.test(path));
  return value && { ...value.field, path };
}
