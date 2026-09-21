import AxeBuilder from "@axe-core/playwright";
import { blank } from "../../public/js/eclipse-rules.js";
import { CHARACTER_ID, assignmentRow, campaign, characterRow, expect, ids, open, players, seed, sheetPath, test } from "./helpers.js";

// An automated accessibility check (DESIGN.md sections 4 and 6.4) of every page, in the
// lightest and the darkest theme. It finds what a machine can find, mainly contrast,
// names, roles and heading order. It does not replace a keyboard and screen reader pass.
const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
const PLAYER_ID = "00000000-0000-4000-8000-0000000000a1";

const sheet = blank();
sheet.id.name = "Marlo";
sheet.cm.trauma = 10;
sheet.cm.shock = 3;
sheet.starve = 7;
sheet.base.vei = 4;
sheet.spells[0] = { n: "Spark", l: 3 };
const row = characterRow(sheet, { updated_at: "2026-09-19T11:00:00.000000+00:00" });
const history = [{ id: 1, character_id: CHARACTER_ID, schema_version: 1, character_name: "Marlo", data: sheet, reason: "edit", saved_at: "2026-09-19T10:00:00.000000+00:00" }];

async function expectClean(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(RULES).analyze();
  expect(
    violations.map((v) => `${v.id} (${v.impact}) ${v.nodes[0].target.join(" ")}: ${v.help}`),
    label,
  ).toEqual([]);
}

for (const theme of ["latte", "mocha"]) {
  test.describe(`accessibility in ${theme}`, () => {
    const setTheme = (page) => page.evaluate((t) => localStorage.setItem("theme", t), theme);

    test("the account pages", async ({ page }) => {
      await seed(page, { mock: {}, user: null });
      await setTheme(page);
      for (const path of ["/login", "/signup", "/forgot-password"]) {
        await open(page, path);
        await expectClean(page, path);
      }
      await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], character: row, assignments: [assignmentRow()] }, user: players.dana });
      await setTheme(page);
      for (const path of ["/", "/account", "/characters", `/campaign/${ids.campaign}/character`]) {
        await open(page, path);
        await expectClean(page, path);
      }
    });

    test("the join confirmation", async ({ page }) => {
      await seed(page, { mock: { profile: players.dana.profile, joinable: { ABCDEF0123: { id: ids.campaign, name: "Age of Eclipse", dmName: "The DM" } } }, user: players.dana });
      await setTheme(page);
      await open(page, "/join/ABCDEF0123");
      await expect(page.getByRole("heading", { name: "Join Age of Eclipse?" })).toBeVisible();
      await expectClean(page, "join confirmation");
    });

    test("every page of the sheet", async ({ page }) => {
      await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], character: row, history }, user: players.dana });
      await setTheme(page);
      await open(page, sheetPath());
      for (const tab of ["Core", "Equipment", "Casting", "Testament", "Log", "Reference"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expectClean(page, `sheet ${tab}`);
      }
      await open(page, `${sheetPath()}/history`);
      await expect(page.locator(".history > li")).toHaveCount(1);
      await expectClean(page, "version history");
      await open(page, `${sheetPath()}/history/1`);
      await expectClean(page, "an old version");
    });

    test("the DM's roster and a player's sheet", async ({ page }) => {
      const members = [{ player_id: PLAYER_ID, joined_at: "2026-09-01T00:00:00Z" }];
      const profiles = [{ id: PLAYER_ID, display_name: "Dana" }];
      const invite = (id, extra) => ({ id: `30000000-0000-4000-8000-0000000000${id}`, campaign_id: ids.campaign, label: "Dana", created_at: "2026-09-18T10:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", max_uses: 1, use_count: 0, revoked_at: null, ...extra });
      const invites = [invite("01"), invite("02", { revoked_at: "2026-09-19T00:00:00.000Z" })];
      const departed = [{ id: 7, campaign_id: ids.campaign, player_id: "00000000-0000-4000-8000-0000000000b4", character_id: "40000000-0000-4000-8000-0000000000c4", character_name: "Old hand", schema_version: 1, data: sheet, reason: "left", kept_at: "2026-09-10T12:00:00.000000+00:00" }];
      await seed(page, { mock: { profile: players.dm.profile, campaigns: [campaign], members, profiles: [...profiles, { id: "00000000-0000-4000-8000-0000000000b4", display_name: "Zed" }], characters: [row], assignments: [assignmentRow()], invites, departed }, user: players.dm });
      await setTheme(page);
      await open(page, `/campaign/${ids.campaign}/dm`);
      await expect(page.locator(".roster > li")).toHaveCount(2);
      await expectClean(page, "roster");
      await page.getByText("Older invites (1)").click();
      await expectClean(page, "roster with the older invites open");
      await open(page, `/campaign/${ids.campaign}/dm/${row.id}`);
      await expectClean(page, "a player's sheet as the DM");
    });
  });
}
