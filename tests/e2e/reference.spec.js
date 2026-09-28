// The Reference tab's links to the rulebook (docs/adr/0016, audit item R2). Only slugs from
// public/js/sheet/reference-data.js are used here, never the book's own words.
import { blank } from "../../public/js/eclipse-rules.js";
import { REFERENCE } from "../../public/js/sheet/reference-data.js";
import { campaign, characterRow, expect, open, players, seed, sheetPath, test } from "./helpers.js";

const { dana } = players;
const play = sheetPath();
const tab = (page, name) => page.getByRole("tab", { name }).click();

async function openReference(page) {
  const data = blank();
  data.id.name = "Marlo";
  await seed(page, { mock: { profile: dana.profile, campaigns: [campaign], character: characterRow(data) }, user: dana });
  await open(page, play);
  await tab(page, "Reference");
}

test.describe("the Reference tab's rulebook links", () => {
  test("a card with a book slug links to that chapter, opening in a new tab", async ({ page }) => {
    await openReference(page);
    const card = REFERENCE.find((c) => c.book);
    const link = page.getByRole("link", { name: `Read the rules: ${card.t}` });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/rules/${card.book}`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("a card shows a rules link only when it has a book slug", async ({ page }) => {
    await openReference(page);
    await expect(page.locator(".rc .book-link")).toHaveCount(REFERENCE.filter((c) => c.book).length);
  });
});
