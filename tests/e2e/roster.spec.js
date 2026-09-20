import { readFile } from "node:fs/promises";
import { blank } from "../../public/js/eclipse-rules.js";
import { callsTo, campaign, characterRow, expect, ids, open, players, seed, test } from "./helpers.js";

const { dm } = players;
const DM_PAGE = `/campaign/${ids.campaign}/dm`;

const RAVI = "00000000-0000-4000-8000-0000000000b2";
const ZED = "00000000-0000-4000-8000-0000000000b4";
const sheetOf = (name, change = () => {}) => {
  const data = blank();
  data.id.name = name;
  change(data);
  return data;
};
const rowFor = (id, owner, data, extra = {}) => characterRow(data, { id, owner_id: owner, ...extra });

const DANA_ROW = rowFor(
  "40000000-0000-4000-8000-0000000000c1",
  ids.player,
  sheetOf("Marlo Vance", (d) => {
    d.id.prof = "Medical Doctor";
    d.cm.shock = 3;
    d.cm.trauma = 10;
    d.starve = 4;
  }),
  { updated_at: "2026-09-19T11:00:00.000000+00:00" },
);
const RAVI_ROW = rowFor("40000000-0000-4000-8000-0000000000c2", RAVI, sheetOf("Vex", (d) => (d.id.race = "wirehead")), { updated_at: "2026-09-19T10:00:00.000000+00:00" });
const ZED_ROW = rowFor("40000000-0000-4000-8000-0000000000c4", ZED, sheetOf("Old hand"));

const MEMBERS = [
  { player_id: RAVI, joined_at: "2026-09-02T00:00:00Z" },
  { player_id: ids.player, joined_at: "2026-09-01T00:00:00Z" },
];
const PROFILES = [
  { id: ids.player, display_name: "Dana Voss" },
  { id: RAVI, display_name: "Ravi" },
  { id: ZED, display_name: "Zed" },
];

async function openRoster(page, mock = {}) {
  await seed(page, {
    mock: { profile: dm.profile, campaigns: [campaign], members: MEMBERS, profiles: PROFILES, characters: [DANA_ROW, RAVI_ROW], ...mock },
    user: dm,
  });
  await open(page, DM_PAGE);
  await expect(page.getByRole("heading", { name: "Players", exact: true })).toBeVisible();
}

const cards = (page) => page.locator(".roster > li");
const setCharacters = (page, characters, members) =>
  page.evaluate(
    ({ characters, members }) => {
      const mock = JSON.parse(localStorage.getItem("__mock"));
      mock.characters = characters;
      if (members) mock.members = members;
      localStorage.setItem("__mock", JSON.stringify(mock));
    },
    { characters, members },
  );
const live = (page) => expect(page.locator("#roster-title + .badge")).toHaveText("Live");
const MINUS = "−";

test.describe("the roster", () => {
  test("shows each player's numbers, in the order they joined", async ({ page }) => {
    await openRoster(page);
    await expect(cards(page)).toHaveCount(2);
    const dana = cards(page).nth(0);
    await expect(dana.getByRole("heading")).toHaveText("Marlo Vance");
    await expect(dana).toContainText("Player: Dana Voss");
    await expect(dana).toContainText("Human, Medical Doctor");
    await expect(dana).toContainText("Dying");
    await expect(dana.locator(".penalty strong")).toHaveText(`${MINUS}14`); // shock 3 + trauma 10 + starving 1
    await expect(dana.locator("dl")).toContainText(`Shock3/10, ${MINUS}3`);
    await expect(dana.locator("dl")).toContainText(`Trauma10/10, ${MINUS}10`);
    await expect(dana.locator("dl")).toContainText("Days without rations4");
    await expect(cards(page).nth(1).getByRole("heading")).toHaveText("Vex");
    await expect(cards(page).nth(1)).toContainText("Wirehead");
    await expect(cards(page).nth(1)).not.toContainText("Dying");
  });

  test("reads only: no write call is ever made", async ({ page }) => {
    await openRoster(page);
    await expect(cards(page)).toHaveCount(2);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect((await callsTo(page, "/rest/v1/characters", method)).length, method).toBe(0);
    }
  });

  test("a member who has not opened their sheet is listed, and an empty campaign says so", async ({ page }) => {
    await openRoster(page, { characters: [DANA_ROW] });
    await expect(cards(page).nth(1)).toContainText("No sheet yet");
    await expect(cards(page).nth(1)).toContainText("They have not opened their sheet yet.");
    await seed(page, { mock: { profile: dm.profile, campaigns: [campaign] }, user: dm });
    await open(page, DM_PAGE);
    await expect(page.getByText("Nobody has joined yet.")).toBeVisible();
  });

  test("a former player's sheet is kept and shown apart", async ({ page }) => {
    await openRoster(page, { characters: [DANA_ROW, RAVI_ROW, ZED_ROW] });
    await expect(page.getByRole("heading", { name: "Former players" })).toBeVisible();
    await expect(page.locator("ul.roster").nth(1).locator("li")).toHaveCount(1);
    await expect(page.locator("ul.roster").nth(1)).toContainText("Old hand");
  });

  test("a sheet that cannot be read is still listed and is left alone", async ({ page }) => {
    await openRoster(page, { characters: [rowFor(RAVI_ROW.id, RAVI, { base: "nope" })], members: [MEMBERS[0]] });
    await expect(page.getByText("This sheet could not be read.")).toBeVisible();
    for (const method of ["POST", "PATCH"]) expect((await callsTo(page, "/rest/v1/characters", method)).length).toBe(0);
  });

  test("hostile names are text, never markup", async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    await openRoster(page, {
      characters: [rowFor(DANA_ROW.id, ids.player, sheetOf(evil, (d) => (d.id.prof = evil)))],
      profiles: [{ id: ids.player, display_name: evil }, PROFILES[1]],
    });
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText(evil);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#main img").count()).toBe(0);
  });
});

test.describe("live updates", () => {
  test("subscribes to this campaign's sheets and shows Live", async ({ page }) => {
    await openRoster(page);
    await live(page);
    const joins = await page.evaluate(() => window.__realtime.joins);
    expect(joins[0]).toEqual([{ event: "*", schema: "public", table: "characters", filter: `campaign_id=eq.${ids.campaign}` }]);
  });

  test("a change made by a player appears without a reload", async ({ page }) => {
    await openRoster(page);
    await live(page);
    await expect(cards(page).nth(0).getByText("Dying")).toBeVisible();
    const changed = { ...DANA_ROW, data: sheetOf("Marlo Vance", (d) => (d.cm.shock = 1)), updated_at: "2026-09-19T12:00:00.000000+00:00" };
    await setCharacters(page, [changed, RAVI_ROW]);
    await page.evaluate(() => window.__realtime.emit());
    await expect(cards(page).nth(0).locator(".penalty strong")).toHaveText(`${MINUS}1`);
    await expect(cards(page).nth(0)).not.toContainText("Dying");
  });

  test("a player who joins, and starts a sheet, appears live", async ({ page }) => {
    await openRoster(page, { characters: [DANA_ROW], members: [MEMBERS[1]] });
    await live(page);
    await expect(cards(page)).toHaveCount(1);
    await setCharacters(page, [DANA_ROW, RAVI_ROW], MEMBERS);
    await page.evaluate(() => window.__realtime.emit());
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(1)).toContainText("Ravi");
  });

  test("only changed sheets are read again", async ({ page }) => {
    await openRoster(page);
    await live(page);
    const reads = async () => (await callsTo(page, "/rest/v1/characters", "GET")).filter((c) => decodeURIComponent(c.query).includes("id=in.("));
    const before = (await reads()).length;
    await setCharacters(page, [DANA_ROW, { ...RAVI_ROW, updated_at: "2026-09-19T12:05:00.000000+00:00" }]);
    await page.evaluate(() => window.__realtime.emit());
    await expect.poll(async () => (await reads()).length).toBe(before + 1);
    const last = decodeURIComponent((await reads()).pop().query);
    expect(last).toContain(RAVI_ROW.id);
    expect(last).not.toContain(DANA_ROW.id);
  });

  test("says when the connection is lost, and catches up when it returns", async ({ page }) => {
    await openRoster(page);
    await live(page);
    await page.evaluate(() => window.__realtime.drop());
    await expect(page.locator("#roster-title + .badge")).not.toHaveText("Live");
    await setCharacters(page, [{ ...DANA_ROW, data: sheetOf("Renamed"), character_name: "Renamed", updated_at: "2026-09-19T12:10:00.000000+00:00" }, RAVI_ROW]);
    await live(page); // the library reconnects, and the roster reads again once it is subscribed
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText("Renamed");
  });

  test("Refresh now reads again", async ({ page }) => {
    await openRoster(page);
    await setCharacters(page, [DANA_ROW, { ...RAVI_ROW, data: sheetOf("Vex II"), character_name: "Vex II", updated_at: "2026-09-19T12:20:00.000000+00:00" }]);
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(cards(page).nth(1).getByRole("heading")).toHaveText("Vex II");
  });
});

test.describe("downloads", () => {
  test("Download all sheets saves every sheet as stored, former players too", async ({ page }) => {
    const stored = { ...DANA_ROW, data: { ...DANA_ROW.data, futureField: { keep: true } } };
    await openRoster(page, { characters: [stored, RAVI_ROW, ZED_ROW] });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all sheets" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Age-of-Eclipse-sheets-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(file).toMatchObject({ app: "eclipse", kind: "campaign-sheets", campaign: { id: ids.campaign, name: "Age of Eclipse" } });
    expect(file.sheets.map((s) => [s.playerName, s.member])).toEqual([
      ["Dana Voss", true],
      ["Ravi", true],
      ["Zed", false],
    ]);
    expect(file.sheets[0].data.futureField).toEqual({ keep: true });
    await expect(page.locator(".status", { hasText: "Downloaded 3 sheets" })).toBeVisible();
  });

  test("Save a copy on a card saves that player's sheet as an .eclipse file", async ({ page }) => {
    await openRoster(page);
    const [download] = await Promise.all([page.waitForEvent("download"), cards(page).nth(0).getByRole("button", { name: "Save a copy" }).click()]);
    expect(download.suggestedFilename()).toBe("Marlo-Vance.eclipse");
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(file.schemaVersion).toBe(1);
    expect(file.id.name).toBe("Marlo Vance");
  });
});

test.describe("a player's sheet, as the DM", () => {
  const sheetPath = `${DM_PAGE}/${DANA_ROW.id}`;
  const dmSeed = (page, characters) => seed(page, { mock: { profile: dm.profile, campaigns: [campaign], members: MEMBERS, profiles: PROFILES, characters }, user: dm });

  test("opens read only, with no way to save or load, and follows changes", async ({ page }) => {
    await openRoster(page);
    await live(page);
    await cards(page).nth(0).getByRole("link", { name: "Open sheet" }).click();
    await expect(page).toHaveURL(new RegExp(`${DANA_ROW.id}$`));
    await expect(page.locator("#f_name")).toHaveValue("Marlo Vance");
    await expect(page.getByText("You are viewing Dana Voss's sheet as the DM.")).toBeVisible();
    await expect(page.locator("#saveState")).toHaveText("Read only");
    expect(await page.locator("#page1").evaluate((el) => el.inert)).toBe(true);
    await expect(page.getByRole("button", { name: "Save now" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Load file" })).toBeHidden();
    await expect(page.locator("#dialNum")).toHaveText(`${MINUS}14`);

    const changed = { ...DANA_ROW, data: sheetOf("Marlo Vance", (d) => (d.cm.shock = 1)), updated_at: "2026-09-19T12:00:00.000000+00:00" };
    await setCharacters(page, [changed, RAVI_ROW]);
    await page.evaluate(() => window.__realtime.emit());
    await expect(page.locator("#dialNum")).toHaveText(`${MINUS}1`);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) expect((await callsTo(page, "/rest/v1/characters", method)).length, method).toBe(0);
  });

  test("Back to the DM page returns to the roster", async ({ page }) => {
    await dmSeed(page, [DANA_ROW]);
    await open(page, sheetPath);
    await page.getByRole("link", { name: "Back to the DM page" }).click();
    await expect(page).toHaveURL(new RegExp(`${DM_PAGE}$`));
    await expect(cards(page)).toHaveCount(2);
  });

  test("a sheet from another campaign, or a bad id, is not found", async ({ page }) => {
    await dmSeed(page, [{ ...DANA_ROW, campaign_id: "10000000-0000-4000-8000-0000000000ff" }]);
    await open(page, sheetPath);
    await expect(page.getByText("We could not find that sheet in this campaign.")).toBeVisible();
    await open(page, `${DM_PAGE}/not-an-id`);
    await expect(page.getByText("We could not find that sheet.")).toBeVisible();
  });

  test("an unreadable sheet is not shown, and the message points to the backup", async ({ page }) => {
    await dmSeed(page, [{ ...DANA_ROW, data: { base: "nope" } }]);
    await open(page, sheetPath);
    await expect(page.getByRole("alert")).toContainText("could not be read");
    await expect(page.locator("#f_name")).toHaveCount(0);
  });

  test("only the campaign's DM can open it", async ({ page }) => {
    await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], characters: [DANA_ROW] }, user: players.dana });
    await open(page, sheetPath);
    await expect(page.getByText("Only the DM of this campaign can open this page.")).toBeVisible();
    await expect(page.locator("#f_name")).toHaveCount(0);
  });
});
