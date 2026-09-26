import { GOOD_PASSWORD, RULEBOOK, callsTo, expect, open, players, seed, test } from "./helpers.js";

const { dana } = players;
const signedIn = (page, rulebook = RULEBOOK) => seed(page, { mock: { profile: dana.profile, rulebook }, user: dana });
const chapter = (page) => page.locator("article.chapter");

test.describe("the rulebook", () => {
  test("the contents list every chapter in order, under the book's title and version", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A Made-up Field Guide");
    await expect(page.getByText("Version sample 3")).toBeVisible();
    const links = page.getByRole("navigation", { name: "Contents" }).getByRole("link");
    await expect(links).toHaveText(["Getting Started", "Moving About", "Last Words"]);
    await expect(links.nth(1)).toHaveAttribute("href", "/rules/moving-about");
    await expect(page).toHaveTitle("A Made-up Field Guide - Eclipse");
  });

  test("a chapter shows its Markdown: headings, lists, a quote and links", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules/getting-started");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Getting Started");
    await expect(page).toHaveTitle("Getting Started - Eclipse");
    await expect(chapter(page).locator("em")).toHaveText("made-up");
    await expect(chapter(page).locator("strong")).toHaveText("bold");
    await expect(chapter(page).locator("h2#sec-what-you-need")).toHaveText("What you need");
    await expect(chapter(page).locator("ul > li")).toHaveCount(2);
    await expect(chapter(page).locator("ul > li ol > li")).toHaveText(["Sharp", "Not chewed"]);
    await expect(chapter(page).locator("blockquote")).toHaveText("A note in a quote.");
    await expect(chapter(page).getByRole("link", { name: "part of this page" })).toHaveAttribute("href", "#sec-what-you-need");
    const outside = chapter(page).getByRole("link", { name: "an outside page" });
    await expect(outside).toHaveAttribute("href", "https://example.com/guide");
    await expect(outside).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("the book's HTML, bad links and images stay text", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules/getting-started");
    await expect(chapter(page)).toContainText("<script>window.__ran = true</script> <img src=x> a bad link a map");
    await expect(chapter(page).locator("script, img")).toHaveCount(0);
    await expect(chapter(page).getByRole("link", { name: "a bad link" })).toHaveCount(0);
    expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  });

  test("a table has a header row and scrolls in its own box on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signedIn(page);
    await open(page, "/rules/moving-about");
    const table = chapter(page).getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Pace", "Squares", "Noise", "Stamina", "Hunger", "Distance", "Visibility", "Cost"]);
    await expect(table.getByRole("cell", { name: "Noise2" })).toHaveClass("align-center");
    await expect(table.getByRole("row")).toHaveCount(3);
    const box = chapter(page).getByRole("region", { name: "Table 1" });
    expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await box.focus();
    await expect(box).toBeFocused();
  });

  test("previous and next move through the chapters, and focus the new heading", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules/getting-started");
    const nav = page.getByRole("navigation", { name: "Chapters" });
    await expect(nav.getByRole("link", { name: /Previous/ })).toHaveCount(0);
    await nav.getByRole("link", { name: "Next Moving About" }).click();
    await expect(page).toHaveURL(/\/rules\/moving-about$/);
    await expect(page.getByRole("heading", { name: "Moving About", level: 1 })).toBeFocused();
    await nav.getByRole("link", { name: "Next Last Words" }).click();
    await expect(page.getByRole("heading", { name: "Last Words", level: 1 })).toBeFocused();
    await expect(nav.getByRole("link", { name: /Next/ })).toHaveCount(0);
    await nav.getByRole("link", { name: "Previous Moving About" }).click();
    await expect(page).toHaveURL(/\/rules\/moving-about$/);
    await nav.getByRole("link", { name: "Contents" }).click();
    await expect(page).toHaveURL(/\/rules$/);
    await page.getByRole("link", { name: "Last Words" }).click();
    await page.getByRole("link", { name: "Contents" }).first().click();
    await expect(page.getByRole("heading", { name: "A Made-up Field Guide" })).toBeFocused();
  });

  test("a link to a part of another chapter opens that chapter at that part", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await signedIn(page);
    await open(page, "/rules/moving-about");
    await chapter(page).getByRole("link", { name: "what you need" }).click();
    await expect(page).toHaveURL(/\/rules\/getting-started#sec-what-you-need$/);
    const part = page.getByRole("heading", { name: "What you need" });
    await expect(part).toBeFocused();
    await expect(part).toBeInViewport();
  });

  test("an unknown chapter is not found", async ({ page }) => {
    await signedIn(page);
    for (const path of ["/rules/no-such-chapter", "/rules/Not_A_Slug"]) {
      await open(page, path);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(page.getByText("That chapter is not in the rulebook.")).toBeVisible();
    }
  });

  test("before a book is uploaded, the page says so", async ({ page }) => {
    await signedIn(page, { book: null, pages: [] });
    await open(page, "/rules");
    await expect(page.getByRole("heading", { name: "Rulebook" })).toBeVisible();
    await expect(page.getByText("The rulebook is not on the site yet.")).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("a visitor is sent to sign in, reads nothing, and comes back to the chapter", async ({ page }) => {
    await seed(page, { mock: { profile: dana.profile, rulebook: RULEBOOK } });
    await open(page, "/rules/moving-about");
    await expect(page).toHaveURL(/\/login\?next=%2Frules%2Fmoving-about$/);
    await expect(page.locator("#account")).toBeHidden();
    expect(await callsTo(page, "/rest/v1/rulebook_pages")).toHaveLength(0);
    expect(await callsTo(page, "/rest/v1/rulebook")).toHaveLength(0);
    await page.locator("#email").fill(dana.email);
    await page.locator("#password").fill(GOOD_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/rules\/moving-about$/);
    await expect(page.getByRole("heading", { name: "Moving About", level: 1 })).toBeVisible();
  });

  test("the fake database, like the real one, refuses the book to a signed-out request", async ({ page }) => {
    await seed(page, { mock: { rulebook: RULEBOOK } });
    await open(page, "/login");
    const statuses = await page.evaluate(async () => {
      const ask = (table) => fetch(`https://eosnplpgzqahwgaytauu.supabase.co/rest/v1/${table}?select=*`, { headers: { Authorization: "Bearer anon-key" } }).then((r) => r.status);
      return [await ask("rulebook_pages"), await ask("rulebook")];
    });
    expect(statuses).toEqual([401, 401]);
  });
});

test.describe("the header", () => {
  test("has a Rules link for signed-in people only, a button like Characters", async ({ page }) => {
    await seed(page);
    await open(page, "/login");
    await expect(page.getByRole("link", { name: "Rules" })).toBeHidden();
    await signedIn(page);
    await open(page, "/characters");
    const rules = page.locator(".account").getByRole("link", { name: "Rules" });
    const style = (locator) => locator.evaluate((el) => { const s = getComputedStyle(el); return [s.borderRadius, s.borderTopWidth, s.paddingTop, s.paddingLeft, s.fontWeight, s.fontSize]; });
    expect(await style(rules)).toEqual(await style(page.locator(".account").getByRole("link", { name: "Characters" })));
    await rules.click();
    await expect(page).toHaveURL(/\/rules$/);
    await expect(page.getByRole("heading", { name: "A Made-up Field Guide" })).toBeFocused();
  });
});
