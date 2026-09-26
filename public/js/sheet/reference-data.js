// The rules cards on the Reference tab. A card's `body` is a list of parts. A string
// is trusted markup that lives in this file (never user or database text); the tab
// inserts it with staticHtml(). An object is a table, { head?, rows }, whose cells
// are text, or { n } for a number cell. A table or a number that the sheet also
// uses comes from eclipse-content.js, so the card and the sheet cannot disagree.
import {
  ACTIONS,
  AIM,
  BURST,
  CASTING,
  DERIVED_DIVISOR,
  DIFFICULTY,
  DYING,
  ENCUMBRANCE,
  FULL_REST_HOURS,
  FULL_ROT_ESSENCE_PER_HOUR,
  KITS,
  MEDICAL_DIFFICULTY,
  MONITORS,
  MONITOR_BOXES,
  QUALITY,
  RATION_LB,
  RECOVERY,
  RELOADS,
  RITUAL,
  RITUAL_TIERS,
  SHIELD_DEGRADE_STEP,
  STARVATION,
  TRACK_MAX,
  UNOPPOSED_DIFFICULTY,
  UNTRAINED_STAGES,
} from "../eclipse-content.js";
import { ATTR_NAMES } from "../eclipse-rules.js";

const MINUS = "−";
const n = (text) => ({ n: String(text) });
const lost = (dice) => (dice ? `${MINUS}${dice}` : "0");
const signed = (dice) => (dice < 0 ? `${MINUS}${-dice}` : `+${dice}`);

const selfStabilize = DIFFICULTY[DYING.selfRoll];
const encumbranceStep = ENCUMBRANCE.step;
const traumaBand = (row, next) => (next ? `${row.fromTrauma} to ${next.fromTrauma - 1}` : `${row.fromTrauma}+`);

// Two worked examples of rolling untrained, built from the same stage order and
// step count the sheet applies, so the card cannot name a pair the sheet disagrees with.
const difficultyStages = Object.values(DIFFICULTY);
const untrainedExample = difficultyStages
  .slice(0, 2)
  .map((stage, i) => `${stage.name} becomes ${difficultyStages[i + UNTRAINED_STAGES].name}`)
  .join(", ");

export const REFERENCE_TABLES = {
  difficulty: { rows: Object.values(DIFFICULTY).map((stage) => [stage.name, n(lost(stage.dice)), stage.note]) },
  actions: { rows: Object.values(ACTIONS).map((action) => [action.name, n(action.ap)]) },
  defending: {
    rows: [
      ["Block", n(`${ACTIONS.defend.ap} AP`), "Lethality + weapon skill, melee only"],
      ["Dodge", n(`${ACTIONS.defend.ap} AP`), "Dodge Pool + Dodge, melee and ranged"],
      ["None", n("0 AP"), `attacker rolls unopposed vs Difficulty ${UNOPPOSED_DIFFICULTY}`],
    ],
  },
  fireModes: {
    head: ["Mode", "AP", "Ammo", "Effect"],
    rows: [
      ["SA", n("base"), n(1), "standard attack"],
      ["BF", n(`+${BURST.ap}`), n(BURST.rounds), `+${BURST.damage} damage`],
      ["FA", n("varies"), n("5 to 30"), "suppress, spray, deny"],
    ],
  },
  reloads: { rows: RELOADS.map((reload) => [`${reload.name}, ${reload.rounds}`, n(`${reload.ap} AP`)]) },
  monitors: {
    head: ["Track", "Threshold", "Soak"],
    rows: MONITORS.map((monitor) => [monitor.name, `every ${ATTR_NAMES[monitor.per]}${monitor.divide ? ` / ${monitor.divide}` : ""}`, monitor.soak]),
  },
  healing: {
    head: ["Method", "Time", "Heals"],
    rows: [
      ["Shock", "1 hr", "1 box, automatic"],
      ["Rot", "1 week", "1 box, automatic"],
      ["Natural", `${RECOVERY.naturalHours} hr`, "1 per success"],
      ["Medical", `${RECOVERY.medicalMinutes} min`, "1 per success"],
      ["Veil or Psyche", "5 min", "by spell"],
    ],
  },
  rest: { rows: [["No rest", n(`${MINUS}1`)], ["Partial rest", n("+1")], [`Full rest, ${FULL_REST_HOURS} hrs safe`, n("+2")]] },
  medicalDifficulty: {
    head: ["Patient's Trauma", "Difficulty"],
    rows: MEDICAL_DIFFICULTY.map((row, i) => [traumaBand(row, MEDICAL_DIFFICULTY[i + 1]), n(lost(DIFFICULTY[row.stage].dice))]),
  },
  medicalKits: { head: ["Kit", "Dice"], rows: KITS.map((kit) => [kit.name, n(signed(kit.dice))]) },
  starvation: {
    rows: [
      [`0 to ${STARVATION.penalties[0].days - 1} days`, n(0)],
      ...STARVATION.penalties.map((step) => [`${step.days} days`, n(lost(step.dice))]),
      [`${STARVATION.deathDay} days`, n("death")],
    ],
  },
  encumbrance: { rows: ENCUMBRANCE.tiers.map((tier) => [tier.name, n(lost(tier.dice))]) },
  rituals: {
    head: ["Time", "Duration", "Materials"],
    rows: RITUAL_TIERS.map((tier) => [tier.t, tier.unit ? `Level × 1 ${tier.unit}` : "Permanent", n(`${tier.tvBase} + Lvl×${RITUAL.tvPerLevel}`)]),
  },
  ritualToll: { rows: RITUAL_TIERS.map((tier) => [tier.t, n(`${MINUS}${tier.exertionOff}`)]) },
  quality: { rows: QUALITY.map((band) => [band.q, band.word]) },
  toolKits: { rows: KITS.map((kit) => [kit.lb ? `${kit.name}, ${kit.lb} lb` : kit.name, n(signed(kit.dice))]) },
};
const T = REFERENCE_TABLES;
const sellPrices = [...QUALITY].reverse().map((band) => `${band.q} gives ${band.sellPercent}%`).join(", ");

export const REF_CATS = ['Checks','Combat','Damage','Recovery','Survival','Social','Casting','Grit','Gear'];
export const REFERENCE = [
{c:'Checks',t:'Making a check',k:'roll dice pool success target number explode',body:[`
<p>Pool is <b>Attribute + Skill</b>, then apply difficulty, condition penalties, and any bonuses.</p>
<p><b>7 or higher on a d10 is a success.</b> A 10 counts as a success <em>and</em> rerolls, and can keep exploding.</p>
<p>You always roll <b>at least 1 die</b>, no matter how deep the penalties go.</p>`]},

{c:'Checks',t:'Difficulty stages',k:'easy moderate challenging difficult formidable near impossible',body:[T.difficulty,`
<p>Difficulty removes dice. It never changes what counts as a success.</p>`]},

{c:'Checks',t:'Reading the result',k:'margin outcome marginal clean exceptional legendary failure',body:[`
<table><tr><td>0</td><td>Failure</td></tr>
<tr><td>1</td><td>Marginal, it works but it costs you</td></tr>
<tr><td>2</td><td>Clean success</td></tr>
<tr><td>3</td><td>Exceptional</td></tr>
<tr><td>4+</td><td>Legendary</td></tr></table>
<p><b>Quantity checks</b> are the exception: scavenging, healing, and crafting count each success as a unit found, box healed, or quality step.</p>`]},

{c:'Checks',t:'Botch',k:'botch ones critical failure complication severity',body:[`
<p>A botch is <b>zero successes and at least one 1</b>. Severity scales with how many 1s.</p>
<table><tr><td>One 1</td><td>Minor, narrative only</td></tr>
<tr><td>Two 1s</td><td>Moderate, a real mechanical cost</td></tr>
<tr><td>Three or more</td><td>Major, roll d10 on the Botch Severity table</td></tr></table>
<p>Casting botch at two 1s: <b>Shock equal to the Effect Level</b> and a permanent cosmetic scar.</p>`]},

{c:'Checks',t:'Helping and retrying',k:'help assist teamwork retry anti spam',body:[`
<p>One character rolls. Each helper adds <em>+2 dice</em> and must have at least 1 rank in the skill. Everyone spends the same time.</p>
<p>No help on willpower tests, personal attacks and defences, or one-voice social checks.</p>
<p><b>Retries cost.</b> Time passes, materials burn, and failure usually makes the next attempt harder.</p>`]},

{c:'Checks',t:'Untrained use',k:'untrained no skill rank penalty',body:[`
<p>Roll the <b>attribute alone</b> and add <em>+${UNTRAINED_STAGES} difficulty stages</em>. ${untrainedExample}.</p>
<p>Sorcery, Ritual Casting, and Psionics cannot be attempted untrained.</p>`]},

{c:'Combat',t:'The round',k:'initiative order round seconds turn',body:[`
<p>A round is <b>6 seconds</b>. Initiative is <em>Instinct + 1d10</em>, highest first, rolled <b>once at the top of the fight</b> — it holds every round after unless something in the fiction disrupts it.</p>
<p>AP refreshes each round. Your AP is <em>(E+C+L+I+P+S) / ${DERIVED_DIVISOR.actionPoints}</em>, rounded down.</p>`]},

{c:'Combat',t:'What actions cost',k:'AP action points move aim reload draw item cost',body:[T.actions,`
<p>One free action per round. Any more cost 1 AP each.</p>`]},

{c:'Combat',t:'Aiming',k:'aim bypass armor precision',body:[`
<p>Each AP spent aiming gives <em>+${AIM.dice} die</em> and <b>ignores ${AIM.armorIgnored} point of armor AV</b>.</p>
<p>Maximum aims equals the attacking attribute: Instinct for ranged, Lethality for melee. Aiming does not bypass personnel soak.</p>`]},

{c:'Combat',t:'Defending',k:'block dodge defense no defense reaction',body:[T.defending,`
<p><b>One defence per attack.</b> Never both.</p>`]},

{c:'Combat',t:'Fire modes',k:'SA BF FA burst full auto semi ammo',body:[T.fireModes]},

{c:'Combat',t:'Full auto, three uses',k:'suppression spray pray wall of lead pinned kill zone',body:[`
<p><b>Suppression.</b> Base AP, 10 rounds, cone 10m by 5m. Everyone inside rolls Steadfast vs Difficulty 3 or is Pinned. No damage.</p>
<p><b>Spray and pray.</b> Base AP +1, 5 rounds per target, targets within 5m of each other, <em>&minus;1 die per extra target</em>.</p>
<p><b>Wall of lead.</b> Base AP doubled, 20+ rounds, 10m by 10m kill zone. Anyone entering is hit automatically on Instinct + Firearms vs Difficulty 5, base damage only.</p>`]},

{c:'Combat',t:'Reloading',k:'reload magazine drum belt vulnerable',body:[T.reloads,`
<p>Ejecting is free. You cannot shoot while reloading. Reload before you are dry if you can spare the AP.</p>`]},

{c:'Combat',t:'Dual wielding',k:'dual wield two weapons offhand ambidexterity',body:[`
<p>Requires the <b>Ambidexterity Talent</b>. Without it you cannot effectively dual wield at all.</p>
<p>Both weapons attack for the <em>higher weapon's AP cost only</em>, not each separately, at <b>&minus;2 dice</b> to each attack.</p>`]},

{c:'Damage',t:'Resolving an attack',k:'damage flow steps net successes soak order',body:[`
<ol><li>Attacker rolls Attribute + Skill.</li>
<li>Defender Blocks or Dodges, or the attacker rolls unopposed vs Difficulty ${UNOPPOSED_DIFFICULTY}.</li>
<li><b>Net successes</b> = attacker minus defender. 1 or more is a hit.</li>
<li>Damage = <b>weapon base + net successes</b>.</li>
<li>Subtract cover, then shield, then armor, then personnel soak.</li>
<li>Whatever is left fills that many boxes.</li></ol>`]},

{c:'Damage',t:'Which soak applies',k:'ballistic impact armor rating B I type',body:[`
<p><b>Ballistic</b> stops bullets, shrapnel, arrows, and piercing. <b>Impact</b> stops melee, blunt, slashing, crushing, and falls.</p>
<table><tr><th>Damage</th><th>Cover</th><th>Shield</th><th>Armor</th><th>Pers.</th></tr>
<tr><td>Bullets</td><td>yes</td><td>B</td><td>B</td><td>yes</td></tr>
<tr><td>Melee</td><td>yes</td><td>I</td><td>I</td><td>yes</td></tr>
<tr><td>Shock</td><td>yes</td><td>I</td><td>rarely</td><td>no</td></tr>
<tr><td>Rot</td><td>no</td><td>no</td><td>no</td><td>no</td></tr></table>
<p>Rot and Sanity bypass everything. Resist with Endurance or Steadfast instead.</p>`]},

{c:'Damage',t:'Cover',k:'cover barrier hard soft partial hide',body:[`
<table><tr><td>Partial</td><td class="n">&minus;1</td></tr>
<tr><td>Soft</td><td class="n">&minus;2</td></tr>
<tr><td>Hard</td><td class="n">&minus;4</td></tr></table>
<p>Cover is subtracted first, before any shield or armor.</p>`]},

{c:'Damage',t:'Condition monitors',k:'shock trauma rot boxes threshold penalty stacking',body:[T.monitors,`
<p>Each threshold crossed is <em>&minus;1 die to everything</em>, and the three <b>stack globally</b>.</p>`]},

{c:'Damage',t:`Hitting ${MONITOR_BOXES} boxes`,k:'unconscious dying overflow death corruption',body:[`
<p><b>Shock ${MONITOR_BOXES}:</b> unconscious. Overflow of <em>Essence / ${DERIVED_DIVISOR.overflow}</em> converts to Trauma at 1 per round.</p>
<p><b>Trauma ${MONITOR_BOXES}:</b> unconscious and dying. Same overflow, then death. Survive and stabilize, then roll on the Lasting Injury table.</p>
<p><b>Rot ${MONITOR_BOXES}:</b> permanent corruption. Lose ${FULL_ROT_ESSENCE_PER_HOUR} Essence per hour until Essence hits 0.</p>`]},

{c:'Damage',t:'Stabilizing',k:'stabilize dying first aid bleeding out unconscious',body:[`
<p><b>An ally:</b> ${ACTIONS.stabilizeAlly.ap} AP and ${DYING.allySupplies} medical supply unit. Automatic, no roll.</p>
<p><b>Yourself:</b> roll Endurance + Steadfast at a fixed <em>${selfStabilize.name} (&minus;${selfStabilize.dice})</em> each round. Condition penalties never apply to this roll. Accumulate successes equal to your current Trauma dice penalty. A round with no successes adds an overflow box.</p>
<p>Stabilized means no longer dying. Still unconscious.</p>`]},

{c:'Damage',t:'Sanity',k:'sanity madness insanity narrative rating',body:[`
<p>Sanity is a <b>1 to ${TRACK_MAX} rating, not a monitor</b>. It never subtracts dice.</p>
<p>Below 5 the Keeper rolls forced roleplay. At 0 the character is permanently mad and becomes an NPC.</p>
<p>It cannot be raised with Grit. It takes safe havens, professional help, or Emily.</p>`]},

{c:'Recovery',t:'How healing works',k:'heal recovery rest medicine natural rate',body:[T.healing,`
<p><b>One healing method per patient per 24 hours.</b> Natural, medical, Veil, and Psyche do not stack. Shock recovery, Rot healing, and stabilization are exempt.</p>`]},

{c:'Recovery',t:'Natural recovery',k:'natural recovery self heal rest quality sleep',body:[`
<p>Once per ${RECOVERY.naturalHours} hours, roll <b>Endurance + Steadfast</b> at ${DIFFICULTY[RECOVERY.naturalStage].name}. Each success heals 1 Trauma.</p>`,T.rest]},

{c:'Recovery',t:'Medical treatment',k:'medicine kit treat wounds surgery supplies',body:[`
<p>Roll <b>Clarity + Medicine</b>. ${RECOVERY.medicalMinutes} minutes, ${RECOVERY.medicalSupplies} supply unit consumed whether or not it works. Each success heals 1 Trauma. On zero successes the patient takes 1 Shock.</p>
<p>Wound severity sets difficulty; kit quality is a separate bonus &mdash; they don't pair off row by row.</p>`,T.medicalDifficulty,T.medicalKits]},

{c:'Survival',t:'Starvation',k:'starving hunger rations food water days thirst',body:[`
<p>1 ration is one day of food and water, and weighs ${RATION_LB} lb.</p>`,T.starvation,`
<p>Eating <b>lowers the counter by one day</b>. It does not reset it.</p>`]},

{c:'Survival',t:'Encumbrance',k:'weight carry load heavy burdened lift',body:[`
<p>Thresholds come from Lethality. Steps of ${encumbranceStep.lb} lb up to Lethality ${encumbranceStep.upToLethality}, then ${encumbranceStep.lbAbove} lb.</p>`,T.encumbrance,`
<p>Everything worn, held, slung, or packed counts. <b>Max lift</b> is <em>Lethality &times; ${ENCUMBRANCE.liftPerLethality} lb</em> on a Lethality + Athletics roll.</p>`]},

{c:'Survival',t:'Questionable food',k:'edible not edible spoiled contaminated purify rot',body:[`
<p>Test before eating with <b>Clarity + Survival</b>. Visibly spoiled is Difficulty 3, questionable 5, subtle 7, invisible 9.</p>
<table><tr><td>Stale</td><td>no effect</td></tr>
<tr><td>Spoiled</td><td>Endurance 5 or 1 to 2 Rot</td></tr>
<tr><td>Toxic</td><td>Endurance 7 or 2 to 4 Rot</td></tr>
<tr><td>Poisonous</td><td>3 to 5 Rot, no save</td></tr></table>
<p>Bad rations <b>do not count</b> against starvation.</p>`]},

{c:'Social',t:'NPC attitude',k:'attitude hostile wary neutral friendly loyal reaction',body:[`
<table><tr><td>Hostile</td><td class="n">&minus;7</td></tr>
<tr><td>Wary</td><td class="n">&minus;5</td></tr>
<tr><td>Neutral</td><td class="n">&minus;3</td></tr>
<tr><td>Friendly</td><td class="n">&minus;1</td></tr>
<tr><td>Loyal</td><td class="n">0</td></tr></table>
<p>Neutral is the default for strangers. Players are only ever told outright when someone is Loyal.</p>`]},

{c:'Social',t:'Social checks',k:'persuade deceive intimidate barter leadership opposed insight',body:[`
<p>Roll <b>Presence + your social skill</b> against their defence.</p>
<table><tr><th>You use</th><th>They roll</th></tr>
<tr><td>Persuasion</td><td>Steadfast + Insight</td></tr>
<tr><td>Deception</td><td>Steadfast + Insight</td></tr>
<tr><td>Intimidation</td><td>Steadfast + Composure</td></tr>
<tr><td>Bartering</td><td>Presence + Bartering</td></tr>
<tr><td>Leadership</td><td>Steadfast + Composure</td></tr></table>
<p>No roll makes an NPC act against their own survival or character.</p>`]},

{c:'Casting',t:'Effect levels',k:'spell power cost MP PP AP effect level magic psionics',body:[`
<p>MP and PP cost equals the Effect Level. <b>Points are spent before the roll</b> and are lost even on a failure.</p>
<p>Veil AP equals the level. Psyche AP is roughly half, capped at ${CASTING.psycheApCap}.</p>
<p>Pools are <em>Veil &times; ${CASTING.pointsPerRating}</em> and <em>Psyche &times; ${CASTING.pointsPerRating}</em>, refreshed only by a full rest.</p>
<p>Roll <b>Veil + Sorcery</b> or <b>Psyche + Psionics</b>. One school per ${CASTING.pointsPerSchool} points in the attribute.</p>`]},

{c:'Casting',t:'What casting costs you',k:'backlash rot shock healing toll corruption',body:[`
<p><b>Veil healing.</b> First cast after a full rest costs Shock equal to the level. Every cast after that costs <em>Rot equal to level / ${CASTING.veilHealRotDivisor}</em>, rounded up.</p>
<p><b>Psyche healing.</b> Always Shock equal to <em>level / ${CASTING.psycheHealShockDivisor}</em>, rounded up.</p>
<p>Veil corrodes the body. Psyche fractures the mind. Neither is free.</p>`]},

{c:'Casting',t:'Rituals',k:'ritual duration time invested materials TV permanent veil only',body:[`
<p><b>Veil only.</b> Psionics are instant mental acts, not ceremonial workings — Psyche cannot perform rituals.</p>
<p>Time invested sets the duration <b>and</b> the cost. More care, more time, more lasting.</p>`,T.rituals,`
<p>Materials still need to make narrative sense: chalk and herbs for a 10-minute working, a consumed rift crystal for anything permanent. The TV is what those components cost, not a flat abstract fee.</p>`]},

{c:'Casting',t:'The Ritual Toll',k:'exertion shock rift scar rushing permanent',body:[`
<p><b>Exertion Shock.</b> Every ritual costs <em>Effect Level minus how much time you took</em>, minimum 1. Rushing a high level ritual is brutal; taking it slow softens the blow.</p>`,T.ritualToll,`
<p><b>Recovery delay.</b> This Shock cannot begin healing until time equal to what you invested has passed since the ritual ended. An 8-hour ritual leaves you compromised for a full 8 hours afterward.</p>
<p><b>The Rift Scar.</b> A 24-hour, Permanent-tier ritual also costs every caster involved <em>+${RITUAL.riftScarShock} Shock, permanently</em>. It never heals — not rest, not Medicine, not Veil or Psyche healing, ever.</p>`]},

{c:'Grit',t:'Spending Grit in the moment',k:'grit reroll add success negate heroic surge tactical',body:[`
<table><tr><td class="n">1</td><td>Reroll one failed die</td></tr>
<tr><td class="n">1</td><td>Add one success, declared after the roll</td></tr>
<tr><td class="n">2</td><td>Negate one condition box</td></tr>
<tr><td class="n">3</td><td>Heroic Surge: +3 AP now, +2 next, +1 after, then take 2 Shock</td></tr></table>
<p>There is no separate pool. This is the same Grit you would spend on advancement.</p>`]},

{c:'Grit',t:'Advancement costs',k:'raise skill attribute talent advantage cost xp experience',body:[`
<table><tr><td>Skill</td><td class="n">new rating &times; 3</td></tr>
<tr><td>Attribute</td><td class="n">new rating &times; 4</td></tr>
<tr><td>Advantage, tier 1 or 2</td><td class="n">10</td></tr>
<tr><td>Advantage, tier 3</td><td class="n">15</td></tr>
<tr><td>Talent</td><td class="n">10 to 30</td></tr></table>
<p>Non-humans pay <em>+6 Grit</em> on every Talent. Raising anything needs a one-line narrative justification.</p>
<p>Skills cap at <b>twice the linked attribute</b> during play, and Sanity cannot be bought with Grit at all.</p>`]},

{c:'Grit',t:'Earning Grit',k:'award session milestone rift enclave',body:[`
<p>1 to 5 per session by how much was at stake. Milestones add <em>+5</em>: closing a rift, destroying an AI node, saving an enclave, ending a major antagonist.</p>
<p>Grit never resets or refreshes. What you save, you keep.</p>`]},

{c:'Gear',t:'Quality',k:'quality Q1 Q10 condition pristine broken gear',body:[T.quality,`
<p><b>Armor:</b> Q1 to 3 is &minus;1 to both ratings, Q7 to 9 is +1, Q10 is +2.</p>
<p><b>Weapons:</b> Q1 to 3 is &minus;1 damage and jams on a botch. Q7+ is +1 damage.</p>`]},

{c:'Gear',t:'Trading',k:'trade value TV buy sell barter haggle price',body:[`
<p><b>Buying</b> is the listed TV, swung <em>&plusmn;15%</em> by your Bartering result. A bad roll raises the price.</p>
<p><b>Selling</b> returns a fraction by quality: ${sellPrices}.</p>
<p>A trader takes only about 5 identical common items a week before rates halve. TV has nothing to do with Grit.</p>`]},

{c:'Gear',t:'Tool kits',k:'tool kit partial full advanced facility bonus dice',body:[T.toolKits,`
<p>Kits degrade one quality step every 10 uses, and immediately on a botch.</p>`]},

{c:'Gear',t:'Gear wears out',k:'degradation armor shield repair scrap field workshop',body:[`
<p>Track the damage a piece of armor has soaked. Each time it reaches the item's <b>degradation pool</b>, both B and I drop by 1. Shields degrade every ${SHIELD_DEGRADE_STEP} damage. Neither goes below 0.</p>
<p><b>Field repair</b> restores half the original rating. <b>Workshop repair</b> restores all of it. Both take an hour and a scrap unit.</p>`]},

{c:'Gear',t:'Why you cannot just retry',k:'anti spam time material consequence lockpick hack',body:[`
<p>Every attempt costs <b>time</b>, most cost <b>materials</b>, and failure usually makes it <b>worse</b>.</p>
<table><tr><td>Lockpicking</td><td>5 to 15 min, breaks a pick, lock jams at +2</td></tr>
<tr><td>Hacking</td><td>10 to 30 min, burns an exploit, alerts at +1</td></tr>
<tr><td>Medicine</td><td>15 min a box, burns supplies, patient takes Shock</td></tr>
<tr><td>Scavenge</td><td>1 hour, draws attention</td></tr>
<tr><td>Crafting</td><td>1 to 8 hrs, materials lost</td></tr></table>`]},
];
