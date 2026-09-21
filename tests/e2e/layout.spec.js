import { blank } from "../../public/js/eclipse-rules.js";
import { assignmentRow, campaign, characterRow, expect, open, players, seed, sheetPath, test } from "./helpers.js";

const { dana } = players;
const named = (name) => {
  const data = blank();
  data.id.name = name;
  return data;
};
const ROWS = [characterRow(named("Marlo Vance")), characterRow(named("Vex"), { id: "40000000-0000-4000-8000-0000000000c2", updated_at: "2026-09-18T10:00:00.000000+00:00" })];
const signedIn = (page) => seed(page, { mock: { profile: dana.profile, campaigns: [campaign], characters: ROWS, assignments: [assignmentRow()] }, user: dana });
async function box(locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not visible");
  return found;
}
const rem = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));

test.describe("the header and footer match deyderae.dev", () => {
  test("the logo sits in the same place on a narrow page, a wide page and the sheet", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seed(page, { mock: {}, user: null });
    await open(page, "/login");
    const x = (await box(page.locator(".logo"))).x;
    await signedIn(page);
    for (const path of ["/characters", "/account", sheetPath()]) {
      await open(page, path);
      expect((await box(page.locator(".logo"))).x, path).toBe(x);
    }
  });

  test("the header stays at the top while a long page scrolls, on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await signedIn(page);
    await open(page, sheetPath());
    await expect(page.locator("#f_name")).toBeVisible();
    expect(await page.locator(".site-header").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    await page.evaluate(() => window.scrollTo(0, 600));
    expect((await box(page.locator(".site-header"))).y).toBe(0);
  });

  test("the Reference search bar sits just under the header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await signedIn(page);
    await open(page, sheetPath());
    await page.getByRole("tab", { name: "Reference" }).click();
    const [header, top] = await page.evaluate(() => [document.querySelector(".site-header").offsetHeight, getComputedStyle(document.querySelector(".reftools")).top]);
    expect(top).toBe(`${header}px`);
  });

  test("on a phone the header is not sticky, and the name is short", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await signedIn(page);
    await open(page, "/characters");
    expect(await page.locator(".site-header").evaluate((el) => getComputedStyle(el).position)).toBe("static");
    await expect(page.locator(".wordmark span")).toBeHidden();
    expect((await box(page.locator(".site-header"))).height).toBeLessThan(130);
  });

  test("the name says what the site is on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seed(page, { mock: {}, user: null });
    await open(page, "/login");
    await expect(page.locator(".wordmark")).toHaveText("Eclipse Survivor's Records");
  });

  test("Characters and the account name are buttons like Sign out", async ({ page }) => {
    await signedIn(page);
    await open(page, "/characters");
    const style = (locator) => locator.evaluate((el) => { const s = getComputedStyle(el); return [s.borderRadius, s.borderTopWidth, s.paddingTop, s.paddingLeft, s.fontWeight, s.fontSize]; });
    const signOut = await style(page.getByRole("button", { name: "Sign out" }));
    expect(await style(page.locator(".account").getByRole("link", { name: "Characters" }))).toEqual(signOut);
    expect(await style(page.locator("#account-name"))).toEqual(signOut);
  });

  test("every page ends with the footer, at the bottom of a short page too", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page, { mock: {}, user: null });
    await open(page, "/join/abc");
    const footer = page.locator(".site-footer");
    const bottom = (await box(footer)).y + (await box(footer)).height;
    expect(Math.round(bottom)).toBe(900);
    await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/Valhalla1169");
    await expect(footer.getByRole("link", { name: "Email hello@deyderae.dev" })).toHaveAttribute("href", "mailto:hello@deyderae.dev");
    await expect(footer.getByRole("link", { name: "deyderae.dev", exact: true })).toHaveAttribute("href", "https://deyderae.dev");
    await expect(footer.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://github.com/Valhalla1169/eclipse-site");
    await expect(footer.locator("#year")).toHaveText(String(new Date().getFullYear()));
    await signedIn(page);
    await open(page, sheetPath());
    await expect(page.locator(".site-footer")).toBeVisible();
  });
});

test.describe("width", () => {
  test("a form page is a narrow column and a grid of cards uses the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const unit = await rem(page);
    await seed(page, { mock: {}, user: null });
    await open(page, "/login");
    expect((await box(page.locator("#main > *").first())).width).toBeLessThanOrEqual(44 * unit + 1);
    await signedIn(page);
    await open(page, "/characters");
    expect((await box(page.locator("ul.characters"))).width).toBeGreaterThan(44 * unit + 100);
    expect((await box(page.locator(".site-header .bar"))).width).toBeLessThanOrEqual(72 * unit + 1);
  });
});

test.describe("hover", () => {
  test("a card that holds buttons gets a stronger border and a shadow, and no lift", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signedIn(page);
    await open(page, "/characters");
    const card = page.locator(".character-card").first();
    const look = () => card.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopColor, shadow: s.boxShadow, transform: s.transform, title: getComputedStyle(el.querySelector("h2")).color }; });
    const before = await look();
    expect(before.shadow).toBe("none");
    await card.hover();
    await expect.poll(async () => (await look()).shadow).not.toBe("none");
    const after = await look();
    expect(after.border).not.toBe(before.border);
    expect(after.title).not.toBe(before.title);
    expect(after.transform).toBe("none");
  });

  test("a card also reacts to keyboard focus", async ({ page }) => {
    await signedIn(page);
    await open(page, "/characters");
    const card = page.locator(".character-card").first();
    await card.getByRole("link", { name: "Open" }).focus();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  });

  test("buttons and the footer icons fade, and stop fading when the person asks for less motion", async ({ page }) => {
    await signedIn(page);
    await open(page, "/characters");
    const fade = async (selector) => [...new Set((await page.locator(selector).first().evaluate((el) => getComputedStyle(el).transitionDuration)).split(", "))];
    expect(await fade(".btn-primary")).toEqual(["0.2s"]);
    expect(await fade(".socials a")).toEqual(["0.2s"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await fade(".btn-primary")).toEqual(["0s"]);
    expect(await fade(".socials a")).toEqual(["0s"]);
  });

  test("a footer icon turns mauve on hover", async ({ page }) => {
    await seed(page, { mock: {}, user: null });
    await open(page, "/login");
    const icon = page.locator(".socials a").first();
    const colour = () => icon.evaluate((el) => getComputedStyle(el).color);
    const before = await colour();
    await icon.hover();
    await expect.poll(colour).not.toBe(before);
  });
});

test.describe("the home page", () => {
  test("greets the person by name, with the campaign under a small label", async ({ page }) => {
    await signedIn(page);
    await open(page, "/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Dana Voss.");
    await expect(page.getByRole("heading", { level: 2, name: "Your campaign" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Age of Eclipse" })).toBeVisible();
  });
});
