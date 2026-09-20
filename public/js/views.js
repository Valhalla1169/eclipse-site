// View builders. Each returns a DOM node; app.js decides which to show.
// Text only ever goes in as text nodes (see dom.js), never as markup.
import { h } from "./dom.js";
import { cleanCampaignName, cleanDisplayName, friendlyError, inviteStatus, normalizeCode, normalizeEmail } from "./util.js";

const invalid = (message) => Object.assign(new Error(message), { userMessage: message });

const LABEL = { error: "Error: ", success: "Done: ", info: "Note: " };
const notice = (kind, ...text) =>
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

function selectField({ id, label, options, value }) {
  return h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    h("select", { id, name: id }, ...options.map(([v, text]) => h("option", { value: v, selected: String(v) === String(value) }, text))),
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
    h("p", { class: "muted" }, "Your DM and the other players in your campaign will see this name."),
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

function campaignCard(campaign) {
  const id = encodeURIComponent(campaign.id);
  return h(
    "article",
    { class: "card stack" },
    h("div", { class: "card-head" }, h("h2", {}, campaign.name), h("span", { class: "badge" }, campaign.isDm ? "DM" : "Player")),
    h(
      "p",
      {},
      campaign.isDm
        ? h("a", { class: "btn btn-primary", href: `/campaign/${id}/dm` }, "Open DM view and invites")
        : h("a", { class: "btn btn-primary", href: `/campaign/${id}/play` }, "Open my character sheet"),
    ),
  );
}

// Eclipse hosts one campaign (docs/adr/0004), so this is a single-campaign-first
// page: with a campaign you just see it. Without one you can join with an invite
// and, only if you are on the creator allowlist (ADR 0005), create one.
export function homeView({ profile, campaigns, canCreate, onCreate, onJoin }) {
  if (campaigns.length) {
    return h(
      "div",
      { class: "stack" },
      h("h1", {}, campaigns.length === 1 ? "Your campaign" : "Your campaigns"),
      ...campaigns.map(campaignCard),
    );
  }
  return h(
    "div",
    { class: "stack" },
    h("h1", {}, `Welcome, ${profile.display_name}`),
    h(
      "p",
      { class: "muted" },
      canCreate
        ? "You are not in a campaign yet. Join one with an invite, or create one as the DM."
        : "You are not in a campaign yet. Open the invite link your DM sent you, or paste its code below.",
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Join with an invite"),
      form({
        fields: [field({ id: "code", label: "Invite code", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", required: true })],
        submitLabel: "Join campaign",
        onSubmit: async (values) => {
          const code = normalizeCode(values.code);
          if (!code) throw invalid("That does not look like an invite code. Paste the whole code from your DM.");
          await onJoin(code);
        },
      }),
    ),
    canCreate
      ? h(
          "section",
          { class: "card stack" },
          h("h2", {}, "Create a campaign"),
          h("p", { class: "muted" }, "You become the DM. You then create invite links for your players."),
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
        )
      : null,
  );
}

const USES = [[1, "1 person (recommended)"], [2, "2 people"], [5, "5 people"], [12, "12 people"]];
const LIFETIMES = [[24, "1 day"], [168, "7 days (recommended)"], [720, "30 days"]];

// The DM page: invites now, the roster of sheets in Phase 4. The invite link is
// shown exactly once, when it is created: the database keeps only a hash of the
// code, so it cannot be shown again. Lose it and revoke it, then make a new one.
export function dmView({ campaign, loadInvites, createInvite, revokeInvite, onCopy }) {
  // `fresh` holds the once-only invite link and must never be overwritten by
  // anything else, or a link the DM has not copied yet is lost for good. Errors from
  // revoking go in `problem`.
  const fresh = h("div", { class: "stack" });
  const problem = h("div", { class: "stack" });
  const list = h("div", { class: "stack" });

  async function refresh() {
    try {
      list.replaceChildren(...renderInvites(await loadInvites()));
    } catch (err) {
      console.error(err);
      list.replaceChildren(notice("error", friendlyError(err)));
    }
  }

  async function revoke(event, invite) {
    event.currentTarget.disabled = true;
    problem.replaceChildren();
    try {
      await revokeInvite(invite.id);
    } catch (err) {
      console.error(err);
      problem.replaceChildren(notice("error", friendlyError(err)));
    }
    await refresh();
  }

  function renderInvites(invites) {
    if (!invites.length) return [h("p", { class: "muted" }, "No invites yet. Create one above and send the link to a player.")];
    return [
      h(
        "ul",
        { class: "invites" },
        ...invites.map((invite) => {
          const status = inviteStatus(invite);
          return h(
            "li",
            { class: "invite" },
            h(
              "div",
              { class: "invite-main" },
              h("strong", {}, invite.label || "Invite"),
              h("span", { class: "badge" }, status),
              h("span", { class: "muted" }, `${invite.use_count} of ${invite.max_uses} used`),
              h("span", { class: "muted" }, `expires ${new Date(invite.expires_at).toLocaleString()}`),
            ),
            status === "active"
              ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: (event) => revoke(event, invite) }, "Revoke")
              : null,
          );
        }),
      ),
    ];
  }

  function showNewLink(created) {
    const link = `${location.origin}/join/${encodeURIComponent(created.code)}`;
    const status = h("span", { class: "status", "aria-live": "polite" });
    const copy = async () => {
      try {
        await onCopy(link);
        status.textContent = "Copied.";
      } catch {
        status.textContent = "Could not copy. Select the link and copy it by hand.";
      }
    };
    fresh.replaceChildren(
      h(
        "div",
        { class: "notice notice-success stack", role: "status" },
        h("p", {}, h("strong", {}, "Invite created. "), "This link is shown only once, so copy it now."),
        h("p", {}, h("code", { class: "code linkbox" }, link)),
        h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: copy }, "Copy link"), status),
      ),
    );
  }

  const createForm = form({
    fields: [
      field({ id: "label", label: "Who is it for? (optional)", maxlength: 60, autocomplete: "off", hint: "Only you see this. For example, the player's name." }),
      selectField({ id: "uses", label: "How many people can use it?", options: USES, value: 1 }),
      selectField({ id: "lifetime", label: "How long is it valid?", options: LIFETIMES, value: 168 }),
    ],
    submitLabel: "Create invite link",
    onSubmit: async (values) => {
      const created = await createInvite({
        label: String(values.label || "").trim().slice(0, 60),
        maxUses: Number(values.uses),
        ttlHours: Number(values.lifetime),
      });
      showNewLink(created);
      await refresh();
    },
  });

  refresh();

  return h(
    "div",
    { class: "stack" },
    h("div", { class: "card-head" }, h("h1", {}, campaign.name), h("span", { class: "badge" }, "DM view")),
    h("p", { class: "muted" }, "The roster of your players' sheets will appear here."),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Invite a player"),
      h("p", { class: "muted" }, "Players can only join with a link you create here. Each link expires, has a use limit, and can be revoked."),
      createForm,
      fresh,
    ),
    h("section", { class: "card stack" }, h("h2", {}, "Invites"), problem, list),
  );
}

// Placeholder until the player sheet (Phase 3) exists.
export function playStubView({ campaign }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, campaign.name),
    h("span", { class: "badge" }, "Player"),
    h("p", { class: "muted" }, "You have joined this campaign. Your character sheet will appear here."),
    h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
  );
}
