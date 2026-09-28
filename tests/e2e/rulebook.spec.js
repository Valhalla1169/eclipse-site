import { GOOD_PASSWORD, RULEBOOK, callsTo, expect, open, players, seed, test } from "./helpers.js";

const { dana } = players;
const signedIn = (page, rulebook = RULEBOOK) => seed(page, { mock: { profile: dana.profile, rulebook }, user: dana });
const chapterBody = (page, slug) => page.locator(`#chapter-${slug} .chapter`);
const chapterEntry = (page, slug) => page.locator(`#chapter-${slug}`);

test.describe("the rulebook: one page, every chapter", () => {
  test("the list shows every chapter in order, under the book's title and version, none open", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A Made-up Field Guide");
    await expect(page.getByText("Version sample 3")).toBeVisible();
    const links = page.getByRole("navigation", { name: "Chapters" }).getByRole("link");
    await expect(links).toHaveText(["Getting Started", "Moving About", "Last Words"]);
    await expect(links.nth(1)).toHaveAttribute("href", "/rules/moving-about");
    await expect(page).toHaveTitle("A Made-up Field Guide - Eclipse");
    for (const slug of ["getting-started", "moving-about", "last-words"]) await expect(chapterEntry(page, slug)).not.toHaveAttribute("open", "");
  });

  test("a chapter's Markdown shows headings, lists, a quote and links, with its own title dropped", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules/getting-started");
    await expect(page).toHaveTitle("A Made-up Field Guide - Eclipse");
    await expect(chapterEntry(page, "getting-started")).toHaveAttribute("open", "");
    await expect(chapterEntry(page, "getting-started").locator("summary h2")).toHaveText("Getting Started");
    const body = chapterBody(page, "getting-started");
    await expect(body.locator("em")).toHaveText("made-up");
    await expect(body.locator("strong")).toHaveText("bold");
    // The chapter's own "# Getting Started" is dropped (its summary already shows it),
    // so "## What you need" becomes the first heading, shifted to h3.
    await expect(body.locator("h1")).toHaveCount(0);
    await expect(body.locator("h3#sec-getting-started-what-you-need")).toHaveText("What you need");
    await expect(body.locator("ul > li")).toHaveCount(2);
    await expect(body.locator("ul > li ol > li")).toHaveText(["Sharp", "Not chewed"]);
    await expect(body.locator("blockquote")).toHaveText("A note in a quote.");
    await expect(body.getByRole("link", { name: "part of this page" })).toHaveAttribute("href", "#sec-getting-started-what-you-need");
    const outside = body.getByRole("link", { name: "an outside page" });
    await expect(outside).toHaveAttribute("href", "https://example.com/guide");
    await expect(outside).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("only one h1 is on the page, and every heading id is unique", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    await page.getByRole("button", { name: "Open all" }).click();
    await expect(page.locator("#main h1")).toHaveCount(1);
    const ids = await page.locator("#main [id^='sec-']").evaluateAll((els) => els.map((el) => el.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the book's HTML, bad links and images stay text", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules/getting-started");
    const body = chapterBody(page, "getting-started");
    await expect(body).toContainText("<script>window.__ran = true</script> <img src=x> a bad link a map");
    await expect(body.locator("script, img")).toHaveCount(0);
    await expect(body.getByRole("link", { name: "a bad link" })).toHaveCount(0);
    expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  });

  test("a table has a header row and scrolls in its own box on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signedIn(page);
    await open(page, "/rules/moving-about");
    const table = chapterBody(page, "moving-about").getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Colour", "Apple", "Banana", "Cherry", "Grape", "Lemon", "Mango", "Plum"]);
    await expect(table.getByRole("cell", { name: "Banana2" })).toHaveClass("align-center");
    await expect(table.getByRole("row")).toHaveCount(3);
    const box = chapterBody(page, "moving-about").getByRole("region", { name: "Table 1" });
    expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await box.focus();
    await expect(box).toBeFocused();
  });

  test("clicking a chapter link opens it, scrolls to it, marks it current, and makes no new request for the book", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    const before = (await callsTo(page, "/rest/v1/rulebook_pages")).length;
    const link = page.getByRole("navigation", { name: "Chapters" }).getByRole("link", { name: "Moving About" });
    await link.click();
    await expect(page).toHaveURL(/\/rules\/moving-about$/);
    await expect(chapterEntry(page, "moving-about")).toHaveAttribute("open", "");
    await expect(chapterEntry(page, "moving-about").locator("summary")).toBeFocused();
    await expect(chapterEntry(page, "moving-about")).toBeInViewport();
    await expect(link).toHaveAttribute("aria-current", "true");
    expect(await callsTo(page, "/rest/v1/rulebook_pages")).toHaveLength(before);
  });

  test("opening a chapter does not close one already open, and Close all closes every chapter", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    await page.getByRole("navigation", { name: "Chapters" }).getByRole("link", { name: "Getting Started" }).click();
    await page.getByRole("navigation", { name: "Chapters" }).getByRole("link", { name: "Last Words" }).click();
    await expect(chapterEntry(page, "getting-started")).toHaveAttribute("open", "");
    await expect(chapterEntry(page, "last-words")).toHaveAttribute("open", "");
    await page.getByRole("button", { name: "Close all" }).click();
    for (const slug of ["getting-started", "moving-about", "last-words"]) await expect(chapterEntry(page, slug)).not.toHaveAttribute("open", "");
  });

  test("Open all opens every chapter", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    await page.getByRole("button", { name: "Open all" }).click();
    for (const slug of ["getting-started", "moving-about", "last-words"]) await expect(chapterEntry(page, slug)).toHaveAttribute("open", "");
  });

  test("a link to a part of another chapter opens that chapter at that part, without a new request", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await signedIn(page);
    await open(page, "/rules/moving-about");
    const before = (await callsTo(page, "/rest/v1/rulebook_pages")).length;
    await chapterBody(page, "moving-about").getByRole("link", { name: "what you need" }).click();
    await expect(page).toHaveURL(/\/rules\/getting-started#sec-getting-started-what-you-need$/);
    const part = page.getByRole("heading", { name: "What you need" });
    await expect(part).toBeFocused();
    await expect(part).toBeInViewport();
    expect(await callsTo(page, "/rest/v1/rulebook_pages")).toHaveLength(before);
  });

  test("opening /rules/<slug> directly opens that chapter", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules/last-words");
    await expect(chapterEntry(page, "last-words")).toHaveAttribute("open", "");
    await expect(chapterEntry(page, "last-words").locator("summary h2")).toHaveText("Last Words");
    await expect(chapterEntry(page, "last-words")).toBeInViewport();
  });

  test("an unknown chapter shows the whole book with a plain notice", async ({ page }) => {
    await signedIn(page);
    for (const path of ["/rules/no-such-chapter", "/rules/Not_A_Slug"]) {
      await open(page, path);
      await expect(page.getByRole("heading", { name: "A Made-up Field Guide" })).toBeVisible();
      await expect(page.getByText("That chapter is not in the rulebook.")).toBeVisible();
      const links = page.getByRole("navigation", { name: "Chapters" }).getByRole("link");
      await expect(links).toHaveText(["Getting Started", "Moving About", "Last Words"]);
    }
  });

  test("before a book is uploaded, the page says so", async ({ page }) => {
    await signedIn(page, { book: null, pages: [] });
    await open(page, "/rules");
    await expect(page.getByRole("heading", { name: "Rulebook" })).toBeVisible();
    await expect(page.getByText("The rulebook is not on the site yet.")).toBeVisible();
  });
});

test.describe("the rulebook on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("the chapter list is a closed 'Chapters' menu, and picking a chapter closes it", async ({ page }) => {
    await signedIn(page);
    await open(page, "/rules");
    const menu = page.locator("details.chapters-menu");
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(page.getByRole("navigation", { name: "Chapters" })).toBeHidden();
    await menu.locator("summary").click();
    await expect(menu).toHaveAttribute("open", "");
    await menu.getByRole("link", { name: "Last Words" }).click();
    await expect(page).toHaveURL(/\/rules\/last-words$/);
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(chapterEntry(page, "last-words")).toHaveAttribute("open", "");
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
    await expect(chapterEntry(page, "moving-about")).toHaveAttribute("open", "");
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
