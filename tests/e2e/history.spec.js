import { readFile } from "node:fs/promises";
import { blank } from "../../public/js/eclipse-rules.js";
import { CHARACTER_ID, FIRST_STAMP, callsTo, campaign, characterRow, expect, ids, open, otherDeviceSaves, players, seed, storedCharacter, test } from "./helpers.js";

const { dana, dm } = players;
const play = `/campaign/${ids.campaign}/play`;
const HISTORY = `${play}/history`;

const sheetOf = (name, change = () => {}) => {
  const data = blank();
  data.id.name = name;
  change(data);
  return data;
};

const CURRENT = sheetOf("Marlo Vance", (d) => (d.cm.trauma = 5));
const snapshot = (id, reason, savedAt, data, extra = {}) => ({
  id,
  character_id: CHARACTER_ID,
  schema_version: 1,
  character_name: data.id.name,
  data,
  reason,
  saved_at: savedAt,
  ...extra,
});
const SNAPSHOTS = [
  snapshot(1, "schema_change", "2026-09-19T09:00:00.000000+00:00", sheetOf("Marlo")),
  snapshot(2, "edit", "2026-09-19T10:00:00.000000+00:00", sheetOf("Marlo V.", (d) => (d.cm.shock = 2))),
  snapshot(3, "edit", "2026-09-19T10:30:00.000000+00:00", sheetOf("Marlo Vance", (d) => (d.cm.trauma = 2))),
];

async function openSheet(page, mock = {}) {
  await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character: characterRow(CURRENT), history: SNAPSHOTS, ...mock }, user: dana });
  await open(page, play);
  await expect(page.locator("#f_name")).toBeVisible();
}

const items = (page) => page.locator(".history > li");
const rpcCalls = (page) => callsTo(page, "/rest/v1/rpc/restore_character_version", "POST");

test.describe("the history list", () => {
  test("the History button opens it, newest first, with what each copy was kept before", async ({ page }) => {
    await openSheet(page);
    await page.getByRole("button", { name: "History" }).click();
    await expect(page).toHaveURL(new RegExp(`${HISTORY}$`));
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(items(page)).toHaveCount(3);
    await expect(items(page).nth(0)).toContainText("Kept before an edit");
    await expect(items(page).nth(0)).toContainText("Named Marlo Vance");
    await expect(items(page).nth(2)).toContainText("Kept before a rules update");
    expect((await callsTo(page, "/rest/v1/characters", "PATCH")).length).toBe(0);
  });

  test("it saves what is waiting first, so the page never lists a stale sheet", async ({ page }) => {
    await openSheet(page);
    await page.locator("#f_name").fill("Marlo Vance II");
    await page.getByRole("button", { name: "History" }).click();
    await expect(page).toHaveURL(new RegExp(`${HISTORY}$`));
    expect((await storedCharacter(page)).character_name).toBe("Marlo Vance II");
  });

  test("with no earlier versions it says so", async ({ page }) => {
    await openSheet(page, { history: [] });
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByText("There are no earlier versions yet.")).toBeVisible();
  });

  test("Save a copy downloads that version as an .eclipse file", async ({ page }) => {
    await openSheet(page);
    await page.goto(HISTORY);
    await expect(items(page)).toHaveCount(3);
    const [download] = await Promise.all([page.waitForEvent("download"), items(page).nth(1).getByRole("button", { name: "Save a copy" }).click()]);
    expect(download.suggestedFilename()).toBe("Marlo-V.eclipse");
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(file).toMatchObject({ schemaVersion: 1, id: { name: "Marlo V." }, cm: { shock: 2 } });
  });

  test("a DM has no history, and a player with no sheet is told", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, campaigns: [campaign] }, user: dm });
    await open(page, HISTORY);
    await expect(page.getByText("A DM does not have a character sheet.")).toBeVisible();
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign] }, user: dana });
    await open(page, HISTORY);
    await expect(page.getByText("You do not have a sheet in this campaign yet.")).toBeVisible();
  });
});

test.describe("looking at a copy", () => {
  test("it opens read only, with no way to save or load, and changes nothing", async ({ page }) => {
    await openSheet(page);
    await page.goto(HISTORY);
    await items(page).nth(1).getByRole("link", { name: "Look at it" }).click();
    await expect(page).toHaveURL(new RegExp(`${HISTORY}/2$`));
    await expect(page.locator("#f_name")).toHaveValue("Marlo V.");
    await expect(page.getByText("This is your sheet as it was just before")).toBeVisible();
    await expect(page.getByText("your current sheet has not changed")).toBeVisible();
    await expect(page.locator("#saveState")).toHaveText("Read only");
    expect(await page.locator("#page1").evaluate((el) => el.inert)).toBe(true);
    for (const name of ["Save now", "Load file", "History"]) await expect(page.getByRole("button", { name })).toBeHidden();
    await expect(page.getByRole("button", { name: "Put this version back" })).toBeVisible();
    await page.waitForTimeout(2200);
    expect((await callsTo(page, "/rest/v1/characters", "PATCH")).length).toBe(0);
    expect((await rpcCalls(page)).length).toBe(0);
  });

  test("a copy that is not this player's sheet, or a bad id, is not found", async ({ page }) => {
    await openSheet(page, { history: [...SNAPSHOTS, snapshot(9, "edit", "2026-09-19T10:45:00.000000+00:00", sheetOf("Someone else"), { character_id: "40000000-0000-4000-8000-0000000000ee" })] });
    await open(page, `${HISTORY}/9`);
    await expect(page.getByText("We could not find that version of your sheet.")).toBeVisible();
    await open(page, `${HISTORY}/abc`);
    await expect(page.getByText("We could not find that version.")).toBeVisible();
    await open(page, `${HISTORY}/404`);
    await expect(page.getByText("We could not find that version of your sheet.")).toBeVisible();
  });
});

test.describe("putting a copy back", () => {
  const lookAt = async (page, id) => {
    await open(page, `${HISTORY}/${id}`);
    await expect(page.getByRole("button", { name: "Put this version back" })).toBeVisible();
  };

  test("asks first, and the sheet stays as it was if the player says no", async ({ page }) => {
    await openSheet(page);
    await lookAt(page, 2);
    const messages = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      dialog.dismiss();
    });
    await page.getByRole("button", { name: "Put this version back" }).click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("Your current sheet is kept in the history");
    expect((await rpcCalls(page)).length).toBe(0);
    expect((await storedCharacter(page)).character_name).toBe("Marlo Vance");
  });

  test("restores it, sends the updated_at it saw, and opens the restored sheet", async ({ page }) => {
    await openSheet(page);
    await lookAt(page, 2);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Put this version back" }).click();
    await expect(page).toHaveURL(new RegExp(`${play}$`));
    await expect(page.locator("#f_name")).toHaveValue("Marlo V.");
    await expect(page.locator('[data-t="shock"].on')).toHaveCount(2);
    const [call] = await rpcCalls(page);
    expect(call.body).toEqual({ p_history_id: 2, p_expected: FIRST_STAMP });
    expect((await storedCharacter(page)).character_name).toBe("Marlo V.");
  });

  test("the sheet it replaced is in the history, and putting that back undoes the restore", async ({ page }) => {
    await openSheet(page);
    await lookAt(page, 2);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Put this version back" }).click();
    await expect(page.locator("#f_name")).toHaveValue("Marlo V.");

    await page.getByRole("button", { name: "History" }).click();
    await expect(items(page)).toHaveCount(4);
    await expect(items(page).nth(0)).toContainText("Kept before an earlier version was put back");
    await items(page).nth(0).getByRole("link", { name: "Look at it" }).click();
    await expect(page.locator("#f_name")).toHaveValue("Marlo Vance");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Put this version back" }).click();
    await expect(page.locator("#f_name")).toHaveValue("Marlo Vance");
    await expect(page.locator('[data-t="trauma"].on')).toHaveCount(5);
    expect((await storedCharacter(page)).data.cm.trauma).toBe(5);
  });

  test("a save from another device since the page opened stops the restore, and changes nothing", async ({ page }) => {
    await openSheet(page);
    await lookAt(page, 2);
    await otherDeviceSaves(page, sheetOf("Saved on the phone"));
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Put this version back" }).click();
    await expect(page.getByText("was changed somewhere else since you opened this page")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HISTORY}/2$`));
    expect((await storedCharacter(page)).character_name).toBe("Saved on the phone");
    await expect(page.getByRole("button", { name: "Put this version back" })).toBeEnabled();
  });

  test("a player who has left the campaign is told, and nothing changes", async ({ page }) => {
    await openSheet(page, { restoreNotMember: true });
    await lookAt(page, 2);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Put this version back" }).click();
    await expect(page.getByText("You are not in this campaign, so you cannot change this sheet.")).toBeVisible();
    expect((await storedCharacter(page)).character_name).toBe("Marlo Vance");
  });
});
