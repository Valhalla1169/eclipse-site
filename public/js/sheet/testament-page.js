// Page 3, Testament: who the character is, their people and their story.
import { h } from "../dom.js";
import { ADV_TIERS, FLAW_TIERS } from "../eclipse-rules.js";
import { addRow, headRow, heading, note, panel, removeButton, tabPanel } from "./ui.js";

// The editable lists on this page. `cols` says what each column holds:
// f is the field, sel a fixed set of choices, tx a growing text area.
export const LISTS = {
  adv: { body: "advRows", label: "advantage", cols: [{ f: "n" }, { f: "t", sel: ADV_TIERS }, { f: "e", ph: "what it does", tx: true }] },
  flaw: { body: "flawRows", label: "flaw", cols: [{ f: "n" }, { f: "t", sel: FLAW_TIERS }, { f: "e", ph: "how it bites", tx: true }] },
  lang: { body: "langRows", label: "language", cols: [{ f: "n" }, { f: "e", ph: "family, school, a year in a border town", tx: true }] },
  people: {
    body: "peopleRows",
    label: "person",
    cols: [{ f: "n" }, { f: "r", ph: "mentor, sister, the man you left" }, { f: "e", ph: "alive? where? owed what?", tx: true }],
  },
};

export function listRows(sheet, key) {
  const { cols, label } = LISTS[key];
  return sheet[key].map((_, i) =>
    h(
      "tr",
      {},
      cols.map((col) => {
        const path = `${key}.${i}.${col.f}`;
        const aria = { "aria-label": `${label} ${i + 1} ${col.f}` };
        if (col.sel) return h("td", {}, h("select", { class: "tier", "data-lt": path, ...aria }, h("option", { value: "" }), ...col.sel.map((option) => h("option", {}, option))));
        if (col.tx) return h("td", {}, h("textarea", { "data-lt": path, placeholder: col.ph, ...aria }));
        return h("td", {}, h("input", { class: "iname", "data-lt": path, placeholder: col.ph, ...aria }));
      }),
      h("td", { class: "c" }, removeButton({ "data-rml": `${key}.${i}` })),
    ),
  );
}

const textId = (path) => `tx_${path.replace(/\W/g, "_")}`;

// A labelled growing text area stored at `path` (for example "prof.kit").
function prose(label, hint, path, placeholder, className) {
  return h(
    "div",
    { class: "prose" },
    h("label", { for: textId(path) }, label, hint ? h("span", { class: "hint" }, hint) : null),
    h("textarea", { id: textId(path), class: className || null, "data-tx": path, placeholder }),
  );
}

const carried = (label, id) => h("div", { class: "prose carried" }, h("label", {}, label), h("span", { class: "carry", id }));

function vitalField(field, label, placeholder) {
  const id = `vi_${field}`;
  return h("div", { class: "idf" }, h("label", { for: id }, label), h("input", { id, "data-vi": field, placeholder }));
}

function listPanel(sheet, key, title, noteText, columns, addLabel) {
  return panel(
    {},
    heading(title, noteText ? note(noteText) : null),
    h("table", {}, headRow(...columns, ["", "w2"]), h("tbody", { id: LISTS[key].body }, listRows(sheet, key))),
    addRow(key, addLabel),
  );
}

export function buildTestamentPage(sheet) {
  return tabPanel(
    "page3",
    "tab3",
    panel(
      {},
      heading("Who You Are"),
      h(
        "div",
        { class: "origin" },
        h("div", { class: "org-carry" }, h("label", {}, "Race"), h("span", { class: "carry", id: "c_race" }), h("span", { class: "org-abil", id: "c_racial" })),
        h(
          "div",
          { class: "org-field" },
          h("label", { for: "vi_visual" }, "Visual description", h("span", { class: "hint" }, "build, colouring, marks, scars")),
          h("input", { id: "vi_visual", "data-vi": "visual", placeholder: "Wiry, grey at the temples, a rift burn along the jaw" }),
        ),
      ),
      h("div", { class: "vitals" }, vitalField("age", "Age", "35"), vitalField("height", "Height", "5'6\""), vitalField("weight", "Weight", "140 lb")),
    ),
    h(
      "div",
      { class: "pair match gap-top" },
      panel(
        {},
        heading("Profession"),
        carried("Profession", "c_prof"),
        carried("Master skill", "c_master"),
        prose("Starting kit item", "the gear you kept", "prof.kit", "Full medical kit, 40 TV"),
        prose("Professional knowledge", "what you simply know, no roll", "prof.knowledge", "Triage priority. Drug interactions. Which wounds are survivable.", "tall"),
        prose("Contact", "one person from that life", "prof.contact", "Name, relationship, last known status", "mid"),
      ),
      panel(
        {},
        heading("Background"),
        carried("Background", "c_bg"),
        prose("Starting gear", "free, outside the 150 TV budget", "bg.gear", "What you held onto"),
        prose("Mechanical benefit", "", "bg.benefit", "e.g. Survival and Navigation at -1 difficulty underground"),
        prose("Who you know", "or who knows you", "bg.connection", "The people your survival tied you to"),
      ),
    ),
    h(
      "div",
      { class: "pair" },
      listPanel(sheet, "adv", "Advantages ", "max 3 at creation", [["Advantage", "w34"], ["Tier", "w24"], ["Effect", "w40"]], "+ add advantage"),
      listPanel(sheet, "flaw", "Flaws ", "max 2 at creation, cannot be removed", [["Flaw", "w34"], ["Severity", "w24"], ["Effect", "w40"]], "+ add flaw"),
    ),
    h(
      "div",
      { class: "pair" },
      listPanel(sheet, "lang", "Languages ", "1 skill point each", [["Language", "w40"], ["Where you learned it", "w58"]], "+ add language"),
      listPanel(sheet, "people", "People", "", [["Name", "w30"], ["To you", "w30"], ["Last known", "w38"]], "+ add person"),
    ),
    panel(
      { class: "flush-top" },
      heading("Personality"),
      h(
        "div",
        { class: "pair tight" },
        h(
          "div",
          {},
          prose("Traits", "how you read to strangers", "persona.traits", "Blunt. Patient with the wounded, short with everyone else."),
          prose("Drives", "what keeps you walking", "persona.drives", "What do you want badly enough to risk dying for?"),
        ),
        h(
          "div",
          { class: "divided" },
          prose("Fears", "what you will not do", "persona.fears", "The line you refuse to cross, and the one you already did"),
          prose("Mannerisms and voice", "", "persona.manner", "Habits, tells, the phrase you always use"),
        ),
      ),
    ),
    panel(
      {},
      heading("Testament"),
      ...[
        ["Before", "the life the Eclipse took", "story.before", "Who were you on a Tuesday afternoon, when the world still made sense?"],
        ["The first year", "how you survived it, and what it cost", "story.eclipse", "What happened when the rifts opened. What you lost. What you did to still be here."],
        ["Now", "why you travel with these people", "story.now", "What you are working toward, and what you are running from."],
        ["Loose threads", "hooks for the Keeper", "story.threads", "Unfinished business the GM can pull on."],
      ].map(([label, hint, path, placeholder]) => {
        const block = prose(label, hint, path, placeholder);
        block.classList.add("storyblock");
        return block;
      }),
    ),
  );
}
