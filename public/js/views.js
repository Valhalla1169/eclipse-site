// View builders. Each returns a DOM node; the route modules decide which to show.
// Text only ever goes in as text nodes (see dom.js), never as markup.
import { confirmAction } from "./confirm-dialog.js";
import { h } from "./dom.js";
import {
  PASSWORD_MIN_LENGTH,
  cleanCampaignName,
  cleanDisplayName,
  friendlyError,
  normalizeCode,
  normalizeEmail,
  timeAgo,
  validatePassword,
} from "./util.js";

const invalid = (message) => Object.assign(new Error(message), { userMessage: message });

const LABEL = { error: "Error: ", success: "Done: ", info: "Note: " };
// One shared "Error:" / "Done:" / "Note:" line, used everywhere a form or a list
// reports a problem or a result. role defaults by kind; pass null to omit it (a
// status that is part of a card, not its own announcement).
export function notice(kind, text, { role } = {}) {
  return h("p", { class: `notice notice-${kind}`, role: role !== undefined ? role : kind === "error" ? "alert" : "status" }, h("strong", {}, LABEL[kind]), text);
}

export function field({ id, label, hint, ...attrs }) {
  const hintId = hint ? `${id}-hint` : null;
  return h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    hint ? h("p", { class: "hint", id: hintId }, hint) : null,
    h("input", { id, name: id, "aria-describedby": hintId, ...attrs }),
  );
}

export function selectField({ id, label, options, value }) {
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
export function form({ fields, submitLabel, onSubmit, primary = true }) {
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

function passwordField({ id, label, hint, autocomplete }) {
  const input = h("input", {
    id,
    name: id,
    type: "password",
    autocomplete,
    spellcheck: "false",
    autocapitalize: "none",
    required: true,
    "aria-describedby": hint ? `${id}-hint` : null,
  });
  const toggle = h("button", { class: "btn btn-quiet btn-small", type: "button", "aria-pressed": "false", "aria-controls": id }, "Show password");
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.textContent = show ? "Hide password" : "Show password";
  });
  return h(
    "div",
    { class: "field" },
    h("label", { for: id }, label),
    hint ? h("p", { class: "hint", id: `${id}-hint` }, hint) : null,
    input,
    h("p", { class: "toggle-row" }, toggle),
  );
}

// The two boxes for setting a new password, plus one "Show passwords" toggle that
// switches both together; the confirm box has no toggle of its own (issue #5).
// checkMatch runs only after the first box passes validatePassword (rule first,
// one message at a time): it shows "do not match" next to the confirm box, moves
// focus there, and returns false, or clears that state and returns true.
function newPasswordFields({ id, label, hint }) {
  const confirmId = `${id}Confirm`;
  const confirmLabel = label === "New password" ? "Confirm new password" : "Confirm password";
  const input = h("input", {
    id,
    name: id,
    type: "password",
    autocomplete: "new-password",
    spellcheck: "false",
    autocapitalize: "none",
    required: true,
    "aria-describedby": hint ? `${id}-hint` : null,
  });
  const confirmInput = h("input", {
    id: confirmId,
    name: confirmId,
    type: "password",
    autocomplete: "new-password",
    spellcheck: "false",
    autocapitalize: "none",
    required: true,
  });
  const confirmErrorId = `${confirmId}-error`;
  const confirmError = h("p", { class: "notice notice-error", id: confirmErrorId, role: "alert", hidden: true });

  const toggle = h(
    "button",
    { class: "btn btn-quiet btn-small", type: "button", "aria-pressed": "false", "aria-controls": `${id} ${confirmId}` },
    "Show passwords",
  );
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = confirmInput.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.textContent = show ? "Hide passwords" : "Show passwords";
  });

  function clearMismatch() {
    confirmInput.removeAttribute("aria-invalid");
    confirmInput.removeAttribute("aria-describedby");
    confirmError.hidden = true;
    confirmError.replaceChildren();
  }

  function checkMatch(values) {
    if (values[id] === values[confirmId]) {
      clearMismatch();
      return true;
    }
    confirmInput.setAttribute("aria-invalid", "true");
    confirmInput.setAttribute("aria-describedby", confirmErrorId);
    confirmError.hidden = false;
    confirmError.replaceChildren(h("strong", {}, "Error: "), "The two passwords do not match.");
    confirmInput.focus();
    return false;
  }

  return {
    fields: [
      h("div", { class: "field" }, h("label", { for: id }, label), hint ? h("p", { class: "hint", id: `${id}-hint` }, hint) : null, input),
      h("div", { class: "field" }, h("label", { for: confirmId }, confirmLabel), confirmInput, confirmError),
      h("p", { class: "toggle-row" }, toggle),
    ],
    clearMismatch,
    checkMatch,
  };
}

const emailField = (id, label = "Email address") =>
  field({ id, label, type: "email", autocomplete: "email", inputmode: "email", required: true });

const requireEmail = (value) => normalizeEmail(value) || Promise.reject(invalid("Enter a valid email address."));

export function loginView({ heading = "Sign in", intro, authNotice, next, onPassword, onMagicLink }) {
  const query = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return h(
    "div",
    { class: "stack" },
    h(
      "section",
      { class: "card stack" },
      h("h1", {}, heading),
      intro ? h("p", { class: "muted" }, intro) : null,
      authNotice ? notice("error", authNotice) : null,
      form({
        fields: [emailField("email"), passwordField({ id: "password", label: "Password", autocomplete: "current-password" })],
        submitLabel: "Sign in",
        onSubmit: async (values) => {
          const email = await requireEmail(values.email);
          if (!values.password) throw invalid("Enter your password.");
          await onPassword(email, values.password);
        },
      }),
      h("p", {}, h("a", { href: "/forgot-password" }, "Forgot your password?")),
      h("p", {}, "New here? ", h("a", { href: `/signup${query}` }, "Create an account")),
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Or use an email link"),
      h("p", { class: "muted" }, "No password needed. We email you a link. Open it in this browser."),
      form({
        fields: [emailField("linkEmail")],
        submitLabel: "Email me a sign-in link",
        primary: false,
        onSubmit: async (values) => {
          const email = await requireEmail(values.linkEmail);
          await onMagicLink(email);
          return `If ${email} can sign in here, we sent a link. Open it in this browser.`;
        },
      }),
    ),
  );
}

export function signupView({ next, intro, onSubmit }) {
  const query = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  const newPassword = newPasswordFields({ id: "password", label: "Password", hint: `At least ${PASSWORD_MIN_LENGTH} characters. A phrase of several words works well.` });
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Create an account"),
    intro ? h("p", { class: "muted" }, intro) : null,
    h("p", {}, "Only an email that a site admin has approved can make an account here. If yours is not approved yet, ask the site owner."),
    form({
      fields: [
        field({ id: "displayName", label: "Display name", hint: "Your Keeper and the players in your campaigns see this name.", maxlength: 40, autocomplete: "nickname", required: true }),
        emailField("email"),
        ...newPassword.fields,
      ],
      submitLabel: "Create account",
      onSubmit: async (values) => {
        newPassword.clearMismatch();
        const displayName = cleanDisplayName(values.displayName);
        if (!displayName) throw invalid("Enter a name between 1 and 40 characters.");
        const email = await requireEmail(values.email);
        const problem = validatePassword(values.password, { email, displayName });
        if (problem) throw invalid(problem);
        if (!newPassword.checkMatch(values)) return;
        const { signedIn } = await onSubmit({ displayName, email, password: values.password });
        if (!signedIn) return `Check your email. If ${email} is approved and has no account yet, we sent a link to confirm it.`;
      },
    }),
    h("p", {}, "Already have an account? ", h("a", { href: `/login${query}` }, "Sign in")),
  );
}

export function forgotPasswordView({ onSubmit }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Reset your password"),
    h("p", { class: "muted" }, "Enter your email. We will send you a link to choose a new password."),
    form({
      fields: [emailField("email")],
      submitLabel: "Email me a reset link",
      onSubmit: async (values) => {
        const email = await requireEmail(values.email);
        await onSubmit(email);
        return `If an account uses ${email}, we sent a link. Open it in this browser.`;
      },
    }),
    h("p", {}, h("a", { href: "/login" }, "Back to sign in")),
  );
}

export function linkExpiredView() {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "This link does not work"),
    h("p", {}, "It has expired, was already used, or was opened in a different browser."),
    h("p", {}, h("a", { class: "btn btn-primary", href: "/forgot-password" }, "Get a new link")),
  );
}

export function resetPasswordView({ email, displayName, onSubmit }) {
  const newPassword = newPasswordFields({ id: "password", label: "New password", hint: `At least ${PASSWORD_MIN_LENGTH} characters.` });
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Choose a new password"),
    form({
      fields: [...newPassword.fields],
      submitLabel: "Save new password",
      onSubmit: async (values) => {
        newPassword.clearMismatch();
        const problem = validatePassword(values.password, { email, displayName });
        if (problem) throw invalid(problem);
        if (!newPassword.checkMatch(values)) return;
        await onSubmit(values.password);
      },
    }),
  );
}

// `onChangePassword` throws an error with code "reauthentication_needed" when Auth wants a
// fresh proof of identity. The form then asks for the emailed code and tries again.
export function accountView({ profile, email, onRename, onChangeEmail, onChangePassword, onReauthenticate, onSignOutOthers, onSignOutEverywhere }) {
  const nonceField = field({ id: "nonce", label: "Code from your email", autocomplete: "one-time-code", inputmode: "numeric" });
  nonceField.hidden = true;
  const newPassword = newPasswordFields({ id: "newPassword", label: "New password", hint: `At least ${PASSWORD_MIN_LENGTH} characters.` });
  const sessionStatus = h("div", { class: "status", "aria-live": "polite" });
  const sessionAction = (label, action, done) =>
    h("button", { class: "btn btn-quiet", type: "button", onclick: async (event) => {
      event.currentTarget.disabled = true;
      try {
        await action();
        sessionStatus.replaceChildren(notice("success", done));
      } catch (err) {
        console.error(err);
        sessionStatus.replaceChildren(notice("error", friendlyError(err)));
      } finally {
        event.currentTarget.disabled = false;
      }
    } }, label);

  return h(
    "div",
    { class: "stack" },
    h("h1", {}, "Your account"),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Profile"),
      form({
        fields: [field({ id: "displayName", label: "Display name", value: profile.display_name, maxlength: 40, autocomplete: "nickname", required: true })],
        submitLabel: "Save name",
        primary: false,
        onSubmit: async (values) => {
          const name = cleanDisplayName(values.displayName);
          if (!name) throw invalid("Enter a name between 1 and 40 characters.");
          await onRename(name);
          return "Saved.";
        },
      }),
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Email"),
      h("p", {}, "Signed in as ", h("strong", {}, email), "."),
      form({
        fields: [emailField("newEmail", "New email address")],
        submitLabel: "Change email",
        primary: false,
        onSubmit: async (values) => {
          const next = await requireEmail(values.newEmail);
          await onChangeEmail(next);
          return "We sent a link to both addresses. The change happens after you confirm both.";
        },
      }),
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Password"),
      form({
        fields: [...newPassword.fields, nonceField],
        submitLabel: "Change password",
        primary: false,
        onSubmit: async (values) => {
          newPassword.clearMismatch();
          const problem = validatePassword(values.newPassword, { email, displayName: profile.display_name });
          if (problem) throw invalid(problem);
          if (!newPassword.checkMatch(values)) return;
          try {
            await onChangePassword(values.newPassword, String(values.nonce || "").trim() || undefined);
          } catch (err) {
            if (err.code !== "reauthentication_needed") throw err;
            await onReauthenticate();
            nonceField.hidden = false;
            throw invalid("To keep your account safe, we emailed you a code. Enter it above and save again.");
          }
          nonceField.hidden = true;
          return "Your password is changed.";
        },
      }),
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Sessions"),
      h("p", { class: "muted" }, "Signing out here ends this browser only."),
      h(
        "div",
        { class: "actions" },
        sessionAction("Sign out my other devices", onSignOutOthers, "Your other devices are signed out."),
        sessionAction("Sign out everywhere", onSignOutEverywhere, "You are signed out everywhere."),
      ),
      sessionStatus,
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Delete your account"),
      h("p", {}, "Your character sheets are kept safe, so accounts are deleted by the site owner. Ask them to delete yours."),
    ),
  );
}

// active: the player's character in this campaign ({ id, name }), or undefined.
// onLeave(campaignId) leaves the campaign. The database keeps a copy of the active sheet for the DM.
function campaignCard(campaign, active, onLeave) {
  const id = encodeURIComponent(campaign.id);
  const chooser = `/campaign/${id}/character`;
  const status = h("div", { class: "stack" });
  const leave = h("button", { class: "btn btn-quiet", type: "button" }, "Leave campaign");
  leave.addEventListener("click", async () => {
    const message = `Leave ${campaign.name}? Your Keeper keeps a copy of your active character's sheet as it is now. Your characters stay yours. You need a new invite to come back.`;
    if (!(await confirmAction(message, "Leave campaign"))) return;
    leave.disabled = true;
    status.replaceChildren();
    try {
      await onLeave(campaign.id);
    } catch (err) {
      console.error(err);
      status.replaceChildren(notice("error", friendlyError(err)));
      leave.disabled = false;
    }
  });
  return h(
    "article",
    { class: "card stack" },
    h("div", { class: "card-head" }, h("h3", {}, campaign.name), h("span", { class: "badge" }, campaign.isDm ? "Keeper" : "Player")),
    campaign.isDm
      ? h("p", {}, h("a", { class: "btn btn-primary", href: `/campaign/${id}/keeper` }, "Open Keeper view, players and invites"))
      : active
        ? [
            h("p", {}, "Your character: ", h("strong", {}, active.name)),
            h("p", { class: "actions" }, h("a", { class: "btn btn-primary", href: `/characters/${encodeURIComponent(active.id)}` }, "Open my character sheet"), h("a", { class: "btn btn-quiet", href: chooser }, "Change character"), onLeave ? leave : null),
            status,
          ]
        : [
            h("p", { class: "muted" }, "You have not chosen a character for this campaign yet."),
            h("p", { class: "actions" }, h("a", { class: "btn btn-primary", href: chooser }, "Choose a character"), onLeave ? leave : null),
            status,
          ],
  );
}

// The big greeting at the top of the home page, like the one on deyderae.dev.
const hero = (profile, line) =>
  h("section", { class: "hero" }, h("h1", {}, "Welcome, ", h("strong", { class: "accent" }, profile.display_name), "."), h("p", {}, line));

const charactersCard = () =>
  h(
    "section",
    { class: "card stack" },
    h("h2", {}, "Your characters"),
    h("p", { class: "muted" }, "Make and keep your characters here, in or out of a campaign."),
    h("p", {}, h("a", { class: "btn btn-quiet", href: "/characters" }, "Open my characters")),
  );

// Eclipse hosts at most 4 campaigns (docs/adr/0014), so this page shows every campaign
// a person is in. Without one you can join with an invite and, only if you are on the
// creator allowlist (ADR 0005), create one.
// activeByCampaign: { campaignId: { id, name } } for the characters this player has chosen.
export function homeView({ profile, campaigns, activeByCampaign = {}, canCreate, onCreate, onJoin, onLeave }) {
  if (campaigns.length) {
    return h(
      "div",
      { class: "stack" },
      hero(profile, "Pick up where you left off."),
      h("h2", { class: "section-title" }, campaigns.length === 1 ? "Your campaign" : "Your campaigns"),
      ...campaigns.map((campaign) => campaignCard(campaign, activeByCampaign[campaign.id], onLeave)),
      charactersCard(),
    );
  }
  return h(
    "div",
    { class: "stack" },
    hero(profile, "Your characters are yours, in a campaign or not."),
    charactersCard(),
    h(
      "p",
      { class: "muted" },
      canCreate
        ? "You are not in a campaign yet. Join one with an invite, or create one as the Keeper."
        : "You are not in a campaign yet. Open the invite link your Keeper sent you, or paste its code below.",
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
          if (!code) throw invalid("That does not look like an invite code. Paste the whole code from your Keeper.");
          await onJoin(code);
        },
      }),
    ),
    canCreate
      ? h(
          "section",
          { class: "card stack" },
          h("h2", {}, "Create a campaign"),
          h("p", { class: "muted" }, "You become the Keeper. You then create invite links for your players."),
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

// What an invite is for, and one click to join it. preview: { campaign_name, dm_name }.
export function joinView({ preview, onJoin }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, `Join ${preview.campaign_name}?`),
    h("p", {}, h("strong", {}, preview.dm_name), " runs this campaign. If you join, you become a player. Your Keeper can see the character you choose for it, and you can leave later."),
    form({
      fields: [],
      submitLabel: "Yes, join this campaign",
      onSubmit: async () => {
        await onJoin();
      },
    }),
    h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Not now")),
  );
}

// A link to send to someone, with a Copy link button.
export function linkNotice({ heading, text, link, onCopy }) {
  const status = h("span", { class: "status", "aria-live": "polite" });
  const copy = async () => {
    try {
      await onCopy(link);
      status.textContent = "Copied.";
    } catch {
      status.textContent = "Could not copy. Select the link and copy it by hand.";
    }
  };
  return h(
    "div",
    { class: "notice notice-success stack", role: "status" },
    h("p", {}, h("strong", {}, heading), text),
    h("p", {}, h("code", { class: "code linkbox" }, link)),
    h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: copy }, "Copy link"), status),
  );
}

// The site admin page (docs/adr/0014): approve an email so that its owner can make an
// account, renew or revoke an approval that no confirmed account uses, and see every account.
// loadPurges lists characters deleted forever (docs/adr/0018), for the Admin page only.
export function adminView({ loadAccounts, loadPending, approveEmail, revokeApproval, loadPurges, onCopy }) {
  const fresh = h("div", { class: "stack" });
  const problem = h("div", { class: "stack" });
  const pending = h("div", { class: "stack" });
  const accounts = h("div", { class: "stack" });
  const purges = h("div", { class: "stack" });
  const pendingTitle = h("h2", {}, "Waiting for an account");
  const expired = (approval) => new Date(approval.expires_at).getTime() <= Date.now();
  const day = (iso) => new Date(iso).toLocaleDateString();

  async function refresh() {
    try {
      const [waiting, people, purged] = await Promise.all([loadPending(), loadAccounts(), loadPurges()]);
      const current = waiting.filter((approval) => !expired(approval));
      const old = waiting.filter(expired);
      pendingTitle.textContent = `Waiting for an account (${current.length})`;
      pending.replaceChildren(
        current.length ? h("ul", { class: "invites" }, ...current.map(approvalRow)) : h("p", { class: "muted" }, "No approved email is waiting for an account."),
        ...(old.length ? [h("details", {}, h("summary", {}, `Expired approvals (${old.length})`), h("ul", { class: "invites" }, ...old.map(approvalRow)))] : []),
      );
      accounts.replaceChildren(h("ul", { class: "invites" }, ...people.map(accountRow)));
      purges.replaceChildren(purged.length ? h("ul", { class: "invites" }, ...purged.map(purgeRow)) : h("p", { class: "muted" }, "Nobody has deleted a character forever."));
    } catch (err) {
      console.error(err);
      pending.replaceChildren(notice("error", friendlyError(err)));
    }
  }

  // Throws what approveEmail throws. Shows the link to send, or says that none is needed.
  async function approve(email) {
    const approved = await approveEmail(email);
    fresh.replaceChildren(
      approved.has_account
        ? notice("info", `${approved.email} already has an account, so it needs no approval.`)
        : linkNotice({
            heading: "Approved. ",
            text: `Send this link to ${approved.email} and ask them to make their account now, with exactly this email. The approval ends on ${day(approved.expires_at)}.`,
            link: `${location.origin}/signup`,
            onCopy,
          }),
    );
    await refresh();
  }

  const act = (action) => async (event) => {
    event.currentTarget.disabled = true;
    problem.replaceChildren();
    try {
      await action();
    } catch (err) {
      console.error(err);
      problem.replaceChildren(notice("error", friendlyError(err)));
    }
    await refresh();
  };

  const approvalRow = (approval) =>
    h(
      "li",
      { class: "invite" },
      h(
        "div",
        { class: "invite-main" },
        h("strong", {}, approval.email),
        expired(approval) ? h("span", { class: "badge" }, "expired") : null,
        h("span", { class: "muted" }, `approved ${day(approval.approved_at)}${approval.approved_by_name ? ` by ${approval.approved_by_name}` : ""}`),
        expired(approval) ? null : h("span", { class: "muted" }, `ends ${day(approval.expires_at)}`),
      ),
      h(
        "div",
        { class: "actions" },
        expired(approval) ? h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: act(() => approve(approval.email)) }, "Approve again") : null,
        h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: act(() => revokeApproval(approval.email)) }, "Revoke"),
      ),
    );

  const accountRow = (account) =>
    h(
      "li",
      { class: "invite" },
      h(
        "div",
        { class: "invite-main" },
        h("strong", {}, account.display_name || account.email),
        account.is_admin ? h("span", { class: "badge" }, "Admin") : null,
        account.email_confirmed_at ? null : h("span", { class: "badge badge-alert" }, "Not confirmed"),
        h("span", {}, account.email),
        h("span", { class: "muted" }, `joined ${day(account.created_at)}`),
        h("span", { class: "muted" }, account.last_sign_in_at ? `last signed in ${timeAgo(account.last_sign_in_at)}` : "never signed in"),
      ),
    );

  const purgeRow = (purge) =>
    h(
      "li",
      { class: "invite" },
      h(
        "div",
        { class: "invite-main" },
        h("span", { class: "muted" }, day(purge.purged_at)),
        h("strong", {}, purge.owner_name),
        h("span", { class: "code" }, purge.character_id),
      ),
    );

  const approveForm = form({
    fields: [emailField("approveEmail", "Email address")],
    submitLabel: "Approve email",
    onSubmit: async (values) => {
      await approve(await requireEmail(values.approveEmail));
      approveForm.reset();
    },
  });

  refresh();

  return h(
    "div",
    { class: "stack" },
    h("h1", {}, "Site admin"),
    h("p", { class: "muted" }, "Only an email approved here can make an account. A site admin approves people for the site. A Keeper runs a campaign and invites players to it."),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Approve an email"),
      h(
        "p",
        { class: "muted" },
        "An approval lasts 7 days, and at most 20 can wait for an account at one time. Until the person makes their account, anyone who knows the email could make it first, so ask them to sign up right away.",
      ),
      approveForm,
      fresh,
    ),
    h("section", { class: "card stack" }, pendingTitle, problem, pending),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Accounts"),
      h(
        "p",
        { class: "muted" },
        "Not confirmed means the account's email is not confirmed yet. If the person did not make that account, someone else did: the site owner deletes it in the Supabase dashboard (Authentication, Users), then approve the email again.",
      ),
      accounts,
    ),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Deleted forever"),
      h("p", { class: "muted" }, "A player can delete their own archived character forever. This is the log: who, when, and the character's id. No name and no sheet data are kept."),
      purges,
    ),
  );
}

// A DM runs the campaign and has no sheet of their own (docs/adr/0001).
export function dmHasNoSheetView({ campaign }) {
  return h(
    "section",
    { class: "card stack" },
    h("div", { class: "card-head" }, h("h1", {}, campaign.name), h("span", { class: "badge" }, "Keeper")),
    h("p", {}, "You are the Keeper of this campaign. A Keeper does not have a character sheet."),
    h("p", {}, h("a", { class: "btn btn-primary", href: `/campaign/${campaign.id}/keeper` }, "Open the Keeper page"), " ", h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
  );
}

// The stored sheet could not be read. The stored copy is left exactly as it is.
export function sheetUnreadableView({ ownSheet = true }) {
  return h(
    "section",
    { class: "card stack" },
    h("h1", {}, "Character sheet"),
    notice(
      "error",
      ownSheet
        ? "Your character sheet could not be read, so it is not shown. Nothing was changed or saved. Tell the site owner, who can recover it."
        : "This character sheet could not be read, so it is not shown. Nothing was changed. The roster's download button still saves it as stored.",
    ),
    h("p", {}, h("a", { class: "btn btn-quiet", href: "/" }, "Back to home")),
  );
}
