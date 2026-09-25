import { blank } from "../../public/js/eclipse-rules.js";
import { GOOD_PASSWORD, assignmentRow, callsTo, campaign, characterRow, expect, ids, open, patchMock, players, seed, sheetPath, test } from "./helpers.js";

const { dana, dm } = players;
const submit = (page, name) => page.getByRole("button", { name, exact: true }).click();
const chooserPath = new RegExp(`/campaign/${ids.campaign}/character$`);

test.describe("home", () => {
  test("a player with no campaign can join, and cannot create", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/");
    await expect(page.getByRole("heading", { name: "Welcome, Dana Voss" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Join with an invite" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a campaign" })).toHaveCount(0);
    await expect(page.getByText("Open the invite link your Keeper sent you")).toBeVisible();
  });

  test("a creator can create a campaign and then sees it as Keeper", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, creator: true }, user: dm });
    await open(page, "/");
    await page.locator("#campaignName").fill("  Age   of Eclipse ");
    await submit(page, "Create campaign");
    await expect(page.getByRole("heading", { name: "Your campaign" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Age of Eclipse" })).toBeVisible();
    await expect(page.locator(".badge")).toHaveText("Keeper");
    const [post] = await callsTo(page, "/rest/v1/campaigns", "POST");
    expect(post.body).toEqual({ dm_id: ids.dm, name: "Age of Eclipse" });
    await expect(page.getByRole("link", { name: "Open Keeper view, players and invites" })).toBeVisible();
  });

  test("refuses a blank campaign name", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, creator: true }, user: dm });
    await open(page, "/");
    await page.locator("#campaignName").fill("   ");
    await submit(page, "Create campaign");
    await expect(page.getByRole("alert")).toContainText("Enter a name between 1 and 80 characters.");
    expect(await callsTo(page, "/rest/v1/campaigns", "POST")).toHaveLength(0);
  });

  test("a player sees their campaign and opens their character's sheet", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character: characterRow(blank()), assignments: [assignmentRow()] }, user: dana });
    await open(page, "/");
    await expect(page.locator("article .badge")).toHaveText("Player");
    await page.getByRole("link", { name: "Open my character sheet" }).click();
    await expect(page).toHaveURL(new RegExp(`${sheetPath()}$`));
    await expect(page.locator("#f_name")).toBeVisible();
  });

  test("a server failure shows a retry, and retry recovers", async ({ page }) => {
    test.setTimeout(30_000);
    await seed(page, { mock: { profile: dana.profile, failNetwork: true }, user: dana });
    await page.goto("/");
    // The client retries a failed read with growing pauses (about 7 seconds) before it gives up.
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("alert")).toContainText("Could not reach the server.");
    await patchMock(page, { failNetwork: false });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Welcome, Dana Voss" })).toBeVisible();
  });
});

test.describe("joining", () => {
  const joinable = { ABCDEF0123: { id: ids.campaign, name: "Age of Eclipse", dmName: "Ravi the Keeper" } };
  const confirmJoin = (page) => page.getByRole("button", { name: "Yes, join this campaign" }).click();

  test("a pasted code is cleaned up, shows what it is for, and joins only when confirmed", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, joinable }, user: dana });
    await open(page, "/");
    await page.locator("#code").fill("  abcdef0123 ");
    await submit(page, "Join campaign");
    await expect(page.getByRole("heading", { name: "Join Age of Eclipse?" })).toBeVisible();
    await expect(page.getByText("Ravi the Keeper runs this campaign.")).toBeVisible();
    const [preview] = await callsTo(page, "/rest/v1/rpc/preview_invite");
    expect(preview.body).toEqual({ p_invite_code: "ABCDEF0123" });
    expect(await callsTo(page, "/rest/v1/rpc/join_campaign")).toHaveLength(0);
    await confirmJoin(page);
    await expect(page).toHaveURL(chooserPath);
    await expect(page.getByRole("heading", { name: "Age of Eclipse" })).toBeVisible();
    const [rpc] = await callsTo(page, "/rest/v1/rpc/join_campaign");
    expect(rpc.body).toEqual({ p_invite_code: "ABCDEF0123" });
  });

  test("Not now goes home and joins nothing", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, joinable }, user: dana });
    await open(page, "/join/ABCDEF0123");
    await page.getByRole("link", { name: "Not now" }).click();
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    expect(await callsTo(page, "/rest/v1/rpc/join_campaign")).toHaveLength(0);
  });

  test("someone who is already in the campaign goes straight to it, with no confirmation", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, joinable: { ABCDEF0123: { ...joinable.ABCDEF0123, member: true } }, campaigns: [campaign] }, user: dana });
    await open(page, "/join/ABCDEF0123");
    await expect(page).toHaveURL(chooserPath);
    expect(await callsTo(page, "/rest/v1/rpc/join_campaign")).toHaveLength(0);
  });

  test("a refusal while joining is shown and nothing changes", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, joinable }, user: dana });
    await open(page, "/join/ABCDEF0123");
    await patchMock(page, { joinError: "invalid invite code" });
    await confirmJoin(page);
    await expect(page.getByRole("alert")).toContainText("That invite code is not valid.");
    await expect(page).toHaveURL(/\/join\/ABCDEF0123$/);
  });

  test("a code that cannot be a code never reaches the server", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/");
    await page.locator("#code").fill("abc");
    await submit(page, "Join campaign");
    await expect(page.getByRole("alert")).toContainText("does not look like an invite code");
    expect(await callsTo(page, "/rest/v1/rpc/join_campaign")).toHaveLength(0);
  });

  test("a wrong code shows a plain message", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/join/ZZZZZZZZ");
    await expect(page.getByRole("alert")).toContainText("That invite code is not valid. Check it with your Keeper.");
  });

  test("a badly formed invite link is refused without a request", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/join/abc");
    await expect(page.getByText("That invite link does not look right.")).toBeVisible();
    expect(await callsTo(page, "/rest/v1/rpc/join_campaign")).toHaveLength(0);
  });

  test("an invite link works for someone who signs in first", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, joinable } });
    await open(page, "/join/ABCDEF0123");
    await expect(page).toHaveURL(/\/login\?next=%2Fjoin%2FABCDEF0123$/);
    await page.locator("#email").fill("dana@example.com");
    await page.locator("#password").fill(GOOD_PASSWORD);
    await submit(page, "Sign in");
    await expect(page.getByRole("heading", { name: "Join Age of Eclipse?" })).toBeVisible();
    await confirmJoin(page);
    await expect(page).toHaveURL(chooserPath);
    await expect(page.getByRole("heading", { name: "Age of Eclipse" })).toBeVisible();
  });

  test("the Keeper of a campaign cannot join it as a player", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, joinError: "you run this campaign" }, user: dm });
    await open(page, "/join/ABCDEF0123");
    await expect(page.getByRole("alert")).toContainText("You are the Keeper of this campaign");
  });
});

test.describe("campaign pages", () => {
  test("an id that is not a UUID is not found", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/campaign/not-a-uuid/keeper");
    await expect(page.getByText("We could not find that campaign.")).toBeVisible();
    expect(await callsTo(page, "/rest/v1/campaigns")).toHaveLength(0);
  });

  test("a campaign you cannot see is not found", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], hideCampaign: true }, user: dana });
    await open(page, `/campaign/${ids.campaign}/character`);
    await expect(page.getByText("or you are not a member of it")).toBeVisible();
  });

  test("a player cannot open the Keeper page", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign] }, user: dana });
    await open(page, `/campaign/${ids.campaign}/keeper`);
    await expect(page.getByText("Only the Keeper of this campaign can open this page.")).toBeVisible();
    expect(await callsTo(page, "/rest/v1/campaign_invites")).toHaveLength(0);
  });

  test("signed out, a campaign page returns you to it after sign-in", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign] } });
    await open(page, `/campaign/${ids.campaign}/character`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.locator("#email").fill("dana@example.com");
    await page.locator("#password").fill(GOOD_PASSWORD);
    await submit(page, "Sign in");
    await expect(page).toHaveURL(chooserPath);
  });
});

test.describe("Keeper page and invites", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, creator: true, campaigns: [campaign] }, user: dm });
    await open(page, `/campaign/${ids.campaign}/keeper`);
  });

  test("shows an empty invite list", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Age of Eclipse" })).toBeVisible();
    await expect(page.getByText("No invites yet.")).toBeVisible();
  });

  test("creating an invite shows the link once and lists the invite without it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#label").fill("Dana");
    await submit(page, "Create invite link");
    const link = page.locator("code.linkbox");
    await expect(link).toHaveText(/\/join\/ABCDEF0123456789ABCDEF012345AB$/);

    const [rpc] = await callsTo(page, "/rest/v1/rpc/create_invite");
    expect(rpc.body).toEqual({ p_campaign_id: ids.campaign, p_label: "Dana", p_max_uses: 1, p_ttl_hours: 168 });

    const row = page.locator("li.invite");
    await expect(row).toContainText("Dana");
    await expect(row).toContainText("active");
    await expect(row).toContainText("0 of 1 used");
    await expect(row).not.toContainText("ABCDEF0123456789");

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.innerText());
  });

  test("revoking an invite marks it revoked and removes the button", async ({ page }) => {
    await submit(page, "Create invite link");
    await page.getByRole("button", { name: "Revoke" }).click();
    const row = page.locator("li.invite");
    await expect(row).toContainText("revoked");
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });

  test("a failed revoke shows an error and keeps the once-only link on screen", async ({ page }) => {
    await submit(page, "Create invite link");
    await expect(page.locator("code.linkbox")).toBeVisible();
    await patchMock(page, { revokeError: "invite not found, already revoked, or not yours" });
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("alert")).toContainText("That invite could not be revoked.");
    await expect(page.locator("code.linkbox")).toBeVisible();
  });

  test("the create form's limits are sent as chosen", async ({ page }) => {
    await page.locator("#uses").selectOption("5");
    await page.locator("#lifetime").selectOption("24");
    await submit(page, "Create invite link");
    const [rpc] = await callsTo(page, "/rest/v1/rpc/create_invite");
    expect(rpc.body).toMatchObject({ p_max_uses: 5, p_ttl_hours: 24, p_label: null });
  });

  test("a server refusal is shown without raw database text", async ({ page }) => {
    await patchMock(page, { createInviteError: 'new row violates row-level security policy for table "campaign_invites"' });
    await submit(page, "Create invite link");
    await expect(page.getByRole("alert")).toHaveText("Error: You do not have access to that.");
    await expect(page.locator("code.linkbox")).toHaveCount(0);
  });
});
