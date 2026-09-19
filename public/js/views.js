// View builders. Each returns a DOM node; app.js decides which to show.
// Text only ever goes in as text nodes (see dom.js), never as markup.
import { h } from "./dom.js";
import { cleanCampaignName, cleanDisplayName, friendlyError, normalizeCode, normalizeEmail } from "./util.js";

const invalid = (message) => Object.assign(new Error(message), { userMessage: message });

const LABEL = { error: "Error: ", success: "Done: ", info: "Note: " };
export const notice = (kind, ...text) =>
  h("p", { class: `notice notice-${kind}`, role: kind === "error" ? "alert" : "status" }, h("strong", {}, LABEL[kind]), ...text);

function field({ id, label, hint, ...attrs }) {
  const hintId = hint ? `${id}-hint` : null;
  return h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    hint ? h("p", { class: "hint", id: hintId }, hint) : null,
    h("input", { id, name: id, "aria-describedby": hintId, ...attrs }),
  );
}

// A form whose submit handler may return a success message or throw.
// Validation problems are thrown with a userMessage; anything else is shown
// through friendlyError so raw server text never reaches the page.
function form({ fields, submitLabel, onSubmit, primary = true }) {
  const status = h("div", { class: "status", "aria-live": "polite" });
  const button = h("button", { class: `btn ${primary ? "btn-primary" : "btn-quiet"}`, type: "submit" }, submitLabel);
  const el = h("form", { novalidate: true }, ...fields, h("div", { class: "actions" }, button), status);
  el.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    status.replaceChildren();
    button.disabled = true;
    try {
      const message = await onSubmit(Object.fromEntries(new FormData(el)));
      if (message) status.replaceChildren(notice("success", message));
    } catch (err) {
      status.replaceChildren(notice("error", err.userMessage || friendlyError(err)));
      if (!err.userMessage) console.error(err);
    } finally {
      button.disabled = false;
    }
  });
  return el;
}

export function loadingView(text) {
  return h("p", { class: "muted", role: "status" }, text);
}

export function errorView(message, onRetry) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Something went wrong"),
    notice("error", message),
    h(
      "div",
      { class: "actions" },
      onRetry ? h("button", { class: "btn btn-primary", type: "button", onclick: onRetry }, "Try again") : null,
      h("a", { class: "btn btn-quiet", href: "/" }, "Back to home"),
    ),
  );
}

export function notFoundView(message = "That page does not exist.") {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Not found"),
    h("p", {}, message),
    h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
  );
}

export function signInView({ heading = "Sign in", intro, authNotice, onSubmit }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, heading),
    intro ? h("p", { class: "muted" }, intro) : null,
    authNotice ? notice("error", authNotice) : null,
    form({
      fields: [
        field({ id: "email", label: "Email address", type: "email", autocomplete: "email", inputmode: "email", required: true }),
      ],
      submitLabel: "Email me a sign-in link",
      onSubmit: async (values) => {
        const email = normalizeEmail(values.email);
        if (!email) throw invalid("Enter a valid email address.");
        await onSubmit(email);
        return `We sent a sign-in link to ${email}. Open it in this browser to finish signing in.`;
      },
    }),
    h("p", { class: "hint" }, "There is no password. We email you a link each time."),
  );
}

export function profileView({ onSubmit }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Choose a display name"),
    h("p", { class: "muted" }, "Your DM and the other players will see this name."),
    form({
      fields: [field({ id: "displayName", label: "Display name", maxlength: 40, autocomplete: "nickname", required: true })],
      submitLabel: "Save and continue",
      onSubmit: async (values) => {
        const name = cleanDisplayName(values.displayName);
        if (!name) throw invalid("Enter a name between 1 and 40 characters.");
        await onSubmit(name);
      },
    }),
  );
}

function inviteBlock(campaign, onCopy) {
  const status = h("span", { class: "status", "aria-live": "polite" });
  const link = `${location.origin}/join/${encodeURIComponent(campaign.inviteCode)}`;
  const copy = async () => {
    try {
      await onCopy(link);
      status.textContent = "Invite link copied.";
    } catch {
      status.textContent = "Could not copy. Select the code and copy it by hand.";
    }
  };
  return h(
    "div",
    { class: "invite stack" },
    h("p", { class: "muted" }, "Invite code. Share it with your players:"),
    h("p", {}, h("code", { class: "code" }, campaign.inviteCode)),
    h("div", { class: "actions" }, h("button", { class: "btn btn-quiet", type: "button", onclick: copy }, "Copy invite link"), status),
  );
}

function campaignCard(campaign, onCopy) {
  const id = encodeURIComponent(campaign.id);
  return h(
    "article",
    { class: "card stack" },
    h("div", { class: "card-head" }, h("h2", {}, campaign.name), h("span", { class: "badge" }, campaign.isDm ? "DM" : "Player")),
    campaign.isDm && campaign.inviteCode ? inviteBlock(campaign, onCopy) : null,
    h(
      "p",
      {},
      campaign.isDm
        ? h("a", { class: "btn btn-primary", href: `/campaign/${id}/dm` }, "Open DM view")
        : h("a", { class: "btn btn-primary", href: `/campaign/${id}/play` }, "Open my character sheet"),
    ),
  );
}

// Eclipse hosts one campaign (docs/adr/0004), so this is a single-campaign-first
// page: the join and create forms only appear while the person has no campaign.
export function homeView({ profile, campaigns, onCreate, onJoin, onCopy }) {
  if (campaigns.length) {
    return h(
      "div",
      { class: "stack" },
      h("h1", {}, campaigns.length === 1 ? "Your campaign" : "Your campaigns"),
      ...campaigns.map((c) => campaignCard(c, onCopy)),
    );
  }
  return h(
    "div",
    { class: "stack" },
    h("h1", {}, `Welcome, ${profile.display_name}`),
    h("p", { class: "muted" }, "You are not in a campaign yet. Join one with an invite code from your DM, or create one if you are the DM."),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Join a campaign"),
      form({
        fields: [field({ id: "code", label: "Invite code", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", required: true })],
        submitLabel: "Join campaign",
        onSubmit: async (values) => {
          const code = normalizeCode(values.code);
          if (!code) throw invalid("An invite code is 6 or more letters and numbers.");
          await onJoin(code);
        },
      }),
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Create a campaign"),
      h("p", { class: "muted" }, "You become the DM. The invite code is generated for you."),
      form({
        fields: [field({ id: "campaignName", label: "Campaign name", maxlength: 80, required: true })],
        submitLabel: "Create campaign",
        primary: false,
        onSubmit: async (values) => {
          const name = cleanCampaignName(values.campaignName);
          if (!name) throw invalid("Enter a name between 1 and 80 characters.");
          await onCreate(name);
        },
      }),
    ),
  );
}

// Placeholder until the player sheet (Phase 3) and DM roster (Phase 4) exist.
export function campaignStubView({ campaign, kind, inviteCode }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, campaign.name),
    h("span", { class: "badge" }, kind === "dm" ? "DM view" : "Player"),
    h(
      "p",
      { class: "muted" },
      kind === "dm"
        ? "The roster of your players' sheets will appear here."
        : "You have joined this campaign. Your character sheet will appear here.",
    ),
    kind === "dm" && inviteCode ? h("p", {}, "Invite code: ", h("code", { class: "code" }, inviteCode)) : null,
    h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
  );
}
