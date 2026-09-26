// Draws the numbers on the sheet from the sheet's inputs. Nothing here changes the
// sheet: it reads inputs, asks eclipse-rules.js for the results and shows them.
import { h } from "../dom.js";
import {
  ATTRS,
  CASTING,
  DIFFICULTY,
  DYING,
  MASTER_BONUS,
  MONITOR_BOXES,
  MORALITY,
  RECOVERY,
  RITUAL,
  SANITY,
  SKILLS,
  SPECIALS,
  STARVATION,
  TRACK_MAX,
  UNTRAINED_STAGES,
} from "../eclipse-content.js";
import {
  NO_RACIAL_ABILITY,
  armorDegradation,
  castingPool,
  clampTrack,
  criticalMonitor,
  derivedStats,
  dyingState,
  encPenalty,
  encTiers,
  contentWeight,
  carriedQuantity,
  int,
  num,
  penalties,
  psyAP,
  r1,
  racial,
  profBonus,
  raceOf,
  ritualCost,
  shieldDegradation,
  skillPool,
  soak,
  total,
  veilAP,
  weaponPool,
  weights,
} from "../eclipse-rules.js";
import { CORONA_TICKS } from "./core-page.js";

const signed = (v) => (v > 0 ? `−${v}` : v < 0 ? `+${Math.abs(v)}` : "0");
const plusMinus = (v) => (v > 0 ? `+${v}` : `${v}`);

export function growTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}
export const growAll = (root) => root.querySelectorAll("textarea").forEach(growTextarea);

const listOf = (sheet, scope) => (scope === "we" ? sheet.wornExtra : sheet.containers[int(scope.slice(1))]?.items || []);

// Puts stored values into the inputs, except the one being typed in.
export function fillInputs(root, sheet) {
  const active = document.activeElement;
  const set = (el, value, grow = false) => {
    if (el === active) return;
    el.value = value ?? "";
    if (grow && el.tagName === "TEXTAREA") growTextarea(el);
  };
  const each = (attr, fn) =>
    root.querySelectorAll(`[data-${attr}]`).forEach((el) => {
      const raw = el.dataset[attr];
      if (raw !== undefined) fn(el, raw);
    });

  each("it", (el, key) => {
    const [scope, index, field] = key.split(".");
    set(el, (listOf(sheet, scope)[int(index)] || {})[field]);
  });
  each("ww", (el, key) => set(el, sheet.wornW[key]));
  each("wx", (el, key) => {
    const [k, field] = key.split(".");
    set(el, (sheet.wornX[k] || {})[field]);
  });
  each("ct", (el, key) => {
    const [index, field] = key.split(".");
    set(el, sheet.containers[int(index)]?.[field]);
  });
  each("sup", (el, key) => set(el, sheet.sup[key]));
  each("vi", (el, key) => set(el, sheet.vitals[key]));
  each("tx", (el, key) => {
    const [group, field] = key.split(".");
    set(el, sheet[group]?.[field], true);
  });
  each("cast", (el, key) => {
    if (el.type === "checkbox") el.checked = !!sheet.cast[key];
    else set(el, sheet.cast[key]);
  });
  each("cl", (el, key) => {
    const [kind, index, field] = key.split(".");
    set(el, (sheet[kind][int(index)] || {})[field], true);
  });
  each("lt", (el, key) => {
    const [group, index, field] = key.split(".");
    set(el, (sheet[group][int(index)] || {})[field], true);
  });
  each("lg", (el, key) => {
    const [index, field] = key.split(".");
    set(el, (sheet.log[int(index)] || {})[field], true);
  });
  each("w", (el, key) => {
    const [row, field] = key.split(".");
    const stored = (sheet.weapons[int(row)] || {})[field];
    set(el, stored ?? (el.tagName === "SELECT" ? el.options[0].value : ""));
  });
  const aided = root.querySelector('[data-dy="aided"]');
  if (aided) aided.checked = !!sheet.dy.aided;
}

export function fillIdentity(root, sheet) {
  const active = document.activeElement;
  const fields = { f_name: sheet.id.name, f_race: sheet.id.race, f_prof: sheet.id.prof, f_bg: sheet.id.bg, f_grit: sheet.id.grit, f_master: sheet.id.master };
  for (const [id, value] of Object.entries(fields)) {
    const el = root.querySelector(`#${id}`);
    if (el !== active) el.value = value || (id === "f_race" ? "human" : "");
  }
  for (const f of ["name", "b", "i", "ap", "dp", "soaked"]) {
    const el = root.querySelector(`#a_${f}`);
    if (el && el !== active) el.value = sheet.armor[f] ?? "";
  }
  for (const f of ["name", "b", "i", "ap", "soaked"]) {
    const el = root.querySelector(`#sh_${f}`);
    if (el && el !== active) el.value = sheet.shield[f] ?? "";
  }
}

export function renderSheet(root, sheet) {
  const $ = (id) => root.querySelector(`#${id}`);
  const text = (id, value) => {
    $(id).textContent = value;
  };
  const active = document.activeElement;
  const P = penalties(sheet);
  const derived = derivedStats(sheet);

  root.querySelector("#f_race").title = raceOf(sheet).abil;

  // attributes
  for (const attr of [...ATTRS, ...SPECIALS]) {
    const base = root.querySelector(`[data-base="${attr.k}"]`);
    if (base !== active) base.value = sheet.base[attr.k];
    const race = racial(sheet, attr.k);
    const profession = profBonus(sheet, attr.k);
    const mod = race + profession;
    const modEl = root.querySelector(`[data-mod="${attr.k}"]`);
    modEl.textContent = mod ? plusMinus(mod) : "·";
    modEl.title = mod ? [race ? `${plusMinus(race)} race` : "", profession ? `${plusMinus(profession)} profession` : ""].filter(Boolean).join(", ") : "";
    modEl.classList.toggle("prof", !!profession && !race);
    const other = root.querySelector(`[data-oth="${attr.k}"]`);
    if (other !== active) other.value = sheet.oth[attr.k] || "";
    root.querySelector(`[data-tot="${attr.k}"]`).textContent = total(sheet, attr.k);
  }

  // derived
  text("d_ap", derived.ap);
  text("d_init", `+${derived.initiative}`);
  text("d_pperc", derived.passivePerception);
  text("d_dodge", derived.dodgePool);
  text("d_psoak", derived.personalSoak);
  text("d_over", derived.overflow);
  text("d_mp", derived.magicPoints);
  text("d_pp", derived.psionicPoints);

  renderSkills(root, sheet, P, active);
  renderMonitors(root, sheet, P);
  renderStarvation(root, sheet, P);
  renderTracks(root, sheet);
  renderDying(root, sheet, P);
  renderDial(root, sheet, P);

  // modifier rows
  sheet.mods.forEach((mod, i) => {
    const name = root.querySelector(`[data-mn="${i}"]`);
    const value = root.querySelector(`[data-mv="${i}"]`);
    if (name && name !== active) name.value = mod.n ?? "";
    if (value && value !== active) value.value = mod.v ?? "";
  });
  sheet.soakMods.forEach((mod, i) => {
    for (const [attr, field] of [["smn", "n"], ["smb", "b"], ["smi", "i"], ["smp", "p"]]) {
      const el = root.querySelector(`[data-${attr}="${i}"]`);
      if (el && el !== active) el.value = mod[field] ?? "";
    }
  });
  text("modTotal", signed(P.o));
  $("applyPen").checked = sheet.applyPen;
  $("useShieldSoak").checked = !!sheet.useShieldSoak;
  for (const [id, key] of [["bd_s", "s"], ["bd_t", "t"], ["bd_r", "r"], ["bd_v", "v"], ["bd_e", "e"], ["bd_o", "o"]]) text(id, signed(P[key]));

  // weapons
  sheet.weapons.forEach((weapon, i) => {
    const pool = weaponPool(sheet, weapon, P.total);
    const el = root.querySelector(`[data-wpool="${i}"]`);
    if (!el) return;
    el.textContent = pool === null ? "·" : pool;
    el.classList.toggle("dim", pool === null);
  });

  renderEquipment(root, sheet);
  renderTestament(root, sheet);
  renderCasting(root, sheet, P);
  renderDefense(root, sheet);
}

function renderSkills(root, sheet, P, active) {
  for (const [, attrKey, list] of SKILLS) {
    const cap = root.querySelector(`[data-cap="${attrKey}"]`);
    if (!cap) continue;
    const hasMaster = list.includes(sheet.id.master);
    cap.textContent = `max ${total(sheet, attrKey)}${hasMaster ? ", master exempt" : ""}`;
    cap.classList.toggle("exempt", hasMaster);
  }
  root.querySelectorAll(".srow").forEach((row) => {
    const name = row.dataset.skill;
    const attrKey = row.dataset.attr;
    const level = row.querySelector("[data-sk]");
    const other = row.querySelector("[data-so]");
    const out = row.querySelector(".pool");
    const label = row.querySelector("label");
    const master = sheet.id.master === name;
    const pool = skillPool(sheet, name, P.total);
    if (level !== active) level.value = sheet.skills[name] ?? "";
    if (other !== active) other.value = sheet.sother[name] ?? "";

    // A Master Skill is exempt from the linked attribute cap.
    level.classList.toggle("over", !master && pool.level > total(sheet, attrKey));
    row.classList.toggle("trained", pool.rating > 0);
    row.classList.toggle("master", master);
    const badge = label.querySelector(".mbadge");
    if (master && !badge) label.append(h("span", { class: "mbadge" }, `+${MASTER_BONUS}`));
    if (!master && badge) badge.remove();

    out.classList.toggle("ut", pool.rating === 0);
    out.classList.toggle("zero", pool.raw <= 0 && pool.rating > 0);
    out.textContent = pool.shown;
    out.title =
      `${pool.base} attribute + ${pool.level} level` +
      (master ? ` + ${MASTER_BONUS} master` : "") +
      (pool.extra ? (pool.extra < 0 ? ` − ${Math.abs(pool.extra)} other` : ` + ${pool.extra} other`) : "") +
      (pool.penalty ? ` − ${pool.penalty} penalty` : "") +
      (pool.rating === 0 ? ` (untrained: +${UNTRAINED_STAGES} difficulty stages)` : "") +
      (master ? " · exempt from the attribute cap" : "");
  });
}

function renderMonitors(root, sheet, P) {
  const penaltyOf = { shock: P.s, trauma: P.t, rot: P.r };
  for (const track of ["shock", "trauma", "rot"]) {
    const threshold = P.thr[track];
    root.querySelector(`#thr_${track}`).textContent = threshold;
    // Boxes stop at ten, so say the number out loud once it goes beyond.
    const over = sheet.cm[track] - MONITOR_BOXES;
    const nameEl = root.querySelector(`.cm-${track} .cm-name`);
    const tag = nameEl.querySelector(".overtag");
    if (over > 0) {
      if (tag) tag.textContent = ` ${sheet.cm[track]}`;
      else nameEl.append(h("span", { class: "overtag" }, ` ${sheet.cm[track]}`));
    } else if (tag) tag.remove();
    root.querySelector(`#pen_${track}`).textContent = `−${penaltyOf[track]}`;
    root.querySelectorAll(`[data-t="${track}"]`).forEach((box, i) => {
      box.classList.toggle("on", i < sheet.cm[track]);
      box.classList.toggle("thr", (i + 1) % threshold === 0);
      box.setAttribute("aria-pressed", String(i < sheet.cm[track]));
    });
  }
  root.querySelectorAll("[data-note]").forEach((el) => {
    if (el !== document.activeElement) el.value = sheet.notes[el.dataset.note] || "";
  });
}

function renderStarvation(root, sheet, P) {
  root.querySelectorAll("[data-d]").forEach((box, i) => {
    box.classList.toggle("on", i < sheet.starve);
    box.setAttribute("aria-pressed", String(i < sheet.starve));
  });
  root.querySelector("#stv_n").textContent = sheet.starve;
  root.querySelector("#stv_pen").textContent = P.dead ? "death" : P.v ? `−${P.v}` : "0";
  root.querySelector("#stv_foot").classList.toggle("fatal", P.dead);
  root.querySelector("#starvePanel").classList.toggle("fatal", P.dead);
  root.querySelector("#stv_foot").firstElementChild.textContent = P.dead
    ? `${STARVATION.deathDay} days without food or water. This character has died of starvation.`
    : "Eating a ration reduces the counter by one; it does not reset to zero.";
}

// Sanity and Morality: filled dots, and the level's name and number in words.
function renderTracks(root, sheet) {
  const mark = (attr, value) =>
    root.querySelectorAll(`[${attr}]`).forEach((dot, i) => {
      dot.classList.toggle("on", i < value);
      dot.classList.toggle("now", i === value - 1);
      dot.setAttribute("aria-pressed", String(i < value));
    });
  const morality = clampTrack(sheet.morality);
  mark("data-mor", morality);
  const morState = root.querySelector("#mor_state");
  morState.textContent = morality ? `${MORALITY[morality - 1].t} · ${morality}/${TRACK_MAX}` : "Unrecorded";
  morState.title = morality ? MORALITY[morality - 1].l : "Set a mark to begin tracking.";

  const sanity = clampTrack(sheet.sanity);
  mark("data-san", sanity);
  root.querySelector("#san_state").textContent = sanity === 0 ? "lost, now an NPC" : `${SANITY[sanity - 1].t} · ${sanity}/${TRACK_MAX}`;
}

function renderDying(root, sheet, P) {
  const state = dyingState(sheet, P);
  const panel = root.querySelector("#dyingPanel");
  panel.classList.toggle("live", state.live);
  panel.classList.toggle("safe", state.live && state.stable);

  const formula = root.querySelector("#dy_formula");
  formula.replaceChildren(`Endurance ${total(sheet, "end")} + Steadfast ${total(sheet, "ste")} − ${DIFFICULTY[DYING.selfRoll].dice}`, h("br"), "no condition penalties apply");
  root.querySelector("#dy_pool").textContent = state.rawPool;
  root.querySelector("#dy_need").textContent = state.need;
  root.querySelector("#dy_have").textContent = state.have;
  root.querySelector("#dy_ofmax").textContent = state.overflowMax;
  root.querySelector("#dy_of").textContent = sheet.dy.over;

  const fillTrack = (id, count, className, dataAttr, label, filled) => {
    const track = root.querySelector(`#${id}`);
    if (track.dataset.n !== String(count)) {
      track.dataset.n = String(count);
      track.style.setProperty("--n", String(count));
      track.replaceChildren(...Array.from({ length: count }, (_, i) => h("button", { class: className, type: "button", [dataAttr]: i, "aria-pressed": "false", "aria-label": `${label} ${i + 1}` })));
    }
    track.querySelectorAll("button").forEach((box, i) => {
      box.classList.toggle("on", state.live && i < filled);
      box.setAttribute("aria-pressed", String(state.live && i < filled));
    });
  };
  fillTrack("dy_succ", Math.max(1, state.need), "dyb", "data-dysucc", "Success", state.have);
  fillTrack("dy_over", state.overflowMax, "dyb of", "data-dyover", "Overflow", sheet.dy.over);

  const flag = root.querySelector("#dy_flag");
  flag.hidden = !(state.live && state.stable);
  flag.textContent = sheet.dy.aided ? "Stabilized by an ally" : "Stabilized";

  const hint = root.querySelector("#dy_hint");
  hint.hidden = !state.live;
  const trauma = sheet.cm.trauma;
  hint.replaceChildren(
    ...(state.stable
      ? [
          `No longer dying, still unconscious. Once per ${RECOVERY.naturalHours} hours roll `,
          h("b", {}, "Endurance + Steadfast"),
          " with normal penalties: ",
          h("b", {}, state.dailyDifficulty),
          ` at ${trauma} Trauma. Each success heals 1 Trauma, no successes adds 1.`,
        ]
      : ["Each round: ", h("b", {}, "1+ successes"), " banks them and you take no overflow. ", h("b", {}, "0 successes"), ` fills one overflow box and adds 1 Trauma. Overflow past ${state.overflowMax} is death.`]),
  );
}

function renderDial(root, sheet, P) {
  const crit = criticalMonitor(sheet);
  const eclipse = root.querySelector(".eclipse");
  eclipse.classList.remove("crit", "crit-trauma", "crit-rot", "crit-shock");
  if (crit) {
    eclipse.classList.add("crit", `crit-${crit.track}`);
    root.querySelector("#critBadge").textContent = crit.badge;
  }
  eclipse.classList.toggle("bonus", !crit && P.total < 0);

  const number = root.querySelector("#dialNum");
  number.textContent = P.total > 0 ? `−${P.total}` : P.total < 0 ? `+${Math.abs(P.total)}` : "0";
  number.classList.toggle("clean", P.total === 0);
  number.classList.toggle("bonus", P.total < 0);

  const gone = Math.min(CORONA_TICKS, Math.round((Math.max(0, P.total) / 10) * CORONA_TICKS));
  root.querySelectorAll(".tick").forEach((tick, i) => {
    const off = i >= CORONA_TICKS - gone;
    tick.classList.toggle("off", off);
    tick.setAttribute("opacity", off ? "1" : String(1 - Math.max(0, P.total) / 14));
  });

  root.querySelector("#dialCaption").textContent = crit
    ? crit.line
    : P.dead
      ? `Starved. ${STARVATION.deathDay} days is as long as the wasteland gives you.`
      : P.total < 0
        ? "Something is holding you steady."
        : P.total === 0
          ? "Nothing has taken anything from you yet."
          : P.total < 3
            ? "Every roll is a little harder now."
            : P.total < 6
              ? "The spiral has you. Get somewhere safe."
              : "You are running out of dice and time.";
}

function renderEquipment(root, sheet) {
  fillInputs(root, sheet);
  const tiers = encTiers(sheet);
  const load = weights(sheet);
  const enc = encPenalty(sheet);
  const text = (id, value) => {
    root.querySelector(`#${id}`).textContent = value;
  };
  text("enc_w", load.total);
  text("enc_worn", load.worn);
  text("enc_packs", load.packs);
  text("enc_sup", load.supplies);
  text("enc_lift", tiers.lift);
  text("enc_l", tiers.light);
  text("enc_m", tiers.moderate);
  text("enc_s", tiers.serious);
  text("enc_c", tiers.immobile);
  const tier = root.querySelector("#enc_tier");
  tier.textContent = enc.tier;
  tier.className = `t ${enc.cls}`;
  text("enc_pen", enc.stuck ? `${enc.tier.toLowerCase()}, 1 m per AP` : enc.p ? `−${enc.p} dice to all checks` : "no penalty");
  const fill = root.querySelector("#enc_fill");
  fill.style.setProperty("--fill", `${Math.min(100, enc.frac * 100)}%`);
  fill.className = `enc-fill ${enc.cls}`;
  // Threshold marks sit at their true position on the same 0-to-immobile scale.
  const at = (id, value) => root.querySelector(`#${id}`).style.setProperty("--pos", `${(value / tiers.immobile) * 100}%`);
  at("enc_m1", tiers.light);
  at("enc_m2", tiers.moderate);
  at("enc_m3", tiers.serious);
  at("lab_l", tiers.light);
  at("lab_m", tiers.moderate);
  at("lab_s", tiers.serious);
  at("lab_c", tiers.immobile);
  text("encNote", `Lethality ${total(sheet, "let")} · light load up to ${tiers.light} lb`);

  root.querySelectorAll("[data-iw]").forEach((el) => {
    const [scope, index] = el.dataset.iw.split(".");
    const item = listOf(sheet, scope)[int(index)] || {};
    const weight = r1(num(item.q || 0) * num(item.w || 0));
    el.textContent = weight || "0";
    el.classList.toggle("dim", !weight);
  });
  root.querySelectorAll("[data-wwt]").forEach((el) => {
    const key = el.dataset.wwt;
    const weight = num(sheet.wornW[key]) * carriedQuantity(sheet, key);
    el.textContent = r1(weight) || "0";
    el.classList.toggle("dim", !weight);
  });
  sheet.containers.forEach((container, i) => {
    const el = root.querySelector(`[data-cload="${i}"]`);
    if (!el) return;
    const content = r1(contentWeight(container));
    el.replaceChildren(h("b", {}, content), ` / ${num(container.cap)} lb`);
    el.classList.toggle("over", content > num(container.cap));
  });

  const sp = sheet.sup;
  text("w_rations", r1(num(sp.rations)));
  text("w_med", r1(num(sp.medQ) * num(sp.medW)));
  text("w_cmp", r1(num(sp.cmpQ) * num(sp.cmpW)));
  text("w_ammo", r1(num(sp.ammoQ) * num(sp.ammoW)));
}

function renderTestament(root, sheet) {
  const carry = (id, value, fallback) => {
    const el = root.querySelector(`#${id}`);
    el.textContent = value || fallback;
    el.classList.toggle("empty", !value);
  };
  carry("c_prof", sheet.id.prof, "set on the Core sheet");
  carry("c_bg", sheet.id.bg, "set on the Core sheet");
  carry("c_master", sheet.id.master ? `${sheet.id.master} +2` : "", "none chosen");
  const race = raceOf(sheet);
  carry("c_race", race.name, "set on the Core sheet");
  const ability = root.querySelector("#c_racial");
  const none = race.abil === NO_RACIAL_ABILITY;
  ability.textContent = none ? "No racial ability." : race.abil;
  ability.classList.toggle("none", none);
}

function renderCasting(root, sheet, P) {
  const veil = total(sheet, "vei");
  const psyche = total(sheet, "psy");
  const { magicPoints: magic, psionicPoints: psionic } = derivedStats(sheet);
  const magicLeft = Math.max(0, magic - int(sheet.cast.mpSpent));
  const psionicLeft = Math.max(0, psionic - int(sheet.cast.ppSpent));
  const text = (id, value) => {
    root.querySelector(`#${id}`).textContent = value;
  };
  text("v_rate", veil);
  text("p_rate", psyche);
  text("v_max", magic);
  text("p_max", psionic);
  text("v_left", magicLeft);
  text("p_left", psionicLeft);
  root.querySelector("#veilPanel").classList.toggle("dormant", veil === 0);
  root.querySelector("#psyPanel").classList.toggle("dormant", psyche === 0);
  text("nextToll", sheet.cast.freeHeal ? `Rot, level / ${CASTING.veilHealRotDivisor}` : "only Shock");

  root.querySelectorAll("[data-cp]").forEach((el) => {
    const pool = castingPool(sheet, el.dataset.cp, P.total);
    el.textContent = pool.shown;
    el.classList.toggle("dim", total(sheet, pool.attr) === 0);
  });

  const reach = Math.max(magicLeft, psionicLeft);
  root.querySelectorAll("[data-lvl]").forEach((row) => {
    const level = int(row.dataset.lvl);
    row.classList.toggle("afford", level <= reach);
    row.classList.toggle("past", level > reach);
  });
  const parts = [];
  if (veil) parts.push(`Veil to ${magicLeft}`);
  if (psyche) parts.push(`Psyche to ${psionicLeft}`);
  text("ladderNote", parts.length ? parts.join(" · ") : "not a caster");

  for (const kind of ["spells", "powers"]) {
    sheet[kind].forEach((row, i) => {
      const level = int(row.l);
      const cost = root.querySelector(`[data-cc="${kind}.${i}"]`);
      const ap = root.querySelector(`[data-ca="${kind}.${i}"]`);
      if (!cost || !ap) return;
      cost.textContent = level || "0";
      cost.classList.toggle("dim", !level);
      ap.textContent = level ? (kind === "spells" ? veilAP(level) : psyAP(level)) : "0";
      ap.classList.toggle("dim", !level);
    });
  }
  sheet.rituals.forEach((row, i) => {
    const duration = root.querySelector(`[data-rdur="${i}"]`);
    const tv = root.querySelector(`[data-rtv="${i}"]`);
    const shock = root.querySelector(`[data-rshock="${i}"]`);
    if (!duration || !tv || !shock) return;
    const cost = ritualCost(row);
    duration.textContent = cost ? cost.duration : "—";
    tv.textContent = cost ? cost.tv : "0";
    shock.textContent = cost ? (cost.scar ? `${cost.exertion} +${RITUAL.riftScarShock} scar` : cost.exertion) : "0";
    for (const el of [duration, tv, shock]) el.classList.toggle("dim", !cost);
  });
}

function renderDefense(root, sheet) {
  const totals = soak(sheet);
  root.querySelector("#s_b").textContent = totals.ballistic;
  root.querySelector("#s_i").textContent = totals.impact;
  const armor = armorDegradation(sheet);
  root.querySelector("#a_dpv").textContent = armor.pool || 0;
  const armorState = root.querySelector("#a_dstate");
  armorState.textContent = armor.steps ? `−${armor.steps} to B and I` : "intact";
  armorState.classList.toggle("damaged", armor.steps > 0);
  const shield = shieldDegradation(sheet);
  const shieldState = root.querySelector("#sh_dstate");
  shieldState.textContent = shield.steps ? `−${shield.steps} to B and I` : "intact";
  shieldState.classList.toggle("damaged", shield.steps > 0);
}
