import { describe, expect, it } from "vitest";
import {
  MONITOR_BOXES,
  PROFS,
  RACES,
  SCHEMA_VERSION,
  SKILLS,
  SheetFormatError,
  armorDegradation,
  blank,
  castingPool,
  chooseProfession,
  chooseRace,
  criticalMonitor,
  derivedStats,
  dyingState,
  encPenalty,
  encTiers,
  intOrBlank,
  migrate,
  normalize,
  openSheet,
  overflowPool,
  penalties,
  ritualCost,
  setCondition,
  setOverflow,
  shieldDegradation,
  skillPool,
  soak,
  toggleBox,
  total,
  weaponPool,
  weights,
} from "../../public/js/eclipse-rules.js";

const withBase = (values, sheet = blank()) => {
  Object.assign(sheet.base, values);
  return sheet;
};

describe("blank", () => {
  it("returns a new object each time, so sheets never share rows", () => {
    const a = blank();
    a.adv[0].n = "Lucky";
    expect(blank().adv[0]).toEqual({});
  });

  it("holds inputs only: no totals, penalties or tiers", () => {
    const keys = JSON.stringify(Object.keys(blank()));
    for (const derived of ["total", "penalty", "tier", "pool", "ap"]) expect(keys).not.toContain(`"${derived}"`);
  });

  it("has a skill list where every skill belongs to exactly one attribute", () => {
    const names = SKILLS.flatMap(([, , list]) => list);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("normalize", () => {
  it("gives a fresh default sheet for empty data", () => {
    expect(normalize({})).toEqual(blank());
  });

  it("keeps unknown top-level fields, so an older client never erases a newer one's data", () => {
    const sheet = normalize({ ...blank(), futureField: { deep: [1, 2, 3] } });
    expect(sheet.futureField).toEqual({ deep: [1, 2, 3] });
  });

  it("keeps unknown fields inside a group and inside a row", () => {
    const data = blank();
    data.id.pronouns = "they/them";
    data.adv[0] = { n: "Lucky", t: "Tier 1 (5 pts)", e: "", mysteryColumn: 7 };
    const sheet = normalize(data);
    expect(sheet.id.pronouns).toBe("they/them");
    expect(sheet.adv[0].mysteryColumn).toBe(7);
  });

  it("fills a field added later with its default", () => {
    const old = blank();
    delete old.cast;
    delete old.base.psy;
    old.id.name = "Marlo";
    const sheet = normalize(old);
    expect(sheet.cast).toEqual({ mpSpent: "", ppSpent: "", freeHeal: false });
    expect(sheet.base.psy).toBe(0);
    expect(sheet.id.name).toBe("Marlo");
  });

  it("does not change what it was given", () => {
    const data = blank();
    data.log[0].t = "Day one";
    const before = JSON.stringify(data);
    normalize(data).log[0].t = "changed";
    expect(JSON.stringify(data)).toBe(before);
  });

  it("gives an empty list back its blank row, so there is always a row to type in", () => {
    const data = blank();
    data.log = [];
    data.containers = [];
    const sheet = normalize(data);
    expect(sheet.log).toEqual([{ t: "", d: "", b: "" }]);
    expect(sheet.containers).toHaveLength(2);
  });

  it("adds the second container to a sheet saved before it existed", () => {
    const data = blank();
    data.containers = [data.containers[0]];
    expect(normalize(data).containers).toHaveLength(2);
  });

  it("gives a container without items a list", () => {
    const data = blank();
    delete data.containers[0].items;
    expect(normalize(data).containers[0].items).toHaveLength(3);
  });

  it("repairs a wrong-typed number, because the sheet cannot show it", () => {
    const sheet = normalize({ ...blank(), starve: "lots", morality: null, sanity: undefined });
    expect([sheet.starve, sheet.morality, sheet.sanity]).toEqual([0, 5, 8]);
  });

  it("refuses data that cannot be a sheet, so the caller never overwrites it", () => {
    for (const bad of [null, undefined, "text", 5, [], [{}]]) expect(() => normalize(bad)).toThrow(SheetFormatError);
    expect(() => normalize({ base: "nope" })).toThrow(SheetFormatError);
    expect(() => normalize({ adv: {} })).toThrow(SheetFormatError);
    expect(() => normalize({ log: [null] })).toThrow(SheetFormatError);
    expect(() => normalize({ containers: [{ items: "x" }] })).toThrow(SheetFormatError);
  });

  it("survives a round trip through JSON unchanged", () => {
    const sheet = normalize({ id: { name: "Marlo", race: "wirehead", prof: "Engineer" }, extra: 1 });
    expect(normalize(JSON.parse(JSON.stringify(sheet)))).toEqual(sheet);
  });
});

describe("migrate and openSheet", () => {
  it("does nothing while the stored version is current", () => {
    expect(migrate({ a: 1 }, SCHEMA_VERSION)).toEqual({ a: 1 });
  });

  it("runs each step in order up to the target version", () => {
    const steps = { 1: (d) => ({ ...d, one: true }), 2: (d) => ({ ...d, two: true }) };
    expect(migrate({}, 1, { to: 3, steps })).toEqual({ one: true, two: true });
    expect(migrate({}, 2, { to: 3, steps })).toEqual({ two: true });
  });

  it("refuses when a step is missing instead of guessing", () => {
    expect(() => migrate({}, 1, { to: 2, steps: {} })).toThrow(SheetFormatError);
  });

  it("opens a current sheet for editing", () => {
    const opened = openSheet({ data: { id: { name: "Marlo" } }, schema_version: 1 });
    expect(opened).toMatchObject({ readOnly: false, migrated: false });
    expect(opened.sheet.id.name).toBe("Marlo");
  });

  it("migrates an older sheet and says so", () => {
    const steps = { 1: (d) => ({ ...d, id: { ...d.id, name: d.id.name.toUpperCase() } }) };
    const opened = openSheet({ data: { id: { name: "Marlo" } }, schema_version: 1 }, { current: 2, steps });
    expect(opened).toMatchObject({ readOnly: false, migrated: true, schemaVersion: 2 });
    expect(opened.sheet.id.name).toBe("MARLO");
  });

  it("opens a sheet from a newer version read-only, and keeps its unknown fields", () => {
    const opened = openSheet({ data: { id: { name: "Marlo" }, fromTheFuture: 1 }, schema_version: 5 });
    expect(opened.readOnly).toBe(true);
    expect(opened.sheet.fromTheFuture).toBe(1);
  });

  it("treats a missing version as 1", () => {
    expect(openSheet({ data: {} }).readOnly).toBe(false);
  });
});

describe("attributes", () => {
  it("adds race, profession and Other to the base", () => {
    const sheet = withBase({ let: 3, cla: 4 });
    sheet.id.race = "voidtouched"; // -1 Lethality, -1 Clarity
    sheet.id.prof = "Engineer"; // +1 Clarity
    sheet.oth.let = 2;
    expect(total(sheet, "let")).toBe(4);
    expect(total(sheet, "cla")).toBe(4);
  });

  it("reads numbers typed as text and ignores junk", () => {
    const sheet = blank();
    sheet.base.end = "3";
    sheet.oth.end = "x";
    expect(total(sheet, "end")).toBe(3);
  });

  it("ignores a profession that is not in the book, and names that only exist on Object", () => {
    const sheet = blank();
    sheet.id.prof = "constructor";
    sheet.id.race = "constructor";
    expect(total(sheet, "cla")).toBe(1);
    expect(derivedStats(sheet).ap).toBe(2);
  });

  it("gives every profession a real attribute and a Master Skill that is a skill on the sheet", () => {
    const skills = new Set(SKILLS.flatMap(([, , list]) => list));
    expect(Object.entries(PROFS).filter(([, p]) => !skills.has(p.m))).toEqual([]);
    for (const p of Object.values(PROFS)) expect(SKILLS.some(([, k]) => k === p.a)).toBe(true);
  });

  it("derives action points, initiative, soak and pools", () => {
    const sheet = withBase({ end: 4, cla: 3, let: 2, ins: 5, pre: 2, ste: 3, ess: 10, san: 8, vei: 2, psy: 1 });
    expect(derivedStats(sheet)).toEqual({
      ap: 6, // 19 / 3
      initiative: 5,
      passivePerception: 4, // (3 + 8 + 1) / 3
      dodgePool: 2, // (5 + 3) / 3
      personalSoak: 1, // 12 / 8
      overflow: 3,
      magicPoints: 6,
      psionicPoints: 3,
    });
  });
});

describe("penalties", () => {
  it("is zero on a fresh sheet", () => {
    expect(penalties(blank())).toMatchObject({ s: 0, t: 0, r: 0, o: 0, v: 0, e: 0, total: 0, dead: false });
  });

  it("takes one die per full threshold of each monitor, and they stack", () => {
    const sheet = withBase({ ste: 2, end: 3, ess: 9 });
    Object.assign(sheet.cm, { shock: 5, trauma: 7, rot: 7 }); // 5/2, 7/3, 7/3
    expect(penalties(sheet)).toMatchObject({ s: 2, t: 2, r: 2, total: 6, thr: { shock: 2, trauma: 3, rot: 3 } });
  });

  it("never divides by less than 1", () => {
    const sheet = withBase({ ste: 0, end: 0, ess: 0 });
    Object.assign(sheet.cm, { shock: 4, trauma: 4, rot: 4 });
    expect(penalties(sheet)).toMatchObject({ s: 4, t: 4, r: 4, thr: { shock: 1, trauma: 1, rot: 1 } });
  });

  it("adds up the other modifiers, and a negative one is a bonus", () => {
    const sheet = blank();
    sheet.mods = [{ v: 2 }, { v: -1 }, { v: "" }];
    expect(penalties(sheet).o).toBe(1);
  });

  it.each([
    [0, 0, false], [2, 0, false], [3, 1, false], [5, 1, false], [6, 3, false], [8, 3, false], [9, 5, false], [11, 5, false], [12, 5, true],
  ])("starving %i days costs %i dice (dead: %s)", (days, cost, dead) => {
    const sheet = blank();
    sheet.starve = days;
    expect(penalties(sheet)).toMatchObject({ v: cost, dead });
  });

  it("counts encumbrance in the total", () => {
    const sheet = blank();
    sheet.sup.rations = 20; // 20 lb at Lethality 1: light load is 15
    expect(penalties(sheet)).toMatchObject({ e: 1, total: 1 });
  });
});

describe("encumbrance", () => {
  it("steps 15 lb up to Lethality 6 and 20 lb above", () => {
    expect(encTiers(withBase({ let: 1 }))).toEqual({ light: 15, moderate: 30, serious: 45, immobile: 60, lift: 50 });
    expect(encTiers(withBase({ let: 6 }))).toMatchObject({ light: 90, immobile: 90 + 45 });
    expect(encTiers(withBase({ let: 7 }))).toEqual({ light: 140, moderate: 160, serious: 180, immobile: 200, lift: 350 });
  });

  it("weighs worn, packed and supplies, and rounds to a tenth", () => {
    const sheet = blank();
    sheet.wornW.armor = "8.25";
    sheet.wornX.armor = { q: "2" };
    sheet.wornExtra[0] = { q: 2, w: 1.5 };
    sheet.containers[0].empty = 1;
    sheet.containers[0].items[0] = { q: 3, w: 2 };
    Object.assign(sheet.sup, { rations: 4, medQ: 2, medW: 0.5, cmpQ: 0, ammoQ: 100, ammoW: 0.05 });
    expect(weights(sheet)).toEqual({ worn: 19.5, packs: 7, supplies: 10, total: 36.5 });
  });

  it("counts a worn item once when no quantity is given", () => {
    const sheet = blank();
    sheet.wornW.w0 = 5;
    sheet.wornX.w0 = { q: "0" };
    expect(weights(sheet).worn).toBe(5);
  });

  it.each([
    [15, 0, "Unburdened"], [15.1, 1, "Light"], [30, 1, "Light"], [31, 2, "Moderate"], [45, 2, "Moderate"],
    [46, 3, "Serious"], [60, 3, "Serious"], [61, 4, "Cannot move"],
  ])("carrying %s lb at Lethality 1 is penalty %i (%s)", (load, penalty, tier) => {
    const sheet = blank();
    sheet.sup.rations = load;
    expect(encPenalty(sheet)).toMatchObject({ p: penalty, tier });
  });

  it("never lets the bar pass full", () => {
    const sheet = blank();
    sheet.sup.rations = 500;
    expect(encPenalty(sheet)).toMatchObject({ frac: 1, stuck: true });
  });
});

describe("skills", () => {
  it("adds attribute, level, master bonus and Other, then subtracts the penalty", () => {
    const sheet = withBase({ cla: 3 });
    sheet.skills.Crafting = 2;
    sheet.sother.Crafting = 1;
    sheet.id.master = "Crafting";
    expect(skillPool(sheet, "Crafting", 2)).toMatchObject({ base: 3, level: 2, rating: 4, extra: 1, penalty: 2, raw: 6, shown: 6 });
  });

  it("ignores the penalty when the sheet says not to apply it", () => {
    const sheet = blank();
    sheet.applyPen = false;
    expect(skillPool(sheet, "Athletics", 5).penalty).toBe(0);
  });

  it("shows a pool of zero when penalties would take it below", () => {
    expect(skillPool(blank(), "Athletics", 9)).toMatchObject({ raw: -8, shown: 0 });
  });

  it("rolls Dodge off the Dodge Pool, not Instinct", () => {
    const sheet = withBase({ ins: 6, cla: 3 });
    sheet.skills.Dodge = 1;
    expect(skillPool(sheet, "Dodge", 0).base).toBe(3);
  });

  it("uses Veil for magic skills and Psyche for Psionics", () => {
    const sheet = withBase({ vei: 4, psy: 2 });
    sheet.skills.Sorcery = 1;
    sheet.skills.Psionics = 3;
    expect(castingPool(sheet, "Sorcery", 1).shown).toBe(4);
    expect(castingPool(sheet, "Psionics", 0).shown).toBe(5);
  });

  it("computes a weapon pool from its skill, and none without one", () => {
    const sheet = withBase({ ins: 3 });
    sheet.skills.Firearms = 2;
    expect(weaponPool(sheet, { skill: "Firearms" }, 1)).toBe(4);
    expect(weaponPool(sheet, {}, 1)).toBeNull();
    expect(weaponPool(sheet, { skill: "constructor" }, 1)).toBeNull();
  });
});

describe("soak and degradation", () => {
  it("adds armor, personal soak and sources, and the shield only when raised", () => {
    const sheet = withBase({ end: 8, ins: 8, ste: 8 }); // personal soak 3
    Object.assign(sheet.armor, { b: 4, i: 2 });
    Object.assign(sheet.shield, { b: 1, i: 3 });
    sheet.soakMods = [{ b: 1, i: "", p: 2 }, { b: "", i: 1, p: "" }];
    expect(soak(sheet)).toEqual({ ballistic: 4 + 5 + 1, impact: 2 + 5 + 1 });
    sheet.useShieldSoak = true;
    expect(soak(sheet)).toEqual({ ballistic: 11, impact: 11 });
  });

  it("degrades armor each time soaked damage reaches its pool", () => {
    const sheet = blank();
    Object.assign(sheet.armor, { b: 3, i: 2, soaked: 25 });
    expect(armorDegradation(sheet)).toEqual({ pool: 10, steps: 2 });
    sheet.armor.dp = "20";
    expect(armorDegradation(sheet)).toEqual({ pool: 20, steps: 1 });
  });

  it("degrades a shield every 10 damage", () => {
    const sheet = blank();
    sheet.shield.soaked = 34;
    expect(shieldDegradation(sheet).steps).toBe(3);
  });
});

describe("rituals", () => {
  it("is null until the ritual has a level and a time", () => {
    expect(ritualCost({})).toBeNull();
    expect(ritualCost({ l: 3 })).toBeNull();
    expect(ritualCost({ tt: "1 hour" })).toBeNull();
  });

  it("scales duration and materials with the level, and shock with rushing", () => {
    expect(ritualCost({ l: 4, tt: "10 min" })).toEqual({ duration: "4 hours", tv: 105, exertion: 4, scar: false });
    expect(ritualCost({ l: 1, tt: "30 min" })).toEqual({ duration: "1 day", tv: 35, exertion: 1, scar: false });
    expect(ritualCost({ l: 3, tt: "1 hour" })).toMatchObject({ exertion: 1 });
  });

  it("marks the 24-hour tier permanent, with the rift scar", () => {
    expect(ritualCost({ l: 5, tt: "24 hours" })).toEqual({ duration: "Permanent", tv: 325, exertion: 1, scar: true });
  });
});

describe("conditions", () => {
  it("fills to the clicked box and steps back on the top filled box", () => {
    const sheet = blank();
    setCondition(sheet, "shock", 4);
    expect(sheet.cm.shock).toBe(4);
    setCondition(sheet, "shock", 4);
    expect(sheet.cm.shock).toBe(3);
    expect(toggleBox(0, 1)).toBe(1);
  });

  it("clears the dying tracker when Trauma drops below ten", () => {
    const sheet = blank();
    sheet.cm.trauma = 10;
    sheet.dy = { succ: 2, over: 1, aided: true };
    setCondition(sheet, "trauma", 10);
    expect(sheet.cm.trauma).toBe(9);
    expect(sheet.dy).toEqual({ succ: 0, over: 0, aided: false });
  });

  it("keeps the tracker while Trauma stays at ten or more", () => {
    const sheet = blank();
    sheet.cm.trauma = 12;
    sheet.dy = { succ: 2, over: 0, aided: false };
    setCondition(sheet, "trauma", 11);
    expect(sheet.dy.succ).toBe(2);
  });

  it("moves Trauma with each overflow box, never below ten or above twenty", () => {
    const sheet = blank();
    sheet.cm.trauma = 10;
    setOverflow(sheet, 2);
    expect(sheet.dy.over).toBe(2);
    expect(sheet.cm.trauma).toBe(12);
    setOverflow(sheet, 2);
    expect(sheet.cm.trauma).toBe(11);
    sheet.cm.trauma = 20;
    sheet.dy.over = 0;
    setOverflow(sheet, 5);
    expect(sheet.cm.trauma).toBe(20);
  });

  it("previews the dying goal while dormant and uses the real penalty once live", () => {
    const sheet = withBase({ end: 4, ste: 3 });
    expect(dyingState(sheet, penalties(sheet))).toMatchObject({ live: false, need: 2, have: 0, rawPool: 4 });
    sheet.cm.trauma = 12;
    sheet.dy.succ = 5;
    expect(dyingState(sheet, penalties(sheet))).toMatchObject({ live: true, need: 3, have: 3, stable: true, dailyDifficulty: "Moderate" });
  });

  it("is stable when an ally helped", () => {
    const sheet = blank();
    sheet.cm.trauma = 10;
    sheet.dy.aided = true;
    expect(dyingState(sheet, penalties(sheet)).stable).toBe(true);
  });

  it("lets Trauma outrank Rot outrank Shock on the dial", () => {
    const sheet = blank();
    expect(criticalMonitor(sheet)).toBeNull();
    sheet.cm.shock = MONITOR_BOXES;
    expect(criticalMonitor(sheet).track).toBe("shock");
    sheet.cm.rot = MONITOR_BOXES;
    expect(criticalMonitor(sheet).track).toBe("rot");
    sheet.cm.trauma = MONITOR_BOXES;
    expect(criticalMonitor(sheet).track).toBe("trauma");
  });

  it("gives overflow of Essence / 3, at least 1", () => {
    expect(overflowPool(withBase({ ess: 10 }))).toBe(3);
    expect(overflowPool(withBase({ ess: 0 }))).toBe(1);
  });
});

describe("choices", () => {
  it("sets Sanity from the race", () => {
    const sheet = blank();
    chooseRace(sheet, "starborne");
    expect(sheet).toMatchObject({ sanity: RACES.starborne.san, base: { san: 6 } });
    chooseRace(sheet, "human");
    expect(sheet.base.san).toBe(8);
  });

  it("keeps Sanity when the race is one the book does not have", () => {
    const sheet = blank();
    chooseRace(sheet, "constructor");
    expect(sheet.sanity).toBe(8);
  });

  it("sets the Master Skill from a book profession and keeps it for a custom one", () => {
    const sheet = blank();
    chooseProfession(sheet, "Medical Doctor");
    expect(sheet.id.master).toBe("Medicine");
    chooseProfession(sheet, "Bounty hunter");
    expect(sheet.id).toMatchObject({ prof: "Bounty hunter", master: "Medicine" });
  });
});

describe("intOrBlank", () => {
  it("keeps a blank blank so an empty field stays empty", () => {
    expect([intOrBlank(""), intOrBlank("  "), intOrBlank("-"), intOrBlank("-2"), intOrBlank("7x")]).toEqual(["", "", "", -2, 7]);
  });
});
