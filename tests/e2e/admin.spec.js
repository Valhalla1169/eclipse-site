import { callsTo, expect, open, patchMock, players, seed, test } from "./helpers.js";

// The site admin page (docs/adr/0014). A site admin approves the emails that can make an
// account. The fake refuses the admin functions to anyone whose `admin` flag is off.
const { dana } = players;
const ADA = { id: "00000000-0000-4000-8000-0000000000e1", email: "ada@example.com", profile: { id: "00000000-0000-4000-8000-0000000000e1", display_name: "Ada Admin" } };

const accounts = [
  { user_id: ADA.id, email: ADA.email, display_name: "Ada Admin", created_at: "2026-09-01T10:00:00.000Z", last_sign_in_at: new Date().toISOString(), is_admin: true },
  { user_id: dana.id, email: dana.email, display_name: "Dana Voss", created_at: "2026-09-02T10:00:00.000Z", last_sign_in_at: null, is_admin: false },
];
const approval = (email, extra = {}) => ({ email, approved_at: "2026-09-20T10:00:00.000Z", approved_by_name: "Ada Admin", ...extra });

async function openAdmin(page, mock = {}) {
  await seed(page, { mock: { profile: ADA.profile, admin: true, accounts, approvals: [approval("sam@example.com")], ...mock }, user: ADA });
  await open(page, "/admin");
  await expect(page.getByRole("heading", { name: "Site admin" })).toBeVisible();
}

const rows = (page, heading) => page.locator("section", { has: page.getByRole("heading", { name: heading }) }).locator("li.invite");
const pendingRows = (page) => rows(page, /^Waiting for an account/);
const accountRows = (page) => rows(page, "Accounts");

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
    await expect(pendingRows(page)).toHaveText([/sam@example\.com.*by Ada Admin/]);
    await expect(page.getByText("A Keeper runs a campaign")).toBeVisible();
  });

  test("approves an email and gets the sign-up link to send", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAdmin(page);
    await page.locator("#approveEmail").fill("  New.Person@Example.com ");
    await page.getByRole("button", { name: "Approve email" }).click();
    const link = page.locator("code.linkbox");
    await expect(link).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/signup$/);
    await expect(page.getByRole("status").filter({ hasText: "Approved." })).toContainText("Send this link to new.person@example.com");
    const [call] = await callsTo(page, "/rest/v1/rpc/approve_email", "POST");
    expect(call.body).toEqual({ p_email: "new.person@example.com" });
    await expect(pendingRows(page)).toHaveCount(2);
    await expect(page.locator("#approveEmail")).toHaveValue("");

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.innerText());
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
