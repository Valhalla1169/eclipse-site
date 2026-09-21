// The DM's roster: one card per player with the numbers a DM needs, kept up to date
// by a live subscription and a slow timer, plus a "download all sheets" backup.
// Read only in every way (ADR 0001, 0009): nothing here writes to the database.
import { h } from "./dom.js";
import { backupFile, buildRoster } from "./roster.js";
import { fileNameForName, serializeStored } from "./sheet/files.js";
import { friendlyError, timeAgo } from "./util.js";

export const FALLBACK_REFRESH_MS = 30_000;
const EVENT_DELAY_MS = 250;
const MINUS = "−";

const penaltyText = (value) => (value > 0 ? `${MINUS}${value}` : value < 0 ? `+${Math.abs(value)}` : "0");
const stat = (label, value) => [h("dt", {}, label), h("dd", {}, value)];

function playerStats(summary) {
  const monitor = (label, { boxes, penalty }) => stat(label, `${boxes}/10, ${penaltyText(penalty)}`);
  return h(
    "dl",
    { class: "stats" },
    monitor("Shock", summary.monitors.shock),
    monitor("Trauma", summary.monitors.trauma),
    monitor("Rot", summary.monitors.rot),
    stat("Load", `${summary.load.pounds} lb, ${summary.load.tier.toLowerCase()}`),
    stat("Action points", summary.actionPoints),
    stat("Soak", `B ${summary.soak.ballistic} / I ${summary.soak.impact}`),
    stat("Sanity", `${summary.sanity.label}, ${summary.sanity.value}/10`),
    stat("Morality", `${summary.morality.label}, ${summary.morality.value}/10`),
    stat("Days without rations", summary.starveDays),
  );
}

// api: { sync(campaignId, previous), subscribe(campaignId, onChange, onStatus) }. sync with no
// `previous` reads every sheet again, which the backup uses.
export function createRosterPanel({ campaign, api, download }) {
  let roster = { members: [], assignments: [], profiles: {}, characters: {}, departed: {} };
  let busy = false;
  let again = false;
  let eventTimer = null;

  const status = h("span", { class: "status", role: "status", "aria-live": "polite" });
  const problem = h("div", { class: "stack" });
  const live = h("span", { class: "badge" }, "Connecting...");
  const list = h("ul", { class: "roster" });
  const formerBox = h("div", { class: "stack" });
  const empty = h("p", { class: "muted" });

  const campaignPath = `/campaign/${encodeURIComponent(campaign.id)}`;

  const cardFor = (entry) => {
    const { character } = entry;
    const name = character ? character.name || "Unnamed survivor" : "No character chosen yet";
    const verb = character && character.copyId ? "Kept" : "Saved";
    const summary = character && character.summary;
    const flag = summary && (summary.starved ? "Starved" : summary.critical);
    return h(
      "li",
      { class: "player-card card stack" },
      h(
        "div",
        { class: "card-head" },
        h("div", {}, h("h3", {}, name), h("p", { class: "muted" }, `Player: ${entry.playerName}`)),
        flag ? h("span", { class: "badge badge-alert" }, flag) : null,
      ),
      !character ? h("p", { class: "muted" }, "They have not chosen a character for this campaign yet.") : null,
      character && character.copyId
        ? h("p", { class: "muted" }, `This is their sheet as it was when ${character.reason === "removed" ? "you removed them" : "they left"}. It does not change.`)
        : null,
      character && character.unreadable ? h("p", { class: "notice notice-error" }, h("strong", {}, "Error: "), "This sheet could not be read. It is safe in the database and in the backup file.") : null,
      character && character.newerVersion ? h("p", { class: "muted" }, "Saved by a newer version of the app. Some fields may not show.") : null,
      summary
        ? [
            h("p", { class: "muted" }, [summary.race, summary.profession].filter(Boolean).join(", ")),
            h("p", { class: "penalty" }, h("span", { class: "muted" }, "Dice penalty "), h("strong", {}, penaltyText(summary.penalty))),
            playerStats(summary),
          ]
        : null,
      character
        ? h("p", { class: "muted small saved", "data-stamp": character.updatedAt, "data-verb": verb, title: new Date(character.updatedAt).toLocaleString() }, `${verb} ${timeAgo(character.updatedAt)}`)
        : null,
      character
        ? h(
            "div",
            { class: "actions" },
            h("a", { class: "btn btn-primary btn-small", href: character.copyId ? `${campaignPath}/left/${encodeURIComponent(character.copyId)}` : `${campaignPath}/dm/${encodeURIComponent(character.id)}` }, "Open sheet"),
            character.copyId ? null : h("a", { class: "btn btn-quiet btn-small", href: `${campaignPath}/dm/${encodeURIComponent(character.id)}/history` }, "History"),
            h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => download(fileNameForName(character.name || entry.playerName), serializeStored(character.row)) }, "Save a copy"),
          )
        : null,
    );
  };

  function paint() {
    const { players, former } = buildRoster(roster);
    empty.textContent = players.length ? "" : "Nobody has joined yet. Create an invite below and send the link to a player.";
    list.replaceChildren(...players.map(cardFor));
    formerBox.replaceChildren(
      ...(former.length
        ? [
            h("h3", {}, "Former players"),
            h("p", { class: "muted" }, "They are no longer in the campaign. Each sheet below is a copy kept when they left."),
            h("ul", { class: "roster" }, ...former.map(cardFor)),
          ]
        : []),
    );
  }

  async function refresh() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      roster = await api.sync(campaign.id, roster);
      problem.replaceChildren();
      paint();
    } catch (error) {
      console.error(error);
      problem.replaceChildren(h("p", { class: "notice notice-error", role: "alert" }, h("strong", {}, "Error: "), `The roster could not be updated. ${friendlyError(error)}`));
    } finally {
      busy = false;
      if (again) {
        again = false;
        refresh();
      }
    }
  }

  const onChange = () => {
    clearTimeout(eventTimer);
    eventTimer = setTimeout(refresh, EVENT_DELAY_MS);
  };
  const onStatus = (state) => {
    live.textContent = state === "SUBSCRIBED" ? "Live" : state === "CLOSED" || state === "CHANNEL_ERROR" || state === "TIMED_OUT" ? "Not live" : "Connecting...";
    live.title = state === "SUBSCRIBED" ? "Changes appear as players make them." : `The roster still checks for changes every ${FALLBACK_REFRESH_MS / 1000} seconds.`;
    // A dropped connection can miss changes, so read again when it comes back.
    if (state === "SUBSCRIBED") refresh();
  };

  async function downloadAll(event) {
    const button = event.currentTarget;
    button.disabled = true;
    status.textContent = "Preparing the backup...";
    try {
      const fresh = await api.sync(campaign.id);
      const file = backupFile({ campaign, ...fresh });
      download(file.name, file.text);
      const count = Object.keys(fresh.characters).length + Object.keys(fresh.departed).length;
      status.textContent = `Downloaded ${count} ${count === 1 ? "sheet" : "sheets"} in ${file.name}.`;
    } catch (error) {
      console.error(error);
      status.textContent = `The backup failed. ${friendlyError(error)}`;
    } finally {
      button.disabled = false;
    }
  }

  const unsubscribe = api.subscribe(campaign.id, onChange, onStatus);
  const poll = setInterval(refresh, FALLBACK_REFRESH_MS);
  // Keep "Saved 5 minutes ago" true while the page sits open.
  const clock = setInterval(() => {
    for (const el of list.querySelectorAll("[data-stamp]")) el.textContent = `${el.dataset.verb} ${timeAgo(el.dataset.stamp)}`;
  }, 30_000);
  refresh();

  return {
    element: h(
      "section",
      { class: "card stack", "aria-labelledby": "roster-title" },
      h("div", { class: "card-head" }, h("h2", { id: "roster-title" }, "Players"), live),
      h("p", { class: "muted" }, "Each player's sheet, read only. It updates as they play."),
      h(
        "div",
        { class: "actions" },
        h("button", { class: "btn btn-primary", type: "button", onclick: downloadAll }, "Download all sheets"),
        h("button", { class: "btn btn-quiet", type: "button", onclick: () => refresh() }, "Refresh now"),
        status,
      ),
      problem,
      empty,
      list,
      formerBox,
    ),
    dispose() {
      unsubscribe();
      clearInterval(poll);
      clearInterval(clock);
      clearTimeout(eventTimer);
    },
  };
}
