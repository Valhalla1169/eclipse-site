// Page 2, Equipment: encumbrance, supplies, worn items and containers.
import { h } from "../dom.js";
import { ENCUMBRANCE, RATION_LB } from "../eclipse-content.js";
import { addRow, headRow, heading, note, panel, removeButton, tabPanel } from "./ui.js";

const itemHead = () =>
  headRow(["Item", "w34"], ["Qty", "w9", true], ["Unit lb", "w10", true], ["Weight", "w10", true], ["Q", "w7", true], ["TV", "w9", true], ["Notes", "w19"], ["", "w2"]);

// A row for something the player types in: a worn extra ("we") or a container item ("c0", "c1").
function itemRow(scope, index) {
  const key = `${scope}.${index}`;
  const number = (field, props = {}) => h("td", { class: "c" }, h("input", { class: "num", "data-it": `${key}.${field}`, "aria-label": `${field} of item ${index + 1}`, ...props }));
  return h(
    "tr",
    {},
    h("td", {}, h("input", { class: "iname", "data-it": `${key}.n`, "aria-label": `Name of item ${index + 1}` })),
    number("q", { inputmode: "numeric" }),
    number("w", { inputmode: "decimal" }),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-iw": key }, "0")),
    number("ql", { inputmode: "numeric", placeholder: "5" }),
    number("tv", { inputmode: "numeric" }),
    h("td", {}, h("input", { class: "wnote", "data-it": `${key}.note`, "aria-label": `Notes for item ${index + 1}` })),
    h("td", { class: "c" }, removeButton({ "data-rm": key })),
  );
}

// A row whose name comes from the Core sheet; everything else is editable here.
function carriedRow(key, label) {
  const number = (attrs) => h("td", { class: "c" }, h("input", { class: "num", ...attrs }));
  return h(
    "tr",
    {},
    h("td", {}, h("span", { class: "fixed", title: "Named on the Core sheet" }, label)),
    number({ "data-wx": `${key}.q`, inputmode: "numeric", "aria-label": `Quantity of ${label}` }),
    number({ "data-ww": key, inputmode: "decimal", "aria-label": `Unit weight of ${label}` }),
    h("td", { class: "c" }, h("span", { class: "calc dim", "data-wwt": key }, "0")),
    number({ "data-wx": `${key}.ql`, inputmode: "numeric", "aria-label": `Quality of ${label}` }),
    number({ "data-wx": `${key}.tv`, inputmode: "numeric", "aria-label": `Trade value of ${label}` }),
    h("td", {}, h("input", { class: "wnote", "data-wx": `${key}.note`, "aria-label": `Notes for ${label}` })),
    h("td"),
  );
}

export function wornRows(sheet) {
  const rows = [];
  if (sheet.armor.name) rows.push(carriedRow("armor", `${sheet.armor.name} (armor)`));
  if (sheet.shield.name) rows.push(carriedRow("shield", `${sheet.shield.name} (shield)`));
  sheet.weapons.forEach((weapon, i) => {
    if (weapon.name) rows.push(carriedRow(`w${i}`, weapon.name));
  });
  sheet.wornExtra.forEach((_, i) => rows.push(itemRow("we", i)));
  return rows;
}

const containerField = (index, field, label, props = {}, wide = false) => {
  const id = `ct_${index}_${field}`;
  return h("div", { class: `f${wide ? " nm" : ""}` }, h("label", { for: id }, label), h("input", { id, "data-ct": `${index}.${field}`, ...props }));
};

function containerPanel(container, index, removable) {
  return panel(
    {},
    heading(
      `Container ${index + 1} `,
      h("span", { class: "load", "data-cload": index }, h("b", {}, "0"), " / 0 lb"),
      removable ? h("button", { class: "rm cont-rm", type: "button", "data-rmcont": index, "aria-label": `Remove container ${index + 1}` }, "×") : null,
    ),
    h(
      "div",
      { class: "cont-head" },
      containerField(index, "name", "Name", {}, true),
      containerField(index, "type", "Type", {}, true),
      containerField(index, "empty", "Empty lb", { inputmode: "decimal" }),
      containerField(index, "cap", "Capacity", { inputmode: "numeric" }),
      containerField(index, "ap", "AP", { inputmode: "numeric" }),
    ),
    h("table", {}, itemHead(), h("tbody", {}, container.items.map((_, i) => itemRow(`c${index}`, i)))),
    addRow(`c${index}`, "+ add item"),
  );
}

export function containerPanels(sheet) {
  return [
    ...sheet.containers.map((container, i) => containerPanel(container, i, sheet.containers.length > 1)),
    h("button", { class: "addrow standalone", type: "button", "data-add": "container" }, "+ add container"),
  ];
}

const supplyRow = (name, ...cells) => h("div", { class: "sup" }, h("span", { class: "nm" }, name), ...cells);
const supplyInput = (key, mode, label) => h("input", { "data-sup": key, inputmode: mode, "aria-label": label });

// Each mark on the bar is where that tier starts.
const tierName = (index) => ENCUMBRANCE.tiers[index].name.toLowerCase();

function encumbrancePanel() {
  const tick = (id, label, valueId) => h("span", { id }, label, h("b", { id: valueId }, "0"));
  const split = (label, id) => h("div", {}, h("div", { class: "lbl" }, label), h("div", { class: "val", id }, "0"));
  return panel(
    { class: "enc-panel" },
    heading("Encumbrance ", note("thresholds from Lethality", { id: "encNote" })),
    h(
      "div",
      { class: "enc" },
      h(
        "div",
        { class: "enc-now" },
        h("span", { class: "big", id: "enc_w" }, "0"),
        h("span", { class: "unit" }, "lbs carried"),
        h("span", { class: "tier" }, h("span", { class: "t t0", id: "enc_tier" }, "Unburdened"), h("br"), h("span", { class: "pn", id: "enc_pen" }, "no penalty")),
      ),
      h("div", { class: "enc-bar" }, h("div", { class: "enc-fill", id: "enc_fill" }), h("i", { id: "enc_m1" }), h("i", { id: "enc_m2" }), h("i", { id: "enc_m3" })),
      h(
        "div",
        { class: "enc-ticks" },
        tick("lab_l", tierName(1), "enc_l"),
        tick("lab_m", tierName(2), "enc_m"),
        tick("lab_s", tierName(3), "enc_s"),
        tick("lab_c", tierName(4), "enc_c"),
      ),
      h("div", { class: "enc-split" }, split("Worn", "enc_worn"), split("Packs", "enc_packs"), split("Supplies", "enc_sup"), split("Max lift", "enc_lift")),
    ),
  );
}

function suppliesPanel() {
  return panel(
    {},
    heading("Supplies"),
    h("div", { class: "sup-head" }, h("span", {}, "Item"), h("span", {}, "Qty"), h("span", {}, "Unit lb"), h("span", {}, "Weight")),
    supplyRow("Rations", supplyInput("rations", "numeric", "Rations quantity"), h("span", { class: "fixedw" }, RATION_LB.toFixed(1)), h("span", { class: "wt", id: "w_rations" }, "0")),
    supplyRow("Medical supplies", supplyInput("medQ", "numeric", "Medical supplies quantity"), supplyInput("medW", "decimal", "Medical supplies unit weight"), h("span", { class: "wt", id: "w_med" }, "0")),
    supplyRow("Components and scrap", supplyInput("cmpQ", "numeric", "Components quantity"), supplyInput("cmpW", "decimal", "Components unit weight"), h("span", { class: "wt", id: "w_cmp" }, "0")),
    supplyRow("Ammunition", supplyInput("ammoQ", "numeric", "Ammunition quantity"), supplyInput("ammoW", "decimal", "Ammunition unit weight"), h("span", { class: "wt", id: "w_ammo" }, "0")),
    h("div", { class: "sup-tv" }, h("span", { class: "nm" }, "Trade Value"), supplyInput("tv", "numeric", "Trade value")),
  );
}

export function buildEquipmentPage(sheet) {
  return tabPanel(
    "page2",
    "tab2",
    h("div", { class: "grid side" }, encumbrancePanel(), suppliesPanel()),
    panel(
      {},
      heading("Worn and In Hand ", note("armor, shield, and weapons carry over from Core")),
      h("table", {}, itemHead(), h("tbody", { id: "wornRows" }, wornRows(sheet))),
      addRow("worn", "+ add worn item"),
    ),
    h("div", { id: "containers" }, containerPanels(sheet)),
  );
}
