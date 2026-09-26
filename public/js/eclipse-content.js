// The content of Age of Eclipse: the book's names, tables and numbers, typed in
// once. No logic, no DOM and no Supabase. eclipse-rules.js computes with these
// values, and the sheet's pages and the Reference cards show them, so a change to
// the book is a change here (docs/adr/0013).
//
// Each table is marked:
//   Stored: a saved sheet keeps its names or keys. Rename one only with a
//     migration step, and retire a row instead of deleting it.
//   Not stored: no saved sheet points at it, so it can change freely.

/* ── a new character ──────────────────────────────────────── */

// Not stored: written into a new sheet, so a change here changes only new
// characters. A new character's Sanity is its race's.
export const START = { race: "human", attribute: 1, essence: 10, veil: 0, psyche: 0, morality: 5 };

// Stored: `k` is the field name in sheet.base and sheet.oth.
export const ATTRS = [
  { k: "end", a: "E", n: "Endurance" },
  { k: "cla", a: "C", n: "Clarity" },
  { k: "let", a: "L", n: "Lethality" },
  { k: "ins", a: "I", n: "Instinct" },
  { k: "pre", a: "P", n: "Presence" },
  { k: "ste", a: "S", n: "Steadfast" },
];
// Stored: as ATTRS.
export const SPECIALS = [
  { k: "ess", a: "E", n: "Essence" },
  { k: "san", a: "S", n: "Sanity" },
  { k: "vei", a: "V", n: "Veil" },
  { k: "psy", a: "P", n: "Psyche" },
];

// Stored: sheet.id.race holds the key. `san` is the race's starting Sanity.
export const RACES = {
  human: { name: "Human", mods: {}, san: 8, abil: "no racial modifiers" },
  voidtouched: { name: "Voidtouched", mods: { let: -1, ins: 1, cla: -1, ste: 1 }, san: 6, abil: "Shadow Blend +2 stealth in dark" },
  starborne: { name: "Starborne", mods: { let: -1, end: 1, cla: 1, ste: -1 }, san: 6, abil: "Cosmic Awareness +2 rift nav" },
  hallowed: { name: "Hallowed", mods: { ins: 1, end: 1, cla: -1, pre: -1 }, san: 6, abil: "Celestial Grace +2 acrobatics/dodge" },
  fleshwarped: { name: "Fleshwarped", mods: { let: -1, ins: 1, cla: 1, pre: -1 }, san: 6, abil: "Adaptive Physiology +2 resilience" },
  infernal: { name: "Infernal", mods: { let: 1, ins: -1, ste: 1, pre: -1 }, san: 6, abil: "Infernal Strength +2 might/intimidate" },
  wirehead: { name: "Wirehead", mods: { let: 1, ins: -1, cla: 1, pre: -1 }, san: 6, abil: "Data Analysis +2 investigation/tech" },
};

// Stored: sheet.id.prof holds the name. Each adds PROFESSION_BONUS to attribute `a`
// and makes `m` the Master Skill.
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
// Not stored.
export const PROFESSION_BONUS = 1;
export const MASTER_BONUS = 2;

// Stored: sheet.skills, sheet.sother and sheet.id.master use the skill names.
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
// Not stored. An untrained skill rolls this many difficulty stages harder.
export const UNTRAINED_STAGES = 2;

// Stored: an advantage's or a flaw's `t`.
export const ADV_TIERS = ["Tier 1 (5 pts)", "Tier 2 (5 pts)", "Tier 3 (8 pts)"];
export const FLAW_TIERS = ["Light (+3 pts)", "Medium (+4 pts)", "Heavy (+5 pts)"];

/* ── derived stats ────────────────────────────────────────── */

// Not stored. What each derived stat divides its attributes by.
export const DERIVED_DIVISOR = { actionPoints: 3, passivePerception: 3, dodgePool: 3, personalSoak: 8, overflow: 3 };

/* ── checks ───────────────────────────────────────────────── */

// Not stored. The dice each difficulty stage removes.
export const DIFFICULTY = {
  easy: { name: "Easy", dice: 0, note: "routine, ideal conditions" },
  moderate: { name: "Moderate", dice: 1, note: "minor obstacles" },
  challenging: { name: "Challenging", dice: 3, note: "real skill needed" },
  difficult: { name: "Difficult", dice: 5, note: "hostile conditions" },
  formidable: { name: "Formidable", dice: 7, note: "masters and luck" },
  nearImpossible: { name: "Near impossible", dice: 9, note: "miracles" },
};

/* ── combat ───────────────────────────────────────────────── */

// Not stored. What an action costs in AP.
export const ACTIONS = {
  move: { name: "Move about 10 ft", ap: 1 },
  aim: { name: "Aim", ap: 1 },
  draw: { name: "Draw a weapon", ap: 1 },
  useItem: { name: "Use item in hand", ap: 1 },
  eject: { name: "Eject a magazine", ap: 0 },
  reload: { name: "Load a fresh magazine", ap: 2 },
  retrieve: { name: "Retrieve from a bag", ap: 3 },
  defend: { name: "Block or Dodge", ap: 1 },
  stabilizeAlly: { name: "Stabilize an ally", ap: 5 },
};
// Not stored. The first row is the fresh magazine of ACTIONS.reload.
export const RELOADS = [
  { name: "Box mag", rounds: 30, ap: ACTIONS.reload.ap },
  { name: "Drum", rounds: 60, ap: 3 },
  { name: "Belt", rounds: 100, ap: 4 },
];
// Not stored. What each AP spent aiming gives.
export const AIM = { dice: 1, armorIgnored: 1 };
// Not stored. Burst Fire, on top of the weapon's AP.
export const BURST = { ap: 1, rounds: 3, damage: 2 };
// Not stored. An attack nobody defends against rolls against this.
export const UNOPPOSED_DIFFICULTY = 3;

// Stored: a weapon's `skill`. The skills you can attack with.
export const COMBAT_SKILLS = [
  "Archery", "Bludgeoning", "Edged Weapons", "Firearms", "Grapple", "Gunnery",
  "Heavy Weapons", "Polearms", "Thrown Weapons", "Unarmed Combat",
];
// Stored: a weapon's `mode`.
export const WEAPON_MODES = ["SA", "SA / BF", "SA / BF / FA", "Melee", "Thrown", "none"];

/* ── damage and conditions ────────────────────────────────── */

// Stored: cm.shock, cm.trauma and cm.rot each fill up to this many boxes.
export const MONITOR_BOXES = 10;

// Stored: `track` is the field name in sheet.cm and sheet.notes. Each full `per`
// boxes of a monitor costs a die: `per` is that attribute, divided by `divide` when given.
export const MONITORS = [
  { track: "shock", name: "Shock", per: "ste", soak: "armor only" },
  { track: "trauma", name: "Trauma", per: "end", soak: "armor + personnel" },
  { track: "rot", name: "Rot", per: "ess", divide: 3, soak: "none" },
];
// Not stored.
export const FULL_ROT_ESSENCE_PER_HOUR = 1;

// Not stored. A monitor at capacity takes over the dial. Trauma outranks Rot outranks Shock.
export const CRITICAL_MONITORS = [
  { track: "trauma", badge: "Dying", line: "Trauma is full. You are unconscious and dying. Someone has to stabilize you." },
  { track: "rot", badge: "Corrupted", line: `Rot is full. You are losing ${FULL_ROT_ESSENCE_PER_HOUR} Essence every hour until there is none left.` },
  { track: "shock", badge: "Unconscious", line: "Shock is full. You are unconscious, and the overflow is turning into Trauma." },
];

// Not stored. Stabilizing yourself rolls at the fixed stage `selfRoll`. Once stable,
// the daily roll's stage is the first row its Trauma fits, so keep the rows in rising order.
export const DYING = {
  selfRoll: "challenging",
  allySupplies: 1,
  daily: [
    { upToTrauma: 12, stage: "moderate" },
    { upToTrauma: 15, stage: "challenging" },
    { upToTrauma: Infinity, stage: "difficult" },
  ],
};

// Stored: sanity and morality are ratings from 1 to this.
export const TRACK_MAX = 10;
// Not stored. One word per level, from 1 up.
export const SANITY = [
  { t: "gone" }, { t: "shattered" }, { t: "unravelling" }, { t: "slipping" }, { t: "fraying" },
  { t: "strained" }, { t: "holding" }, { t: "steady" }, { t: "clear" }, { t: "lucid" },
];
// Not stored. One word and one line per level, from 1 up.
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

/* ── recovery ─────────────────────────────────────────────── */

// Not stored.
export const RECOVERY = { naturalHours: 24, naturalStage: "easy", medicalMinutes: 30, medicalSupplies: 1 };
export const FULL_REST_HOURS = 8;
// Not stored. Medical treatment's difficulty stage, from the patient's Trauma, in rising order.
export const MEDICAL_DIFFICULTY = [
  { fromTrauma: 1, stage: "easy" },
  { fromTrauma: 4, stage: "moderate" },
  { fromTrauma: 7, stage: "challenging" },
  { fromTrauma: 10, stage: "difficult" },
];

/* ── survival ─────────────────────────────────────────────── */

// Not stored. Dice lost from a number of days without rations (steps in rising
// order), and the day that kills.
export const STARVATION = {
  penalties: [
    { days: 3, dice: 1 },
    { days: 6, dice: 3 },
    { days: 9, dice: 5 },
  ],
  deathDay: 12,
};
// Not stored.
export const RATION_LB = 1;

// Not stored. Each load threshold is one step of `lb` per point of Lethality, or
// `lbAbove` once Lethality is over `upToLethality`. Five tiers, for the four
// thresholds: a tier holds the loads up to its threshold, the last everything beyond.
export const ENCUMBRANCE = {
  step: { lb: 15, upToLethality: 6, lbAbove: 20 },
  liftPerLethality: 50,
  tiers: [
    { name: "Unburdened", dice: 0 },
    { name: "Light", dice: 1 },
    { name: "Moderate", dice: 2 },
    { name: "Serious", dice: 3 },
    { name: "Cannot move", dice: 4 },
  ],
};

/* ── casting ──────────────────────────────────────────────── */

// Not stored.
export const CASTING = { pointsPerRating: 3, psycheApCap: 5, pointsPerSchool: 2, veilHealRotDivisor: 2, psycheHealShockDivisor: 2 };

// Stored: vSchools, pSchools, and a spell's, power's or ritual's `s`.
export const VEIL_SCHOOLS = [
  "Combat Magic (Fire)", "Healing Magic (Water)", "Detection Magic (Air)",
  "Enchantment Magic (Light)", "Protection Magic (Earth)", "Illusion Magic (Aether)",
];
export const PSY_SCHOOLS = [
  "Telekinesis", "Telepathy", "Precognition", "Psychic Healing", "Psychic Shielding",
  "Psychic Influence", "Psychic Empathy", "Psychic Projection", "Psychic Manipulation", "Astral Projection",
];
// Stored: a spell's or power's `t`.
export const CAST_TYPES = ["Attack", "Healing", "Utility", "Enhancement", "Protection", "Ritual", "Counter"];
// Not stored. One word per Effect Level, from 1 up.
export const EFFECT_SCALE = [
  "Trivial", "Weak", "Standard", "Strong", "Potent", "Dangerous",
  "Devastating", "Catastrophic", "Apocalyptic", "Reality-breaking",
];

// Stored: a ritual's `tt` holds `t`. Rituals are Veil only. Time invested sets how
// long the effect lasts (`unit` per level), what the materials cost (`tvBase`
// plus RITUAL.tvPerLevel per level) and how much of the Exertion Shock it takes
// off (`exertionOff`). `unit: null` marks the Permanent tier, which carries the
// Rift Scar.
export const RITUAL_TIERS = [
  { t: "10 min", unit: "hour", tvBase: 5, exertionOff: 0 },
  { t: "30 min", unit: "day", tvBase: 10, exertionOff: 1 },
  { t: "1 hour", unit: "week", tvBase: 20, exertionOff: 2 },
  { t: "4 hours", unit: "month", tvBase: 50, exertionOff: 3 },
  { t: "8 hours", unit: "year", tvBase: 100, exertionOff: 4 },
  { t: "24 hours", unit: null, tvBase: 200, exertionOff: 5 },
];
// Not stored.
export const RITUAL = { tvPerLevel: 25, riftScarShock: 3 };

/* ── gear ─────────────────────────────────────────────────── */

// Not stored.
export const SHIELD_DEGRADE_STEP = 10;

// Not stored. The dice a kit adds, and what it weighs.
export const KITS = [
  { name: "None", dice: -3 },
  { name: "Partial", lb: 5, dice: 1 },
  { name: "Full", lb: 10, dice: 3 },
  { name: "Advanced", lb: 15, dice: 5 },
  { name: "Facility", dice: 7 },
];

// Not stored. Quality bands, best first, and the share of the TV a trader pays.
export const QUALITY = [
  { q: "Q10", word: "pristine", sellPercent: 45 },
  { q: "Q7 to 9", word: "excellent", sellPercent: 30 },
  { q: "Q4 to 6", word: "functional, the default", sellPercent: 20 },
  { q: "Q2 to 3", word: "poor", sellPercent: 15 },
  { q: "Q1", word: "held together with prayers", sellPercent: 10 },
];
