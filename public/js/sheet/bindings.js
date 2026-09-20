// Turns typing and clicking on the sheet into changes to the sheet's inputs.
// The sheet object is only ever changed here (and by eclipse-rules.js mutations).
import { h } from "../dom.js";
import { ATTR_NAMES, PROFS, chooseProfession, chooseRace, int, intOrBlank, setCondition, setOverflow, toggleBox } from "../eclipse-rules.js";
import { LISTS } from "./testament-page.js";
import { REFERENCE } from "./reference-data.js";
import { fillIdentity, growTextarea, renderSheet } from "./render.js";
import { filterLog, rebuildCasting, rebuildContainers, rebuildList, rebuildLog, rebuildWorn } from "./rebuild.js";

const IDENTITY_FIELDS = { f_name: "name", f_race: "race", f_prof: "prof", f_master: "master", f_bg: "bg", f_grit: "grit" };
const ARMOR_FIELDS = { a_name: "name", a_b: "b", a_i: "i", a_ap: "ap", a_dp: "dp", a_soaked: "soaked" };
const SHIELD_FIELDS = { sh_name: "name", sh_b: "b", sh_i: "i", sh_ap: "ap", sh_soaked: "soaked" };

const value = (el) => (el.type === "checkbox" ? el.checked : el.value);
const intField = (text) => (text === "" ? 0 : int(text));

function intoRow(list, index, field, text) {
  if (!list[int(index)]) list[int(index)] = {};
  list[int(index)][field] = text;
}

// One entry per data-* attribute an input can carry. `write` puts the value in the
// sheet. `after` says what to redraw: "render" every number, "log" the log filter,
// or nothing more than saving. `grow` resizes a text area to its text.
function fieldTable(sheet) {
  const listFor = (scope) => (scope === "we" ? sheet().wornExtra : sheet().containers[int(scope.slice(1))].items);
  return {
    base: { after: "render", write: (k, el) => (sheet().base[k] = intField(el.value)) },
    oth: { after: "render", write: (k, el) => (sheet().oth[k] = intField(el.value)) },
    sk: { after: "render", write: (k, el) => (sheet().skills[k] = el.value === "" ? "" : int(el.value)) },
    so: { after: "render", write: (k, el) => (sheet().sother[k] = intOrBlank(el.value)) },
    sup: { after: "render", write: (k, el) => (sheet().sup[k] = el.value) },
    ww: { after: "render", write: (k, el) => (sheet().wornW[k] = el.value) },
    wx: {
      after: "render",
      write: (k, el) => {
        const [key, field] = k.split(".");
        if (!sheet().wornX[key]) sheet().wornX[key] = {};
        sheet().wornX[key][field] = el.value;
      },
    },
    cast: { after: "render", write: (k, el) => (sheet().cast[k] = value(el)) },
    dy: { after: "render", write: (k, el) => (sheet().dy[k] = value(el)) },
    vi: { write: (k, el) => (sheet().vitals[k] = el.value) },
    note: { write: (k, el) => (sheet().notes[k] = el.value) },
    mn: { write: (k, el) => (sheet().mods[int(k)].n = el.value) },
    mv: { after: "render", write: (k, el) => (sheet().mods[int(k)].v = intOrBlank(el.value)) },
    smn: { write: (k, el) => (sheet().soakMods[int(k)].n = el.value) },
    smb: { after: "render", write: (k, el) => (sheet().soakMods[int(k)].b = intOrBlank(el.value)) },
    smi: { after: "render", write: (k, el) => (sheet().soakMods[int(k)].i = intOrBlank(el.value)) },
    smp: { after: "render", write: (k, el) => (sheet().soakMods[int(k)].p = intOrBlank(el.value)) },
    tx: {
      grow: true,
      write: (k, el) => {
        const [group, field] = k.split(".");
        sheet()[group][field] = el.value;
      },
    },
    lg: {
      after: "log",
      grow: true,
      write: (k, el) => {
        const [index, field] = k.split(".");
        intoRow(sheet().log, index, field, el.value);
      },
    },
    lt: {
      grow: true,
      write: (k, el) => {
        const [key, index, field] = k.split(".");
        intoRow(sheet()[key], index, field, el.value);
      },
    },
    cl: {
      after: "render",
      grow: true,
      write: (k, el) => {
        const [kind, index, field] = k.split(".");
        intoRow(sheet()[kind], index, field, el.value);
      },
    },
    it: {
      after: "render",
      write: (k, el) => {
        const [scope, index, field] = k.split(".");
        intoRow(listFor(scope), index, field, el.value);
      },
    },
    w: {
      after: "render",
      write: (k, el) => {
        const [row, field] = k.split(".");
        intoRow(sheet().weapons, row, field, el.value);
      },
    },
    sc: {
      write: (k, el) => {
        const [which, index] = k.split(".");
        (which === "v" ? sheet().vSchools : sheet().pSchools)[int(index)] = el.value;
      },
    },
    ct: {
      after: "render",
      write: (k, el) => {
        const [index, field] = k.split(".");
        sheet().containers[int(index)][field] = el.value;
      },
    },
  };
}

// ctx: { root, sheet() returns the current sheet, edited() tells the caller to save }
export function bindSheet(ctx) {
  const { root, sheet, edited } = ctx;
  const fields = fieldTable(sheet);
  const $ = (selector) => root.querySelector(selector);

  const redraw = () => {
    fillIdentity(root, sheet());
    renderSheet(root, sheet());
  };
  const commit = () => {
    redraw();
    edited();
  };

  /* ── profession combobox ─────────────────────────────── */
  const profInput = $("#f_prof");
  const profList = $("#profList");
  let profOpen = false;
  let profMark = -1;

  function paintProfessions() {
    const query = profInput.value.trim().toLowerCase();
    const hits = Object.keys(PROFS).filter((name) => !query || name.toLowerCase().includes(query));
    if (!hits.length) {
      profList.replaceChildren(h("p", { class: "none" }, "No match. Whatever you type is kept as a custom profession."));
      profMark = -1;
      return;
    }
    profList.replaceChildren(
      ...hits.map((name, i) =>
        h("button", { type: "button", role: "option", "data-pick": name, class: i === profMark ? "on" : null }, name, h("small", {}, `+1 ${ATTR_NAMES[PROFS[name].a]} · ${PROFS[name].m} +2`)),
      ),
    );
  }
  const showProfessions = () => {
    profOpen = true;
    profList.classList.add("show");
    profInput.setAttribute("aria-expanded", "true");
    paintProfessions();
  };
  const hideProfessions = () => {
    profOpen = false;
    profMark = -1;
    profList.classList.remove("show");
    profInput.setAttribute("aria-expanded", "false");
  };
  function pickProfession(name) {
    profInput.value = name;
    chooseProfession(sheet(), name);
    hideProfessions();
    commit();
  }

  profInput.addEventListener("focus", showProfessions);
  profInput.addEventListener("click", showProfessions);
  $("#profCaret").addEventListener("click", () => {
    if (profOpen) hideProfessions();
    else {
      profInput.focus();
      showProfessions();
    }
  });
  profList.addEventListener("mousedown", (event) => {
    const pick = event.target.closest("[data-pick]");
    if (pick) {
      event.preventDefault();
      pickProfession(pick.dataset.pick);
    }
  });
  profInput.addEventListener("keydown", (event) => {
    const options = [...profList.querySelectorAll("[data-pick]")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!profOpen) return showProfessions();
      profMark += event.key === "ArrowDown" ? 1 : -1;
      if (profMark < 0) profMark = options.length - 1;
      if (profMark >= options.length) profMark = 0;
      paintProfessions();
      profList.querySelector(".on")?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter") {
      if (profOpen && profMark >= 0 && options[profMark]) {
        event.preventDefault();
        pickProfession(options[profMark].dataset.pick);
      } else hideProfessions();
    } else if (event.key === "Escape") hideProfessions();
  });
  profInput.addEventListener("blur", () => setTimeout(hideProfessions, 120));
  root.addEventListener("click", (event) => {
    if (profOpen && !event.target.closest(".combo")) hideProfessions();
  });

  /* ── identity, armor and shield ──────────────────────── */
  const identityChange = (event) => {
    const key = IDENTITY_FIELDS[event.target.id];
    if (!key) return false;
    const text = event.target.value;
    if (key === "race") chooseRace(sheet(), text);
    else if (key === "prof") {
      chooseProfession(sheet(), text);
      if (profOpen) paintProfessions();
    } else sheet().id[key] = text;
    commit();
    return true;
  };
  const gearChange = (event) => {
    const armor = ARMOR_FIELDS[event.target.id];
    const shield = SHIELD_FIELDS[event.target.id];
    if (!armor && !shield) return false;
    (armor ? sheet().armor : sheet().shield)[armor || shield] = event.target.value;
    commit();
    return true;
  };

  /* ── every data-* input ───────────────────────────────── */
  function writeField(el) {
    for (const [key, config] of Object.entries(fields)) {
      const raw = el.dataset[key];
      if (raw === undefined || raw === "") continue;
      config.write(raw, el);
      if (config.grow && el.tagName === "TEXTAREA") growTextarea(el);
      if (config.after === "render") redraw();
      else if (config.after === "log") filterLog(root, sheet());
      edited();
      return true;
    }
    return false;
  }

  root.addEventListener("input", (event) => {
    if (event.target.matches("#logSearch, #refSearch")) return;
    if (identityChange(event) || gearChange(event)) return;
    if (event.target.id === "applyPen" || event.target.id === "useShieldSoak") return;
    writeField(event.target);
  });
  // Selects and checkboxes fire change; text boxes already fired input.
  root.addEventListener("change", (event) => {
    const el = event.target;
    if (el.id === "applyPen") {
      sheet().applyPen = el.checked;
      return commit();
    }
    if (el.id === "useShieldSoak") {
      sheet().useShieldSoak = el.checked;
      return commit();
    }
    if (el.tagName === "SELECT" || el.type === "checkbox") {
      if (identityChange(event)) return;
      writeField(el);
    }
  });

  /* ── boxes, dots and days ─────────────────────────────── */
  const CLICKS = [
    ["[data-t]", (el) => setCondition(sheet(), el.dataset.t, int(el.dataset.i) + 1)],
    ["[data-san]", (el) => (sheet().sanity = toggleBox(sheet().sanity, int(el.dataset.san) + 1))],
    ["[data-dysucc]", (el) => (sheet().dy.succ = toggleBox(sheet().dy.succ, int(el.dataset.dysucc) + 1))],
    ["[data-dyover]", (el) => setOverflow(sheet(), int(el.dataset.dyover) + 1)],
    ["[data-mor]", (el) => (sheet().morality = toggleBox(sheet().morality, int(el.dataset.mor) + 1))],
    ["[data-d]", (el) => (sheet().starve = toggleBox(sheet().starve, int(el.dataset.d) + 1))],
  ];

  /* ── adding and removing rows ─────────────────────────── */
  function addRowTo(target) {
    const s = sheet();
    if (target === "worn") {
      s.wornExtra.push({});
      rebuildWorn(root, s);
    } else if (target === "container") {
      s.containers.push({ name: "", type: "", empty: "", cap: "", ap: "", items: [{}, {}, {}] });
      rebuildContainers(root, s);
    } else if (["spells", "powers", "rituals"].includes(target)) {
      s[target].push({});
      rebuildCasting(root, s);
    } else if (LISTS[target]) {
      s[target].push({});
      rebuildList(root, s, target);
    } else {
      s.containers[int(target.slice(1))].items.push({});
      rebuildContainers(root, s);
    }
  }

  // Removing a row keeps at least one blank row, so there is always somewhere to type.
  const removeFrom = (list, index, fresh = {}) => {
    list.splice(int(index), 1);
    if (!list.length) list.push(fresh);
  };

  const REMOVALS = [
    ["[data-rmcont]", (el) => {
      if (sheet().containers.length <= 1) return false;
      sheet().containers.splice(int(el.dataset.rmcont), 1);
      rebuildContainers(root, sheet());
    }],
    ["[data-rmlog]", (el) => {
      removeFrom(sheet().log, el.dataset.rmlog, { t: "", d: "", b: "" });
      rebuildLog(root, sheet());
    }],
    ["[data-rmc]", (el) => {
      const [kind, index] = el.dataset.rmc.split(".");
      removeFrom(sheet()[kind], index);
      rebuildCasting(root, sheet());
    }],
    ["[data-rml]", (el) => {
      const [key, index] = el.dataset.rml.split(".");
      removeFrom(sheet()[key], index);
      rebuildList(root, sheet(), key);
    }],
    ["[data-rm]", (el) => {
      const [scope, index] = el.dataset.rm.split(".");
      if (scope === "we") {
        removeFrom(sheet().wornExtra, index);
        rebuildWorn(root, sheet());
      } else {
        removeFrom(sheet().containers[int(scope.slice(1))].items, index);
        rebuildContainers(root, sheet());
      }
    }],
  ];

  root.addEventListener("click", (event) => {
    for (const [selector, apply] of CLICKS) {
      const el = event.target.closest(selector);
      if (el) {
        apply(el);
        return commit();
      }
    }
    const add = event.target.closest("[data-add]");
    if (add) {
      addRowTo(add.dataset.add);
      return commit();
    }
    for (const [selector, apply] of REMOVALS) {
      const el = event.target.closest(selector);
      if (el) {
        if (apply(el) !== false) commit();
        return;
      }
    }
  });

  $("#logAdd").addEventListener("click", () => {
    const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    sheet().log.unshift({ t: "", d: today, b: "" });
    rebuildLog(root, sheet());
    edited();
    $('[data-lg="0.t"]')?.focus();
  });
  $("#logSearch").addEventListener("input", () => filterLog(root, sheet()));

  /* ── reference search ─────────────────────────────────── */
  let category = "All";
  const filterReference = () => {
    const query = $("#refSearch").value.trim().toLowerCase();
    let shown = 0;
    REFERENCE.forEach((card, i) => {
      const el = $(`[data-ref="${i}"]`);
      const words = `${card.t} ${card.c} ${card.k} ${card.html.replace(/<[^>]+>/g, " ")}`.toLowerCase();
      const show = (category === "All" || card.c === category) && (!query || query.split(/\s+/).every((word) => words.includes(word)));
      el.classList.toggle("hide", !show);
      if (show) shown += 1;
    });
    $("#refCount").textContent = `${shown} of ${REFERENCE.length}`;
    $("#refEmpty").classList.toggle("hide", shown > 0);
  };
  $("#refSearch").addEventListener("input", filterReference);
  $("#refChips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-cat]");
    if (!chip) return;
    category = chip.dataset.cat;
    root.querySelectorAll("[data-cat]").forEach((el) => el.setAttribute("aria-pressed", String(el === chip)));
    filterReference();
  });
  filterReference();

  return { redraw, filterLog: () => filterLog(root, sheet()) };
}
