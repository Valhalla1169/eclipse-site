// The rules of Age of Eclipse as functions, and the shape of a character sheet,
// with no DOM and no Supabase, so the player sheet, the Keeper roster and the
// unit tests share it. The book's names, tables and numbers are in
// eclipse-content.js.
//
// A sheet stores INPUTS only. Totals, penalties, pools and tiers are computed
// here every time they are shown, so a rules change never needs a data change
// (docs/adr/0004). A change that renames, removes or retypes a stored field is
// a new SCHEMA_VERSION with a step in MIGRATIONS (docs/adr/0013).
import {
  ATTRS,
  CASTING,
  CRITICAL_MONITORS,
  DERIVED_DIVISOR,
  DIFFICULTY,
  DYING,
  ENCUMBRANCE,
  MASTER_BONUS,
  MONITORS,
  MONITOR_BOXES,
  MORALITY,
  PROFESSION_BONUS,
  PROFS,
  RACES,
  RATION_LB,
  RITUAL,
  RITUAL_TIERS,
  SANITY,
  SHIELD_DEGRADE_STEP,
  SKILLS,
  SPECIALS,
  STARVATION,
  START,
  TRACK_MAX,
} from "./eclipse-content.js";

export const SCHEMA_VERSION = 1;

export const ATTR_NAMES = Object.fromEntries([...ATTRS, ...SPECIALS].map((attr) => [attr.k, attr.n]));
export const NO_RACIAL_ABILITY = RACES.human.abil;
export const ALL_SKILLS = SKILLS.flatMap(([, , list]) => list).sort((a, b) => a.localeCompare(b));
export const SKILL_ATTR = Object.fromEntries(SKILLS.flatMap(([, ak, list]) => list.map((s) => [s, ak])));

export const veilAP = (level) => level;
export const psyAP = (level) => Math.min(CASTING.psycheApCap, Math.floor(level / 2) + 1);
export const schoolSlots = (rating) => Math.floor(rating / CASTING.pointsPerSchool);

// Names in stored data pick rows from the content tables, so "constructor" must not match.
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

const startingAttributes = () => Object.fromEntries(ATTRS.map((attr) => [attr.k, START.attribute]));

export const blank = () => ({
  id: { name: "", race: START.race, prof: "", bg: "", grit: "", master: "" },
  base: { ...startingAttributes(), ess: START.essence, san: RACES[START.race].san, vei: START.veil, psy: START.psyche },
  oth: { end: 0, cla: 0, let: 0, ins: 0, pre: 0, ste: 0, ess: 0, san: 0, vei: 0, psy: 0 },
  skills: {},
  sother: {},
  cm: { shock: 0, trauma: 0, rot: 0 },
  mods: [{ n: "", v: "" }, { n: "", v: "" }, { n: "", v: "" }],
  applyPen: true,
  useShieldSoak: false,
  sanity: RACES[START.race].san,
  soakMods: [{ n: "", b: "", i: "", p: "" }],
  starve: 0,
  morality: START.morality,
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
// version n data and returns version n + 1 data. Every version below SCHEMA_VERSION
// needs one (tests/unit/eclipse-rules.test.js checks none is missing); a rules change
// that only adds a field or a table row needs no step at all (docs/adr/0013).
//
// Changelog — one line per bump, so the whole history is in this one file:
//   (none yet: every sheet has been version 1)
export const MIGRATIONS = {};

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

// Clicking a condition box. A Trauma below the full monitor means no longer dying, so the tracker clears.
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
export const profBonus = (sheet, k) => (professionOf(sheet)?.a === k ? PROFESSION_BONUS : 0);
export const modOf = (sheet, k) => racial(sheet, k) + profBonus(sheet, k);
export const total = (sheet, k) => int(sheet.base[k]) + modOf(sheet, k) + int(sheet.oth[k]);
export const ratingOf = (sheet, name) => int(sheet.skills[name]) + (sheet.id.master === name ? MASTER_BONUS : 0);
export const overflowPool = (sheet) => Math.max(1, fdiv(total(sheet, "ess"), DERIVED_DIVISOR.overflow));

// The dice lost to days without rations. The steps are in rising order.
export const starvationPenalty = (days) => STARVATION.penalties.reduce((dice, step) => (days >= step.days ? step.dice : dice), 0);

export function penalties(sheet) {
  const thr = Object.fromEntries(MONITORS.map((m) => [m.track, Math.max(1, fdiv(total(sheet, m.per), m.divide || 1))]));
  const lost = (track) => fdiv(sheet.cm[track], thr[track]);
  const s = lost("shock");
  const t = lost("trauma");
  const r = lost("rot");
  const o = sheet.mods.reduce((sum, m) => sum + int(m.v), 0);
  const v = starvationPenalty(sheet.starve);
  const e = encPenalty(sheet).p;
  return { s, t, r, o, v, e, dead: sheet.starve >= STARVATION.deathDay, total: s + t + r + o + v + e, thr };
}

export function encTiers(sheet) {
  const lethality = Math.max(1, total(sheet, "let"));
  const { step, liftPerLethality } = ENCUMBRANCE;
  const size = lethality <= step.upToLethality ? step.lb : step.lbAbove;
  const light = lethality * size;
  return { light, moderate: light + size, serious: light + size * 2, immobile: light + size * 3, lift: lethality * liftPerLethality };
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
  const supplies = num(sp.rations) * RATION_LB + num(sp.medQ) * num(sp.medW) + num(sp.cmpQ) * num(sp.cmpW) + num(sp.ammoQ) * num(sp.ammoW);
  return { worn: r1(worn), packs: r1(packs), supplies: r1(supplies), total: r1(worn + packs + supplies) };
}

// The sheet styles four tiers, t0 to t3; "Cannot move" shares t3.
const loadTier = (index) => ({ p: ENCUMBRANCE.tiers[index].dice, tier: ENCUMBRANCE.tiers[index].name, cls: `t${Math.min(index, 3)}` });

// One scale end to end, so the bar never jumps: fraction of the "cannot move" line.
export function encPenalty(sheet) {
  const tiers = encTiers(sheet);
  const load = weights(sheet).total;
  const limits = [tiers.light, tiers.moderate, tiers.serious, tiers.immobile];
  const index = limits.findIndex((limit) => load <= limit);
  if (index === -1) return { ...loadTier(limits.length), frac: 1, stuck: true };
  return { ...loadTier(index), frac: load / tiers.immobile };
}

export function derivedStats(sheet) {
  const t = (k) => total(sheet, k);
  return {
    ap: fdiv(ATTRS.reduce((sum, a) => sum + t(a.k), 0), DERIVED_DIVISOR.actionPoints),
    initiative: t("ins"),
    passivePerception: fdiv(t("cla") + t("san") + t("psy"), DERIVED_DIVISOR.passivePerception),
    dodgePool: fdiv(t("ins") + t("cla"), DERIVED_DIVISOR.dodgePool),
    personalSoak: fdiv(t("end") + t("ins") + t("ste"), DERIVED_DIVISOR.personalSoak),
    overflow: overflowPool(sheet),
    magicPoints: t("vei") * CASTING.pointsPerRating,
    psionicPoints: t("psy") * CASTING.pointsPerRating,
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
    tv: tier.tvBase + level * RITUAL.tvPerLevel,
    exertion: Math.max(1, level - tier.exertionOff),
    scar: tier.unit === null,
  };
}

export function dyingState(sheet, penalty) {
  const live = sheet.cm.trauma >= MONITOR_BOXES;
  const overflowMax = overflowPool(sheet);
  const need = penalty.t; // the current Trauma die penalty
  const have = Math.min(need, sheet.dy.succ);
  const stable = sheet.dy.aided || (need > 0 && have >= need);
  // Shown even when dormant, so the panel keeps its shape: what the goal would be at a full monitor.
  const previewNeed = Math.max(1, fdiv(MONITOR_BOXES, Math.max(1, total(sheet, "end"))));
  const daily = DYING.daily.find((row) => sheet.cm.trauma <= row.upToTrauma);
  return {
    live,
    stable,
    need: live ? need : previewNeed,
    have: live ? have : 0,
    overflowMax,
    rawPool: Math.max(1, total(sheet, "end") + total(sheet, "ste") - DIFFICULTY[DYING.selfRoll].dice),
    // Difficulty of the daily roll once stable.
    dailyDifficulty: DIFFICULTY[daily.stage].name,
  };
}

export const criticalMonitor = (sheet) => CRITICAL_MONITORS.find((c) => sheet.cm[c.track] >= MONITOR_BOXES) || null;
export const clampTrack = (value) => Math.min(TRACK_MAX, Math.max(0, value));

// What the Keeper's roster shows about a sheet: the numbers a Keeper reaches for during play.
export function summarizeSheet(sheet) {
  const P = penalties(sheet);
  const derived = derivedStats(sheet);
  const load = encPenalty(sheet);
  const totals = soak(sheet);
  const crit = criticalMonitor(sheet);
  const sanity = clampTrack(sheet.sanity);
  const morality = clampTrack(sheet.morality);
  return {
    race: raceOf(sheet).name,
    profession: String(sheet.id.prof || "").trim(),
    penalty: P.total,
    starved: P.dead,
    critical: crit ? crit.badge : null,
    monitors: {
      shock: { boxes: sheet.cm.shock, penalty: P.s },
      trauma: { boxes: sheet.cm.trauma, penalty: P.t },
      rot: { boxes: sheet.cm.rot, penalty: P.r },
    },
    actionPoints: derived.ap,
    soak: totals,
    load: { pounds: weights(sheet).total, tier: load.tier, penalty: load.p },
    sanity: { value: sanity, label: sanity === 0 ? "lost" : SANITY[sanity - 1].t },
    morality: { value: morality, label: morality === 0 ? "unrecorded" : MORALITY[morality - 1].t },
    starveDays: sheet.starve,
  };
}
