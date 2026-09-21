import { readFile } from "node:fs/promises";
import { blank } from "../../public/js/eclipse-rules.js";
import { callsTo, campaign, characterRow, expect, ids, open, otherDeviceSaves, patchMock, players, seed, sheetPath, storedCharacter, test } from "./helpers.js";

const { dana, dm } = players;
const play = sheetPath();
const CHARACTERS = "/rest/v1/characters";

const named = (name, more = {}) => {
  const data = blank();
  data.id.name = name;
  return Object.assign(data, more);
};

async function openSheet(page, { character = characterRow(blank()), mock = {} } = {}) {
  await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character, ...mock }, user: dana });
  await open(page, play);
  await expect(page.locator("#f_name")).toBeVisible();
}

const saved = (page) => expect(page.locator("#saveState")).toContainText("Saved", { timeout: 8000 });
const tab = (page, name) => page.getByRole("tab", { name }).click();

test.describe("loading", () => {
  test("an existing sheet is shown as stored, and nothing is written just for opening it", async ({ page }) => {
    const data = named("Marlo Vance", { starve: 4 });
    data.base.end = 3;
    data.id.prof = "Medical Doctor";
    await openSheet(page, { character: characterRow(data) });
    await expect(page.locator("#f_name")).toHaveValue("Marlo Vance");
    await expect(page.locator('[data-base="end"]')).toHaveValue("3");
    await expect(page.locator('[data-tot="cla"]')).toHaveText("2"); // base 1 + Medical Doctor
    await expect(page.locator("#stv_pen")).toHaveText("−1");
    await expect(page.locator("#dialNum")).toHaveText("−1");
    expect(await callsTo(page, CHARACTERS, "POST")).toHaveLength(0);
    await page.waitForTimeout(2500);
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
  });

  test("a failed load shows an error and writes nothing", async ({ page }) => {
    test.setTimeout(30_000);
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character: characterRow(blank()), failCharacters: true }, user: dana });
    await page.goto(play);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#f_name")).toHaveCount(0);
    await patchMock(page, { failCharacters: false });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("#f_name")).toBeVisible();
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
  });

  test("a sheet that cannot be read is not shown, and is left as it is", async ({ page }) => {
    const broken = { ...named("Marlo"), base: "nope" };
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character: characterRow(broken) }, user: dana });
    await open(page, play);
    await expect(page.getByRole("alert")).toContainText("could not be read");
    await expect(page.locator("#f_name")).toHaveCount(0);
    await page.waitForTimeout(2000);
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
    expect((await storedCharacter(page)).data.base).toBe("nope");
  });

  test("a sheet from a newer version is read-only and never saved over", async ({ page }) => {
    const data = named("Marlo", { fromTheFuture: { keep: true } });
    await openSheet(page, { character: characterRow(data, { schema_version: 2 }) });
    await expect(page.getByRole("alert")).toContainText("newer version");
    await expect(page.locator("#f_name")).toHaveValue("Marlo");
    expect(await page.locator("#page1").evaluate((el) => el.inert)).toBe(true);
    await expect(page.getByRole("button", { name: "Load file" })).toBeDisabled();
    await page.waitForTimeout(2500);
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
    // the Reference tab still works
    await tab(page, "Reference");
    await page.locator("#refSearch").fill("starving");
    await expect(page.locator(".rc:not(.hide)")).toHaveCount(1);
  });

  test("the DM has no sheet and no character rows are touched", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, campaigns: [campaign] }, user: dm });
    await open(page, `/campaign/${ids.campaign}/character`);
    await expect(page.getByText("A DM does not have a character sheet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the DM page" })).toHaveAttribute("href", `/campaign/${ids.campaign}/dm`);
    expect(await callsTo(page, CHARACTERS)).toHaveLength(0);
  });
});

test.describe("saving", () => {
  test("typing saves after a pause, sends the last-seen updated_at, and adopts the new one", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("")) });
    await page.locator("#f_name").fill("Marlo Vance");
    await expect(page.locator("#saveState")).toHaveText("Unsaved changes");
    await saved(page);
    const [patch] = await callsTo(page, CHARACTERS, "PATCH");
    expect(patch.query).toContain("id=eq.40000000-0000-4000-8000-000000000001");
    expect(decodeURIComponent(patch.query)).toContain("updated_at=eq.2026-09-19T11:00:00.000123+00:00");
    expect(Object.keys(patch.body).sort()).toEqual(["character_name", "data", "schema_version"]);
    expect(patch.body).toMatchObject({ character_name: "Marlo Vance", schema_version: 1 });
    expect(patch.body.data.id.name).toBe("Marlo Vance");

    // the second save uses the updated_at the first one returned
    await page.locator("#f_grit").fill("3");
    await saved(page);
    const patches = await callsTo(page, CHARACTERS, "PATCH");
    expect(patches).toHaveLength(2);
    expect(decodeURIComponent(patches[1].query)).toContain("updated_at=eq.2026-09-19T12:00:01.000456+00:00");
  });

  test("keeps fields it does not know, at every level", async ({ page }) => {
    const data = named("Marlo", { futureField: { deep: [1, 2] } });
    data.id.pronouns = "they/them";
    data.adv[0] = { n: "Lucky", t: "Tier 1 (5 pts)", e: "", extra: 9 };
    await openSheet(page, { character: characterRow(data) });
    await page.locator("#f_bg").fill("Farm");
    await saved(page);
    const stored = (await storedCharacter(page)).data;
    expect(stored.futureField).toEqual({ deep: [1, 2] });
    expect(stored.id).toMatchObject({ name: "Marlo", bg: "Farm", pronouns: "they/them" });
    expect(stored.adv[0]).toEqual({ n: "Lucky", t: "Tier 1 (5 pts)", e: "", extra: 9 });
  });

  test("stores inputs only, not computed numbers", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await page.locator('[data-base="end"]').fill("4");
    await page.locator('[data-t="trauma"][data-i="4"]').click();
    await saved(page);
    const stored = (await storedCharacter(page)).data;
    expect(stored.base.end).toBe(4);
    expect(stored.cm.trauma).toBe(5);
    expect(JSON.stringify(stored)).not.toMatch(/"(total|penalty|pool|tier)"/i);
  });

  test("a network failure keeps the changes, tells the player, and Save now recovers", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("")), mock: { failPatches: 1 } });
    await page.locator("#f_name").fill("Marlo");
    await expect(page.getByRole("alert")).toContainText("could not be saved", { timeout: 8000 });
    await expect(page.locator("#f_name")).toHaveValue("Marlo");
    await page.getByRole("button", { name: "Save now" }).click();
    await saved(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await storedCharacter(page)).character_name).toBe("Marlo");
  });

  test("a save the database refuses is reported, and Try again works once allowed", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("")), mock: { characterBlocked: true } });
    await page.locator("#f_name").fill("Marlo");
    await expect(page.getByRole("alert")).toContainText("refused to save", { timeout: 8000 });
    await expect(page.locator("#f_name")).toHaveValue("Marlo");
    await patchMock(page, { characterBlocked: false });
    await page.getByRole("button", { name: "Try again" }).click();
    await saved(page);
    expect((await storedCharacter(page)).character_name).toBe("Marlo");
  });

  test("signing out first saves what is waiting", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("")) });
    await page.locator("#f_name").fill("Marlo");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/login/);
    expect((await storedCharacter(page)).character_name).toBe("Marlo");
  });

  test("signing out asks first when the changes cannot be saved, and stays if the player says no", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("")), mock: { characterBlocked: true } });
    await page.locator("#f_name").fill("Marlo");
    const messages = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      dialog.dismiss();
    });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("not saved yet");
    await expect(page).toHaveURL(new RegExp(play));
    await expect(page.locator("#f_name")).toHaveValue("Marlo");
  });

  test("Ctrl+S saves at once", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("")) });
    await page.locator("#f_name").fill("Marlo");
    await page.keyboard.press("Control+s");
    await saved(page);
  });
});

test.describe("two devices", () => {
  const theirs = () => named("Saved on the phone");

  test("a save from elsewhere is detected, and nothing is overwritten until the player chooses", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await otherDeviceSaves(page, theirs());
    await page.locator("#f_bg").fill("Farm");
    await expect(page.getByRole("alert")).toContainText("saved somewhere else", { timeout: 8000 });
    await expect(page.locator("#f_bg")).toHaveValue("Farm");
    expect((await storedCharacter(page)).data.id.name).toBe("Saved on the phone");
    await page.waitForTimeout(2000);
    expect((await callsTo(page, CHARACTERS, "PATCH")).length).toBe(1);
  });

  test("Use their version loads it and saves nothing", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await otherDeviceSaves(page, theirs());
    await page.locator("#f_bg").fill("Farm");
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "Use their version" }).click();
    await expect(page.locator("#f_name")).toHaveValue("Saved on the phone");
    await expect(page.locator("#f_bg")).toHaveValue("");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await callsTo(page, CHARACTERS, "PATCH")).length).toBe(1);
    expect((await storedCharacter(page)).data.id.name).toBe("Saved on the phone");
  });

  test("Keep my version saves over theirs, after the player chose it", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await otherDeviceSaves(page, theirs());
    await page.locator("#f_bg").fill("Farm");
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "Keep my version" }).click();
    await saved(page);
    const stored = await storedCharacter(page);
    expect(stored.data.id).toMatchObject({ name: "Marlo", bg: "Farm" });
  });

  test("Save copies of both downloads two files", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await otherDeviceSaves(page, theirs());
    await page.locator("#f_bg").fill("Farm");
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 8000 });
    const downloads = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.getByRole("button", { name: "Save copies of both" }).click();
    await expect.poll(() => downloads.length).toBe(2);
    expect(downloads.sort()).toEqual(["Marlo-other-version.eclipse", "Marlo.eclipse"]);
  });
});

test.describe(".eclipse files", () => {
  test("Save a copy downloads the sheet as JSON with a version", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo Vance!")) });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save a copy" }).click()]);
    expect(download.suggestedFilename()).toBe("Marlo-Vance.eclipse");
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(file.schemaVersion).toBe(1);
    expect(file.id.name).toBe("Marlo Vance!");
    expect(file.base).toBeTruthy();
  });

  const upload = (page, contents, name = "hero.eclipse") =>
    page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(contents) });

  test("Loading a file asks first, and then replaces the live sheet and saves it", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    const file = { ...named("From the file"), schemaVersion: 1, extra: "kept" };
    await upload(page, JSON.stringify(file));
    await expect(page.getByRole("heading", { name: "Load this file?" })).toBeVisible();
    await expect(page.locator("#f_name")).toHaveValue("Marlo");
    await page.getByRole("button", { name: "Load without a copy" }).click();
    await expect(page.locator("#f_name")).toHaveValue("From the file");
    await saved(page);
    const stored = (await storedCharacter(page)).data;
    expect(stored.id.name).toBe("From the file");
    expect(stored.extra).toBe("kept");
    expect(stored).not.toHaveProperty("schemaVersion");
  });

  test("Cancel leaves the sheet alone", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await upload(page, JSON.stringify(named("From the file")));
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("#f_name")).toHaveValue("Marlo");
    await page.waitForTimeout(2200);
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
  });

  test("Save a copy, then load keeps the old sheet in a file first", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await upload(page, JSON.stringify(named("From the file")));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save a copy, then load" }).click()]);
    expect(JSON.parse(await readFile(await download.path(), "utf8")).id.name).toBe("Marlo");
    await expect(page.locator("#f_name")).toHaveValue("From the file");
  });

  test("a file that is not a character is refused and the sheet is unchanged", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    for (const bad of ["not json", JSON.stringify({ hello: 1 }), JSON.stringify([1, 2]), JSON.stringify({ ...named("x"), schemaVersion: 9 })]) {
      await upload(page, bad);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.locator("#f_name")).toHaveValue("Marlo");
    }
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
  });

  test("a file that is too big is refused", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await upload(page, " ".repeat(600 * 1024));
    await expect(page.getByRole("alert")).toContainText("too big");
  });
});

test.describe("the sheet itself", () => {
  test("condition boxes, dice penalty and the dial follow the rules", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await page.locator('[data-t="shock"][data-i="0"]').click();
    await page.locator('[data-t="trauma"][data-i="2"]').click();
    await expect(page.locator("#dialNum")).toHaveText("−4"); // shock 1/1 + trauma 3/1
    await expect(page.locator("#bd_s")).toHaveText("−1");
    await expect(page.locator("#bd_t")).toHaveText("−3");
    await page.locator('[data-t="trauma"][data-i="2"]').click(); // top box again steps back
    await expect(page.locator("#dialNum")).toHaveText("−3");
    await expect(page.locator('[data-pool="Athletics"]')).toHaveText("0"); // 1 attribute - 3 penalty
    await page.locator("#applyPen").uncheck();
    await expect(page.locator('[data-pool="Athletics"]')).toHaveText("1");
  });

  test("a full Trauma monitor takes over the dial and wakes the dying tracker", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await page.locator('[data-t="trauma"][data-i="9"]').click();
    await expect(page.locator(".eclipse")).toHaveClass(/crit-trauma/);
    await expect(page.locator("#critBadge")).toHaveText("Dying");
    await expect(page.locator("#dyingPanel")).toHaveClass(/live/);
    await page.locator('[data-dyover="0"]').click();
    await expect(page.locator('[data-t="trauma"].on')).toHaveCount(10);
    await expect(page.locator("#dy_of")).toHaveText("1");
    await page.locator('[data-dy="aided"]').check();
    await expect(page.locator("#dy_flag")).toHaveText("Stabilized by an ally");
  });

  test("choosing a profession sets its Master Skill and attribute bonus", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await page.locator("#f_prof").click();
    await page.getByRole("option", { name: /Medical Doctor/ }).click();
    await expect(page.locator("#f_master")).toHaveValue("Medicine");
    await expect(page.locator('[data-tot="cla"]')).toHaveText("2");
    await expect(page.locator('.srow[data-skill="Medicine"]')).toHaveClass(/master/);
    await saved(page);
    expect((await storedCharacter(page)).data.id).toMatchObject({ prof: "Medical Doctor", master: "Medicine" });
  });

  test("choosing a race sets its Sanity and modifiers", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await page.locator("#f_race").selectOption("voidtouched");
    await expect(page.locator('[data-tot="let"]')).toHaveText("0"); // base 1, -1 race
    await expect(page.locator('[data-tot="ins"]')).toHaveText("2");
    await expect(page.locator('[data-tot="san"]')).toHaveText("6");
  });

  test("the sanity and morality dots name the level in words", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await expect(page.locator("#san_state")).toHaveText("steady · 8/10");
    await page.locator('[data-san="2"]').click();
    await expect(page.locator("#san_state")).toHaveText("unravelling · 3/10");
    await page.locator('[data-mor="9"]').click();
    await expect(page.locator("#mor_state")).toHaveText("Luminous · 10/10");
  });

  test("rows can be added and removed, and one blank row always stays", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await tab(page, "Testament");
    await expect(page.locator("#advRows tr")).toHaveCount(3);
    await page.getByRole("button", { name: "+ add advantage" }).click();
    await expect(page.locator("#advRows tr")).toHaveCount(4);
    await page.locator('#advRows [data-lt="adv.3.n"]').fill("Lucky");
    await saved(page);
    expect((await storedCharacter(page)).data.adv[3]).toEqual({ n: "Lucky" });
    for (let i = 0; i < 4; i += 1) await page.locator("#advRows .rm").first().click();
    await expect(page.locator("#advRows tr")).toHaveCount(1);
  });

  test("a log entry can be added and searched", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await tab(page, "Log");
    await page.locator("#logAdd").click();
    await page.locator('[data-lg="0.t"]').fill("The bridge");
    await page.locator('[data-lg="0.b"]').fill("We owe Tomas a favour.");
    await page.locator("#logSearch").fill("tomas");
    await expect(page.locator("#logCount")).toHaveText("1 of 2");
    await page.locator("#logSearch").fill("nobody");
    await expect(page.locator("#logEmpty")).toBeVisible();
  });

  test("encumbrance follows Lethality and the load", async ({ page }) => {
    await openSheet(page, { character: characterRow(named("Marlo")) });
    await tab(page, "Equipment");
    await page.locator('[data-sup="rations"]').fill("20");
    await expect(page.locator("#enc_w")).toHaveText("20");
    await expect(page.locator("#enc_tier")).toHaveText("Light");
    await expect(page.locator("#enc_pen")).toHaveText("−1 dice to all checks");
    await tab(page, "Core");
    await expect(page.locator("#bd_e")).toHaveText("−1");
  });

  test("casting tabs show pools and costs", async ({ page }) => {
    const data = named("Marlo");
    data.base.vei = 4;
    data.spells[0] = { n: "Spark", l: 3 };
    data.rituals[0] = { n: "Ward", l: 2, tt: "1 hour" };
    await openSheet(page, { character: characterRow(data) });
    await tab(page, "Casting");
    await expect(page.locator("#v_max")).toHaveText("12");
    await expect(page.locator('[data-cc="spells.0"]')).toHaveText("3");
    await expect(page.locator('[data-ca="spells.0"]')).toHaveText("3");
    await expect(page.locator('[data-rdur="0"]')).toHaveText("2 weeks");
    await expect(page.locator('[data-rtv="0"]')).toHaveText("70");
    await expect(page.locator("#v_schools select")).toHaveCount(2);
  });

  test("the tabs work from the keyboard", async ({ page }) => {
    await openSheet(page);
    await page.getByRole("tab", { name: "Core" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Equipment" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#page2")).toBeVisible();
    await expect(page.locator("#page1")).toBeHidden();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Reference" })).toBeFocused();
  });

  test("the help card opens and closes", async ({ page }) => {
    await openSheet(page);
    await page.getByRole("button", { name: "How to use" }).click();
    await expect(page.getByRole("dialog")).toContainText("Using this character sheet");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the reference cards are searchable and filterable", async ({ page }) => {
    await openSheet(page);
    await tab(page, "Reference");
    await expect(page.locator("#refCount")).toHaveText("41 of 41");
    await page.locator("#refSearch").fill("starving");
    await expect(page.locator(".rc:not(.hide)")).toHaveCount(1);
    await page.locator("#refSearch").fill("");
    await page.getByRole("button", { name: "Casting", exact: true }).click();
    await expect(page.locator("#refCount")).toHaveText("4 of 41");
  });
});

test.describe("hostile text", () => {
  test("names and notes from the database are text, never markup", async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const data = named(evil);
    Object.assign(data.id, { prof: evil, bg: evil, master: evil });
    data.log[0] = { t: evil, d: evil, b: evil };
    data.vitals.visual = evil;
    data.weapons[0] = { name: evil };
    await openSheet(page, { character: characterRow(data) });
    await tab(page, "Testament");
    await expect(page.locator("#c_prof")).toHaveText(evil);
    await tab(page, "Equipment");
    await expect(page.locator(".fixed", { hasText: "onerror" })).toBeVisible();
    await tab(page, "Log");
    await expect(page.locator('[data-lg="0.b"]')).toHaveValue(evil);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#main img, #main script").count()).toBe(0);
  });
});
