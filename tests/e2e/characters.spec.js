import { SCHEMA_VERSION, blank } from "../../public/js/eclipse-rules.js";
import { CHARACTER_ID, assignmentRow, callsTo, campaign, characterRow, expect, ids, open, patchMock, players, seed, sheetPath, storedMock, test } from "./helpers.js";

const { dana, dm } = players;
const CHARACTERS = "/rest/v1/characters";
const CHOOSER = `/campaign/${ids.campaign}/character`;

const sheetOf = (name, change = () => {}) => {
  const data = blank();
  data.id.name = name;
  change(data);
  return data;
};
const MARLO = characterRow(sheetOf("Marlo Vance"));
const VEX_ID = "40000000-0000-4000-8000-0000000000c2";
const VEX = characterRow(sheetOf("Vex"), { id: VEX_ID, updated_at: "2026-09-18T10:00:00.000000+00:00" });
const OTHER_CAMPAIGN = { id: "10000000-0000-4000-8000-000000000002", name: "Second Table", dm_id: ids.dm, created_at: "2026-09-02T00:00:00Z" };

const filler = (count) =>
  [...Array(count).keys()].map((i) => characterRow(sheetOf(`Filler ${i}`), { id: `40000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, updated_at: `2026-09-01T00:00:${String(10 + i)}.000000+00:00` }));

async function openList(page, mock = {}) {
  await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], characters: [MARLO, VEX], assignments: [assignmentRow()], ...mock }, user: dana });
  await open(page, "/characters");
  await expect(page.getByRole("heading", { name: "Your characters" })).toBeVisible();
}

const cards = (page) => page.locator("ul.characters").first().locator("> li");
const card = (page, name) => cards(page).filter({ has: page.getByRole("heading", { name, exact: true }) });
const rpc = (page, name) => callsTo(page, `/rest/v1/rpc/${name}`, "POST");

test.describe("the list of characters", () => {
  test("shows every character, how many of five, and where each is active", async ({ page }) => {
    await openList(page);
    await expect(page.locator(".card-head .badge").first()).toHaveText("2 of 5");
    await expect(cards(page)).toHaveCount(2);
    await expect(card(page, "Marlo Vance")).toContainText("In Age of Eclipse");
    await expect(card(page, "Vex")).not.toContainText("In Age of Eclipse");
    await expect(card(page, "Marlo Vance").getByRole("link", { name: "Open" })).toHaveAttribute("href", sheetPath());
  });

  test("the header links to it from any page", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign] }, user: dana });
    await open(page, "/account");
    await page.getByRole("link", { name: "Characters", exact: true }).click();
    await expect(page).toHaveURL(/\/characters$/);
    await expect(page.getByText("You have no characters yet.")).toBeVisible();
  });

  test("a character that is active in a campaign cannot be deleted, and says why", async ({ page }) => {
    await openList(page);
    await expect(card(page, "Marlo Vance").getByRole("button", { name: "Delete" })).toBeDisabled();
    await expect(card(page, "Marlo Vance")).toContainText("first choose a different character in Age of Eclipse");
    await expect(card(page, "Vex").getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  test("New character makes a blank one with only the columns a player may write, and opens it", async ({ page }) => {
    await openList(page);
    await page.getByRole("button", { name: "New character", exact: true }).click();
    await expect(page.locator("#f_name")).toBeVisible();
    await expect(page).toHaveURL(/\/characters\/40000000-0000-4000-8000-000000900001$/);
    const [post] = await callsTo(page, CHARACTERS, "POST");
    expect(Object.keys(post.body).sort()).toEqual(["character_name", "data", "owner_id", "schema_version"]);
    expect(post.body).toMatchObject({ owner_id: ids.player, schema_version: SCHEMA_VERSION, character_name: "" });
    expect(await callsTo(page, CHARACTERS, "PATCH")).toHaveLength(0);
  });

  test("Make a copy adds a second character with its own name", async ({ page }) => {
    await openList(page, { characters: [MARLO, VEX] });
    await card(page, "Marlo Vance").getByRole("button", { name: "Make a copy" }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect(card(page, "Marlo Vance (copy)")).toBeVisible();
    const [post] = await callsTo(page, CHARACTERS, "POST");
    expect(post.body).toMatchObject({ character_name: "Marlo Vance (copy)", data: { id: { name: "Marlo Vance (copy)" } } });
    const stored = (await storedMock(page)).characters;
    expect(stored.find((r) => r.id === CHARACTER_ID).character_name).toBe("Marlo Vance");
  });

  test("Delete asks first, then hides the character, which can be brought back", async ({ page }) => {
    await openList(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await card(page, "Vex").getByRole("button", { name: "Delete" }).click();
    expect(await rpc(page, "delete_character")).toHaveLength(0);
    await expect(cards(page)).toHaveCount(2);

    const messages = [];
    page.once("dialog", (dialog) => {
      messages.push(dialog.message());
      dialog.accept();
    });
    await card(page, "Vex").getByRole("button", { name: "Delete" }).click();
    await expect(cards(page)).toHaveCount(1);
    expect(messages[0]).toContain("It is hidden, not removed");
    const [call] = await rpc(page, "delete_character");
    expect(call.body).toEqual({ p_character_id: VEX_ID });
    await expect(page.locator(".card-head .badge").first()).toHaveText("1 of 5");

    const deleted = page.getByText("Deleted characters (1)");
    await deleted.click();
    await page.getByRole("button", { name: "Bring back" }).click();
    await expect(cards(page)).toHaveCount(2);
    expect(await rpc(page, "undelete_character")).toHaveLength(1);
    expect((await storedMock(page)).characters.find((r) => r.id === VEX_ID).deleted_at).toBeNull();
  });

  test("at five characters the new-character buttons are off and say how to make room", async ({ page }) => {
    const gone = characterRow(sheetOf("Gone"), { id: "40000000-0000-4000-8000-0000000002ff", deleted_at: "2026-09-02T00:00:00.000000+00:00" });
    await openList(page, { characters: [MARLO, ...filler(4), gone], assignments: [assignmentRow()] });
    await expect(page.locator(".card-head .badge").first()).toHaveText("5 of 5");
    const howToMakeRoom = /You have 5 characters, the most one person can have\. To make room, open one, press Save a copy to keep it on your computer, then delete it/;
    for (const name of ["New character", "New character from a file"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name, exact: true })).toHaveAccessibleDescription(howToMakeRoom);
    }
    await expect(page.getByText(howToMakeRoom)).toBeVisible();
    await expect(card(page, "Marlo Vance").getByRole("button", { name: "Make a copy" })).toBeDisabled();
    await page.getByText("Deleted characters (1)").click();
    await expect(page.getByRole("button", { name: "Bring back" })).toBeDisabled();
    expect(await callsTo(page, CHARACTERS, "POST")).toHaveLength(0);
  });

  test("the chooser says the same at five characters", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], characters: [MARLO, ...filler(4)], assignments: [] }, user: dana });
    await open(page, CHOOSER);
    const button = page.getByRole("button", { name: "Make a new character for this campaign" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(/To make room, open one, press Save a copy/);
  });

  test("when the database refuses a sixth character, the person is told how to make room and nothing is made", async ({ page }) => {
    await openList(page, { characters: [MARLO, VEX, ...filler(2)] });
    await patchMock(page, { characters: [MARLO, VEX, ...filler(3)] });
    await page.getByRole("button", { name: "New character", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("You have 5 characters, the most one person can have. To make room");
    await expect(page.getByRole("button", { name: "New character", exact: true })).toBeEnabled();
    expect((await storedMock(page)).characters).toHaveLength(5);
  });

  test("a character can be made from an .eclipse file, and a bad file is refused", async ({ page }) => {
    await openList(page);
    const upload = (contents) => page.locator('input[type="file"]').setInputFiles({ name: "hero.eclipse", mimeType: "application/json", buffer: Buffer.from(contents) });
    await upload("not json");
    await expect(page.getByRole("alert")).toContainText("That file is not an Eclipse character.");
    expect(await callsTo(page, CHARACTERS, "POST")).toHaveLength(0);

    await upload(JSON.stringify({ ...sheetOf("From a file"), schemaVersion: SCHEMA_VERSION, extra: "kept" }));
    await expect(page.locator("#f_name")).toHaveValue("From a file");
    const [post] = await callsTo(page, CHARACTERS, "POST");
    expect(post.body).toMatchObject({ character_name: "From a file", schema_version: SCHEMA_VERSION, data: { extra: "kept" } });
  });
});

test.describe("a character's sheet", () => {
  test("someone else's character, a deleted one and a bad id are not shown", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], characters: [MARLO, characterRow(sheetOf("Theirs"), { id: VEX_ID, owner_id: ids.dm })] }, user: dana });
    await open(page, sheetPath(VEX_ID));
    await expect(page.getByText("We could not find that character.")).toBeVisible();
    await open(page, "/characters/not-an-id");
    await expect(page.getByText("We could not find that character.")).toBeVisible();
    await patchMock(page, { characters: [characterRow(sheetOf("Marlo"), { deleted_at: "2026-09-19T11:30:00.000000+00:00" })] });
    await open(page, sheetPath());
    await expect(page.getByRole("heading", { name: "Deleted character" })).toBeVisible();
    await expect(page.locator("#f_name")).toHaveCount(0);
  });

  test("has a way back to the list", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character: MARLO }, user: dana });
    await open(page, sheetPath());
    await page.getByRole("link", { name: "Back to my characters" }).click();
    await expect(page).toHaveURL(/\/characters$/);
  });
});

test.describe("choosing a character for a campaign", () => {
  async function openChooser(page, mock = {}) {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign, OTHER_CAMPAIGN], characters: [MARLO, VEX], assignments: [], ...mock }, user: dana });
    await open(page, CHOOSER);
    await expect(page.getByRole("heading", { name: "Age of Eclipse" })).toBeVisible();
  }

  test("lists the characters, chooses one, and opens its sheet", async ({ page }) => {
    await openChooser(page);
    await expect(page.getByText("Your Keeper can see this character's sheet.")).toBeVisible();
    await card(page, "Vex").getByRole("button", { name: "Use this character" }).click();
    await expect(page).toHaveURL(new RegExp(`/characters/${VEX_ID}$`));
    await expect(page.locator("#f_name")).toHaveValue("Vex");
    const [call] = await rpc(page, "choose_character");
    expect(call.body).toEqual({ p_campaign_id: ids.campaign, p_character_id: VEX_ID });
    expect((await storedMock(page)).assignments).toEqual([expect.objectContaining({ campaign_id: ids.campaign, character_id: VEX_ID })]);
  });

  test("the character that is active here says so, and opens", async ({ page }) => {
    await openChooser(page, { assignments: [assignmentRow()] });
    await expect(card(page, "Marlo Vance")).toContainText("Your character here");
    await expect(card(page, "Marlo Vance").getByRole("link", { name: "Open sheet" })).toHaveAttribute("href", sheetPath());
  });

  test("switching leaves the old character free, and a character in another campaign cannot be taken", async ({ page }) => {
    await openChooser(page, { assignments: [assignmentRow(), assignmentRow(VEX_ID, { campaign_id: OTHER_CAMPAIGN.id })] });
    await expect(card(page, "Vex")).toContainText("In Second Table");
    await expect(card(page, "Vex").getByRole("button", { name: "Use this character" })).toBeDisabled();
    await expect(card(page, "Vex")).toContainText("first choose a different character in Second Table, or make a copy");
  });

  test("a new character can be made and chosen in one step", async ({ page }) => {
    await openChooser(page);
    await page.getByRole("button", { name: "Make a new character for this campaign" }).click();
    await expect(page.locator("#f_name")).toBeVisible();
    expect(await callsTo(page, CHARACTERS, "POST")).toHaveLength(1);
    expect(await rpc(page, "choose_character")).toHaveLength(1);
  });

  test("a refusal from the database is shown in plain words", async ({ page }) => {
    await openChooser(page);
    await patchMock(page, { assignments: [assignmentRow(VEX_ID, { campaign_id: OTHER_CAMPAIGN.id })] });
    await card(page, "Vex").getByRole("button", { name: "Use this character" }).click();
    await expect(page.getByRole("alert")).toContainText("That character is active in another campaign");
  });

  test("a Keeper has no character to choose", async ({ page }) => {
    await seed(page, { mock: { profile: dm.profile, campaigns: [campaign] }, user: dm });
    await open(page, CHOOSER);
    await expect(page.getByText("A Keeper does not have a character sheet.")).toBeVisible();
  });
});

test.describe("the home page", () => {
  test("shows the character chosen for each campaign, and a way to change it", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], characters: [MARLO, VEX], assignments: [assignmentRow()] }, user: dana });
    await open(page, "/");
    await expect(page.getByText("Your character: Marlo Vance")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open my character sheet" })).toHaveAttribute("href", sheetPath());
    await expect(page.getByRole("link", { name: "Change character" })).toHaveAttribute("href", CHOOSER);
    await expect(page.getByRole("link", { name: "Open my characters" })).toHaveAttribute("href", "/characters");
  });

  test("asks a player with no character chosen to choose one", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], characters: [MARLO], assignments: [] }, user: dana });
    await open(page, "/");
    await expect(page.getByText("You have not chosen a character for this campaign yet.")).toBeVisible();
    await page.getByRole("link", { name: "Choose a character" }).click();
    await expect(page).toHaveURL(new RegExp(`${CHOOSER}$`));
  });

  test("a person with no campaign can still reach their characters", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile }, user: dana });
    await open(page, "/");
    await page.getByRole("link", { name: "Open my characters" }).click();
    await expect(page).toHaveURL(/\/characters$/);
  });
});
