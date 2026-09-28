// The Keeper's invite panel (docs/adr/0005, 0012): create a link, replace or revoke
// one, and see every invite for the campaign. The invite link is shown exactly once,
// when it is created: the database keeps only a hash of the code, so it cannot be
// shown again. Lose it and revoke it, then make a new one.
import { confirmAction } from "./confirm-dialog.js";
import { h } from "./dom.js";
import { field, form, linkNotice, notice, selectField } from "./views.js";
import { friendlyError, inviteStatus } from "./util.js";

const USES = [[1, "1 person (recommended)"], [2, "2 people"], [5, "5 people"], [12, "12 people"]];
const LIFETIMES = [[24, "1 day"], [168, "7 days (recommended)"], [720, "30 days"]];

// loadInvites, createInvite, replaceInvite and revokeInvite are already bound to one
// campaign. registerPrefill(fn) gives the page a function that fills in the invite
// form for a named player.
export function createInvitePanel({ loadInvites, createInvite, replaceInvite, revokeInvite, onCopy, registerPrefill }) {
  // `fresh` holds the once-only invite link and must never be overwritten by
  // anything else, or a link the Keeper has not copied yet is lost for good. Errors from
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

  async function replace(event, invite) {
    const button = event.currentTarget;
    const message = `Make a new link${invite.label ? ` for ${invite.label}` : ""} and end the old one? Anyone with the old link can no longer use it.`;
    if (!(await confirmAction(message, "Replace link"))) return;
    button.disabled = true;
    problem.replaceChildren();
    try {
      showNewLink(await replaceInvite(invite.id), "New link made. The old one no longer works. ");
    } catch (err) {
      console.error(err);
      problem.replaceChildren(notice("error", friendlyError(err)));
    }
    await refresh();
  }

  const inviteRow = (invite) => {
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
        ? h(
            "div",
            { class: "actions" },
            h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: (event) => replace(event, invite) }, "Replace link"),
            h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: (event) => revoke(event, invite) }, "Revoke"),
          )
        : null,
    );
  };

  // Active invites first. The rest (used up, expired, revoked) are folded away.
  function renderInvites(invites) {
    if (!invites.length) return [h("p", { class: "muted" }, "No invites yet. Create one above and send the link to a player.")];
    const active = invites.filter((invite) => inviteStatus(invite) === "active");
    const older = invites.filter((invite) => inviteStatus(invite) !== "active");
    return [
      active.length ? h("ul", { class: "invites" }, ...active.map(inviteRow)) : h("p", { class: "muted" }, "No active invites."),
      older.length ? h("details", {}, h("summary", {}, `Older invites (${older.length})`), h("ul", { class: "invites" }, ...older.map(inviteRow))) : null,
    ];
  }

  function showNewLink(created, heading = "Invite created. ") {
    const link = `${location.origin}/join/${encodeURIComponent(created.code)}`;
    fresh.replaceChildren(linkNotice({ heading, text: "This link is shown only once, so copy it now.", link, onCopy }));
  }

  const labelField = field({ id: "label", label: "Who is it for? (optional)", maxlength: 60, autocomplete: "off", hint: "Only you see this. For example, the player's name." });
  const createForm = form({
    fields: [
      labelField,
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

  // Not `fresh`: that one holds a link the Keeper has not copied yet.
  const prefillNote = h("p", { class: "muted", role: "status", "aria-live": "polite" });
  const createSection = h(
    "section",
    { class: "card stack" },
    h("h2", {}, "Invite a player"),
    h("p", { class: "muted" }, "Players can only join with a link you create here. Each link expires, has a use limit, and can be revoked."),
    createForm,
    prefillNote,
    fresh,
  );
  if (registerPrefill) {
    registerPrefill((name) => {
      labelField.querySelector("input").value = String(name).slice(0, 60);
      prefillNote.textContent = `Ready to invite ${name} again. Press Create invite link.`;
      createSection.scrollIntoView({ block: "center" });
      createForm.querySelector('button[type="submit"]').focus();
    });
  }

  refresh();

  return {
    element: h("div", { class: "two-up" }, createSection, h("section", { class: "card stack" }, h("h2", {}, "Invites"), problem, list)),
  };
}
