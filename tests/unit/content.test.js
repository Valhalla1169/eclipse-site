import { describe, expect, it } from "vitest";
import { COMBAT_SKILLS, DIFFICULTY, MORALITY, RETRY, SANITY, SKILLS, SKILL_GRIT_RATE, STARVATION, TRACK_MAX } from "../../public/js/eclipse-content.js";
import { ALL_SKILLS, ATTR_NAMES, SKILL_ATTR, blank, dyingState, encPenalty, encTiers, penalties, ritualCost, skillCap, weights } from "../../public/js/eclipse-rules.js";
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

  it("gives the weight of a ration the sheet uses", () => {
    const [, said] = cardText("Starvation").match(/weighs (\d+(?:\.\d+)?) lb/);
    const sheet = blank();
    sheet.sup.rations = 1;
    expect(weights(sheet).supplies).toBe(Number(said));
  });

  it("Encumbrance names each load tier and its penalty as the sheet does, right at each boundary", () => {
    const sheet = blank();
    const tiers = encTiers(sheet);
    const thresholds = [tiers.light, tiers.moderate, tiers.serious, tiers.immobile];
    const rows = rowsOf(T.encumbrance);
    expect(rows).toHaveLength(thresholds.length + 1);
    // medQ x medW, not rations, so this load is exact lb regardless of RATION_LB.
    const check = (load, i) => {
      Object.assign(sheet.sup, { medQ: 1, medW: load });
      expect(encPenalty(sheet), `${load} lb -> ${rows[i][0]}`).toMatchObject({ tier: rows[i][0], p: lost(rows[i][1]) });
    };
    check(0, 0); // the lightest load
    thresholds.forEach((limit, i) => {
      check(limit, i); // the last load still in this tier
      check(limit + 0.1, i + 1); // the first load of the next tier
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
    // High enough that no Difficulty stage's dice (up to Near impossible's 9) clamps rawPool to
    // its floor of 1, so the arithmetic below only fails when the roll and the card disagree.
    Object.assign(sheet.base, { end: 10, ste: 10 });
    const [, self, said] = cardText("Stabilizing").match(/fixed <em>([\w ]+) \(&minus;(\d+)\)/);
    expect([stages[self], 20 - dyingState(sheet, penalties(sheet)).rawPool]).toEqual([Number(said), Number(said)]);
    // Known Trauma values, one inside each row of the daily table, so a wrong stage fails here.
    for (const [trauma, key] of [[10, "moderate"], [13, "challenging"], [16, "difficult"], [20, "difficult"]]) {
      sheet.cm.trauma = trauma;
      expect(dyingState(sheet, penalties(sheet)).dailyDifficulty, `trauma ${trauma}`).toBe(DIFFICULTY[key].name);
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
  });

  it("give one time for a medical treatment attempt, on every card that says it", () => {
    const [, minutes] = cardText("Medical treatment").match(/(\d+) minutes/);
    const retry = Object.fromEntries(rowsOf(T.retries)).Medicine;
    const healing = Object.fromEntries(rowsOf(T.healing)).Medical;
    expect([retry, healing]).toEqual([expect.stringMatching(new RegExp(`^${minutes} min an attempt,`)), `${minutes} min`]);
  });

  it("Advancement costs gives the skill cap the sheet flags", () => {
    const [, times, max] = cardText("Advancement costs").match(/at most <b>(\d+) &times; the linked attribute<\/b>, and never more than (\d+)/);
    const sheet = blank();
    for (const attribute of [1, 3, 5, 6, 9]) {
      sheet.base.cla = attribute;
      expect(skillCap(sheet, "cla"), `attribute ${attribute}`).toBe(Math.min(Number(max), Number(times) * attribute));
    }
  });

  it("Advancement costs a skill rating of 6 at × 3 and 7, past mastery, at × 4", () => {
    const bands = Object.fromEntries(rowsOf(T.advancement));
    expect(bands["Skill, rating 1 to 6"]).toBe("new rating × 3");
    expect(bands["Skill, rating 7 to 10"]).toBe("new rating × 4");
    expect(SKILL_GRIT_RATE.map((r) => r.perRating)).toEqual([3, 4]);
  });

  it("gives Lock Picking and Hacking the book's retry time and failure cost", () => {
    const retries = Object.fromEntries(rowsOf(T.retries));
    expect(retries["Lock Picking"]).toBe(`${RETRY.lockPicking.minutes} min an attempt, ${RETRY.lockPicking.failure}`);
    expect(retries.Hacking).toBe(`${RETRY.hacking.minMinutes} min to ${RETRY.hacking.maxMinutes / 60} hr an attempt, ${RETRY.hacking.failure}`);
    // The book's own numbers (p173-174), so a change to the content file cannot drift unnoticed.
    expect(retries["Lock Picking"]).toBe("10 min an attempt, breaks the pick");
    expect(retries.Hacking).toBe("10 min to 1 hr an attempt, locks you out an hour");
  });

  it("Sanity gives the book's 0 to 10 range, not 1 to 10", () => {
    expect(cardText("Sanity")).toMatch(new RegExp(`0 to ${TRACK_MAX} rating`));
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
  });
});

describe("skill links", () => {
  it("links each skill the book moved or added to the attribute the book gives it", () => {
    const linked = {
      Medicine: "cla",
      Insight: "pre",
      Focus: "ste",
      Drive: "ins",
      "Lock Picking": "ins",
      "Sleight of Hand": "ins",
      "Projectile Weapons": "ins",
      Etiquette: "pre",
      Politics: "pre",
    };
    for (const [skill, attr] of Object.entries(linked)) expect(SKILL_ATTR[skill], skill).toBe(attr);
  });

  it("has no skill the book does not have", () => {
    for (const gone of ["Archery", "Polearms", "Heavy Weapons"]) expect(ALL_SKILLS).not.toContain(gone);
  });

  it("has one weapon skill option for every combat skill the sheet still has", () => {
    for (const skill of COMBAT_SKILLS) expect(ALL_SKILLS, skill).toContain(skill);
  });

  it("has the book's 42 skills, no more and no fewer", () => {
    expect(SKILLS.flatMap(([, , list]) => list)).toHaveLength(42);
  });
});
