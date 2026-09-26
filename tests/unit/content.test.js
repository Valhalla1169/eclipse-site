import { describe, expect, it } from "vitest";
import { MORALITY, SANITY, STARVATION, TRACK_MAX } from "../../public/js/eclipse-content.js";
import { ATTR_NAMES, blank, dyingState, encPenalty, encTiers, penalties, ritualCost } from "../../public/js/eclipse-rules.js";
import { starvationDays } from "../../public/js/sheet/core-page.js";
import { REFERENCE, REFERENCE_TABLES as T } from "../../public/js/sheet/reference-data.js";

// Each Reference table is read as the text a person sees, and checked against what
// the rules compute, so a card can never say something the sheet does not do.
const rowsOf = (table) => table.rows.map((row) => row.map((cell) => (typeof cell === "string" ? cell : cell.n)));
// "−3" is 3 dice lost; "0" and "−0" are none.
const lost = (label) => Number(label.replace("−", ""));
const firstNumber = (label) => Number(label.match(/\d+/)[0]);
const cardText = (title) => REFERENCE.find((card) => card.t === title).body.filter((part) => typeof part === "string").join(" ");

const starving = (days) => {
  const sheet = blank();
  sheet.starve = days;
  return penalties(sheet);
};

describe("the Reference tables", () => {
  it("are each shown on a card", () => {
    const shown = REFERENCE.flatMap((card) => card.body);
    for (const [name, table] of Object.entries(T)) expect(shown, name).toContain(table);
  });

  it("Starvation gives the penalty the sheet takes on every day", () => {
    const rows = rowsOf(T.starvation).map(([label, cost]) => ({ from: firstNumber(label), cost }));
    for (let days = 0; days <= STARVATION.deathDay + 2; days += 1) {
      const row = rows.findLast((r) => r.from <= days);
      const taken = starving(days);
      if (row.cost === "death") expect(taken.dead, `${days} days`).toBe(true);
      else expect(taken, `${days} days`).toMatchObject({ dead: false, v: lost(row.cost) });
    }
  });

  it("Encumbrance names each load tier and its penalty as the sheet does", () => {
    const sheet = blank();
    const tiers = encTiers(sheet);
    const firstLoads = [0, tiers.light, tiers.moderate, tiers.serious, tiers.immobile].map((limit, i) => (i ? limit + 0.1 : limit));
    const rows = rowsOf(T.encumbrance);
    expect(rows).toHaveLength(firstLoads.length);
    rows.forEach(([name, cost], i) => {
      sheet.sup.rations = firstLoads[i];
      expect(encPenalty(sheet), name).toMatchObject({ tier: name, p: lost(cost) });
    });
  });

  it("Condition monitors gives the threshold the sheet uses", () => {
    const sheet = blank();
    Object.assign(sheet.base, { ste: 5, end: 7, ess: 12 });
    const { thr } = penalties(sheet);
    const keyOf = Object.fromEntries(Object.entries(ATTR_NAMES).map(([k, name]) => [name, k]));
    for (const [track, threshold] of rowsOf(T.monitors)) {
      const [, attribute, divide = "1"] = threshold.match(/^every (\w+)(?: \/ (\d+))?$/);
      expect(thr[track.toLowerCase()], track).toBe(Math.floor(sheet.base[keyOf[attribute]] / Number(divide)));
    }
  });

  it("Difficulty stages has the stages the dying rolls use, and the dice they cost", () => {
    const stages = Object.fromEntries(rowsOf(T.difficulty).map(([name, cost]) => [name, lost(cost)]));
    const sheet = blank();
    Object.assign(sheet.base, { end: 4, ste: 3 });
    const [, self, said] = cardText("Stabilizing").match(/fixed <em>(\w+) \(&minus;(\d+)\)/);
    expect([stages[self], 4 + 3 - dyingState(sheet, penalties(sheet)).rawPool]).toEqual([Number(said), Number(said)]);
    for (const trauma of [10, 13, 16, 20]) {
      sheet.cm.trauma = trauma;
      expect(Object.keys(stages)).toContain(dyingState(sheet, penalties(sheet)).dailyDifficulty);
    }
    for (const [, cost] of rowsOf(T.medicalDifficulty)) expect(Object.values(stages)).toContain(lost(cost));
  });

  it("Rituals gives the duration and materials the sheet computes", () => {
    for (const [time, duration, materials] of rowsOf(T.rituals)) {
      const [base, perLevel] = materials.match(/\d+/g).map(Number);
      for (const level of [1, 2, 7]) {
        const cost = ritualCost({ l: level, tt: time });
        expect(cost.tv, time).toBe(base + perLevel * level);
        if (duration === "Permanent") expect(cost, time).toMatchObject({ duration: "Permanent", scar: true });
        else expect(cost.duration, time).toBe(`${level} ${duration.split(" ").at(-1)}${level > 1 ? "s" : ""}`);
      }
    }
  });

  it("The Ritual Toll takes off the Exertion Shock the sheet takes off", () => {
    for (const [time, off] of rowsOf(T.ritualToll)) {
      expect(ritualCost({ l: 10, tt: time }).exertion, time).toBe(10 - lost(off));
      expect(ritualCost({ l: 1, tt: time }).exertion, time).toBe(1);
    }
  });

  it("agree with each other where they repeat a number", () => {
    const actions = Object.fromEntries(rowsOf(T.actions));
    for (const [move, ap] of rowsOf(T.defending).slice(0, 2)) expect(ap, move).toBe(`${actions["Block or Dodge"]} AP`);
    expect(rowsOf(T.reloads)[0][1]).toBe(`${actions["Load a fresh magazine"]} AP`);

    const toolKits = rowsOf(T.toolKits).map(([name, cost]) => [name.split(",")[0], cost]);
    expect(toolKits).toEqual(rowsOf(T.medicalKits));

    for (const [band] of rowsOf(T.quality)) expect(cardText("Trading")).toContain(`${band} gives`);
  });
});

describe("the Core page", () => {
  it("marks the day each starvation penalty starts, and the day that kills", () => {
    const days = starvationDays();
    expect(days).toHaveLength(STARVATION.deathDay);
    for (const { day, fatal, label } of days) {
      const now = starving(day);
      const before = starving(day - 1);
      if (fatal) expect([label, now.dead, before.dead], `day ${day}`).toEqual(["death", true, false]);
      else if (label) expect([now.v, before.v < now.v], `day ${day}`).toEqual([lost(label), true]);
      else expect(now.v, `day ${day}`).toBe(before.v);
    }
  });
});

describe("the content", () => {
  it("has one Sanity and one Morality word for each level", () => {
    expect(SANITY).toHaveLength(TRACK_MAX);
    expect(MORALITY).toHaveLength(TRACK_MAX);
  });});
