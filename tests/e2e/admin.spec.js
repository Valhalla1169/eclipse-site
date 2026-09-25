import { callsTo, expect, open, patchMock, players, seed, storedMock, test } from "./helpers.js";

// The site admin page (docs/adr/0014). A site admin approves the emails that can make an
// account. The fake refuses the admin functions to anyone whose `admin` flag is off.
const { dana } = players;
const ADA = { id: "00000000-0000-4000-8000-0000000000e1", email: "ada@example.com", profile: { id: "00000000-0000-4000-8000-0000000000e1", display_name: "Ada Admin" } };
const CONFIRMED = "2026-09-01T11:00:00.000Z";
const inDays = (days) => new Date(Date.now() + days * 86400 * 1000).toISOString();

const accounts = [
  { user_id: ADA.id, email: ADA.email, display_name: "Ada Admin", created_at: "2026-09-01T10:00:00.000Z", last_sign_in_at: new Date().toISOString(), email_confirmed_at: CONFIRMED, is_admin: true },
  { user_id: dana.id, email: dana.email, display_name: "Dana Voss", created_at: "2026-09-02T10:00:00.000Z", last_sign_in_at: null, email_confirmed_at: CONFIRMED, is_admin: false },
];
const approval = (email, extra = {}) => ({ email, approved_at: inDays(-1), expires_at: inDays(6), approved_by_name: "Ada Admin", ...extra });

async function openAdmin(page, mock = {}) {
  await seed(page, { mock: { profile: ADA.profile, admin: true, accounts, approvals: [approval("sam@example.com")], ...mock }, user: ADA });
  await open(page, "/admin");
  await expect(page.getByRole("heading", { name: "Site admin" })).toBeVisible();
}

const section = (page, heading) => page.locator("section", { has: page.getByRole("heading", { name: heading }) });
const pendingRows = (page) => section(page, /^Waiting for an account/).locator("div.stack > ul.invites > li");
const expiredRows = (page) => section(page, /^Waiting for an account/).locator("details li.invite");
const accountRows = (page) => section(page, "Accounts").locator("li.invite");

test.describe("a site admin", () => {
  test("sees the Admin link, styled like Characters, and it opens the page", async ({ page }) => {
    await seed(page, { mock: { profile: ADA.profile, admin: true, accounts }, user: ADA });
    await open(page, "/characters");
    const link = page.locator(".account").getByRole("link", { name: "Admin", exact: true });
    const style = (locator) => locator.evaluate((el) => { const s = getComputedStyle(el); return [el.className, s.borderRadius, s.paddingTop, s.fontSize]; });
    expect(await style(link)).toEqual(await style(page.locator(".account").getByRole("link", { name: "Characters" })));
    await link.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Site admin" })).toBeFocused();
  });

  test("sees every account and the approvals that wait for one", async ({ page }) => {
    await openAdmin(page);
    await expect(accountRows(page)).toHaveCount(2);
    await expect(accountRows(page).first()).toContainText("Ada Admin");
    await expect(accountRows(page).first().locator(".badge")).toHaveText("Admin");
    await expect(accountRows(page).nth(1).locator(".badge")).toHaveCount(0);
    await expect(accountRows(page).first()).toContainText("last signed in just now");
    await expect(accountRows(page).nth(1)).toContainText("dana@example.com");
    await expect(accountRows(page).nth(1)).toContainText("never signed in");
    await expect(page.getByRole("heading", { name: "Waiting for an account (1)" })).toBeVisible();
    await expect(pendingRows(page)).toHaveText([/sam@example\.com.*by Ada Admin.*ends/]);
    const pendingBox = pendingRows(page).first().locator("xpath=../..");
    expect(await pendingBox.evaluate((box) => [...box.childNodes].map((node) => node.nodeName))).toEqual(["UL"]);
    await expect(page.getByText("A Keeper runs a campaign")).toBeVisible();
  });

  test("sees an account whose email is not confirmed, and what to do if the person did not make it", async ({ page }) => {
    const unconfirmed = { user_id: "00000000-0000-4000-8000-0000000000f2", email: "sam@example.com", display_name: "sam", created_at: "2026-09-21T10:00:00.000Z", last_sign_in_at: null, email_confirmed_at: null, is_admin: false };
    await openAdmin(page, { accounts: [...accounts, unconfirmed] });
    await expect(accountRows(page).nth(2).locator(".badge")).toHaveText("Not confirmed");
    await expect(accountRows(page).first().locator(".badge")).toHaveText("Admin");
    await expect(page.getByText("the site owner deletes it in the Supabase dashboard (Authentication, Users), then approve the email again")).toBeVisible();
    await expect(pendingRows(page)).toHaveText([/sam@example\.com/]);
    await pendingRows(page).getByRole("button", { name: "Revoke" }).click();
    await expect(pendingRows(page)).toHaveCount(0);
  });

  test("approves an email and gets the sign-up link to send", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAdmin(page);
    await page.locator("#approveEmail").fill("  New.Person@Example.com ");
    await page.getByRole("button", { name: "Approve email" }).click();
    const link = page.locator("code.linkbox");
    await expect(link).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/signup$/);
    await expect(page.getByRole("status").filter({ hasText: "Approved." })).toContainText("Send this link to new.person@example.com and ask them to make their account now");
    const [call] = await callsTo(page, "/rest/v1/rpc/approve_email", "POST");
    expect(call.body).toEqual({ p_email: "new.person@example.com" });
    await expect(pendingRows(page)).toHaveCount(2);
    await expect(page.locator("#approveEmail")).toHaveValue("");

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.innerText());
  });

  test("approving an email that already has an account says so, and gives no link", async ({ page }) => {
    await openAdmin(page);
    await page.locator("#approveEmail").fill("dana@example.com");
    await page.getByRole("button", { name: "Approve email" }).click();
    await expect(page.getByRole("status").filter({ hasText: "already has an account" })).toHaveText("Note: dana@example.com already has an account, so it needs no approval.");
    await expect(page.locator("code.linkbox")).toHaveCount(0);
    await expect(pendingRows(page)).toHaveCount(1);
  });

  test("sees an expired approval apart, and approves it again", async ({ page }) => {
    await openAdmin(page, { approvals: [approval("sam@example.com"), approval("kim@example.com", { approved_at: inDays(-9), expires_at: inDays(-2) })] });
    await expect(page.getByRole("heading", { name: "Waiting for an account (1)" })).toBeVisible();
    await page.getByText("Expired approvals (1)").click();
    await expect(expiredRows(page)).toHaveText([/kim@example\.com.*expired/]);
    await expiredRows(page).getByRole("button", { name: "Approve again" }).click();
    await expect(page.getByRole("heading", { name: "Waiting for an account (2)" })).toBeVisible();
    await expect(expiredRows(page)).toHaveCount(0);
    await expect(page.locator("code.linkbox")).toBeVisible();
    const kim = (await storedMock(page)).approvals.find((a) => a.email === "kim@example.com");
    expect(new Date(kim.expires_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86400 * 1000);
  });

  test("revokes an approval that no account uses", async ({ page }) => {
    await openAdmin(page, { approvals: [approval("sam@example.com"), approval("kim@example.com")] });
    await pendingRows(page).filter({ hasText: "kim@example.com" }).getByRole("button", { name: "Revoke" }).click();
    await expect(pendingRows(page)).toHaveCount(1);
    await expect(pendingRows(page)).toContainText("sam@example.com");
    const [call] = await callsTo(page, "/rest/v1/rpc/revoke_approval", "POST");
    expect(call.body).toEqual({ p_email: "kim@example.com" });
  });

  test("is told in plain words when the database refuses", async ({ page }) => {
    const twenty = [...Array(20).keys()].map((i) => approval(`wait${i}@example.com`));
    await openAdmin(page, { approvals: twenty });
    await page.locator("#approveEmail").fill("one.more@example.com");
    await page.getByRole("button", { name: "Approve email" }).click();
    await expect(page.getByRole("alert")).toHaveText("Error: 20 approved emails are already waiting for an account. Revoke one first.");
    await expect(page.locator("code.linkbox")).toHaveCount(0);
  });

  test("who stops being an admin is refused by the database, even with the page open", async ({ page }) => {
    await openAdmin(page);
    await patchMock(page, { admin: false });
    await page.locator("#approveEmail").fill("friend@example.com");
    await page.getByRole("button", { name: "Approve email" }).click();
    await expect(page.getByRole("alert")).toHaveText("Error: Only a site admin can do that.");
  });
});

test.describe("anyone else", () => {
  test("sees no Admin link, and the page does not exist for them", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, accounts }, user: dana });
    await open(page, "/characters");
    await expect(page.locator("#admin-link")).toBeHidden();
    await open(page, "/admin");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByText("That page does not exist.")).toBeVisible();
    expect(await callsTo(page, "/rest/v1/rpc/list_accounts")).toHaveLength(0);
    expect(await callsTo(page, "/rest/v1/rpc/list_pending_approvals")).toHaveLength(0);
  });

  test("who is signed out is asked to sign in first", async ({ page }) => {
    await seed(page);
    await open(page, "/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  });
});

test.describe("when the admin check fails", () => {
  test("every page still works, as for someone who is not an admin", async ({ page }) => {
    await seed(page, { mock: { profile: ADA.profile, admin: true, adminCheckFails: true, accounts }, user: ADA });
    await open(page, "/characters");
    await expect(page.getByRole("heading", { name: "Your characters" })).toBeVisible();
    await expect(page.locator("#admin-link")).toBeHidden();
    expect(await callsTo(page, "/rest/v1/rpc/is_site_admin", "GET")).not.toHaveLength(0);
    await open(page, "/admin");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  });
});
