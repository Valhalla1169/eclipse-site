import { blank } from "../../public/js/eclipse-rules.js";
import { assignmentRow, callsTo, campaign, characterRow, expect, ids, open, patchMock, players, seed, test } from "./helpers.js";

const { dana, dm } = players;
const DM_PAGE = `/campaign/${ids.campaign}/dm`;
const RAVI = "00000000-0000-4000-8000-0000000000b2";
const ZED = "00000000-0000-4000-8000-0000000000b4";

const named = (name) => {
  const data = blank();
  data.id.name = name;
  return data;
};
const DANA_ROW = characterRow(named("Marlo Vance"), { id: "40000000-0000-4000-8000-0000000000c1" });
const RAVI_ROW = characterRow(named("Vex"), { id: "40000000-0000-4000-8000-0000000000c2", owner_id: RAVI });
const ZED_COPY = {
  id: 7,
  campaign_id: ids.campaign,
  player_id: ZED,
  character_id: "40000000-0000-4000-8000-0000000000c4",
  character_name: "Old hand",
  schema_version: 1,
  data: named("Old hand"),
  reason: "left",
  kept_at: "2026-09-10T12:00:00.000000+00:00",
};

const invite = (id, extra = {}) => ({
  id: `30000000-0000-4000-8000-0000000000${id}`,
  campaign_id: ids.campaign,
  label: null,
  created_at: "2026-09-18T10:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
  max_uses: 1,
  use_count: 0,
  revoked_at: null,
  ...extra,
});
const SAM = invite("01", { label: "Sam", use_count: 1 });
const ACTIVE = invite("02", { label: "for Pia", max_uses: 3, use_count: 1 });

const scenario = (mock = {}) => ({
  profile: dm.profile,
  creator: true,
  campaigns: [campaign],
  members: [
    { player_id: ids.player, joined_at: "2026-09-01T00:00:00Z", invite_id: SAM.id },
    { player_id: RAVI, joined_at: "2026-09-02T00:00:00Z", invite_id: null },
  ],
  profiles: [dana.profile, { id: RAVI, display_name: "Ravi" }, { id: ZED, display_name: "Zed" }],
  characters: [DANA_ROW, RAVI_ROW],
  assignments: [assignmentRow(DANA_ROW.id), assignmentRow(RAVI_ROW.id, { player_id: RAVI })],
  departed: [],
  invites: [ACTIVE, SAM],
  ...mock,
});
async function openDmPage(page, mock = {}) {
  await seed(page, { mock: scenario(mock), user: dm });
  await open(page, DM_PAGE);
  await expect(page.locator(".roster > li").first()).toBeVisible();
}
const cards = (page) => page.locator(".roster > li");
const rpc = (page, name) => callsTo(page, `/rest/v1/rpc/${name}`, "POST");

test.describe("replacing a lost link", () => {
  test("ends the old invite, makes a new one like it, and shows the link once", async ({ page }) => {
    await openDmPage(page);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("li.invite", { hasText: "for Pia" }).getByRole("button", { name: "Replace link" }).click();
    await expect(page.locator("code.linkbox")).toHaveText(/\/join\/REPLACED0123456789ABCDEF012345$/);
    await expect(page.getByText("New link made. The old one no longer works.")).toBeVisible();
    const [call] = await rpc(page, "replace_invite");
    expect(call.body).toEqual({ p_invite_id: ACTIVE.id });
    await expect(page.locator("ul.invites").first().locator("li.invite")).toHaveCount(1);
    await expect(page.locator("ul.invites").first()).toContainText("for Pia");
    await expect(page.locator("ul.invites").first()).toContainText("0 of 2 used");
    await expect(page.getByText("Older invites (2)")).toBeVisible();
  });

  test("asks first, and does nothing if the DM says no", async ({ page }) => {
    await openDmPage(page);
    const messages = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      dialog.dismiss();
    });
    await page.locator("li.invite", { hasText: "for Pia" }).getByRole("button", { name: "Replace link" }).click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("end the old one");
    expect(await rpc(page, "replace_invite")).toHaveLength(0);
  });

  test("a refusal is shown in plain words, and the old link stays", async ({ page }) => {
    await openDmPage(page, { replaceError: "that invite is not active, or is not yours" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("li.invite", { hasText: "for Pia" }).getByRole("button", { name: "Replace link" }).click();
    await expect(page.getByRole("alert")).toContainText("That invite is no longer active.");
    await expect(page.locator("code.linkbox")).toHaveCount(0);
  });

  test("only an active invite can be replaced", async ({ page }) => {
    await openDmPage(page);
    await expect(page.getByRole("button", { name: "Replace link" })).toHaveCount(1);
  });
});

test.describe("the invite list", () => {
  test("shows active invites, and folds away the used, expired and revoked ones", async ({ page }) => {
    await openDmPage(page, { invites: [ACTIVE, SAM, invite("03", { label: "old", expires_at: "2020-01-01T00:00:00.000Z" }), invite("04", { label: "gone", revoked_at: "2026-09-19T00:00:00.000Z" })] });
    const main = page.locator("ul.invites").first();
    await expect(main.locator("li.invite")).toHaveCount(1);
    await expect(main).toContainText("for Pia");
    const older = page.locator("details", { hasText: "Older invites (3)" });
    await expect(older.locator("li.invite")).toHaveCount(3);
    await expect(older.locator("li.invite").first()).toBeHidden();
    await older.getByText("Older invites (3)").click();
    await expect(older.locator("li.invite").first()).toBeVisible();
    await expect(older.getByRole("button")).toHaveCount(0);
  });

  test("with nothing active it says so, and the older ones are still there", async ({ page }) => {
    await openDmPage(page, { invites: [SAM] });
    await expect(page.getByText("No active invites.")).toBeVisible();
    await expect(page.getByText("Older invites (1)")).toBeVisible();
  });

  test("the limit on active invites is explained", async ({ page }) => {
    await openDmPage(page, { createInviteError: "this campaign already has 50 active invites. Revoke one first" });
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(page.getByRole("alert")).toContainText("This campaign already has 50 active invites. Revoke one first.");
  });
});

test.describe("which invite each player used", () => {
  test("a card names the invite, or says it had no name, or says nothing for an old member", async ({ page }) => {
    await openDmPage(page, {
      members: [
        { player_id: ids.player, joined_at: "2026-09-01T00:00:00Z", invite_id: SAM.id },
        { player_id: RAVI, joined_at: "2026-09-02T00:00:00Z", invite_id: invite("09").id },
      ],
      invites: [SAM, invite("09")],
    });
    await expect(cards(page).nth(0)).toContainText('Joined with the invite "Sam".');
    await expect(cards(page).nth(1)).toContainText("Joined with an invite that has no name.");
    await patchMock(page, { members: [{ player_id: ids.player, joined_at: "2026-09-01T00:00:00Z" }, { player_id: RAVI, joined_at: "2026-09-02T00:00:00Z" }] });
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(cards(page).nth(0)).not.toContainText("Joined with");
  });
});

test.describe("removing a player", () => {
  const removeButton = (page, index) => cards(page).nth(index).getByRole("button", { name: "Remove from campaign" });

  test("asks first, then moves the player to former players with a copy of their sheet", async ({ page }) => {
    await openDmPage(page);
    const messages = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      dialog.accept();
    });
    await removeButton(page, 1).click();
    await expect(page.getByText("Ravi was removed. Their sheet is kept under Former players.")).toBeVisible();
    expect(messages[0]).toContain("You keep a copy of their active sheet as it is now");
    expect(messages[0]).toContain("They need a new invite to come back");
    const [call] = await rpc(page, "remove_player");
    expect(call.body).toEqual({ p_campaign_id: ids.campaign, p_player_id: RAVI });
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Former players" })).toBeVisible();
    await expect(page.locator("ul.roster").nth(1)).toContainText("Vex");
    await expect(page.locator("ul.roster").nth(1)).toContainText("as it was when you removed them");
  });

  test("does nothing if the DM says no", async ({ page }) => {
    await openDmPage(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await removeButton(page, 1).click();
    expect(await rpc(page, "remove_player")).toHaveLength(0);
    await expect(cards(page)).toHaveCount(2);
  });

  test("a refusal is shown, and the player stays", async ({ page }) => {
    await openDmPage(page, { removeError: "only the DM of this campaign can remove a player" });
    page.once("dialog", (dialog) => dialog.accept());
    await removeButton(page, 1).click();
    await expect(page.getByText("Ravi was not removed. Only the DM of this campaign can do that.")).toBeVisible();
    await expect(removeButton(page, 1)).toBeEnabled();
  });

  test("a member with no character chosen can be removed too, and a former player has no Remove", async ({ page }) => {
    await openDmPage(page, { assignments: [assignmentRow(DANA_ROW.id)], departed: [ZED_COPY] });
    await expect(removeButton(page, 1)).toBeVisible();
    await expect(page.locator("ul.roster").nth(1).getByRole("button", { name: "Remove from campaign" })).toHaveCount(0);
  });
});

test.describe("inviting a former player again", () => {
  test("fills in the invite form with their name and creates nothing until the DM does", async ({ page }) => {
    await openDmPage(page, { departed: [ZED_COPY] });
    await page.locator("ul.roster").nth(1).getByRole("button", { name: "Invite again" }).click();
    await expect(page.locator("#label")).toHaveValue("Zed");
    await expect(page.getByText("Ready to invite Zed again. Press Create invite link.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invite link" })).toBeFocused();
    expect(await rpc(page, "create_invite")).toHaveLength(0);
    await page.getByRole("button", { name: "Create invite link" }).click();
    const [call] = await rpc(page, "create_invite");
    expect(call.body).toMatchObject({ p_label: "Zed", p_max_uses: 1, p_ttl_hours: 168 });
    await expect(page.locator("code.linkbox")).toBeVisible();
  });

  test("a link that has not been copied yet is not lost when the form is filled in", async ({ page }) => {
    await openDmPage(page, { departed: [ZED_COPY] });
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(page.locator("code.linkbox")).toBeVisible();
    await page.locator("ul.roster").nth(1).getByRole("button", { name: "Invite again" }).click();
    await expect(page.locator("code.linkbox")).toBeVisible();
  });
});

test.describe("leaving a campaign", () => {
  const playerScenario = (mock = {}) => ({ profile: dana.profile, campaigns: [campaign], characters: [DANA_ROW], assignments: [assignmentRow(DANA_ROW.id)], ...mock });
  const leave = (page) => page.getByRole("button", { name: "Leave campaign" });

  test("asks first, explains what the DM keeps, and then the campaign is gone from the home page", async ({ page }) => {
    await seed(page, { mock: playerScenario(), user: dana });
    await open(page, "/");
    const messages = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      dialog.accept();
    });
    await leave(page).click();
    await expect(page.getByText("You are not in a campaign yet.")).toBeVisible();
    expect(messages[0]).toContain("Your DM keeps a copy of your active character's sheet as it is now");
    expect(messages[0]).toContain("Your characters stay yours");
    expect(messages[0]).toContain("You need a new invite to come back");
    const [call] = await rpc(page, "leave_campaign");
    expect(call.body).toEqual({ p_campaign_id: ids.campaign });
    await page.getByRole("link", { name: "Open my characters" }).click();
    await expect(page.locator("ul.characters > li")).toHaveCount(1);
  });

  test("does nothing if the player says no", async ({ page }) => {
    await seed(page, { mock: playerScenario(), user: dana });
    await open(page, "/");
    page.once("dialog", (dialog) => dialog.dismiss());
    await leave(page).click();
    expect(await rpc(page, "leave_campaign")).toHaveLength(0);
    await expect(page.getByText("Your character: Marlo Vance")).toBeVisible();
  });

  test("is there before a character is chosen, and a refusal is shown", async ({ page }) => {
    await seed(page, { mock: playerScenario({ assignments: [], leaveError: "not signed in" }), user: dana });
    await open(page, "/");
    page.once("dialog", (dialog) => dialog.accept());
    await leave(page).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(leave(page)).toBeEnabled();
  });

  test("a DM has no Leave button", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, campaigns: [campaign] }, user: dm });
    await open(page, "/");
    await expect(page.getByRole("button", { name: "Leave campaign" })).toHaveCount(0);
  });
});
