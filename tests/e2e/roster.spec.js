import { readFile } from "node:fs/promises";
import { blank } from "../../public/js/eclipse-rules.js";
import { assignmentRow, calls, callsTo, campaign, characterRow, expect, ids, open, patchMock, players, seed, test } from "./helpers.js";

const { dm } = players;
const DM_PAGE = `/campaign/${ids.campaign}/keeper`;

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
const DANA_SPARE = rowFor("40000000-0000-4000-8000-0000000000c3", ids.player, sheetOf("Spare"), { updated_at: "2026-09-19T09:00:00.000000+00:00" });
const ZED_COPY = {
  id: 7,
  campaign_id: ids.campaign,
  player_id: ZED,
  character_id: "40000000-0000-4000-8000-0000000000c4",
  character_name: "Old hand",
  schema_version: 1,
  data: sheetOf("Old hand"),
  reason: "left",
  kept_at: "2026-09-10T12:00:00.000000+00:00",
};

const DANA_ACTIVE = assignmentRow(DANA_ROW.id);
const RAVI_ACTIVE = assignmentRow(RAVI_ROW.id, { player_id: RAVI });
const MEMBERS = [
  { player_id: RAVI, joined_at: "2026-09-02T00:00:00Z" },
  { player_id: ids.player, joined_at: "2026-09-01T00:00:00Z" },
];
const PROFILES = [
  { id: ids.player, display_name: "Dana Voss" },
  { id: RAVI, display_name: "Ravi" },
  { id: ZED, display_name: "Zed" },
];

const scenario = (mock = {}) => ({
  profile: dm.profile,
  campaigns: [campaign],
  members: MEMBERS,
  profiles: PROFILES,
  characters: [DANA_ROW, RAVI_ROW],
  assignments: [DANA_ACTIVE, RAVI_ACTIVE],
  departed: [],
  ...mock,
});

async function openRoster(page, mock = {}) {
  await seed(page, { mock: scenario(mock), user: dm });
  await open(page, DM_PAGE);
  await expect(page.getByRole("heading", { name: "Players", exact: true })).toBeVisible();
}

const cards = (page) => page.locator(".roster > li");
const live = (page) => expect(page.locator("#roster-title + .badge")).toHaveText("Live");
const MINUS = "−";
const writes = async (page) => (await calls(page)).filter((c) => c.path.startsWith("/rest/v1/") && c.method !== "GET");

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

  test("reads only: no write or function call is ever made", async ({ page }) => {
    await openRoster(page);
    await expect(cards(page)).toHaveCount(2);
    expect(await writes(page)).toEqual([]);
  });

  test("shows the character a player has active, and reads only those", async ({ page }) => {
    await openRoster(page, { characters: [DANA_ROW, DANA_SPARE, RAVI_ROW], assignments: [assignmentRow(DANA_SPARE.id), RAVI_ACTIVE] });
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText("Spare");
    const reads = (await callsTo(page, "/rest/v1/characters", "GET")).map((c) => decodeURIComponent(c.query)).join("\n");
    expect(reads).toContain(DANA_SPARE.id);
    expect(reads).not.toContain(DANA_ROW.id);
  });

  test("a member with no character chosen yet is listed, and an empty campaign says so", async ({ page }) => {
    await openRoster(page, { assignments: [DANA_ACTIVE] });
    await expect(cards(page).nth(1)).toContainText("No character chosen yet");
    await expect(cards(page).nth(1)).toContainText("They have not chosen a character for this campaign yet.");
    await expect(cards(page).nth(1).getByRole("link", { name: "Open sheet" })).toHaveCount(0);
    await seed(page, { mock: { profile: dm.profile, campaigns: [campaign] }, user: dm });
    await open(page, DM_PAGE);
    await expect(page.getByText("Nobody has joined yet.")).toBeVisible();
  });

  test("a player who left is shown apart, with the copy kept when they left", async ({ page }) => {
    await openRoster(page, { departed: [ZED_COPY] });
    await expect(page.getByRole("heading", { name: "Former players" })).toBeVisible();
    const former = page.locator("ul.roster").nth(1).locator("li");
    await expect(former).toHaveCount(1);
    await expect(former).toContainText("Old hand");
    await expect(former).toContainText("Zed");
    await expect(former).toContainText("as it was when they left");
    await expect(former).toContainText("Kept ");
    await expect(former.getByRole("link", { name: "Open sheet" })).toHaveAttribute("href", `${DM_PAGE.replace("/keeper", "")}/left/7`);
    await expect(former.getByRole("link", { name: "History" })).toHaveCount(0);
  });

  test("a copy kept from someone who has since rejoined is not listed apart", async ({ page }) => {
    await openRoster(page, { departed: [{ ...ZED_COPY, player_id: RAVI }] });
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Former players" })).toHaveCount(0);
  });

  test("a sheet that cannot be read is still listed and is left alone", async ({ page }) => {
    await openRoster(page, { characters: [rowFor(RAVI_ROW.id, RAVI, { base: "nope" })], assignments: [RAVI_ACTIVE], members: [MEMBERS[0]] });
    await expect(page.getByText("This sheet could not be read.")).toBeVisible();
    expect(await writes(page)).toEqual([]);
  });

  test("hostile names are text, never markup", async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    await openRoster(page, {
      characters: [rowFor(DANA_ROW.id, ids.player, sheetOf(evil, (d) => (d.id.prof = evil)))],
      assignments: [DANA_ACTIVE],
      profiles: [{ id: ids.player, display_name: evil }, PROFILES[1]],
    });
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText(evil);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator("#main img").count()).toBe(0);
  });
});

test.describe("live updates", () => {
  test("subscribes to this campaign's active characters and to sheets, and shows Live", async ({ page }) => {
    await openRoster(page);
    await live(page);
    const joins = await page.evaluate(() => window.__realtime.joins);
    expect(joins[0]).toEqual([
      { event: "*", schema: "public", table: "campaign_characters", filter: `campaign_id=eq.${ids.campaign}` },
      { event: "*", schema: "public", table: "characters" },
    ]);
  });

  test("a change made by a player appears without a reload", async ({ page }) => {
    await openRoster(page);
    await live(page);
    await expect(cards(page).nth(0).getByText("Dying")).toBeVisible();
    const changed = { ...DANA_ROW, data: sheetOf("Marlo Vance", (d) => (d.cm.shock = 1)), updated_at: "2026-09-19T12:00:00.000000+00:00" };
    await patchMock(page, { characters: [changed, RAVI_ROW] });
    await page.evaluate(() => window.__realtime.emit());
    await expect(cards(page).nth(0).locator(".penalty strong")).toHaveText(`${MINUS}1`);
    await expect(cards(page).nth(0)).not.toContainText("Dying");
  });

  test("a player who joins and chooses a character appears live", async ({ page }) => {
    await openRoster(page, { members: [MEMBERS[1]], assignments: [DANA_ACTIVE] });
    await live(page);
    await expect(cards(page)).toHaveCount(1);
    await patchMock(page, { members: MEMBERS, assignments: [DANA_ACTIVE, RAVI_ACTIVE] });
    await page.evaluate(() => window.__realtime.emit());
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(1)).toContainText("Ravi");
  });

  test("a player who chooses a different character is shown with the new one", async ({ page }) => {
    await openRoster(page, { characters: [DANA_ROW, DANA_SPARE, RAVI_ROW] });
    await live(page);
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText("Marlo Vance");
    await patchMock(page, { assignments: [assignmentRow(DANA_SPARE.id), RAVI_ACTIVE] });
    await page.evaluate(() => window.__realtime.emit());
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText("Spare");
  });

  test("a player who leaves moves to former players with a copy", async ({ page }) => {
    await openRoster(page, { departed: [] });
    await live(page);
    await patchMock(page, { members: [MEMBERS[1]], assignments: [DANA_ACTIVE], departed: [{ ...ZED_COPY, player_id: RAVI, character_name: "Vex", data: RAVI_ROW.data }] });
    await page.evaluate(() => window.__realtime.emit());
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Former players" })).toBeVisible();
    await expect(page.locator("ul.roster").nth(1)).toContainText("Vex");
  });

  test("only changed sheets are read again", async ({ page }) => {
    await openRoster(page);
    await live(page);
    const reads = async () => (await callsTo(page, "/rest/v1/characters", "GET")).filter((c) => decodeURIComponent(c.query).includes("id=in.(") && c.query.includes("data"));
    const before = (await reads()).length;
    await patchMock(page, { characters: [DANA_ROW, { ...RAVI_ROW, updated_at: "2026-09-19T12:05:00.000000+00:00" }] });
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
    await patchMock(page, { characters: [{ ...DANA_ROW, data: sheetOf("Renamed"), character_name: "Renamed", updated_at: "2026-09-19T12:10:00.000000+00:00" }, RAVI_ROW] });
    await live(page); // the library reconnects, and the roster reads again once it is subscribed
    await expect(cards(page).nth(0).getByRole("heading")).toHaveText("Renamed");
  });

  test("Refresh now reads again", async ({ page }) => {
    await openRoster(page);
    await patchMock(page, { characters: [DANA_ROW, { ...RAVI_ROW, data: sheetOf("Vex II"), character_name: "Vex II", updated_at: "2026-09-19T12:20:00.000000+00:00" }] });
    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(cards(page).nth(1).getByRole("heading")).toHaveText("Vex II");
  });
});

test.describe("downloads", () => {
  test("Download all sheets saves every sheet as stored, players who left too", async ({ page }) => {
    const stored = { ...DANA_ROW, data: { ...DANA_ROW.data, futureField: { keep: true } } };
    await openRoster(page, { characters: [stored, RAVI_ROW], departed: [ZED_COPY] });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all sheets" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Age-of-Eclipse-sheets-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(file).toMatchObject({ app: "eclipse", kind: "campaign-sheets", campaign: { id: ids.campaign, name: "Age of Eclipse" } });
    expect(file.sheets.map((s) => [s.playerName, s.member, s.departed])).toEqual([
      ["Dana Voss", true, false],
      ["Ravi", true, false],
      ["Zed", false, true],
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

test.describe("a player's sheet, as the Keeper", () => {
  const sheetPath = `${DM_PAGE}/${DANA_ROW.id}`;
  const dmSeed = (page, mock) => seed(page, { mock: scenario(mock), user: dm });

  test("opens read only, with no way to save or load, and follows changes", async ({ page }) => {
    await openRoster(page);
    await live(page);
    await cards(page).nth(0).getByRole("link", { name: "Open sheet" }).click();
    await expect(page).toHaveURL(new RegExp(`${DANA_ROW.id}$`));
    await expect(page.locator("#f_name")).toHaveValue("Marlo Vance");
    await expect(page.getByText("You are viewing Dana Voss's sheet as the Keeper.")).toBeVisible();
    await expect(page.locator("#saveState")).toHaveText("Read only");
    expect(await page.locator("#page1").evaluate((el) => el.inert)).toBe(true);
    await expect(page.getByRole("button", { name: "Save now" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Load file" })).toBeHidden();
    await expect(page.getByRole("button", { name: "History" })).toBeHidden();
    await expect(page.locator("#dialNum")).toHaveText(`${MINUS}14`);

    const changed = { ...DANA_ROW, data: sheetOf("Marlo Vance", (d) => (d.cm.shock = 1)), updated_at: "2026-09-19T12:00:00.000000+00:00" };
    await patchMock(page, { characters: [changed, RAVI_ROW] });
    await page.evaluate(() => window.__realtime.emit());
    await expect(page.locator("#dialNum")).toHaveText(`${MINUS}1`);
    expect(await writes(page)).toEqual([]);
  });

  test("says so when the player chooses a different character, and stops updating", async ({ page }) => {
    await dmSeed(page, {});
    await open(page, sheetPath);
    await expect(page.locator("#f_name")).toHaveValue("Marlo Vance");
    await patchMock(page, { characters: [RAVI_ROW], assignments: [RAVI_ACTIVE] });
    await page.evaluate(() => window.__realtime.emit());
    await expect(page.getByText("has chosen a different character, or has left")).toBeVisible();
  });

  test("Back to the Keeper page returns to the roster", async ({ page }) => {
    await dmSeed(page, {});
    await open(page, sheetPath);
    await page.getByRole("link", { name: "Back to the Keeper page" }).click();
    await expect(page).toHaveURL(new RegExp(`${DM_PAGE}$`));
    await expect(cards(page)).toHaveCount(2);
  });

  test("a character that is not active in this campaign, or a bad id, is not found", async ({ page }) => {
    await dmSeed(page, { characters: [DANA_ROW], assignments: [] });
    await open(page, sheetPath);
    await expect(page.getByText("We could not find that sheet in this campaign.")).toBeVisible();
    await open(page, `${DM_PAGE}/not-an-id`);
    await expect(page.getByText("We could not find that sheet.")).toBeVisible();
  });

  test("an unreadable sheet is not shown, and the message points to the backup", async ({ page }) => {
    await dmSeed(page, { characters: [{ ...DANA_ROW, data: { base: "nope" } }] });
    await open(page, sheetPath);
    await expect(page.getByRole("alert")).toContainText("could not be read");
    await expect(page.locator("#f_name")).toHaveCount(0);
  });

  test("only the campaign's Keeper can open it", async ({ page }) => {
    await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], characters: [DANA_ROW], assignments: [DANA_ACTIVE] }, user: players.dana });
    await open(page, sheetPath);
    await expect(page.getByText("Only the Keeper of this campaign can open this page.")).toBeVisible();
    await expect(page.locator("#f_name")).toHaveCount(0);
  });
});

test.describe("a sheet kept from a player who left", () => {
  const leftPath = `/campaign/${ids.campaign}/left/${ZED_COPY.id}`;

  test("opens read only, and says it does not change", async ({ page }) => {
    await seed(page, { mock: scenario({ departed: [ZED_COPY] }), user: dm });
    await open(page, leftPath);
    await expect(page.locator("#f_name")).toHaveValue("Old hand");
    await expect(page.getByText("as it was when they left")).toBeVisible();
    await expect(page.getByText("It is read only and it does not change.")).toBeVisible();
    await expect(page.locator("#saveState")).toHaveText("Read only");
    expect(await writes(page)).toEqual([]);
  });

  test("says a removed player was removed", async ({ page }) => {
    await seed(page, { mock: scenario({ departed: [{ ...ZED_COPY, reason: "removed" }] }), user: dm });
    await open(page, leftPath);
    await expect(page.getByText("as it was when you removed them")).toBeVisible();
  });

  test("a copy from another campaign, a missing one, and a bad id are not found", async ({ page }) => {
    await seed(page, { mock: scenario({ departed: [{ ...ZED_COPY, campaign_id: "10000000-0000-4000-8000-0000000000ff" }] }), user: dm });
    await open(page, leftPath);
    await expect(page.getByText("We could not find that sheet in this campaign.")).toBeVisible();
    await open(page, `/campaign/${ids.campaign}/left/999`);
    await expect(page.getByText("We could not find that sheet in this campaign.")).toBeVisible();
    await open(page, `/campaign/${ids.campaign}/left/abc`);
    await expect(page.getByText("We could not find that sheet.")).toBeVisible();
  });

  test("only the campaign's Keeper can open it", async ({ page }) => {
    await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], departed: [ZED_COPY] }, user: players.dana });
    await open(page, leftPath);
    await expect(page.getByText("Only the Keeper of this campaign can open this page.")).toBeVisible();
  });
});
