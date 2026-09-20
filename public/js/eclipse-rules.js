// The rules of Age of Eclipse and the shape of a character sheet, with no DOM and
// no Supabase, so the player sheet, the DM roster and the unit tests share it.
//
// A sheet stores INPUTS only. Totals, penalties, pools and tiers are computed
// here every time they are shown, so a rules change never needs a data change
// (docs/adr/0004). A change that renames, removes or retypes a stored field is
// a new SCHEMA_VERSION with a step in MIGRATIONS.

export const SCHEMA_VERSION = 1;

export const MONITOR_BOXES = 10; // Shock, Trauma and Rot each hold ten
export const TRACK_MAX = 10; // Sanity and Morality both run 1 to 10
export const SHIELD_DEGRADE_STEP = 10;

export const ATTRS = [
  { k: "end", a: "E", n: "Endurance" },
  { k: "cla", a: "C", n: "Clarity" },
  { k: "let", a: "L", n: "Lethality" },
  { k: "ins", a: "I", n: "Instinct" },
  { k: "pre", a: "P", n: "Presence" },
  { k: "ste", a: "S", n: "Steadfast" },
];
export const SPECIALS = [
  { k: "ess", a: "E", n: "Essence", def: 10 },
  { k: "san", a: "S", n: "Sanity", def: 8 },
  { k: "vei", a: "V", n: "Veil", def: 0 },
  { k: "psy", a: "P", n: "Psyche", def: 0 },
];
export const ATTR_NAMES = {
  end: "Endurance",
  cla: "Clarity",
  let: "Lethality",
  ins: "Instinct",
  pre: "Presence",
  ste: "Steadfast",
  vei: "Veil",
  psy: "Psyche",
};

// The book's 15 professions. Master Skill +2, and +1 to one attribute.
export const PROFS = {
  "Blue Collar Laborer": { a: "end", m: "Resilience" },
  "Chef / Cook": { a: "cla", m: "Survival" },
  "Construction Worker": { a: "end", m: "Athletics" },
  "Corporate Executive": { a: "pre", m: "Bartering" },
  "Criminal / Outlaw": { a: "ins", m: "Stealth" },
  Engineer: { a: "cla", m: "Engineering" },
  "Entertainer / Artist": { a: "pre", m: "Persuasion" },
  Farmer: { a: "end", m: "Survival" },
  "Law Enforcement": { a: "ins", m: "Perception" },
  Mechanic: { a: "cla", m: "Engineering" },
  "Medical Doctor": { a: "cla", m: "Medicine" },
  Military: { a: "end", m: "Firearms" },
  "Paramedic / EMT": { a: "ste", m: "Medicine" },
  Scientist: { a: "cla", m: "Eclipse Knowledge" },
  Teacher: { a: "cla", m: "Eclipse Knowledge" },
};

export const RACES = {
  human: { name: "Human", mods: {}, san: 8, abil: "no racial modifiers" },
  voidtouched: { name: "Voidtouched", mods: { let: -1, ins: 1, cla: -1, ste: 1 }, san: 6, abil: "Shadow Blend +2 stealth in dark" },
  starborne: { name: "Starborne", mods: { let: -1, end: 1, cla: 1, ste: -1 }, san: 6, abil: "Cosmic Awareness +2 rift nav" },
  hallowed: { name: "Hallowed", mods: { ins: 1, end: 1, cla: -1, pre: -1 }, san: 6, abil: "Celestial Grace +2 acrobatics/dodge" },
  fleshwarped: { name: "Fleshwarped", mods: { let: -1, ins: 1, cla: 1, pre: -1 }, san: 6, abil: "Adaptive Physiology +2 resilience" },
  infernal: { name: "Infernal", mods: { let: 1, ins: -1, ste: 1, pre: -1 }, san: 6, abil: "Infernal Strength +2 might/intimidate" },
  wirehead: { name: "Wirehead", mods: { let: 1, ins: -1, cla: 1, pre: -1 }, san: 6, abil: "Data Analysis +2 investigation/tech" },
};
export const NO_RACIAL_ABILITY = RACES.human.abil;

export const SKILLS = [
  ["Endurance", "end", ["Athletics", "Resilience"]],
  ["Clarity", "cla", ["Crafting", "Eclipse Knowledge", "Engineering", "History", "Investigation", "Perception", "Scavenge", "Survival", "Tactics", "Tech Use"]],
  ["Lethality", "let", ["Archery", "Bludgeoning", "Edged Weapons", "Grapple", "Polearms", "Thrown Weapons", "Unarmed Combat"]],
  ["Instinct", "ins", ["Acrobatics", "Dodge", "Firearms", "Gunnery", "Heavy Weapons", "Stealth"]],
  ["Presence", "pre", ["Animal Handling", "Bartering", "Deception", "Intimidation", "Leadership", "Persuasion", "Rally"]],
  ["Steadfast", "ste", ["Composure", "Insight", "Medicine"]],
  ["Veil", "vei", ["Ritual Casting", "Sorcery"]],
  ["Psyche", "psy", ["Psionics"]],
];
export const ALL_SKILLS = SKILLS.flatMap(([, , list]) => list).sort((a, b) => a.localeCompare(b));
export const SKILL_ATTR = Object.fromEntries(SKILLS.flatMap(([, ak, list]) => list.map((s) => [s, ak])));

// Only skills you can attack with.
export const COMBAT_SKILLS = [
  "Archery", "Bludgeoning", "Edged Weapons", "Firearms", "Grapple", "Gunnery",
  "Heavy Weapons", "Polearms", "Thrown Weapons", "Unarmed Combat",
];
export const WEAPON_MODES = ["SA", "SA / BF", "SA / BF / FA", "Melee", "Thrown", "none"];

export const ADV_TIERS = ["Tier 1 (5 pts)", "Tier 2 (5 pts)", "Tier 3 (8 pts)"];
export const FLAW_TIERS = ["Light (+3 pts)", "Medium (+4 pts)", "Heavy (+5 pts)"];

export const VEIL_SCHOOLS = [
  "Combat Magic (Fire)", "Healing Magic (Water)", "Detection Magic (Air)",
  "Enchantment Magic (Light)", "Protection Magic (Earth)", "Illusion Magic (Aether)",
];
export const PSY_SCHOOLS = [
  "Telekinesis", "Telepathy", "Precognition", "Psychic Healing", "Psychic Shielding",
  "Psychic Influence", "Psychic Empathy", "Psychic Projection", "Psychic Manipulation", "Astral Projection",
];
export const CAST_TYPES = ["Attack", "Healing", "Utility", "Enhancement", "Protection", "Ritual", "Counter"];
export const EFFECT_SCALE = [
  "Trivial", "Weak", "Standard", "Strong", "Potent", "Dangerous",
  "Devastating", "Catastrophic", "Apocalyptic", "Reality-breaking",
];

// Rituals are Veil only. Time invested sets how long the effect lasts, what the
// materials cost and how much Exertion Shock casting it inflicts. `unit: null`
// marks the 24-hour tier: its duration is Permanent, and it carries the +3
// permanent Rift Scar.
export const RITUAL_TIERS = [
  { t: "10 min", unit: "hour", tvBase: 5, idx: 0 },
  { t: "30 min", unit: "day", tvBase: 10, idx: 1 },
  { t: "1 hour", unit: "week", tvBase: 20, idx: 2 },
  { t: "4 hours", unit: "month", tvBase: 50, idx: 3 },
  { t: "8 hours", unit: "year", tvBase: 100, idx: 4 },
  { t: "24 hours", unit: null, tvBase: 200, idx: 5 },
];

export const SANITY = [
  { t: "gone" }, { t: "shattered" }, { t: "unravelling" }, { t: "slipping" }, { t: "fraying" },
  { t: "strained" }, { t: "holding" }, { t: "steady" }, { t: "clear" }, { t: "lucid" },
];
export const MORALITY = [
  { t: "Monstrous", l: "Even your allies watch the door when you sleep." },
  { t: "Cruel", l: "You stopped counting the ones you left behind." },
  { t: "Ruthless", l: "Whatever it takes, and it usually takes a lot." },
  { t: "Hardened", l: "You help when it is cheap to help." },
  { t: "Pragmatic", l: "You do the arithmetic before you do the right thing." },
  { t: "Human", l: "Still recognisably the person you were before." },
  { t: "Decent", l: "People remember that you came back for them." },
  { t: "Principled", l: "You keep promises that cost you something." },
  { t: "Selfless", l: "Strangers hear your name before they meet you." },
  { t: "Luminous", l: "Emily talks about people like you when she still has hope." },
];

// A monitor at capacity takes over the dial. Trauma outranks Rot outranks Shock.
export const CRITICAL_MONITORS = [
  { track: "trauma", badge: "Dying", line: "Trauma is full. You are unconscious and dying. Someone has to stabilize you." },
  { track: "rot", badge: "Corrupted", line: "Rot is full. You are losing 1 Essence every hour until there is none left." },
  { track: "shock", badge: "Unconscious", line: "Shock is full. You are unconscious, and the overflow is turning into Trauma." },
];

export const veilAP = (level) => level;
// The book's own table caps Psyche AP at 5.
export const psyAP = (level) => Math.min(5, Math.floor(level / 2) + 1);
// One school per two points in the attribute.
export const schoolSlots = (rating) => Math.floor(rating / 2);

// Names in stored data pick rows from the tables above, so "constructor" must not match.
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/* ── numbers ──────────────────────────────────────────────── */

export const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
};
export const num = (v) => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
};
export const fdiv = (a, b) => Math.floor(a / b);
export const r1 = (n) => Math.round(n * 10) / 10;
// A blank field stays blank; anything else becomes an integer.
export const intOrBlank = (v) => {
  const text = String(v).trim();
  return text === "" || text === "-" ? "" : int(text);
};
// Clicking box i (1-based) fills up to it; clicking the top filled box steps back one.
export const toggleBox = (current, i) => (current === i ? i - 1 : i);

/* ── state ────────────────────────────────────────────────── */

export const blank = () => ({
  id: { name: "", race: "human", prof: "", bg: "", grit: "", master: "" },
  base: { end: 1, cla: 1, let: 1, ins: 1, pre: 1, ste: 1, ess: 10, san: 8, vei: 0, psy: 0 },
  oth: { end: 0, cla: 0, let: 0, ins: 0, pre: 0, ste: 0, ess: 0, san: 0, vei: 0, psy: 0 },
  skills: {},
  sother: {},
  cm: { shock: 0, trauma: 0, rot: 0 },
  mods: [{ n: "", v: "" }, { n: "", v: "" }, { n: "", v: "" }],
  applyPen: true,
  useShieldSoak: false,
  sanity: 8,
  soakMods: [{ n: "", b: "", i: "", p: "" }],
  starve: 0,
  morality: 5,
  dy: { succ: 0, over: 0, aided: false },
  notes: { shock: "", trauma: "", rot: "" },
  sup: { rations: "", medQ: "", medW: 1, cmpQ: "", cmpW: 1, ammoQ: "", ammoW: 0.05, tv: "" },
  wornExtra: [{}, {}],
  wornW: { armor: "", shield: "", w0: "", w1: "", w2: "", w3: "" },
  wornX: {}, // quantity, quality, TV and notes for rows carried from Core
  vitals: { age: "", height: "", weight: "", visual: "" },
  prof: { kit: "", knowledge: "", contact: "" },
  bg: { gear: "", benefit: "", connection: "" },
  persona: { traits: "", drives: "", fears: "", manner: "" },
  story: { before: "", eclipse: "", now: "", threads: "" },
  adv: [{}, {}, {}],
  flaw: [{}, {}, {}],
  lang: [{ n: "English" }, {}, {}],
  people: [{}, {}, {}],
  cast: { mpSpent: "", ppSpent: "", freeHeal: false },
  vSchools: [],
  pSchools: [],
  spells: [{}, {}, {}],
  powers: [{}, {}, {}],
  rituals: [{}],
  log: [{ t: "", d: "", b: "" }],
  containers: [
    { name: "", type: "", empty: "", cap: "", ap: "", items: [{}, {}, {}, {}, {}, {}] },
    { name: "", type: "", empty: "", cap: "", ap: "", items: [{}, {}, {}] },
  ],
  weapons: [{}, {}, {}, {}],
  armor: { name: "", b: 0, i: 0, ap: 0, dp: "", soaked: 0 },
  shield: { name: "", b: 0, i: 0, ap: 0, soaked: 0 },
});

export class SheetFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "SheetFormatError";
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Groups of fields, merged one level deep so a new field gets its default.
const OBJECT_GROUPS = [
  "id", "base", "oth", "skills", "sother", "cm", "dy", "sup", "wornW", "wornX", "cast",
  "vitals", "prof", "bg", "persona", "story", "notes", "armor", "shield",
];
// Lists that always hold at least one row, so the sheet always has a row to type in.
const LIST_GROUPS = [
  "adv", "flaw", "lang", "people", "spells", "powers", "rituals", "log",
  "wornExtra", "containers", "weapons", "mods", "soakMods",
];
const NUMBER_FIELDS = ["starve", "morality", "sanity"];

// Turns saved data (from the database or a .eclipse file) into a full sheet.
// Fields the code does not know are kept, so an older client never erases what
// a newer one wrote. Data that cannot be a sheet throws SheetFormatError, and
// the caller must then leave the stored copy alone.
export function normalize(data) {
  if (!isPlainObject(data)) throw new SheetFormatError("A sheet must be an object.");
  const defaults = blank();
  const sheet = { ...defaults, ...structuredClone(data) };

  for (const key of OBJECT_GROUPS) {
    if (sheet[key] === undefined || sheet[key] === null) sheet[key] = defaults[key];
    else if (!isPlainObject(sheet[key])) throw new SheetFormatError(`Field "${key}" must be an object.`);
    else sheet[key] = { ...defaults[key], ...sheet[key] };
  }
  for (const key of LIST_GROUPS) {
    if (sheet[key] === undefined || sheet[key] === null) sheet[key] = defaults[key];
    else if (!Array.isArray(sheet[key])) throw new SheetFormatError(`Field "${key}" must be a list.`);
    else if (!sheet[key].length) sheet[key] = defaults[key];
  }
  for (const key of ["vSchools", "pSchools"]) {
    if (sheet[key] === undefined || sheet[key] === null) sheet[key] = [];
    else if (!Array.isArray(sheet[key])) throw new SheetFormatError(`Field "${key}" must be a list.`);
  }
  for (const key of NUMBER_FIELDS) if (typeof sheet[key] !== "number") sheet[key] = defaults[key];
  if (typeof sheet.applyPen !== "boolean") sheet.applyPen = true;
  if (typeof sheet.useShieldSoak !== "boolean") sheet.useShieldSoak = false;

  // Rows are edited in place, so each must be an object; containers also need their item list.
  for (const key of LIST_GROUPS) {
    sheet[key] = sheet[key].map((row) => {
      if (!isPlainObject(row)) throw new SheetFormatError(`A row of "${key}" must be an object.`);
      return row;
    });
  }
  // A sheet saved before the second container existed gets the missing one.
  while (sheet.containers.length < defaults.containers.length) sheet.containers.push(defaults.containers[sheet.containers.length]);
  for (const container of sheet.containers) {
    if (container.items === undefined || container.items === null) container.items = [{}, {}, {}];
    else if (!Array.isArray(container.items)) throw new SheetFormatError('A container\'s "items" must be a list.');
    else if (!container.items.length) container.items = [{}];
    container.items = container.items.map((item) => {
      if (!isPlainObject(item)) throw new SheetFormatError("A container item must be an object.");
      return item;
    });
  }
  return sheet;
}

// Steps that bring older stored data up to the next version. MIGRATIONS[n] takes
// version n data and returns version n + 1 data. Empty while every sheet is version 1.
const MIGRATIONS = {};

export function migrate(data, from, { to = SCHEMA_VERSION, steps = MIGRATIONS } = {}) {
  let current = data;
  for (let version = from; version < to; version += 1) {
    const step = steps[version];
    if (!step) throw new SheetFormatError(`No migration from sheet version ${version}.`);
    current = step(current);
  }
  return current;
}

// What the app does with a stored row. A sheet from a newer version is shown but
// never saved: an old page must not overwrite what a newer one wrote.
export function openSheet({ data, schema_version: version }, { current = SCHEMA_VERSION, steps = MIGRATIONS } = {}) {
  const stored = Number.isInteger(version) && version >= 1 ? version : 1;
  const newer = stored > current;
  const sheet = normalize(newer ? data : migrate(data, stored, { to: current, steps }));
  return { sheet, readOnly: newer, migrated: !newer && stored < current, schemaVersion: current };
}

/* ── mutations (what a click or a choice does to the sheet) ── */

export function chooseRace(sheet, race) {
  sheet.id.race = race;
  const known = own(RACES, race);
  if (known) {
    sheet.base.san = known.san;
    sheet.sanity = known.san;
  }
}

// The book pairs each profession with its Master Skill. A custom profession keeps the current one.
export function chooseProfession(sheet, name) {
  sheet.id.prof = name;
  const profession = own(PROFS, name.trim());
  if (profession) sheet.id.master = profession.m;
}

// Clicking a condition box. A Trauma below ten means no longer dying, so the tracker clears.
export function setCondition(sheet, track, boxNumber) {
  sheet.cm[track] = toggleBox(sheet.cm[track], boxNumber);
  if (track === "trauma" && sheet.cm.trauma < MONITOR_BOXES) sheet.dy = { succ: 0, over: 0, aided: false };
}

// An overflow box is a Trauma box, so the monitor follows it.
export function setOverflow(sheet, boxNumber) {
  const before = sheet.dy.over;
  sheet.dy.over = toggleBox(before, boxNumber);
  const trauma = sheet.cm.trauma + (sheet.dy.over - before);
  sheet.cm.trauma = Math.min(MONITOR_BOXES * 2, Math.max(MONITOR_BOXES, trauma));
}

/* ── computed values ──────────────────────────────────────── */

export const raceOf = (sheet) => own(RACES, sheet.id.race) || RACES.human;
export const racial = (sheet, k) => raceOf(sheet).mods[k] || 0;
export const professionOf = (sheet) => own(PROFS, String(sheet.id.prof || "").trim()) || null;
export const profBonus = (sheet, k) => (professionOf(sheet)?.a === k ? 1 : 0);
export const modOf = (sheet, k) => racial(sheet, k) + profBonus(sheet, k);
export const total = (sheet, k) => int(sheet.base[k]) + modOf(sheet, k) + int(sheet.oth[k]);
// Master Skill adds 2 to the point-bought level.
export const ratingOf = (sheet, name) => int(sheet.skills[name]) + (sheet.id.master === name ? 2 : 0);
// Shock, Trauma and Rot all overflow by Essence / 3.
export const overflowPool = (sheet) => Math.max(1, fdiv(total(sheet, "ess"), 3));

export function penalties(sheet) {
  const ste = Math.max(1, total(sheet, "ste"));
  const end = Math.max(1, total(sheet, "end"));
  const rotThreshold = Math.max(1, fdiv(total(sheet, "ess"), 3));
  const s = fdiv(sheet.cm.shock, ste);
  const t = fdiv(sheet.cm.trauma, end);
  const r = fdiv(sheet.cm.rot, rotThreshold);
  const o = sheet.mods.reduce((sum, m) => sum + int(m.v), 0);
  const days = sheet.starve;
  // 3 days -1, 6 days -3, 9 days -5, 12 days death
  const v = days >= 9 ? 5 : days >= 6 ? 3 : days >= 3 ? 1 : 0;
  const e = encPenalty(sheet).p;
  return { s, t, r, o, v, e, dead: days >= 12, total: s + t + r + o + v + e, thr: { shock: ste, trauma: end, rot: rotThreshold } };
}

// Lethality 1 to 6 steps 15 lb, 7 to 10 steps 20 lb.
export function encTiers(sheet) {
  const lethality = Math.max(1, total(sheet, "let"));
  const step = lethality <= 6 ? 15 : 20;
  const light = lethality * step;
  return { light, moderate: light + step, serious: light + step * 2, immobile: light + step * 3, lift: lethality * 50 };
}

export const contentWeight = (container) => container.items.reduce((sum, item) => sum + num(item.q || 0) * num(item.w || 0), 0);

// A carried row counts once unless a quantity says otherwise.
export const carriedQuantity = (sheet, key) => {
  const q = num((sheet.wornX[key] || {}).q);
  return q > 0 ? q : 1;
};

export function weights(sheet) {
  const carried = ["armor", "shield", "w0", "w1", "w2", "w3"];
  let worn = carried.reduce((sum, key) => sum + num(sheet.wornW[key]) * carriedQuantity(sheet, key), 0);
  worn += sheet.wornExtra.reduce((sum, item) => sum + num(item.q || 0) * num(item.w || 0), 0);
  const packs = sheet.containers.reduce((sum, c) => sum + num(c.empty) + contentWeight(c), 0);
  const sp = sheet.sup;
  const supplies = num(sp.rations) * 1 + num(sp.medQ) * num(sp.medW) + num(sp.cmpQ) * num(sp.cmpW) + num(sp.ammoQ) * num(sp.ammoW);
  return { worn: r1(worn), packs: r1(packs), supplies: r1(supplies), total: r1(worn + packs + supplies) };
}

// One scale end to end, so the bar never jumps: fraction of the "cannot move" line.
export function encPenalty(sheet) {
  const tiers = encTiers(sheet);
  const load = weights(sheet).total;
  const frac = load / tiers.immobile;
  if (load <= tiers.light) return { p: 0, tier: "Unburdened", cls: "t0", frac };
  if (load <= tiers.moderate) return { p: 1, tier: "Light", cls: "t1", frac };
  if (load <= tiers.serious) return { p: 2, tier: "Moderate", cls: "t2", frac };
  if (load <= tiers.immobile) return { p: 3, tier: "Serious", cls: "t3", frac };
  return { p: 4, tier: "Cannot move", cls: "t3", frac: 1, stuck: true };
}

export function derivedStats(sheet) {
  const t = (k) => total(sheet, k);
  return {
    ap: fdiv(ATTRS.reduce((sum, a) => sum + t(a.k), 0), 3),
    initiative: t("ins"),
    passivePerception: fdiv(t("cla") + t("san") + t("psy"), 3),
    dodgePool: fdiv(t("ins") + t("cla"), 3),
    personalSoak: fdiv(t("end") + t("ins") + t("ste"), 8),
    overflow: overflowPool(sheet),
    magicPoints: t("vei") * 3,
    psionicPoints: t("psy") * 3,
  };
}

// Pool for a skill roll: linked attribute (Dodge uses the Dodge Pool) plus rating and Other, less the penalty.
export function skillPool(sheet, name, penalty) {
  const attr = own(SKILL_ATTR, name);
  const base = name === "Dodge" ? derivedStats(sheet).dodgePool : total(sheet, attr);
  const level = int(sheet.skills[name]);
  const rating = ratingOf(sheet, name);
  const extra = int(sheet.sother[name]);
  const applied = sheet.applyPen ? penalty : 0;
  const raw = base + rating + extra - applied;
  return { base, level, rating, extra, penalty: applied, raw, shown: Math.max(0, raw) };
}

// Casting skills use Veil or Psyche as their attribute.
export function castingPool(sheet, name, penalty) {
  const attr = name === "Psionics" ? "psy" : "vei";
  const rating = ratingOf(sheet, name);
  const applied = sheet.applyPen ? penalty : 0;
  return { attr, shown: Math.max(0, total(sheet, attr) + rating + int(sheet.sother[name]) - applied) };
}

// null when the weapon has no skill chosen.
export function weaponPool(sheet, weapon, penalty) {
  const attr = own(SKILL_ATTR, weapon.skill);
  if (!attr) return null;
  const applied = sheet.applyPen ? penalty : 0;
  return Math.max(0, total(sheet, attr) + ratingOf(sheet, weapon.skill) + int(sheet.sother[weapon.skill]) - applied);
}

export function soak(sheet) {
  const sources = (field) => sheet.soakMods.reduce((sum, m) => sum + int(m[field]), 0);
  const personal = derivedStats(sheet).personalSoak + sources("p");
  const shield = sheet.useShieldSoak === true;
  return {
    ballistic: int(sheet.armor.b) + personal + sources("b") + (shield ? int(sheet.shield.b) : 0),
    impact: int(sheet.armor.i) + personal + sources("i") + (shield ? int(sheet.shield.i) : 0),
  };
}

// Armor degrades by 1 to B and I each time the damage it soaked reaches its pool.
export function armorDegradation(sheet) {
  const pool = int(sheet.armor.dp) || (int(sheet.armor.b) + int(sheet.armor.i)) * 2;
  return { pool, steps: pool ? fdiv(int(sheet.armor.soaked), pool) : 0 };
}
export const shieldDegradation = (sheet) => ({ pool: SHIELD_DEGRADE_STEP, steps: fdiv(int(sheet.shield.soaked), SHIELD_DEGRADE_STEP) });

// null until the ritual has a level and a time.
export function ritualCost(ritual) {
  const level = int(ritual.l);
  const tier = RITUAL_TIERS.find((rt) => rt.t === ritual.tt);
  if (!level || !tier) return null;
  return {
    duration: tier.unit ? `${level} ${tier.unit}${level > 1 ? "s" : ""}` : "Permanent",
    tv: tier.tvBase + level * 25,
    exertion: Math.max(1, level - tier.idx),
    scar: tier.unit === null,
  };
}

export function dyingState(sheet, penalty) {
  const live = sheet.cm.trauma >= MONITOR_BOXES;
  const overflowMax = overflowPool(sheet);
  const need = penalty.t; // the current Trauma die penalty
  const have = Math.min(need, sheet.dy.succ);
  const stable = sheet.dy.aided || (need > 0 && have >= need);
  // Shown even when dormant, so the panel keeps its shape: what the goal would be at 10 Trauma.
  const previewNeed = Math.max(1, fdiv(MONITOR_BOXES, Math.max(1, total(sheet, "end"))));
  return {
    live,
    stable,
    need: live ? need : previewNeed,
    have: live ? have : 0,
    overflowMax,
    rawPool: Math.max(1, total(sheet, "end") + total(sheet, "ste") - 3),
    // Difficulty of the daily roll once stable, by how much Trauma there is.
    dailyDifficulty: sheet.cm.trauma <= 12 ? "Moderate" : sheet.cm.trauma <= 15 ? "Challenging" : "Difficult",
  };
}

export const criticalMonitor = (sheet) => CRITICAL_MONITORS.find((c) => sheet.cm[c.track] >= MONITOR_BOXES) || null;
export const clampTrack = (value) => Math.min(TRACK_MAX, Math.max(0, value));
