// Page 1, Core: identity, attributes, skills, condition monitors, dial, weapons.
import { h, s } from "../dom.js";
import { ATTRS, COMBAT_SKILLS, MONITOR_BOXES, RACES, SKILLS, SPECIALS, TRACK_MAX, WEAPON_MODES, ALL_SKILLS } from "../eclipse-rules.js";
import { headRow, heading, panel, tabPanel } from "./ui.js";

export const DAYS_WITHOUT_RATIONS = 12;
export const CORONA_TICKS = 36;
const FATAL_DAY = DAYS_WITHOUT_RATIONS - 1;
const PENALTY_DAYS = [2, 5, 8, 11];

const skillId = (name) => `sk_${name.replace(/\W/g, "")}`;

function identityField({ id, label, wide, grit }, control) {
  return h("div", { class: ["idf", wide && "wide", grit && "grit"].filter(Boolean).join(" ") }, h("label", { for: id }, label), control);
}

function identityBand() {
  return h(
    "div",
    { class: "identity" },
    identityField({ id: "f_name", label: "Survivor", wide: true }, h("input", { id: "f_name" })),
    identityField(
      { id: "f_race", label: "Race" },
      h("select", { id: "f_race" }, ...Object.entries(RACES).map(([key, race]) => h("option", { value: key }, race.name))),
    ),
    h(
      "div",
      { class: "idf" },
      h("label", { for: "f_prof" }, "Profession"),
      h(
        "div",
        { class: "combo" },
        h("input", { id: "f_prof", autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "profList", "aria-autocomplete": "list" }),
        h("button", { class: "caret", id: "profCaret", type: "button", tabindex: "-1", "aria-label": "Show professions" }, "▼"),
        h("div", { class: "combo-list", id: "profList", role: "listbox" }),
      ),
    ),
    identityField(
      { id: "f_master", label: "Master skill +2" },
      h("select", { id: "f_master" }, h("option", { value: "" }, "none"), ...ALL_SKILLS.map((name) => h("option", { value: name }, name))),
    ),
    identityField({ id: "f_bg", label: "Background" }, h("input", { id: "f_bg" })),
    identityField({ id: "f_grit", label: "Grit banked", grit: true }, h("input", { id: "f_grit" })),
  );
}

function attributeRow(attr, special) {
  return h(
    "div",
    { class: `attr-row${special ? " spec" : ""}` },
    h("span", { class: "nm" }, h("b", {}, attr.n.charAt(0)), attr.n.slice(1)),
    h("input", { class: "cell", "data-base": attr.k, inputmode: "numeric", "aria-label": `${attr.n} base` }),
    h("span", { class: "mod", "data-mod": attr.k }, "·"),
    h("input", { class: "mod", "data-oth": attr.k, inputmode: "numeric", "aria-label": `${attr.n} other modifier` }),
    h("span", { class: "tot", "data-tot": attr.k, "aria-label": `${attr.n} total` }, "0"),
  );
}

const attributeHead = (kind) =>
  h("div", { class: "attr-head" }, h("span", {}, kind), h("span", {}, "Base"), h("span", {}, "Mod"), h("span", {}, "Oth"), h("span", {}, "Total"));

const derivedStat = (label, id, formula, modifier) =>
  h("div", { class: `dstat${modifier ? ` ${modifier}` : ""}` }, h("div", { class: "lbl" }, label), h("div", { class: "val", id }, "0"), h("div", { class: "fx" }, formula));

function toggleTrack(className, dataAttr, count, labelFor) {
  return Array.from({ length: count }, (_, i) => h("button", { class: className, type: "button", [dataAttr]: i, "aria-pressed": "false", "aria-label": labelFor(i) }));
}

function leftColumn() {
  return h(
    "div",
    {},
    panel(
      {},
      heading("Attributes"),
      h(
        "div",
        { class: "pad" },
        attributeHead("Primary"),
        h("div", { id: "attrRows" }, ATTRS.map((a) => attributeRow(a, false))),
        h("div", { class: "divider" }),
        attributeHead("Special"),
        h("div", { id: "specRows" }, SPECIALS.map((a) => attributeRow(a, true))),
      ),
    ),
    panel(
      {},
      heading("Derived"),
      h(
        "div",
        { class: "derived" },
        derivedStat("Action Pts", "d_ap", "ECLIPS / 3", "hl"),
        derivedStat("Initiative", "d_init", "1d10 + Ins", "hl"),
        derivedStat("Passive Perc.", "d_pperc", "C+San+Psy / 3"),
        derivedStat("Dodge Pool", "d_dodge", "I+C / 3"),
        derivedStat("Pers. Soak", "d_psoak", "(E+I+S) / 8"),
        derivedStat("Overflow", "d_over", "Essence / 3"),
        derivedStat("Magic Pts", "d_mp", "Veil × 3", "rift"),
        derivedStat("Psionic Pts", "d_pp", "Psyche × 3", "rift"),
      ),
    ),
    panel(
      {},
      heading("Sanity & Morality"),
      h(
        "div",
        { class: "tracks" },
        h(
          "div",
          { class: "trk" },
          h("div", { class: "trk-top" }, h("span", { class: "trk-name san" }, "Sanity"), h("span", { class: "trk-state", id: "san_state" }, "stable")),
          h("div", { class: "san-track", id: "bx_sanity" }, toggleTrack("sb", "data-san", TRACK_MAX, (i) => `Sanity ${i + 1} of ${TRACK_MAX}`)),
        ),
        h(
          "div",
          { class: "trk" },
          h("div", { class: "trk-top" }, h("span", { class: "trk-name" }, "Morality"), h("span", { class: "trk-state", id: "mor_state" }, "Human")),
          h("div", { class: "mor-track", id: "bx_morality" }, toggleTrack("mb", "data-mor", TRACK_MAX, (i) => `Morality ${i + 1} of ${TRACK_MAX}`)),
          h("div", { class: "mor-ends" }, h("span", {}, "Monstrous"), h("span", {}, "Selfless")),
        ),
      ),
    ),
  );
}

function skillGroup([groupName, attrKey, list]) {
  return h(
    "div",
    { class: "sgroup" },
    h("h3", {}, h("span", {}, groupName), h("span", { class: "cap", "data-cap": attrKey }, "max 2")),
    h("div", { class: "skey" }, h("span"), h("span", {}, "Lvl"), h("span", {}, "Oth"), h("span", {}, "Pool")),
    list.map((name) =>
      h(
        "div",
        { class: "srow", "data-skill": name, "data-attr": attrKey },
        h("label", { for: skillId(name) }, name),
        h("input", { id: skillId(name), "data-sk": name, inputmode: "numeric" }),
        h("input", { class: "oth", "data-so": name, inputmode: "numeric", "aria-label": `${name} other modifier` }),
        h("span", { class: "pool", "data-pool": name }, "0"),
      ),
    ),
  );
}

function gearField(id, label, { name, value } = {}) {
  return h("div", { class: `af${name ? " name" : ""}` }, h("label", { for: id }, label), h("input", { id, class: name ? null : "num", ...(value === undefined ? {} : { value }) }));
}

function degradeColumn(title, prefix, poolValue) {
  return h(
    "div",
    { class: "degrade-col" },
    h("div", { class: "degrade-head" }, h("span", { class: "eyebrow" }, title)),
    h(
      "div",
      { class: "degrade-grid" },
      h("div", {}, h("div", { class: "lbl" }, "Pool"), h("div", { class: "val", id: `${prefix}_dpv` }, poolValue)),
      h("div", {}, h("label", { class: "lbl", for: `${prefix}_soaked` }, "Soaked"), h("input", { id: `${prefix}_soaked`, inputmode: "numeric", value: "0" })),
      h("div", {}, h("div", { class: "lbl" }, "State"), h("div", { class: "val state", id: `${prefix}_dstate` }, "intact")),
    ),
  );
}

function middleColumn() {
  return h(
    "div",
    { class: "col-mid" },
    panel(
      {},
      heading(
        "Skills",
        h("span", { class: "legend" }, "Untrained skills roll at +2 difficulty"),
        h("label", { class: "ptoggle" }, h("input", { type: "checkbox", id: "applyPen", checked: true }), " subtract dice penalty"),
      ),
      h("div", { class: "skillcols", id: "skillCols" }, SKILLS.map(skillGroup)),
    ),
    panel(
      {},
      heading("Armor & Shield"),
      h(
        "div",
        { class: "gear-row" },
        gearField("a_name", "Worn armor", { name: true }),
        gearField("a_b", "AV B", { value: "0" }),
        gearField("a_i", "AV I", { value: "0" }),
        gearField("a_ap", "AP pen", { value: "0" }),
        gearField("sh_name", "Shield", { name: true }),
        gearField("sh_b", "AV B", { value: "0" }),
        gearField("sh_i", "AV I", { value: "0" }),
        gearField("sh_ap", "AP act", { value: "0" }),
      ),
      h("div", { class: "degrade" }, degradeColumn("Armor degradation", "a", "0"), degradeColumn("Shield degradation", "sh", "10")),
    ),
  );
}

function weaponRow(index) {
  const field = (name) => `${index}.${name}`;
  const cell = (name, label, className = "num") => h("td", { class: "c" }, h("input", { class: className, "data-w": field(name), "aria-label": `Weapon ${index + 1} ${label}` }));
  return h(
    "tr",
    {},
    h("td", {}, h("input", { "data-w": field("name"), "aria-label": `Weapon ${index + 1} name` })),
    h(
      "td",
      {},
      h("select", { "data-w": field("skill"), "aria-label": `Weapon ${index + 1} skill` }, h("option", { value: "" }), ...COMBAT_SKILLS.map((name) => h("option", { value: name }, name))),
    ),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-wpool": index }, "·")),
    cell("ap", "AP"),
    cell("dmg", "damage"),
    cell("range", "range"),
    h("td", { class: "c" }, h("select", { class: "ctr", "data-w": field("mode"), "aria-label": `Weapon ${index + 1} modes` }, ...WEAPON_MODES.map((mode) => h("option", {}, mode)))),
    cell("loaded", "loaded"),
    cell("reserve", "reserve"),
    h("td", {}, h("input", { class: "wnote", "data-w": field("note"), placeholder: "mods, ammo type, quirks", "aria-label": `Weapon ${index + 1} notes` })),
  );
}

function weaponsPanel(count) {
  return panel(
    { class: "span2" },
    heading("Weapons Equipped"),
    h(
      "table",
      {},
      headRow(["Weapon", "w15"], ["Skill", "w12"], ["Pool", "w6", true], ["AP", "w5", true], ["DMG", "w5", true], ["Range", "w7", true], ["Modes", "w10", true], ["Load", "w6", true], ["Res", "w6", true], ["Notes", "w28"]),
      h("tbody", { id: "weaponRows" }, Array.from({ length: count }, (_, i) => weaponRow(i))),
    ),
    h("div", { class: "wtag" }, "AP is the single action cost · Burst Fire costs AP +1 and adds +2 damage · Aim: 1 AP = +1 die and bypasses 1 armor AV"),
  );
}

function starvationPanel() {
  const scale = ["", "", "−1", "", "", "−3", "", "", "−5", "", "", "death"];
  return panel(
    { class: "span2", id: "starvePanel" },
    heading("Starvation"),
    h(
      "div",
      { class: "starve" },
      h("div", { class: "stv-count" }, h("span", { class: "n", id: "stv_n" }, "0"), h("span", { class: "l" }, "days without", h("br"), "rations")),
      h(
        "div",
        { class: "stv-mid" },
        h(
          "div",
          { class: "stv-track", id: "stv_track" },
          Array.from({ length: DAYS_WITHOUT_RATIONS }, (_, i) =>
            h("button", {
              class: ["dbx", i === FATAL_DAY && "fatal", PENALTY_DAYS.includes(i) && "mark"].filter(Boolean).join(" "),
              type: "button",
              "data-d": i,
              "aria-pressed": "false",
              "aria-label": `Day ${i + 1} without rations`,
            }),
          ),
        ),
        h("div", { class: "stv-scale" }, scale.map((label) => h("span", {}, label))),
      ),
      h("div", { class: "stv-pen" }, h("span", { class: "l" }, "Penalty"), h("span", { class: "n", id: "stv_pen" }, "0")),
    ),
    h("div", { class: "stv-foot", id: "stv_foot" }, h("span", {}, "Eating a ration reduces the counter by one; it does not reset to zero.")),
  );
}

const modifierRows = (sheet) =>
  sheet.mods.map((_, i) =>
    h(
      "div",
      { class: "modrow" },
      h("input", { class: "mname", "data-mn": i, "aria-label": `Modifier ${i + 1} source` }),
      h("input", { class: "mval", "data-mv": i, inputmode: "numeric", "aria-label": `Modifier ${i + 1} value` }),
    ),
  );

// Talents and gear that add to Ballistic, Impact or Personnel soak for good.
const soakSourceRows = (sheet) =>
  sheet.soakMods.map((_, i) =>
    h(
      "div",
      { class: "smrow" },
      h("input", { class: "mname", "data-smn": i, "aria-label": `Soak source ${i + 1} name` }),
      h("input", { class: "mval", "data-smb": i, inputmode: "numeric", "aria-label": `Soak source ${i + 1} Ballistic` }),
      h("input", { class: "mval", "data-smi": i, inputmode: "numeric", "aria-label": `Soak source ${i + 1} Impact` }),
      h("input", { class: "mval", "data-smp": i, inputmode: "numeric", "aria-label": `Soak source ${i + 1} Personnel` }),
    ),
  );

function soakPanel(sheet) {
  return panel(
    {},
    heading("Total Soak", h("label", { class: "ptoggle" }, h("input", { type: "checkbox", id: "useShieldSoak" }), " raising shield")),
    h(
      "div",
      { class: "soak" },
      h("div", {}, h("div", { class: "lbl" }, "Ballistic"), h("div", { class: "val", id: "s_b" }, "0")),
      h("div", {}, h("div", { class: "lbl" }, "Impact"), h("div", { class: "val", id: "s_i" }, "0")),
    ),
    h(
      "div",
      { class: "pad" },
      h("div", { class: "smhead" }, h("span", { class: "eyebrow" }, "Soak sources"), h("span", { class: "eyebrow" }, "B"), h("span", { class: "eyebrow" }, "I"), h("span", { class: "eyebrow" }, "P")),
      h("div", { id: "soakModRows" }, soakSourceRows(sheet)),
    ),
  );
}

// Corona ticks around the dial.
function coronaTicks() {
  const inner = 70;
  const outer = 92;
  return Array.from({ length: CORONA_TICKS }, (_, i) => {
    const angle = (i / CORONA_TICKS) * Math.PI * 2 - Math.PI / 2;
    return s("line", {
      class: "tick",
      x1: 100 + Math.cos(angle) * inner,
      y1: 100 + Math.sin(angle) * inner,
      x2: 100 + Math.cos(angle) * outer,
      y2: 100 + Math.sin(angle) * outer,
    });
  });
}

function dialPanel(sheet) {
  return panel(
    {},
    heading("Total Dice Penalty"),
    h(
      "div",
      { class: "eclipse" },
      s(
        "svg",
        { class: "dial", viewBox: "0 0 200 200", role: "img", "aria-labelledby": "dialTitle" },
        s("title", { id: "dialTitle" }, "Eclipse dial showing total dice penalty"),
        s("g", { id: "corona" }, coronaTicks()),
        s("circle", { class: "crit-ring", cx: 100, cy: 100, r: 68 }),
        s("circle", { class: "disc", cx: 100, cy: 100, r: 62 }),
        s("text", { id: "dialNum", class: "dial-num", x: 100, y: 100, "text-anchor": "middle", "dominant-baseline": "central" }, "0"),
      ),
      h(
        "div",
        { class: "breakdown" },
        [["SHK", "bd_s"], ["TRM", "bd_t"], ["ROT", "bd_r"], ["STV", "bd_v"], ["ENC", "bd_e"], ["OTH", "bd_o"]].map(([label, id]) => h("span", {}, `${label} `, h("b", { id }, "0"))),
      ),
      h("div", { class: "modhead" }, h("span", { class: "eyebrow" }, "Other modifiers"), h("span", { class: "eyebrow", id: "modTotal" }, "0")),
      h("div", { id: "modRows" }, modifierRows(sheet)),
      h("div", { class: "modhint" }, "Environmental, rift, tech, and gear effects that last. Enter a negative number for a bonus."),
      h("span", { class: "critbadge", id: "critBadge" }),
      h("p", { class: "caption", id: "dialCaption" }, "Nothing has taken anything from you yet."),
    ),
  );
}

function monitorRow(track, thresholdId, penaltyId, boxesId, placeholder, label) {
  return h(
    "div",
    { class: `cm-row cm-${track}`, "data-track": track },
    h(
      "div",
      { class: "cm-top" },
      h("span", { class: "cm-name" }, label),
      h("span", { class: "cm-meta" }, "every ", h("b", { id: thresholdId }, "1"), " → ", h("span", { class: "cm-pen", id: penaltyId }, "0")),
    ),
    h("div", { class: "boxes", id: boxesId }, Array.from({ length: MONITOR_BOXES }, (_, i) => h("button", { class: "bx", type: "button", "data-t": track, "data-i": i, "aria-pressed": "false", "aria-label": `${label} box ${i + 1}` }))),
    h("input", { class: "cmnote", "data-note": track, placeholder, "aria-label": `${label} notes` }),
  );
}

function monitorsPanel() {
  return panel(
    {},
    heading("Condition Monitors"),
    h(
      "div",
      { class: "cm" },
      monitorRow("shock", "thr_shock", "pen_shock", "bx_shock", "what caused it, e.g. 2 blast, 1 terror", "Shock"),
      monitorRow("trauma", "thr_trauma", "pen_trauma", "bx_trauma", "e.g. 3 raider rifle, 1 fall", "Trauma"),
      monitorRow("rot", "thr_rot", "pen_rot", "bx_rot", "e.g. 2 disease, 1 swamp exposure", "Rot"),
    ),
  );
}

function dyingPanel() {
  return panel(
    { class: "dying", id: "dyingPanel" },
    heading("Dying & Stabilization"),
    h(
      "div",
      { class: "dy-body" },
      h(
        "div",
        { class: "dy-roll" },
        h("span", {}, h("span", { class: "lbl" }, "Your roll"), h("br"), h("span", { class: "pool", id: "dy_pool" }, "0")),
        h("span", { class: "fx", id: "dy_formula" }),
      ),
      h("div", { class: "dy-goal" }, h("span", { class: "nm ok" }, "Successes banked"), h("span", { class: "ct" }, h("b", { id: "dy_have" }, "0"), " of ", h("span", { id: "dy_need" }, "0"))),
      h("div", { class: "dy-track", id: "dy_succ" }),
      h("div", { class: "dy-goal" }, h("span", { class: "nm bad" }, "Overflow taken"), h("span", { class: "ct" }, h("b", { id: "dy_of" }, "0"), " of ", h("span", { id: "dy_ofmax" }, "0"))),
      h("div", { class: "dy-track", id: "dy_over" }),
      h("p", { class: "dy-note", id: "dy_hint" }),
      h("span", { class: "dy-flag", id: "dy_flag", hidden: true }, "Stabilized"),
      h("label", { class: "dy-aid" }, h("input", { type: "checkbox", "data-dy": "aided" }), h("span", {}, "Stabilized by an ally. 5 AP and 1 medical supply unit.")),
    ),
    h("p", { class: "dy-idle" }, "Wakes up at 10 Trauma. Until then, none of this applies to you."),
  );
}

export function buildCorePage(sheet) {
  return tabPanel(
    "page1",
    "tab1",
    identityBand(),
    h(
      "div",
      { class: "grid" },
      h("div", { class: "mainblock" }, leftColumn(), middleColumn(), weaponsPanel(sheet.weapons.length), starvationPanel()),
      h("div", {}, soakPanel(sheet), dialPanel(sheet), monitorsPanel(), dyingPanel()),
    ),
  );
}
