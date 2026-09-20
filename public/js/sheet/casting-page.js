// Page 4, Casting: Veil and Psyche pools, schools, the effect ladder, spells, powers, rituals.
import { h } from "../dom.js";
import { CAST_TYPES, EFFECT_SCALE, PSY_SCHOOLS, RITUAL_TIERS, VEIL_SCHOOLS, psyAP, schoolSlots, total, veilAP } from "../eclipse-rules.js";
import { addRow, headRow, heading, note, panel, removeButton, tabPanel } from "./ui.js";

const options = (values) => values.map((value) => h("option", {}, value));

function castRow(kind, index) {
  const path = `${kind}.${index}`;
  const schools = kind === "spells" ? VEIL_SCHOOLS : PSY_SCHOOLS;
  const aria = (field) => ({ "aria-label": `${kind === "spells" ? "Spell" : "Power"} ${index + 1} ${field}` });
  return h(
    "tr",
    {},
    h("td", {}, h("input", { class: "iname", "data-cl": `${path}.n`, ...aria("name") })),
    h("td", {}, h("select", { "data-cl": `${path}.s`, ...aria("school") }, h("option", { value: "" }), options(schools))),
    h("td", { class: "c" }, h("input", { class: "num", "data-cl": `${path}.l`, inputmode: "numeric", ...aria("level") })),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-cc": path }, "0")),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-ca": path }, "0")),
    h("td", { class: "c" }, h("select", { class: "ctr", "data-cl": `${path}.t`, ...aria("type") }, h("option", { value: "" }), options(CAST_TYPES))),
    h("td", {}, h("textarea", { "data-cl": `${path}.e`, ...aria("effect") })),
    h("td", { class: "c" }, removeButton({ "data-rmc": path })),
  );
}

function ritualRow(index) {
  const path = `rituals.${index}`;
  const aria = (field) => ({ "aria-label": `Ritual ${index + 1} ${field}` });
  return h(
    "tr",
    {},
    h("td", {}, h("input", { class: "iname", "data-cl": `${path}.n`, ...aria("name") })),
    h("td", {}, h("select", { "data-cl": `${path}.s`, ...aria("school") }, h("option", { value: "" }), options(VEIL_SCHOOLS))),
    h("td", { class: "c" }, h("input", { class: "num", "data-cl": `${path}.l`, inputmode: "numeric", ...aria("level") })),
    h("td", { class: "c" }, h("select", { class: "ctr", "data-cl": `${path}.tt`, ...aria("time invested") }, h("option", { value: "" }), options(RITUAL_TIERS.map((tier) => tier.t)))),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-rdur": index }, "—")),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-rtv": index }, "0")),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-rshock": index }, "0")),
    h("td", {}, h("textarea", { "data-cl": `${path}.e`, ...aria("notes") })),
    h("td", { class: "c" }, removeButton({ "data-rmc": path })),
  );
}

export const spellRows = (sheet) => sheet.spells.map((_, i) => castRow("spells", i));
export const powerRows = (sheet) => sheet.powers.map((_, i) => castRow("powers", i));
export const ritualRows = (sheet) => sheet.rituals.map((_, i) => ritualRow(i));
export const ladderRows = () =>
  Array.from({ length: 10 }, (_, i) => {
    const level = i + 1;
    return h("tr", { "data-lvl": level }, h("td", { class: "lvl" }, level), h("td", {}, level), h("td", {}, veilAP(level)), h("td", {}, psyAP(level)), h("td", { class: "scale" }, EFFECT_SCALE[i]));
  });

// The school pickers for Veil ("v") or Psyche ("p"): one per two points of the rating.
export function schoolPickers(sheet, which) {
  const isVeil = which === "v";
  const rating = total(sheet, isVeil ? "vei" : "psy");
  const slots = schoolSlots(rating);
  const choices = isVeil ? VEIL_SCHOOLS : PSY_SCHOOLS;
  const known = isVeil ? sheet.vSchools : sheet.pSchools;
  if (!slots) return [h("span", { class: "noslots" }, rating ? `Rating ${rating} grants no school yet. One school per 2 points.` : "Not a caster.")];
  return Array.from({ length: slots }, (_, i) =>
    h(
      "select",
      { "data-sc": `${which}.${i}`, "aria-label": `${isVeil ? "Veil" : "Psyche"} school ${i + 1}` },
      h("option", { value: "" }),
      choices.map((choice) => h("option", { selected: known[i] === choice }, choice)),
    ),
  );
}

export const schoolSlotNote = (sheet, which) => {
  const isVeil = which === "v";
  const slots = schoolSlots(total(sheet, isVeil ? "vei" : "psy"));
  return slots ? `(${slots} of ${(isVeil ? VEIL_SCHOOLS : PSY_SCHOOLS).length})` : "";
};

function disciplinePanel(sheet, { id, className, title, subtitle, prefix, spentKey, spentLabel, formula, skills, extra }) {
  return panel(
    { class: className, id },
    heading(`${title} `, note(subtitle)),
    h(
      "div",
      { class: "disc-top" },
      h("div", {}, h("div", { class: "lbl" }, "Rating"), h("div", { class: "disc-rate", id: `${prefix}_rate` }, "0"), h("div", { class: "fx" }, "from Core")),
      h(
        "div",
        {},
        h("label", { class: "lbl", for: `${prefix}_spent` }, spentLabel),
        h("input", { id: `${prefix}_spent`, "data-cast": spentKey, inputmode: "numeric" }),
        h("div", { class: "fx" }, "of ", h("span", { id: `${prefix}_max` }, "0")),
      ),
      h("div", {}, h("div", { class: "lbl" }, "Remaining"), h("div", { class: "big", id: `${prefix}_left` }, "0"), h("div", { class: "fx" }, formula)),
    ),
    h(
      "div",
      { class: "schools" },
      h("span", { class: "eyebrow" }, "Schools known ", h("span", { id: `${prefix}_slotnote` }, schoolSlotNote(sheet, prefix))),
      h("div", { class: "school-slots", id: `${prefix}_schools` }, schoolPickers(sheet, prefix)),
    ),
    h("div", { class: "castskills" }, skills.map((name) => [h("span", {}, name), h("span", { class: "p", "data-cp": name }, "0")])),
    extra,
  );
}

function castTable(title, kind, bodyId, rows, pointsLabel, addLabel) {
  return panel(
    {},
    heading(`${title} `, note("costs fill in from the Effect Level")),
    h(
      "table",
      {},
      headRow([title === "Spells" ? "Spell" : "Power", "w22"], ["School", "w17"], ["Lvl", "w6", true], [pointsLabel, "w6", true], ["AP", "w6", true], ["Type", "w9", true], ["Effect and flavour", "w32"], ["", "w2"]),
      h("tbody", { id: bodyId }, rows),
    ),
    addRow(kind, addLabel),
  );
}

export function buildCastingPage(sheet) {
  return tabPanel(
    "page4",
    "tab4",
    h(
      "div",
      { class: "pair match" },
      disciplinePanel(sheet, {
        id: "veilPanel",
        className: "veilc",
        title: "Veil",
        subtitle: "rift magic, it corrodes the body",
        prefix: "v",
        spentKey: "mpSpent",
        spentLabel: "MP spent",
        formula: "Veil × 3",
        skills: ["Sorcery", "Ritual Casting"],
      }),
      disciplinePanel(sheet, {
        id: "psyPanel",
        className: "psyc",
        title: "Psyche",
        subtitle: "psionics, it fractures the mind",
        prefix: "p",
        spentKey: "ppSpent",
        spentLabel: "PP spent",
        formula: "Psyche × 3",
        skills: ["Psionics"],
        extra: h("p", { class: "castnote" }, "Psyche has no rituals and no familiars — Psionics is its only casting skill."),
      }),
    ),
    h(
      "div",
      { class: "grid side" },
      panel(
        {},
        heading("Effect Levels ", note("what you can still afford", { id: "ladderNote" })),
        h("table", { class: "ladder" }, headRow(["Lvl", "w8", true], ["MP / PP", "w12", true], ["Veil AP", "w12", true], ["Psyche AP", "w14", true], ["Power scale", "w54"]), h("tbody", { id: "ladderRows" }, ladderRows())),
      ),
      panel(
        {},
        heading("The Toll"),
        h(
          "div",
          { class: "tolls" },
          [
            ["Points are spent ", "before", " the roll. A failed spell still costs them."],
            ["Veil healing, first cast since a Full Rest: ", "Shock equal to the Effect Level", "."],
            ["Every Veil healing cast after that: ", "Rot equal to Effect Level / 2", ", rounded up."],
            ["Psyche healing, always: ", "Shock equal to Effect Level / 2", ", rounded up."],
            ["Botch on two 1s: ", "Shock equal to the Effect Level", " and a permanent cosmetic scar."],
            ["Botch on three or more 1s: roll the Botch Severity table.", "", ""],
            ["Both pools refresh only on a Full Rest of 8 hours or more.", "", ""],
          ].map(([before, bold, after]) => h("span", { class: "rule" }, before, bold ? h("b", {}, bold) : null, after || null)),
        ),
        h("label", { class: "freecast" }, h("input", { type: "checkbox", "data-cast": "freeHeal" }), h("span", {}, "Free Veil healing cast used. Next one costs ", h("b", { id: "nextToll" }, "Rot"), ".")),
      ),
    ),
    castTable("Spells", "spells", "spellRows", spellRows(sheet), "MP", "+ add spell"),
    castTable("Powers", "powers", "powerRows", powerRows(sheet), "PP", "+ add power"),
    panel(
      {},
      heading("Rituals ", note("Veil only, extended workings — see The Ritual Toll")),
      h(
        "table",
        {},
        headRow(["Ritual", "w17"], ["School", "w15"], ["Lvl", "w6", true], ["Time invested", "w12"], ["Duration", "w10", true], ["TV", "w7", true], ["Shock", "w9", true], ["Notes", "w22"], ["", "w2"]),
        h("tbody", { id: "ritualRows" }, ritualRows(sheet)),
      ),
      addRow("rituals", "+ add ritual"),
    ),
  );
}
