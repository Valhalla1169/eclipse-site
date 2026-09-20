import AxeBuilder from "@axe-core/playwright";
import { blank } from "../../public/js/eclipse-rules.js";
import { CHARACTER_ID, campaign, characterRow, expect, ids, open, players, seed, test } from "./helpers.js";

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
      await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], character: row }, user: players.dana });
      await setTheme(page);
      for (const path of ["/", "/account"]) {
        await open(page, path);
        await expectClean(page, path);
      }
    });

    test("every page of the sheet", async ({ page }) => {
      await seed(page, { mock: { profile: players.dana.profile, campaigns: [campaign], character: row, history }, user: players.dana });
      await setTheme(page);
      await open(page, `/campaign/${ids.campaign}/play`);
      for (const tab of ["Core", "Equipment", "Casting", "Testament", "Log", "Reference"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expectClean(page, `sheet ${tab}`);
      }
      await open(page, `/campaign/${ids.campaign}/play/history`);
      await expect(page.locator(".history > li")).toHaveCount(1);
      await expectClean(page, "version history");
      await open(page, `/campaign/${ids.campaign}/play/history/1`);
      await expectClean(page, "an old version");
    });

    test("the DM's roster and a player's sheet", async ({ page }) => {
      const members = [{ player_id: PLAYER_ID, joined_at: "2026-09-01T00:00:00Z" }];
      const profiles = [{ id: PLAYER_ID, display_name: "Dana" }];
      await seed(page, { mock: { profile: players.dm.profile, campaigns: [campaign], members, profiles, characters: [row] }, user: players.dm });
      await setTheme(page);
      await open(page, `/campaign/${ids.campaign}/dm`);
      await expect(page.locator(".roster > li")).toHaveCount(1);
      await expectClean(page, "roster");
      await open(page, `/campaign/${ids.campaign}/dm/${row.id}`);
      await expectClean(page, "a player's sheet as the DM");
    });
  });
}
